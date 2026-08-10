> **Learning goal**
> Design a real-time video conferencing system like Zoom, and be able to explain the trade-offs between P2P mesh, SFU, and MCU architectures for routing live audio/video, and how the system copes with network jitter and packet loss on the media path.

## 40.1 Requirements and scope

**Functional requirements**

- A user can create a meeting and share a join link; other users can join with audio and video.
- All participants see/hear all other participants' live audio and video with low latency.
- A participant can share their screen instead of (or alongside) their camera.
- Meetings can be recorded and made available for playback afterward.
- The system scales from small 1:1 calls up to large meetings with many participants (with, e.g., only a few "active speakers" prominently shown at once).

**Non-functional requirements**

- **Very low latency**: real-time conversation breaks down noticeably above roughly 150-200ms of one-way delay — this is a much tighter latency budget than almost any other system in this course, and it shapes the transport protocol choice itself (favoring UDP-based transport over TCP, discussed below).
- **Resilience to imperfect networks**: packet loss and jitter (variation in packet arrival timing) are the norm, not the exception, for real-world internet connections (home wifi, mobile networks) — the system must degrade gracefully (lower quality) rather than freeze or disconnect.
- **Scalable fan-out**: in an N-person meeting, each participant's audio/video potentially needs to reach N-1 others — this fan-out cost needs to not fall entirely on end-user devices' limited upload bandwidth.
- **Moderate consistency needs elsewhere**: meeting metadata (who's in the meeting, chat messages, recordings) has much more conventional consistency/durability needs than the live media stream itself, and should be treated as a separate concern from the real-time media path.

**Out of scope**: the signaling/authentication details of establishing a call beyond a high-level description, in-meeting chat and reactions, meeting scheduling/calendar integration, breakout rooms. These are real features but layer on top of the core media-routing problem this lesson focuses on.

## 40.2 Scale estimation

Round, explicitly-stated assumptions:

- **Concurrent meetings**: assume 10 million concurrent meetings at global peak (a plausible order of magnitude for a widely used product across time zones), averaging 4 participants each → **40 million concurrent participant streams** at peak.
- **Bandwidth per participant stream**: a reasonable-quality video stream (not top-tier, accounting for adaptive bitrate under real network conditions) is roughly 500 Kbps-1.5 Mbps per direction; audio alone is much cheaper (tens of Kbps). Assume an average of ~800 Kbps per participant's outbound video stream. This is the number that dominates the entire system's infrastructure cost and architecture — not storage, not database throughput.
- **Fan-out cost illustrates the core problem**: in a naive full-mesh design (every participant sends their stream directly to every other participant), a 10-person meeting requires each participant to *upload* their stream 9 times simultaneously — at 800 Kbps per stream, that's over 7 Mbps of sustained upload from a single participant's device, which is unrealistic for most real-world home/mobile connections and gets worse linearly as meeting size grows. This single calculation is the strongest argument in the whole system for why a naive mesh doesn't scale (developed further in Section 40.5).
- **Aggregate media traffic**: 40 million concurrent streams × ~800 Kbps ≈ **32 Tbps** of video traffic alone at global peak if every stream were relayed once — an enormous bandwidth figure that necessitates a globally distributed fleet of media-routing servers positioned close to users (minimizing the distance, and therefore latency and transit cost, packets travel), not a single centralized cluster.
- **Recording storage**: assuming a meaningful fraction of meetings are recorded (say 5%) at a modest bitrate for storage (~500 Kbps combined, lower than live quality since recordings can be re-encoded), average meeting length ~30 minutes → each recording is roughly 100-150 MB; at 10 million meetings/day × 5% recorded, that's **50-75 TB/day** of new recording storage — large, but a conventional object-storage-at-scale problem (the same shape as the Dropbox/S3 lessons), not a novel one.

The dominant insight: this system's binding constraint is **real-time media bandwidth and latency**, at a scale where naive full-mesh routing is mathematically infeasible past a small handful of participants — the entire architecture exists to solve that fan-out problem.

## 40.3 API and data model

**API**

Video conferencing's real-time media path doesn't travel over a conventional request/response API at all — it uses dedicated real-time transport protocols (commonly RTP over UDP, negotiated via a signaling protocol) — but the surrounding control-plane operations are conventional:

| Method & Path / Channel | Request | Response |
| --- | --- | --- |
| `POST /meetings` | `{ "hostId", "scheduledTime" }` | `{ "meetingId", "joinLink" }` |
| `POST /meetings/{id}/join` (signaling) | `{ "userId", "clientCapabilities" }` | `{ "mediaServerAddress", "iceServers", "sessionToken" }` |
| Media stream (RTP/UDP, direct to media server) | Encoded audio/video packets | Routed/mixed packets from other participants |
| `POST /meetings/{id}/recording/start` | (host-authenticated) | `202 Accepted` |
| `GET /recordings/{id}` | — | Signed URL to recorded file (served via object storage/CDN) |

The `join` endpoint is the key control-plane operation: it doesn't carry any media itself, it performs **signaling** — negotiating capabilities and returning the address of the media server the client should actually stream audio/video to/from. This separation (signaling over a conventional API, actual media over a dedicated real-time transport) is fundamental to how every real-time media system is built, not just video conferencing.

**Data model**

- `Meeting { id, hostId, scheduledTime, status }` and `Participant { meetingId, userId, joinedAt, leftAt }` — conventional, low-volume, relational data with clear relationships (a meeting has many participants) — a relational database fits naturally, since this is metadata about calls, not the calls' media content.
- Media itself is never modeled as rows in a database — it's an ephemeral, in-flight stream that a media server relays and, optionally, an encoder writes out as a recording file to object storage. There is no "data model" for a live video frame in the traditional sense; the closest analog is the recording file, whose metadata (`Recording { meetingId, url, durationSec, createdAt }`) is again ordinary relational metadata pointing at an object-storage blob.

The essential data-model lesson for this system is less about SQL-vs-NoSQL (the metadata is small and conventional either way) and more about recognizing that the *interesting* data — live audio/video — doesn't belong in a database at all; it belongs on a specialized real-time transport path, which is why Section 40.4's architecture looks different in shape from every other lesson so far.

## 40.4 High-level architecture

```text
Participant A         Participant B         Participant C
      \                     |                     /
       \                    |                    /
        \                   v                   /
         ------------> Media Server (SFU) <------------
                    (nearest edge location to
                     the meeting's participants)
                            |
                            v
              Signaling/Control Service (meeting metadata,
                            |               join negotiation)
                            v
                     Primary DB (meetings, participants)
                            
              (optional) Recording Pipeline -> Object Storage
```

**Joining a meeting**: a client hits the Signaling/Control Service, which authenticates the user, looks up the meeting, and — critically — returns the address of a nearby **media server** (an SFU, detailed in Section 40.5) rather than handling any media itself. Media server selection is latency-driven: the control service picks a server geographically close to the joining participant (or, more precisely, close to where most of the meeting's existing participants already are, to minimize the added relay hop for everyone), similar in spirit to how a CDN routes a request to a nearby edge location.

**Live media path**: once connected to the assigned media server, each participant's client encodes their own audio/video and sends it as a single upload stream to the media server; the media server relays (without decoding/re-encoding, in the SFU model) each participant's stream out to every other participant who needs it. This is the entire real-time path — it deliberately never touches the control service, the primary database, or any conventional application-tier component, because none of those could meet the latency budget from Stage 1, and none of them need to be involved in relaying a video frame.

**Recording (asynchronous, off the critical path)**: if enabled, the media server (or a dedicated recording worker subscribed to the same streams) writes an encoded copy of the meeting's audio/video to object storage, entirely decoupled from the live relay path — a recording lagging or briefly failing must never affect the live call quality other participants are experiencing.

## 40.5 Deep dive: media routing architectures, and coping with jitter and packet loss

### Three architectures for routing media between participants

**Peer-to-peer (P2P) mesh.** Every participant sends their stream directly to every other participant, with no server in the media path at all. This has real advantages for very small calls (1:1, or maybe 3 participants): zero extra relay latency (media travels directly between the two endpoints that actually need it) and no server infrastructure cost for the provider. But the math from Stage 2 makes the problem obvious: a participant's *upload* bandwidth requirement grows linearly with the number of other participants (each one needs its own copy of your stream), which becomes unrealistic past a handful of people given typical real-world upload bandwidth — this is why P2P mesh is essentially only used for very small calls in practice, not the general case this lesson is designing for.

**Selective Forwarding Unit (SFU).** Each participant uploads their stream *once*, to a media server, which then forwards (relays) that stream to every other participant who needs it — without decoding or re-encoding the media, just relaying the compressed packets. This fixes the P2P upload-bandwidth problem (each participant's upload cost is now constant — one stream out, regardless of meeting size) at the cost of *download* bandwidth still growing with participant count (each participant receives N-1 incoming streams) and a real, non-trivial amount of server bandwidth and compute at the provider's side (the media server is relaying, at scale, the 32 Tbps aggregate figure from Stage 2). The SFU doesn't need to understand or decode the media content to relay it, which keeps its per-stream CPU cost low relative to an MCU (below) — this is the key property that lets one SFU instance handle many simultaneous streams.

**Multipoint Control Unit (MCU).** The server actively decodes every participant's incoming stream, mixes/composites them into a single combined stream (e.g., a single video showing a grid of all participants, and a single mixed audio track), and sends that one combined stream to each participant. This minimizes each participant's *download* bandwidth (just one stream in, regardless of meeting size) at the considerable cost of much higher server-side compute (decoding and re-encoding every stream, for every meeting, is CPU/GPU-intensive at scale) and higher latency (decode-mix-encode adds real processing delay compared to a pure relay).

| Architecture | Uploader bandwidth | Downloader bandwidth | Server compute cost | Added latency | Scales to large meetings |
| --- | --- | --- | --- | --- | --- |
| P2P mesh | Grows with N (poor) | Grows with N (poor) | None | Lowest (direct) | No — breaks down past a handful |
| SFU | Constant (1 stream out) | Grows with N | Moderate (relay only, no transcoding) | Low (relay, no decode/encode) | Yes, the standard choice for most conferencing products |
| MCU | Constant (1 stream out) | Constant (1 stream in) | High (decode + mix + encode every stream) | Higher (processing delay) | Limited by server compute, not bandwidth |

The SFU model is the dominant choice for modern video conferencing products, including at meeting sizes into the dozens or more, because it strikes the best practical balance: it solves the actual bottleneck identified in Stage 2 (uploader bandwidth on real-world consumer connections) without taking on the heavy, expensive server-side compute burden of an MCU. For very large meetings/webinars (hundreds or thousands of viewers), products typically layer further optimizations on top of a base SFU design (e.g., only relaying the current *active speakers'* video in full quality to conserve bandwidth for both server and viewers, sending everyone else at a much lower resolution or as a static thumbnail) rather than switching architectures entirely — this is a bandwidth-management refinement, not a different routing model.

### Handling jitter and packet loss

Real-world networks routinely reorder packets, delay them unpredictably (jitter), and drop some outright (packet loss) — a video conferencing system has to make this invisible, or at least tolerable, to the user, without simply waiting for a resend the way a reliable protocol like TCP would (a resend round-trip is often slower than the frame is even worth waiting for, since it'll already be stale by the time it arrives — which is why real-time media uses UDP-based transport rather than TCP: it's acceptable, even preferable, to drop a late packet rather than block everything behind it).

- **Jitter buffer.** Because packets arrive at uneven intervals even when none are lost, the receiving client holds a small buffer of incoming audio/video packets before playing them out, smoothing out arrival-time variance into a steady playback rate. This buffer is a direct latency-vs-smoothness trade-off: a larger buffer absorbs more jitter but adds more delay; real implementations adapt the buffer size dynamically based on recently observed network conditions (widening it when the network is choppy, narrowing it when it's stable) rather than using one fixed size.
- **Forward Error Correction (FEC).** The sender proactively includes some redundant data alongside the original packets (e.g., extra packets that let the receiver mathematically reconstruct a modest amount of lost data without needing a retransmission), trading a bit of extra bandwidth for resilience against occasional packet loss without adding a round-trip's worth of latency the way requesting a retransmission would.
- **Packet loss concealment.** For loss that FEC couldn't recover, the client can approximate a reasonable substitute rather than leaving a gap — for audio, this often means synthesizing a brief interpolated sound based on the surrounding audio rather than silence or a glitch; for video, reusing/extrapolating from the previous frame briefly rather than showing a corrupted frame.
- **Adaptive bitrate.** The client continuously estimates its available bandwidth and current network quality (from observed packet loss and round-trip time) and signals the sender (or the SFU) to adjust encoding quality accordingly — lowering resolution or frame rate under a degraded connection so the stream keeps flowing smoothly rather than freezing or accumulating an ever-growing backlog behind a bandwidth constraint it can't actually meet at the current quality. This is the same underlying principle as adaptive bitrate streaming for on-demand video, applied to a live, two-way context where the added constraint is that it must react within a second or two, not tens of seconds.

None of these techniques eliminate the underlying network unreliability — they collectively keep its impact below the threshold where a human notices, which is the realistic and correct goal for this kind of system, rather than pursuing a lossless guarantee that would come at the cost of added latency the product cannot afford.

## 40.6 Bottlenecks and trade-offs

- **Single points of failure**: a single media server going down mid-meeting drops every participant currently routed through it — a real availability risk given the media path can't simply "fail over" to another server without briefly interrupting the call. Mitigation is largely about fast reconnection (the client detects the failure and quickly re-signals to get reassigned to a healthy media server, re-establishing streams within a couple of seconds) rather than true seamless failover, since the media itself is inherently ephemeral and can't be replayed from a durable log the way most other data in this course can be.
- **Hot spots**: a very large meeting (hundreds/thousands of participants — a webinar-style use case) concentrates enormous relay bandwidth onto whichever media server(s) host it, well beyond what a typical small meeting requires — mitigated by the active-speaker/selective-relay optimization mentioned above, and in some designs by cascading multiple SFUs together for a single very large meeting (each SFU handles a subset of participants and relays a reduced set of streams to the other SFUs, rather than one SFU handling every participant directly).
- **Consistency vs. availability**: the live media path has essentially no consistency requirement in the traditional sense — a dropped or concealed packet is an acceptable, expected cost of favoring continuous, low-latency delivery over guaranteed complete delivery. The control-plane metadata (meeting records, participant lists) is the opposite — conventional, consistency-favoring behavior is appropriate there since it's low-volume and needs to be correct, not fast in the same sense.
- **What breaks first at 10x/100x scale**: at 10x concurrent meetings, the media server fleet scales by adding more geographically distributed instances (a largely horizontal scaling story, since each meeting's media routing is independent of every other meeting's). At 100x, the harder problem becomes the *placement* of media servers relative to users — thin geographic coverage means participants in underserved regions get routed to a distant server, adding latency that no amount of jitter-buffer tuning can fully hide, which pushes toward a much larger and more geographically fine-grained edge deployment rather than a purely horizontal scale-out of existing locations.

## 40.7 Summary

The defining problem in video conferencing is that live audio/video cannot be routed the way ordinary application data is — it needs a dedicated real-time transport path, and naive full-mesh routing collapses under real-world upload bandwidth constraints past a handful of participants. The SFU model — relay without transcode — is the standard answer because it removes the participant-count-scaling upload problem P2P mesh has, without absorbing the heavy compute cost an MCU's decode-mix-encode approach requires, and a layered set of techniques (jitter buffers, forward error correction, loss concealment, adaptive bitrate) keeps an inherently unreliable network from being noticeable to users, by design accepting some loss rather than paying a latency cost to eliminate it entirely.

Natural follow-ups an interviewer might raise: scaling a single SFU-based meeting to very large webinar sizes (cascading SFUs and aggressive active-speaker-only relay), and end-to-end encryption of media (which constrains what an SFU is allowed to see/manipulate in the stream, since a pure relay-only SFU is naturally compatible with end-to-end encryption in a way an MCU, which must decode content to mix it, is not).
