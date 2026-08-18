> **Learning goal**
> Design a social network like Facebook centered on the friend graph and news feed, and be able to explain how the social graph is stored at scale, how friend-of-friend queries work, and how feed ranking and fan-out trade-offs apply here.

## 18.1 Requirements and scope

**Functional requirements**

- Send, accept, and manage friend requests (a **bidirectional**, mutual-consent relationship — the key structural difference from Instagram's one-directional follow graph).
- Post an update (text, photo, link) to your own timeline.
- View a home feed composed of posts from friends.
- Support "people you may know" style friend-of-friend suggestions, at a conceptual level.

**Out of scope**: Messenger/chat (covered by the WhatsApp lesson's model), Groups/Pages (a related but structurally different graph), the ML details of friend suggestions and feed ranking beyond a conceptual description, photo storage internals (already covered in depth in the Instagram lesson — this lesson references that pattern rather than re-deriving it).

**Non-functional requirements**

- **The friend graph must support fast traversal, not just point lookups** — "who are my friends" is a point lookup, but "who are my friends' friends that I'm not already friends with" (used for suggestions) is a graph traversal, and the storage choice has to support that reasonably well at scale.
- **Read-heavy, similar order of magnitude to Instagram** — feed views vastly outnumber posts.
- **Friend requests need transactional correctness** — a request shouldn't be "half accepted" (visible as a friend to one side but not the other); this is a case where the earlier lessons' general lean towards eventual consistency for social features needs to be qualified — the graph *edge itself* needs to be created consistently, even if downstream feed propagation can be eventually consistent.
- **High availability for feed viewing** — same reasoning as Instagram: seeing a slightly stale feed is fine, the app being down is not.
- **Graph size and skew** — most users have a few hundred friends (capped, unlike Instagram's unbounded follower counts), but Pages/public figures that people can *follow* (a separate, one-directional relationship layered on top of the friend graph) can still have very large audiences, so the celebrity fan-out problem from the Instagram lesson still shows up, just for a different relationship type.

## 18.2 Scale estimation

Assumptions:

- 400 million DAU.
- Average friend count per user: ~300 (Facebook famously caps friends at 5,000, but the *average* active user is much lower).
- Each DAU views their feed ~8 times/day, ~15 posts per view → 120 post-views/user/day → 48 billion post-views/day.
- 1 in 1,000 DAU posts per day → 400,000 new posts/day.

**Traffic**

- Reads: 48B/day ÷ 86,400 ≈ 555,000/second average, ~1.5 million/second at peak — same order of magnitude as Instagram, for the same underlying reason (read:write ratio dominated by viewing, not posting).
- Writes (posts): 400,000/day ÷ 86,400 ≈ ~5/second — tiny.
- Friend graph writes: friend requests + accepts are far rarer than posts — assume 50 million friend-request actions/day platform-wide ≈ 580/second average — small relative to feed traffic, but each one is a two-sided, consistency-sensitive write (see 18.3).

**Storage**

- Graph edges: 400M users × 300 friends ÷ 2 (each friendship is one edge, not counted from both sides) ≈ 60 billion edges. At roughly 50 bytes/edge (two user ids + timestamp + metadata) that's ~3 TB for the raw edge set — not huge in absolute bytes, but the *traversal* cost (not the storage cost) is what actually matters here, because "friends of friends" fans out multiplicatively (see 18.5).
- Post content storage follows the same reasoning as the Instagram lesson (images in object storage behind a CDN, text/metadata in a fast key-value store) and isn't re-derived here.

These numbers set up the two central themes of this lesson: the friend graph is bidirectional and needs consistent, transactional edge creation, unlike a follow graph; and friend-of-friend-style queries are combinatorially expensive if done naively (300 friends × 300 friends-of-friends = up to 90,000 second-degree connections to consider per user), which is why they can't be computed live on every request at this scale.

## 18.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `POST /friend-requests` | Send a friend request | `{toUserId}` | `{requestId, status: pending}` |
| `POST /friend-requests/{id}/accept` | Accept a pending request | — | `{success}` — creates a mutual friendship |
| `GET /users/{id}/friends` | List a user's friends | — | `{friends: [...]}` |
| `GET /suggestions/friends` | Get "people you may know" | — | `{suggestions: [...]}` |
| `POST /posts` | Create a post | `{content, mediaRefs?}` | `{postId}` |
| `GET /feed?cursor={c}` | Get home feed | — | `{posts: [...], nextCursor}` |

**Core entities**

- `User { userId, ... }`
- `FriendRequest { requestId, fromUserId, toUserId, status: pending|accepted|declined, createdAt }`
- `Friendship { userIdA, userIdB, createdAt }` — a single, symmetric edge; stored once but indexed so it can be looked up efficiently from either side (see below).
- `Post { postId, authorId, content, mediaRefs, createdAt }` — same shape as the Instagram lesson's `Post`.
- `FeedEntry { userId, postId, insertedAt }` — same precomputed-feed pattern as Instagram.

**SQL vs. NoSQL, and the friend-edge subtlety.** The bulk of this system (posts, feed entries, engagement) follows the exact same reasoning as the Instagram lesson: high-volume, simple-key access patterns that favor a key-value/wide-column store. The friend graph is the interesting exception. A `Friendship` edge is logically undirected/symmetric, but most storage engines index by a specific key, so a common approach is to **store the edge twice** — once as `(userIdA -> userIdB)` and once as `(userIdB -> userIdA)` — inside a key-value/wide-column store partitioned by userId, so "list my friends" is a cheap single-partition read from either side, at the cost of doubling storage for edges (an acceptable trade given the earlier calculation showed the raw edge storage is only a few TB) and needing to write both directions atomically when a friendship is created — which is exactly why `FriendRequest` acceptance is modeled as a single transactional operation rather than two independent writes: if only one direction were written and the process crashed before the second, the graph would be inconsistent (A sees B as a friend, B doesn't see A), violating the non-functional requirement from 18.1. This is a good concrete illustration of "SQL vs. NoSQL depends on access pattern" cutting a different way even within the same feature: the read pattern (list my friends, by userId) wants a key-value shape, but the write pattern (create both directions atomically) wants a transactional guarantee — the resolution is to use a key-value-shaped schema (dual edges) but wrap the two writes in a transaction if the underlying store supports one, or use a compensating/idempotent retry pattern if it doesn't, rather than picking a purely relational model just to get the transaction and losing the read scalability.

## 18.4 High-level architecture

```text
Client
   |
   |--- POST /friend-requests, /accept ---> Friend Graph Service --> Friendship Store (dual-write, transactional)
   |
   |--- GET /users/{id}/friends -----------> Friend Graph Service --> Friendship Store (single-partition read)
   |
   |--- GET /suggestions/friends ----------> Suggestion Service --> Precomputed Suggestions Store
   |                                              ^
   |                                              |
   |                                    Offline/batch job: graph traversal
   |                                    over Friendship Store, run periodically
   |
   |--- POST /posts -----------------------> App Service --> Post Store
   |                                              |
   |                                              v
   |                                       Fan-out Service (same hybrid model as Instagram,
   |                                       applied to friends for posts, and to Page followers
   |                                       for Page updates)
   |
   |--- GET /feed --------------------------> App Service --> FeedEntry Store (fast path) + live Page-post merge
```

**Write path (friend request/accept).** Sending a request writes a `FriendRequest` row. Accepting it is the consistency-sensitive operation: it must atomically flip the request to `accepted` and create both directions of the `Friendship` edge — modeled as a single transaction (or an idempotent, retryable multi-step operation with a clear recovery path if the underlying store can't do a cross-partition transaction) precisely because a half-completed accept is explicitly called out as unacceptable in 18.1.

**Read path (friends list, feed).** Listing friends is a fast single-partition read. Feed reading follows the same hybrid fan-out pattern established in the Instagram lesson: for regular friends (bounded to a few hundred, well under any "celebrity" threshold), posts are fanned out to `FeedEntry` at write time; for Pages with very large follower counts (structurally the same problem as Instagram's celebrity accounts, just via the Page-follow relationship instead of the friend relationship), fan-out on read is used instead, and results are merged at feed-read time. This lesson doesn't re-derive that trade-off in full — see the Instagram lesson's Section 14.5 for the detailed reasoning — but it's worth noting explicitly that Facebook's feed problem actually has *two* source graphs (friends, symmetric and capped; Page follows, one-directional and unbounded), and the hybrid strategy needs to be applied per source, not just per account size within one graph.

**Suggestion path.** "People you may know" is explicitly computed offline/asynchronously (a periodic batch job that traverses the friend graph), never live on a request — this is the direct consequence of the combinatorial cost identified in 18.2, detailed further in 18.5.

## 18.5 Deep dive: social graph storage, friend-of-friend queries, and feed fan-out contrasted with Instagram

**Storing the graph for fast traversal, not just lookup.** The dual-write edge pattern from 18.3 optimizes for the single most common query ("list my friends"), but the friend-*suggestion* feature needs a fundamentally different, more expensive query: "find users who are friends with my friends, but not already friends with me." Done naively and live, this means: for a user with 300 friends, fetch each friend's friend list (300 more single-partition reads), union them (up to 90,000 second-degree connections before dedup), subtract the user's existing friends and pending requests, and rank what's left — for one single feed-adjacent feature, on every request, at 400 million DAU. This is not a live-query problem, it's a batch-computation problem, and recognizing that distinction is the core insight of this deep dive.

**Why friend-of-friend suggestions are computed offline.** The fix mirrors a pattern already used elsewhere in this course (recommendation computation in the Spotify lesson, feed ranking candidate generation in the Instagram lesson): decouple the *expensive computation* from the *fast read*. A periodic batch job (running, say, daily or continuously as a background stream over graph changes) walks the friend graph computing second-degree-connection counts per user — this is naturally parallelizable, since each user's friend-of-friends computation only depends on that user's own friend list and each friend's list, so it can be distributed across many workers processing different users' neighborhoods independently, using a data-processing framework built for this kind of large-scale graph fan-out (conceptually similar to a MapReduce-style job: map each user to their friends' friend lists, reduce by counting/ranking overlaps). The output — a ranked suggestion list per user — is written to a fast key-value store (the `Precomputed Suggestions Store` in 18.4), and the live `GET /suggestions/friends` endpoint just reads that precomputed list, the same "expensive compute offline, cheap read online" split used for recommendations in the Spotify lesson. The trade-off, made explicit rather than accidental: suggestions are somewhat stale (reflecting the graph as of the last batch run, not the current instant), which is an entirely acceptable trade for a feature that isn't time-critical, in exchange for making the read path trivially fast.

**A narrower, real-time-safe version of friend-of-friend.** Not every friend-of-friend-shaped query needs to be batch-only — a bounded version ("are user A and user B connected through any mutual friend, and if so, which ones," shown as "you have 12 mutual friends" on a profile) is cheap enough to compute live, because it only requires intersecting *two* specific friend lists (A's and B's), not traversing the whole graph — a single-partition read from each side plus a set intersection, which is fast regardless of overall graph size. The general lesson here: "friend-of-friend" sounds like one kind of query, but its cost depends entirely on whether it's bounded to two specific users (cheap, live-safe) or open-ended across the whole graph (expensive, batch-only) — an interviewer will often probe exactly this distinction to see if a candidate reaches for batch processing reflexively or actually reasons about which variant is being asked for.

**Contrast with Instagram's fan-out model.** Instagram's follow graph is one-directional and structurally unbounded on the follower side (a celebrity can have unlimited followers), which is what forces the hybrid fan-out-on-write/fan-out-on-read split described in that lesson. Facebook's *friend* graph is capped and bidirectional by design (a friendship requires mutual consent, and the platform enforces a hard cap on friend count), which means the fan-out-on-write side of Facebook's feed problem is actually simpler and more uniform than Instagram's — there's no "friend with 100 million connections" case to special-case, because that case cannot exist in the friend graph. The celebrity-scale fan-out problem still exists on this platform, but it's cleanly separated into the *Page-follow* relationship (one-directional, unbounded, structurally identical to Instagram's follow graph), which gets the same hybrid treatment Instagram uses. The broader point worth internalizing: the fan-out strategy isn't a property of "the platform," it's a property of *each relationship type's* structure (bounded/symmetric vs. unbounded/asymmetric), and a platform with two different relationship types (friends and Page-follows) can and should apply different strategies to each rather than forcing one answer for the whole feed.

## 18.6 Bottlenecks and trade-offs

- **Single points of failure.** The Friendship Store's dual-write path is the most consistency-sensitive write in the system; a partial failure there (one direction written, not the other) is worse than most SPOFs elsewhere in this course because it corrupts a user-visible fact ("are we friends") rather than just delaying it — mitigated by transactional writes where the store supports them, or a reconciliation job that periodically scans for asymmetric edges and repairs them if it doesn't.
- **Hot spots.** Page-follow fan-out for very large Pages is the same hot spot as Instagram's celebrity problem, and gets the same mitigation (fan-out on read plus caching of popular content). Within the friend graph itself, there isn't an equivalent hot spot by construction, precisely because friend counts are capped.
- **Consistency vs. availability.** This design deliberately draws the line differently than the purely feed-oriented lessons: the friend graph *edge* leans towards consistency (a half-created friendship is a correctness bug, not just staleness), while everything downstream of it — feed entries, suggestions, engagement counts — leans towards availability and eventual consistency, same as Instagram. This is a useful general pattern: within one system, different pieces of state can and should sit at different points on the consistency/availability spectrum based on what breaks if they're wrong, rather than picking one global position for the whole system.
- **What breaks first at 10x scale.** The batch friend-suggestion job is the first strain point — at 10x users (4 billion), the graph traversal job's runtime and resource needs grow faster than linearly (each user's neighborhood computation touches more data, and there are more users), pushing towards more aggressive sampling (only compute suggestions from a subset of each user's friends' lists rather than the full set) or longer batch intervals.
- **What breaks at 100x.** The dual-write edge storage pattern's total edge count (up to 100x the ~60 billion edges) starts to strain even a horizontally-partitioned store's operational overhead (rebalancing, replication traffic for that much data); at that scale, some designs move towards a purpose-built graph database or graph-processing layer for the friend graph specifically, accepting more specialized infrastructure in exchange for traversal operations that don't degrade as the graph grows, rather than continuing to bolt traversal-like queries onto a key-value store that was chosen primarily for point-lookup speed.

## 18.7 Summary

This lesson's central lesson is that a *bidirectional, mutual-consent* graph (friends) behaves differently from the *one-directional* graph covered in the Instagram lesson (follows), both in how edges must be written (transactionally, both directions, because a half-created friendship is a bug) and in how fan-out plays out (capped, so no celebrity-scale write amplification on the friend side — that problem is isolated entirely to the separate, unbounded Page-follow relationship). Friend-of-friend-style queries split cleanly into two cases: bounded, two-user queries (mutual friends) that are cheap enough to compute live, and open-ended, whole-graph queries (suggestions) that must be computed offline in batch and served from a precomputed store, exactly like the recommendation and ranking patterns established in earlier lessons.

Natural follow-ups: how would you extend this to support privacy controls (a post visible to "friends of friends" requires the feed-read path to evaluate graph membership, not just fetch precomputed entries), and how would you handle a user with the maximum friend cap interacting with the fan-out system differently than a typical user, if at all — a good test of whether "capped" really means "no special-casing needed."
