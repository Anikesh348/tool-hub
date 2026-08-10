> **Learning goal**
> Design a multi-channel notification/fan-out service (push, email, SMS) that other internal systems call into, and be able to explain templating, rate limiting, retries/dedup, and priority handling.

## 15.1 Requirements and scope

**Functional requirements**

- Accept a notification request from an internal caller (e.g., "order shipped," "new comment on your post") and deliver it to a user via one or more channels: push notification, email, SMS.
- Support templated content, so callers send a template id plus parameters rather than hand-crafting text per channel.
- Respect per-user preferences (which channels a user has opted into for which notification types) and per-user rate limits (don't spam someone with 50 push notifications in a minute).
- Retry failed deliveries and avoid sending duplicate notifications for the same logical event.
- Support priority — a security alert ("new login from unknown device") should be delivered ahead of a low-priority marketing notification.

**Out of scope**: authoring/managing templates via a UI, A/B testing notification copy, in-app notification center storage/read-state (a related but separate feature), the actual content of recommendation/marketing campaigns. This is an infrastructure service other systems call, not a marketing platform.

**Non-functional requirements**

- **High throughput, bursty** — a single event (e.g., a platform-wide incident, a viral post) can trigger millions of notifications in a short window; the system must absorb bursts without falling over or delivering everything late.
- **At-least-once delivery with dedup** — better to occasionally retry and suppress a duplicate than to silently drop a notification.
- **Best-effort ordering, not strict ordering** — unlike the WhatsApp lesson, there is no hard requirement that notification A be seen before notification B; priority matters more than strict FIFO order.
- **Provider-agnostic** — push goes through APNs/FCM, email through an SMTP/API provider, SMS through a carrier gateway; the design should not hard-wire assumptions about any one provider, since providers get swapped or added.
- **Respect rate limits, both ours (provider API limits) and the user's (don't annoy people).**

## 15.2 Scale estimation

Assumptions:

- The platform this service supports has 200 million DAU, similar order of magnitude to the earlier lessons.
- Average notification-triggering events per DAU per day: 5 (comments, likes, order updates, etc.) → 1 billion notification requests/day baseline.
- Occasional platform-wide broadcast events (e.g., an announcement) can add a burst of up to 200 million notifications within a few minutes, on top of baseline.

**Traffic**

- Baseline: 1 billion/day ÷ 86,400 ≈ 11,500 requests/second average.
- A 200-million-notification broadcast delivered over, say, a 10-minute target window is 200,000,000 ÷ 600 ≈ 330,000 sends/second sustained for that window — over an order of magnitude above baseline, which is the number that justifies a queue-based architecture with independently scalable workers rather than a design sized only for the average case.

**Storage**

- Each notification request/record (small: userId, templateId, params, channel, status) is maybe 500 bytes with metadata. At 1 billion/day that's ~500 GB/day if every request and its final status is retained — a meaningful volume that argues for a time-partitioned, write-optimized store with a retention policy (e.g., keep delivery logs 30-90 days) rather than indefinite storage in a primary transactional database.

**Provider throughput limits**

- Push/email/SMS providers all impose their own rate limits (SMS gateways especially — often only hundreds to low thousands of messages/second per account before requiring additional provisioning). This is a hard external constraint: even if the internal system can produce 330,000 sends/second, it cannot push all of those out through a single SMS provider account at that rate, so the design must smooth bursts against slower external limits, not just against internal capacity.

These numbers point at the central shape of the design: this is a producer/consumer system built around durable queues, because the write side (accepting notification requests) needs to absorb bursts far faster than the send side (constrained by external provider limits) can drain them.

## 15.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `POST /notifications` | Request a notification be sent | `{userId, templateId, params, priority, dedupKey, channelsRequested?}` | `{notificationId, status: "queued"}` |
| `GET /notifications/{id}` | Check delivery status | — | `{status: sent\|delivered\|failed\|suppressed}` |
| `PUT /users/{id}/preferences` | Update channel opt-ins per notification type | `{prefs: {...}}` | `{success}` |
| `POST /templates` | Register/update a template (internal/admin use) | `{templateId, channelVariants}` | `{success}` |

The `dedupKey` is provided by the caller (e.g., `order-12345-shipped`) so that if the calling service retries its own request due to a timeout, the notification service can recognize "I've already queued this" and suppress the duplicate rather than sending twice.

**Core entities**

- `NotificationRequest { notificationId, userId, templateId, params, priority, dedupKey, createdAt, status }`
- `UserPreference { userId, notificationType, channel, optedIn: bool }`
- `Template { templateId, channelVariants: {push: {...}, email: {...}, sms: {...}} }`
- `DeliveryAttempt { notificationId, channel, attemptNumber, status, providerResponse, timestamp }` — one row per retry attempt, useful for debugging and for the retry/backoff logic in 15.5.
- `RateLimitCounter { userId, channel, windowStart, count }` — ephemeral, high-write, used to enforce per-user rate limits.

**SQL vs. NoSQL.** Split by role again:

- `NotificationRequest` and `DeliveryAttempt` are high-volume, write-once/append-mostly, looked up almost always by a single key (notificationId or userId) — a strong fit for a key-value/wide-column store, the same reasoning used for message and event stores in the WhatsApp and Spotify lessons.
- `UserPreference` and `Template` are low-volume, read far more than written, and benefit from simple key lookups too — either store works, but a relational store is a reasonable default here since the volume doesn't demand anything more, and preferences occasionally benefit from simple structured queries (e.g., admin tooling to look up all users with a given preference).
- `RateLimitCounter` is the odd one out: it needs to support extremely fast increment-and-check operations (is this user over their limit right now) at high concurrency, which is exactly the profile of an in-memory store like Redis rather than a durable database — losing a rate-limit counter on a crash is an acceptable trade (worst case, a user gets a few extra notifications before the limit resets), unlike losing a notification request itself.

## 15.4 High-level architecture

```text
Internal Caller (order service, social service, alerting system, ...)
   |
   v
Notification API  --- dedup check (against dedupKey) --- writes NotificationRequest (durable)
   |
   v
Priority Queues  (separate queue per priority tier: critical / high / normal / low)
   |
   v
Dispatch Workers  --- look up UserPreference, render Template, check RateLimitCounter ---
   |
   -------------------------------------------------------
   |                  |                    |
   v                  v                    v
Push Adapter      Email Adapter        SMS Adapter
   |                  |                    |
   v                  v                    v
 APNs/FCM          SMTP/Email API       SMS Gateway
   |                  |                    |
   -------------------------------------------------------
                       |
                       v
              DeliveryAttempt log --- on failure, requeue with backoff (up to a max) or mark failed
```

**Write path (accepting a request).** A caller posts a `NotificationRequest`. The API layer first checks the `dedupKey` against a short-lived index (e.g., recently-seen keys in a fast store) — if seen before, it returns the existing `notificationId` without re-queuing. Otherwise it durably persists the request and places it on one of several priority queues, then returns `queued` immediately; the caller does not wait for actual delivery, because delivery can take anywhere from milliseconds (push) to tens of seconds (an overloaded SMS provider) and the calling service shouldn't block on that.

**Dispatch path.** Workers pull from queues, always draining higher-priority queues first (see 15.5). For each request, a worker resolves the user's channel preferences (should this even go to SMS, or did the user opt out), renders the appropriate template per channel, checks the user's rate-limit counter, and if everything clears, hands off to the channel-specific adapter, which talks to the actual external provider. The adapter's job also includes respecting the *provider's* rate limits — an adapter is typically itself throttled to match what the provider allows, decoupled from how fast the internal queue could otherwise drain.

**Failure path.** If an adapter call fails (provider error, timeout), the attempt is logged, and the request is requeued with a backoff delay rather than retried immediately in a tight loop — immediate retries against a provider that's already struggling make things worse, not better.

## 15.5 Deep dive: multi-channel delivery, rate limiting, retries/dedup, and priority queuing

**Multi-channel delivery and templating.** The key design idea is to separate "what happened" from "how it's rendered per channel." A caller sends a template id and parameters (e.g., `templateId: order_shipped, params: {orderId, carrier, eta}`), not pre-rendered text — this lets the notification service own formatting differences between channels (push notifications need a short title/body pair with a strict character limit; email supports rich HTML; SMS is plain text with an even tighter length limit) without every calling service needing to know or care about those constraints. It also means a single logical event can safely fan out to multiple channels: the dispatch worker checks `UserPreference` for each channel independently, and only sends where the user is opted in, so "order shipped" might become a push notification for one user and an email for another based purely on preference data, using the exact same upstream request.

**Rate limiting per user.** The goal is to prevent any single user from being flooded — e.g., 50 people commenting on a popular post shouldn't produce 50 pushes to the post's author within a minute. A sliding-window or token-bucket counter per `(userId, channel)` (stored in a fast in-memory store, as noted in 15.3) is checked before each send: if the user is already at their limit for a channel, the dispatch worker either drops the notification, batches it into a digest ("5 new comments" instead of 5 separate pushes), or defers it to the next allowed window, depending on notification type. This is a case where the *type* of notification matters — a security alert should generally bypass or have a much higher rate limit than a "someone liked your photo" notification, which is one of the reasons priority and rate-limit policy are usually configured per notification type rather than as one global rule.

**Retries and deduplication.** Two distinct problems get solved by two distinct mechanisms, and conflating them is a common mistake:

1. *Deduplication* prevents the same logical notification from being created twice, typically because the calling service retried its own request (e.g., after a network timeout it didn't know the first request actually succeeded). The `dedupKey` supplied by the caller is the tool for this — the notification service checks it at admission time, before anything is queued, so a duplicate request never even becomes a second queue entry.
2. *Retries* handle transient failures *after* a request has been legitimately accepted and dispatch was attempted but failed (provider timeout, temporary rejection). This uses exponential backoff (wait longer between each subsequent attempt) with a maximum attempt count, after which the notification is marked `failed` rather than retried forever — for time-sensitive notifications (an OTP code), a short expiry is also applied so a notification isn't usefully "delivered" long after it stopped being relevant, and it's better to fail fast and let the caller decide whether to issue a fresh request.

Both mechanisms lean on the `DeliveryAttempt` log from 15.3, which records every attempt with its outcome — this is what makes retries safe and debuggable rather than a black box, and it's also the audit trail used to answer "did this user actually receive this notification" after the fact.

**Priority queuing.** Not all queues are equal, and treating them equally would mean a burst of low-priority marketing notifications could delay a critical security alert behind it in line. The design uses separate queues per priority tier (e.g., critical, high, normal, low), and dispatch workers are configured to always prefer draining higher-priority queues — a simple and effective approach is strict priority (always fully drain critical before touching high, and so on), sometimes softened with a small guaranteed minimum throughput for lower tiers so they don't starve completely during a sustained burst of critical traffic. Critically, this priority separation also isolates *capacity*: a marketing broadcast to 200 million users (the burst scenario from 15.2) fills the low-priority queue and can take however long it takes to drain, without ever competing for the same worker capacity that critical alerts need — this is why priority is modeled as separate queues rather than a single queue with a priority field that workers sort by, since a single queue under a huge burst can still create head-of-line blocking risk depending on implementation, whereas fully separate queues give a hard capacity guarantee per tier.

## 15.6 Bottlenecks and trade-offs

- **Single points of failure.** The queueing layer itself is the most critical shared component — if it's down, nothing gets dispatched at all. Mitigated with a replicated, durable queue (not an in-memory-only one) so a broker failure doesn't lose queued requests, and with the admission API writing the `NotificationRequest` durably *before* queuing, so even a total queue outage loses no data, only delivery timeliness (a request can be re-queued from the durable log once the queue recovers).
- **Hot spots.** A single user with an extremely popular post (thousands of comments in minutes) is a per-user hot spot on the `RateLimitCounter`; this is exactly why that counter uses a fast in-memory store designed for high-concurrency increments rather than a transactional database row, which would become a lock-contention bottleneck under that load.
- **Consistency vs. availability.** This system leans strongly towards availability and at-least-once delivery: better to occasionally send a duplicate (rare, since dedup catches most cases) or deliver a notification a bit late than to lose one or block the calling service. Rate-limit counters are deliberately allowed to be slightly imprecise (an in-memory counter can lose a few increments on a node failure) because the cost of occasional under-enforcement (one extra notification) is far lower than the cost of adding synchronous coordination to every send.
- **What breaks first at 10x scale.** The SMS/email/push adapter layer is the first constraint — internal queue throughput scales by adding workers, but external provider rate limits don't move just because internal traffic grew, so at 10x scale the design needs either multiple provider accounts/gateways behind a load-balanced adapter, or a more aggressive digesting/batching strategy for lower-priority channels to reduce absolute send volume.
- **What breaks at 100x.** The durable request log and delivery-attempt log become a serious storage and query-cost concern at 100 billion+ requests/day; a 100x design would need aggressive tiered retention (recent data hot and queryable, older data compacted or moved to cold storage) and likely a move from "log every attempt individually" to sampled or aggregated logging for the lowest-priority tiers, reserving full per-attempt logging for higher-priority/security-relevant notifications where auditability matters most.

## 15.7 Summary

This system is fundamentally a producer/consumer pipeline shaped by one asymmetry: acceptance (writing a notification request) can burst far faster than delivery (constrained by external provider limits) can drain. Durable priority queues absorb that mismatch, templating cleanly separates "what happened" from "how each channel renders it," per-user rate limiting and per-type priority protect both the user experience and time-sensitive alerts, and dedup-at-admission plus backoff-retries-after-dispatch solve two different failure modes with two different mechanisms.

Natural follow-ups: how would you support user-controlled digesting (batch multiple low-priority notifications into a single daily/weekly email instead of individual sends), and how would you add delivery-time optimization (e.g., don't push at 3 AM local time unless priority is critical), which introduces per-user timezone and scheduling logic on top of the priority model described above.
