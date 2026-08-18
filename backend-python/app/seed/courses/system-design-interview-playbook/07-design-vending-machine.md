> **Learning goal**
> Design a vending machine as a finite state machine, and be able to explain how modeling its behavior as explicit states and transitions keeps inventory and payment handling consistent, especially around error and edge cases.

## 7.1 Requirements and scope

**Functional requirements**

- A customer selects an item, pays (cash, card, or mobile payment), and the machine dispenses the item.
- The machine tracks inventory per slot and refuses a selection if the slot is empty.
- The machine handles underpayment (prompt for more), overpayment (return change), and mid-transaction cancellation (refund).
- An operator can restock inventory and collect payment records.

**Non-functional requirements**

- **Correctness above all**: a vending machine must never take a customer's money without dispensing the item (or refunding), and must never dispense an item without being paid for — this is a hard constraint, not a soft goal, because it involves real money and physical goods with no easy "undo."
- **Deterministic behavior under interruption**: real-world failures happen constantly (someone pulls the coin return mid-insert, a mechanical jam, power blips) — the system must always be recoverable to a known, safe state.
- **Simplicity and low cost**: unlike the internet-scale systems elsewhere in this course, a vending machine runs on modest embedded hardware, so the design should favor a small, auditable set of states over a complex distributed architecture.
- **Availability is local, not networked**: the machine must keep functioning (at least for cash transactions) even if any backend connectivity for remote monitoring/restocking is temporarily down.

**Out of scope**: remote fleet monitoring dashboards across thousands of machines, dynamic pricing, and loyalty/rewards integration — this lesson focuses on the single-machine transaction logic, which is the interesting part.

## 7.2 Scale estimation

This system is unusual in this course in that its "scale" is almost entirely local to one physical machine, not a distributed backend serving millions of users — so the estimation stage looks different here, and that's worth stating explicitly rather than forcing internet-scale numbers where they don't apply.

- **Transactions per machine**: assume a moderately trafficked machine handles 150 transactions/day → about **1 transaction every 6-7 minutes** on average. This confirms concurrency *within a single machine* is essentially a non-issue — one physical customer interacts with one machine at a time, so there is no meaningful "concurrent request" problem the way there is in the parking garage's multiple simultaneous entrances.
- **Inventory size**: assume 40 slots, each holding up to 10 items → 400 total item capacity, restocked roughly weekly. This is small enough that inventory state is a trivial in-memory or on-device data structure (an array of 40 counters), not something requiring a database in the traditional sense on the machine itself.
- **Fleet scale (if this is one of many machines)**: if a company operates 5,000 machines and each periodically reports sales/inventory to a central backend (say, every 15 minutes), that's roughly 5,000/900 ≈ **5.5 reports/sec** hitting the backend — a small, easily handled load for a central service, confirming the interesting complexity is genuinely in the single-machine state logic, not in backend scale.
- **Payment amounts**: coin/bill denominations and card transaction amounts are small (a few dollars), so the "storage" concern here is really just an accurate running ledger, not data volume.

The takeaway: this problem intentionally has almost no traffic/storage/bandwidth scale pressure — the design challenge is entirely about correctness of a single machine's control flow under all the ways a transaction can be interrupted, which is why modeling it as an explicit finite state machine (7.5) is the right tool.

## 7.3 API and data model

Even though a physical vending machine's primary "interface" is buttons, a coin slot, and a card reader, it's useful to describe its logic as an API — this is exactly how the machine's embedded software (or the backend it reports to) would be structured, and how a remote-monitoring/restocking system would interact with it.

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /machine/select` | `{ "slotId": "B4" }` | `{ "price": 1.75, "state": "AWAITING_PAYMENT" }` |
| `POST /machine/insert-payment` | `{ "amount": 1.00, "method": "cash" }` | `{ "amountReceived": 1.00, "amountDue": 0.75, "state": "AWAITING_PAYMENT" }` |
| `POST /machine/cancel` | — | `{ "refundAmount": 1.00, "state": "IDLE" }` |
| `POST /machine/dispense` | (triggered internally once fully paid) | `{ "state": "DISPENSING" }` → then `{ "state": "IDLE" }` |
| `POST /api/restock` | `{ "slotId": "B4", "quantity": 10 }` (operator-only) | `200 OK` |

**Data model**

Core entities: `Slot { id, itemName, price, quantity }` and `Transaction { id, slotId, amountDue, amountReceived, status, timestamp }`.

On the machine itself, this data is small and local — a simple embedded key-value structure (an array indexed by slot ID) is entirely sufficient, and there's no real SQL-vs-NoSQL decision to make on-device given the trivial scale. Where the decision becomes meaningful is at the **fleet backend** level, if machines report to a central system: transaction and inventory records across thousands of machines are a natural fit for a relational database, because operators need aggregate queries with real relational structure — "total revenue by machine by day," "which slots across the fleet are frequently out of stock," "reconcile payment processor records against dispensed-item counts." Those are join-and-aggregate query patterns, which is the access pattern relational databases are built for, so a relational database is the right choice at the fleet-reporting layer even though the on-device state itself doesn't need one.

## 7.4 High-level architecture

```text
Customer
  -> Physical Interface (buttons, coin slot, card reader, display)
       -> Vending Machine Controller (embedded state machine)
            -> Inventory store (local, per-slot counters)
            -> Payment handler (cash mechanism / card reader integration)
            -> Dispense mechanism (motor/actuator per slot)

  (periodic, async, non-blocking)
       -> Fleet Backend (sales + inventory reporting, restock scheduling)
            -> Relational Database
```

**Transaction path (fully local)**: the customer selects an item, the controller checks inventory and price, transitions into an awaiting-payment state, accepts payment increments, and once the amount received meets or exceeds the price, transitions to dispensing, decrements inventory, computes and returns change if any, and returns to idle. Critically, this entire path executes locally on the machine and does not depend on any network connection — this directly satisfies the "availability is local, not networked" requirement, since a machine in a basement with no signal must still be able to sell a candy bar for cash.

**Reporting path (async, decoupled)**: periodically (or after each completed transaction, batched), the machine reports what it sold and its current inventory levels to the fleet backend. This is fire-and-forget from the machine's perspective — if the network is down, the machine queues reports locally and sends them once connectivity returns, rather than blocking any customer transaction on network availability.

## 7.5 Deep dive: modeling the machine as a finite state machine, and keeping inventory/payment consistent

**Why a finite state machine.** A vending machine transaction has a small, well-defined set of situations it can be in, and a small, well-defined set of events that move it between them. Modeling this explicitly as a finite state machine (FSM) — rather than as ad-hoc conditional logic scattered across the codebase — is what makes the correctness requirement ("never take money without dispensing or refunding") actually verifiable: with an explicit FSM, you can enumerate every state and confirm that every event handled in that state leads to a valid, safe next state, including all the interruption cases.

**The states**:

| State | Meaning |
| --- | --- |
| `IDLE` | Waiting for a selection. Default/resting state. |
| `ITEM_SELECTED` | Customer picked a slot; price and availability confirmed. |
| `AWAITING_PAYMENT` | Accepting cash/card until amount received ≥ price. |
| `DISPENSING` | Payment complete; actuator is releasing the item. |
| `DISPENSE_FAILURE` | Actuator reported a jam/failure — item did not confirm delivery. |
| `RETURNING_CHANGE` | Calculating and releasing change owed. |
| `ERROR` | Unrecoverable local fault (e.g., coin mechanism jammed) — machine takes itself offline for that payment method. |

**The transitions** (this is the part that actually encodes the correctness requirement):

```text
IDLE --select item--> ITEM_SELECTED
ITEM_SELECTED --slot empty--> IDLE (reject, show "sold out")
ITEM_SELECTED --confirm--> AWAITING_PAYMENT
AWAITING_PAYMENT --insert payment, amount < price--> AWAITING_PAYMENT (still waiting)
AWAITING_PAYMENT --insert payment, amount >= price--> DISPENSING
AWAITING_PAYMENT --cancel--> RETURNING_CHANGE (refund whatever was inserted) --> IDLE
DISPENSING --actuator confirms drop--> RETURNING_CHANGE (release any overpayment) --> IDLE
DISPENSING --actuator fails to confirm drop--> DISPENSE_FAILURE --> RETURNING_CHANGE (full refund) --> IDLE
```

The reason this matters is that the two riskiest situations in the entire system — a customer cancels after inserting money, and the dispense mechanism fails after payment was accepted — are not edge cases bolted on afterward; they are first-class states in the model with a defined, guaranteed transition (always toward a refund and back to `IDLE`), so it is structurally impossible for the machine to end a transaction anywhere except a fully-settled state. This is the core payoff of the FSM approach: it turns "handle every weird interruption correctly" from an open-ended list of special cases into a closed, checkable graph.

**Keeping inventory and payment consistent.** Two operations must happen together and neither should happen without the other: decrementing the slot's inventory count, and finalizing the payment as captured (not refunded). The FSM structure naturally sequences this correctly — inventory is only decremented in the transition out of `DISPENSING` once the actuator *confirms* the item actually dropped (using a physical sensor, e.g., an infrared beam-break at the dispense chute), not merely once the motor was commanded to spin. This distinction matters: if the machine decremented inventory (and finalized payment) the moment it *commanded* the dispense motor, a mechanical jam would leave a customer charged with no item and the machine's inventory count silently wrong — a real-money bug. By gating the "commit" state (decrement inventory, finalize payment) on physical confirmation of delivery, and routing the failure path to a full refund instead, the machine's inventory count and its payment ledger stay truthful even when the physical world doesn't cooperate.

Payment handling itself follows a similar "don't finalize until confirmed" principle: cash and coins are physically captured incrementally as inserted (this is generally irreversible once physically accepted by the mechanism, which is why a cancel refunds via the coin return rather than trying to "un-accept" a coin), while card/mobile payments should ideally use an **authorize-then-capture** pattern — authorize (hold) the amount when payment is initiated, and only capture (actually charge) it once `DISPENSING` confirms success; if dispensing fails, the hold is released instead of capturing and then refunding. This mirrors the idempotency and two-step commit ideas covered in more depth in the UPI payments lesson later in this course, applied here to a much simpler, single-machine setting.

## 7.6 Bottlenecks and trade-offs

- **Single points of failure**: within one machine, there is no meaningful redundancy — the machine itself is a single physical unit, and that's an accepted trade given the problem (you don't run two vending machines in parallel for the same slot of snacks). The mitigation is the `ERROR` state and physical maintenance access, not software redundancy. At the fleet level, the backend reporting service should be redundant, since it aggregates data from many machines.
- **Hot spots**: not really applicable at the single-machine level given negligible concurrency (7.2); at the fleet level, a popular machine location might report more frequently or need more frequent restocking, which is an operations/logistics concern rather than a system-design bottleneck.
- **Consistency vs. availability**: like the parking garage, this design favors strong consistency for the transaction path — a machine would rather reject a selection or refuse to proceed than risk an inconsistent charge/dispense outcome, because unlike a web app, there's no way to "fix it in software" after a physical item is gone and a physical payment is captured.
- **What breaks first at 10x/100x scale**: "10x" doesn't really apply to a single machine's transaction logic (it's bounded by one customer at a time regardless of how many machines exist). At fleet scale (10x more machines), the thing that scales is the backend reporting/aggregation layer, not the state machine itself — which is a useful thing to point out in an interview: some systems don't get architecturally harder with more scale, because their unit of complexity is inherently bounded (one machine, one transaction at a time), and scale just means "more independent copies of the same simple thing."

## 7.7 Summary

A vending machine is a good example of a system where the interesting design work is not throughput or distribution but **correctness of a small state space under interruption**. Modeling the transaction lifecycle as an explicit finite state machine — with dedicated, guaranteed-refund states for cancellation and dispense failure, and a "confirm before commit" rule gating both inventory decrement and payment capture on physical delivery confirmation — is what makes the machine provably safe against the two costliest failure modes: taking money without delivering, and delivering without being paid.

Natural follow-ups: extending the FSM to support multi-item purchases in one transaction (which adds a running total state before payment) and handling partial dispense failures gracefully when a machine supports refund-to-original-payment-method for card transactions instead of only cash-drawer change.
