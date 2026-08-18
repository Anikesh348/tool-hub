> **Learning goal**
> Design a short-form video platform like TikTok, able to explain the video upload/transcoding pipeline, a conceptual "For You" recommendation feed, and how the client stays smooth by pre-fetching upcoming videos.

## 25.1 Requirements and scope

**Functional requirements**

- Upload a short video (with caption, music, tags).
- Process the video into multiple resolutions/bitrates suitable for different devices and network conditions.
- Serve an infinite, personalized "For You" feed of videos to scroll through.
- Like, comment, and follow creators.
- Track watch behavior (watch time, replays, skips) to improve future recommendations.

**Non-functional requirements**

- **Smooth playback is the product.** Any stall or buffering while scrolling is a critical failure, even more than in most consumer apps — the whole experience is built around instant, continuous video.
- **High availability, eventual consistency acceptable almost everywhere.** A like count that's a few seconds stale, or a feed that doesn't instantly reflect a brand-new follow, is fine.
- **High write throughput for engagement events.** Every view, like, skip, and watch-duration event is a signal the recommendation system wants, and there are vastly more of these than uploads.
- Global audience: content and infrastructure need to be geographically distributed for acceptable latency.

**Out of scope**

- The actual machine learning model architecture for ranking (we treat ranking as a black-box scoring service and focus on the data pipeline around it).
- Live streaming.
- Content moderation systems.
- Direct messaging.

## 25.2 Scale estimation

Assumptions for a large-scale short-video platform:

- 200 million daily active users (DAU).
- Average session: 30 minutes, watching ~15-second videos → roughly 120 videos watched per user per day.
- **Video views/day:** 200M × 120 ≈ 24 billion views/day → ≈ 280,000 views/sec average, likely 2-3x that at peak in the evening.
- **Uploads:** assume 1% of DAU upload at least one video per day → 2 million uploads/day ≈ 23 uploads/sec average (bursty around trends, but tiny compared to view traffic).
- **Engagement events** (like, comment, follow, watch-duration ping): assume ~10 events per video watched → 240 billion events/day, roughly 2.8 million events/sec at average — this is the largest data stream in the whole system and dwarfs both views and uploads.

**Storage:**

- Assume an average uploaded video is 20 MB (before transcoding) and gets transcoded into 4 renditions (different resolutions/bitrates) averaging a combined 30 MB stored. 2M uploads/day × 30 MB ≈ 60 TB/day of new video storage, or ~22 PB/year. This is squarely an object-storage problem, not a database problem.
- Metadata (captions, tags, counts) per video is small (~1 KB) — 2M/day × 1 KB is negligible; this comfortably lives in a normal database.

**Bandwidth:** this is the dominant cost driver. If an average video segment served is ~1 MB and we serve 280,000 views/sec, that's ~280 GB/s at average, far more at peak. This single number is the strongest justification in this lesson for a CDN — without one, no origin infrastructure could plausibly serve this directly.

**Read:write ratio:** views vastly outnumber uploads (280,000:23, over 10,000:1), which pushes the design toward heavy caching and CDN delivery for video bytes. But note the *engagement event* write rate (2.8M/sec) is itself enormous — this is not a "write-light" system in general, it's specifically upload-light and event-write-heavy, which shapes the recommendation pipeline in 25.5.

## 25.3 API and data model

**Core endpoints:**

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `POST /videos` | Upload video | multipart file + metadata | `{videoId, status: "processing"}` |
| `GET /videos/{id}/status` | Check transcode status | — | `{status, playbackUrls}` |
| `GET /feed?cursor=` | Get next batch of "For You" videos | — | list of video refs + playback URLs |
| `POST /videos/{id}/events` | Log engagement (like, watch time, skip) | `{type, watchMs}` | 202 Accepted |
| `POST /users/{id}/follow` | Follow a creator | — | 200 OK |

**Core entities:**

- `Video { id, ownerId, caption, tags, status, createdAt, renditionUrls }`
- `EngagementEvent { userId, videoId, type, watchMs, timestamp }` — extremely high volume, append-only.
- `UserProfile { id, followingCount, followerCount, ... }`
- `FeedCandidate` — not a persisted entity but a transient scored item produced by the recommendation pipeline (video ID + score) for a given user's next feed batch.

**SQL vs. NoSQL, by access pattern:**

- **Video metadata** (caption, owner, status) is a moderate-volume, simple-schema, point-lookup-by-ID workload — a relational or key-value store both work; a key-value store (video ID → metadata blob) is a good fit because reads are almost always "give me everything about video X" rather than joins across videos.
- **Engagement events** are enormous in volume (2.8M/sec) and are append-only, time-ordered, and read mostly in aggregate (not by primary key) — this is the textbook case for a wide-column or log-oriented store (e.g., an append-optimized time-series/columnar store) rather than a traditional relational database, which would choke on this write rate long before video metadata or uploads would ever be a bottleneck. This store feeds the recommendation pipeline described in the deep dive, not the user-facing request path directly.
- **The feed itself** is not stored as a persisted list per user (that would mean writing to 200M users' feeds every time a video's score changes, which is infeasible). Instead it's computed on demand per request, as described below.

## 25.4 High-level architecture

```text
Upload path:
  Client -> Upload Service -> Object Storage (raw video)
                            -> Message Queue -> Transcoding Workers -> Object Storage (renditions)
                                                                     -> CDN origin
                                                                     -> Video Metadata Store (status: ready)

View path:
  Client -> Feed Service -> Candidate Generation (from Recommendation Store)
                          -> Ranking Service (scores candidates)
                          -> returns ordered video refs
  Client -> CDN (fetches actual video bytes for each video ref)

Engagement path:
  Client -> Event Ingestion (lightweight, async) -> Message Queue -> Stream Processor
                                                                    -> Recommendation Store (updates signals)
                                                                    -> Engagement counters (likes, views)
```

**Upload/write path:** a creator uploads a raw video, which lands in object storage immediately (so the upload itself succeeds fast) and is handed to a queue for asynchronous transcoding — this decouples "upload succeeded" from "video is watchable," which is the right trade-off since transcoding into multiple renditions takes real time and shouldn't block the uploader.

**Read/view path:** when a user opens the app, the Feed Service does not fetch pre-baked results from a database; it calls a Candidate Generation step (pull a few hundred plausible videos from the Recommendation Store based on the user's known interests) and a Ranking step (score and order them), then returns a page of video references. The client then streams the actual video bytes from the CDN, not from the application servers — the Feed Service only ever returns lightweight metadata and URLs.

**Engagement path:** every like, skip, and watch-duration ping is fired asynchronously (the client doesn't wait for a response beyond a quick "accepted") into a queue, which a stream processor consumes to update both simple counters (like counts) and the recommendation signals used by candidate generation for future requests.

## 25.5 Deep dive: recommendation feed pipeline, transcoding, and pre-fetching

Three problems make this lesson distinct from a generic content platform: producing a feed that feels personalized to 200 million people without pre-computing per-user lists, turning an uploaded file into something playable everywhere, and keeping playback stall-free while scrolling.

### The "For You" feed, conceptually

The core constraint: you cannot pre-compute and store a ranked feed for every user, because any single video going viral (or a user's tastes shifting mid-session) would require rewriting millions of stored feeds. Instead, the feed is generated **on read**, in two stages:

1. **Candidate generation.** Narrow billions of videos down to a few hundred plausible ones for this specific user, cheaply. This typically blends several signals: videos similar (by tags/embeddings) to ones the user recently watched fully or liked; videos currently trending among users with similar engagement patterns; and a small slice of exploration content (new or under-served videos, so the system keeps learning and doesn't trap users in an ever-narrowing loop). This stage runs against a Recommendation Store that's continuously updated from the engagement event stream, not against raw video storage.
2. **Ranking.** Score each candidate with a model that predicts something like "probability this user watches to completion" or "probability of a like," using the user's recent engagement history and the candidate's own signals. This is the stage that's expensive per-item, which is exactly why candidate generation exists first — it's far cheaper to rank a few hundred plausible items than to rank the entire catalog per request.

The engagement events described earlier feed this loop continuously: watch time, replays, and skips are stronger signals than explicit likes (most users never tap "like," but everyone either watches or scrolls past), which is why the event ingestion path is sized for such enormous throughput — it is, in effect, the fuel for the entire personalization system, updated in near-real-time rather than in a nightly batch job, so a video that starts trending in the last hour can start showing up in feeds within minutes rather than the next day.

### Upload and transcoding

A raw uploaded file (varying resolution, codec, bitrate depending on the uploader's device) is not directly playable well across all viewers' devices and network conditions. The transcoding pipeline, triggered asynchronously after upload, does two things: it re-encodes the video into a small set of standard resolutions/bitrates (e.g., 360p/720p/1080p, using an adaptive-bitrate format), and it generates a thumbnail. The output renditions are pushed to object storage and then to the CDN's origin, and only once at least the lowest-bitrate rendition is ready does the video's status flip to "ready to serve" — this lets a video appear in feeds quickly at lower quality while higher renditions finish in the background, rather than making every viewer wait for the full transcode job before the video is watchable at all.

### Pre-fetching for smooth scroll

The single biggest perceived-quality lever for this kind of app is eliminating buffering between swipes. Since the feed is delivered as an ordered list of video references (not one at a time), the client can act on that: while the user watches video N, the client silently begins downloading the first few seconds of video N+1 (and often N+2) in the background, so that by the time the user swipes, playback can start instantly from a local buffer instead of waiting on a network round-trip. This works because feed order is decided ahead of the user reaching each item — the server already told the client "here are your next 10 videos," so the client doesn't need to ask permission to start fetching them early. The trade-off is wasted bandwidth on videos the user skips past in under a second (a very common behavior), which is why most implementations only pre-fetch a short initial segment rather than the full video, and cancel the fetch quickly if a skip is detected.

## 25.6 Bottlenecks and trade-offs

- **Single points of failure.** The Ranking Service sits directly in the feed request path — if it's slow or down, feeds can't be served. Mitigation: a fallback to a simpler, cheaper ranking (e.g., pure trending/popularity, no personalization) when the primary ranking service is degraded, so the app still functions, just less personalized, rather than showing nothing.
- **Hot spots.** A single video going viral concentrates enormous view traffic on one CDN object and enormous write traffic on one video's engagement counters. CDNs handle the read side naturally (edge caching absorbs repeated requests for the same object); the counter side needs the same sharded-counter trick discussed in the e-commerce lesson (split one hot counter into many, aggregate periodically) rather than a single row taking all the writes.
- **Consistency vs. availability.** Almost everything here favors availability and eventual consistency: like counts, follower counts, and feed contents can all be a few seconds stale without anyone noticing. The one place this doesn't apply is upload status — a creator needs a truthful answer about whether their video is ready, so that path stays synchronous and accurate rather than "eventually."
- **What breaks first at 10x/100x scale:** at 10x, the engagement event pipeline is the first thing under real strain (going from 2.8M to 28M events/sec) — this pushes toward more aggressive stream-processing partitioning and probably pre-aggregating some signals at the edge before they even hit the central pipeline. At 100x, video storage/bandwidth costs and CDN capacity become the dominant constraint, likely requiring smarter regional caching (keep only regionally-popular content warm in each edge location rather than replicating everything everywhere).

## 25.7 Summary

A short-video feed platform is defined less by its upload path (small, low-throughput) and more by two other things: an enormous, continuous engagement-event stream that powers recommendations, and a feed that's computed live per request (candidate generation, then ranking) rather than pre-stored per user, because pre-storing feeds for hundreds of millions of users can't keep up with how fast interests and trends shift. Playback smoothness — arguably the actual product — comes from the client pre-fetching the next couple of videos ahead of the swipe, made possible because the server already commits to an ordered batch of upcoming videos.

Natural follow-ups: how would you handle a user with almost no watch history (the "cold start" problem, usually solved with popularity-based candidates until enough signal accumulates), and how would you detect and demote videos in the feed that are only getting engagement from bot accounts or engagement farms.
