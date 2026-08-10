> **Learning goal**
> Understand what caching is and why it is one of the highest-leverage tools in system design, how the major caching strategies and eviction policies work, and how caching scales from a single process to a distributed system and all the way out to a CDN.

## 5.1 Overview

Almost every system you will ever design spends most of its life doing the same handful of expensive things over and over: fetching the same rows from a database, re-running the same computation, re-rendering the same page, or shipping the same video segment to a thousand different viewers. Caching is the general answer to "how do I stop paying that cost every single time?" It sits in front of something slow (a database, an API, a computation) and answers requests with a stored copy of the result whenever it safely can.

This module builds caching up in layers. First you'll learn what a cache is and why it matters (5.2). Then you'll learn the different *strategies* for keeping a cache and its source of truth in sync — because a cache is only useful if you also have a plan for when it goes stale (5.3). Then, because a cache is finite, you'll learn how it decides what to throw away when it's full (5.4). Then you'll scale a single cache into a *distributed* cache that spans many machines, which introduces its own coordination problems (5.5). Finally, you'll meet the CDN, which is really just "caching, but geographically distributed across the entire planet" (5.6). By the end, caching should feel like one continuous idea applied at increasing scale, not five separate topics.

## 5.2 Caching 101 — what it is and why it matters

A cache is a small, fast storage layer that keeps a copy of data that's expensive to produce, so future requests for that same data can be served quickly instead of redoing the expensive work. "Expensive" can mean slow (a network call to a database three data centers away), computationally heavy (rendering a report from millions of rows), or simply repeated so often that even a cheap operation adds up (a product page viewed a million times a day).

Think of it like keeping a glass of water on your desk instead of walking to the kitchen every time you're thirsty. The kitchen (your database) is the source of truth — it has everything, and it's always correct. But walking there every time is wasteful when you know you'll want water again in five minutes. The glass on your desk (the cache) is faster to reach precisely because it holds less and trusts that "probably still fine" is good enough most of the time.

Concretely, a cache is usually a key-value store: you ask for a key ("user:1234's profile," "GET /products/5567"), and you either get a **hit** (the cache has it, return it immediately) or a **miss** (the cache doesn't have it, so you fetch it from the real source, return it, and — usually — store a copy in the cache for next time). The **hit ratio** (hits divided by total requests) is the standard health metric for a cache: a cache with a 95% hit ratio is doing most of the work, while a cache with a 10% hit ratio is barely helping and might not be worth the complexity.

Caches show up at almost every layer of a real system, not just as a single "Redis box." Your browser caches images and scripts so a page doesn't re-download them on every visit. A CDN caches static assets close to users. An application server might keep a local in-memory cache of config values. A dedicated caching layer (Redis, Memcached) sits between your app and your database. Even your database has its own internal buffer cache for recently-read pages of data. Each layer exists for the same reason: skip work you've already done.

Why does this matter so much in system design? Two reasons, and they compound. First, **latency**: reading from memory is on the order of 100x-1000x faster than a network round trip to a disk-backed database, so a cache hit can turn a 50ms response into a 1ms response. Second, **load**: every request served from cache is a request your database never sees, which means a database sized for 10% of your traffic (the "miss" traffic) can support 10x more total users than one that sees every request directly. This is why caching is usually one of the first things added to a system that's starting to strain under load — it's a cheap, high-impact lever compared to re-architecting the database.

The catch, and the reason the rest of this module exists, is that a cache is a *copy*, and copies can become wrong. The moment the real data changes, your cached copy is stale until something updates or removes it. Deciding when to cache, what to cache, and how to keep it honest is the actual skill — not just "add Redis."

## 5.3 Caching Strategies (cache-aside, write-through, write-behind, and friends)

If caching were only about reads, it would be simple: check the cache, and on a miss, go fetch and store. The hard part is writes — what happens to the cache when the underlying data changes? Different strategies answer this differently, and the right choice depends on how tolerant your system is of stale reads versus how much write latency and complexity you're willing to accept.

**Cache-aside (a.k.a. lazy loading).** This is the most common pattern and the one most people mean when they say "we added a cache." The application owns the logic: on a read, check the cache; on a miss, read from the database, then write the result into the cache; on a write, update the database and simply *delete* (or expire) the cached entry rather than trying to update it in place. The next read will repopulate the cache with fresh data. This is simple and resilient — if the cache goes down entirely, the app still works, just slower, straight against the database. The downside is a small window where a very fast read racing a write could see stale data, and every cache miss pays the full database latency.

```text
Read:  App -> Cache (miss) -> DB -> App writes result back to Cache -> return to caller
Write: App -> DB (update) -> App deletes cache key
```

**Read-through.** Very similar to cache-aside, except the cache library/service itself knows how to load from the database on a miss, rather than the application containing that logic. This centralizes the loading logic if many different services share the same cache, at the cost of coupling the cache to your data source.

**Write-through.** Every write goes to the cache first, and the cache synchronously writes it to the database before confirming success back to the caller. This keeps the cache always fresh — a read right after a write will never see stale data — but every write now pays both the cache-write cost and the database-write cost, making writes slower.

**Write-around.** Writes go straight to the database, completely bypassing the cache. The cache only gets populated later, on a subsequent read (like cache-aside's read path). This is great for data that's written often but rarely re-read soon after (e.g., logging events), because it avoids filling the cache with data nobody's about to ask for. The trade-off is that the very first read after a write is always a slow miss.

**Write-behind (write-back).** Writes go to the cache immediately and are confirmed to the caller right away; the cache asynchronously flushes the write to the database later, often batched with other writes. This makes writes extremely fast and can reduce database load by coalescing many small writes into fewer, larger ones. The serious risk is durability: if the cache crashes before the async flush happens, that write is gone forever unless you've backed it with something durable, like a write-ahead log. This pattern is common in systems that can tolerate a small risk of data loss in exchange for very high write throughput (e.g., view counters, analytics).

| Strategy | Read freshness | Write speed | Risk if cache fails |
| --- | --- | --- | --- |
| Cache-aside | Slightly stale possible | Normal (DB write + cache delete) | Low — falls back to DB |
| Write-through | Always fresh | Slower (writes both) | Low |
| Write-around | Stale until re-read | Normal | Low |
| Write-behind | Fresh in cache | Very fast | High — possible data loss |

In practice, most real systems use cache-aside for general-purpose data and reach for write-through or write-behind only for specific hot paths where the trade-off is clearly worth it. There's no single "correct" strategy — the question to always ask is: *what happens if this cached value is wrong for the next N seconds, and can my system tolerate that?*

## 5.4 Cache Eviction Policies

A cache is, almost by definition, smaller than the data it's a copy of — that's what makes it fast. So once it fills up, adding a new entry means something else has to leave. The rule that decides what leaves is the **eviction policy**, and picking the right one has a real, measurable effect on your hit ratio.

**Least Recently Used (LRU)** evicts whatever hasn't been touched in the longest time, on the assumption that data used recently is likely to be used again soon (this is called "temporal locality," and it holds true for a surprising amount of real-world traffic — think of a trending news article or a popular product). LRU is usually implemented with a doubly linked list plus a hash map: the hash map gives O(1) lookup, and the linked list lets you instantly move an accessed item to the "most recent" end and evict from the "least recent" end. LRU is the default choice for most general-purpose caches (Redis supports it natively) because it's a good balance of effectiveness and implementation simplicity.

**Least Frequently Used (LFU)** evicts whatever has been accessed the fewest times overall, rather than looking at recency. This protects consistently popular items from being evicted just because they weren't touched in the last minute, but it requires maintaining a counter per item and deciding how to break ties, and it can be slow to "forget" an item that was popular last month but is irrelevant now (some implementations decay counts over time to fix this).

**First In, First Out (FIFO)** evicts whatever was added earliest, regardless of how often or recently it's been used. It's the simplest to implement (just a queue) but ignores actual usage patterns entirely, so it can evict something that's about to be requested again purely because it happened to arrive first.

**Random Replacement (RR)** evicts a random item. It sounds naive, but it's cheap to compute and, surprisingly, performs reasonably well on workloads with no strong access pattern — there's no bookkeeping overhead at all.

**Time to Live (TTL)** isn't really about *which* item to evict when full — it's a complementary rule that expires an item automatically after a fixed duration regardless of how popular it is. TTL is less about managing space and more about bounding staleness: it guarantees that no cached value survives longer than, say, 60 seconds, which caps how wrong a stale read can ever be.

A simple worked example: imagine a cache that holds 3 items, using LRU, and requests arrive in this order: A, B, C, A, D.

```text
Access A -> cache: [A]
Access B -> cache: [A, B]
Access C -> cache: [A, B, C]   (full)
Access A -> cache: [B, C, A]   (A is now "most recent")
Access D -> cache full, evict B (least recently used) -> cache: [C, A, D]
```

Notice B gets evicted, not A — even though A arrived first — because LRU tracks recency of *access*, not insertion order. If this had been FIFO instead, A would have been evicted on the D request, since A was the oldest arrival, even though it was just re-accessed.

The practical takeaway: LRU is a safe general default, LFU is worth it when some items are durably "hot" over long periods, FIFO/RR are fine when access patterns are unpredictable and simplicity matters more than a few percentage points of hit ratio, and TTL should almost always be present as a safety net regardless of which of the others you pick, so stale data can never live forever.

## 5.5 Distributed Caching

Everything so far assumed one cache living on one machine. That works fine until either the data no longer fits in one machine's memory, or the traffic hitting the cache is more than one machine can handle. At that point you need a **distributed cache**: the same key-value idea, spread across many machines (nodes) that together act like one logical cache.

The first problem distributed caching has to solve is: *given a key, which node holds it?* The naive approach — `node = hash(key) % number_of_nodes` — has a nasty failure mode: if you add or remove a single node, `number_of_nodes` changes, which reshuffles almost every key to a different node, causing a massive wave of cache misses right when you can least afford it (you were probably scaling *because* of load). The standard fix is **consistent hashing**: nodes and keys are placed on a conceptual ring (a hash space that wraps around), and a key belongs to the next node clockwise from it on the ring. Adding or removing one node only reshuffles the keys between that node and its neighbor — a small, bounded fraction of the total, not everything.

```text
Hash ring (simplified):
        Node A
       /      \
  Node D        Node B
       \      /
        Node C

key "user:42" hashes to a point between Node C and Node A
  -> stored on Node A (the next node clockwise)
```

The second problem is fault tolerance: if a node goes down, do you lose everything it held? Most distributed caches address this with **replication** — each key's data is also copied to one or more neighboring nodes, so a single node failure doesn't wipe out that slice of the cache; a replica takes over. This is the same idea as database replication, applied to cache data.

The third problem is consistency: when the underlying data changes, how do you make sure every node (and every layer of cache, including any local in-process caches sitting in front of the distributed one) learns about it? Common answers are: short TTLs so staleness self-heals, explicit invalidation messages broadcast to all nodes on write (via pub/sub, covered in the next module), or simply accepting eventual consistency because the application can tolerate a few seconds of staleness. There's rarely a free lunch here — stronger consistency generally costs more coordination and latency.

A distinct but related failure mode worth knowing: the **cache stampede** (or "thundering herd"). If a very hot key expires and a thousand requests arrive in the same instant, all thousand can miss simultaneously and all hammer the database at once trying to refill the same key. Mitigations include having only one request recompute the value while others wait (a lock or "singleflight" pattern), staggering TTLs slightly (jitter) so keys don't all expire at the exact same moment, and pre-warming known-hot keys before they expire.

Popular real-world tools here are Redis and Memcached, often run as a cluster of nodes with client libraries or a proxy layer handling the consistent-hashing routing for you. The important system-design lesson isn't memorizing a specific tool, though — it's recognizing that "just add a cache" stops being a one-line answer once the cache itself has to survive node failures and traffic at scale.

## 5.6 Content Delivery Network (CDN)

A CDN is best understood as a distributed cache that's been stretched across the entire planet, specifically to solve a problem that's fundamentally about physics rather than computation: the speed of light. If your server is in Virginia and a user is in Singapore, no amount of clever code makes that round trip fast — every request has to physically cross that distance. A CDN's answer is to keep copies of your content on servers ("edge servers" or "points of presence") scattered around the world, so users are served by whichever copy is geographically nearest to them instead of the original ("origin") server.

Here's the flow for a typical request to a CDN-fronted site: the user's DNS lookup resolves not to your origin server, but to a nearby CDN edge location (CDN providers manipulate DNS or use Anycast routing to make this automatic). The edge server checks whether it already has a cached copy of the requested resource:

```text
User (Singapore) -> nearest CDN edge (Singapore)
                        |
                 cache hit? -----> yes -> return cached copy (fast, no trip to origin)
                        |
                        no
                        v
              edge fetches from origin (Virginia) -> caches it -> returns to user
```

The second request from any other nearby user for the same resource is now a hit, served entirely from Singapore with no trip back to Virginia at all.

There are two broad models for how content ends up on the edge. In the **pull model**, edges start empty and populate themselves on demand, exactly like the flow above — this is the more common approach today because it requires no extra work when you add new content; the CDN just caches whatever gets requested. In the **push model**, you proactively upload content to the CDN ahead of time, which suits content you know will be popular immediately (like a movie release), where you don't want to wait for an organic first cache miss.

CDNs decide what's still valid the same way any cache does: through freshness rules. HTTP headers like `Cache-Control: max-age=3600` tell the edge how long it can serve a cached copy before treating it as stale and re-checking the origin. A common trick for content that changes (like a JS bundle after a deploy) is **cache-busting**: change the file's URL (e.g., append a version hash, `app.a3f9c1.js`) whenever the content changes, so you can set an extremely long TTL — the old URL simply stops being referenced, and the new URL is a guaranteed cache miss that fetches fresh content.

Beyond raw speed, CDNs bring a few other benefits that make them a near-default choice for any public-facing web product: they absorb huge traffic spikes and DDoS attempts before that traffic ever reaches your origin (since it's spread across hundreds of edge locations rather than concentrated on one server), and many providers bundle in security features like web application firewalls and bot filtering at the edge.

The main gotcha to remember: a CDN is only a good fit for content that's either static (images, video, JS/CSS bundles, downloadable files) or safely cacheable for short periods (some API responses). Highly personalized, constantly-changing data (your live account balance) generally shouldn't be cached at the edge at all, or only cached for a very short, carefully considered TTL — the same staleness-versus-speed trade-off from cache-aside earlier in this module, just now playing out at global scale.

## 5.7 Summary and how these connect

Every topic in this module is the same idea, applied at increasing scope. Caching 101 established the core trade-off: trade a little staleness risk for a lot of speed and reduced load. Caching strategies (cache-aside, write-through, write-behind, write-around) are really just different answers to "how stale can this get, and who pays the cost of keeping it fresh?" Eviction policies answer the follow-up question every cache eventually faces once it's full: "given limited space, what do I keep?" Distributed caching takes a single-node cache and scales it out, which introduces the need for consistent hashing (so scaling doesn't cause a mass cache-miss event) and replication (so a single node failing doesn't lose data). And a CDN is the same distributed-cache idea taken to its geographic extreme, using edge locations instead of nodes in one data center, solving for network latency instead of just database load.

The reason this module comes early in the course is that caching interacts with almost everything else you'll learn later. When you get to asynchronous communication in the next module, you'll see cache invalidation triggered by events flowing through a message queue or pub/sub system instead of happening inline in application code. And when you get to architectural patterns, you'll see that where a cache lives — embedded in a monolith, as a shared service between microservices, or invoked from a serverless function — is itself an architectural decision with real consequences. Caching isn't a topic you learn once and set aside; it's a lens you'll keep applying for the rest of this course.
