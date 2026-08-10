> **Learning goal**
> Design a search-engine autocomplete/typeahead system, and be able to explain how a trie enables fast prefix matching, how top-K suggestions are ranked, and how the trie is kept fresh as query popularity shifts over time.

## 3.1 Requirements and scope

**Functional requirements**

- As a user types a partial query (a prefix), return a ranked list of the top suggestions that start with that prefix, updated on every keystroke.
- Suggestions should be ranked by relevance — typically how frequently that full query has been searched historically.
- Support suggestions across a large, evolving vocabulary of past search queries.

**Non-functional requirements**

- **Very low latency**: this runs on every keystroke, so a response must come back in well under 100ms or the UI feels laggy. This is the dominant constraint on the whole design.
- **High availability**: if autocomplete is down, the product should degrade gracefully to "no suggestions," not break search entirely — so this is a non-critical-path enhancement, and it's fine to serve stale or no data over failing loudly.
- **Eventual freshness**: suggestions can lag real-world trends by minutes to hours (a brand-new trending query doesn't need to appear in suggestions instantly); they do not need to reflect the last few seconds of search activity.
- Scale to a very large query vocabulary (hundreds of millions of distinct historical queries).

**Out of scope**: personalized suggestions based on a specific user's search history, spelling correction/"did you mean," and multi-language tokenization nuances.

## 3.2 Scale estimation

- **Query volume**: assume 1 billion searches/day on the underlying search engine → roughly **11,600 searches/sec** average, with each search typically preceded by 5-10 keystrokes that each trigger an autocomplete request → **60,000-115,000 autocomplete requests/sec**. This is the dominant traffic driver in this design, far higher than the search volume itself.
- **Vocabulary size**: assume 100 million distinct historical queries worth tracking for suggestions (after filtering out one-off noise). At an average of ~20 bytes per query string plus a frequency counter (8 bytes), raw data is roughly **2.8 GB** — small enough to fit in memory on a modest number of machines, which is exactly what we want given the latency requirement.
- **Trie size**: a trie storing 100 million query strings, even with sharing of common prefixes, typically ends up several times larger than the raw string data because of per-node overhead (child pointers, counts). A reasonable estimate is 3-5x raw size, so roughly **10-15 GB** for the full in-memory structure — comfortably fits on a handful of machines with tens of GB of RAM each, or a sharded cluster if it grows further.
- **Update volume**: new queries and frequency changes accumulate constantly, but because freshness only needs to be "eventual" (minutes to hours), updates can be batched rather than applied one search at a time — this relaxes what would otherwise be a very high write rate into a manageable periodic rebuild, discussed in the deep dive.

The key numbers driving this design: request volume is very high (tens of thousands of requests/sec) but each request is cheap (a small prefix lookup), and the whole searchable dataset is small enough to live in memory — so this becomes a design about serving a large in-memory structure fast and cheaply, not about storage scale.

## 3.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `GET /api/suggest?prefix={text}&limit=10` | — | `{ "suggestions": ["query one", "query two", ...] }` (already ranked) |

A single read endpoint is enough for the client-facing contract; there is no user-facing write endpoint because suggestions are derived from aggregate search logs, not submitted directly by users.

**Data model**

Two logically distinct pieces of data:

1. **Raw search logs**: `SearchEvent { query, userId, timestamp }` — an append-only stream, naturally suited to a log/event store (e.g., Kafka) or a simple analytics-oriented store, since it is written constantly and read only in bulk (for aggregation), never by point lookup.
2. **Aggregated query frequencies**: `QueryFrequency { query, count, lastUpdated }` — computed periodically from the raw logs. This is what actually gets loaded into the serving structure (the trie).

Neither of these is a good fit for a traditional relational database as the *serving* layer: the read pattern is "give me everything starting with this prefix, ranked by a score," which is a specialized structure (a trie or a prefix-indexed key-value store), not a row-lookup or join pattern. So the data model splits cleanly: an append-only log/analytics store for raw events, a periodic batch job to aggregate frequencies, and an in-memory trie (rebuilt from those aggregates) as the actual thing that answers `GET /suggest` requests. This is a good example of "the serving data structure is not the same as the storage data model" — a distinction worth stating explicitly in an interview.

## 3.4 High-level architecture

```text
Client (types "sys")
  -> Load Balancer -> Suggestion Service (holds trie shards in memory)
                           -> returns top-K ranked suggestions for prefix

Search Logs (async, out of critical path)
  -> Log Store (append-only)
       -> Batch Aggregation Job (periodic, e.g. hourly)
            -> QueryFrequency table
                 -> Trie Builder -> new Trie snapshot -> pushed to Suggestion Service instances
```

**Read path (the hot path)**: the client sends the current prefix on every keystroke. The Suggestion Service holds the trie (or a shard of it) fully in memory and walks down from the root by the prefix's characters, then reads a pre-sorted list of top-K queries attached to that trie node (ranking is precomputed at build time, not at request time — this is what keeps read latency low, discussed more in the deep dive). The response is returned directly with no disk access on the hot path.

**Write/update path (the cold path, decoupled from reads)**: raw search queries are logged asynchronously and never touch the read path. A periodic batch job aggregates counts and rebuilds (or incrementally updates) the trie, then the new version is distributed to all Suggestion Service instances, typically by swapping in a new in-memory snapshot rather than mutating the live structure that's serving traffic. Decoupling the cold, heavy aggregation work from the hot, latency-critical read path is the central architectural idea here — it's why the system can serve 60,000+ requests/sec cheaply despite drawing on a vocabulary derived from a billion daily searches.

## 3.5 Deep dive: trie structure, top-K ranking, and keeping it fresh

**Why a trie.** A trie (prefix tree) stores strings character by character, where each path from the root spells out a prefix, and shared prefixes share the same path in the tree. Looking up "all queries starting with 'sys'" becomes: walk 3 edges from the root (s → y → s), then everything in the subtree below that node is a valid completion. This makes prefix lookup cost proportional to the length of the typed prefix (typically under 10 characters), not to the size of the vocabulary — which is exactly the property needed to hit sub-100ms latency regardless of whether the vocabulary is 1 million or 100 million queries.

**Ranking top-K without computing it per request.** A naive approach — collect every completion under a node and sort them at request time — is too slow when a common short prefix like "the" might have millions of completions in its subtree. Instead, each trie node precomputes and caches its own top-K list (say, top 10) at build time: as the trie is constructed bottom-up from the aggregated frequency data, each node keeps the K highest-frequency completions found anywhere in its subtree. This turns a request-time "scan and sort" into a request-time "read a pre-sorted array of 10 items," which is why the read path can stay so cheap. The trade-off is that this precomputation happens at build time, so it reflects the data as of the last rebuild, not the current instant — an acceptable trade given the non-functional requirement that freshness only needs to be eventual.

**Keeping the trie updated at scale.** Rebuilding a 10-15 GB trie from scratch on every update would be wasteful. Two complementary techniques address this: (1) batch the aggregation — instead of updating the trie per search event, accumulate frequency deltas over a window (e.g., hourly) and apply them in one pass, since a single extra search doesn't meaningfully change rankings anyway; (2) use a **blue-green style swap** — build the new trie snapshot entirely offline on a separate machine or process, then atomically swap the Suggestion Service's in-memory pointer from the old trie to the new one once the build is complete. This means the live read path never sees a partially-built or being-mutated trie, avoids any locking on the hot path, and makes a bad rebuild trivially reversible (swap back to the previous snapshot). At larger vocabulary sizes, the trie itself would also be **sharded** — e.g., by first character or a hash of the prefix — across multiple Suggestion Service instances, each holding only a fraction of the full structure in memory, with a routing layer directing each prefix query to the right shard.

## 3.6 Bottlenecks and trade-offs

- **Single points of failure**: if the trie lives on a single machine, that machine's failure kills autocomplete entirely. Mitigated by running multiple identical replicas of the Suggestion Service behind the load balancer, each holding the same (or a sharded portion of the) trie, so any one instance can fail without taking down the read path.
- **Hot spots**: very common short prefixes ("a", "the") are queried far more than long, specific ones, but because ranking is precomputed per node, the *cost* of serving a hot prefix is the same as a rare one (an array read) — the hot spot shows up as uneven request volume across trie shards rather than uneven per-request cost, and is mitigated by replicating the busiest shards (e.g., short, common prefixes) across more instances than rare ones.
- **Consistency vs. availability**: firmly favors availability and eventual consistency. Suggestions are allowed to be minutes-to-hours stale; the system should never fail a request just because the latest aggregation hasn't landed yet.
- **What breaks first at 10x/100x scale**: at 10x request volume, more read replicas of the Suggestion Service handle it linearly since reads are stateless and cheap. At 10x vocabulary size, a single machine can no longer hold the full trie in memory, forcing sharding (discussed above) — this is the first real architectural change, not just "add more boxes."

## 3.7 Summary

Autocomplete is a read-latency problem disguised as a ranking problem: the interesting engineering is not "how do we rank strings" (that's a frequency count) but "how do we serve ranked prefix lookups fast enough for every keystroke, at very high request volume, without recomputing rankings live." A trie with precomputed top-K lists per node, rebuilt periodically via an offline batch job and swapped in atomically, solves this by moving all the expensive work off the hot path.

Natural extensions an interviewer might raise: personalizing suggestions per user (which would require blending a global trie with a smaller per-user recent-search structure) and handling typo tolerance (which pushes toward fuzzy matching structures like a BK-tree or edit-distance-aware indexing layered on top of the exact-prefix trie).
