> **Learning goal**
> Design a flight booking system, able to explain how seat inventory stays correct under high-concurrency demand without overbooking beyond intended limits, how search works across multiple airlines and fare classes, and how temporary booking holds are managed.

## 30.1 Requirements and scope

**Functional requirements**

- Search for flights by origin, destination, date, and passenger count, across multiple airlines and fare classes (economy, premium, business).
- View seat availability and price for a specific flight and fare class.
- Hold a seat temporarily while a passenger completes payment details.
- Confirm a booking (charge payment, issue a ticket) or release the hold if the passenger abandons checkout.
- View/manage an existing booking.

**Non-functional requirements**

- **No overselling beyond the intended limit.** Airlines deliberately allow *controlled* overbooking (selling slightly more seats than physically exist, based on predicted no-show rates) — but this must be a deliberate configured number, never an accidental consequence of a race condition letting more bookings through than even the overbooking policy allows.
- **Search must be fast and available**, even though the underlying data (seat maps, fares) changes constantly and comes from many airline systems.
- **Booking holds must expire reliably.** A seat held during checkout but abandoned must become available to others again within a bounded, short time — holding seats indefinitely would let a browsing user block real buyers.
- Correctness of the final confirmed booking matters far more than raw checkout speed — consistent with the pattern seen in the e-commerce and Airbnb lessons.

**Out of scope**

- Fare pricing/yield management algorithms (how airlines decide what to charge) — treated as an external input, not derived here.
- Multi-leg / connecting-flight itinerary construction logic.
- Loyalty programs, check-in, and boarding pass generation.
- Payment processing internals (assumed similar to the payment-system lesson).

## 30.2 Scale estimation

Assumptions for a booking platform aggregating multiple airlines (like an online travel agency):

- 500 partner airlines, each averaging 200 flights/day with an average of 150 seats per flight → 100,000 flights/day, 15 million seats/day system-wide.
- 50 million searches/day across the platform.
- Conversion: 0.5% of searches lead to a completed booking → 250,000 bookings/day.
- Each search typically checks availability across several dozen candidate flights (direct + connecting options) — so one user search can expand into many underlying availability lookups.

**Traffic (requests/sec):**

- Search: 50M/86,400 ≈ 580 req/s average, spiking heavily around holiday booking windows and fare-sale announcements — 5-10x peaks are plausible → ~3,000-5,000 req/s peak.
- Bookings: 250,000/86,400 ≈ 3 req/s average — again, small in raw volume, high in correctness stakes, matching the pattern from e-commerce checkout and Airbnb booking.
- Booking holds: since not every hold converts to a booking, assume a 10x hold-to-booking ratio (many users start checkout, few finish) → ~30 req/s of hold-creation traffic, still modest.

**Storage:**

- Flight/seat inventory: 100,000 flights/day × 150 seats, tracked per fare class per flight for a rolling ~1-year booking horizon (airlines open bookings up to 11 months ahead) → order of a few hundred million seat-inventory rows system-wide at any time. This is a moderate, not huge, number — the challenge here is concurrency and freshness, not raw storage size.
- Bookings: 250,000/day × 365 × ~2 KB ≈ 180 GB/year, small and durable, same profile as other order/booking systems in this course.

**Read:write ratio:** roughly 580:3, close to 200:1 — extremely read-heavy, reinforcing the same architectural split used throughout this course: a fast, cached/aggregated search path decoupled from a small, strongly-consistent inventory/booking path, with search never treated as the source of truth for whether a seat can actually be booked.

## 30.3 API and data model

**Core endpoints:**

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `GET /search?from=&to=&date=&passengers=` | Search flights | query params | list of flight+fare options with price |
| `POST /holds` | Hold a seat during checkout | `{flightId, fareClass, passengerCount}` | `{holdId, expiresAt}` |
| `POST /bookings` | Confirm booking from a hold | `{holdId, paymentToken, passengerDetails}` | `{bookingId, status}` |
| `DELETE /holds/{id}` | Release a hold explicitly (user backs out) | — | 204 |
| `GET /bookings/{id}` | View booking | — | booking details |

**Core entities:**

- `Flight { id, airlineId, origin, destination, departureTime, arrivalTime }`
- `FareClass { flightId, cabinType, totalSeats, soldSeats, heldSeats, price }` — the critical inventory row; note it's tracked per flight *and* per cabin/fare class, since economy and business inventory are independent pools even on the same physical plane.
- `Hold { id, flightId, fareClass, seatCount, expiresAt, status }`
- `Booking { id, flightId, fareClass, passengerDetails, status, confirmedAt }`

**SQL vs. NoSQL, by access pattern:**

- **Search** aggregates data from many airline inventory sources into a queryable form filtered by route, date, and price — this is best served by a search/cache index built specifically for this access pattern (denormalized flight+fare+price documents, refreshed frequently from each airline's inventory feed), not live queries against each airline's live transactional system for every search, which would be far too slow and would hammer systems not built for that read volume.
- **Seat inventory and bookings** need the same guarantee as inventory in the e-commerce lesson and availability in the Airbnb lesson: atomic, transactional check-and-update, because "is there a seat" and "claim a seat" must never be separated into two round-trips. A relational database with row-level locking (or an equivalent atomic conditional-update mechanism) on the `FareClass` row is the right fit — this is a low-volume, high-integrity workload, not one that needs NoSQL-style horizontal write scaling.
- One subtlety specific to this problem: because inventory is naturally partitioned by `(flightId, fareClass)` — bookings on flight A never contend with bookings on flight B — this data is easy to shard for scale without ever needing cross-shard transactions, since a single booking touches at most one flight's one fare class inventory row.

## 30.4 High-level architecture

```text
Search path:
  Client -> Search Service -> Search/Fare Index (aggregated, cached, refreshed from airline feeds)
       -> returns ranked flight+fare options with indicative price

Hold/Booking path:
  Client -> Hold Service -> FareClass inventory DB (atomic seat reservation, per flight+fare)
       -> [on confirm] Booking Service -> Payment Service -> Booking DB
       -> Background job: expire stale holds -> release seats back to FareClass inventory

Airline feed ingestion (background):
  Airline systems -> Feed Ingestion -> Search/Fare Index (async update)
                                     -> FareClass inventory DB (source of truth stays authoritative per airline)
```

**Read path (search):** a search query hits a pre-aggregated, cached index built from periodic feeds pulled from each partner airline's inventory system — this index is intentionally allowed to be a little stale (seconds to low minutes), because search's job is to present good candidate options quickly, not to guarantee a seat is still available at the instant of display.

**Write path (hold then booking):** once a user picks a specific flight and fare, the Hold Service performs the same kind of atomic conditional check-and-decrement used in the e-commerce and Airbnb lessons against the authoritative `FareClass` row, converting a soft "seat count" into a short-lived hold rather than an immediate sale. Only if the user completes payment does the Booking Service convert that hold into a confirmed booking; if the hold expires unused, a background process releases the seats back to available inventory. This hold-then-confirm pattern — rather than "commit immediately, roll back on failure" — is the central design idea of this lesson and is examined in depth below.

## 30.5 Deep dive: seat inventory under concurrency, multi-source search, and hold/timeout management

### Seat inventory consistency and controlled overbooking

The naive "read seat count, check if positive, decrement" approach has the exact race condition covered in the e-commerce lesson, and the fix is the same atomic-conditional-update technique: `UPDATE fare_class SET soldSeats = soldSeats + n WHERE flightId = ? AND fareClass = ? AND (totalSeats + overbookAllowance - soldSeats) >= n`. The single SQL statement, evaluated atomically by the database, is what prevents two concurrent booking attempts from both succeeding past the limit — the second one re-evaluates the condition against the already-updated count and correctly fails if there's no room left.

What's distinctive about flights specifically is the `overbookAllowance` term above: airlines intentionally sell more tickets than physical seats exist, based on statistically predicted no-show rates for a given route (a commuter route on a Monday morning might have a predictable 3-5% no-show rate; a leisure destination on a holiday weekend might have near-zero no-shows and therefore near-zero safe overbooking allowance). The critical design point is that this allowance is a **deliberate, externally-computed input** to the same atomic capacity check — the system doesn't decide to overbook on its own, and overbooking-beyond-the-configured-allowance is exactly as much a bug as overselling in a system with zero overbooking tolerance. The concurrency-correctness problem is identical either way; only the configured ceiling differs.

### Search across multiple airlines and fare classes

A single user search ("New York to London, next Friday") can plausibly need to check availability and pricing against dozens of flight+fare-class combinations across many partner airlines, each of which is a separate external system with its own latency and reliability characteristics — querying all of them live, synchronously, for every user search would make search both slow and fragile (one slow airline partner degrading every search that includes their flights).

The standard solution is to decouple search from live inventory checks almost entirely: each airline partner periodically pushes (or is polled for) a feed of current schedules, fares, and approximate availability, which is ingested and denormalized into a dedicated search index built for exactly the query shape users need — "flights from X to Y on date Z, ranked by price/duration/stops." This index is what search actually queries, giving consistent, fast response times regardless of any individual airline partner's live system health. The trade-off, made explicit and accepted per the non-functional requirements, is that the price and availability shown in search results are *indicative*, not guaranteed — which is exactly why the hold step (next section) exists: it's the moment the system finally checks the authoritative, current inventory before asking the user to commit to payment, and it's normal (if ideally rare) for a shown fare or seat to no longer be available at that point, requiring the user to be shown updated options.

### Booking holds and timeout management

A hold exists to solve a real UX and correctness tension: a user needs a few minutes to enter passenger details and payment information, during which the seat shouldn't be sold to someone else — but holding a seat forever for anyone who starts checkout (and possibly abandons it) would let idle sessions block real demand indefinitely, which is especially damaging for the last few seats on a popular flight.

The mechanism is the same reservation-with-TTL pattern used for inventory and Airbnb date-range holds: creating a hold performs the atomic capacity check (as above) and, if successful, writes a `Hold` record with a short expiry (typically 10-15 minutes, sometimes shorter for high-demand flights) and marks that many seats as held rather than sold — held seats count against availability shown to other users (so search/hold correctly reflects reduced capacity) but haven't generated revenue and aren't yet a confirmed booking. Two events can end a hold: the user completes payment within the window, converting the hold into a confirmed booking and a real `soldSeats` increment (with the held-seat count released back down since it's now represented in `soldSeats` instead); or the hold expires (or the user explicitly cancels), triggering a background job that releases the held seats back to available inventory.

The expiry mechanism itself needs to be reliable at scale — with tens of thousands of holds created per day and most of them not converting, a background sweep needs to efficiently find and release expired holds without scanning the entire holds table on every pass. A common approach is an index on `expiresAt` combined with periodic batch sweeps (e.g., every 30-60 seconds, find and release everything with `expiresAt < now` and `status = 'active'`), or using the TTL/expiry features built into some in-memory stores if holds are tracked there instead of purely in the relational database — either way, the goal is the same: bound how long a seat can be taken out of circulation by an abandoned checkout, without adding meaningful overhead to the hot booking path itself.

## 30.6 Bottlenecks and trade-offs

- **Single points of failure.** The `FareClass` inventory database is the critical path for every hold and booking, mirroring the Inventory DB and Availability DB from the e-commerce and Airbnb lessons — mitigated with replication and failover, kept as a small, focused, strongly-consistent store separate from the much larger, more failure-tolerant search index.
- **Hot spots.** A single high-demand flight (holiday travel, a suddenly-cheap error fare gone viral) concentrates enormous hold/booking traffic on one `(flightId, fareClass)` row, exactly like the hot-SKU and hot-listing problems in earlier lessons — mitigated with the same tools: short lock/transaction duration (the hold pattern already keeps transactions brief), and, for truly extreme spikes, a queue in front of the hold endpoint for that specific flight to serialize demand rather than let thousands of requests contend for the same row simultaneously.
- **Consistency vs. availability.** Search deliberately favors availability and freshness-is-approximate; the hold/booking path deliberately favors consistency, re-validating against authoritative inventory rather than trusting anything search displayed. This is the same split seen in e-commerce and Airbnb, applied to a third domain — by this point in the course it should be recognizable as a general pattern for marketplace/inventory-style systems, not a coincidence.
- **What breaks first at 10x/100x scale:** at 10x, the search index's freshness lag (time between an airline's real inventory changing and the index reflecting it) becomes more visible and more often the cause of failed holds, pushing toward faster feed ingestion cycles. At 100x, the number of partner airlines and the heterogeneity of their feed formats/reliability becomes as much an integration-engineering problem as a scaling one — feed ingestion needs per-partner isolation (one unreliable airline partner's feed shouldn't degrade ingestion for all the others), which starts to resemble the multi-tenancy isolation problem from the Shopify lesson, just applied to data sources instead of storefronts.

## 30.7 Summary

A flight booking system's hard problems concentrate in the same place as the other marketplace-style systems in this course: keeping a small, high-integrity inventory correct under concurrent demand (atomic conditional updates, this time with a deliberate, externally-configured overbooking allowance rather than zero tolerance), serving fast search over data aggregated from many independent, unreliable external sources without querying them live, and bridging the gap between "shown as available" and "actually booked" with a short-lived hold that reserves a seat during checkout and reliably expires if abandoned.

Natural follow-ups: how would you handle a partner airline's schedule change or cancellation affecting already-confirmed bookings (requiring a notification/rebooking workflow that touches confirmed, not just held, inventory), and how would you extend search to rank multi-leg itineraries across different airlines with different fare rules, which multiplies the combinatorial search space well beyond single-flight search.
