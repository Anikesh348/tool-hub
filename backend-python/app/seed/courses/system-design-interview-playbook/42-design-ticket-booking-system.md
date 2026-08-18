> **Learning goal**
> Design a ticket booking platform like BookMyShow or Ticketmaster, and be able to explain how seat-level inventory is locked correctly under extreme concurrent demand during a popular on-sale, and how short-lived holds prevent double-booking without permanently blocking seats that a user abandons mid-checkout.

## 42.1 Requirements and scope

**Functional requirements**

- A user can browse shows/events and see a seat map with real-time availability (available, held, booked).
- A user can select one or more specific seats, hold them temporarily while completing checkout, and confirm payment to finalize the booking.
- A held-but-unpurchased seat is automatically released back to availability after a short timeout.
- Two users must never be able to successfully book the same seat.
- A user can view/cancel their own bookings.

**Non-functional requirements**

- **Correctness under extreme concurrency is non-negotiable**: for a popular event's on-sale, thousands of users may attempt to select the same handful of good seats within the same second — the system must guarantee exactly one of them succeeds per seat, with zero tolerance for double-booking (this is a much harder correctness bar than most systems in this course, where "eventually consistent" is acceptable — here it explicitly is not, for the seat-assignment step).
- **Availability during flash-sale spikes**: traffic for a popular on-sale can be 100x+ normal traffic in a very short burst — the system needs to survive this without falling over, even if that means gracefully queuing or rate-limiting users rather than serving everyone instantly.
- **Low perceived latency**: even under load, a user selecting a seat should get fast feedback (available/taken) — a slow, unresponsive seat map during a high-demand on-sale is a poor experience even if correctness holds.
- **No indefinite locks**: a seat held by a user who abandons checkout must become available to others again within a bounded, short time (not require an admin to manually intervene).

**Out of scope**: dynamic/surge pricing, refund and customer-support workflows, marketing/notification systems for on-sale announcements, seat recommendation logic. These are real product features but separate from the core inventory-locking problem this lesson focuses on.

## 42.2 Scale estimation

Stated, round assumptions, with emphasis on the flash-sale case since that's the defining scenario for this system's design:

- **Normal-day traffic**: assume 10 million searches/browsing views per day and 500,000 completed bookings/day across the platform → 500,000 / 86,400 ≈ **~6 bookings/sec** average — genuinely modest, and not the number that drives this design.
- **Flash-sale burst**: the defining scenario is a single popular event (say, a stadium concert with 50,000 seats) going on sale at a specific announced time, with, say, 500,000 interested users attempting to access the sale within the first minute → that's on the order of **thousands of seat-selection attempts per second concentrated on a single event's inventory** for a short, intense window — orders of magnitude above the platform's normal average, and concentrated on a tiny slice of total inventory (one event's 50,000 seats), not spread across the platform. This concentration is the crux of the whole design problem: it's not that the platform overall can't handle the aggregate load, it's that a huge fraction of that load is contending over the same small set of database rows at the same instant.
- **Hold duration**: assume a seat hold lasts 5-10 minutes (enough time to complete payment) — this bounds how long a "reserved but not yet purchased" seat blocks other users, and is a deliberate product/UX trade-off (too short frustrates slow users, too long wastes inventory during high demand).
- **Seat inventory size**: a single large venue might have up to ~100,000 seats; the platform overall might have thousands of upcoming events at any time, but each event's inventory is independent of every other event's — this is an important structural fact: unlike, say, a bank account balance, seat inventory is naturally partitionable by event, and a flash sale for one event never needs to touch another event's inventory.

The dominant insight: this is fundamentally a **highly concentrated write-contention problem** — not a total-throughput problem in the way most systems in this course are — because the hard case is thousands of concurrent attempts to claim rows out of one small, specific set (one event's seat map), not evenly distributed load across a huge dataset.

## 42.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `GET /events/{id}/seats` | — | `{ "seats": [{ "seatId", "status": "available"/"held"/"booked" }, ...] }` |
| `POST /events/{id}/seats/hold` | `{ "seatIds": [...], "userId" }` | `{ "holdId", "expiresAt" }` or `409 Conflict` (some seats unavailable) |
| `POST /holds/{holdId}/confirm` | `{ "paymentToken" }` | `{ "bookingId" }` or `410 Gone` (hold expired) |
| `DELETE /holds/{holdId}` | — | `204 No Content` (explicit release, e.g., user navigates away) |
| `GET /bookings/{userId}` | — | List of the user's confirmed bookings |

The two-step **hold, then confirm** shape (rather than a single "book this seat" call) is deliberate and central to the whole design: it separates "provisionally claim this seat while I complete payment" (needs to be fast and immediately consistent) from "finalize the purchase" (can take longer, e.g., waiting on a payment gateway, without blocking the seat-claiming step at that gateway's speed).

**Data model**

Core entities:

- `Seat { eventId, seatId, status (available/held/booked), holdId (nullable), holdExpiresAt (nullable) }` — one row per seat per event, the hot path of the entire system.
- `Hold { id, eventId, seatIds, userId, expiresAt }`
- `Booking { id, userId, eventId, seatIds, paymentStatus, confirmedAt }`

The `Seat` table's access pattern is the crux of the data-model decision: extremely high write contention (many concurrent attempts to transition specific rows from `available` to `held`) concentrated on a small, well-defined set of rows per event, where correctness (exactly one writer wins per seat) matters far more than raw throughput. This strongly favors a **relational database** for the seat-inventory table specifically, precisely because relational databases provide row-level locking and atomic conditional updates (`UPDATE seats SET status='held' WHERE seat_id=? AND status='available'`) as a first-class, well-understood primitive — exactly the guarantee this system's core correctness requirement demands. This is a case where the access pattern argues strongly *for* SQL over NoSQL: the workload isn't "massive-scale simple point lookups" (the usual case for reaching for a key-value store), it's "a moderate number of rows that need strict, atomic, conditional writes under heavy contention," which is precisely what relational engines are built to guarantee. A NoSQL store can achieve similar guarantees (e.g., conditional writes keyed by seat), but the relational model's native transactional semantics make the correctness argument the most direct to reason about and defend, so it's the natural default answer here.

`Booking` and `Hold` records are comparatively low-volume and benefit from the same relational store for straightforward transactional consistency with the seat inventory they reference (e.g., confirming a hold and creating a booking record should happen atomically together).

## 42.4 High-level architecture

```text
Client (seat map UI)
  -> Load Balancer -> API Gateway (rate limiting / queueing, critical during flash sales)
       -> Seat Service -> Seat Inventory DB (per-event, row-level locking on hold attempts)
                        -> Cache (near-real-time seat-map view for browsing, not the source of truth for holds)
       -> Hold Expiry Worker (background, releases expired holds)
       -> Booking Service -> Payment Gateway (external) -> Booking DB
```

**Seat selection / hold path (the critical, high-contention path)**: a user selects seats and calls the hold endpoint. The Seat Service issues a conditional update against the Seat Inventory DB for exactly those seat rows (`WHERE status = 'available'`), and the database's row-level locking guarantees that if two users' requests race for the same seat, exactly one succeeds and the other gets a clear `409 Conflict` immediately — this is the one place in the whole design where correctness cannot be relaxed, so the design accepts the cost of a synchronous, contention-prone database transaction here rather than trying to make this path eventually consistent.

**Browsing path (much higher volume, lower stakes)**: the seat-map view shown while browsing (before a user commits to a specific seat) is served from a cache that's refreshed frequently but not necessarily perfectly real-time — showing a seat as "available" when it was actually just held a second ago is a minor, self-correcting UX issue (the user's subsequent hold attempt will simply fail with a clear conflict), not a correctness violation, since the *authoritative* check happens at the hold step against the real database, not against the cached view. This split — cached, relaxed-consistency reads for browsing vs. strict, synchronous writes for the actual claim — is what keeps the high-volume, low-stakes browsing traffic from adding load to the contention-sensitive hold path.

**Confirm/payment path**: once a hold succeeds, the user proceeds to payment; the Booking Service coordinates with an external payment gateway and, on success, atomically converts the hold into a confirmed booking (updating the seat's status from `held` to `booked` and writing the booking record) within the same database transaction, so a payment success can never occur without a corresponding permanent seat assignment, and vice versa.

**Hold expiry**: a background worker (or a database-level scheduled job, or a delayed message in a queue set to fire at the hold's expiry time — the same "schedule a delayed check" pattern used for stuck order stages in the food-delivery lesson) periodically finds holds past their `expiresAt` with no confirmed booking and releases those seats back to `available`, making them selectable by other users again.

## 42.5 Deep dive: seat-level locking under extreme concurrent demand

### Why this is harder than typical high-traffic reads

Most systems in this course handle scale by spreading load across many independent shards/keys (users, documents, drivers) where contention on any single record is rare. A flash-sale on-sale inverts this: thousands of concurrent requests genuinely want the *same small set* of rows (the visibly "good" seats — front row, center) at the *same instant*. No amount of horizontal scaling of stateless application servers helps with this specific problem, because the bottleneck isn't compute capacity, it's how many concurrent writers can safely contend for the same database row without either corrupting correctness or serializing to unacceptably slow throughput.

### Pessimistic locking (row-level locks)

The most direct approach: when a hold request arrives, the database takes a row-level lock on the target seat row for the duration of the transaction, so a second concurrent request for the same seat simply waits for the first transaction to complete (and then sees the now-updated status and fails cleanly) rather than racing it. This is straightforward to reason about and directly matches the correctness requirement — but at extreme concentration (thousands of requests genuinely targeting the same handful of rows within milliseconds), lock contention itself becomes a throughput bottleneck: requests queue up waiting for locks rather than failing fast, and a slow transaction (e.g., one waiting on a downstream call before releasing its lock) can back up a long queue of other requests behind it.

### Optimistic concurrency (conditional updates without holding a lock open)

An alternative that scales better under contention: rather than taking an explicit lock and holding it, each hold attempt issues a single atomic conditional update (`UPDATE ... WHERE status = 'available'`, checked and applied as one atomic operation by the database) and simply checks whether it affected a row. If it did, the caller won; if not (another request got there first), the caller immediately gets a clean failure, without ever having waited in a lock queue. This tends to perform better under the flash-sale scenario specifically because it fails fast rather than queuing — a user who lost the race for a seat finds out in milliseconds, not after waiting behind however many other requests were also contending for that row. This is essentially the same "conditional write guarded by expected current state" pattern used for the atomic driver-acceptance step in the ride-hailing lesson and the order-state-transition step in the food-delivery lesson — a recurring, general-purpose building block for "exactly one concurrent actor wins" problems.

### Reducing contention before it reaches the database

Beyond the locking mechanism itself, two complementary techniques reduce how much raw contention the database has to absorb in the first place:

- **A virtual waiting room / queue in front of the booking flow.** For a known, scheduled flash sale, the system can admit users into the actual seat-selection flow at a controlled rate (e.g., a queue that lets users in gradually rather than allowing every one of 500,000 simultaneous requests to hit the seat inventory at once) — this doesn't reduce total demand, but it smooths the *rate* at which contention actually reaches the database, converting an instantaneous spike into a shorter but still bounded stream the system can handle without falling over. This is a product-and-infrastructure decision as much as a pure database one, but it's a standard, well-established mitigation for exactly this kind of predictable, scheduled-demand-spike scenario.
- **Locking at a granularity that matches user intent.** If a user is selecting multiple seats together (e.g., "4 seats together"), locking and validating each seat as an independent, separate transaction risks a partial failure (3 of 4 seats held successfully, the 4th taken by someone else a moment earlier) that then requires rolling back the other 3 — wasteful and a poor experience. Instead, the hold operation should validate and lock the *entire requested set* as a single atomic transaction (all seats must be `available` for the update to succeed; if any one isn't, the whole request fails cleanly and none are held) — a multi-row conditional update, which most relational databases support as one atomic statement/transaction.

### Handling abandoned holds without leaking inventory

Every hold has a bounded lifetime (Section 42.2's 5-10 minute assumption), and the release-on-expiry worker (Section 42.4) is what prevents a user who selects seats and then closes their browser tab from permanently removing those seats from the available pool. This needs to be reliable even under the same flash-sale load that creates the holds in the first place — a burst of holds created in the same narrow time window will also expire in roughly the same narrow window, so the expiry mechanism itself needs to handle a comparable burst of release operations, which is one more reason to prefer a lightweight, delayed-message-based expiry trigger (each hold schedules its own release as a delayed queue message at creation time) over a heavyweight periodic full-table scan that would need to repeatedly re-check every outstanding hold.

## 42.6 Bottlenecks and trade-offs

- **Single points of failure**: the Seat Inventory DB for a given event is the unavoidable single point of coordination for that event's seats — this isn't really avoidable given the correctness requirement (there must be one authoritative place seat status is decided), so mitigation is about making that single coordination point highly available (replicated with fast failover) rather than eliminating it, since eliminating the single point of truth would mean sacrificing the double-booking guarantee itself.
- **Hot spots**: this entire system's defining challenge, as covered throughout Section 42.5 — a single event's seat inventory is inherently a hot spot during its on-sale window. Because events are naturally independent of each other, though, this hot-spot problem doesn't compound across events: partitioning the seat inventory database by `eventId` (each event's seats can live on a different shard) means one event's flash-sale contention doesn't degrade the platform's handling of any other, unrelated event happening at the same time.
- **Consistency vs. availability**: this is one of the clearest examples in this course of a system that must firmly choose consistency over availability for its core operation — a seat hold that's fast but occasionally wrong (double-booked) is unacceptable regardless of how good that trade would look on an availability dashboard, so the design accepts that under truly extreme contention some requests will be slow or rejected outright (via the waiting-room queue) rather than ever risk an incorrect "success."
- **What breaks first at 10x/100x scale**: at 10x flash-sale concurrency, the waiting-room/queueing layer and multi-row atomic hold transactions likely still hold, provided the seat inventory database for that one event is appropriately provisioned (more connections, faster storage) for its short burst window. At 100x, a single event's inventory table itself may need further internal partitioning (e.g., by seating section, so contention for front-row seats doesn't serialize behind contention for a completely different section of the same venue) — trading a small amount of added complexity in the hold-multiple-seats-atomically logic (now potentially spanning partitions) for finer-grained contention isolation.

## 42.7 Summary

The core problem in a ticket booking system isn't scale in the usual sense — it's extreme, concentrated write contention on a small set of rows during a predictable, high-demand event, which is solved with atomic conditional updates (optimistic concurrency, favored over long-held pessimistic locks for its fail-fast behavior under contention), a two-step hold-then-confirm flow that separates fast provisional claiming from slower payment confirmation, bounded-lifetime holds with reliable expiry to avoid permanently leaking inventory, and demand-smoothing techniques like a virtual waiting room to keep the database's actual contention within what it can handle. The relational database's native transactional guarantees are the right tool here specifically because the requirement (exactly one winner per seat, zero tolerance for error) is a correctness problem first and a throughput problem second.

Natural follow-ups an interviewer might raise: supporting seat recommendations/best-available-seat selection (which adds a search/ranking problem on top of the same locking core), and handling secondary markets like resale (which reintroduces the same double-booking-prevention problem in a new context — a resold seat must be atomically transferred, not independently re-listed by two processes).
