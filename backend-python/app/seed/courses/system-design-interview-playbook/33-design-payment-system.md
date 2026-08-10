> **Learning goal**
> Design a payment processing system like Stripe, able to explain how idempotency keys prevent duplicate charges on retry, the state machine a payment moves through from creation to settlement, and how the system reconciles its own records against external payment networks.

## 33.1 Requirements and scope

**Functional requirements**

- A merchant (via API) creates a payment/charge request for a customer, specifying amount, currency, and a payment method (e.g., a tokenized card).
- The system routes the charge to an external payment network (card networks, banks) and returns a result: succeeded, failed, or requires further action (e.g., 3D Secure authentication).
- A merchant can refund a completed payment, fully or partially.
- A merchant can query the status and history of a payment at any time.
- The system reconciles its internal records against statements/reports from external payment networks to catch discrepancies.

**Non-functional requirements**

- **Exactly-once effect, even under retries.** A network timeout between the merchant's server and the payment system must never result in a customer being charged twice — this is the single defining correctness requirement of the whole system, more critical here than almost anywhere else in this course, because the failure mode is literally taking someone's money incorrectly.
- **Strong auditability.** Every state transition a payment goes through must be durably recorded and immutable after the fact — payment systems are subject to financial audits and disputes, and "what happened and when" must be reconstructable with certainty, not inferred.
- **Consistency over latency for the money-moving path.** A charge can take a second or two if it must; it must never silently succeed on the payment network's side while the merchant is told it failed (or vice versa) — this discrepancy is the exact failure the state machine and reconciliation process (deep dive) exist to prevent.
- High availability for the read/query path (checking payment status) is desirable but secondary to correctness on the write path.

**Out of scope**

- Fraud detection/risk scoring models.
- Multi-currency conversion logic and rates.
- Payout to merchants (moving settled funds from the platform to a merchant's bank account) — a related but separate flow from charging a customer.
- The actual card network protocols (ISO 8583 etc.) — treated as an external system reached through an abstracted gateway.

## 33.2 Scale estimation

Assumptions for a mid-to-large payment platform serving many merchants:

- 50,000 active merchants, averaging 2,000 transactions/day each → 100 million transactions/day platform-wide.
- Average transaction: modest payload (amount, currency, payment method token, merchant/customer IDs) — a few KB including metadata.

**Traffic (requests/sec):**

- 100M/86,400 ≈ 1,150 transactions/sec average; e-commerce-driven traffic has real daily and seasonal peaks (e.g., a major shopping event) that can push this 5-10x → 6,000-11,000 transactions/sec peak.
- Status queries and webhooks (notifying merchants of async state changes) add further read/notification volume, roughly 2-3x the transaction volume itself, since a single payment often triggers multiple status checks and webhook deliveries over its lifecycle.

**Storage:**

- 100M transactions/day × ~2 KB × 365 ≈ 73 TB/year for transaction records alone — and unlike most systems in this course, this data generally cannot be aged out, downsampled, or discarded the way metrics or engagement events can, because of financial record-keeping and audit requirements — it needs durable, queryable, long-term (often multi-year, regulation-dependent) storage.
- Every transaction additionally generates a state-transition history (an audit log entry per status change) — assume an average of 4 transitions per transaction → 400M audit records/day, which is itself the size of a large event stream, structurally similar in volume to the analytics platform's ingestion, though the durability and correctness requirements here are far stricter, since this data is the legal record of what happened to someone's money.

**Read:write ratio:** at first glance this looks write-heavy (every transaction is a write), but the query/audit/reconciliation load (checking status, generating merchant statements, cross-referencing against network reports) is substantial too — this is a system where **both** sides need to be fast and correct, and where, unusually for this course, the actual bottleneck is neither pure throughput nor pure query latency but **correctness under concurrent retries**, which is the deep dive's central topic.

## 33.3 API and data model

**Core endpoints:**

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `POST /charges` | Create a charge | `{amount, currency, paymentMethodToken, idempotencyKey}` (idempotency key typically passed as a header) | `{chargeId, status}` |
| `GET /charges/{id}` | Check charge status | — | `{status, amount, history}` |
| `POST /charges/{id}/refunds` | Refund (full/partial) | `{amount}` | `{refundId, status}` |
| `POST /webhooks/network-callback` | External network notifies of async result (e.g., 3D Secure completion) | network-specific payload | 200 OK |

**Core entities:**

- `Charge { id, merchantId, amount, currency, status, idempotencyKey, createdAt }` — `status` moves through the state machine described in the deep dive.
- `ChargeStateTransition { chargeId, fromState, toState, timestamp, reason }` — the immutable audit trail; append-only, never updated or deleted.
- `IdempotencyRecord { idempotencyKey, merchantId, requestHash, chargeId, responseSnapshot }` — the record that makes retried requests safe, examined closely below.
- `ReconciliationEntry { networkTransactionId, chargeId, matchStatus, discrepancyDetails }` — produced by the reconciliation process, not by the live request path.

**SQL vs. NoSQL, by access pattern:**

The charge and its state-transition history need strict transactional guarantees (a charge's status update and its corresponding audit-log entry must be written together, atomically, with no possibility of one succeeding without the other) and need to support precise, auditable queries later ("show me every transition this specific charge went through, in order") — this is a strong, almost textbook case for a relational database with ACID transactions, and it's one of the few systems in this course where the correctness requirements are strict enough that reaching for a NoSQL store purely for throughput would be the wrong trade, even though the raw volume (73 TB/year) sounds large — 1,150-11,000 transactions/sec of well-defined, small writes with strict integrity needs is well within what a properly sharded relational system (sharded by merchant ID, since a merchant's transactions never need cross-merchant transactions) can handle. The `IdempotencyRecord` table specifically benefits from being a simple, fast key-value lookup (idempotency key → prior result) even if it lives inside the same relational database as a table with a unique index on the key — the point is the access pattern (single-key lookup, small payload), not necessarily a different storage technology.

## 33.4 High-level architecture

```text
Client (merchant server)
  -> API Gateway (auth)
       -> Charge Service
            -> Idempotency Check (has this idempotencyKey been seen before?)
                 -> [if yes] return prior stored result, do nothing new
                 -> [if no]  proceed:
                      -> Charge DB (create charge, status=pending)
                      -> Payment Network Gateway (external card network/bank)
                      -> Charge DB (update status based on network result, append transition)
            -> Webhook dispatcher (async notify merchant of async status changes)

Reconciliation (background, offline):
  Payment Network settlement reports -> Reconciliation Job -> compares against Charge DB
       -> flags discrepancies for manual/automated resolution
```

**Write path (creating a charge):** the request first passes through an idempotency check — this happens *before* anything else, because it's the mechanism that makes safe retries possible at all. If the request's idempotency key has been seen before, the system returns the previously recorded result without doing anything new (no new network call, no new charge). If not, the system creates a charge record in a `pending` state, calls out to the external payment network, and updates the charge's status based on the result — all of this, including the idempotency record itself, committed together so that a crash partway through can't leave the system in an ambiguous state (this exact mechanism is the deep dive's first subject).

**Async path:** some payment methods require an extra step (3D Secure authentication, bank redirect flows) that doesn't complete synchronously within the original request — for these, the charge sits in an intermediate state and the network notifies the system later via a callback/webhook, which triggers the same state-transition-and-persist logic as the synchronous path, just invoked from a different entry point.

**Reconciliation path:** entirely offline and asynchronous from the live transaction path — periodically (e.g., daily), the system pulls settlement/reporting data from each payment network and compares it against its own charge records, flagging anything that doesn't match for investigation. This never blocks or slows down live payments; it's a safety net that runs behind them.

## 33.5 Deep dive: idempotency keys, the charge state machine, and reconciliation

This is a system where the deep dive isn't one hard technical problem, it's three tightly related mechanisms that together are what makes "handling other people's money over an unreliable network" safe.

### Idempotency keys

The core problem: a merchant's server sends a charge request, but the network times out before a response arrives. Did the charge succeed or fail? The merchant's server doesn't know, and if it naively retries, it risks double-charging the customer if the original request actually did succeed on the payment system's side despite the response being lost in transit.

The fix is for the merchant to generate a unique idempotency key per logical charge attempt (typically a random UUID, generated once client-side and reused on every retry of that same logical attempt) and send it with the request. The payment system's Charge Service checks this key against an `IdempotencyRecord` table before doing anything else: if the key has been seen before, it returns the stored result of the original attempt — the same charge ID, the same status — without creating a new charge or calling the payment network again; if the key is new, it proceeds normally and stores the key alongside the result once the operation completes.

The subtlety that makes this genuinely correct rather than just "usually works" is handling the case where a retry arrives *while the original request is still in flight* — two requests with the same idempotency key hitting the system concurrently (a legitimately common case, since clients often retry aggressively right after a timeout, potentially before the first attempt has even finished). This needs the same atomic-check-and-claim pattern used for inventory throughout this course: inserting the idempotency key needs a uniqueness constraint (e.g., a unique index on `idempotencyKey`) so that the second concurrent request's insert attempt fails immediately rather than racing past the check — that second request then either waits for the first to finish and returns its result, or is told to retry shortly. Without this, two concurrent retries could both pass a naive "have I seen this key" check before either has stored a record, and both would proceed to charge the customer — precisely the bug idempotency keys exist to prevent, reintroduced through a subtle race.

It's also worth being precise about what idempotency guarantees and what it doesn't: it guarantees the *same logical request*, retried, produces the same result without duplicate side effects — it does not, by itself, guarantee the payment network call itself is idempotent (calling out to a card network twice for the same underlying charge is a different, network-specific concern, usually handled by the payment system including its own request ID in the outbound call so the network side can also deduplicate).

### The charge state machine

A charge is not a single atomic event, it's a sequence of states, and the whole point of modeling it explicitly is that many things can go wrong or take time between "customer clicked pay" and "money has definitively moved":

```text
created -> pending -> [requires_action] -> processing -> succeeded
                                                        -> failed
              -> failed (immediate decline)
succeeded -> refund_pending -> refunded
```

- `created`: the charge request has been accepted and validated (valid amount, valid payment method format) but nothing has been sent to the payment network yet.
- `pending`: the request has been sent to the payment network and a response is awaited.
- `requires_action`: the payment network needs additional customer interaction (e.g., 3D Secure) before it can proceed — the charge sits here, potentially for minutes, until the async callback described in 33.4 arrives.
- `processing`: the network has accepted the charge but final settlement confirmation hasn't arrived yet (common for some payment methods where authorization and settlement are distinct steps).
- `succeeded` / `failed`: terminal states for the charge attempt itself.
- `refund_pending` / `refunded`: a separate sub-sequence triggered by a refund request against a `succeeded` charge.

Every transition is written to the `ChargeStateTransition` audit table atomically with the charge's status update — this is what makes the system auditable and what makes reconciliation (next section) possible at all, since reconciliation depends on being able to reconstruct exactly what the system believed happened and when. Critically, transitions are only ever allowed to move forward according to this defined graph (e.g., a `succeeded` charge can never transition directly back to `pending`) — enforcing this at the data-access layer, not just trusting application code to call things in the right order, prevents an entire class of bugs where a delayed or out-of-order network callback could otherwise corrupt a charge's recorded status.

### Reconciliation with external payment networks

Even with idempotency keys and a careful state machine, the payment system's internal record of "what happened" and the external payment network's own record can drift apart — a network call might time out on the payment system's side after the network actually processed it successfully (the mirror image of the merchant-retry problem, but between the payment system and the network itself), or a settlement might be adjusted after the fact for reasons outside the payment system's control (a chargeback, a network-side correction).

Reconciliation is the process that catches this drift, and it deliberately runs **offline, asynchronously, after the fact** rather than trying to achieve perfect real-time consistency with an external system the platform doesn't control — this is a realistic acknowledgment that the payment network is outside this system's transactional boundary, and no amount of clever engineering on the payment system's own side can make a cross-organization, cross-system distributed transaction fully synchronous and instantaneous. Concretely: the payment network periodically provides settlement reports (a list of transactions it actually processed and their final status); the reconciliation job compares this against the internal `Charge` records, transaction by transaction, and produces a `ReconciliationEntry` for each: a match (internal and external records agree — the overwhelming majority), or a discrepancy (something the internal system doesn't know about, something marked differently on each side, or an amount mismatch). Discrepancies are routed for investigation — sometimes auto-resolvable by a defined rule (e.g., "external says succeeded, internal says pending because the original response was lost — update internal to match, since the network is authoritative for whether money actually moved"), sometimes requiring manual review. This reconciliation loop is, in effect, the system's ultimate correctness backstop: idempotency and the state machine prevent most inconsistency from ever occurring, and reconciliation catches and corrects the rare cases that slip through anyway — treating "we might occasionally be wrong for a few hours until the next reconciliation run" as an acceptable, monitored risk rather than pretending the live system can be perfectly correct at every instant against an external, uncontrolled counterparty.

## 33.6 Bottlenecks and trade-offs

- **Single points of failure.** The Charge DB (and specifically its idempotency-key uniqueness constraint) is on the critical path of every single charge — it must be highly available with synchronous replication, since even a brief outage here directly stops all payment processing, not just degrades it.
- **Hot spots.** A single very high-volume merchant (a major retailer during a flash sale) can concentrate a large share of transaction volume on their shard if sharding is by merchant ID — mitigated the same way as other hot-tenant problems in this course (the Shopify lesson's tiering), by giving especially large merchants dedicated database resources rather than sharing a shard with many smaller merchants.
- **Consistency vs. availability.** This system sits further toward the consistency end of the spectrum than almost any other lesson in this course — an unavailable payment system (reject the charge, tell the merchant to retry) is a far better outcome than an ambiguously-processed one, which is why the design leans so heavily on synchronous, atomic writes on the charge path rather than the eventually-consistent, availability-favoring patterns used in most of the other lessons.
- **What breaks first at 10x/100x scale:** at 10x, the Charge DB's write throughput (even sharded by merchant) becomes the first real constraint, particularly the idempotency-key uniqueness check adding contention under very bursty retry patterns. At 100x, the volume of audit/transition records and the reconciliation job's own scale (comparing hundreds of millions of records daily against external reports) becomes a significant data-processing problem in its own right, likely requiring the reconciliation job itself to become a distributed, partitioned batch pipeline rather than a single nightly job.

## 33.7 Summary

A payment system's correctness rests on three interlocking mechanisms: idempotency keys (with an atomic, uniqueness-constrained check-and-claim, not just a naive "have I seen this before" lookup) that make client retries safe, an explicit charge state machine with append-only, atomic audit transitions that makes every payment's history reconstructable and prevents invalid state jumps, and offline reconciliation against external payment networks that catches and corrects the drift that inevitably occurs at the boundary between systems the platform controls and ones it doesn't.

Natural follow-ups: how would you handle partial refunds and multiple refunds against a single charge without ever allowing the refunded total to exceed the original charge amount (the same atomic conditional-update principle from inventory management, applied to a running refund total), and how would you support multiple payment networks/processors per charge with automatic failover if a primary network is degraded, without compromising the idempotency guarantees already built for a single network.
