> **Learning goal**
> Design a parking garage system (an object-oriented/system-design hybrid), and be able to explain spot allocation strategy, handling concurrent assignment from multiple entrances, and how ticketing and pricing tie together.

## 6.1 Requirements and scope

**Functional requirements**

- A vehicle entering the garage gets assigned an available parking spot appropriate to its size, and receives a ticket.
- A vehicle exiting the garage pays based on duration parked, and the spot is released for reuse.
- The system tracks real-time availability of spots, broken down by type (e.g., compact, large, motorcycle, handicapped).
- Support multiple entrances and exits operating concurrently (a multi-level or multi-entrance garage).

**Non-functional requirements**

- **Correctness under concurrency**: two vehicles must never be assigned the same spot, even if they enter through different entrances at the same instant. This is the central constraint of the whole design.
- **Low latency at entry/exit**: a driver waiting at a gate for a spot assignment or a payment calculation needs a near-instant response — nobody wants to sit at a barrier for seconds.
- **High availability during operating hours**: if the system is down, cars physically cannot enter or exit (the gate is the interface), so this is a hard operational requirement, not a nice-to-have.
- **Moderate scale**: a single garage has a bounded, small number of spots (hundreds to low thousands) — this is a small-scale system compared to the internet-facing designs elsewhere in this course, and that changes what actually matters (concurrency correctness over horizontal scale).

**Out of scope**: reservations made in advance (booking a spot before arrival), integration with a citywide parking-availability app across many garages, and dynamic demand-based pricing (surge pricing) — the pricing model here is a straightforward duration/type-based rate.

## 6.2 Scale estimation

- **Garage size**: assume a large single garage with 2,000 spots across multiple levels and multiple types (say 70% standard, 20% compact, 5% large/oversized, 5% handicapped/motorcycle).
- **Traffic**: assume full turnover roughly twice a day on average (busy garage, e.g., an office building or airport) → **~4,000 entry events and ~4,000 exit events per day**, concentrated heavily around a few peak windows (morning entry rush, evening exit rush) rather than spread evenly — peak entry rate might be 500 cars/hour ≈ **~8 entries/sec** during a 5-10 minute peak burst, which is the number that actually matters for concurrency correctness, not the daily average.
- **Entrances/exits**: assume 4 entrances and 4 exits operating independently and concurrently — this is the direct source of the concurrency problem: with 8 simultaneous entry points, multiple vehicles can request a spot assignment within milliseconds of each other.
- **Data volume**: even at 4,000 events/day, a year of ticket records is roughly 1.5 million rows of small records (a few hundred bytes each) — trivially small, well under what a single relational database instance handles without any special scaling effort.

The scale numbers here are all small in absolute terms compared to internet-facing systems elsewhere in this course — the interesting engineering problem is not throughput or storage, it's correctness under low but real concurrency (a handful of simultaneous requests contending for a shared, finite resource pool).

## 6.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /api/entry` | `{ "entranceId": "E1", "vehicleType": "standard" }` | `{ "ticketId": "T-9931", "spotId": "L2-B14", "entryTime": "..." }` |
| `POST /api/exit` | `{ "ticketId": "T-9931" }` | `{ "durationMinutes": 95, "amountDue": 12.50 }` |
| `GET /api/availability` | — | `{ "standard": 340, "compact": 55, "large": 12, "handicapped": 8 }` |

**Data model**

Core entities:

- `ParkingSpot { id, level, type, status (available/occupied/out-of-service) }`
- `Ticket { id, spotId, vehicleType, entryTime, exitTime (nullable), amountDue (nullable) }`

The access pattern here is small-scale, highly transactional: "atomically claim one available spot matching a type, out of a small known set, and never double-assign it," plus "look up a ticket by ID and update it on exit." This is exactly the pattern a relational database is built for — the requirement for strict correctness under concurrent writes (no two entries claiming the same spot) benefits directly from transactions and row-level locking, which relational databases provide natively (e.g., `SELECT ... FOR UPDATE` or a conditional `UPDATE ... WHERE status = 'available'`). There is no scale pressure here pushing toward a NoSQL key-value store (data volume and request rate are both small, per Stage 6.2) — the requirement pushing the decision is correctness guarantees, not throughput, and a relational database with ACID transactions is the more defensible choice, for once flipping the usual "read-heavy web-scale system" framing used elsewhere in this course.

## 6.4 High-level architecture

```text
Entrance Gate 1..4          Exit Gate 1..4
     |                            |
     v                            v
Entry Service              Exit/Payment Service
     |                            |
     +----------> Spot Allocation Service <----------+
                          |
                          v
                  Relational Database
             (ParkingSpot table, Ticket table)
```

**Entry path**: a vehicle pulls up to an entrance gate and requests entry (a sensor, ticket-dispensing kiosk, or license-plate camera triggers the request, with the vehicle type either detected or selected). The Entry Service calls the Spot Allocation Service, which atomically claims one available spot of the appropriate type in the database (the exact mechanism is the deep dive below), creates a `Ticket` row linking that spot to the new ticket, and returns the ticket and spot number, which the gate prints or displays before raising the barrier.

**Exit path**: a vehicle pulls up to an exit gate and presents its ticket. The Exit/Payment Service looks up the `Ticket` by ID, computes elapsed duration, calculates the amount due from the pricing rules (6.5), and once payment is confirmed, marks the spot as available again and closes out the ticket (sets `exitTime`), then raises the barrier.

Because both entry and exit ultimately mutate the same small, shared table of spot statuses, the database's transactional guarantees are what keep this correct even with multiple gates operating at once — this is worth narrating explicitly rather than glossing over, since it's the crux of the design.

## 6.5 Deep dive: spot allocation under concurrency, and pricing

**The core race condition.** Picture two cars arriving at Entrance 1 and Entrance 3 within the same millisecond, both needing a standard spot, with exactly one standard spot left. If both requests independently run "find an available standard spot" → "assign it" as two separate steps, both could read the same single available spot before either one marks it taken, and both would be assigned the same spot — a real double-booking. Preventing this is the one genuinely hard problem in this design, and it comes down to making "find and claim" a single atomic operation rather than two.

The practical fix is to express the claim as one atomic conditional update rather than a read-then-write:

```text
UPDATE ParkingSpot
SET status = 'occupied'
WHERE id = (
  SELECT id FROM ParkingSpot
  WHERE type = 'standard' AND status = 'available'
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id
```

The `FOR UPDATE SKIP LOCKED` clause (available in databases like Postgres) is doing the real work here: it locks the selected row for the duration of the transaction so no other concurrent transaction can select and claim that same row, and `SKIP LOCKED` means a competing transaction that would otherwise contend for the very same row instead just skips it and picks a different available spot — so two concurrent entry requests naturally resolve to two different spots without either one blocking and waiting on the other, which keeps entry latency low even under the peak burst of ~8 entries/sec from Stage 6.2. If no row is returned, the service knows the garage (or that spot type) is full and returns an appropriate "no availability" response to the gate.

An alternative to database-level locking is an in-memory allocator (e.g., a single service instance holding the live spot-availability state and processing entry requests one at a time through a queue), which avoids database lock contention entirely but reintroduces a single point of failure and a scaling ceiling at exactly one process — worth mentioning as an alternative, but the database-transaction approach is generally preferable here because it doesn't require the application layer to be a single instance to stay correct, and 8 entries/sec is nowhere near enough load to stress a relational database's transactional throughput.

**Spot allocation strategy (which spot to pick, not just "a" spot).** Beyond just avoiding double-booking, a real design should pick *which* available spot intelligently: a simple and effective strategy is nearest-to-entrance-first (minimizing walking/driving distance, improving the driver's experience) or filling lower levels before higher ones (reducing elevator/ramp congestion). This is a straightforward `ORDER BY` addition to the query above (e.g., order candidate spots by distance-from-entrance or level before picking the first available one) and doesn't change the concurrency-safety argument at all, since the atomicity comes from the `FOR UPDATE SKIP LOCKED` claim, not from the ordering.

**Pricing and ticketing.** Pricing is computed at exit time from `exitTime - entryTime`, mapped through a rate table (e.g., first hour flat rate, then per-hour or per-fraction-hour after that, possibly with a daily maximum cap). This is deliberately simple arithmetic done at exit rather than something requiring real-time tracking while the vehicle is parked — the ticket only needs two timestamps and a lookup against a small, mostly-static rate table. The one subtlety worth naming is idempotency at the payment step: if a payment request is retried (e.g., due to a network blip at the gate), the exit service should not double-charge or double-release the spot — checking `Ticket.exitTime IS NULL` before processing an exit, and making the exit update conditional on that, prevents a retried request from being processed twice, the same pattern used more rigorously in the UPI payments lesson later in this course.

## 6.6 Bottlenecks and trade-offs

- **Single points of failure**: the central database is a SPOF for the whole garage — if it's unreachable, no gate can assign a spot or process an exit. Mitigated by standard database high-availability techniques (a replicated standby that can be promoted), and by giving gates a bounded degraded mode (e.g., dispense a generic ticket and reconcile spot assignment once the database is back) rather than fully blocking entry, since a physical barrier blocking traffic has real-world consequences beyond just this system.
- **Hot spots**: the *type* dimension can create contention — if only one handicapped spot remains and multiple gates simultaneously check for it, the `SKIP LOCKED` pattern still resolves this correctly, but the underlying scarcity (not a technical bottleneck, an actual physical one) means one of those requests correctly gets a "no availability" response.
- **Consistency vs. availability**: this design deliberately favors strong consistency over availability, the opposite of most internet-scale designs in this course — a parking garage has a small, exactly-bounded physical resource, and momentarily rejecting an entry request because the database is briefly unreachable is far preferable to occasionally double-assigning a physical spot that only one car can actually occupy.
- **What breaks first at 10x/100x scale**: at 10x the entrances (say, this is now a multi-garage citywide system with 40 entrances), a single relational database instance for all garages combined could become a write bottleneck; the natural fix is partitioning by garage (each garage's spots and tickets are independent of every other garage's, so sharding by `garageId` scales horizontally with no cross-shard transactions needed). This system is a good example of a design that is correctly *not* over-engineered for its actual (small, physically bounded) scale as a single garage.

## 6.7 Summary

The parking garage problem looks like an object-oriented modeling exercise (classes for `Spot`, `Ticket`, `Vehicle`) but its real system-design payoff is concurrency correctness at small scale: multiple entrances racing to claim spots from a shared, finite pool, solved cleanly with an atomic conditional database update (`FOR UPDATE SKIP LOCKED`) rather than a naive read-then-write. Pricing and ticketing are comparatively simple once entry/exit correctness is solid.

Natural follow-ups: supporting advance reservations (which adds a "soft hold" state between available and occupied, with its own expiration), and scaling to a multi-garage system across a city (which, as discussed, is a natural sharding problem once each garage's data is independent).
