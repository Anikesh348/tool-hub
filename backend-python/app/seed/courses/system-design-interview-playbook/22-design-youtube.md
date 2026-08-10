> **Learning goal**
> Design a user-generated video platform like YouTube, and be able to explain the upload/transcoding pipeline with resumable chunked upload, and how view counts and recommendations flow through the system — contrasted explicitly with Netflix's curated, on-demand-catalog model.

## 22.1 Requirements and scope

**Functional requirements**

- Upload a video from any user (not a curated catalog — anyone can be a publisher, which is the central structural difference from the Netflix lesson, addressed throughout).
- Process an uploaded video into a streamable, adaptive-bitrate format.
- Play a video with adaptive quality, similar in spirit to the Netflix lesson's playback path.
- Track view counts per video.
- Serve basic recommendations ("up next" / homepage) at a conceptual level.

**Out of scope**: comments/community features (a smaller version of the Reddit lesson's comment-tree problem), monetization/ads, content moderation systems, livestreaming, the ML internals of recommendations beyond a conceptual data-flow description. The interesting new material in this lesson, relative to the Netflix lesson already covered, is entirely on the **upload/ingestion** side and the **view-count/recommendation data flow** — playback and CDN delivery reuse the same reasoning already established there and are not re-derived in depth.

**Non-functional requirements**

- **Uploads must be resumable and support very large files reliably over unreliable networks** — a user uploading a multi-gigabyte video on a home or mobile connection should not have to restart from zero after a dropped connection partway through; this is the defining new non-functional requirement this lesson adds beyond the Netflix lesson's playback-only focus.
- **A video should become watchable reasonably soon after upload, but not instantly** — some processing latency (minutes, not milliseconds) is acceptable and expected, unlike playback itself, which must be fast.
- **Massive, unpredictable catalog growth** — unlike Netflix's small, centrally-curated catalog, this platform's catalog grows continuously from millions of independent uploaders, with no advance knowledge of what's coming or how popular it will be — this drives several of the contrasts in 22.5 and 22.6.
- **View counts should be accurate-ish in real time and resistant to trivial manipulation** (e.g., a script repeatedly reloading a video to inflate its count) — exact real-time accuracy is not required, but obvious gaming should be dampened.
- **High availability for playback**, same priority as the Netflix lesson.

## 22.2 Scale estimation

Assumptions:

- 2.5 billion monthly active users, 120 million DAU actively watching.
- 500 hours of video uploaded per minute platform-wide (a widely-cited order-of-magnitude figure for a platform this size) → 720,000 hours of new video/day.
- Average raw uploaded file size: roughly 1 GB per 10 minutes of source footage (varies hugely by resolution, but usable as a blended estimate) → a rough sense of upload volume below.
- Each DAU watches ~40 minutes/day.

**Traffic (uploads)**

- 720,000 hours/day of new footage is a genuinely enormous, continuous ingestion workload — contrast this directly with Netflix's few-hundred-titles-per-week ingestion rate from the prior lesson: this platform's *ingestion* side alone dwarfs an entire on-demand platform's total catalog-refresh rate, which is the single clearest quantitative illustration of why user-generated upload is a fundamentally different scale problem than curated content ingestion.
- Upload storage: 720,000 hours/day × 6 GB/hour (blended raw estimate) ≈ 4.3 PB/day of *raw* uploaded footage arriving, before any encoding — an order of magnitude larger daily inflow than Netflix's entire multi-thousand-title encoded catalog (450 TB, per the Netflix lesson), underscoring that the transcoding *pipeline's throughput*, not just its existence, is the central engineering problem here.

**Traffic (viewing)**

- 120M DAU × 40 min/day ≈ 80 million viewing-hours/day — smaller in aggregate viewing-hours than the Netflix lesson's estimate (that platform has fewer, more engaged, longer-session viewers), but spread across a vastly larger and more unpredictable catalog, meaning caching/CDN hit rates behave differently (see 22.5 and 22.6): a request is far more likely to be for an obscure, rarely-watched video than on a curated platform.

**Storage (encoded catalog, cumulative)**

- Given continuous upload at the rate above, cumulative encoded storage (across an assumed 4-5 quality variants per video, smaller than Netflix's ladder since most user uploads don't need 4K-and-above tiers) grows into the exabyte range over the platform's lifetime — several orders of magnitude beyond Netflix's few-hundred-TB catalog, which is the clearest single number distinguishing these two problems' storage profile even though their *playback* architectures end up looking similar.

These numbers frame this lesson's two areas of genuine novelty relative to the Netflix lesson: the **upload path** needs to be resumable and chunked given the volume and unreliability of user-originated uploads, and the **transcoding pipeline** needs to operate continuously at very high throughput against an unbounded, unpredictable catalog rather than a small, centrally-scheduled one — plus, on the read side, **view counting and recommendations** need a data-flow design of their own, since a platform this size can't treat either as an afterthought.

## 22.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `POST /uploads` | Initiate a resumable upload session | `{filename, sizeBytes}` | `{uploadId, chunkSize}` |
| `PUT /uploads/{id}/chunks/{n}` | Upload one chunk | binary chunk | `{received: n}` |
| `POST /uploads/{id}/complete` | Finalize upload once all chunks received | — | `{videoId, status: processing}` |
| `GET /videos/{id}/manifest` | Get streaming manifest (once processed) | — | `{qualityLadder, segmentBaseUrl}` |
| `POST /videos/{id}/view` | Report a view event | `{watchDurationSec}` | `{}` |
| `GET /recommendations?context=home\|watch_next&videoId?` | Get recommended videos | — | `{videos: [...]}` |

**Core entities**

- `UploadSession { uploadId, userId, totalChunks, receivedChunkIds: set, status }` — tracks partial upload progress; this table exists specifically to support resumability (see 22.5).
- `Video { videoId, uploaderId, title, description, status: processing\|ready\|failed, createdAt }`
- `EncodedAsset { videoId, quality, segmentManifestUrl }` — same shape as the Netflix lesson's entity.
- `ViewEvent { videoId, viewerId/sessionId, timestamp, watchDurationSec }` — high-volume, append-only.
- `ViewCount { videoId, count, lastUpdated }` — the aggregated, displayed count, deliberately separate from the raw event log for the same reasons `TweetStats`/`ScoreAggregate` were kept separate in earlier lessons.

**SQL vs. NoSQL.** `Video` metadata and `UploadSession` state are moderate-volume, benefit from simple key lookups (by videoId or uploadId), and fit a key-value/wide-column store well, consistent with the reasoning used for `Title`/`EncodedAsset` in the Netflix lesson. `ViewEvent` is the highest-volume write in this system by count (every meaningful watch session generates one) and is a clear fit for an append-only, write-optimized store, exactly like `PlayEvent` in the Spotify lesson and `Vote` in the Reddit lesson — the pattern of "raw high-volume event log feeds a periodically-recomputed aggregate" recurs enough across this course that it's worth recognizing as a reusable default whenever a metric needs to be both high-write and displayed at read time.

## 22.4 High-level architecture

```text
Client (uploader)
   |
   |--- POST /uploads, PUT chunks ---> Upload Service --> Chunk Storage (temporary, assembled progressively)
   |                                          |
   |                                (on completion)
   |                                          v
   |                                 Transcoding Pipeline (same batch-job shape as the Netflix lesson)
   |                                          |
   |                                          v
   |                                 Origin Object Storage --> CDN (same playback path as Netflix)
   |
Client (viewer)
   |
   |--- GET manifest, segments -----> same playback path as the Netflix lesson (not re-derived here)
   |
   |--- POST /videos/{id}/view ------> Event Queue --> View-Count Aggregation --> ViewCount Store
   |                                          |
   |                                          v
   |                                 Recommendation Signal Pipeline --> Precomputed Recommendations Store
```

**Upload path.** This is the genuinely new architecture in this lesson relative to Netflix's, detailed fully in 22.5: a client uploads a large file in chunks against a tracked `UploadSession`, and only once all chunks are received does the platform kick off transcoding — functionally the same batch pipeline described in the Netflix lesson, just triggered continuously by unpredictable uploader activity instead of a scheduled content-ingestion process.

**Playback path.** Identical in shape to the Netflix lesson (manifest, then direct-to-CDN segment fetches) — this lesson does not re-derive that reasoning, since the adaptive-bitrate mechanics don't change based on who produced the content.

**View/recommendation path.** View events flow asynchronously into an aggregation step (producing the displayed count) and, separately, into a recommendation signal pipeline (producing the personalized "up next"/homepage candidates) — both are decoupled from the playback path itself so neither adds latency to actual viewing, the same "report async, never block the user-facing action" discipline used for engagement counts throughout this course.

## 22.5 Deep dive: resumable chunked upload, continuous transcoding at scale, and view-count/recommendation data flow

**Resumable chunked upload.** The core problem: a multi-gigabyte upload over a real-world (often mobile) network is likely to be interrupted at some point before completion, and restarting from byte zero every time is both a terrible user experience and wasteful of bandwidth. The fix is to split the upload into fixed-size chunks (client-side, before sending) and track receipt of each chunk independently against an `UploadSession`. Concretely: the client first calls `POST /uploads` to get an `uploadId` and an agreed chunk size, then uploads chunks one at a time (or a few in parallel) via `PUT /uploads/{id}/chunks/{n}`, and the server records each chunk's arrival in `UploadSession.receivedChunkIds`. If the connection drops, the client doesn't need to know or guess what succeeded — it queries the session (or simply retries; a well-designed chunk endpoint is idempotent, so re-uploading an already-received chunk is a safe no-op) and resumes from the first missing chunk rather than the beginning. This is the exact same idempotent-retry discipline used for message sends in the WhatsApp lesson and notification dedup in the Notification Service lesson, applied here to upload chunks instead of whole messages. Chunk size is a real trade-off worth naming: smaller chunks mean less wasted work on a retry (at most one small chunk needs re-sending) but more request overhead; larger chunks mean fewer requests but more to redo if one fails — real systems typically land somewhere in the low tens of megabytes per chunk as a practical middle ground. Once `UploadSession` shows all expected chunks received, `POST /uploads/{id}/complete` assembles them into the final source file and hands off to transcoding — the assembly step itself needs to handle chunks that may have arrived out of order (parallel upload streams don't guarantee sequential arrival), which is why chunks are indexed by number rather than assumed to arrive in sequence.

**Continuous transcoding at very high throughput.** The Netflix lesson already established the *shape* of a transcoding pipeline (batch jobs, parallelized across a worker fleet, decoupled from playback latency) — what's different here is throughput and unpredictability. Netflix's pipeline processes a scheduled, centrally-known trickle of new titles; this platform's pipeline must continuously absorb an unpredictable, enormous, always-on stream of uploads (the 720,000 hours/day figure from 22.2) from millions of independent uploaders with no advance notice of volume or timing. This pushes the pipeline design towards being modeled explicitly as a **queue-fed worker pool that auto-scales with backlog**, much closer in spirit to the distributed job scheduler's dispatch/worker model than to a fixed-capacity batch scheduler sized for a known weekly volume: as completed uploads arrive, they're placed on a transcoding queue, and worker capacity scales based on queue depth rather than a pre-provisioned fixed size, because unlike Netflix's predictable weekly cadence, this platform genuinely cannot forecast upload volume precisely (a viral moment or regional event can spike uploads sharply). A further consequence of "anyone can upload anything": this pipeline needs sensible defaults and limits that Netflix's centrally-curated pipeline doesn't — a maximum resolution/bitrate ceiling per account tier, validation/rejection of malformed or unsupported source files early (before wasting worker capacity on something that will fail), and prioritization logic so a small number of extremely popular/large uploaders don't starve the queue for everyone else, which is a queuing-fairness concern that simply doesn't arise when all content comes from one centrally-managed source.

**View-count and recommendation data flow, contrasted with Netflix.** View counting follows the now-familiar pattern from Reddit's vote counting and Twitter's engagement stats: raw `ViewEvent` records are cheap, high-volume, append-only writes (avoiding any hot-row contention on the aggregate), and a separate aggregation step periodically folds them into the displayed `ViewCount` — with one addition specific to this problem's "resistant to gaming" requirement from 22.1: the aggregation step can apply simple sanity filtering (e.g., discounting repeated views from the same viewer/session within a short window, or requiring a minimum watch duration before a view counts at all) before folding events into the count, something a naive real-time increment-per-request model would have no natural place to do. Recommendations follow the same offline-compute/fast-read split used in the Spotify and Facebook lessons: a signal pipeline consumes `ViewEvent` (and related engagement signals) to build per-user candidate recommendation sets, precomputed and served from a fast store rather than computed live. The interesting contrast with Netflix's version of this same pattern is catalog shape: Netflix recommends across a small (~15,000 title), fully-known, slowly-changing catalog, so its recommendation candidates can reasonably be "all applicable titles, ranked" — a comparatively bounded problem. This platform's catalog is unbounded and constantly growing by millions of new, previously-unseen videos a day, so recommendation candidate *generation* itself needs a first-pass narrowing step (e.g., approximate similarity/clustering over content and engagement signals to produce a manageable candidate pool per user) before any ranking can happen at all — ranking a truly unbounded catalog live, the way one might get away with over Netflix's small catalog, isn't tractable here. This is a good general lesson: the same architectural pattern (precompute candidates offline, rank a bounded set, serve fast) can still require meaningfully different internal machinery depending on how large and how fast-growing the underlying candidate universe is.

## 22.6 Bottlenecks and trade-offs

- **Single points of failure.** The Upload Service and `UploadSession` tracking need to be durable and available continuously — losing session state mid-upload would defeat the entire purpose of resumability, so this state is written durably per chunk, not held only in memory, mirroring the durability discipline used for message state in the WhatsApp lesson.
- **Hot spots.** Unlike Netflix's predictable release-driven spikes, this platform's hot spots are less predictable — a video going unexpectedly viral creates a sudden, organic playback read spike (mitigated the same reactive way as Spotify's audio CDN: popularity itself drives fast cache convergence) and, separately, a popular *uploader's* account can create an upload-side hot spot if they publish frequently, which the transcoding queue's fairness/prioritization logic (22.5) exists partly to contain.
- **Consistency vs. availability.** Upload chunk tracking needs to be accurate (a lost chunk record could silently produce a corrupted final video), so that piece leans towards durability/consistency; view counts and recommendations, as in every other engagement-heavy lesson in this course, lean towards availability and eventual consistency.
- **What breaks first at 10x scale.** The transcoding queue and worker fleet are the first strain point — at 10x upload volume, auto-scaling worker capacity has to react faster and the queue itself needs to be partitioned (e.g., by upload size/priority tier) so a burst of large uploads doesn't starve smaller, faster-to-process ones behind it.
- **What breaks at 100x.** Recommendation candidate generation is the first thing that structurally breaks, not just slows down — at 100x catalog growth, even an approximate first-pass narrowing step (22.5) needs to itself be continuously rebuilt/reindexed against an ever-larger and faster-growing content universe, which pushes towards streaming/incremental index updates rather than periodic full rebuilds, since a full rebuild's cost grows with total catalog size while new content needs to become recommendable soon after upload, not after the next full rebuild cycle.

## 22.7 Summary

This lesson deliberately reuses the Netflix lesson's playback and transcoding-pipeline *shape* wholesale, because adaptive bitrate streaming and chunked, offline encoding don't change based on who produced the content — but it adds two genuinely new problems that only exist because content originates from millions of independent, unreliable uploaders rather than a small curated source: **resumable chunked upload**, which uses per-chunk idempotent tracking so an interrupted multi-gigabyte upload resumes from where it left off instead of restarting; and a **transcoding pipeline sized for unpredictable, continuous, and enormous throughput** rather than a scheduled trickle, with queue-based auto-scaling and fairness controls that a centrally-curated pipeline never needs. View counting and recommendations follow the same offline-aggregation and offline-candidate-generation patterns established elsewhere in this course, but recommendation candidate generation specifically needs an extra narrowing stage because this platform's catalog is unbounded and constantly growing, unlike Netflix's small, mostly-fixed one.

Natural follow-ups: how would you extend the upload pipeline to support live streaming (which, like the equivalent follow-up in the Netflix lesson, breaks the "process fully before anyone watches" assumption this whole lesson relies on), and how would you detect and handle duplicate or re-uploaded content at this scale (a problem this lesson's chunk-based upload tracking doesn't address at all, since it operates per-upload-session, not across the entire catalog).
