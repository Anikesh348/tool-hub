> **Learning goal**
> Design a video-on-demand streaming service like Netflix, and be able to explain the transcoding pipeline, adaptive bitrate streaming, and CDN pre-positioning of content.

## 21.1 Requirements and scope

**Functional requirements**

- Browse/search a fixed catalog of professionally-produced titles (movies, shows) — content is uploaded by the platform, not by end users; this distinction matters and is contrasted explicitly with the YouTube lesson's user-generated-upload model.
- Play a title, with playback adapting smoothly to the viewer's current network conditions.
- Resume playback from where a viewer left off, per title, per profile.
- Support multiple profiles per account with separate watch history/recommendations.

**Out of scope**: the recommendation model's internals beyond a conceptual mention (an extension of the same offline-compute/fast-read pattern used for recommendations in the Spotify lesson), account/billing, content licensing/catalog-availability-by-region logic, live streaming/events. This lesson's core is the on-demand video pipeline, not the surrounding product surface.

**Non-functional requirements**

- **Playback must start quickly and never stall (buffer) if avoidable** — this is the single most important quality metric for a video product; even a technically correct system that buffers frequently would be considered a failed design here.
- **Playback must adapt to network conditions in real time** — a viewer's bandwidth can change mid-playback (moving from WiFi to cellular, network congestion), and the system must degrade video quality gracefully rather than stall.
- **High availability for playback, catalog can tolerate brief staleness** — a newly added title showing up in search a minute late is fine; a title failing to play is not.
- **Massive, predictable-in-advance bandwidth demand** — unlike a live/user-generated platform, content exists and is known well before viewers request it, which is a property this design exploits heavily (see 21.5).
- **Global reach, uneven demand geographically** — a title's popularity varies enormously by region and can spike sharply at release time, which shapes CDN placement decisions.

## 21.2 Scale estimation

Assumptions:

- 250 million subscribers, ~180 million DAU.
- Average viewing time per DAU: 2 hours/day.
- Catalog size: ~15,000 titles (much smaller than a user-generated platform's catalog — this is a deliberate and important scale contrast with the YouTube lesson).
- Each title is encoded at multiple resolutions/bitrates (a typical "ladder" might span from very low bitrate for poor connections up through 4K for the best); assume an average of 6 encoded variants per title, and average source file size of 50 GB per title before encoding (raw/mezzanine quality).

**Traffic (streaming, not encoding)**

- 180M DAU × 2 hours/day of viewing ≈ 360 million viewing-hours/day.
- Average bitrate across the mix of resolutions actually watched (most viewers are on mid-tier connections, weighted average): assume ~3 Mbps blended.
- Bandwidth: 360,000,000 hours × 3,600 sec/hour × 3 Mbps ÷ 8 (bits to bytes) ≈ roughly 480 PB/day of video egress. This number, even accounting for it being a rough order-of-magnitude estimate, is the single most important number in this lesson — it is what makes CDN design (not the application backend) the dominant engineering problem for this system.

**Storage (encoded catalog)**

- 15,000 titles × 6 encoded variants × (average encoded size per variant, call it 5 GB for a feature-length title at a given bitrate) ≈ 450 TB for one full copy of the encoded catalog — modest in absolute terms compared to the egress number above, which is precisely why the design leans towards **replicating the entire encoded catalog widely** (many copies, close to viewers) rather than trying to optimize storage efficiency: storage is comparatively cheap, and egress/latency is the expensive, user-facing constraint.

**Encoding (transcoding) workload**

- New/updated content arrives far less frequently than it's watched — assume a few hundred new source titles per week needing encoding. This is a batch, offline, non-latency-sensitive workload (nobody is waiting in real time for a newly licensed film to finish encoding within seconds), which is an important contrast to the streaming/serving path and shapes the pipeline design in 21.5.

These numbers set up the two central themes: playback must be built around adaptive, chunked delivery to survive real-world network variability, and the CDN/content-placement strategy is the dominant system-design problem given a bandwidth number in the hundreds of petabytes per day against a comparatively small and stable catalog.

## 21.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `GET /titles/{id}/manifest` | Get the adaptive streaming manifest for a title | — | `{qualityLadder: [...], segmentBaseUrl}` |
| `GET /cdn/titles/{id}/{quality}/segment/{n}` | Fetch one video segment | — | binary video segment |
| `POST /playback-progress` | Report resume position | `{profileId, titleId, positionSec}` | `{success}` |
| `GET /profiles/{id}/continue-watching` | Get resume points across titles | — | `{items: [...]}` |
| `GET /catalog/search?q=...` | Search the catalog | — | `{titles: [...]}` |

**Core entities**

- `Title { titleId, name, metadata, availableQualities[], regionsAvailable[] }`
- `EncodedAsset { titleId, quality, codec, segmentManifestUrl }` — one row per encoded variant of a title; the actual bytes live in object storage/CDN, referenced by URL, same pattern used for media across this course.
- `PlaybackProgress { profileId, titleId, positionSec, updatedAt }` — small, frequently updated, per-viewer state.
- `Profile { profileId, accountId, watchHistory[] }`

**SQL vs. NoSQL.** `Title`/`EncodedAsset` metadata is comparatively low-volume (a few thousand titles, a handful of variants each) and changes rarely relative to how often it's read — a relational or simple key-value store both work fine here, and the choice matters far less than it does elsewhere in this course, precisely because this workload is small. `PlaybackProgress`, in contrast, is written very frequently (every few seconds during active playback, across 180 million DAU) but is tiny and simple (a point update keyed by `(profileId, titleId)`) — a key-value store optimized for fast, frequent point writes is the clear fit, the same reasoning applied to location data in the Tinder lesson. The video bytes themselves, as with every media-heavy lesson in this course, are never modeled as database rows — they are objects in storage, addressed by URL from the manifest.

## 21.4 High-level architecture

```text
Content ingest (offline, infrequent)
   |
   v
Transcoding Pipeline --> produces multiple resolution/bitrate variants, chunked into segments
   |
   v
Origin Object Storage
   |
   v
CDN Pre-positioning (push encoded segments out to edge locations, ahead of demand where possible)
   |
   v
CDN Edge Nodes (regionally distributed, close to viewers)
   ^
   |
Client
   |
   |--- GET manifest ---> Streaming/Playback Service --> returns quality ladder + segment URLs
   |
   |--- GET segments ---> CDN Edge (the actual playback data path; bypasses the app backend entirely)
   |
   |--- POST playback-progress ---> App Service --> PlaybackProgress Store (async, low-priority write)
```

**Encoding path (offline, not on the playback critical path).** New content goes through the transcoding pipeline once, producing the full quality ladder and chunked segments, which are written to origin storage and then deliberately pushed out to CDN edges ahead of anticipated demand (detailed in 21.5) rather than waiting passively for the first viewer request to trigger a cache fill.

**Playback path.** A client requests a manifest from the (comparatively lightweight) Streaming/Playback Service, which returns the quality ladder and segment URL pattern; all subsequent segment fetches go directly to the CDN, never touching the application backend — this mirrors the Spotify lesson's audio architecture closely, scaled up for video's much larger bandwidth footprint.

**Progress tracking.** Playback position reports are asynchronous, low-priority, and tolerant of loss (missing one progress update just means resume position is a few seconds less precise) — this is explicitly not on the critical path for playback quality.

## 21.5 Deep dive: transcoding pipeline, adaptive bitrate streaming, and CDN pre-positioning

**The transcoding pipeline.** A single source file (the "mezzanine" or master copy, often very high quality/large) needs to become many different encoded variants before it can be efficiently streamed — different resolutions and bitrates for different network conditions and device types (a phone on cellular needs a very different stream than a TV on fiber), and often multiple codecs for device compatibility. This is a **batch, parallelizable, offline** workload, and treating it that way is the key design decision: because encoding is CPU-intensive but not latency-sensitive (per the scale estimate, new content arrives at a rate of a few hundred titles a week, not thousands per second), the pipeline can be built as a job system — conceptually similar to the distributed job scheduler covered earlier in this course — that fans a single source file out into many independent encoding jobs (one per resolution/bitrate/codec combination), runs them in parallel across a large worker fleet, and reassembles/validates the outputs before publishing. Each output variant is itself chunked into short segments (commonly a few seconds each, the same chunking principle used for audio in the Spotify lesson, just with video's larger segment sizes) with an accompanying manifest describing what's available at each quality level — this chunking is what makes adaptive streaming possible at playback time, described next. Because this whole pipeline runs ahead of any viewer request, its cost and complexity are fully decoupled from the playback-latency budget — a title can take hours to fully encode across its whole quality ladder without any viewer ever noticing, which is a very different constraint profile from, say, a live-streaming system, where encoding has to happen in real time.

**Adaptive bitrate streaming (ABR).** Once a title is segmented into chunks at multiple quality levels, the *client* — not the server — is responsible for choosing which quality to request for each upcoming segment, based on its own observed network throughput and buffer health. Concretely: the client continuously measures how quickly recent segments downloaded, keeps an eye on how much video is already buffered ahead of the current playback position, and uses those two signals to decide the next segment's quality — if download speed comfortably exceeds the current bitrate and the buffer is healthy, it can step up to a higher quality; if throughput is dropping or the buffer is shrinking towards empty, it steps down before a stall actually happens, ideally. This client-driven design is what makes the mid-playback network-condition requirement from 21.1 achievable: because every segment is requested independently and quality can change segment-to-segment, a client on a train losing signal degrades smoothly through several quality steps rather than stalling outright, and recovers by stepping back up once conditions improve — all without the server needing to know anything about the client's network state at all, since the server's only job is to have every quality variant available as static, pre-encoded segments the client can freely choose between. This server/client division of responsibility is worth naming explicitly: the *encoding* side (server, offline) is about producing options; the *adaptation* side (client, real-time) is about choosing among them, and neither side needs deep knowledge of the other's internals — a clean separation that also means adaptation logic can improve over time (better client-side algorithms) without ever touching the encoding pipeline or vice versa.

**CDN pre-positioning.** This is the piece that most distinguishes this lesson from the more reactive, cache-fill-on-miss CDN behavior described for audio in the Spotify lesson. Given the enormous bandwidth number from 21.2 (roughly 480 PB/day) against a comparatively small, *known-in-advance* catalog (15,000 titles, new content arriving on a predictable weekly cadence), the design can afford to be **proactive rather than reactive**: push newly encoded content out to CDN edge locations (or even dedicated appliances co-located within ISP networks, a technique real large-scale video platforms use precisely because of numbers like this one) *before* viewers request it, especially for titles expected to be popular (a major new release, a returning popular series) or for titles known to be in high demand in a specific region. This is only possible because of a property named explicitly in 21.1's non-functional requirements: content exists and is known ahead of viewer demand, unlike, say, a live event or breaking-news content. Pre-positioning trades storage cost (holding copies at many edge locations before they're strictly needed, though this is cheap relative to bandwidth, per 21.2's storage estimate) for a dramatically better cold-start experience — a viewer's very first request for a popular new release is served from a nearby edge cache immediately, rather than the edge needing to fault back to origin storage on a first-request miss the way a reactive cache would. For long-tail, rarely-watched older titles, reactive cache-fill-on-miss (much like the Spotify model) remains the more efficient approach, since pre-positioning every title everywhere would waste edge capacity on content unlikely to be requested from that location — so a mature design uses both strategies, selecting per-title based on predicted popularity and regional demand signals.

## 21.6 Bottlenecks and trade-offs

- **Single points of failure.** Origin storage is the ultimate source of truth for encoded segments; an outage there mainly affects cache-miss traffic for long-tail content and pre-positioning of new releases, while already-pre-positioned popular content keeps streaming fine from edges — a direct benefit of the pre-positioning strategy, which incidentally also reduces blast radius of an origin outage for the content that matters most (currently popular titles).
- **Hot spots.** A major release (a hotly anticipated new season) creates a predictable, enormous, near-simultaneous demand spike — this is exactly the scenario pre-positioning is designed for, since the spike is anticipated rather than organic/unpredictable, unlike, say, Twitter's live-event read spikes, which are more reactive by nature.
- **Consistency vs. availability.** Catalog metadata (title availability, descriptions) favors availability and can tolerate brief staleness; playback progress favors availability over strict consistency too (an occasionally-lost progress update is a minor UX blemish, not a correctness failure); the one place this design is genuinely strict is regional content licensing (a title must not be playable in a region it isn't licensed for), which is a business/legal correctness requirement layered on top of the manifest service rather than a data-consistency concern per se.
- **What breaks first at 10x scale.** Origin storage and the transcoding pipeline's throughput are the first strain points if the *catalog* grows 10x (150,000 titles) rather than just viewership — 10x more titles times the quality-ladder multiplier is a much bigger encoding and origin-storage bill, and the batch encoding pipeline needs proportionally more worker capacity to keep new-content turnaround times reasonable.
- **What breaks at 100x.** If viewership (not catalog size) grows 100x, CDN edge capacity and, more specifically, "last mile" ISP-level bandwidth become the binding constraint well before origin storage or encoding do — at that scale, deeper embedding of CDN infrastructure directly within ISP networks (rather than at regional edge locations one hop further away) becomes necessary to keep the enormous aggregate bandwidth number from overwhelming shared internet backbone capacity.

## 21.7 Summary

This design's defining property is that content is known in advance and stable, which is exploited at every layer: encoding is a slow, offline, batch pipeline entirely decoupled from playback latency; adaptive bitrate streaming pushes quality-selection responsibility onto the client, which can react to real-time network conditions using pre-encoded, chunked segments the server prepared well ahead of time; and CDN placement can be proactive (pre-positioning popular/anticipated content at the edge before it's requested) rather than purely reactive, which is a direct consequence of a small, predictable catalog against an enormous, known-in-advance bandwidth requirement.

Natural follow-ups: how would you extend this design to support live events (which breaks the "content is known in advance" assumption this whole lesson leans on, forcing encoding into a real-time pipeline instead of a batch one), and how would recommendations/continue-watching data flow differ from the Spotify lesson's offline recommendation pipeline given Netflix's much smaller, curated catalog versus Spotify's much larger one — a good test of whether "precompute recommendations offline" needs to be adapted based on catalog size and turnover rate.
