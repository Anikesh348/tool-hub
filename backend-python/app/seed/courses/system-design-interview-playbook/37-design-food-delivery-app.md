> **Learning goal**
> Design a food delivery platform like DoorDash, and be able to explain how a three-sided marketplace (customer, restaurant, driver) is matched and coordinated through a shared order state machine, plus how the system computes and updates delivery ETAs in real time.

## 37.1 Requirements and scope

**Functional requirements**

- A customer can browse restaurants near them, view a menu, and place an order.
- A restaurant receives the order, confirms it (or rejects, e.g., if out of stock), and marks it ready for pickup.
- A driver is assigned to the order, picks it up from the restaurant, and delivers it to the customer.
- All three parties can see the live status of the order (placed, confirmed, preparing, ready, picked up, delivered) and an estimated arrival time that updates as the order progresses.

**Non-functional requirements**

- **Consistency across three parties**: the order status must be a single source of truth that customer, restaurant, and driver apps all observe consistently — three parties seeing conflicting states (customer sees "delivered," driver app still shows "en route") is a correctness failure, not just a UX rough edge.
- **High availability**: order placement and status updates are the core of the product; downtime directly blocks revenue for restaurants and drivers, not just the platform.
- **Low latency for status propagation**: when a driver marks a pickup, the customer's ETA should update within seconds, not minutes.
- **Fault tolerance for a stuck stage**: if a restaurant doesn't confirm within a reasonable time, or no driver accepts an assignment, the system must detect this and take a corrective action (escalate, reassign, notify) rather than silently stalling.
- **Read-heavy on status/tracking**: customers refresh or poll their order tracking screen far more often than any single order actually changes state.

**Out of scope**: payment processing and refunds, restaurant menu management tooling, customer support/dispute workflows, promotions and pricing logic. These matter to a real product but are separable from the core matching-and-state-machine problem this lesson focuses on.

## 37.2 Scale estimation

Stated assumptions, kept round:

- **Orders**: assume 5 million orders/day across the platform → 5,000,000 / 86,400 ≈ **~58 orders/sec** average, peaking 4-5x during lunch/dinner rushes in dense metro areas → design for roughly **250-300 orders/sec** peak, concentrated in specific time windows and geographic hot zones (business districts at lunch, residential areas at dinner).
- **Status updates per order**: each order passes through roughly 6-8 state transitions (placed → confirmed → preparing → ready → assigned → picked up → delivered, plus possible driver-location pings along the route) → at 300 orders/sec and ~7 transitions each, that's roughly **2,000 state-change events/sec** at peak, each fanning out to up to three subscribed clients (customer, restaurant, driver) — so actual notification volume is closer to **6,000 pushes/sec** at peak.
- **Driver location during delivery**: similar in spirit to the ride-hailing lesson but at far smaller scale — only drivers actively on a delivery need frequent location pings (say every 5-10 seconds), not the entire driver fleet at all times, since idle drivers waiting for an assignment don't need sub-second position freshness the way an active ride does.
- **Storage per order**: order header, line items, prices, addresses, timestamps for each state transition — roughly 2-3 KB per order including line items. At 5 million orders/day, that's **10-15 GB/day**, or a few terabytes a year — comfortably shardable but not enormous.

The dominant insight: this system's hard problem isn't raw throughput (it's an order of magnitude smaller than the ride-hailing or location-search numbers) — it's **coordinating a consistent, correctly-ordered state machine across three independently-acting parties**, each with their own app, their own failure modes (a restaurant not responding, a driver going offline mid-delivery), and their own need to see accurate status in real time.

## 37.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `GET /restaurants?lat=&lng=` | — | List of nearby restaurants with menus |
| `POST /orders` | `{ "customerId", "restaurantId", "items": [...], "deliveryAddress" }` | `{ "orderId", "status": "placed" }` |
| `POST /orders/{id}/restaurant-action` | `{ "action": "confirm"/"reject"/"ready" }` (restaurant-side) | `200 OK` |
| `POST /orders/{id}/driver-action` | `{ "driverId", "action": "accept"/"picked_up"/"delivered" }` | `200 OK` or `409 Conflict` |
| `GET /orders/{id}/status` | — | `{ "status", "etaMin", "driverLocation" }` (also available as a push/subscribe channel) |

`GET /orders/{id}/status` is described as available over both polling and a push channel (WebSocket or server-sent events) because customer-facing order tracking is exactly the kind of read where clients want live updates without hammering the API with polling requests.

**Data model**

Core entities:

- `Order { id (PK), customerId, restaurantId, driverId (nullable), status, items, deliveryAddress, createdAt }`
- `OrderStateTransition { orderId, fromState, toState, actor, timestamp }` — an append-only log of every transition, which doubles as an audit trail and the basis for computing "where is this order stuck" alerts.
- `Restaurant { id, location, menu, currentCapacity/prepTimeEstimate }`
- `Driver { id, location, status (available/on-delivery/offline) }`

The order record itself is a natural fit for a **relational database**: it has real relationships (order to customer, order to restaurant, order to driver, order to line items), needs transactional guarantees on state transitions (an order should never be readable in an inconsistent partial-update state), and the volume (a few hundred writes/sec at peak) is well within what a well-indexed relational database handles without needing to be NoSQL for throughput reasons. The append-only `OrderStateTransition` log benefits from being modeled explicitly as its own table (or even a separate event log) rather than just overwriting a single `status` field, because the *history* of transitions — not just the current state — is what powers ETA recalculation, stuck-order detection, and dispute resolution.

Driver and restaurant *live* status (available/on-delivery, current prep load) is a smaller, frequently-updated dataset better suited to an in-memory key-value store, following the same reasoning as the ride-hailing lesson's driver-location index — though at this system's much lower throughput, this is more a latency optimization than a hard scaling necessity.

## 37.4 High-level architecture

```text
Customer app        Restaurant app        Driver app
     |                    |                     |
     v                    v                     v
             Order Service (owns the order state machine)
                          |
                          v
              Primary DB (order + transition log)
                          |
                          v
            Event Bus (order state changed)
              /            |            \
   Notification Svc   ETA Service   Driver Matching Service
   (push to all 3       (recompute      (assign nearest
    subscribed parties)  ETA, push)      available driver)
```

**Order placement (write path)**: a customer places an order; the Order Service validates it, writes the order in `placed` state to the primary database, and publishes an event onto an event bus (a message queue/log, e.g., Kafka-style). This event fans out to multiple independent consumers rather than the Order Service directly calling each one — this decoupling matters because the set of things that need to react to a state change (notify clients, recompute ETA, potentially trigger driver matching) is naturally a list of independent concerns, and adding a new consumer later (e.g., an analytics pipeline) shouldn't require touching the Order Service itself.

**State transitions**: each subsequent action (restaurant confirms, restaurant marks ready, driver accepts, driver picks up, driver delivers) goes through the same Order Service, which validates that the transition is legal from the order's current state (Section 37.5 covers this state machine in detail), writes the new state plus a transition-log row, and republishes the event. The Notification Service consumes every state-change event and pushes the update to whichever of the three parties are subscribed to that order, over WebSocket/push notification.

**Read/tracking path**: the customer's order-tracking screen subscribes to the live channel for their order rather than polling the primary database directly on every refresh — this keeps read load off the primary database, which is instead the source of truth that the Order Service and event pipeline write through.

## 37.5 Deep dive: three-sided matching, the order state machine, and real-time ETA

### The order state machine, and why it needs to be explicit

The single most important design decision in this system is modeling the order lifecycle as an explicit, centrally-owned finite state machine rather than letting each of the three client apps maintain its own notion of "what state is this order in." A typical transition graph:

```text
placed -> confirmed -> preparing -> ready_for_pickup -> driver_assigned -> picked_up -> delivered
   |            |
   v            v
cancelled   rejected
```

Two properties make this explicit modeling necessary rather than a nice-to-have:

1. **Only certain transitions are legal from a given state.** A driver cannot mark an order "picked up" if it's still in `preparing` — the restaurant hasn't finished. The Order Service enforces this centrally: every transition request names the current expected state (or the service checks it server-side) and is rejected with a conflict if the order has already moved past or diverged from that state. This is the same principle as the atomic driver-acceptance step in the ride-hailing lesson: a state transition must be a conditional, atomic operation (check-then-set, guarded by the order's current state, ideally as a single conditional database update) so that two near-simultaneous actions — e.g., a restaurant marking "ready" at the same moment a delivery got auto-cancelled for taking too long — can't produce an inconsistent result.
2. **Three independent actors can each only trigger a subset of transitions.** The restaurant can confirm/reject/mark-ready; the driver can accept/pick-up/deliver; the customer can (within limits) cancel. The Order Service is the natural place to enforce which actor is allowed to trigger which transition, because none of the three client apps should be trusted to unilaterally decide the order's state — each only submits an *intent* ("I am marking this ready"), and the server decides whether that intent is currently valid.

**Handling a stuck stage.** Because three independent, sometimes-slow or unresponsive parties are involved, the system needs to detect when an order sits too long in a state waiting on a party that isn't responding — e.g., a restaurant that hasn't confirmed within 2 minutes, or a driver-matching pool with no acceptances within 3 minutes. This is implemented as a timeout watcher: whenever a transition-log row is written, a delayed check (via a scheduled job or a queue message with a delay/visibility timeout) fires later to see if the order has since moved past that stage; if not, it triggers an escalation (re-broadcast the order to more drivers, alert an ops queue for a non-responsive restaurant, or auto-cancel with a notification to the customer). This pattern — write the state, schedule a delayed re-check, cancel the check if the state already moved on — is a common building block anywhere a workflow can silently stall waiting on an external actor.

### Three-sided matching: assigning a driver

Driver assignment for a food delivery order is similar in spirit to the ride-hailing matching problem but has an important twist: **the pickup location (the restaurant) is fixed and known well before the driver needs to be there**, and the *timing* of when a driver should be summoned matters as much as *which* driver.

A naive design assigns a driver the instant an order is placed — but this is often wrong, because if the restaurant takes 20 minutes to prepare the food, a driver assigned immediately either waits idle at the restaurant (wasting their time and the platform's driver-utilization efficiency) or the assignment happens too early relative to actual food readiness. Instead, the Driver Matching Service is triggered off the restaurant's **preparation-time estimate** (either a per-restaurant historical average, or restaurant-provided per-order) — it looks for a driver whose current position and availability mean they can arrive at the restaurant close to when the food will actually be ready, similar to how a JIT (just-in-time) scheduling problem works. This is typically triggered when the order transitions to `preparing`, using an ETA-to-ready estimate to time the driver search rather than triggering it at `placed`.

Once triggered, candidate driver selection follows the same geospatial-nearby-and-available pattern as the ride-hailing lesson (query a geospatial index of currently-available drivers near the restaurant, score by distance/ETA, notify, and use an atomic accept step to prevent double-assignment) — this lesson doesn't repeat that mechanism in full, but the underlying geospatial matching primitive is identical; what's specific to food delivery is *when* to trigger it (tied to food readiness, not order placement) and that it's one leg of a three-party coordination rather than the entire transaction.

### Real-time ETA computation

The customer-facing ETA is a composite of multiple sub-estimates that change as the order progresses through its state machine, not a single number computed once:

| Order stage | ETA components in play |
| --- | --- |
| `placed` / `confirmed` | Restaurant prep-time estimate + expected driver-assignment delay + estimated drive time (restaurant → customer) |
| `preparing` | Prep-time estimate (refined, e.g., restaurant-reported "10 more minutes") + drive time |
| `driver_assigned` / `picked_up` | Live driver location + real-time routing ETA (drive time recalculated continuously from current position, similar in spirit to a maps routing ETA, covered in more depth in the Google Maps lesson) |

The key design point: ETA is not computed once and left static — each state transition is an opportunity to recompute it with fresher information (once a driver is assigned and en route, the ETA becomes dominated by live location and traffic-aware drive time rather than the earlier, coarser prep-time estimate), and the ETA Service listens to the same event bus as the Notification Service so a recomputed ETA is pushed to the customer as part of the same status update rather than as a separate, out-of-sync process. Restaurant prep-time estimates themselves are typically maintained as a rolling historical average per restaurant (and sometimes per menu-item complexity), refined over time rather than fixed — a restaurant that's currently backed up (many simultaneous open orders) should see its live prep-time estimate rise accordingly, which is why `currentCapacity`/load is tracked as part of the restaurant's live state.

## 37.6 Bottlenecks and trade-offs

- **Single points of failure**: the Order Service and its primary database are the SPOF for the entire order lifecycle — every transition from every party goes through it. Mitigated with standard replication/failover, and by keeping the service itself stateless so any instance can process any order's transition (state lives in the database, not in server memory).
- **Hot spots**: lunch/dinner rush concentrates both order volume and driver-matching pressure into narrow time windows and specific geographic zones (business districts, popular restaurant clusters) — this can locally exhaust available drivers even when the platform has plenty of capacity elsewhere. Mitigation includes surge-style dynamic delivery fees to balance demand (the same underlying mechanism as ride-hailing surge pricing) and proactively nudging idle drivers toward zones with known upcoming demand (e.g., near a cluster of popular restaurants at 6pm).
- **Consistency vs. availability**: the order state machine needs strong consistency for its transitions specifically (an order must never appear to be in two states at once to different parties) — this is a case where the design accepts some added latency (a conditional, validated write on every transition) in exchange for correctness, because a stale or conflicting order status is a direct trust problem for the product. Read-side tracking, by contrast, favors availability and low latency — a customer's tracking screen being a couple seconds behind the true state is a minor issue, not a correctness one.
- **What breaks first at 10x/100x scale**: at 10x order volume (~3,000 orders/sec peak), the Order Service and primary database need horizontal scaling (sharding orders by, e.g., a hash of `orderId` or by region, since orders have no natural cross-shard relationships that need joins). At 100x, the timeout-watcher/escalation mechanism itself needs to be distributed and partitioned (a single scheduler checking every in-flight order for staleness stops being feasible), typically by sharding delayed-check scheduling the same way the orders themselves are sharded.

## 37.7 Summary

A food delivery platform's core difficulty is coordinating three independently-acting parties — customer, restaurant, driver — through a single, centrally-owned, strongly-consistent order state machine, with an event-driven pipeline fanning status changes out to notifications, ETA recomputation, and (at the right moment, tied to food readiness rather than order placement) driver matching. The state machine's explicit legal-transition rules and per-actor permissions, plus a timeout/escalation mechanism for stuck stages, are what keep three parties' independent apps from ever observing an inconsistent picture of the same order.

Natural follow-ups an interviewer might raise: batching multiple orders onto one driver route (turning driver assignment into a small routing/scheduling optimization rather than a single-order match), and handling partial order issues (an item is out of stock after confirmation — requiring the state machine to support a mid-flight partial-modification path rather than only forward progress or full cancellation).
