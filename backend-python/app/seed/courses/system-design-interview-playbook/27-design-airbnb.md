> **Learning goal**
> Design a booking marketplace like Airbnb, able to explain geospatial + date-range search, how the system prevents two guests from double-booking the same listing on overlapping dates, and how dynamic pricing data flows through the system at a high level.

## 27.1 Requirements and scope

**Functional requirements**

- Hosts list a property with location, price, photos, and an availability calendar.
- Guests search for listings by location, date range, and filters (price, guest count, amenities).
- Guests book a listing for a specific date range.
- Hosts and guests view their upcoming/past bookings.
- Prices can vary per listing per date (dynamic pricing, e.g., higher on weekends or during local events).

**Non-functional requirements**

- **No double-booking.** Two guests must never both successfully book the same listing for overlapping dates — this is the trust-critical correctness requirement, analogous to "no overselling" in the e-commerce lesson but keyed on a *date range* rather than a simple quantity counter, which makes it structurally harder.
- **Search must be fast and highly available**, even though it's answering a genuinely harder query than typical text search: "listings near this location, available for this entire date range, matching these filters."
- Booking correctness matters more than booking latency — a guest can tolerate a couple of seconds to confirm a booking; they cannot tolerate a "confirmed" booking that later turns out to be double-booked.
- Eventual consistency is fine for search results (a listing that was just booked might still appear in search for a few seconds) as long as the booking step itself re-validates before confirming.

**Out of scope**

- Messaging between hosts and guests.
- Reviews and ratings.
- Payments/payouts internals (assume a payment step similar to the payment-system lesson, and don't re-derive it here).
- Host identity verification / trust & safety.

## 27.2 Scale estimation

Assumptions for a large global booking marketplace:

- 6 million active listings worldwide.
- 100 million monthly active users; assume 20 million searches/day.
- Average booking conversion: 1% of searches lead to a booking attempt → 200,000 booking attempts/day.
- Average stay length: 3 nights → each booking blocks 3 date-cells on one listing's calendar.

**Traffic (requests/sec):**

- Search: 20M/86,400 ≈ 230 req/s average, likely 3-5x at peak travel-planning hours in a given region → ~1,000 req/s peak.
- Booking attempts: 200,000/86,400 ≈ 2.3 req/s average — low volume, same pattern as e-commerce checkout: low throughput, extremely high correctness bar.

**Storage:**

- Listings: 6M × ~5 KB (structured fields + description) ≈ 30 GB — trivially small; the bulk of listing-related storage is photos, which belong in object storage/CDN just like the e-commerce catalog.
- Availability calendars: this is the more interesting number. If each listing tracks per-night availability for a 2-year rolling window, that's 6M listings × 730 nights × (a few bytes per night-status) ≈ a few GB — small in raw size, but the *access pattern* (range queries: "is this listing free for these N consecutive nights") matters far more than the byte count, and is the focus of the deep dive.
- Bookings: 200,000/day × 365 × ~1 KB ≈ 73 GB/year — small and durable, similar profile to e-commerce orders.

**Bandwidth:** listing photos dominate, same reasoning as the e-commerce and TikTok lessons — this justifies a CDN for listing images without further discussion.

**Read:write ratio:** roughly 230:2.3, or 100:1 for search vs. booking — strongly read-heavy, which argues for a dedicated, heavily cached/indexed search path decoupled from the booking system's source-of-truth calendar data, mirroring the split made in the e-commerce lesson between catalog/search and inventory/checkout.

## 27.3 API and data model

**Core endpoints:**

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `GET /search?lat=&lng=&radiusKm=&checkIn=&checkOut=&guests=` | Search available listings | query params | list of listings with price for the date range |
| `GET /listings/{id}/availability?from=&to=` | Get a listing's open/blocked nights | — | per-night availability |
| `POST /bookings` | Attempt to book | `{listingId, checkIn, checkOut, guestCount}` | `{bookingId, status}` |
| `GET /hosts/{id}/listings/{id}/pricing` | Host views/edits calendar pricing | — | per-night price overrides |

**Core entities:**

- `Listing { id, hostId, lat, lng, basePrice, amenities, ... }`
- `AvailabilityCalendar { listingId, date, status(open/blocked/booked), priceOverride }` — one logical row per listing per night; this is the entity that must never allow two overlapping bookings to both mark the same nights `booked`.
- `Booking { id, listingId, guestId, checkIn, checkOut, status, totalPrice }`
- `PricingSignal` — not user-facing, an internal aggregate (occupancy rate, local demand, seasonality) that feeds the dynamic pricing engine described in 27.5.

**SQL vs. NoSQL, by access pattern:**

- **Search** needs geospatial queries (nearby listings) combined with filtering — this is a strong fit for a dedicated geospatial/search index (a geohash- or R-tree-based index alongside a text/attribute index), not a plain relational table, because "find listings within radius R matching filters F" is exactly the query shape these indexes are built for and a relational database without geospatial extensions handles poorly at this volume.
- **Availability and bookings** need the opposite: strict, transactional, multi-row consistency (marking a range of nights as booked must be all-or-nothing, and must be checked against concurrent attempts on the same range). This is a strong fit for a relational database with row-level locking or transactions, exactly like the inventory table in the e-commerce lesson — except here "one row" generalizes to "a contiguous range of date rows," which is the crux of the deep dive.
- The search index is deliberately kept as a *derived, asynchronously updated* copy of availability, not the source of truth — the source of truth is the relational availability table, re-checked synchronously at booking time regardless of what the search index said a few seconds earlier.

## 27.4 High-level architecture

```text
Search path:
  Client -> Load Balancer -> Search Service
       -> Geospatial Index (listings by lat/lng)
       -> Availability Cache/Index (derived, async-updated)
       -> returns ranked, available listings + prices

Booking path:
  Client -> Booking Service (orchestrator)
       -> Availability DB (source of truth, transactional range-lock/check)
       -> Payment Service (charge)
       -> Booking DB (create confirmed booking record)
       -> Message Queue -> Notification Service (host/guest emails)

Pricing path (background):
  Booking/Search events -> Stream Processor -> Pricing Signals Store
       -> Dynamic Pricing Service -> writes price overrides into Availability DB
```

**Read path (search):** a guest searches by location and date range; the Search Service queries a geospatial index to find nearby listings, then filters against an availability index that's a cached, asynchronously updated view of the real availability data. This index can lag reality by a few seconds — a listing booked moments ago might still show up — which is fine per the non-functional requirements, because nothing is confirmed yet at this stage.

**Write path (booking):** when a guest submits a booking request, the Booking Service does not trust the search index at all. It goes straight to the Availability DB (the source of truth) and re-validates, atomically, that every night in the requested range is still open, exactly as described in the deep dive below. Only after that succeeds does it proceed to payment and create a confirmed booking record; a queue then handles asynchronous side effects like host/guest notifications, which don't need to block the booking confirmation itself.

**Pricing path:** this runs entirely in the background, off the critical path of both search and booking. A stream processor consumes booking and search events to build demand signals (occupancy rate for an area, search-to-booking conversion, seasonality), and a Dynamic Pricing Service periodically recomputes suggested per-night prices and writes them as overrides into the Availability DB, where they're picked up by search and booking like any other data.

## 27.5 Deep dive: date-range booking consistency, geospatial search, and dynamic pricing

### Preventing double-booking on a date range

This is structurally harder than the e-commerce "don't oversell one unit" problem, because the thing being contended over is not a single counter but a **range of dates**, and two booking requests can conflict even if their date ranges only partially overlap (guest A wants nights 5-8, guest B wants nights 7-10 — these conflict on nights 7-8 even though neither range is contained in the other).

The reliable approach models availability as one row per listing per night (not one row per listing), and treats booking a range as a single atomic transaction that must check *and* update every night in that range together:

```text
BEGIN TRANSACTION
  SELECT status FROM availability
    WHERE listingId = ? AND date BETWEEN checkIn AND checkOut-1
    FOR UPDATE  -- lock these rows for the duration of the transaction
  -- application checks: are all selected nights 'open'?
  -- if not, ABORT (nights conflict, booking fails)
  UPDATE availability SET status = 'booked'
    WHERE listingId = ? AND date BETWEEN checkIn AND checkOut-1
COMMIT
```

The `FOR UPDATE` row-lock (or an equivalent optimistic-concurrency check with a retry) is what makes this safe under concurrency: if two guests attempt overlapping ranges at the same instant, the database serializes them — whichever transaction acquires the row locks first proceeds, and the second one either blocks until the first commits (and then sees the nights as already booked and aborts) or fails immediately with a conflict error to retry against fresh data. This is the date-range generalization of the same principle used for inventory in the e-commerce lesson: never separate "check availability" from "mark unavailable" into two round-trips, because anything that happens between them is a race condition.

One practical wrinkle worth naming: locking many date rows for a long-ish transaction (checking + payment could take a couple of seconds) can create contention on very popular listings during high-demand windows. The common mitigation is the same **reservation-with-TTL** pattern from the e-commerce lesson: mark the requested nights as "pending" (not fully "booked") the instant the range-check succeeds, release the lock quickly, then run payment outside the lock, and only flip "pending" to "booked" (or roll back to "open" on payment failure/timeout) afterward. This keeps the database lock held for milliseconds instead of seconds, while still closing the race window that matters — the moment when nights are known to be free versus claimed.

### Geospatial search with a date filter

Searching "listings near this point, available for these dates" is really two different filtering problems that need to be combined efficiently. The geospatial part is solved with a spatial index — most commonly, dividing the map into a grid of geohash cells (or similar spatial partitioning) so that "nearby" becomes "same or adjacent grid cells," turning an otherwise expensive distance calculation across millions of listings into a cheap lookup against a small number of cells, followed by a precise distance filter only on the shortlisted candidates. The date-availability part is solved by checking the shortlisted candidates against the (asynchronously updated, cached) availability index rather than the geospatial index itself, since availability changes far more often than a listing's location and shouldn't require re-indexing geospatial structure on every booking. The two indexes are combined at query time: get nearby candidates from the geospatial index first (this is normally the more selective filter, cutting millions down to hundreds or thousands), then filter that smaller set by availability and other attributes (price, amenities), which keeps the expensive part of the query — geospatial lookup — cheap and the cheaper part — checking a shortlist's availability — proportional to a small candidate set rather than the whole catalog.

### Dynamic pricing data flow

Dynamic pricing doesn't need to be synchronous or even particularly fresh to be useful — a suggested price that's an hour or a day old is still far better than a static price that never changes. The data flow is intentionally decoupled from the booking-critical path: booking and search activity (searches for an area, bookings completed, listings viewed but not booked) stream into an aggregation layer that computes demand signals per area and per listing (occupancy rate, search-to-book conversion, how far in advance guests typically book for that area). A pricing service periodically (e.g., daily, or on a shorter cycle around known high-demand windows) turns those signals into suggested per-night price overrides and writes them into the same availability/pricing table that search and booking already read from — so from the booking system's point of view, a dynamically-priced night is indistinguishable from any other night with a price override; the complexity of *how* that price was decided is entirely contained in the background pricing pipeline and never leaks into the booking transaction's correctness logic.

## 27.6 Bottlenecks and trade-offs

- **Single points of failure.** The Availability DB is the most critical component, exactly as the Inventory DB was in the e-commerce lesson — every booking depends on it, even though search can keep running (slightly stale) if it's briefly unavailable. Mitigate with synchronous replication and failover for this specific database, even if other parts of the system use weaker guarantees.
- **Hot spots.** A single highly sought-after listing (rare, unique property, major event weekend) can see many simultaneous booking attempts for the same or overlapping date ranges, creating lock contention on that listing's availability rows. The pending-reservation pattern reduces how long locks are held, and beyond that, queuing booking attempts for a specific hot listing (process serially rather than let dozens race for the same lock) can help during known high-demand windows (e.g., a festival weekend going on sale).
- **Consistency vs. availability.** Search deliberately favors availability (serve slightly stale results, fast) while booking deliberately favors consistency (never confirm two overlapping bookings, even if that occasionally means rejecting a request that a stale search result suggested would succeed). This split mirrors the e-commerce lesson closely and is a recurring pattern across marketplace-style systems.
- **What breaks first at 10x/100x scale:** at 10x, the geospatial index and availability cache scale out fine (they're read-optimized and horizontally shardable by region); the Availability DB's transactional booking path is what starts to strain, particularly in geographically concentrated demand spikes (a major event in one city). At 100x, the design likely needs to shard the Availability DB itself by region (since a booking transaction only ever touches one listing's rows, cross-shard transactions are never required), and the pricing pipeline needs to move from periodic batch recomputation to more incremental, streaming updates to keep up with faster-moving demand signals.

## 27.7 Summary

A booking marketplace's hardest problem is date-range booking consistency, solved by modeling availability per-night and treating a booking as a single atomic check-and-update transaction over the requested range, with a short-lived pending reservation to keep lock duration low during payment. Search is deliberately decoupled from that source of truth via a geospatial index plus a cached availability view, favoring speed and availability since the booking step re-validates everything that matters. Dynamic pricing is handled as an entirely asynchronous background pipeline that writes plain price overrides into the same data booking already reads, keeping pricing complexity out of the correctness-critical path.

Natural follow-ups: how would you handle a host editing their calendar (blocking dates, changing prices) concurrently with an in-flight guest booking attempt, and how would you extend search to support flexible date ranges ("any 3 nights in the next month") without scanning every possible window against every listing.

