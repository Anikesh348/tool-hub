> **Learning goal**
> Design a mapping and turn-by-turn navigation system like Google Maps, and be able to explain how road networks are stored and partitioned for fast routing at scale, and how live traffic data gets folded into route calculation without every request recomputing routing from scratch.

## 39.1 Requirements and scope

**Functional requirements**

- A user can request directions between two points (or a multi-point route) and receive a route with turn-by-turn instructions and an estimated travel time.
- The system displays map tiles (the visual base map) for a given viewport as the user pans/zooms.
- Routes account for current traffic conditions, not just static road distances/speed limits.
- Users can search for a place by name/address (geocoding) and get its coordinates.
- Turn-by-turn navigation re-routes live if the user deviates from the suggested path.

**Non-functional requirements**

- **Low routing latency**: a route request should return in well under a second even though the underlying road network graph has hundreds of millions of edges globally — this rules out any naive graph search that touches a meaningful fraction of the whole graph per request.
- **Freshness of traffic data**: traffic conditions should be reflected in routing within a couple of minutes of changing — stale traffic data materially degrades the product's core value.
- **High availability**: navigation is often used in situations (driving) where the product being unavailable has a real, immediate cost to the user, unlike a delayed "like" on a social post.
- **Massive, globally distributed read scale**: billions of map-tile and routing requests daily, heavily skewed toward populated regions and rush-hour times.
- **Static base data changes slowly, traffic changes constantly**: road topology (new roads, closures) changes on the order of days-to-months; live congestion changes minute to minute — the design should treat these as genuinely different data problems.

**Out of scope**: satellite/street-view imagery serving, public transit schedule integration, place reviews/business data (that's the location-based-service lesson), and the map-tile rendering/rasterization pipeline itself (assume tiles are pre-rendered and served as static assets via a CDN — this lesson focuses on the routing problem, not cartographic rendering).

## 39.2 Scale estimation

Round, explicitly-stated assumptions:

- **Route requests**: assume 1 billion route requests/day globally → 1,000,000,000 / 86,400 ≈ **~11,600 requests/sec** average, peaking 3x during rush hours in major time zones simultaneously → design for roughly **35,000 requests/sec** peak.
- **Road network size**: a global road graph has on the order of a few hundred million road segments (edges) and a comparable number of intersections (nodes) — far too large to fit in the memory of a single machine if every request had to load and search the whole thing, and far too large to run a naive shortest-path search (which in the worst case touches a large fraction of the graph) within the latency budget above.
- **Traffic data ingestion**: modern systems commonly source live congestion signals from participating users' own devices (anonymized speed/position samples from phones actively navigating) as well as fixed road sensors. Assume tens of millions of active navigating devices at peak globally, each reporting a position/speed sample every few seconds — this is directly analogous in shape to the ride-hailing lesson's driver-location ingestion problem (a continuous, massive stream of small geo-tagged updates), just at even larger scale and used for a different purpose (aggregate road-segment speed, not individual matching).
- **Storage**: the base road graph (topology, speed limits, turn restrictions) is on the order of tens to low hundreds of GB globally — large but not intractable, and importantly it's mostly static, which is the key fact that shapes the whole architecture (Section 39.5). Live traffic state is much smaller per-segment (a rolling average speed per road segment) but needs to be updated continuously and read on every routing request.

The dominant insight: the base road network is a huge but *slowly changing* graph, so most of the engineering effort goes into **precomputing structure once, offline**, so that individual route requests are cheap online lookups rather than full graph searches from scratch — plus a separate, much more dynamic pipeline for injecting live traffic into that otherwise-static structure.

## 39.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `GET /route?from=&to=&mode=driving` | — | `{ "path": [...], "distanceKm", "etaMin", "turnByTurn": [...] }` |
| `GET /geocode?address=` | — | `{ "lat", "lng" }` |
| `GET /tiles/{z}/{x}/{y}` | — | Pre-rendered map tile image (served via CDN) |
| `POST /traffic/report` | `{ "deviceId", "lat", "lng", "speed", "timestamp" }` | `202 Accepted` (fire-and-forget, like the driver-location ping in the ride-hailing lesson) |
| `GET /navigation/{sessionId}/next` | Current position | `{ "instruction", "rerouted": bool }` (used during active turn-by-turn navigation) |

**Data model**

The road network is naturally a **graph**: `RoadNode { id, lat, lng }` and `RoadEdge { id, fromNodeId, toNodeId, distanceMeters, speedLimit, roadType, turnRestrictions }`. This is fundamentally different from every other data model in this course so far — the access pattern isn't point lookups or range scans, it's graph traversal (given a start and end node, find a path through connected edges). Neither a plain relational table nor a simple key-value store is a natural fit for that traversal pattern at the required latency; instead, the graph is transformed at index-build time into a **precomputed routing structure** (Section 39.5) that's purpose-built for fast shortest-path queries, and the raw graph itself is stored in whatever durable store is convenient for the offline precomputation pipeline to read from (a distributed file store or a graph-oriented database), since it's not queried directly on the hot path.

`LiveTrafficState { edgeId, currentAvgSpeed, sampleCount, windowStart }` is a separate, much more frequently updated structure — a rolling aggregate per road segment. Its access pattern (overwrite-by-key at high frequency, point lookup by `edgeId` during routing) is a strong fit for an in-memory key-value store, the same reasoning applied to driver locations in the ride-hailing lesson.

So, similarly to earlier lessons: the *slowly changing structural data* (road graph) is precomputed into a specialized routing index, while the *rapidly changing dynamic data* (live traffic) lives in a fast, ephemeral, high-write store consulted at query time.

## 39.4 High-level architecture

```text
Client
  -> Load Balancer -> API Gateway
       -> Geocoding Service -> Address Index
       -> Routing Service -> Precomputed Routing Index (graph structure, mostly static)
                           -> Live Traffic Store (in-memory, per-edge current speeds)
       -> Map Tile Service -> CDN (pre-rendered static tiles)

Offline / background pipeline:
  Raw road data (map providers, government sources) -> Graph Builder -> Precomputed Routing Index (rebuilt periodically)
  Device traffic reports -> Message Queue -> Traffic Aggregator -> Live Traffic Store (updated continuously)
```

**Route request (read path)**: a client requests a route between two points. The Routing Service queries the precomputed routing index to find a near-optimal path using the offline-computed structure (Section 39.5 covers why this is fast even on a graph with hundreds of millions of edges), then adjusts the edge weights along candidate paths using current data from the Live Traffic Store before finalizing the ETA and, if traffic materially changes which path is fastest, the chosen route itself. This two-stage approach — structural search on mostly-static data, then a traffic-aware adjustment pass — is the crux of making both goals (fast and traffic-aware) work together, since baking live traffic directly into the expensive offline structure would defeat the purpose of precomputing it.

**Traffic ingestion (write path)**: participating devices stream position/speed samples, which land on a message queue (buffering the same way driver-location pings do in the ride-hailing lesson) and are consumed by a Traffic Aggregator that maps each sample onto the nearest road edge and updates a rolling average speed for that edge in the Live Traffic Store. This pipeline runs continuously and independently of any individual routing request.

**Map tiles**: pre-rendered as static image assets and served through a CDN — a textbook case of a mostly-static, cacheable asset that shouldn't touch the application tier at all on the read path, consistent with the general architecture pattern from the very first lesson in this course.

## 39.5 Deep dive: precomputed routing at scale, and folding in live traffic

### Why a naive shortest-path search doesn't work at this scale

A classic algorithm like Dijkstra's or A* finds the shortest path by exploring outward from the start node, node by node, until it reaches the destination. On a graph with a few hundred million edges, even an efficient implementation of this exploration can touch millions of nodes for a long cross-country route, which is far too slow to run from scratch on every one of the ~35,000 routing requests/sec at peak. A* improves on plain Dijkstra by using a heuristic (straight-line distance to the destination) to bias the search toward the goal rather than exploring uniformly in all directions, which helps meaningfully but still isn't enough on its own at this scale for long routes across a huge graph — the search space is still enormous in absolute terms.

### Contraction hierarchies: precompute the expensive part once

The key insight that makes large-scale routing practical is that most of the road network's structure doesn't change often, so the expensive work of understanding "what are the important shortcuts through this region" can be done **once, offline**, rather than per query. Contraction hierarchies are a widely used technique built on exactly this idea:

- During an offline preprocessing step, nodes are ranked by "importance" (roughly: how often a shortest path passing through this node's neighborhood would actually route through it — intuitively, a highway interchange is far more important than a residential driveway junction) and then **contracted** one at a time, starting with the least important. Contracting a node means removing it from the graph while adding "shortcut" edges directly between its neighbors that preserve the shortest-path distances that used to go through it. Repeating this for millions of low-importance nodes produces a hierarchy: unimportant local roads at the bottom, a small set of pre-computed long-distance shortcut edges (conceptually similar to how a highway lets you skip over dozens of local streets) at the top.
- At query time, instead of searching the full original graph, the search runs on this contracted hierarchy and only needs to explore **upward** in importance from the start, **upward** from the destination, and meet somewhere in the middle — because the precomputed shortcut edges mean a long-distance path almost never needs to explore low-importance local roads far from either endpoint. This reduces what would be a search touching millions of nodes down to one touching a dramatically smaller set — often orders of magnitude fewer — which is what makes sub-second routing on a global road graph achievable.

The trade-off: contraction hierarchies require a substantial offline precomputation step (rebuilding the hierarchy from scratch is expensive) and the hierarchy needs to be **rebuilt periodically** to reflect real topology changes (new roads, closures) — but since Stage 2 established that road topology changes on the order of days-to-months, a periodic rebuild (e.g., nightly or weekly, depending on how quickly the platform wants to reflect new construction) is entirely adequate, and this precomputation is exactly why the road graph being "mostly static" (Section 39.1) is the fact that makes the whole architecture work.

### Partitioning the graph for scale

Even with contraction hierarchies, a single global routing index is a large structure, and most individual route requests are regional (a user in Chicago rarely requests a route to Tokyo), which argues for **geographic partitioning** of the routing index — similar in spirit to how the location-based-service and ride-hailing lessons partition by region, though here the partitioning has an added wrinkle: routes can legitimately cross partition boundaries (a cross-country trip), so the system needs a way to stitch together routing across regions. A common approach is a two-level hierarchy: fine-grained contraction hierarchies within each region for local routing, plus a smaller, coarser "backbone" graph of major inter-region highways connecting regions, so a long cross-region route is computed as local-routing-to-the-backbone, backbone-routing-across-regions, then local-routing-from-the-backbone-to-the-destination — this mirrors the contraction hierarchy's own "search upward to important roads, traverse, search downward" pattern, just applied at the level of regions instead of individual nodes.

### Incorporating live traffic

The precomputed hierarchy above is built assuming **static** edge weights (distance, speed limit), but real routing needs to reflect **current** conditions (an accident, rush-hour congestion) — and rebuilding the entire contraction hierarchy in real time every time traffic changes is far too expensive, since it's designed to be a periodic, offline operation.

The practical solution is a two-stage query, matching the write-path/read-path split described in Section 39.4:

1. Use the precomputed hierarchy to quickly identify a small number of *candidate* good routes based on static distance/speed (this step is unaware of current traffic, but is extremely fast thanks to the precomputation).
2. Re-score those candidate routes' actual travel time using the Live Traffic Store's current per-edge speeds (a lookup, not a search — for each edge along each candidate path, fetch its current average speed and recompute that path's total ETA), then pick the candidate with the lowest live-adjusted ETA.

This works because the *set* of genuinely reasonable routes between two points is usually small and structurally stable even as traffic conditions change minute to minute — traffic changes *which one is fastest right now*, but rarely invents an entirely new structurally-sound path that the static hierarchy wouldn't have surfaced as a candidate. This lets the system get the best of both: the precomputed hierarchy's speed for narrowing down candidates, and live data's freshness for the final ranking — without ever needing to run a full traffic-aware graph search from scratch.

For active turn-by-turn navigation, the same re-scoring runs periodically in the background against the user's current route (not on every GPS tick, but every minute or so, or triggered by a significant new traffic event on the route) — if a meaningfully faster alternative emerges (e.g., an accident newly blocks the current route), the system triggers a re-route, which is again just a fresh run of the two-stage query from the driver's current position.

| Stage | Data used | Frequency | Cost |
| --- | --- | --- | --- |
| Hierarchy build | Static road topology | Periodic (nightly/weekly) | Expensive, but offline and infrequent |
| Candidate route search | Precomputed hierarchy | Every route request | Cheap — the whole point of precomputing |
| Live re-scoring | Live Traffic Store | Every route request + periodic re-check during navigation | Cheap — a handful of key lookups per candidate route |

## 39.6 Bottlenecks and trade-offs

- **Single points of failure**: a single routing-index cluster serving a whole region would be a SPOF for all routing in that region — mitigated by replicating the (read-only, since it's precomputed) routing index across multiple nodes, which is straightforward precisely because it's read-only between rebuilds. The Live Traffic Store is a SPOF for traffic-awareness specifically (routing would silently fall back to static speeds, degraded but not broken, if it were unavailable) — a reasonable degraded-mode fallback rather than a hard failure.
- **Hot spots**: major metro areas generate disproportionately more routing requests and traffic samples than rural regions, mirroring the same density imbalance seen in the location-search and ride-hailing lessons — mitigated the same way, with finer-grained regional partitioning in dense areas and coarser partitioning where traffic is sparse.
- **Consistency vs. availability**: this system strongly favors availability and low latency over strict consistency — a route computed from traffic data that's a minute or two stale is a perfectly acceptable trade for never blocking a request on fresh data collection, and the periodic hierarchy rebuild means the "static" layer is by definition never perfectly up to date with real-world road changes either (a brand-new road literally cannot be routed over until the next rebuild, which is a known, accepted limitation of this approach).
- **What breaks first at 10x/100x scale**: at 10x request volume, the routing service and traffic store scale by adding more read replicas/regional shards without a structural change. At 100x, the traffic *ingestion* pipeline (tens of millions of devices reporting every few seconds) becomes the harder scaling problem — well beyond the routing-query side — pushing toward more aggressive sampling/aggregation before ingestion (not every device needs to report every few seconds; a sparser sample is often statistically sufficient for a road segment's average speed) rather than trying to durably ingest every single raw sample.

## 39.7 Summary

The core insight of large-scale routing is separating what's slow-changing from what's fast-changing: the road network's structure is precomputed offline into a hierarchy (contraction hierarchies being one well-known technique) that turns an otherwise-infeasible full-graph search into a fast, narrow one, while live traffic is layered on top as a cheap re-scoring step over a small set of already-identified candidate routes rather than being baked into the expensive precomputation. This two-stage design — precomputed structure for speed, live data for freshness — is the general pattern worth remembering beyond this specific problem: whenever a system has both a large, slowly-changing structure and a smaller, fast-changing signal that needs to influence results, precomputing against the former and cheaply adjusting with the latter is usually the right shape.

Natural follow-ups an interviewer might raise: supporting multi-modal routing (walking/transit/biking, each with a very different graph structure and weighting), and predictive ETA (using historical traffic patterns for a given time of day/day of week to estimate conditions along a route's *future* segments, not just its current ones, since a long route's later segments will be traveled well after the current traffic snapshot was taken).
