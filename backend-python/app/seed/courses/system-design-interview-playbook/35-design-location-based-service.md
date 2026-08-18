> **Learning goal**
> Design a location-based search service like Yelp — one that answers "what's near me, matching this filter" — and be able to explain how geospatial indexes make "nearby" queries fast, and how that index stays correct as millions of businesses open, close, and update their details.

## 35.1 Requirements and scope

**Functional requirements**

- A user can search for businesses near a given latitude/longitude within a radius (or the current map viewport), optionally filtered by category (e.g., "coffee shop") and free-text keyword.
- A user can view a business's detail page (name, address, hours, rating, photos).
- A business owner can create, update, and delete their business listing, including its location.
- Results are ranked by a combination of distance and relevance (rating, popularity) — not distance alone.

**Non-functional requirements**

- **Low read latency**: nearby search is an interactive, map-driven UI (think panning a map) — results should return in well under 200ms so the UI feels responsive as the user moves the viewport.
- **Read-heavy**: searches vastly outnumber business listing changes — most businesses don't change their address or hours more than a few times a year.
- **High availability** for reads: a search returning slightly stale results (a business that closed yesterday still showing up) is a much smaller problem than search being down.
- **Eventual consistency is acceptable** for listing updates propagating into search results — a new business does not need to be searchable within milliseconds of being created.
- **Scale**: tens of millions of businesses worldwide, unevenly distributed (dense in cities, sparse elsewhere).

**Out of scope**: reviews and rating computation pipelines, business owner dashboards/analytics, payments/reservations, personalized ranking based on user history. These are real Yelp features but orthogonal to the core "find nearby, matching X" problem this lesson focuses on.

## 35.2 Scale estimation

Stating round assumptions:

- **Businesses**: ~50 million active listings worldwide (a reasonable order of magnitude for a global business directory).
- **Writes**: business listings change rarely — assume 5% of listings are created or updated per day → 2.5 million writes/day ≈ **~30 writes/sec** average. This is small; the write path is not the bottleneck.
- **Reads (searches)**: assume 100 million searches/day across the user base (map panning alone can trigger several searches per session) → 100,000,000 / 86,400 ≈ **~1,150 searches/sec** average, with peaks 3x that during evenings/weekends → design for roughly **3,500 searches/sec peak**.
- **Storage per business**: name, address, category tags, hours, coordinates, rating aggregate, a handful of photo URLs — roughly 1–2 KB of structured metadata per listing (excluding the photos themselves, which live in object storage/CDN, out of scope here). At 50 million listings, that's **50–100 GB** of core metadata — small enough to fit comfortably across a modest cluster, or even mostly in memory if needed for the index.
- **Search result size**: a typical "nearby" query returns 20–50 results, each a few hundred bytes → tens of KB per response, trivial in bandwidth terms.

The takeaway: this is a read-heavy, latency-sensitive system with a moderate, geographically skewed dataset. The core engineering problem is not storage volume — it's answering "which of these 50 million points are within X km of this point, and match this filter" fast enough for an interactive UI, which is exactly what a generic relational or even key-value index cannot do efficiently on its own.

## 35.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `GET /search?lat=&lng=&radiusKm=&category=&q=` | — | `{ "results": [{ "id", "name", "category", "distanceKm", "rating", "lat", "lng" }, ...] }` |
| `GET /businesses/{id}` | — | Full business detail object |
| `POST /businesses` | `{ "name", "category", "address", "lat", "lng", "hours" }` | `{ "id" }` |
| `PUT /businesses/{id}` | Partial update fields | `204 No Content` |
| `DELETE /businesses/{id}` | (owner-authenticated) | `204 No Content` |

The search endpoint deliberately takes a center point and radius (or the caller derives a radius from a map viewport bounding box) rather than exposing raw geospatial index internals — the client should never need to know how "nearby" is computed.

**Data model**

Core entity: `Business { id (PK), name, category, addressText, lat, lng, geohash, hoursJson, ratingAvg, ratingCount, updatedAt }`.

Two storage needs exist side by side here, and conflating them is a common design mistake:

1. **Source of truth for business records** — full CRUD, needs strong consistency on writes (a business owner editing their hours should see the change reflected immediately on their own dashboard), benefits from a normalized schema and simple point lookups by `id`. A relational database (e.g., Postgres) is a good fit: the access pattern includes point lookups by primary key and occasional updates by owner, with no need for cross-shard transactions.
2. **The geospatial search index** — optimized for "find points near X," which is a fundamentally different access pattern that a plain relational `WHERE lat BETWEEN ... AND lng BETWEEN ...` handles poorly at scale (a naive bounding-box scan on unindexed lat/lng columns degrades to a large table scan, and even a standard B-tree index on lat or lng alone doesn't help because it can only sort on one dimension). This calls for a purpose-built geospatial index (Section 35.5) that is populated and kept in sync from the source-of-truth table, but is itself often backed by an in-memory or NoSQL structure optimized for range/proximity queries rather than a general relational engine.

So the honest answer to "SQL or NoSQL" here is **both, for different jobs**: relational for the authoritative business record and its transactional updates, and a specialized geospatial index (which may be built on top of a NoSQL store, a search engine like Elasticsearch with geo capabilities, or an in-memory structure) for the read-heavy nearby-search path.

## 35.4 High-level architecture

```text
Client (map UI)
  -> Load Balancer -> API Gateway
       -> Write path:  Business Service -> Primary DB (Postgres, source of truth)
                                          -> Change stream / CDC -> Index Updater -> Geo Index + Search Index
       -> Read path:   Search Service -> Geo Index (candidate points near center)
                                       -> Search Index (category/text filter, intersect with geo candidates)
                                       -> Cache (hot queries, e.g. popular city centers)
                                       -> Business Detail Cache -> Primary DB (on miss, for full detail page)
```

**Write path**: when a business is created or updated, the Business Service writes to the primary relational database first — this is the durable source of truth, and the owner's own view of their listing reads from here directly for immediate consistency. That write is then asynchronously propagated (via a change-data-capture stream or a simple event published to a queue) to an **Index Updater**, which updates the geospatial index and the text/category search index. This decoupling is deliberate: it keeps the low-volume, consistency-sensitive write path simple and fast, while letting the read-optimized indexes update on their own schedule (typically seconds, well within the "eventual consistency is fine for search" requirement from Stage 1).

**Read path**: a search request carries a center point, radius, and optional filters. The Search Service first queries the geospatial index to get a candidate set of nearby business IDs (the geospatial index's only job is answering "what points are near here," not filtering by category or text). It then intersects that candidate set with the category/text filter — either by querying a combined search index that supports both geo and text filtering natively (common in practice, e.g., Elasticsearch's geo-distance queries combined with its inverted-index text search), or by post-filtering the geo candidates against a small lookup of category tags. Frequently-requested query shapes (e.g., "coffee near downtown [city]") are cached, since map UIs often re-issue very similar queries as users pan slightly.

## 35.5 Deep dive: geospatial indexing, combined filtering, and keeping it fresh

This is the heart of the problem: efficiently answering "which of 50 million points are near this point," combined with a non-geo filter, on an index that is constantly being updated by unrelated writes elsewhere in the world.

### Why naive approaches fail

A B-tree index on `lat` and a separate one on `lng` cannot answer "near this point" efficiently, because proximity in 2D space isn't expressible as a range on either dimension alone — a business at the same latitude but on the other side of the planet has a "close" latitude value but is nowhere near you. What's needed is a structure that encodes two-dimensional proximity into something a standard index (which is fundamentally one-dimensional, sorted) can search efficiently. There are three widely used families of solution:

**Geohashing.** A geohash recursively subdivides the world into a grid, encoding each cell as a short base32 string (e.g., `9q8yy` for a part of San Francisco). Each additional character narrows the cell further — a 5-character geohash covers roughly a few kilometers, a 7-character geohash covers roughly 100 meters. Crucially, geohashes with a shared prefix are geographically close (with an important caveat below), which means "find points near me" reduces to a prefix search: compute the geohash for the center point, then look up all points whose geohash shares that prefix — a query a standard sorted index (a B-tree on the geohash string, or a NoSQL store's range query on a sorted key) handles natively and efficiently. The caveat: geohash cells are rectangular and aligned to a grid, so two points can be extremely close in real distance but fall on opposite sides of a cell boundary and therefore share no prefix at all. The standard fix is to query not just the center cell but its 8 neighboring cells as well, which handles the boundary case at the cost of a slightly wider candidate set to filter down by actual distance afterward.

**Quadtrees.** A quadtree recursively divides space into four quadrants, subdividing further only where point density is high — so a sparse rural quadrant stays a single large cell while a dense city block subdivides many times over. This adapts naturally to Stage 2's observation that businesses are unevenly distributed (dense in cities, sparse elsewhere), giving roughly balanced cell sizes by *business count* rather than fixed geographic size the way geohashing does. The trade-off is that a quadtree is a tree structure that needs explicit traversal logic (walk down from the root, find the smallest cell containing the query point, then check neighboring cells), rather than reducing cleanly to a sorted-index prefix query the way geohashing does — more engineering to build correctly, but better load balancing across the index for real-world, clustered data.

**S2 / Hilbert-curve-based indexing.** Google's S2 library projects the sphere onto a cube and recursively subdivides each face, using a space-filling curve (Hilbert curve) to assign each cell an ordered integer ID such that cells that are close on the curve are close in real 2D/3D space — significantly better locality guarantees than geohashing's simpler grid (fewer, smaller "neighbor cell" edge cases), at the cost of being more mathematically involved to implement (most teams use an existing library rather than building this from scratch, e.g., Google's S2 library or Uber's H3, which is hexagon-based and avoids some of the distortion issues that come from the square-cell approaches).

| Approach | Query pattern | Handles uneven density | Boundary artifacts | Implementation complexity |
| --- | --- | --- | --- | --- |
| Geohash | Prefix match on sorted index | No (fixed grid) | Yes — needs neighbor-cell lookups | Low |
| Quadtree | Tree traversal | Yes — subdivides where dense | Fewer, but still present | Medium |
| S2 / H3 | Cell ID lookup + neighbor expansion | Partially (fixed depth, but curve locality is strong) | Fewer than geohash | Medium-high (use existing library) |

For this design, geohashing is a reasonable default to describe in an interview because it maps cleanly onto infrastructure the candidate already knows (a sorted index — a B-tree, or a NoSQL store's range-scan capability), and the neighbor-cell workaround is a well-understood, bounded fix. At true global scale with strong locality requirements, production systems increasingly reach for S2/H3, but the conceptual query pattern — narrow to a candidate cell set, then filter/sort by actual distance — is the same across all three.

### Combining geo filtering with category/text search

A nearby search is rarely just "near me" — it's "coffee shops near me" or "pizza matching 'thin crust' near me." The geo index alone can't answer that; it only knows about coordinates. Two practical strategies:

1. **Geo-first, then filter.** Query the geospatial index for all candidates in the relevant cells (center + neighbors), then filter that candidate set by category/text against the business metadata. This works well when the geo radius is small (a dense city query might have a modest candidate count even in a busy downtown), but degrades if the search radius is large and the filter is narrow (returning thousands of geo candidates just to discard 99% of them for not matching "vegan").
2. **Combined index.** Use a search engine purpose-built for this, such as Elasticsearch or OpenSearch, which supports geo-distance queries and inverted-index text/category search *in the same query*, letting the engine intersect both constraints internally rather than the application doing a two-pass filter. This is the more common real-world choice once category/text filtering matters as much as location, because it avoids over-fetching geo candidates that will be discarded by the filter.

The general principle worth stating explicitly in an interview: geo indexing solves "narrow the search space by location cheaply," and it should be paired with — not replace — a standard text/category index; the two are complementary, not competing, structures.

### Keeping the index fresh

Because the geospatial/search index is a derived, denormalized structure built from the primary business table, it needs a reliable update mechanism as businesses are created, moved, or closed. The Index Updater (Section 35.4) subscribes to a change stream from the primary database (change-data-capture, or simply the Business Service publishing an event on every write) and applies the corresponding insert/update/delete to the geo index. This needs to be **idempotent** (safe to apply the same update twice, since at-least-once delivery is standard for this kind of pipeline) and should carry a version or timestamp so an out-of-order delivery (an older update arriving after a newer one) doesn't overwrite fresher data. Given the low write rate (~30/sec from Stage 2), propagation lag of a few seconds is a non-issue relative to the requirement that search doesn't need to be real-time-consistent with listing edits.

## 35.6 Bottlenecks and trade-offs

- **Single points of failure**: a single-node geo index is a SPOF for the entire read path (all search traffic goes through it) — mitigated by replicating the index across multiple nodes/regions and load-balancing reads across replicas. The primary business database is a SPOF for writes, mitigated with standard primary-replica failover.
- **Hot spots**: dense urban centers (a downtown core in a major city) will have vastly more businesses per unit area than rural regions, so a geo index partitioned by naive geographic tiling (e.g., sharding by geohash prefix) can end up with wildly uneven shard sizes — some shards covering a whole rural state, others covering three city blocks. This is exactly the density-adaptive property quadtrees and S2/H3 are better at handling than fixed-grid geohashing; mitigation includes rebalancing shard boundaries based on point density rather than pure geographic area, similar in spirit to how consistent hashing rebalances load in a key-value store.
- **Consistency vs. availability**: this system leans heavily toward availability and eventual consistency for the search path — a few seconds of staleness after a listing update is an acceptable trade for keeping search fast and always up. The one place strong consistency matters is the owner's own view of their own listing, which is why writes go to the durable primary database directly rather than through the async index pipeline.
- **What breaks first at 10x/100x scale**: at 10x traffic (35,000 searches/sec), a single geo-index cluster likely still holds with more replicas and a beefier cache layer in front of popular query shapes. At 100x, both the geo index and the combined search index need to be sharded geographically (e.g., one cluster per continent or region), since a single logical index serving global queries becomes both a capacity and a latency problem (cross-region queries add round-trip time) — at that point, routing a search request to the nearest regional shard based on the query's coordinates becomes part of the architecture, similar to how a CDN routes based on client location.

## 35.7 Summary

The core challenge in a location-based service isn't the CRUD around business listings — it's building a geospatial index (geohash, quadtree, or S2/H3) that turns "find points near me" into an efficient range or prefix query, combining that with standard text/category filtering, and keeping that derived index fresh via an asynchronous pipeline off the authoritative business database. The design deliberately splits the strongly-consistent, low-volume write path (owner edits) from the eventually-consistent, high-volume read path (nearby search), because the two have very different requirements.

Natural follow-ups an interviewer might raise: personalizing ranking (folding in a user's past visit history or preferences on top of distance and rating), and supporting real-time availability signals (e.g., "open now," which requires evaluating each candidate's hours at query time rather than as a static indexed field).
