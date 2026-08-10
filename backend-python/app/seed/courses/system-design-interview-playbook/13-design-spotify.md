> **Learning goal**
> Design a music streaming service like Spotify, and be able to explain how audio streaming, CDN placement, playlists, and offline caching fit together.

## 13.1 Requirements and scope

**Functional requirements**

- Stream a song to a client on demand (search or select a track, playback starts quickly).
- Create and edit playlists (add/remove/reorder tracks).
- Support basic recommendations (e.g., a "made for you" or "similar tracks" surface) at a high level — not the full ML pipeline.
- Support offline caching/download of tracks on a client device for playback without a network connection.

**Out of scope**: full recommendation-model training/serving internals, social features (following artists/friends), podcast-specific features, payments/subscriptions, artist-facing upload tooling. Naming these out loud keeps the design focused on the streaming and catalog problem, which is the interesting system-design core.

**Non-functional requirements**

- **Low startup latency** — playback should begin within a few hundred milliseconds of pressing play; users notice buffering immediately and it's the single biggest perceived-quality metric for this product.
- **High availability for playback** — a song failing to play is a much worse experience than a slightly stale playlist edit; this system favors availability and eventual consistency for metadata (playlists, play counts) over strict consistency.
- **Smooth playback under variable network conditions** — mobile networks fluctuate; the system should degrade quality gracefully rather than stall.
- **Durability for user data** (playlists, library) — losing a user's playlist is unacceptable even though losing a few seconds of play-count accuracy is fine.
- **Massive read scale, modest write scale** — the catalog (tens of millions of songs) is read constantly and written to rarely (new releases), which is a classic read-heavy profile that should shape the architecture.

## 13.2 Scale estimation

Assumptions:

- 600 million monthly active users, 200 million daily active users (DAU).
- Average listening time per DAU: 1.5 hours/day, average track length: 3.5 minutes → roughly 25 track-plays per active user per day.
- Catalog size: 100 million tracks.
- Average encoded audio size per track (compressed, e.g., ~128-320 kbps): roughly 5-10 MB per track for a full song; use 7 MB as a blended average across quality tiers.

**Traffic (streaming requests)**

- 200M DAU × 25 plays/day = 5 billion track-plays/day.
- 5B ÷ 86,400 ≈ 58,000 play-starts/second average, with an evening/commute peak of perhaps 2-3x → ~150,000-170,000 play-starts/second at peak.
- Each "play" is not one request — it's a stream of many small chunk requests over the course of the song (see 13.5), so the actual request rate against storage/CDN is far higher than the play-start rate; a 3.5-minute song split into ~10-second chunks is roughly 20 chunk fetches per play, pushing effective chunk-fetch QPS into the low millions at peak.

**Storage (catalog)**

- 100 million tracks × 7 MB average × (multiple bitrate encodings per track, say 4 quality tiers) ≈ 100M × 7MB × 4 ≈ 2.8 PB for audio alone, before replication.
- With replication across regions/CDNs (necessary for the latency goal), effective stored footprint is several times that — this is a clear signal that raw files belong in object storage plus a CDN, not on any application server's local disk.

**Bandwidth**

- 5 billion plays/day × 7 MB average ≈ 35 PB/day of audio egress. This number alone tells us a CDN is not optional — serving that volume from origin servers directly would be both slow (distance to users) and enormously expensive; almost all of it must be absorbed by edge caches close to users.

These numbers point at three decisions used below: audio must be chunked and served from a CDN, popularity is extremely skewed (a small fraction of tracks account for a large fraction of plays) so caching hit rates can be very high, and playlist/user metadata is a small, transactional, low-volume workload that can live in a very different kind of store than the audio itself.

## 13.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `GET /tracks/{id}/manifest` | Get streaming manifest (available bitrates, chunk URLs) for a track | — | `{qualities: [...], chunkBaseUrl}` |
| `GET /cdn/tracks/{id}/{quality}/chunk/{n}` | Fetch one audio chunk | — | binary audio chunk |
| `POST /playlists` | Create a playlist | `{name}` | `{playlistId}` |
| `POST /playlists/{id}/tracks` | Add a track to a playlist | `{trackId, position}` | `{success}` |
| `GET /playlists/{id}` | Get playlist contents | — | `{tracks: [...]}` |
| `GET /recommendations` | Get recommended tracks/playlists for the user | — | `{items: [...]}` |
| `POST /plays` | Report a play event (for counts/recommendations) | `{trackId, timestampMs, durationPlayedMs}` | `{}` (fire-and-forget) |

**Core entities**

- `Track { trackId, title, artistId, albumId, durationMs, availableQualities[] }`
- `Playlist { playlistId, ownerId, name, trackIds[] (ordered) }`
- `User { userId, libraryTrackIds[], libraryPlaylistIds[] }`
- `PlayEvent { userId, trackId, timestamp, msPlayed }` — high-volume, append-only, feeds both play counts and recommendation signals.

**SQL vs. NoSQL.** This is a good example of a design that legitimately needs *both*, for different data:

- Playlists and user library data are relatively low-volume, benefit from transactional guarantees (reordering a playlist, adding/removing tracks shouldn't corrupt under concurrent edits), and have a natural relational shape (users, playlists, tracks, memberships). A relational database is a strong fit here — the write volume from Section 13.2 is nowhere near what would force sharding, and correctness under concurrent edits matters more than raw throughput.
- Play events are the opposite: enormous volume (5 billion/day), append-only, no need for transactions, and the main access pattern is "write fast, aggregate later." A wide-column or log-oriented store (or simply a stream like a message queue feeding into a data warehouse) fits better — trying to run 5 billion transactional writes/day through the same relational system used for playlists would require the whole system to be over-provisioned for a workload that doesn't need its guarantees.
- The audio bytes themselves are not database rows at all — they belong in object storage, referenced by URL from the track's manifest, exactly like the reasoning used for media in the Instagram and WhatsApp lessons.

## 13.4 High-level architecture

```text
Client (mobile/desktop/web)
   |
   |--- metadata calls (playlists, search, recommendations) ---> API Gateway -> App Services -> Metadata DB (SQL)
   |
   |--- "I want to play track T" -----------------------------> Streaming Service
   |                                                                 |
   |                                                                 v
   |                                                        returns manifest: chunk URLs pointing at CDN
   |
   |--- chunk requests (chunk 1, 2, 3, ...) -------------------> CDN Edge Node
   |                                                                 |
   |                                                        (cache miss) v
   |                                                             Origin / Object Storage
   |
   |--- play events (async, batched) --------------------------> Event Queue -> Play-Count & Recommendation pipeline
```

**Read path (playing a song).** The client asks the Streaming Service for a manifest for a track. The manifest lists available bitrates and the URL pattern for chunks (this mirrors how adaptive streaming protocols like HLS/DASH work, covered in more depth in the Netflix lesson). The client then requests chunks directly from the nearest CDN edge, not through the application backend — this is the single most important architectural decision for this problem, because it means the enormous bandwidth number from 13.2 never has to pass through the app servers at all, only through the CDN, which exists precisely to absorb that.

**Write path (playlist edit).** Playlist edits go through the App Services layer to the relational Metadata DB, which is comparatively low-volume and can afford synchronous, consistent writes.

**Play-event path.** Every play (or meaningful chunk of a play, to detect skips vs. full listens) is reported asynchronously to an event queue rather than synchronously blocking playback — playback must never wait on a "did we log this" round trip. Downstream, a pipeline aggregates these events into play counts (for charts, royalties) and into signals used for recommendations. This is explicitly decoupled from the playback path so that a slow or degraded analytics pipeline never causes a song to stutter.

## 13.5 Deep dive: audio chunking, CDN placement, playlist model, and offline caching

**Why chunk audio instead of streaming one file.** If a client requested one large file for a whole track, it would have to wait for enough of that file to download before playback could start, and it would have no way to adapt if the network got worse mid-song. Splitting each track into small chunks (commonly a few seconds each) solves both problems: playback can start as soon as the *first* chunk arrives (low startup latency, directly addressing the non-functional requirement from 13.1), and the client can request the *next* chunk at a different bitrate if it detects the network is struggling — this is the same adaptive idea used in video streaming, just simpler because audio bitrates are much smaller and the "ladder" of quality options is shorter (e.g., low/normal/high/very-high instead of a dozen resolutions). Each track is pre-encoded once, offline, at each supported bitrate, and chunked, so at request time the CDN is just serving static, precomputed files — no on-the-fly transcoding needed for playback, which keeps the hot path cheap.

**CDN placement.** Given the bandwidth number from 13.2 (tens of petabytes/day), the design goal is to serve the overwhelming majority of chunk requests from an edge cache physically close to the listener, never touching origin storage. Two properties make this especially tractable for music, more so than for a long-tail video catalog: (1) popularity is extremely skewed — a relatively small set of currently-popular tracks accounts for a large share of plays at any given time, so a modest amount of edge cache capacity per region can achieve a very high cache-hit rate; (2) tracks don't change, so cache entries never need invalidation, only eventual eviction of cold content, which makes caching straightforward compared to systems with frequently-changing content. Edge nodes are placed in or near major population centers/ISPs; a request first tries the nearest edge, and on a miss, that edge pulls from a regional origin (or object storage) and caches it for subsequent requests — the classic CDN cache-fill pattern. New releases are a predictable spike (a highly anticipated album drop creates an instant surge of demand for a handful of tracks), and this is often handled by pre-warming edge caches ahead of a scheduled release rather than relying on reactive cache-fill under load.

**Playlist and recommendation data model.** A playlist is fundamentally an ordered list of track references owned by a user. The main design wrinkle is supporting efficient reordering without rewriting the whole list on every edit — a common approach is to store position as a sortable value (e.g., a fractional rank or an integer with gaps) rather than a dense array index, so inserting a track between two existing ones only touches one row instead of renumbering everything after it. Recommendations, at the level this lesson covers, are best thought of as a downstream consumer of the `PlayEvent` stream: aggregate listening history (which tracks/genres a user plays, skips, replays) feeds a batch or near-real-time process that produces a ranked list of candidate tracks per user, which is then cached and served quickly from a fast store (similar in spirit to how a feed is precomputed and served, covered in more depth in the Instagram lesson) — the interesting system-design point is that the *serving* of recommendations should be a fast read from a precomputed store, while the *computation* of them can be slow, asynchronous, and decoupled entirely from the playback-latency budget.

**Offline caching on the client.** When a user downloads a track or playlist for offline playback, the client fetches all of that track's chunks ahead of time (typically at a specific bitrate to control storage usage) and stores them encrypted on local storage, along with a small amount of license/DRM metadata that ties playback rights to that device/account. The system-design-relevant part is less about DRM specifics and more about the fact that offline mode turns the client into its own tiny cache with the same eviction concerns as any cache — a storage budget (e.g., "keep the last N downloaded playlists" or a user-set limit), and a policy for what happens to playback rights if the device stays offline too long (typically, downloaded content periodically needs to "phone home" to revalidate a license, striking a balance between offline usability and preventing indefinite offline use of content the user no longer has rights to).

## 13.6 Bottlenecks and trade-offs

- **Single points of failure.** Origin/object storage for audio is the ultimate source of truth; if it's unavailable, CDN cache misses fail even though cache hits keep working — mitigated by high cache-hit rates (from the skew argument above) meaning origin outages are muted for most users, plus standard object storage replication. The Metadata DB is a more classic SPOF risk for playlist edits; mitigated with a primary-replica setup and read replicas for the read-heavy metadata queries (search, browsing).
- **Hot spots.** A viral new release or a major artist's surprise album drop creates a massive, sudden spike of demand for a small number of tracks — exactly the "hot key" problem. Mitigation is pre-warming CDN edges ahead of scheduled releases and, for unscheduled virality, relying on the CDN's own cache-fill-on-miss behavior converging quickly since the very popularity that makes it hot also makes it get cached almost everywhere within the first few requests.
- **Consistency vs. availability.** Playlist metadata favors consistency (a user should see their own edit reflected immediately, and concurrent edits shouldn't silently lose data), while play counts and recommendation signals favor availability and eventual consistency — losing or double-counting a small fraction of play events under a queue hiccup is an acceptable trade for never blocking playback on analytics.
- **What breaks first at 10x scale.** The play-event pipeline is the first strain point — at 10x the play-event volume (50 billion/day), the event queue and downstream aggregation need to scale out partitioning by track or user, and the recommendation pipeline's batch windows may need to shrink or move to a streaming model to keep signals fresh.
- **What breaks at 100x.** CDN edge capacity and regional origin bandwidth become the dominant cost and engineering problem — at 100x traffic, even a high cache-hit rate means enormous absolute egress, pushing towards deeper build-out of edge locations, smarter regional origin placement, and potentially peer-assisted or ISP-embedded caching for the most bandwidth-constrained regions.

## 13.7 Summary

The core of this design is recognizing that "stream a song" and "edit a playlist" are fundamentally different workloads that deserve different storage: audio is large, immutable, read-heavy, and belongs in object storage behind a CDN, served in small adaptive chunks so playback starts fast and survives network changes; playlist and library metadata is small, mutable, and transactional, and belongs in a relational store. Play events sit in between — high volume but simple and append-only — and are decoupled from the playback path entirely so analytics never risk audio quality.

Natural follow-ups: how would you extend this design to support live/collaborative playlists (multiple users editing the same playlist concurrently, which starts to resemble the real-time delivery problem from the WhatsApp lesson), and how would you evolve the recommendation pipeline from batch to near-real-time so a skip or repeat during today's listening session can influence today's recommendations rather than tomorrow's.
