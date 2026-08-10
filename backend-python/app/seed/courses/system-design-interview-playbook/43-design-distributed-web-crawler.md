> **Learning goal**
> Design a distributed web crawler that can traverse a large fraction of the web, and be able to explain how the URL frontier is managed with per-domain politeness, how duplicate URLs and near-duplicate content are detected at scale, and how crawl work is partitioned across many workers without overlap.

## 43.1 Requirements and scope

**Functional requirements**

- Given a set of seed URLs, the crawler fetches each page, extracts outbound links, and adds new, not-yet-seen URLs to a queue of pages to crawl.
- The crawler respects each site's `robots.txt` rules and does not overwhelm any single site with too many concurrent requests (politeness).
- Fetched page content is stored (for downstream use, e.g., indexing — out of scope here) and de-duplicated so near-identical content isn't processed redundantly.
- The crawl can run continuously, re-visiting previously crawled pages periodically to catch updates, not just crawling once.

**Non-functional requirements**

- **Scale and throughput**: the crawler needs to process an enormous number of URLs — billions over the life of a crawl — which is fundamentally a distributed, parallel-workers problem, not something one machine can do in a reasonable time frame.
- **Politeness is a hard constraint, not an optimization**: hammering a single web server with many concurrent requests can be indistinguishable from a denial-of-service attack and can get the crawler's IP ranges blocked entirely — this shapes the architecture as much as raw throughput does.
- **No wasted work**: the same URL should not be fetched repeatedly by different workers in short succession, and pages with effectively identical content (mirrors, tracking-parameter variants of the same URL) shouldn't be reprocessed as if they were new.
- **Resilience**: individual worker failures, unreachable sites, and malformed pages are the norm at this scale, not exceptions — the system must continue making progress despite constant partial failure.
- **Eventual, not strict, freshness**: it's fine for a crawled copy of a page to be somewhat stale (hours to days, depending on the page's typical change rate) — this is not a real-time system.

**Out of scope**: the search indexing/ranking pipeline that consumes crawled content, JavaScript-rendering of dynamic single-page-application content (assume mostly static HTML crawling for this lesson), and detecting/handling malicious content (spam, malware pages).

## 43.2 Scale estimation

Stated, round assumptions:

- **Target crawl size**: assume a goal of crawling 10 billion URLs to maintain a broad, reasonably fresh web index.
- **Recrawl rate**: assume the crawler needs to refresh its corpus roughly every 30 days on average (some pages change far more often, some far less — 30 days is a reasonable blended target for this estimate) → 10,000,000,000 / (30 × 86,400) ≈ **~3,900 pages fetched/sec** average, sustained continuously.
- **Peak/practical throughput**: real crawl systems run with meaningful headroom above the bare average to absorb backlog from slow/unresponsive sites and to allow for periodic re-prioritization — design for on the order of **10,000+ fetches/sec** of actual worker capacity.
- **Per-page size**: an average HTML page (after basic compression) is roughly 50-100 KB → at ~4,000 fetches/sec average, that's roughly **200-400 MB/sec of ingress bandwidth**, and cumulatively, 10 billion pages × ~75 KB ≈ **~750 TB** of raw crawled content at any given snapshot — large, but a conventional large-scale blob storage problem (comparable in shape to the distributed-cloud-storage lesson), not itself the interesting part of this design.
- **URL frontier size**: the set of "known, not-yet-crawled" URLs grows enormously — a crawl surfacing on the order of tens of outbound links per page, many overlapping across pages, means the frontier (after deduplication) can itself reach into the billions of pending entries at any given time, far too large to hold as an in-memory queue on a single machine.
- **Per-domain concentration**: crucially, this billions-of-URLs frontier is not evenly distributed across domains — a small number of very large sites (social platforms, major news sites, large e-commerce catalogs) contribute a hugely disproportionate share of total URLs, which is the specific fact that makes per-domain politeness a genuinely hard scheduling problem rather than a minor detail (Section 43.5).

The dominant insight: this is a **massive, sustained, highly parallel fetch workload with a scheduling constraint (politeness) that cuts directly against naive full parallelism** — the crawler has effectively unlimited raw work available (billions of URLs) but must artificially throttle how fast it drains any single domain's share of that work, which is the central design tension this lesson resolves.

## 43.3 API and data model

A crawler is largely an internal batch/streaming system rather than a request/response API serving external clients, but its internal components still have clear contracts:

| Component interface | Input | Output |
| --- | --- | --- |
| Frontier `dequeue(workerId)` | Worker requesting next batch of URLs to crawl | A batch of URLs, pre-filtered to respect per-domain rate limits |
| Fetcher `fetch(url)` | URL | Raw page content + HTTP metadata (status, headers) or failure |
| Extractor `extract(pageContent)` | Raw page content | List of outbound URLs + normalized/canonicalized content for dedup |
| Frontier `enqueue(urls)` | New candidate URLs discovered during extraction | (adds to frontier, after dedup check) |
| `GET /crawl-status/{domain}` (internal ops API) | — | Crawl progress/health for a given domain, for operational visibility |

**Data model**

Core entities:

- `UrlFrontierEntry { url, domain, priority, discoveredAt, lastAttempt }` — the queue of pending work, partitioned by domain.
- `SeenUrl { urlHash (PK) }` — a record of every URL ever enqueued, used purely to prevent re-adding a URL that's already known (Section 43.5 covers this at scale).
- `ContentFingerprint { hash (PK), firstSeenUrl, canonicalUrl }` — used to detect near-duplicate content across different URLs.
- `CrawledPage { url, contentLocation (pointer into blob storage), lastCrawled, contentHash }`

The frontier's access pattern — pull the next batch of work respecting a per-domain rate constraint, insert large volumes of newly discovered URLs — doesn't map cleanly onto either a plain relational table or a simple key-value store on its own; it's better modeled as **per-domain queues** (conceptually many independent FIFO-ish queues, one per domain or domain-shard, sitting behind a scheduler that decides which queue is allowed to be drained right now) — a message-queue-like structure, partitioned by domain, rather than one global table. The `SeenUrl` deduplication check, by contrast, is a pure existence check by hash — an extremely strong fit for a key-value store (or, as covered below, a probabilistic structure), since the only question ever asked is "have I seen this exact key before," at enormous scale and volume, with no need for range queries or relational structure.

## 43.4 High-level architecture

```text
Seed URLs
   -> URL Frontier (per-domain queues + priority/politeness scheduler)
        -> Worker Pool (many parallel fetch workers, pulling domain-rate-limited batches)
             -> Fetcher (HTTP fetch, respecting robots.txt)
                  -> Deduplication Check (URL-seen? content-hash-seen?)
                       -> [new] -> Content Store (blob storage) + Link Extractor
                                       -> new URLs -> back into URL Frontier
                       -> [duplicate] -> discard / just record last-seen timestamp
```

**Crawl loop**: workers continuously pull batches of URLs from the frontier — critically, the frontier's scheduler, not the worker, decides which domains are eligible to be drained right now, enforcing politeness centrally rather than trusting each independent worker to self-limit (Section 43.5 covers why centralizing this matters). A worker fetches each URL, checks robots.txt rules for that domain (typically cached per-domain rather than re-fetched on every single request), and on success passes the content through deduplication checks before storing it and extracting outbound links. Newly discovered links that pass the "have we seen this URL before" check are added back to the frontier, which is what keeps the crawl expanding outward from the original seed set.

**Feedback loop / continuous operation**: because the frontier is never truly empty at this scale (new links are constantly discovered, and previously-crawled pages become eligible for recrawl after their freshness window elapses), the system runs as a continuous loop rather than a single batch job with a defined end — recrawl candidates are simply re-enqueued into the frontier with a priority reflecting how overdue they are, competing for worker time alongside brand-new URLs.

## 43.5 Deep dive: frontier management with politeness, duplicate detection at scale, and work partitioning

### The URL frontier and per-domain politeness

The central tension identified in Stage 2: total available work (billions of URLs) vastly exceeds what any single domain should be hit with concurrently, and a naive global work queue (just a big FIFO of "URLs to crawl") completely ignores this — if a large site happens to have contributed a huge share of currently-queued URLs, a naive scheduler pulling "whatever's next" could end up sending a burst of simultaneous requests at that one site from many parallel workers at once, exactly the outcome politeness rules exist to prevent.

The standard solution is to structure the frontier as **many independent per-domain queues**, with a **front-end scheduler** deciding which domain-queues are currently eligible to be drained, based on a politeness policy (e.g., "no more than 1 request every 2 seconds to this domain," possibly informed by that domain's own `robots.txt` crawl-delay directive if present, or a conservative platform-wide default otherwise). Concretely: workers don't pull raw URLs from one shared pool; they ask the scheduler for "give me a batch of URLs I'm currently allowed to fetch," and the scheduler only returns URLs from domains that are not currently rate-limited, tracking each domain's last-fetch timestamp to decide eligibility. This decouples *how much total work exists* for a domain (which can be enormous for a large site) from *how fast that domain's work is actually drained* (which is deliberately capped, regardless of worker capacity).

A useful mental model: this is directly analogous to a token-bucket rate limiter, but with one independent bucket per domain rather than one global bucket — a concept already familiar from the rate-limiting fundamentals in this course, just applied per-partition-key (domain) instead of per-client. Domains with huge queues simply take proportionally longer to fully drain, which is the correct and intended behavior, not a flaw.

**Priority within a domain's queue** also matters beyond pure politeness: not every URL is equally worth crawling first — a domain's homepage or a page with many inbound links is generally more valuable to crawl (or recrawl) sooner than a deeply nested, rarely-linked page, so the frontier typically orders each domain's queue by a priority score (informed by link count/depth, historical change frequency, or other signals) rather than pure FIFO discovery order.

### Duplicate URL and near-duplicate content detection at scale

Two related but distinct problems exist here, and conflating them is a common mistake:

**Exact URL deduplication.** Before a discovered URL is even added to the frontier, the system needs to check "have I already enqueued or crawled this exact URL?" — at the scale of tens of billions of URL-discovery events (many pages link to the same popular targets repeatedly), a naive check against a full `SeenUrl` table for every single discovered link would be an enormous number of point lookups. Two standard techniques address this: **URL normalization** first (stripping tracking parameters, resolving relative paths, lowercasing the host, sorting query parameters) so that trivially different-looking URLs that are actually the same resource collapse to one canonical form before the check even happens — this alone eliminates a large fraction of what would otherwise look like "new" URLs; and a **Bloom filter** (a compact, probabilistic structure that can definitively say "definitely not seen" or "probably seen," never a false negative but occasionally a false positive) sitting in front of the authoritative `SeenUrl` store, so the overwhelming majority of true-negative checks (a genuinely new URL) are resolved cheaply in memory without touching the full-scale backing store at all, and only the smaller set of probable-positives needs a confirming lookup.

**Near-duplicate content detection.** A subtler problem: two different URLs (a canonical article URL and a syndicated mirror on another domain, or a page with meaningless URL parameter variations) can serve effectively identical or near-identical content, which is wasteful to store and process twice even though the *URLs* themselves are legitimately distinct. This can't be solved by URL comparison at all — it requires comparing content. Hashing the raw page content exactly (an exact content hash) catches perfect duplicates, but real near-duplicates typically differ in small ways (a timestamp in a footer, a slightly different ad slot, a tracking pixel) that would produce a completely different exact hash despite being "the same page" for practical purposes. The standard technique is **similarity hashing** (such as SimHash or MinHash) — algorithms that produce a fingerprint designed so that similar content produces similar (not necessarily identical) fingerprints, unlike a cryptographic hash where a one-character change produces a completely unrelated output. Comparing fingerprints (e.g., via Hamming distance for SimHash) lets the system flag "this content is highly similar to something already crawled" even when the two aren't byte-for-byte identical, and route near-duplicates to a lighter-weight handling path (record the mapping, don't fully reprocess) rather than treating them as entirely new content.

| Problem | What's being compared | Technique | Why exact hashing alone doesn't work |
| --- | --- | --- | --- |
| Exact URL dedup | URL strings | Normalization + Bloom filter + backing key-value store | N/A — exact match is the correct check here |
| Near-duplicate content | Page content/bytes | Similarity hashing (SimHash/MinHash) | Minor content differences (timestamps, ads) produce completely different exact hashes despite being "the same page" |

### Partitioning crawl work across many workers without overlap

With billions of URLs and thousands of parallel workers, the system needs a clean way to divide work so that no two workers redundantly fetch the same URL at the same time, and so that the per-domain politeness scheduling described above can actually be enforced (which requires *someone* to have an authoritative, current view of "when was this domain last fetched," which breaks down if that state is scattered inconsistently across independent workers).

The natural partitioning key is the **domain** itself (or a hash of the domain) — assigning responsibility for a given domain's queue and rate-limit state to one specific partition/shard, similar in spirit to consistent hashing assigning a key range to a specific node. This has two direct benefits: it makes politeness enforcement straightforward (one shard owns the authoritative "last fetched at" state for a domain, so there's no cross-shard race to reason about for that domain's rate limit), and it naturally avoids double-fetching (since only workers pulling from that domain's specific partition ever see that domain's URLs at all — a worker simply cannot accidentally pull a URL for a domain it doesn't own). This does mean a single very large domain's crawl throughput is bounded by whatever politeness policy applies to it, not by how many total workers the system has — which is the correct, intended trade given the hard non-functional requirement that politeness takes priority over raw throughput for any single site.

## 43.6 Bottlenecks and trade-offs

- **Single points of failure**: a single, non-partitioned frontier scheduler would be a SPOF and a throughput bottleneck for the entire crawl — mitigated by partitioning frontier ownership by domain-hash across many scheduler/queue shards, so a failure or slowdown in one shard only affects the domains it owns, not the whole crawl.
- **Hot spots**: a handful of enormous domains (Stage 2's per-domain concentration observation) dominate frontier size and can dominate a shard's workload if domain-to-shard assignment isn't balanced by expected volume, not just an even hash — mitigated by either giving especially large domains their own dedicated shard(s) or by further sub-partitioning a single huge domain's own URL space (e.g., by path prefix) while still enforcing one aggregate politeness budget across those sub-partitions.
- **Consistency vs. availability**: this system leans heavily toward availability and eventual correctness — a URL crawled twice due to a rare race condition, or a slightly stale "last crawled" timestamp, is a wasted-effort problem, not a correctness violation the way double-booking a seat or losing a driver's location would be elsewhere in this course. This tolerance is exactly what allows probabilistic structures like Bloom filters (which can have false positives) to be an acceptable, even preferred, trade for efficiency at this scale.
- **What breaks first at 10x/100x scale**: at 10x target crawl size (100 billion URLs), the `SeenUrl` and content-fingerprint stores need to scale accordingly, but the domain-partitioned architecture accommodates this by adding more shards without a structural rework. At 100x, the harder problem becomes the small number of exceptionally large domains (which don't get 100x bigger just because the rest of the web did) — pushing toward increasingly fine-grained intra-domain partitioning specifically for the small set of largest sites, since the "one shard per domain" assumption starts to strain when a single domain's own frontier is, on its own, larger than most other domains' entire footprint.

## 43.7 Summary

A distributed web crawler's central design tension is that it has effectively unlimited available work but must deliberately throttle how fast any single domain's share of that work is drained — solved by structuring the URL frontier as per-domain queues governed by a politeness scheduler (conceptually a per-domain token bucket), partitioning ownership of domains across shards so politeness state stays authoritative and workers never collide on the same URL, and layering two distinct deduplication mechanisms (exact URL normalization plus Bloom filters for "have I seen this URL," and similarity hashing for "is this content essentially the same as something I've already crawled") to avoid wasted fetch and storage effort at a multi-billion-URL scale.

Natural follow-ups an interviewer might raise: prioritizing what to (re)crawl intelligently based on observed change frequency (crawling a news homepage far more often than a static reference page), and handling crawler traps (sites that generate effectively infinite URLs, e.g., calendar pages with a "next month" link forever) which requires detecting and capping pathological URL-generation patterns rather than trusting the frontier to naturally bound itself.
