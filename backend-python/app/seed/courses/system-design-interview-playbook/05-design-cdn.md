> **Learning goal**
> Design a Content Delivery Network, and be able to explain push vs. pull content models, how cache invalidation works across a distributed edge, and how a request finds its way to a nearby edge server.

## 5.1 Requirements and scope

**Functional requirements**

- Serve static content (images, videos, JS/CSS bundles, downloadable files) to end users from a location geographically close to them.
- Origin content owners can publish new content and update or remove existing content.
- Serve the same content correctly to millions of geographically distributed users without every request hitting the origin server.

**Non-functional requirements**

- **Low latency**: the entire point of a CDN is reducing round-trip time by serving from a nearby edge location instead of a potentially distant origin — this is the primary design driver.
- **High availability**: content should remain servable even if the origin is temporarily unreachable, and even if some edge locations fail.
- **High throughput / massive read scale**: CDNs exist specifically to absorb read traffic that would otherwise overwhelm an origin server, especially for popular ("hot") content.
- **Eventual consistency for updates**: when origin content changes, edge copies do not need to reflect that instantly — a bounded staleness window (seconds to hours, depending on content type) is acceptable and expected.

**Out of scope**: dynamic, per-user personalized content (a CDN by design serves content that's the same for many users; personalization is usually handled at the origin or with a different caching strategy), and detailed TLS/certificate management at the edge.

## 5.2 Scale estimation

- **Traffic volume**: assume a media-heavy service with 500 million content requests/day → roughly **5,800 requests/sec** average, with peaks (e.g., a viral video) pushing individual pieces of content far higher momentarily.
- **Bandwidth**: this is the dominant number for a CDN, more so than request count. Assume an average asset size of 500 KB (a mix of images and small video segments) at 5,800 requests/sec → **2.9 GB/sec** of aggregate egress bandwidth at average load, and potentially several times that at peak — this is the number that justifies distributing serving capacity across many geographic points of presence (PoPs) rather than one central location, since no single data center's uplink can cheaply absorb that.
- **Content volume**: assume the total addressable content library is 10 PB (petabytes) — far too large to replicate in full to every edge location. This immediately implies edge nodes cache a *subset* of content (the popular subset), not a full mirror, which is why cache-hit ratio becomes a central design concern rather than just replicating everything everywhere.
- **Edge cache sizing**: if each edge location has, say, 10 TB of cache storage, and the 80/20 rule holds (80% of requests are for 20% of content), a well-chosen 10 TB of "hot" content at each edge can plausibly serve the large majority of regional traffic without going back to origin — this is the number that determines cache-hit ratio and, in turn, how much origin traffic actually gets absorbed.
- **Number of PoPs**: to meaningfully reduce latency for a global user base, a CDN typically needs points of presence spread across many regions/continents (real-world CDNs operate hundreds); for this design, assume a few dozen PoPs is enough to meaningfully cover major population centers, each acting as an independent edge cache in front of the origin.

The takeaway: bandwidth and content volume, not request count, are what make a single-origin design infeasible — this is fundamentally a caching and geographic distribution problem.

## 5.3 API and data model

A CDN's "API," like a load balancer's, is mostly the content-serving traffic itself, plus a small control-plane API for cache management.

**Content-serving path** (what end users hit)

| Method & Path | Request | Response |
| --- | --- | --- |
| `GET /assets/{path}` | (optionally with `If-None-Match` for conditional caching) | `200 OK` with content + cache headers, or `304 Not Modified` |

**Control-plane API** (used by content owners/origin operators)

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /api/purge` | `{ "path": "/assets/logo.png" }` | `202 Accepted` (invalidation propagates async) |
| `PUT /api/origin-config` | `{ "originUrl": "...", "defaultTtl": 3600 }` | `200 OK` |

**Data model**

The core entity at each edge node is essentially `CacheEntry { key (URL/path), content, headers (ETag, TTL, Cache-Control), lastFetchedFromOrigin }`. This is a textbook key-value access pattern — look up content by its URL path, nothing more relational than that — so each edge node's local cache is naturally a key-value store (often literally an LRU-style in-memory/disk-hybrid cache, not a general-purpose database). There's no meaningful SQL-vs-NoSQL debate for the cache layer itself: the access pattern (point lookup by key, no joins, no transactions) rules out a relational database on its own. The origin's own storage (where the canonical content actually lives) is a separate concern, typically an object store (like S3) chosen for the same key-by-path access pattern plus durability guarantees, again not a relational database.

## 5.4 High-level architecture

```text
End User
  -> DNS / Anycast routing -> nearest Edge PoP
                                   -> Edge Cache
                                        (hit)  -> serve directly to user
                                        (miss) -> fetch from Origin -> cache it -> serve to user

Origin Server / Object Storage (source of truth for all content)
```

**Read path**: a user requests an asset. DNS-based or anycast routing (5.5) directs them to a nearby edge PoP without the user needing to know anything about CDN internals. That edge node checks its local cache: on a hit, it serves the content directly, with no origin involved at all — this is the fast, common-case path that makes the CDN worthwhile. On a miss, the edge fetches from the origin (or, in a multi-tier CDN, from a regional "mid-tier" cache first), stores a copy locally respecting the content's TTL, and serves it. Subsequent requests for the same content at that edge are now cache hits.

**Update/publish path**: when a content owner publishes new content or updates existing content, the origin's canonical copy changes. Because edge nodes may be holding stale cached copies, this triggers either a natural expiration (once each edge copy's TTL lapses, it re-fetches from origin) or an explicit purge/invalidation request that actively removes or marks stale the cached copies across relevant edges (5.5).

## 5.5 Deep dive: push vs. pull models, cache invalidation, and edge selection

**Push vs. pull CDN models.** These describe how content gets from the origin to the edge in the first place.

- **Pull model**: edge nodes start empty and fetch content from the origin lazily, on the first request for that content (a cache miss), then retain it for subsequent requests until it expires or is evicted. This is simple to operate — the CDN doesn't need to know the content catalog in advance — and naturally caches only what's actually being requested at each location. The cost is that the very first request for any piece of content at any given edge is slow (an origin round trip), and if content is rarely requested at a particular edge, that edge does unnecessary repeated fetches as entries get evicted and re-requested.
- **Push model**: the origin proactively uploads content to edge nodes ahead of demand, typically for content known to be important (e.g., a major video release, a homepage asset). This guarantees no cold-miss penalty for that content anywhere it's pushed to, at the cost of using storage and bandwidth for content that might not actually be requested at every edge, and requiring the origin to know in advance what to distribute and where.

In practice, most CDNs default to pull for the long tail of content (most of the catalog, requested unpredictably) and use push selectively for a small set of high-value, high-traffic assets known in advance — this matches our scale estimate that only ~20% of content accounts for ~80% of traffic, so proactively pushing that hot 20% while pulling the rest is a reasonable default policy.

**Cache invalidation.** Because content is duplicated across potentially dozens of edge locations, keeping it consistent with the origin without constantly re-fetching everything requires a deliberate strategy:

- **TTL-based expiration** is the default and simplest mechanism: every cached entry carries a time-to-live (set by the origin via `Cache-Control` headers), and the edge treats it as valid until that TTL lapses, at which point the next request triggers a fresh fetch (often using conditional requests with `If-None-Match`/`ETag` so the origin can cheaply respond "still valid" with a 304 instead of re-sending the full content). This handles the common case well but means updates can take up to the TTL duration to propagate everywhere.
- **Active purge/invalidation** is needed when content must be updated faster than its TTL allows (e.g., correcting an error in a published asset). The origin issues a purge request for a specific path, and this needs to propagate to every edge that might be holding a copy — which is the hard part at CDN scale, since a purge naively broadcast to hundreds of PoPs must be reliable (not silently dropped at some edges) while not becoming its own bottleneck. A common approach is to route purge requests through the same hierarchical distribution tree used for pushing content (origin → regional mid-tier caches → edge caches), rather than the origin trying to individually contact every edge node directly.
- **Versioned URLs** sidestep invalidation entirely for content that changes structurally (e.g., `app.v2.js` instead of `app.js`) — since the URL itself changes, there's no stale-cache problem to solve, just a new cache key. This is why static asset pipelines commonly fingerprint filenames with a content hash.

**Edge server selection.** When a user makes a request, how does traffic actually end up at a *nearby* edge rather than a random one?

- **DNS-based routing**: the CDN's DNS servers resolve the CDN's hostname differently depending on the resolving client's approximate location (using the requester's IP or the EDNS Client Subnet extension), returning the IP of a geographically close edge PoP. This is simple and widely compatible but has a granularity limitation — DNS resolution is typically cached and shared by many end users behind the same resolver, so routing decisions aren't made per-individual-request.
- **Anycast routing**: many edge PoPs advertise the *same* IP address via BGP, and normal internet routing (which favors the shortest network path) naturally sends a user's packets to whichever PoP is topologically closest, without any DNS trickery. This gives finer-grained, automatically-adapting routing (if a PoP goes down, BGP routes around it) at the cost of needing network-level infrastructure (BGP peering) that's more operationally complex than DNS-based routing.

Real-world CDNs often combine both: anycast to get packets to a nearby regional cluster of PoPs, then application-level logic within that cluster to pick a specific healthy node.

## 5.6 Bottlenecks and trade-offs

- **Single points of failure**: the origin server is a SPOF for cache misses and purges — if it's down, TTL-expired content can't be refreshed anywhere. Mitigated by giving edge nodes a "stale-while-revalidate" policy (serve the stale copy while attempting a background refresh, rather than failing the request) and by making the origin itself highly available (its own replication, out of scope for this lesson but assumed).
- **Hot spots**: a single extremely popular asset (a viral video) can overwhelm a single edge node even though the CDN overall has huge aggregate capacity — mitigated by request coalescing (if many simultaneous requests for the same missing content arrive at once, only one fetches from origin while the rest wait on that in-flight fetch, rather than all triggering redundant origin fetches) and by pushing very hot content proactively as discussed above.
- **Consistency vs. availability**: firmly favors availability and staleness tolerance. A CDN's entire value proposition depends on being willing to serve content that might be a few minutes (or hours) out of date rather than always going back to origin for perfect freshness.
- **What breaks first at 10x/100x scale**: at 10x traffic, more edge PoPs and larger per-edge cache capacity absorb it linearly, since the architecture is already designed to be horizontally distributed. At 100x, the origin's ability to handle the cache-miss and purge-propagation load becomes the constraint — this typically pushes toward adding a mid-tier caching layer between edges and origin (so a cache miss at an edge hits a nearby regional cache before ever reaching the origin), reducing origin load by an order of magnitude.

## 5.7 Summary

A CDN's core idea is simple — cache content close to users — but the interesting engineering is in the details: deciding what to push proactively versus pull lazily, keeping distributed caches acceptably fresh via TTLs and propagated purges without turning invalidation into its own bottleneck, and routing each user's request to a genuinely nearby, healthy edge via DNS-based or anycast routing.

Natural follow-ups: supporting dynamic/personalized content acceleration (which requires the CDN to do more than cache — e.g., edge compute or request routing optimizations rather than full response caching) and video-specific concerns like adaptive bitrate streaming, where content isn't one file but many small segments cached and stitched together.
