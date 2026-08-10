> **Learning goal**
> Design a photo-sharing service like Instagram, and be able to explain feed generation (fan-out on write vs. read, and the hybrid celebrity case), image storage/CDN, and a high-level view of feed ranking.

## 14.1 Requirements and scope

**Functional requirements**

- Upload a photo (with a caption) to a user's own profile.
- Follow/unfollow other users.
- View a home feed composed of recent posts from accounts the user follows.
- Like and comment on posts (basic engagement actions).

**Out of scope**: Stories/ephemeral content, direct messaging (covered by the WhatsApp lesson's model), video/Reels-specific encoding pipeline (covered by the Netflix/YouTube lessons' model), full ML ranking model internals — this lesson covers ranking conceptually, not the model architecture.

**Non-functional requirements**

- **Read-heavy by a huge margin** — users view far more posts than they create; the read:write ratio easily exceeds 100:1, which should dominate every architectural choice below.
- **Feed loads must be fast** — opening the app and seeing a feed within a few hundred milliseconds is core to the product; users will not tolerate the feed being computed from scratch on every open.
- **High availability, eventual consistency acceptable** — it's fine if a like count or a new post takes a few seconds to appear in someone's feed; it's not fine for the app to be unreachable.
- **Durability for uploaded content** — a photo, once posted, must not be lost.
- **Follow graph can be very skewed** — some accounts have hundreds of millions of followers, most have a few hundred; the design must not assume a uniform follower count.

## 14.2 Scale estimation

Assumptions:

- 500 million DAU.
- Each DAU views their feed ~5 times/day, each feed view surfaces ~20 posts → 100 views-worth of posts per user per day, so roughly 50 billion post-views/day across all users.
- 1 in 500 DAU posts per day on average → 1 million new posts/day.
- Average photo size (after compression, multiple resolutions considered separately): ~2 MB per original upload.

**Traffic**

- Reads: 50 billion post-views/day ÷ 86,400 ≈ 580,000 reads/second average, 2-3x at peak → ~1.5 million reads/second at peak (this is why caching and CDN-served images, not database reads, must carry almost all of this).
- Writes: 1,000,000 posts/day ÷ 86,400 ≈ ~12 posts/second average for the post-creation write itself — tiny compared to reads, confirming the read:write skew stated above.

**Storage**

- 1M posts/day × 2 MB ≈ 2 TB/day of new image data (before generating multiple resolutions for different UI contexts — thumbnail, feed-size, full-size — which multiplies this by roughly 2-3x in practice, so call it 5 TB/day of image storage growth).
- Over a year, that's well over 1.5 PB just from new uploads, confirming images belong in object storage, not a database.

**Fan-out (the number that shapes Section 14.5)**

- Average follower count might be a few hundred, but the distribution is extremely skewed — a celebrity account can have 100+ million followers. A single post from such an account, if naively fanned out to every follower's feed individually, is 100 million writes from one action. This single fact is the reason this problem needs a hybrid fan-out strategy rather than one uniform approach.

## 14.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `POST /posts` | Create a post | `{imageBytes/uploadToken, caption}` | `{postId}` |
| `GET /feed?cursor={c}&limit=20` | Get the caller's home feed, paginated | — | `{posts: [...], nextCursor}` |
| `POST /users/{id}/follow` | Follow a user | — | `{success}` |
| `POST /posts/{id}/like` | Like a post | — | `{success}` |
| `POST /posts/{id}/comments` | Comment on a post | `{text}` | `{commentId}` |
| `GET /posts/{id}` | Get a single post (for direct links, profile views) | — | `{post}` |

**Core entities**

- `User { userId, username, followerCount, followingCount }`
- `Follow { followerId, followeeId, createdAt }` — the edge of the follow graph.
- `Post { postId, authorId, imageUrls (multiple resolutions), caption, createdAt, likeCount, commentCount }`
- `FeedEntry { userId, postId, insertedAt }` — a precomputed row meaning "this post belongs in this user's feed"; this table only exists for users who get fan-out-on-write treatment (see 14.5).
- `Like { postId, userId, createdAt }`, `Comment { commentId, postId, userId, text, createdAt }`.

**SQL vs. NoSQL.** Split by access pattern again:

- The `Follow` graph and `Post` metadata are natural candidates for a wide-column/key-value store when accessed by a single key (e.g., "get all posts by authorId X," "get all followers of X") because these are simple, high-volume, partition-friendly lookups — exactly the profile that scales horizontally without joins.
- `FeedEntry`, the precomputed feed table, is even more clearly a key-value-shaped access pattern: "get the most recent N feed entries for userId Y," partitioned by userId, is a single-partition range read — a strong fit for a wide-column store, not a relational join between Follow and Post tables computed live (which is exactly what this table exists to avoid — see 14.5).
- Engagement counts (likes, comments) at this write volume benefit from an eventually-consistent counter approach (batched/approximate increments, reconciled periodically) rather than a strongly consistent relational counter that would become a write hot spot on popular posts — this is revisited in 14.6.

Overall, this system is dominated by high-throughput, simple-key access patterns rather than multi-table transactions, which is why NoSQL-style stores do most of the heavy lifting, with a smaller relational store (or none) reserved for anything that truly needs transactional multi-row guarantees, like account creation/username uniqueness.

## 14.4 High-level architecture

```text
Client
   |
   |--- POST /posts (upload) --> App Service --> Object Storage (original + generated resolutions)
   |                                    |
   |                                    v
   |                             Post Metadata Store (Post table)
   |                                    |
   |                                    v
   |                          Fan-out Service (async, via queue)
   |                                    |
   |                    ---------------------------------
   |                    |                                |
   |          (normal account)                  (celebrity account)
   |     push PostId into each follower's         do nothing at write time;
   |     FeedEntry list (fan-out on write)          rely on fan-out on read
   |
   |--- GET /feed --------> App Service --> read FeedEntry table (fast path)
   |                                        + merge in celebrity posts fetched live (slow path, small in count)
   |                                        + rank/sort
   |
   |--- image bytes -------> CDN (edge cache) --> Object Storage (origin, on cache miss)
```

**Write path (posting).** A client uploads an image; the app service writes the original to object storage, kicks off (synchronously or via a fast async job) generation of a few standard resolutions (thumbnail, feed, full-screen), and writes a `Post` row once URLs are available. It then hands the new post off to a Fan-out Service via a queue — critically, fan-out happens *asynchronously*, decoupled from the upload response, so a user with millions of followers doesn't have to wait for millions of writes before their upload confirms.

**Read path (viewing the feed).** For the vast majority of users, the app service just reads that user's precomputed `FeedEntry` list — a fast, single-partition read, already sorted roughly by insertion order (see 14.5 for the ranking nuance). For posts from celebrity accounts the user follows (which were *not* fanned out at write time), the service does a small number of live lookups — "does anyone I follow who is a celebrity have new posts" is a bounded query, because a user follows a bounded number of celebrities even though a celebrity has an unbounded number of followers. The two result sets are merged and ranked before returning.

**Image serving.** Once URLs exist, image bytes are served the same way audio chunks are in the Spotify lesson — through a CDN in front of object storage — because the read volume (1.5M/sec at peak) must never hit the origin or a database directly.

## 14.5 Deep dive: fan-out on write vs. read, and the hybrid model

This is the single most important design decision in a feed system, and it exists because of one number from 14.2: follower count is wildly non-uniform.

**Fan-out on write (push model).** When a user posts, immediately write a `FeedEntry` row into the feed of every one of their followers. Reading a feed later is then trivially fast — just read your own precomputed list. This is great for the common case (a user with a few hundred followers: one post becomes a few hundred cheap writes), but catastrophic for the uncommon case: a celebrity with 100 million followers turns one post into 100 million writes, all of which need to happen (or at least be queued) before that post is visible to anyone, and it multiplies write amplification by the follower count for every single post such an account makes.

**Fan-out on read (pull model).** When a user opens their feed, query all the accounts they follow for recent posts, merge, and sort, on the fly. This makes posting cheap regardless of follower count (a celebrity's post is one write, period), but makes *every* feed read expensive — it now has to fan out to however many accounts the reader follows (dozens to hundreds), query each for recent posts, and merge — for every single feed load, by every user, which given the 1.5M reads/second peak number from 14.2 is far too much live computation to do well.

**The hybrid model.** The resolution is to split by account size, using a threshold (e.g., some number of followers, tuned empirically): accounts below the threshold use fan-out on write (the common case — cheap because follower counts are small, and it keeps reads fast for everyone); accounts above the threshold (celebrities) are excluded from write-time fan-out and instead pulled live at read time, merged into the reader's feed. This works because of an asymmetry the earlier numbers reveal: a celebrity has huge fan-out on the follower side, but any individual *reader* follows only a small, bounded number of celebrities (a user might follow a handful of highly-followed accounts among their few hundred follows) — so the read-time cost of "check my few celebrity follows for new posts" stays small and roughly constant per user, unlike the write-time cost of pushing to every one of a celebrity's followers, which grows without bound as the account gets more popular.

Put differently: fan-out on write amplifies by *followers*, which is unbounded for a celebrity; fan-out on read amplifies by *follows*, which is naturally bounded for any one user (nobody follows a meaningful fraction of the platform). The hybrid model routes each account through whichever mechanism keeps its amplification bounded.

**A practical detail:** the threshold isn't usually a hard cliff in a real system — some designs use a graduated approach (e.g., partial fan-out to only "recently active" followers, or fan-out with a delay/batch for very large accounts) — but the two-tier version above captures the core idea well enough to reason about and defend in an interview.

**Feed ranking, at a high level.** A precomputed `FeedEntry` list gives you *candidates* (recent posts from people you follow), but the order shown to the user is usually not strict reverse-chronological in a modern feed — it's ranked by a model that scores each candidate using signals like the post's engagement velocity (likes/comments in the first few minutes), the viewer's historical affinity with the author (do they usually engage with this account's posts), and recency (a decay factor so nothing stays at the top forever — the same decay concept covered in more depth in the Reddit lesson's ranking discussion). The system-design point worth internalizing is that ranking is a *separate stage* layered on top of candidate generation: the FeedEntry/fan-out machinery answers "what could I show this user," and a ranking step (which can be a relatively lightweight scoring pass over a bounded candidate set, since fan-out already limited candidates to a few hundred recent posts) answers "in what order." Keeping these stages separate means the expensive part (generating candidates at scale) stays a simple, cacheable, precomputed lookup, while the part that needs to be "smart" (ranking) only ever operates over a small, already-fetched candidate set — it never has to scan the whole platform.

## 14.6 Bottlenecks and trade-offs

- **Single points of failure.** The Fan-out Service and its queue are critical for feed freshness — if it backs up, non-celebrity posts stop appearing promptly in followers' feeds. Mitigated by treating fan-out as inherently async and horizontally scalable (partition the queue by author or post, add more workers), so a backlog degrades to "feeds are a bit stale" rather than "the app is down."
- **Hot spots.** Even with the hybrid model, a celebrity post that goes viral creates a read hot spot — huge numbers of users simultaneously pulling that one post live. Mitigated with aggressive caching of celebrity posts specifically (since they're read by a disproportionate number of users, they're exactly the content worth keeping hot in cache) and by rate-limiting/batching the live-fetch queries rather than hitting the origin store per reader.
- **Consistency vs. availability.** Like/comment counts are a deliberate availability-over-consistency choice: at high write volume, incrementing a single counter row per like would create a hot-row contention problem on popular posts, so counts are typically approximate/eventually-consistent (batched increments, periodic reconciliation) rather than exact in real time — a trade users don't notice (nobody double-checks whether a post has exactly 104,822 or 104,819 likes) but that meaningfully reduces write contention.
- **What breaks first at 10x scale.** The fan-out write volume for the "long tail above the threshold but not quite celebrity" band grows — accounts with, say, 50,000-500,000 followers still get written to on every post, and there are a lot more of them at 10x DAU; the threshold and batching strategy likely need retuning, and fan-out workers need to scale out further.
- **What breaks at 100x.** The FeedEntry store's total storage and write throughput becomes the dominant cost — every non-celebrity post write multiplies by follower count, and at 100x scale that aggregate write volume is enormous even with the hybrid model absorbing the worst outliers; this is when a design might revisit fan-out entirely, e.g., capping how many feed entries are retained per user (only keep the most recent few hundred, evicting older ones) rather than storing unbounded history.

## 14.7 Summary

The core insight of this lesson is that "generate a feed" is not one problem but a trade-off between two extremes — push everything to every follower at write time (fast reads, unbounded write cost for popular accounts) versus compute everything at read time (cheap, bounded writes, but expensive reads) — and that the right answer is neither extreme but a hybrid split by account size, because the two mechanisms amplify along different, asymmetric axes (followers vs. follows). Images are served through object storage plus a CDN, exactly like the audio pattern in the Spotify lesson, and ranking is layered on top of a small precomputed candidate set rather than being computed over the whole platform.

Natural follow-ups: how would you extend this design to support a "for you"/discovery feed that includes posts from accounts the user doesn't follow at all (which breaks the "bounded follows" assumption underlying the hybrid model and pushes further towards a recommendation-system approach), and how would you handle a user unfollowing or blocking someone with respect to already-fanned-out `FeedEntry` rows that reference that author's posts.
