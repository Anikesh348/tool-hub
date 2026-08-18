> **Learning goal**
> Design a URL shortener like TinyURL end to end, and be able to explain the trade-offs between counter-based, hash-based, and pre-generated approaches to generating unique short codes under concurrent writes.

## 2.1 Requirements and scope

**Functional requirements**

- Given a long URL, generate a short URL (e.g., `https://tiny.ly/aB3xQ`).
- Given a short URL, redirect the client to the original long URL.
- Optionally let a user pick a custom alias instead of an auto-generated code.
- Optionally support link expiration (e.g., a link stops working after 90 days).

**Non-functional requirements**

- **High availability**: redirects are on the critical path of someone else's product (a link in an email, a tweet, an ad) — downtime is highly visible and embarrassing, so availability matters more than strict consistency.
- **Low latency**: a redirect should feel instant, ideally single-digit milliseconds after the first cache warm-up.
- **Uniqueness**: two different long URLs must never resolve from the same short code.
- **Read-heavy**: far more people click links than create them, so the system must be optimized for reads.
- Short codes should be unguessable-ish (not sequential integers exposed directly) but this is not a strict security requirement — full unguessability is out of scope.

**Out of scope**: analytics dashboards (click counts, geo breakdown), user accounts and link management UI, spam/malware URL scanning. These are real product features but not needed to demonstrate the core design.

## 2.2 Scale estimation

Assume a moderately popular consumer service, stating round numbers explicitly:

- **Writes (URL creation)**: 1 million new short URLs created per day → 1,000,000 / 86,400 ≈ **12 writes/sec** average.
- **Reads (redirects)**: read:write ratio of roughly 100:1 is typical for link shorteners (a link gets clicked many times after being created) → 100 million redirects/day ≈ **1,150 reads/sec** average, with peaks 2-3x that during viral spikes, so design for roughly **3,000 reads/sec peak**.
- **Storage per record**: short code (7 bytes) + long URL (avg ~200 bytes) + metadata (creation date, expiry, owner id — say 50 bytes) ≈ **~260 bytes/record**. At 1 million new links/day, that's 260 MB/day, or roughly **95 GB/year**. Even over 5 years this is well under 1 TB — small enough that storage volume is not the driver of the architecture; read throughput is.
- **Bandwidth**: redirects return a small HTTP 301/302 response, a few hundred bytes each. At 3,000 reads/sec that is under 1 MB/sec — trivial.
- **Cache sizing**: if the top 20% of links account for 80% of clicks (a reasonable long-tail assumption), caching the hottest few hundred thousand mappings in memory (each mapping is tiny, well under 1 KB) covers the majority of read traffic from RAM rather than disk.

The takeaway: this system is read-heavy and latency-sensitive, but small in absolute data volume — so the design should spend its effort on fast, highly available reads and on generating unique codes cheaply, not on sharding a huge dataset.

## 2.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /api/urls` | `{ "longUrl": "https://...", "customAlias": "optional", "expiresAt": "optional" }` | `{ "shortUrl": "https://tiny.ly/aB3xQ" }` |
| `GET /{shortCode}` | — | `302 Found` with `Location: <longUrl>` header |
| `DELETE /api/urls/{shortCode}` | (auth'd) | `204 No Content` |

`GET` is deliberately a redirect at the HTTP level, not a JSON API, because the whole point is that a browser following a link should just work without any client-side logic.

**Data model**

Core entity: `UrlMapping { shortCode (PK), longUrl, createdAt, expiresAt, ownerId (nullable) }`.

This is about as simple as a data model gets: one entity, looked up by a single key, no relationships that need joins, no multi-record transactions. That access pattern — point lookups by primary key at high volume — is exactly what a key-value store is built for, so a NoSQL key-value store (e.g., DynamoDB, Cassandra, or even a simple Redis-backed store with async persistence) is a better fit than a relational database here. A relational database (e.g., Postgres) also works fine at this scale and is a perfectly defensible choice too — the point to make in an interview is *why* it fits (simple schema, no joins), not that SQL is wrong. The main argument for NoSQL is operational: key-value stores scale horizontally by key with less operational effort than sharding a relational database, which matters once you're past hundreds of millions of rows even though we aren't there yet at our estimated scale.

## 2.4 High-level architecture

```text
Client
  -> Load Balancer
       -> Write path: URL Shortener Service -> Code Generator -> Datastore
       -> Read path:  Redirect Service -> Cache (hot mappings) -> Datastore (on miss)
```

**Write path**: a client POSTs a long URL. The URL Shortener Service asks the Code Generator for a unique short code (details in the deep dive below), writes `{shortCode -> longUrl}` to the datastore, and returns the full short URL to the client. This path is low volume (~12/sec) so it does not need heavy optimization — correctness and uniqueness matter more than raw throughput here.

**Read path**: a client hits `GET /{shortCode}`. The Redirect Service first checks a cache (Redis or a similar in-memory store) for the mapping. On a cache hit, it immediately returns a 302 redirect — this is the common case given the read-heavy, long-tail traffic pattern from Stage 2.2. On a cache miss, it reads from the datastore, returns the redirect, and populates the cache for next time (cache-aside pattern). Because reads vastly outnumber writes and the dataset of "hot" links is small relative to total storage, this cache absorbs the large majority of traffic, keeping datastore load low even at peak.

Both services are stateless and horizontally scaled behind the load balancer, so adding capacity for either path is just adding more instances.

## 2.5 Deep dive: generating unique short codes under concurrent writes

This is the one genuinely interesting problem in this design: many clients may be creating short URLs at the same moment, and two of them must never be handed the same short code. There are three common strategies, each with a real trade-off.

**Option A — Counter + base62 encoding.** Maintain a single global counter (e.g., 7000000001, 7000000002, ...) and encode each value in base62 (a-z, A-Z, 0-9) to produce a compact code like `aB3xQ`. Base62 is chosen because it's URL-safe and dense: 7 base62 characters can represent 62^7 ≈ 3.5 trillion distinct codes, comfortably covering years of growth at our estimated write rate. The catch is the counter itself: if it lives in a single relational row that every write increments, that row becomes a serialization point and a single point of failure under concurrent writes. The standard fix is to hand out counter *ranges* rather than individual values — each application server asks a lightweight coordination service (or just a dedicated small database) for a block of, say, 1,000 counter values at a time, then hands out codes from that block locally without contacting anything else until the block is exhausted. This turns a global bottleneck into an occasional, cheap network call, and even if a server crashes with unused values in its block, those values are simply never reused, which is a harmless waste at this scale.

**Option B — Hash the long URL.** Run the long URL through a hash function (e.g., MD5 or SHA-256) and take the first 7 characters of a base62-encoded version of the hash. This needs no shared counter at all, so it parallelizes trivially — great for write throughput. The problem is collisions: two different long URLs can hash to the same short prefix (a near-certainty eventually, given the birthday paradox at high volume), and identical long URLs submitted twice would deterministically collide too, which is arguably fine (same URL, same short code) but needs a defined policy. When a collision is detected on insert (e.g., a conditional write fails because the short code already maps to a *different* long URL), the standard fix is to append a small salt and re-hash, retrying a few times. This adds latency variance under collision but keeps the system fully stateless and horizontally parallel.

**Option C — Pre-generated code pool.** A background job continuously generates random unique codes ahead of time and stores them in a "available codes" table. When a write comes in, the service atomically claims one available code (e.g., `DELETE ... RETURNING code LIMIT 1` in a relational database) and assigns it. This guarantees uniqueness by construction (a code is never handed out twice because claiming it removes it from the pool) and avoids both the counter bottleneck and hash collisions. The cost is operational complexity: a background refill job must keep the pool from running dry, and the pool itself needs to be stored and replenished at a rate that matches write throughput.

| Approach | Uniqueness guarantee | Write scalability | Operational cost |
| --- | --- | --- | --- |
| Counter + base62 (ranged) | Strong (no two ranges overlap) | High once ranges are pre-allocated | Low — one small coordination service |
| Hash of URL | Probabilistic, needs collision retry | High, fully parallel | Low, but retry logic adds tail latency |
| Pre-generated pool | Strong (claim-and-remove) | High | Medium — needs a refill job |

Given our write rate of ~12/sec — nowhere near contention territory — any of the three works. The ranged-counter approach is a common default answer because it produces short, dense, sequential-feeling codes without a real bottleneck once ranges are batched, and it avoids the hash approach's retry-on-collision tail latency.

## 2.6 Bottlenecks and trade-offs

- **Single points of failure**: a naive single-counter design is the classic SPOF for this system; the ranged-allocation fix above removes it. The cache layer, if used as a single instance, is another SPOF for read latency (not correctness, since the datastore is still the source of truth) — mitigated by running it as a replicated cluster.
- **Hot spots**: a single link going viral (posted somewhere with massive reach) can dominate read traffic to one cache key. Because the cache node holding that key can become a hot spot even in a sharded cache cluster, a common mitigation is to detect very-hot keys and replicate them across multiple cache nodes, or apply a short local (in-process) cache in front of the shared cache for the very hottest items.
- **Consistency vs. availability**: this system deliberately favors availability. If the cache briefly serves a slightly stale mapping (e.g., right after an edit to a custom alias), that's an acceptable trade for never failing a redirect. Writes need stronger consistency only for the uniqueness check itself.
- **What breaks first at 10x/100x scale**: at 10x (120 writes/sec, 30,000 reads/sec) the design holds with more cache and app-server instances. At 100x, the single relational counter (if still used unranged) and a single-node datastore would both become real bottlenecks — this is where the counter-range size would need to grow and the datastore would need to move from a single node to a horizontally partitioned key-value store, sharded by short code (a well-distributed key by construction, since base62/hash outputs are effectively random).

## 2.7 Summary

A URL shortener is deceptively simple on the surface but turns on one hard problem: generating unique short codes cheaply under concurrent writes, which we solved with ranged counter allocation (with hashing and pre-generated pools as valid alternatives, each trading off differently between contention, collision handling, and operational overhead). The rest of the design — a stateless redirect service backed by a cache in front of a key-value store — follows directly from the read-heavy, latency-sensitive, small-data-volume profile established in the scale estimation.

Natural follow-ups an interviewer might raise: adding click analytics (which would push toward an async event pipeline so it doesn't slow down the redirect path) and rate-limiting URL creation per user to prevent abuse of the code-generation pool.
