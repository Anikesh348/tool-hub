> **Learning goal**
> Design a ride-hailing system like Uber end to end, and be able to explain how driver locations are ingested at massive scale, how riders get matched to nearby drivers under real supply/demand constraints, and how surge pricing is computed and applied without becoming a bottleneck.

## 36.1 Requirements and scope

**Functional requirements**

- A rider can request a ride by specifying a pickup and destination location, and see nearby available drivers and an estimated price/ETA before confirming.
- A driver can toggle availability (online/offline) and their live location is tracked while online.
- The system matches a requesting rider to a nearby available driver and notifies both parties.
- Both parties can track the ride's live progress (driver's location en route, then during the trip) until it completes.
- Pricing responds to real-time supply/demand imbalance (surge pricing) in a given area.

**Non-functional requirements**

- **Low-latency matching**: a rider should get matched within a few seconds of requesting — this is the single most important UX metric of the product.
- **High availability**: the system needs to keep functioning region-by-region even under partial outages; a rider in one city shouldn't be affected by an incident in another.
- **High write throughput for location updates**: every online driver's phone streams GPS updates continuously — this dwarfs every other write in the system.
- **Consistency where it matters**: a driver must never be double-matched to two simultaneous ride requests — this needs a correctness guarantee, not just "eventually consistent."
- **Geographic partitioning is natural**: rides are inherently local — a driver in Chicago is never relevant to a rider in Boston — which should shape sharding decisions throughout.

**Out of scope**: payment processing, driver background-check/onboarding workflows, ratings/reviews, multi-stop trips, ride-pooling logic (batch-matching multiple riders into one trip). These are real product surfaces but not the core matching/location problem this lesson targets.

## 36.2 Scale estimation

Round assumptions, stated explicitly:

- **Active drivers**: assume 5 million drivers online globally at a busy hour, each streaming a location update every 4 seconds → 5,000,000 / 4 ≈ **1.25 million location updates/sec** at peak. This single number dominates every other traffic figure in this system by orders of magnitude — location ingestion, not ride requests, is the throughput problem.
- **Ride requests**: assume 20 million rides/day globally → 20,000,000 / 86,400 ≈ **~230 requests/sec** average, peaking 3-5x during rush hours in dense metro areas → design for roughly **1,000-1,500 requests/sec** peak, concentrated heavily in specific geographic cells rather than evenly spread.
- **Location data size**: one update is small — driver ID, lat/lng, timestamp, heading — roughly 50-100 bytes. At 1.25 million updates/sec, that's **60-125 MB/sec** of raw ingestion, which is a meaningful but very manageable bandwidth figure for a distributed ingestion pipeline, though it argues strongly against persisting every single raw update durably forever (Section 36.5 addresses what actually gets stored vs. kept only in fast, ephemeral storage).
- **Matching latency budget**: to match within a few seconds end to end (per the requirement above), each stage of the matching pipeline (candidate lookup, scoring, driver notification, driver accept/reject round trip) needs a latency budget in the low hundreds of milliseconds, not seconds — this rules out anything that scans a large dataset synchronously per request.

The dominant insight from this stage: this is fundamentally a **real-time geospatial ingestion and matching** problem, not a storage-volume problem. The system must sustain over a million small writes per second (driver locations) while running rider-matching queries against that constantly-changing dataset within a tight latency budget — and the natural geographic locality of the problem (rides don't cross continents) is the single biggest lever for scaling both.

## 36.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /driver/location` | `{ "driverId", "lat", "lng", "heading", "timestamp" }` | `202 Accepted` |
| `POST /driver/availability` | `{ "driverId", "status": "online"/"offline" }` | `204 No Content` |
| `POST /rides/request` | `{ "riderId", "pickup": {lat,lng}, "destination": {lat,lng} }` | `{ "rideId", "estimatedFare", "estimatedEtaMin" }` |
| `GET /rides/{rideId}` | — | `{ "status", "driverLocation", "etaMin" }` |
| `POST /rides/{rideId}/accept` | `{ "driverId" }` (driver-side) | `200 OK` or `409 Conflict` if already taken |
| `POST /rides/{rideId}/cancel` | `{ "actorId" }` | `204 No Content` |

`POST /driver/location` is fire-and-forget (`202 Accepted`) rather than a synchronous confirmed write, because at 1.25 million/sec, treating each update as a durable, acknowledged transaction would be far too expensive relative to its value — a location update superseded four seconds later by the next one doesn't need durability guarantees.

**Data model**

Two very different data shapes coexist here, and treating them the same way is the most common design mistake for this problem:

1. **Driver live location** — a rapidly overwritten, ephemeral value per driver (`driverId -> {lat, lng, timestamp}`), read constantly by the matching service and almost never needed historically beyond the last few positions. This is a textbook fit for an **in-memory key-value store** (e.g., Redis, or a purpose-built in-memory geospatial store) rather than a durable relational database: the access pattern is high-frequency overwrite-by-key plus proximity queries, there's no need for transactions or joins, and losing a few seconds of location history on a node failure is an acceptable trade for the massive throughput and low latency an in-memory store provides. Many in-memory stores (Redis included) ship native geospatial commands (e.g., "give me all keys within N km of this point"), which is a direct fit for the driver-lookup access pattern.
2. **Ride records** — `Ride { id (PK), riderId, driverId, pickup, destination, status, fare, requestedAt, ... }` — these are low-volume relative to location pings (~230/sec vs. 1.25M/sec), need durability (a ride record must survive a crash — it's the basis for billing and disputes), and benefit from a normalized relational schema with transactional guarantees (the driver-acceptance step in particular needs an atomic "claim this ride" operation — Section 36.5). A relational database is the right fit here: moderate write volume, strong consistency needs, and a schema with real relationships (ride to rider, ride to driver, ride to fare/payment).

So the data model splits cleanly along the same line as the traffic profile: ephemeral, extreme-throughput location state in an in-memory geospatial store, and durable, moderate-throughput ride state in a relational database.

## 36.4 High-level architecture

```text
Driver app                                  Rider app
   |  (location ping every ~4s)                |  (ride request)
   v                                            v
Location Ingestion Service                  Ride Request Service
   -> Message Queue (buffer/absorb burst)         -> Matching Service
        -> Location Writer                              -> Geospatial Driver Index (in-memory, read: nearby available drivers)
             -> Geospatial Driver Index (write)          -> Surge Pricing Service (read current demand/supply signal)
             -> (sampled/aggregated) -> Historical Location Store   -> Ride Service -> Primary DB (durable ride record)
                                                          -> Driver Notification (push to candidate drivers)
```

**Location write path**: driver apps push GPS updates roughly every few seconds. These land on a Location Ingestion Service behind a load balancer, which immediately hands them to a message queue rather than writing synchronously — this decouples the extreme, bursty ingestion rate (1.25M/sec at peak) from the downstream write rate to the geospatial index, and gives the system a buffer to absorb spikes without dropping data or blocking driver apps. A pool of Location Writer workers consumes from the queue and updates each driver's position in the in-memory geospatial index (a simple overwrite of that driver's current key). A separate, much lower-rate sampled/aggregated stream can persist historical trajectories (e.g., one point every 30 seconds, or only during active trips) to durable storage for analytics, trip playback, and dispute resolution — deliberately not every raw ping, since that volume would be wasteful to store forever.

**Ride request path**: a rider requests a ride with a pickup point. The Ride Request Service asks the Matching Service to find candidate drivers, which queries the geospatial driver index for available drivers within a radius of the pickup (Section 36.5 covers how "available" and "nearby" are scored together, not just distance). The Matching Service also consults the Surge Pricing Service for the current price multiplier in that geographic cell before returning a fare estimate. Once a driver is selected and accepts, the Ride Service writes the durable ride record to the primary database and both apps begin polling/subscribing (e.g., via WebSocket or push notification) for live status updates, which stream from the driver's ongoing location pings joined with the ride record.

## 36.5 Deep dive: location ingestion, rider-driver matching, and surge pricing

### Ingesting driver location at massive scale

The 1.25 million updates/sec figure from Stage 2 is the defining constraint of this whole system, and the design choices above follow directly from it. Two things make this tractable rather than overwhelming:

- **Geographic partitioning.** A driver in Chicago never needs to be compared against a driver in Boston, so the geospatial index (and the message queue feeding it) should be partitioned by region — commonly by mapping each location into a geohash or S2/H3 cell (the same indexing techniques covered for the location-based-service lesson apply directly here) and routing/sharding by that cell's prefix. This turns one unmanageable global ingestion stream into many independent, much smaller regional streams, each sized to that region's actual driver density.
- **Overwrite semantics, not append.** Each driver has exactly one current position; a new ping simply overwrites the old one in the index rather than appending to a growing log. This keeps the index's size proportional to the number of *active drivers* (millions), not the number of *pings ever sent* (which would grow unbounded), and is exactly why an in-memory key-value structure — not a durable log — is the right primary store for this data.

A subtlety worth naming: at this throughput, even a queue partitioned by region needs enough partitions that a single consumer group isn't a bottleneck, and the Location Writer tier needs to scale horizontally with the same regional partitioning, so a writer only ever touches the shard of the geospatial index for its own region.

### Matching riders to drivers

Matching looks like a simple "find the nearest available driver" problem but has real subtlety once you account for real-world supply and demand:

1. **Candidate generation**: query the regional geospatial index for available drivers within an expanding radius around the pickup point (start narrow, e.g., 1-2 km, and widen if too few candidates are found — this avoids over-fetching in dense areas while still succeeding in sparse ones).
2. **Scoring, not just nearest-first**: naively assigning the closest driver sounds optimal for a single rider, but is often *not* optimal for the system as a whole. Consider two riders requesting near-simultaneously with two available drivers nearby: greedily assigning each rider their individually-closest driver can produce a worse total outcome (e.g., both riders getting a driver, but with more total combined pickup distance) than an assignment that considers both requests together. Production systems typically batch requests within a short time window (a few seconds) in a given cell and solve a small bipartite matching problem (conceptually similar to the assignment problem solved by algorithms like the Hungarian algorithm) to minimize total pickup distance/time across all pending requests in that window, rather than matching strictly first-come-first-served. This trades a small amount of added latency (waiting a couple seconds to batch) for meaningfully better aggregate efficiency.
3. **Driver notification and atomic acceptance**: once a driver is selected, they receive a push notification with a short window to accept. Because multiple riders' matching decisions might, in a race condition, converge on the same driver before that driver's status is updated, the "accept" step must be an atomic, conditional operation — e.g., a compare-and-swap on the driver's status field ("set to `matched` only if currently `available`") — so that exactly one ride request can successfully claim a given driver. This is the one place in the whole design that needs a hard consistency guarantee rather than eventual consistency, precisely because double-booking a driver is a correctness failure, not just a UX blemish.
4. **Fallback**: if a driver doesn't accept within the notification window (declines, or times out), the system re-matches from the remaining candidate pool automatically, which is why keeping a slightly wider candidate set than "just the single best match" from step 1 is useful.

### Surge pricing data flow

Surge pricing exists to solve a real supply/demand problem: when far more riders are requesting than there are available drivers in an area (e.g., during a downpour or a major event letting out), prices rise both to incentivize more drivers to go online/reposition into that area and to moderate demand from riders who can wait.

The data flow: each geographic cell (the same regional partitioning used for the driver index) continuously tracks two rolling counts over a short recent window (e.g., the last few minutes) — the number of open ride requests and the number of currently available drivers in that cell. The ratio of these two numbers feeds a pricing function (often a simple lookup/step function or a smoother curve, e.g., ratio of demand:supply above 1.5x triggers a 1.2x multiplier, above 3x triggers 1.8x, etc. — the exact curve is a product/business decision, not a systems one) that produces a **surge multiplier for that cell**, recomputed frequently (every 30-60 seconds is typical) rather than continuously, since true real-time recomputation on every single event would add load without meaningfully improving pricing accuracy.

This multiplier is cached per cell (a small, frequently-read, frequently-updated value — another good fit for the in-memory store already used for driver locations) and applied at the moment a fare estimate is computed for a ride request. A key design property: surge computation is entirely local to a cell and depends only on that cell's own recent request/supply counts, which means it scales the same way the rest of the location system does — by geographic partitioning — with no need for any global coordination or a single service computing pricing for the whole world at once.

## 36.6 Bottlenecks and trade-offs

- **Single points of failure**: a single global geospatial index or a single message-queue cluster would be a severe SPOF given the 1.25M/sec ingestion rate — mitigated by regional partitioning (Section 36.5), so an outage in one region's infrastructure doesn't take down matching everywhere else. The primary ride database is a SPOF for ride durability, mitigated with standard replication/failover.
- **Hot spots**: major events (a stadium letting out, a large festival) create an extreme, sudden spike in both ride requests and, often, a shortage of available drivers in one small geographic cell — exactly the scenario surge pricing is designed to respond to, but it also stresses the matching service and driver index for that one cell specifically. Mitigation includes being able to dynamically split an overloaded cell's shard further (similar in spirit to resharding a hot key range) and pre-positioning driver incentives ahead of known large events.
- **Consistency vs. availability**: this system is deliberately availability-favoring almost everywhere (a driver's displayed location being a few seconds stale is a non-issue), with exactly one carved-out exception requiring strong consistency: the driver-acceptance/claim step, which must be atomic to prevent double-booking. This is a good example of a system that isn't "CP" or "AP" wholesale — different subsystems within it make different choices based on what a wrong answer actually costs.
- **What breaks first at 10x/100x scale**: at 10x (12.5M location updates/sec), the queue and writer tiers need proportionally more partitions and consumers, which the regional-sharding design accommodates without a fundamental rework. At 100x, the real strain shows up in dense-city cells specifically (a single popular downtown cell doesn't get 100x more geographically distributed — it gets denser), which pushes toward finer-grained cell subdivision in high-density areas (again, the same density-adaptive indexing idea as quadtrees/S2) rather than uniformly increasing capacity everywhere.

## 36.7 Summary

The core of a ride-hailing system is not the ride-request CRUD — it's absorbing an enormous, continuous stream of driver location updates (handled via geographic partitioning and an in-memory geospatial index fed through a buffering queue), matching riders to drivers in a way that's efficient in aggregate rather than purely greedy (batched bipartite matching, with one hard atomicity requirement at the acceptance step to prevent double-booking), and computing surge pricing as a purely local, per-cell function of recent supply and demand. Every major design decision — regional partitioning, in-memory ephemeral location storage, async ingestion via a queue — traces directly back to the one dominant number from Stage 2: over a million location writes per second, geographically clustered.

Natural follow-ups an interviewer might raise: supporting ride-pooling (which turns matching into a genuinely harder combinatorial problem — assigning multiple riders with different pickups/destinations to one vehicle), and handling driver repositioning incentives (nudging idle drivers toward under-supplied cells before demand spikes rather than only reacting after the fact).
