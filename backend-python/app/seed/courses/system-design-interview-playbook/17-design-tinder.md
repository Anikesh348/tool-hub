> **Learning goal**
> Design a location-based matching app like Tinder, and be able to explain geospatial indexing for nearby-user discovery, swipe/match consistency, and real-time match notification.

## 17.1 Requirements and scope

**Functional requirements**

- Show a user a stream of candidate profiles near their current location, filtered by basic preferences (age range, distance, gender preference).
- Let a user swipe (like or pass) on a candidate.
- Detect a **match** when two users have both liked each other, and notify both users promptly.
- Update a user's location periodically as they move.

**Out of scope**: messaging after a match (covered by the WhatsApp lesson's model), the ranking/ML model that orders candidates beyond basic filtering, payments/premium features, photo verification. This lesson is about discovery-by-location and the swipe/match mechanic, which are the genuinely distinctive parts of this problem.

**Non-functional requirements**

- **Low-latency candidate discovery** — opening the app and getting a stack of nearby candidates to swipe through should feel instant.
- **No duplicate candidates shown repeatedly in a short window** — seeing the same profile twice in a row feels broken, so the system needs to track "already shown" state per user reasonably well, even if not perfectly.
- **Match detection must be correct** — a "match" is a mutual, symmetric fact (both sides liked each other); the system must never falsely report a match, and should rarely miss one under concurrent writes (two people swiping on each other at nearly the same instant is common and must resolve correctly).
- **Real-time-ish match notification** — when a match happens, both users should find out promptly (push notification), though this is less latency-critical than a chat message.
- **Location data is sensitive** — precision/retention should be the minimum needed for the feature (store rounded/approximate location for discovery purposes, not exact continuous GPS trails), which is as much a design constraint as a privacy one.

## 17.2 Scale estimation

Assumptions:

- 50 million DAU.
- Each DAU views ~100 candidate profiles/day and swipes on each → 5 billion swipes/day.
- Location updates: each active user's app reports location a few times per session, assume 10 location updates/user/day on average → 500 million location updates/day.

**Traffic**

- Swipes: 5B/day ÷ 86,400 ≈ 58,000 swipes/second average, 2-3x at peak (evenings) → ~150,000/second peak.
- Candidate-fetch requests (a batch of, say, 20 candidates per fetch) are far less frequent than individual swipes: 5B swipes ÷ 20 per fetch = 250 million fetches/day ≈ 2,900/second average — this is the number that matters for the geospatial query path specifically, since each fetch is one "find nearby candidates" query, not each swipe.
- Location updates: 500M/day ÷ 86,400 ≈ 5,800/second average.

**Storage**

- User profile + current location: 50M users × ~2 KB ≈ 100 GB — small, fits comfortably in a well-indexed store.
- Swipe history: 5B swipes/day × ~50 bytes (swiperId, targetId, direction, timestamp) ≈ 250 GB/day — high volume, append-only, which (as in earlier lessons) argues for a write-optimized store rather than a heavily-indexed relational table for the raw log, though the *current* like-state needed for match detection is a much smaller, frequently-read/written working set (see 17.3).

**Geospatial index size**

- At any moment, the "active and locatable" fraction of 50M DAU is what the discovery index needs to hold — call it 20 million concurrently indexable users. This is the number that determines whether the geospatial index can be a single in-memory structure (plausible at this size, with sharding by region) or needs to be distributed from the start.

These numbers point at the two central decisions for this lesson: candidate discovery needs a purpose-built geospatial index (a plain relational "scan all users, compute distance" approach cannot serve 2,900 fetches/second against 20 million active locations), and match detection needs a mechanism that is safe under concurrent writes without serializing all swipes globally.

## 17.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `PUT /users/{id}/location` | Report current approximate location | `{lat, lng}` | `{success}` |
| `GET /candidates?count=20` | Get a batch of nearby, not-yet-shown candidates | — | `{candidates: [...]}` |
| `POST /swipes` | Record a swipe | `{targetUserId, direction: like\|pass}` | `{matched: bool}` |
| `GET /matches` | List current matches | — | `{matches: [...]}` |

**Core entities**

- `User { userId, preferences: {ageRange, distanceMax, genderPref}, ... }`
- `Location { userId, geohash (or quadtree cell), lat, lng, updatedAt }` — the row that feeds the geospatial index; deliberately separate from the main `User` profile since it updates far more often.
- `Swipe { swiperId, targetId, direction, timestamp }` — the append-only log, partitioned by swiperId.
- `LikeState { userId, likedUserIds: set }` — the current, queryable "who has this user liked" working set, distinct from the historical log; this is what match detection actually reads and writes (see 17.5).
- `Match { matchId, userIdA, userIdB, matchedAt }` — created once both directions of a like are confirmed.

**SQL vs. NoSQL.** Three different access patterns, three different reasonable choices:

- Location data needs to support "find everything near point P" — a query shape relational databases handle poorly at this volume and update rate without specialized extensions. This is exactly what a geospatial index (built on geohashing or a quadtree, detailed in 17.5) is for, and such indexes are typically backed by an in-memory or key-value-oriented store optimized for fast lookups and frequent updates (recall: 5,800 location updates/second), not a general-purpose relational engine.
- `LikeState` needs fast, simple point lookups/writes ("does A like B," "record that A likes B") at high volume (58,000 swipes/second) with no need for joins — a key-value store keyed by userId is a strong fit, mirroring the reasoning used for feed/routing state in earlier lessons.
- `Match` records are comparatively low-volume (a small fraction of swipes become matches) and benefit from being easy to query reliably ("list my matches") — a relational store is a perfectly reasonable choice here, and its low volume means it isn't a bottleneck regardless.

## 17.4 High-level architecture

```text
Client
   |
   |--- PUT location -----------> Location Service --> Geospatial Index (geohash/quadtree, sharded by region)
   |
   |--- GET candidates ---------> Discovery Service --> queries Geospatial Index for nearby cells
   |                                     |                 --> filters by preferences, "already shown" set
   |                                     v
   |                              returns candidate batch
   |
   |--- POST swipe -------------> Swipe Service
   |                                     |
   |                                     |--- append to Swipe Log (durable, async)
   |                                     |--- read/write LikeState (is there a mutual like?)
   |                                     |
   |                                     v
   |                              if mutual: create Match record --> push notification to both users
```

**Write path (location update).** A client periodically reports its approximate location; the Location Service updates the geospatial index (removing the user from their old cell, inserting into the new one if they've moved enough to cross a cell boundary — small moves within a cell don't need an index update at all, which meaningfully cuts write volume).

**Read path (candidate discovery).** The Discovery Service queries the geospatial index for users near the requester's current cell (expanding outward to neighboring cells if too few candidates are found nearby), applies preference filters (age, gender, distance) and excludes users already shown recently or already swiped on, and returns a batch. This is deliberately a batch fetch (20 at a time, per 17.3) rather than one candidate per request, because most of the cost is in the geospatial query and filtering, and batching amortizes that cost over many swipes.

**Write path (swipe and match detection).** A swipe is recorded two ways: appended to the durable log (for history/analytics, async, not on the critical path) and used to update `LikeState` (synchronous, since match detection depends on it being correct immediately). If the swipe is a "like," the service checks whether the target has already liked the swiper back; if so, a `Match` is created and both users are notified — this check-and-create sequence is the trickiest correctness point in the whole design and is covered in 17.5.

## 17.5 Deep dive: geospatial indexing, swipe/match consistency, and real-time match notification

**Geospatial indexing with geohashing.** The naive approach — for every candidate-fetch request, compute the distance from the requester to all 20 million active users and filter — is an O(n) scan per request and is nowhere close to feasible at 2,900 fetches/second. Geohashing solves this by converting a (lat, lng) pair into a short string code that represents a rectangular cell on the earth's surface, where **nearby locations tend to share a common string prefix** — the longer the shared prefix, the closer the cells are. This turns "find users near me" into "find users whose geohash starts with the same prefix as mine," which is a simple, indexable string-prefix query rather than a distance computation over the whole dataset. In practice: pick a geohash precision level such that each cell is roughly the size of a typical search radius (e.g., a few kilometers), index users by their current cell, and to answer a discovery query, look up the requester's cell and its 8 neighboring cells (to correctly catch candidates just across a cell boundary — otherwise someone one meter outside your cell but very close to you would be missed). If too few candidates are found, the search expands to a coarser (shorter) prefix, covering a larger area, and refines with an actual distance calculation only over that already-small candidate set — the index gets you into the right neighborhood cheaply, and precise distance math only runs over a handful of already-filtered candidates.

An alternative with the same underlying idea is a **quadtree**: recursively subdivide the map into quadrants, subdividing further wherever user density is high, so dense cities get fine-grained cells and sparse areas get coarse ones automatically — this adapts better to wildly uneven population density than a fixed-precision geohash grid, at the cost of a somewhat more complex index structure to maintain under frequent updates. Either structure is sharded by region across multiple nodes at this scale (20 million concurrently active locations, per 17.2), typically sharding along the same prefix/cell boundaries the index already uses, so a discovery query for a given city mostly stays within one shard.

**Swipe and match consistency.** The core correctness problem: user A swipes "like" on B, and at nearly the same moment, B swipes "like" on A. Both writes need to be processed such that exactly one `Match` is created (not zero, not two), regardless of which write lands first or whether they're processed on different servers concurrently. The general pattern for this is: **use a canonical ordering of the pair and a single-writer or atomic-check point for the match decision.** Concretely, when recording A's like of B, the swipe service reads B's current `LikeState` to check "has B already liked A" and writes the match atomically with that check — the key requirement is that this check-then-act sequence for a given unordered pair `(A, B)` must be linearized somewhere, most simply by always routing both directions of any A/B interaction through logic keyed on a canonical pair id (e.g., sort the two user ids and use that as a partition/lock key), so that A-likes-B and B-likes-A can never be evaluated fully in parallel without one seeing the other's effect. This mirrors a general distributed-systems pattern: when you need to atomically check-and-act on a piece of shared state, route the operation so it's handled by a single owner for that piece of state (here, the pair), rather than trying to coordinate two independent writers after the fact. Because the *rate* of any single pair swiping on each other is trivially low (it happens once, ever, per pair), this doesn't need to be a global bottleneck — only operations touching the *same pair* need to serialize, and different pairs can be processed fully in parallel across the whole `LikeState` store.

**Real-time match notification.** Once a `Match` record is created, both users need to find out — this reuses the push-notification pattern from the Notification Service lesson rather than reinventing it: the swipe service, upon confirming a match, fires a notification request for each of the two users. If a user is actively in the app (holding a live connection, similar to the WhatsApp gateway model), the match can be pushed immediately over that connection for an instant "It's a match!" screen; if not, a standard push notification (APNs/FCM) wakes the app. This is a good example of a smaller problem reusing two mechanisms already built for other lessons in this course rather than needing a new one — the interesting, problem-specific work was entirely in getting the match *detection* correct (above); notifying about it is a solved sub-problem.

**Avoiding repeated candidates.** To satisfy the "don't show the same profile twice in a short window" requirement without unbounded state, a common approach is a per-user, time-bounded "recently shown" set (e.g., a capped set with expiry, similar in spirit to the rate-limit counters from the Notification Service lesson) — it doesn't need to be perfectly exhaustive forever, just good enough over a session-scale window, which keeps it cheap to maintain compared to tracking full exhaustive history per user pair indefinitely.

## 17.6 Bottlenecks and trade-offs

- **Single points of failure.** A regional shard of the geospatial index going down blinds discovery for that region specifically — mitigated with standard replication per shard, and because location data is inherently "refreshable" (a client will report its location again soon), a brief index outage self-heals faster than, say, losing durable message history would in the WhatsApp lesson.
- **Hot spots.** Dense urban areas (a popular city center) create geospatial hot spots — far more users per cell than a rural area, meaning that shard/cell sees disproportionate query and update load. Mitigated by the quadtree's adaptive subdivision (finer cells in dense areas spread load across more, smaller shards) or, with fixed geohash precision, by further sub-sharding a single dense prefix across multiple nodes rather than treating each geohash cell as tied to exactly one shard.
- **Consistency vs. availability.** Match detection is the one place in this design that needs a real consistency guarantee (per-pair linearization, as described above); discovery and location data lean towards availability and slight staleness (a candidate list that's a few seconds out of date, or a location that hasn't been re-indexed after a tiny move, is a fine trade for not having to synchronously coordinate every location update).
- **What breaks first at 10x scale.** The geospatial index's write rate (location updates) is the first strain point — 10x DAU means roughly 10x the 5,800 updates/second, and dense-area hot spots get denser; this pushes towards more aggressive "don't re-index unless the user crossed a cell boundary" filtering and finer-grained sharding within dense regions.
- **What breaks at 100x.** The candidate-fetch path's filtering step (preferences, already-shown exclusion) becomes the bottleneck — at 100x scale, dense-area cells contain so many candidates that even a well-indexed "nearby" query returns a large raw set before filtering, pushing the design towards precomputing/caching filtered candidate pools per user-segment (e.g., by rough age-range/gender-preference bucket) within each cell, rather than filtering the full cell contents on every single request.

## 17.7 Summary

This design's two genuinely hard problems both have compact, well-known solutions: discovery uses **geohashing or a quadtree** to turn "find nearby users" from an expensive whole-dataset distance computation into a cheap prefix/cell lookup, and match detection uses **canonical-pair-keyed, atomic check-and-act logic** to guarantee correctness under concurrent swipes without needing to serialize the whole system — only operations on the same pair ever need to coordinate. Everything else (notification, avoiding repeats) reuses patterns already established in earlier lessons rather than inventing new machinery.

Natural follow-ups: how would you extend candidate ranking beyond simple preference filtering to a "most compatible first" ordering (which starts to resemble the ranking layer discussed in the Instagram lesson, just applied to candidate ordering instead of feed ordering), and how would you handle a user traveling to a new city (a sudden large jump in location, which needs to trigger prompt re-indexing rather than waiting for the normal periodic update cadence).
