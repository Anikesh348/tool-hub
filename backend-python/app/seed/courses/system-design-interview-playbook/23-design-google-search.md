> **Learning goal**
> Design a web search engine like Google Search, and be able to explain web crawling at scale, inverted index construction, and ranking that combines link-analysis and relevance signals at a conceptual level.

## 23.1 Requirements and scope

**Functional requirements**

- Continuously discover and fetch web pages (crawling), keeping a corpus of known pages reasonably fresh.
- Build a searchable index from crawled content, mapping words/terms to the pages that contain them.
- Given a user's query, return a ranked list of relevant results quickly.
- Re-crawl pages periodically to detect changes/removals and keep the index from going stale.

**Out of scope**: the ad system, rich result types (maps, images, knowledge panels), query auto-suggest, spam/fraud detection in depth (mentioned only briefly), the specific machine-learned ranking models used by any real product — this lesson builds a conceptually sound, first-principles version of link analysis and relevance scoring, not a reproduction of any specific published algorithm.

**Non-functional requirements**

- **Query latency must be very low** — users expect results in well under a second; this is arguably the strictest latency requirement of any system in this course, and it is only achievable because essentially all of the expensive work (crawling, indexing, link analysis) happens well ahead of query time, not during it — a theme that will recur throughout this lesson.
- **The web is enormous and constantly changing** — the crawler can never claim to be "done"; freshness is a continuous, prioritized process, not a one-time job.
- **Crawling must be polite and resilient** — a crawler hitting one site too aggressively can effectively be a denial-of-service attack on that site; the system must respect rate limits per site (and standard crawl-permission signals) and tolerate individual sites being slow, broken, or hostile without that affecting the rest of the crawl.
- **High availability for serving queries**; the crawling/indexing pipeline can tolerate being asynchronous and eventually consistent — a page that changed an hour ago showing slightly stale content in search results is normal and expected, not a bug.
- **Ranking must combine multiple signals**, not just keyword matching — a page's authority/trustworthiness (who links to it) and how well it actually matches query intent both matter, and neither alone is sufficient (detailed in 23.5).

## 23.2 Scale estimation

Assumptions:

- Crawlable web size: assume the crawler tracks and maintains roughly 50 billion known pages (a reasonable order-of-magnitude figure for what a large-scale crawl covers, excluding the much larger but largely inaccessible/duplicate/low-value remainder of the web).
- Average recrawl interval: highly variable by page (news sites: hours; static pages: weeks/months) — assume a blended average recrawl interval of 30 days across the whole corpus for a back-of-envelope figure.
- Average page size (HTML, post-compression, ignoring embedded media which is handled separately): ~100 KB.
- Query volume: 8.5 billion searches/day platform-wide (a commonly-cited order of magnitude for a search engine at this scale).

**Traffic (crawling)**

- 50 billion pages ÷ 30 days ≈ 1.7 billion page-fetches/day just to maintain the recrawl cadence ÷ 86,400 ≈ ~19,000 fetches/second average, sustained continuously. This is before accounting for *discovering* entirely new pages (following links to previously-unseen URLs), which adds meaningfully more fetch volume on top of pure recrawling.
- Crawl bandwidth: 1.7B pages/day × 100 KB ≈ 170 TB/day just for page fetches — non-trivial, but small compared to the video-serving numbers in the Netflix/YouTube lessons; the crawler's real bottleneck is not raw bandwidth but **politeness constraints** (how fast any single site can be hit) and **coordination** (avoiding redundant fetches of the same URL by different crawler workers), covered in 23.5.

**Traffic (queries)**

- 8.5 billion/day ÷ 86,400 ≈ 98,000 queries/second average, 2-3x at peak → roughly 250,000-300,000 queries/second at peak. Every one of these must be served in well under a second — this is the number that makes "compute the answer live from raw crawled content" completely infeasible and mandates the precomputed inverted index described in 23.3/23.5.

**Storage**

- Raw crawled content: 50 billion pages × 100 KB ≈ 5 PB for a single snapshot of raw page content — and the system typically retains some history/versions, multiplying this further.
- Inverted index: an index maps terms to the (many) documents containing them; even with substantial compression (a standard and necessary technique for structures this size), an index over a corpus this large plausibly runs from the hundreds of terabytes into the low petabytes, depending on how much per-position/context information is retained per term occurrence (needed for phrase matching and relevance scoring, not just presence/absence).
- Link graph: 50 billion pages with, say, an average of 20 outbound links each ≈ 1 trillion edges — a graph at a scale that itself demands careful, distributed handling for the link-analysis computation described in 23.5.

These numbers establish this lesson's central architectural commitment: virtually everything (crawling, index construction, link-graph analysis) must happen **offline, continuously, ahead of query time**, so that the one operation with a hard latency budget — answering a query — only ever has to do a fast, precomputed lookup, never raw computation over the corpus.

## 23.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `GET /search?q={query}&page={n}` | Run a search query | — | `{results: [{url, title, snippet, rank}], nextPage}` |
| *(internal)* `POST /crawl-queue/enqueue` | Add a URL to the crawl frontier | `{url, priority}` | `{}` |
| *(internal)* `POST /index/documents` | Submit a freshly crawled/parsed document for indexing | `{url, content, links[], crawledAt}` | `{}` |

The only truly public-facing endpoint is `/search` — everything else in this system is internal pipeline plumbing, which is itself a notable structural feature of this problem: unlike most other lessons in this course, the bulk of the architecture exists behind a single simple read API.

**Core entities**

- `CrawlFrontier { url, priority, lastCrawledAt, nextCrawlAt, status }` — the queue/schedule of what to fetch next; conceptually similar in spirit to the distributed job scheduler's `ScheduleBucket`, just prioritized by a mix of freshness need and page importance rather than a fixed cron schedule.
- `Document { url, rawContent, parsedText, title, outboundLinks[], crawledAt, contentHash }` — the crawled and parsed representation of a page; `contentHash` is used to cheaply detect "did this page actually change since last crawl" without a full content diff.
- `InvertedIndexEntry { term -> postingList: [(docId, positions[], termFrequency), ...] }` — the core search data structure, detailed in 23.5.
- `PageScore { url, linkAuthorityScore, freshnessScore }` — precomputed, offline-derived scores that feed into query-time ranking.

**SQL vs. NoSQL.** Every major structure here is accessed by a single key at enormous scale with no need for cross-document joins: the crawl frontier is looked up/updated by URL, documents are stored and retrieved by URL/docId, and — most importantly — the inverted index's entire purpose is a single-key lookup pattern (given a term, get its posting list) at the highest possible speed and concurrency. This is about as clean a case for a key-value/wide-column-style store as any in this course; a relational model offers no benefit here (there's nothing resembling a multi-table transactional workload) and would only add overhead. The inverted index in particular is usually not modeled as a generic database at all but as a purpose-built, heavily compressed, sharded data structure engineered specifically for this one access pattern — general-purpose storage engines are a poor fit for how specialized and read-latency-critical this structure needs to be.

## 23.4 High-level architecture

```text
                     ------------------- Offline / continuous pipeline -------------------
Seed URLs --> Crawl Frontier (priority queue) --> Crawler Workers (many, distributed, rate-limited per site)
                                                          |
                                                          v
                                                 Parser (extract text, links, metadata)
                                                          |
                                       -------------------------------------
                                       |                                   |
                                       v                                   v
                             discovered links --> back into        Document Store
                             Crawl Frontier (dedup'd)                     |
                                                                           v
                                                                  Index Builder
                                                                           |
                                                          -----------------------------------
                                                          |                                   |
                                                          v                                   v
                                                Inverted Index (sharded,               Link Graph -->
                                                 by term)                        Link Analysis Job (offline)
                                                                                          |
                                                                                          v
                                                                                   PageScore Store
                     ---------------------------------------------------------------------------
                                       ^
                                       |
Client --- GET /search?q=... ---> Query Service --> looks up terms in Inverted Index
                                        |               --> merges posting lists
                                        |               --> combines with PageScore (relevance + authority)
                                        v
                                  Ranked Results
```

**Crawl/index path (fully offline, continuous).** Crawler workers pull URLs from the frontier (respecting per-site rate limits), fetch pages, hand them to a parser that extracts text and outbound links; discovered links get deduplicated and fed back into the frontier (this is how the crawl expands to new pages over time), while parsed content is stored and handed to the index builder, which updates the inverted index. Separately, and much less frequently (link structure changes far more slowly than page content), the link graph feeds an offline link-analysis job that produces authority scores per page. None of this touches the query path at all.

**Query path (the only latency-critical part).** A query is tokenized into terms, each term's posting list is looked up in the (already-built, already-sharded) inverted index, matching lists are intersected/merged to find documents containing the relevant terms, and those candidates are ranked using a combination of precomputed `PageScore` (authority, freshness) and query-time relevance signals (how well the terms match, in what proximity/order) — all of this operates over already-precomputed structures, never raw crawled content, which is what makes the sub-second latency target achievable against a 50-billion-page corpus.

## 23.5 Deep dive: crawling at scale, inverted index construction, and ranking

**Crawling at scale.** The crawler's central data structure is the **frontier** — a prioritized queue of URLs to fetch next — and its central constraint is **politeness**: hitting any single website too fast can degrade or effectively attack that site, so the crawler must enforce a per-site rate limit (e.g., no more than one request every few seconds to the same host) regardless of how much total crawling capacity is available elsewhere. This means the frontier isn't simply one global priority queue drained as fast as possible — it needs to be partitioned in a way that prevents any one host from being over-fetched even while thousands of crawler workers operate in parallel across different hosts, typically by grouping queued URLs per-host and having a scheduling layer ensure only one (or a small, configured number of) request is in flight to a given host at a time, distributing the actual parallelism across the enormous number of *distinct* hosts rather than within any single one. Priority within the frontier is driven by a mix of signals: pages that change frequently (news sites) get scheduled for recrawl sooner than static pages that rarely change (this is what `nextCrawlAt` in the data model encodes, and it can be adjusted dynamically — if a page's `contentHash` keeps coming back unchanged across several crawls, its recrawl interval can be pushed out further, saving crawl capacity for pages that actually change), and pages estimated to be more important (a proxy that itself can lean on the same link-authority signal computed for ranking, since a page many other pages link to is both probably more important to keep fresh and probably more valuable to have indexed at all) are prioritized over obscure, rarely-linked pages. Deduplication matters at two levels: avoiding re-queuing a URL that's already in the frontier (straightforward with a lookup against the frontier/document store by URL), and avoiding indexing genuinely duplicate *content* found at different URLs (via content hashing/similarity, so the index isn't bloated with many entries all pointing at effectively the same page) — the latter also feeds directly into ranking, since duplicate content shouldn't let a page game visibility by existing at many URLs.

**Inverted index construction.** A "forward" representation of the crawled corpus — documents, each containing a list of terms — is exactly backwards from what a query needs: a query provides terms and needs documents. The inverted index flips this: for every term encountered anywhere in the corpus, maintain a **posting list** of every document that contains it, typically along with enough extra information (the positions where the term occurs within the document, and how many times) to support phrase queries ("exact phrase in quotes") and basic relevance scoring (a term appearing many times, or in the title, is a stronger signal than one incidental mention). Building this index is itself a large, parallelizable batch job: each crawled/parsed document can be processed independently to produce its own small set of (term, docId, position) entries, and these are then merged/sorted by term across the whole corpus — a shape that maps naturally onto a distributed data-processing job (conceptually the same map/aggregate pattern referenced for friend-of-friend computation in the Facebook lesson, applied here to term extraction and posting-list construction instead of graph traversal). Given the earlier storage estimate (hundreds of terabytes to low petabytes even compressed), the resulting index must be **sharded** — commonly by term (different ranges of terms live on different shards, so a query for an uncommon set of terms only needs to touch a few shards) — and a query-time layer fans a query's terms out to the relevant shards in parallel and merges the results, which is what keeps query latency low even though the index itself is far too large for any single machine. The index isn't rebuilt from scratch on every single crawl update — new/changed documents are incorporated incrementally (their term entries added or updated in the relevant posting lists) so freshness doesn't require reprocessing the entire corpus on every change, though periodic full rebuilds/compactions are still typically needed to keep the structure efficient over time as it accumulates incremental updates.

**Ranking: combining link analysis and relevance.** Two fundamentally different questions need to be answered together for good results, and neither alone is sufficient: **"is this page actually about what the user is asking?"** (relevance) and **"is this page trustworthy/authoritative in general?"** (authority) — a page can perfectly match a query's keywords while being low-quality or spam, and a highly authoritative page can be a poor match for a specific query. Relevance signals come from the inverted index directly and are largely computable query-time from the matched posting lists: how many query terms appear, how close together (proximity), whether they appear in the title vs. buried in body text, and how rare the matched terms are in the corpus generally (a match on a rare, specific term is a stronger signal than a match on an extremely common word, since the common word narrows down the candidate set far less). Authority, by contrast, cannot be computed from a single document in isolation at all — it comes from the **link graph**: conceptually, a page that many other pages link to (especially if those linking pages are themselves considered authoritative) is treated as more trustworthy than one nobody links to, following the idea that a link is, roughly, a vote of confidence from one page to another, and that votes from already-trusted pages should count for more than votes from obscure or low-quality ones. Computing this at the scale of a trillion-edge graph (per 23.2) is itself an iterative, offline batch process — conceptually, authority scores are initialized (e.g., uniformly) and then repeatedly recomputed by having each page redistribute its current score across the pages it links to, iterating until scores stabilize (converge) across the whole graph; this is exactly the kind of large-scale, iterative graph computation that needs a distributed processing framework built for it, run periodically (not per-query, and not even necessarily per-crawl, since link structure changes far more slowly than page content does) and written into the `PageScore` store for query-time consumption. At query time, the two signal types are combined — a simple mental model is that authority acts as a prior/multiplier applied on top of relevance scoring, so a highly relevant match on a low-authority page and a highly authoritative page with a weaker match can both surface, but a page strong on both dominates — the exact combination function is a tuning problem outside this lesson's scope, but the architectural point is what matters: relevance is computed largely at query time from the index, authority is precomputed entirely offline from the link graph, and ranking is where these two independently-computed signal sources meet.

## 23.6 Bottlenecks and trade-offs

- **Single points of failure.** No single crawler worker or index shard should be able to take down search — the frontier is partitioned across many workers so one worker's failure just means its in-flight URLs get reassigned, and the sharded index means losing one shard degrades results for the subset of terms on that shard (mitigated with standard replication per shard) rather than taking the whole query path down.
- **Hot spots.** A small number of extremely popular query terms create read hot spots on specific index shards — mitigated with aggressive caching of popular query results/posting-list lookups, similar in spirit to how popular content naturally gets well-cached in the Spotify/Netflix CDN discussions, just applied to index lookups instead of media bytes. On the crawl side, a small number of extremely large or extremely link-heavy sites can dominate frontier priority if not deliberately capped, which is why per-site politeness limits (above) double as a load-balancing mechanism, not just an etiquette one.
- **Consistency vs. availability.** This system leans heavily towards availability and staleness-tolerance almost everywhere: the index, crawl data, and authority scores are all allowed to lag reality by anywhere from minutes to weeks depending on the signal, and this is treated as normal, not degraded, operation — the one place near-real-time behavior matters more is breaking-news-style content, which real systems typically handle with a separate, faster-cadence crawl/index path for high-velocity sources rather than forcing the entire pipeline to run at news speed.
- **What breaks first at 10x scale.** The crawl frontier's per-site politeness partitioning is the first strain point if the corpus grows 10x — more total pages doesn't necessarily mean more *distinct* hosts proportionally (the web's host count grows more slowly than its page count, since many new pages come from existing large sites), so per-host request-rate limits increasingly bound total crawl throughput regardless of added worker capacity, pushing towards smarter prioritization (crawl capacity spent where it matters most) rather than simply adding more workers.
- **What breaks at 100x.** Index storage and the link-analysis job's convergence time become the dominant constraints — a 100x larger link graph makes the iterative authority-score computation itself a much larger distributed job with longer convergence time, pushing towards incremental/localized recomputation (only reprocessing the parts of the graph that changed significantly since the last run) rather than a full iterative pass over the entire trillion-plus-edge graph every cycle.

## 23.7 Summary

This system's defining architectural choice is pushing essentially all expensive computation — crawling, parsing, index construction, and link-based authority scoring — into a continuous, offline pipeline, so that the one latency-critical operation, answering a query, only ever performs fast, precomputed lookups against an already-built inverted index and already-computed authority scores. Crawling at scale is bounded less by raw bandwidth than by per-site politeness constraints, which shape how the frontier is partitioned and prioritized; the inverted index flips the natural document-to-terms relationship to make term-to-documents lookups fast, sharded by term to keep any single query's work bounded; and ranking combines two independently-computed signal families — relevance (largely computable at query time from the index) and authority (computed entirely offline from an iterative pass over the link graph) — because neither alone answers "what's the best result" well.

Natural follow-ups: how would you extend this design to handle personalized or location-aware ranking (which reintroduces a per-user dimension into a system this lesson deliberately kept global/precomputed, echoing the tension between precomputed candidates and personalization touched on in the Instagram and YouTube lessons), and how would you detect and demote spam/link-manipulation schemes designed specifically to game the authority-scoring mechanism described in 23.5 — a genuinely adversarial problem unlike anything else in this course, since here the "input data" (the web) includes participants actively trying to manipulate the ranking system itself.
