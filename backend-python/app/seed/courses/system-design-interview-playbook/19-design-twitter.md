> **Learning goal**
> Design a short-form public posting and timeline service like Twitter/X, and be able to explain fan-out on write vs. read for timelines, the celebrity/hot-account problem, and tweet storage/retrieval at scale.

## 19.1 Requirements and scope

**Functional requirements**

- Post a short text update ("tweet"), optionally with an image.
- Follow/unfollow other accounts (one-directional, like Instagram's model, not mutual like Facebook's).
- View a home timeline of tweets from followed accounts, in roughly reverse-chronological/ranked order.
- Retweet/reply to a tweet.
- Basic search/lookup of a single tweet or a user's own tweet history.

**Out of scope**: full-text search across all tweets (a separate, index-heavy subsystem), trending-topics computation, direct messages (covered by the WhatsApp lesson's model), the ranking model internals beyond a conceptual pass (already covered in more depth in the Instagram lesson).

**Non-functional requirements**

- **Extremely read-heavy** — timeline views vastly outnumber tweets posted, similar in shape to Instagram, but with an even more extreme skew in *account* size: some accounts have well over 100 million followers, more extreme than typical Instagram-scale figures, which makes the celebrity fan-out problem the defining constraint of this entire lesson.
- **Low-latency posting** — posting a tweet should feel instant regardless of the poster's follower count; a celebrity's tweet must not appear to "hang" while the system works out delivery.
- **Timeline reads must be fast** — opening the app and seeing a timeline should not require expensive live computation for the common case.
- **High availability, eventual consistency acceptable** — a tweet appearing in a follower's timeline a few seconds late is fine; the service being unreachable is not.
- **Tweets are small but numerous and durable** — content itself (up to a bounded character count) is tiny per item, but the write rate and required durability (tweets are permanent, citable content) matter more than any single item's size.

## 19.2 Scale estimation

Assumptions:

- 300 million DAU.
- 1 in 20 DAU posts per day, averaging 2 tweets when they do → roughly 30 million tweets/day.
- Each DAU loads their timeline ~10 times/day, ~40 tweets per load → 400 timeline-views-worth of tweets per user per day → 120 billion tweet-views/day.
- Follower distribution is extremely skewed: median follower count is under 100, but the largest accounts exceed 100 million.

**Traffic**

- Tweet writes: 30,000,000 ÷ 86,400 ≈ 350/second average — small in absolute terms.
- Timeline reads: 120B ÷ 86,400 ≈ 1.4 million/second average, spiking higher around major real-world/live events (this platform's traffic is famously bursty around breaking news, sports, etc. — assume a 5x spike factor for major events, not just the usual 2-3x) → ~7 million/second at extreme peak.
- Fan-out write amplification: an account with 100 million followers posting one tweet, if fanned out naively to every follower's timeline at write time, is 100 million writes triggered by a single 350-byte post — a seven-order-of-magnitude amplification from one write. This single fact is the reason this lesson (like Instagram's) cannot use a uniform fan-out-on-write strategy.

**Storage**

- Tweet content: 30M/day × ~400 bytes (text + metadata) ≈ 12 GB/day — tiny, and cumulatively, even years of tweets at this rate stays in the tens-of-TB range, far smaller than the media-heavy Instagram/Spotify catalogs. This is a useful contrast to notice: this system's hard problem is not storage volume, it's fan-out and read amplification.

These numbers make the central theme of this lesson explicit before any design is drawn: the write side is cheap and small, and the read side is enormous and skewed by an even more extreme celebrity effect than Instagram's, which is why the fan-out strategy deserves the deepest treatment here.

## 19.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `POST /tweets` | Post a tweet | `{text, mediaRef?}` | `{tweetId}` |
| `POST /users/{id}/follow` | Follow a user | — | `{success}` |
| `GET /timeline?cursor={c}&limit=40` | Get home timeline, paginated | — | `{tweets: [...], nextCursor}` |
| `POST /tweets/{id}/retweet` | Retweet | — | `{success}` |
| `POST /tweets/{id}/reply` | Reply to a tweet | `{text}` | `{tweetId}` |
| `GET /users/{id}/tweets` | Get a user's own tweet history | — | `{tweets: [...]}` |

**Core entities**

- `User { userId, followerCount, followingCount }`
- `Follow { followerId, followeeId }` — same shape as Instagram's follow edge.
- `Tweet { tweetId, authorId, text, mediaRef?, createdAt, replyToId?, retweetOfId? }`
- `TimelineEntry { userId, tweetId, insertedAt }` — the precomputed timeline, same role as Instagram's `FeedEntry`.
- `TweetStats { tweetId, likeCount, retweetCount, replyCount }` — kept separate from the tweet itself because it changes far more often than the tweet's content ever does (content is immutable once posted; stats update continuously).

**SQL vs. NoSQL.** The same reasoning as the Instagram lesson applies directly and doesn't need to be re-derived: `Follow`, `Tweet`, and `TimelineEntry` are all high-volume, simple-key, partition-friendly access patterns (get all tweets by authorId, get all timeline entries for userId, both single-partition range reads) that favor a key-value/wide-column store over a relational one at this scale. The one addition worth calling out here: separating `TweetStats` from `Tweet` is itself a data-modeling decision driven by access pattern — `Tweet` content is written once and read very often (immutable after posting), while `TweetStats` is written continuously (every like/retweet/reply touches it) and also read often; keeping them as separate records means the high-churn counter updates don't need to rewrite or lock the tweet content record, and it opens the door to the same eventually-consistent, batched-counter approach used for Instagram's like counts, for exactly the same hot-row-contention reason.

## 19.4 High-level architecture

```text
Client
   |
   |--- POST /tweets --> App Service --> Tweet Store (durable write, source of truth)
   |                           |
   |                           v
   |                    Fan-out Service (async, via queue)
   |                           |
   |            -----------------------------------
   |            |                                  |
   |    (normal account)                  (celebrity account)
   |  push tweetId into each follower's    do nothing at write time;
   |  TimelineEntry (fan-out on write)      rely on fan-out on read
   |
   |--- GET /timeline --> App Service --> read TimelineEntry (fast path)
   |                                     + merge in celebrity tweets fetched live (bounded, small set)
   |                                     + rank/sort
   |
   |--- media bytes ---> CDN --> Object Storage (same pattern as Instagram)
```

This diagram is deliberately near-identical to the Instagram lesson's — the architecture for "post something, deliver it to followers' feeds" is genuinely the same shape across both problems, which is worth noticing explicitly: the *architecture pattern* here is not new, but the *severity* of the celebrity problem it needs to handle is greater (more extreme follower counts, more extreme read bursts around live events), which is what 19.5 focuses on.

**Write path.** Posting durably writes the `Tweet`, then hands off to the async Fan-out Service — the response to the poster returns as soon as the durable write succeeds, never waiting on fan-out, which is what keeps posting latency flat regardless of follower count (directly satisfying the non-functional requirement from 19.1).

**Read path.** Same hybrid merge as Instagram: fast precomputed reads for the common case, small bounded live lookups for the handful of celebrity accounts any given user follows.

## 19.5 Deep dive: fan-out on write vs. read, the celebrity problem, and tweet storage/retrieval at scale

**Restating the hybrid model, and why it matters even more here.** The fan-out-on-write vs. fan-out-on-read trade-off and its hybrid resolution were derived in detail in the Instagram lesson (Section 14.5): push at write time amplifies by follower count (unbounded for large accounts), pull at read time amplifies by follow count (naturally bounded per reader), and the hybrid model routes each account through whichever mechanism keeps its amplification bounded, using a follower-count threshold. That reasoning applies here without modification. What's genuinely different in this problem is the *severity*: this platform's largest accounts exceed 100 million followers (an order of magnitude past typical large accounts elsewhere), and its traffic is uniquely bursty around live, real-world events — both facts push the celebrity-handling machinery from "an important edge case" to "a load-bearing part of the core design."

**Handling live events, not just celebrity accounts.** A subtlety beyond the basic hybrid model: during a major live event (a sports final, a breaking news moment), it is not just one celebrity account generating a burst — it's potentially thousands of accounts (celebrities, news outlets, ordinary highly-followed users) all posting at an elevated rate simultaneously, while millions of users are actively refreshing their timelines in near-real-time. This compounds the read amplification described in 19.2 (the 5x event-driven spike factor) with fan-out load from many "above-threshold" accounts at once, not just one. Practical mitigations: over-provisioning the fan-out-on-read path's caching layer specifically for currently-trending accounts (since a live event concentrates reads onto a predictable, small set of currently-hot authors — this is the same "extreme popularity makes caching easier, not harder" observation used for CDN behavior in the Spotify lesson), and applying backpressure/graceful degradation on the timeline-ranking step (falling back to simpler, cheaper reverse-chronological ordering instead of full ranking) under extreme load rather than letting ranking latency drag down the whole read path.

**Tweet storage and retrieval at scale.** Because individual tweets are small (per 19.2, tens of GB/day, not the multi-TB/day media volumes seen in Instagram or Spotify), the interesting storage problem here isn't raw volume — it's **retrieval pattern diversity**. The same tweet needs to be efficiently retrievable through several very different access paths: by `tweetId` directly (someone opens a permalink), by `authorId` ordered by time (a user's own tweet history/profile), and indirectly through `TimelineEntry` rows scattered across potentially millions of different followers' partitions (fan-out having copied a reference to it into each). This is a case where **the fan-out mechanism doubles as a secondary index**: rather than every timeline read doing a join against the `Tweet` table, `TimelineEntry` typically stores just enough denormalized data (or a direct reference plus a cache-friendly copy of frequently-displayed fields like author name/avatar) to render a timeline row without a separate lookup per entry — a classic space-for-speed trade, justified here because reads (1.4 million/second) so vastly outnumber writes (350/second) that paying a little extra storage and write-time work per fan-out to save a lookup on every single read is clearly worth it. Retweets are modeled as a lightweight reference (`retweetOfId` pointing at the original `Tweet`) rather than a full content copy, both to save storage and, more importantly, so that stats (likes, retweet count) properly accrue to one canonical tweet regardless of how many times it's retweeted — this is a data-modeling decision directly justified by requirement, exactly the discipline described in Lesson 1's framework: a copy-the-content model would silently fragment engagement counts across N duplicate records, which breaks the "must be correct" expectation users have for a public like/retweet count.

**Read-path ranking, briefly.** As with Instagram, the `TimelineEntry` fan-out machinery produces *candidates*; a lighter ranking pass (recency, engagement velocity, author affinity — the same signal categories described in the Instagram lesson) determines final order over that already-small candidate set. This lesson doesn't re-derive the ranking mechanics in full since Section 14.5 already covers the general shape in depth; the point worth adding here is that under the live-event load spikes described above, this ranking step is exactly the kind of "nice to have but not essential" layer that a well-designed system should be able to shed under pressure (falling back to simple chronological order) rather than let it become a bottleneck that delays every timeline load during the exact moments when timeline load is highest.

## 19.6 Bottlenecks and trade-offs

- **Single points of failure.** Same shape as Instagram's: the Fan-out Service and its queue are on the critical path for timeline freshness for non-celebrity accounts; mitigated the same way, by treating fan-out as async and horizontally scalable so a backlog degrades gracefully rather than causing an outage.
- **Hot spots.** This is the dominant concern for this specific problem, more so than in most other lessons in this course: a single extremely-followed account tweeting during a live event is simultaneously a write-amplification risk (mitigated by routing it through fan-out-on-read, per the hybrid model) and a read hot spot (mitigated by aggressive caching of currently-trending content, since the same popularity that makes it "hot" also makes it maximally cacheable).
- **Consistency vs. availability.** Same position as Instagram and largely the same justification: engagement counts (`TweetStats`) favor availability and eventually-consistent, batched counters over strict per-like transactional updates, to avoid hot-row contention on viral tweets; timeline delivery favors availability (a slightly stale or reordered timeline) over strict consistency (blocking a read until every follower's fan-out write has landed).
- **What breaks first at 10x scale.** The "large but not quite celebrity" band of accounts (tens of thousands to low millions of followers) is the first strain point, exactly as in the Instagram lesson — there are more of them at 10x scale, and each still uses fan-out-on-write, so aggregate fan-out volume grows faster than DAU alone would suggest; the threshold likely needs to move, or a third, intermediate tier (partial/delayed fan-out) gets introduced.
- **What breaks at 100x.** The read path during live events becomes the dominant constraint: at 100x baseline scale, an event-driven 5x spike is a genuinely enormous absolute request volume concentrated in a short window; this pushes towards regional read replicas and edge caching of hot timelines/tweets (conceptually extending the CDN-style caching used for media in other lessons to cover *dynamically generated but highly-repeated* content, like the current top tweets during a live event), rather than relying purely on the origin timeline-serving path to absorb the spike.

## 19.7 Summary

This lesson deliberately reuses the fan-out architecture and hybrid write/read strategy established in the Instagram lesson, because the underlying trade-off (followers unbounded, follows bounded) is identical — the value here is in seeing the same pattern applied to a problem with a more extreme skew and a uniquely bursty, event-driven read pattern, which pushes the celebrity-handling machinery from an optimization into the central design constraint. The other genuinely new piece is tweet storage/retrieval: because tweets are small but need to be efficiently reachable through several different access paths (by id, by author, and via millions of fanned-out timeline references), the fan-out mechanism is deliberately treated as doing double duty as a denormalized index, trading some extra storage and write-time work for read-path speed, which is justified directly by the enormous read:write ratio measured in Section 19.2.

Natural follow-ups: how would you extend this design to support full-text search across all tweets (which needs an entirely separate inverted-index subsystem, conceptually previewed in the Google Search lesson later in this course), and how would you handle a tweet being deleted after it has already been fanned out to millions of `TimelineEntry` rows — propagating a delete is structurally the same amplification problem as fan-out-on-write, just in reverse.
