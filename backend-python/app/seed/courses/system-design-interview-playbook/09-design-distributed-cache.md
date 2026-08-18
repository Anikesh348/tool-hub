> **Learning goal**
> Design a distributed cache like a Memcached or Redis cluster, and be able to explain how hot keys are handled under partitioning, how eviction policies decide what to discard, and how cache invalidation keeps cached data from going stale.

## 9.1 Requirements and scope

**Functional requirements**

- `GET(key)` — return a cached value if present, or a clear miss signal if not.
- `SET(key, value, ttl)` — store a value with an optional expiration.
- `DELETE(key)` — explicitly remove a value (used for invalidation).
- Sit in front of a slower primary datastore, absorbing read traffic that would otherwise hit it directly.

**Non-functional requirements**

- **Very low latency**: sub-millisecond to low-single-digit-millisecond responses — this is the entire reason a cache exists, so latency is the dominant non-functional requirement, more important here than in almost any other system in this course.
- **High throughput**: caches typically absorb the majority of read traffic for the systems in front of them, so they need to sustain very high request rates per node.
- **Acceptable data loss on failure**: unlike the key-value store lesson, a cache is explicitly *not* the source of truth — if a cache node crashes and loses its in-memory contents, that's a performance blip (falls back to the primary datastore), not a correctness problem. This relaxes durability requirements considerably compared to a primary datastore.
- **Bounded memory usage**: memory is finite and expensive, so the system must have a clear policy for what to keep and what to discard when full.

**Out of scope**: using the cache as a durable system of record (explicitly not its job here), complex data structures beyond simple key-value (some real caches like Redis support lists/sets/sorted sets, but the core distributed-systems problem is the same regardless, so this lesson keeps the value model simple).

## 9.2 Scale estimation

- **Traffic**: assume the primary datastore behind this cache serves 100,000 reads/sec at peak, and the cache is expected to absorb 90% of that (a typical target cache-hit ratio for a well-tuned system) → the cache itself must sustain roughly **90,000 reads/sec**, while only ~10,000 reads/sec fall through to the primary datastore — this 10x reduction in datastore load is the entire value proposition of the cache layer, worth stating explicitly.
- **Working set size**: assume the "hot" data that's worth caching is 10% of a 500 GB primary dataset → **~50 GB** of working set. This is the number that determines total cluster memory needed, not the full dataset size — caching everything would be wasteful and usually impossible given cost.
- **Node capacity**: if each cache node has 16 GB of usable RAM (leaving headroom for overhead), covering a 50 GB working set requires at least **~4 nodes** purely for capacity, though more are typically used to spread request load evenly and provide redundancy.
- **Per-node request rate**: spreading 90,000 reads/sec across, say, 8 nodes (more than the capacity-driven minimum, for load-spreading headroom) is about **11,250 reads/sec per node** — well within what an in-memory key-value engine handles on modern hardware, confirming the design challenge is distribution and hot-key handling, not raw per-node throughput.

The takeaway: the cache's value is proportional to its hit ratio, and hit ratio is driven by how well the "hot" working set (not the full dataset) fits in aggregate cluster memory — this is why eviction policy (9.5) directly determines effectiveness, not just an implementation detail.

## 9.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `GET /cache/{key}` | — | `200 OK { "value": "..." }` or `404 Not Found` (cache miss) |
| `PUT /cache/{key}` | `{ "value": "...", "ttlSeconds": 300 }` | `200 OK` |
| `DELETE /cache/{key}` | — | `200 OK` |

In practice this is usually a lightweight binary protocol (like Memcached's or Redis's own wire protocol) rather than HTTP/JSON, precisely because the latency requirement is so strict that HTTP's overhead matters — but the logical contract is the same regardless of wire format.

**Data model**

Same as the key-value store lesson: `(key, value, expiresAt)`, with an intentionally minimal schema — the cache doesn't care what the value represents (it could be a serialized database row, a rendered HTML fragment, a computed aggregate), it just stores and returns bytes keyed by a string. This is a pure key-value access pattern by definition, so there's no SQL-vs-NoSQL debate to have here at all — the whole point of a cache is O(1)-ish point lookups with no relational structure, and a relational database's overhead (query planning, transaction logging, disk I/O) would defeat the purpose of a cache whose entire value proposition is sub-millisecond, in-memory access.

## 9.4 High-level architecture

```text
Application Server
  -> Cache Client (embeds partitioning logic: which node owns this key?)
       -> Cache Node 1
       -> Cache Node 2
       -> Cache Node 3
       ... (in-memory key-value stores, no cross-node coordination for reads)

  (on cache miss)
       -> Primary Datastore -> populate cache -> return to caller
```

**Read path (cache-aside, the most common pattern)**: the application server first asks the cache for a key. On a hit, the value is returned directly from memory — fast, and the common case given the 90% target hit ratio. On a miss, the application reads from the primary datastore, then writes the result into the cache before returning it to the caller, so the next request for that key is a hit. Note that unlike the key-value store lesson, cache nodes typically do **not** replicate data to each other or coordinate on writes — each node independently owns a partition of the key space, and if a node's data is lost, it's simply a wave of cache misses (repopulated from the primary datastore), not a data-loss event. This is a deliberate simplicity trade-off, justified by the "acceptable data loss on failure" non-functional requirement.

**Write path (keeping cache and datastore in sync)**: when the underlying data changes (a write to the primary datastore), the cached copy needs to be dealt with — either updated or removed — which is the invalidation problem covered in the deep dive.

## 9.5 Deep dive: partitioning hot keys, eviction policies, and invalidation

**Partitioning, and the hot-key problem.** Like the key-value store, a distributed cache uses consistent hashing to decide which node owns which key, for the same reason: minimal data movement when nodes are added or removed. But caches have a hot-key problem more acutely than durable stores, because cache traffic skews heavily toward a small number of extremely popular keys (a trending product page, a viral post's metadata, a globally shared configuration value) — and because a cache node's entire value is serving requests fast, a single overloaded node directly degrades latency for everyone whose keys happen to land on it, even if the *average* load across the cluster looks fine.

Virtual nodes (as in the key-value store lesson) help smooth *average* distribution but don't fix a single key being disproportionately popular, since one key always hashes to the same place. The standard mitigations are:

- **Client-side local caching**: the application server keeps a very small, short-TTL local (in-process) cache for the hottest keys, so repeated requests for the same hot key from the same application server don't even reach the distributed cache tier. This trades a small amount of staleness for removing the hot key's traffic almost entirely from the network.
- **Key replication for hot keys**: instead of one node owning a hot key, the system detects it (via request-rate monitoring) and replicates that specific key across several nodes, with the client randomly picking one of the replicas per request — spreading what was concentrated load across multiple nodes.
- **Request coalescing**: if many requests for the same currently-missing key arrive at once (a "thundering herd" after a cache expiry or restart), only the first one is allowed to fetch from the primary datastore and repopulate the cache; the rest wait on that in-flight fetch rather than all hammering the primary datastore simultaneously with redundant work.

**Eviction policies.** Since memory is bounded (9.2) and the working set may not perfectly fit, the cache must decide what to discard when full. This is not a minor implementation detail — it's what determines the cache's actual hit ratio in practice, which directly determines how much load reaches the primary datastore.

| Policy | Rule | Trade-off |
| --- | --- | --- |
| LRU (Least Recently Used) | Evict the item that hasn't been accessed in the longest time | Good general-purpose default; cheap to approximate, adapts to changing access patterns |
| LFU (Least Frequently Used) | Evict the item with the fewest total accesses | Better for workloads with stable "always popular" items, but slow to adapt to new trends and needs more bookkeeping |
| TTL-based expiration | Evict items after a fixed time regardless of access pattern | Simple, predictable staleness bound; doesn't account for actual popularity, so it can evict hot items just as readily as cold ones |
| FIFO | Evict the oldest-inserted item | Simplest to implement, but ignores access patterns entirely — rarely a good primary policy on its own |

Most production caches (Redis, Memcached) default to an approximate LRU (exact LRU requires bookkeeping on every access, which adds overhead at high throughput, so most systems sample a small random subset of keys and evict the least-recently-used among the sample — a good approximation at a fraction of the cost). TTL is usually layered on top of whichever eviction policy is chosen, since it also serves the separate purpose of bounding staleness (covered next), not just bounding memory.

**Cache invalidation.** This is famously one of the two hard problems in computer science, and for good reason: once data is duplicated between a cache and a primary datastore, keeping them in agreement requires an explicit strategy, because there's no automatic mechanism connecting the two.

- **TTL expiration** is the simplest approach: every cached entry naturally expires after a set duration, after which the next read is a guaranteed miss that refetches fresh data. This bounds staleness predictably but means the cache can serve outdated data for up to the full TTL window after an underlying change — acceptable for data that doesn't need to be instantly fresh (e.g., a product description), less acceptable for data that does (e.g., an account balance).
- **Write-through invalidation**: when the application writes to the primary datastore, it also either updates or deletes the corresponding cache entry as part of the same write path. This keeps the cache more consistently fresh but adds latency and complexity to every write, and requires the write path to reliably reach the cache (if that step fails after the datastore write succeeds, the cache is left stale until TTL catches it — so this is a mitigation, not a hard guarantee, unless paired with a reliable event-based mechanism).
- **Event-driven invalidation**: the datastore emits a change event (e.g., via a change-data-capture stream or a message queue) whenever a row changes, and a separate consumer invalidates the corresponding cache key asynchronously. This decouples invalidation from the write's request path (so writes aren't slowed down waiting on cache updates) while still being much faster than relying on TTL alone, at the cost of needing that extra event pipeline as infrastructure.

In practice, most systems combine a moderate TTL (as a safety net bounding worst-case staleness) with write-through or event-driven invalidation (for freshness in the common case) — relying on either alone is usually either too slow to update (TTL only) or too fragile (invalidation only, with no backstop if an invalidation event is ever missed).

## 9.6 Bottlenecks and trade-offs

- **Single points of failure**: an individual cache node failing is, by design, not catastrophic — it causes a burst of misses for the keys it owned, which fall through to the primary datastore until the node (or its replacement) is repopulated. The real risk is a large fraction of the cluster failing simultaneously, which could send a traffic spike to the primary datastore large enough to overwhelm it — mitigated by client-side circuit breakers/rate limiting that protect the primary datastore even during a cache outage, and by keeping node failure domains small and independent.
- **Hot spots**: covered in depth above — the central operational challenge specific to caches, mitigated by local client-side caching, hot-key replication, and request coalescing.
- **Consistency vs. availability**: firmly favors availability and staleness tolerance — this is close to the defining characteristic of a cache. A design that insisted on strong consistency between cache and datastore on every read would defeat the entire purpose (it would need to check the datastore anyway).
- **What breaks first at 10x/100x scale**: at 10x traffic, more cache nodes handle it linearly assuming keys are reasonably well distributed. At 100x, the hot-key problem becomes the dominant constraint rather than aggregate cluster capacity — a handful of viral keys can bottleneck specific nodes even while the cluster overall has huge spare capacity, which is exactly why hot-key-specific mitigations (not just "add more nodes") become necessary rather than optional at that scale.

## 9.7 Summary

A distributed cache's design is shaped by one relaxed constraint compared to the key-value store lesson — losing cached data is a performance problem, not a correctness problem — which is what allows it to skip replication and cross-node coordination and focus entirely on speed. The genuinely hard problems that remain are handling hot keys under partitioning (via local caching, hot-key replication, and request coalescing), choosing an eviction policy that matches the workload (usually approximate LRU), and keeping the cache from silently drifting stale relative to the primary datastore (usually TTL plus write-through or event-driven invalidation).

Natural follow-ups: designing a multi-tier cache (a small, very fast local cache in front of the shared distributed cache) and handling cache warming after a large-scale node replacement or a full cluster restart, so the primary datastore isn't hit with a sudden flood of cold-cache traffic all at once.
