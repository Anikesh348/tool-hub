> **Learning goal**
> Design a link-and-discussion aggregator like Reddit, and be able to explain hot/top ranking with time decay, nested comment tree storage and pagination, and vote counting at scale without hot-row contention.

## 20.1 Requirements and scope

**Functional requirements**

- Post a link or text submission to a community ("subreddit").
- Upvote/downvote a post or a comment.
- Comment on a post, with support for nested replies (comments on comments, arbitrarily deep).
- View a community's post listing sorted by "hot," "top," or "new."
- View a post with its full comment tree, paginated sensibly for large trees.

**Out of scope**: community creation/moderation tooling, content search, private messaging, the specific numeric formula used by any real product's ranking algorithm — this lesson builds a conceptually equivalent decaying-score model from first principles rather than reproducing a specific published formula.

**Non-functional requirements**

- **Ranking must reflect both popularity and recency** — a post from a week ago with 10,000 votes shouldn't permanently bury everything posted since; "hot" needs a decay component, not just a raw vote count. "Top" is different — it is a simple sort by score, optionally within a time window (top today/this week/all-time).
- **Comment trees can be very large and very deep** — a popular post can have tens of thousands of comments; the system must be able to load and render this without fetching the entire tree at once.
- **Vote counts must scale to very high write concurrency on popular content without becoming a bottleneck** — a viral post can receive thousands of votes per second, and a naive "increment a single row" model breaks under that concurrency (a hot-row/lock-contention problem, discussed in depth in 20.5).
- **High availability, eventual consistency acceptable for scores** — a vote count or ranking position that's a few seconds stale is fine; the site being unreachable is not.
- **Voting must be idempotent per user** — a user can change their vote (up to down, or remove it), but cannot vote twice in the same direction and have it count twice.

## 20.2 Scale estimation

Assumptions:

- 60 million DAU.
- Each DAU casts ~15 votes/day on average (posts + comments combined) → 900 million votes/day.
- 1 in 200 DAU submits a post/day → 300,000 posts/day.
- Each DAU views ~5 listing pages/day, ~25 items per page → 7.5 billion item-views/day from listings alone, plus post-detail and comment views on top of that.

**Traffic**

- Votes: 900,000,000 ÷ 86,400 ≈ 10,400/second average, with strong concentration on a small number of currently-popular items — a single viral post can plausibly absorb a meaningful fraction of total vote traffic within its first hour, which is the number that drives the vote-counting design in 20.5.
- Listing reads: 7.5B ÷ 86,400 ≈ 87,000/second average, 2-3x at peak ≈ 200,000-250,000/second — this is a ranking/sorting read problem, not a raw lookup problem, which matters for how "hot" listings are served (precomputed, not sorted live on every request — see 20.5).
- Comment writes: assume 20% of votes' volume in comment creation as a rough proxy → ~2,000 comments/second average during peak periods on popular posts.

**Storage**

- Posts: 300,000/day × ~1 KB ≈ 300 MB/day — small.
- Comments: at, say, 500 comments per popular post on average across all posts (skewed — most posts get few, some get tens of thousands) and 300,000 posts/day, call it 50 million comments/day × ~300 bytes ≈ 15 GB/day — modest, but the *tree structure* (parent-child relationships) is the part that needs careful modeling, not the raw byte volume (see 20.5).
- Votes: 900M/day is the highest-volume write in the system by count, even though each vote record is tiny (~30 bytes: userId, itemId, direction) — ~27 GB/day of raw vote events, separate from the aggregate counts derived from them.

These numbers establish the three problems this lesson focuses on: ranking needs to be precomputed/decaying rather than computed live on every listing request; the comment tree needs a storage shape that supports efficient partial loading of a potentially huge, deep structure; and vote aggregation needs to avoid turning a popular item's single count into a serialization bottleneck under 10,000+ votes/second concentrated traffic.

## 20.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `POST /communities/{id}/posts` | Submit a post | `{title, body/url}` | `{postId}` |
| `POST /votes` | Cast or change a vote | `{itemId (post or comment), direction: up\|down\|none}` | `{success}` |
| `GET /communities/{id}/listing?sort=hot\|top\|new&cursor={c}` | Get a ranked listing | — | `{posts: [...], nextCursor}` |
| `POST /posts/{id}/comments` | Add a comment | `{parentCommentId?, body}` | `{commentId}` |
| `GET /posts/{id}/comments?sort=best&depth=3&cursor={c}` | Get a page of the comment tree | — | `{comments (nested up to depth), nextCursor}` |

**Core entities**

- `Post { postId, communityId, authorId, title, body/url, createdAt, score, hotScore }`
- `Comment { commentId, postId, parentCommentId (nullable for top-level), authorId, body, createdAt, score, path/depth-info }`
- `Vote { userId, itemId, direction, updatedAt }` — the single source of truth for "what did this user vote," keyed by `(userId, itemId)` so a repeat vote is an update, not a new record — this is what makes voting idempotent per user.
- `ScoreAggregate { itemId, upvotes, downvotes, lastUpdated }` — a separate, high-write aggregate, deliberately decoupled from `Post`/`Comment` content (same reasoning as `TweetStats` in the Twitter lesson).

**SQL vs. NoSQL.** `Post` and `Comment` content benefit from a data model that preserves tree relationships (`parentCommentId`) and needs reasonably fast retrieval of "all comments for this post" as a unit — a wide-column/key-value store partitioned by `postId` fits well, since the entire comment tree for one post is naturally one partition, keeping tree loading a single-partition operation (detailed in 20.5) rather than a cross-partition query. `Vote` records need extremely fast, idempotent point writes keyed by `(userId, itemId)` at high concurrency — again a key-value shape, not a relational one, since there's no need for joins, only "does this user have an existing vote on this item, and if so update it." `ScoreAggregate` is the highest-contention piece of data in the whole system and is discussed on its own in 20.5, because simply picking a storage engine doesn't solve its problem — the *access pattern used against it* (increment-in-place vs. something smarter) is what matters.

## 20.4 High-level architecture

```text
Client
   |
   |--- POST /votes -----------> Vote Service --> Vote Store (idempotent per-user record)
   |                                   |
   |                                   v
   |                         Score Aggregation Pipeline (async, batched)
   |                                   |
   |                                   v
   |                          ScoreAggregate Store  --> feeds hotScore recomputation
   |
   |--- GET listing (sort=hot) --> Listing Service --> Precomputed Ranked Index (per community, per sort type)
   |
   |--- POST /comments --------> Comment Service --> Comment Store (partitioned by postId)
   |
   |--- GET comments -----------> Comment Service --> Comment Store --> paginated tree traversal
```

**Write path (voting).** A vote is written idempotently to the `Vote` store keyed by `(userId, itemId)` — if the user already voted, this is an update (changing direction or retracting), not a new row, which is what guarantees a user's vote counts exactly once regardless of how many times they click. The actual aggregate count is **not** updated synchronously on every single vote (that would recreate the hot-row problem this design is trying to avoid) — instead, votes flow into a batched aggregation pipeline that periodically (e.g., every few seconds) folds a batch of votes into `ScoreAggregate`, which in turn feeds recomputation of each item's decaying `hotScore`.

**Read path (listings).** "Hot"/"top" listings are served from a precomputed, already-ranked index per community and sort type — never computed by sorting live on each request, because the read volume (200,000+/second at peak) makes live sorting of a community's full post set on every request infeasible. This mirrors the "expensive computation offline, cheap read online" pattern used repeatedly elsewhere in this course (recommendations in Spotify, suggestions in Facebook).

**Comment tree path.** Because a post's comments are all stored in one partition (per 20.3), fetching a page of a comment tree is a single-partition read, further limited by depth/pagination parameters as described in 20.5.

## 20.5 Deep dive: decaying rank, comment tree storage/pagination, and vote counting without hot-row contention

**Decaying rank for "hot."** The goal is a score that favors newer content with high engagement velocity over older content that merely accumulated a large raw vote count over a long time — otherwise a week-old post with 50,000 votes would permanently outrank everything, and the front page would never change. The standard shape (built here from first principles rather than any specific published formula) is: **score = f(votes) − g(age)**, where `f(votes)` grows with net upvotes (often on a compressing scale like a logarithm, so the difference between 10 and 20 votes matters more than the difference between 10,010 and 10,020 — this reflects that early momentum is a stronger "this is worth surfacing" signal than late-stage accumulation) and `g(age)` grows with time since posting, so the same vote count produces a lower "hot" score the older a post gets. The practical effect: a post needs a continually replenished stream of fresh votes to stay near the top of "hot," which is exactly the intended behavior — content that was popular yesterday but has gone quiet today should fade, while content still actively gaining votes right now should rise, even if its raw total is still smaller. "Top," by contrast, deliberately has **no** decay term — it's a straightforward sort by net score, optionally scoped to a time window (top today/this week/all-time) by filtering to posts created within that window rather than by decaying the score itself; the two sorts answer genuinely different questions ("what's active right now" vs. "what performed best in this period") and conflating them into one formula would make neither answer well.

**Why hot/top can't be computed live.** Given the decay term depends on the current time, a naive implementation might think it must be recomputed on every single read — but that's exactly the trap: recomputing and re-sorting an entire community's post set on every listing request, at 200,000+ reads/second, is not viable. The resolution is to **recompute scores periodically** (e.g., every minute or few minutes, or triggered incrementally as new votes arrive via the aggregation pipeline from 20.4) rather than on every read, and maintain a sorted index per community/sort-type that listing reads simply page through. A post's `hotScore` becoming slightly stale between recomputation cycles is an acceptable trade — nobody notices if a post's rank position is a minute out of date — in exchange for listing reads being cheap index reads instead of expensive live computations. This is the same "precompute expensive work, serve cheap reads" pattern seen throughout this course, applied here to a ranking function with a time-dependent term rather than to a fan-out feed.

**Comment tree storage.** A comment tree is a parent-child structure that can be arbitrarily deep and, for a popular post, very wide (tens of thousands of top-level and nested comments). Two problems need solving: storing the tree so it can be retrieved efficiently, and paginating it so a client never has to fetch the whole thing at once. For storage, partitioning all of a post's comments together (by `postId`, as noted in 20.3) is the first key decision — it means "give me this post's comments" is always a single-partition operation regardless of how large the tree gets, rather than a query that has to reach across partitions as the tree grows. Within that partition, each comment stores its `parentCommentId`, but efficient *tree* retrieval (not just flat retrieval) typically also benefits from a materialized path or nested-set-style value (e.g., a sortable string encoding the comment's position in the tree, such that a lexicographic range query over that value returns an entire subtree in one pass) — this avoids needing N recursive queries to reconstruct N levels of nesting, which would be far too slow for a tree that's dozens of levels deep. For pagination, the practical approach mirrors what real large-tree UIs do: fetch top-level comments first, ranked by score (best/most-upvoted first, a much smaller and cheaper sort than the whole-community listing sort since it's scoped to one post), paginate those, and only fetch a comment's *replies* on demand (when a user expands it) rather than eagerly loading the full depth of every branch — this keeps the initial page load bounded regardless of total tree size, deferring the cost of deep branches to only the users who actually explore them.

**Vote counting without hot-row contention.** The naive model — `UPDATE ScoreAggregate SET upvotes = upvotes + 1 WHERE itemId = X` for every single vote — creates a single row that every vote on that item must serialize through. For most items this is fine (low vote velocity), but for a viral post absorbing thousands of votes per second, that one row becomes a lock-contention bottleneck: every writer is queued behind the same row-level lock, and throughput on that item is capped regardless of how much total system capacity exists elsewhere. Two complementary techniques fix this, both already previewed conceptually in earlier lessons (Instagram's like counts, Twitter's `TweetStats`) but worth detailing concretely here since this is the lesson where the mechanism matters most:

1. **Batch/buffer before aggregating.** Instead of every vote immediately mutating the aggregate row, votes are first written (cheaply, keyed by `userId` so they parallelize trivially — different users' votes never contend with each other) and then folded into the aggregate in small batches by the aggregation pipeline, e.g., "sum up the last 2 seconds' worth of votes for item X and apply one combined increment" instead of thousands of individual increments. This turns thousands of serialized single-row writes into a handful of batched writes per interval, cutting contention by orders of magnitude while keeping the aggregate only briefly (sub-few-second) stale.
2. **Shard the counter itself for extremely hot items.** For the small number of items hot enough that even batched increments contend heavily, the aggregate for a single item can be split into multiple sub-counters (e.g., N shards, each accumulating a fraction of the votes, chosen by hashing the voting userId), with the displayed count computed as the sum across shards, refreshed periodically. This is the general "sharded counter" pattern: spread writes to a hot key across multiple physical rows/keys so no single one is a serialization point, and only pay the (cheap, infrequent) cost of summing shards together when a read actually needs the total.

Both techniques trade a small amount of staleness (score updates lag actual votes by up to a few seconds) for a large reduction in write contention — squarely consistent with this system's stated non-functional requirement that eventual consistency is fine for scores, but availability and responsiveness under high concurrent voting are not negotiable.

## 20.6 Bottlenecks and trade-offs

- **Single points of failure.** The score aggregation pipeline is critical for keeping rankings fresh; if it stalls, "hot" listings go stale (posts stop moving) even though voting itself keeps working (votes are still durably recorded, just not yet folded in) — a graceful degradation rather than an outage, by design.
- **Hot spots.** A single viral post is the textbook hot spot for this problem, both for votes (mitigated by batching and sharded counters, above) and for comment writes/reads (mitigated by the per-post partitioning and on-demand subtree loading described above, which keeps a hot post's cost roughly proportional to how much of its tree is actually being viewed, not its total size).
- **Consistency vs. availability.** Vote *records* per user need to be correct and idempotent (strong consistency for "did this specific user vote and in which direction"), while aggregate *scores and rankings* lean heavily towards availability and eventual consistency, exactly as with engagement counts in the Instagram and Twitter lessons — the same general pattern of drawing the consistency line differently for different pieces of state within one system.
- **What breaks first at 10x scale.** The comment-tree pagination and on-demand subtree loading strategy is the first thing tested — at 10x traffic, a viral post's comment count can reach into the hundreds of thousands, and even efficient subtree queries need the materialized-path indexing described above to stay well-tuned, or deep/wide trees start to show latency on expansion.
- **What breaks at 100x.** The score aggregation pipeline's batching interval and sharded-counter fan-out need to widen significantly — at 100x vote volume, even batched writes to a single item's shards can approach contention limits, pushing towards a higher shard count for the hottest items and a shorter, more frequent (but still batched, never per-vote) aggregation cycle, alongside moving hot-item detection from a fixed threshold to a dynamic one that reacts to real-time vote velocity.

## 20.7 Summary

This lesson's three deep-dive problems all resolve to variations on one idea already used elsewhere in this course — decouple expensive/contentious work from the fast path — applied in three different shapes: **ranking** decays a precomputed score over time and is recomputed periodically rather than live on every read; **comment trees** are partitioned per-post and loaded incrementally (top-level first, subtrees on demand) rather than fetched whole; and **vote counting** avoids single-row contention on popular items through batched aggregation and, for the hottest items, sharded counters, accepting a few seconds of staleness in exchange for write throughput that doesn't collapse under viral load.

Natural follow-ups: how would you extend "hot" ranking to be personalized per user (incorporating a viewer's own community subscriptions and history, which starts to resemble the ranking-layer discussion in the Instagram lesson) rather than one global ranking per community, and how would you handle comment tree edits/deletions without breaking the materialized-path indexing used for subtree retrieval — a deleted comment with replies still attached is a common real-world edge case worth reasoning through explicitly.
