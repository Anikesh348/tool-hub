> **Learning goal**
> Design a UPI-style real-time payments system, and be able to explain how idempotency prevents duplicate money movement, how a debit/credit transfer stays consistent across separate bank accounts, and how partial failures are handled without ever double-spending or losing money.

## 11.1 Requirements and scope

**Functional requirements**

- A user can link a bank account and initiate a payment to another user by identifier (phone number, virtual payment address, or account number).
- The system debits the payer's account and credits the payee's account as a single logical transfer.
- A user can view transaction status and history.
- The system must correctly handle retries (e.g., a client that doesn't receive a response and resends the same request) without moving money twice.

**Non-functional requirements**

- **Correctness is absolute, above availability and above latency**: unlike most systems in this course, "probably right, occasionally a bit off" is not acceptable — money must never be created, destroyed, or duplicated. This reframes every trade-off in this lesson compared to earlier ones.
- **Idempotency**: any operation that moves money must be safely retryable — a network timeout or client retry must never result in the transfer happening twice.
- **Atomicity across accounts**: a debit and its corresponding credit must either both take effect or neither does — a transfer must never leave one side applied and the other not, even if the two accounts are held at different banks with no shared database.
- **Auditability**: every transaction must be traceable and reconstructable after the fact, since this is a regulated financial domain.
- **High availability, but not at the cost of correctness**: the system should stay up, but if forced to choose between processing a payment with uncertain correctness versus safely failing it, it must fail safely.

**Out of scope**: the actual settlement and clearing between banks at the end of a business day (a separate batch reconciliation process), fraud detection/scoring, and currency conversion for cross-border payments.

## 11.2 Scale estimation

- **Transaction volume**: assume a national-scale system processing 300 million transactions/day → 300,000,000 / 86,400 ≈ **~3,500 transactions/sec average**, with peaks (e.g., salary-day mornings, festival shopping periods) reaching **5-10x average**, so design for roughly **20,000-35,000 transactions/sec peak** — this peak-to-average ratio is unusually high compared to typical web traffic and is a critical number, since underprovisioning for it directly means failed payments during exactly the moments people most need the system to work.
- **Storage**: each transaction record (payer, payee, amount, status, timestamps, reference IDs) is roughly 500 bytes with metadata. At 300 million/day, that's **~150 GB/day**, or roughly **55 TB/year** — meaningful volume that, combined with the strict consistency requirement, points toward a partitioned relational or strongly-consistent distributed database rather than a single unpartitioned instance, especially as years of history accumulate for auditability.
- **Idempotency key retention**: every transaction needs a client-supplied idempotency key retained long enough to catch retries — assuming clients might retry up to 24 hours after an ambiguous failure, the system needs to retain and index roughly one day's worth of keys (~300 million) at all times, a small, boundable working set even though total transaction history is much larger.
- **Latency**: users expect a payment confirmation within a few seconds, not milliseconds (this is one of the few systems in this course where sub-second latency is not the primary target) — but that budget still needs to cover a full debit-then-credit sequence with durability guarantees at each step, so it's a tighter budget than it first appears once correctness requirements are factored in.

The takeaway: this system trades the aggressive low-latency, eventually-consistent posture of most designs in this course for strict correctness under a high and spiky transaction rate — which is why idempotency and cross-account atomicity (11.5) are the central engineering problems, not caching or partitioning for read scale.

## 11.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /api/payments` | `{ "idempotencyKey": "client-generated-uuid", "payerAccountId": "...", "payeeAccountId": "...", "amount": 500.00 }` | `{ "transactionId": "...", "status": "PENDING" \| "SUCCESS" \| "FAILED" }` |
| `GET /api/payments/{transactionId}` | — | `{ "status": "...", "amount": ..., "timestamps": {...} }` |

The `idempotencyKey` field is not optional or incidental — it is the single most important field in this API, generated once by the client and reused automatically on every retry of the same logical request, which is what makes retries safe (detailed in 11.5).

**Data model**

Core entities:

- `Account { id, ownerId, balance, currency }`
- `Transaction { id, idempotencyKey (unique), payerAccountId, payeeAccountId, amount, status, createdAt, completedAt }`
- `LedgerEntry { id, accountId, transactionId, amount (signed: negative for debit, positive for credit), balanceAfter }`

This is a strongly relational problem, and the choice is not close: transfers require atomic, all-or-nothing updates across multiple rows (debit one account, credit another, record both as part of one transaction), exactly what ACID transactions in a relational database are designed to guarantee. A NoSQL key-value or document store would require reimplementing multi-record atomicity in application code — a strictly worse position for a domain where that atomicity is the single most important correctness property in the entire system. Note also the `LedgerEntry` table: rather than only storing a mutable current `balance` on the `Account`, the design keeps an **append-only ledger** of every individual debit/credit, with `Account.balance` treated as a derived, cached value that can always be reconstructed by summing ledger entries. This append-only pattern is what makes the system auditable (11.1's requirement) and gives a natural mechanism to detect and correct any drift between the cached balance and ground truth.

## 11.4 High-level architecture

```text
Payer App
  -> Payment Gateway (validates request, checks idempotency key)
       -> Transaction Orchestrator
            -> Debit Service  --> Payer's Bank/Account Ledger
            -> Credit Service --> Payee's Bank/Account Ledger
       -> Transaction DB (records status: PENDING -> SUCCESS/FAILED, durable at every step)

  (async) -> Notification Service -> Payer + Payee apps (push confirmation)
```

**Write path (the entire system, essentially)**: a payment request arrives with a client-generated idempotency key. The Payment Gateway first checks whether a transaction with that key already exists (11.5) — if so, it returns the existing result immediately rather than reprocessing. If not, the Transaction Orchestrator creates a new `Transaction` row in `PENDING` status (durably recorded before any money moves — this ordering matters, discussed below), then coordinates the debit from the payer's account and the credit to the payee's account. Only once both legs are confirmed does the transaction move to `SUCCESS`; if either leg fails, the orchestrator must ensure the other leg is also rolled back or never applied, so the transaction ends in a state where money was moved fully or not at all, never partially (11.5).

**Read path**: transaction status lookups (`GET /api/payments/{id}`) are simple point reads against the `Transaction` table, low volume relative to writes, and not performance-critical in the same way the write path is.

There is no cache in this architecture's hot path for account balances or transaction state — deliberately, since serving a stale balance or stale transaction status in a payments system is a correctness bug, not a minor inconvenience, which is a direct consequence of the "correctness above latency" non-functional requirement from 11.1.

## 11.5 Deep dive: idempotency, cross-account atomicity, and partial-failure handling

**Idempotency for money movement.** The central risk this system must eliminate is a retried request causing money to move twice. Retries are not an edge case here — they're expected and routine: a client's network call times out with no response, and the client (correctly, from its own perspective) doesn't know whether the payment succeeded or failed, so it retries the same request. If the server treated that retry as a brand-new payment, the user would be charged twice for one intended transfer.

The fix is the idempotency key described in 11.3: the client generates a unique key once per logical payment intent (not per HTTP call) and sends the same key on every retry of that same intent. The server enforces a uniqueness constraint on `Transaction.idempotencyKey` and, before doing any work, checks whether a transaction with that key already exists:

- If it doesn't exist, this is a genuinely new request — proceed with processing and create the record.
- If it exists and is `SUCCESS` or `FAILED` (a terminal state), the retry is answered immediately with that same recorded outcome — no money moves again, the client just learns what already happened.
- If it exists and is still `PENDING` (the original request is still being processed, or crashed mid-processing), the retry should not start a second, concurrent attempt at the same transfer — it should either wait briefly and re-check, or be rejected with a "still processing, retry later" signal, specifically to avoid two concurrent processes racing to apply the same debit/credit pair.

The uniqueness constraint on `idempotencyKey` is what makes this safe under real concurrency — even if two retries of the same request arrive at the same instant and both attempt to insert a new `Transaction` row, the database's uniqueness constraint guarantees only one insert succeeds; the other fails and falls back to reading the now-existing row. This is the same atomic-claim principle used for spot allocation in the parking garage lesson, applied here to a much higher-stakes resource: money.

**Cross-account atomicity without a single shared database.** In the simplest version of this problem, payer and payee accounts live in the same database, and a standard database transaction (`BEGIN; debit; credit; COMMIT`) gives atomicity for free — either both writes commit or neither does, guaranteed by the database itself. The harder, more realistic version of this problem (and the one an interviewer will likely push toward) is when the payer's bank and the payee's bank are different systems entirely, with no shared database and no shared transaction boundary — which is the real shape of a UPI-style system spanning many banks.

Here, the standard approach is a **two-phase, saga-like pattern** rather than a true distributed transaction (classic two-phase commit exists but is generally avoided at this scale because it requires all participants to block and hold locks until every party confirms, which is a poor fit for high-throughput, multi-organization systems where any one bank might be slow or briefly unavailable):

1. **Reserve/hold** — the orchestrator first asks the payer's bank to place a hold on the funds (debit pending, not yet finalized) rather than immediately finalizing the debit. This confirms the funds exist and are available without yet committing to the transfer.
2. **Credit** — once the hold is confirmed, the orchestrator asks the payee's bank to credit the funds.
3. **Confirm/finalize** — once the credit is confirmed successful, the orchestrator tells the payer's bank to finalize the hold into an actual debit (release the hold, commit the deduction).
4. **Compensate on failure** — if the credit step fails (payee's account doesn't exist, is frozen, etc.), the orchestrator releases the hold on the payer's side instead of finalizing it, returning the account to its original state — this is called a **compensating action**, since there's no shared transaction to roll back, only an explicit corrective operation.

This ordering is deliberate: never finalize the debit before the credit is confirmed. If the system finalized the payer's debit first and then the credit step failed, money would be destroyed (deducted from the payer, never delivered to the payee) — recoverable only through manual reconciliation, which is exactly the outcome the design exists to avoid.

**Handling partial failures without double-spending.** The orchestrator itself can crash or lose connectivity at any point mid-sequence — after placing a hold but before crediting, or after crediting but before finalizing. This is where durably recording the `Transaction` status at every step (11.4) becomes essential: because each state transition (`PENDING` → hold-placed → credited → `SUCCESS`, or any failure branch → `FAILED`/compensated) is written durably before moving to the next step, a crashed orchestrator can be replaced by a fresh process that reads the last durably-recorded state and resumes exactly where the crash occurred — retry the next step if it wasn't confirmed, or run the appropriate compensating action if the sequence needs to be unwound. This is what makes the system's idempotency guarantee hold even across process crashes, not just across client retries: the source of truth for "what step are we on" is the durable `Transaction` record, not any in-memory orchestrator state.

## 11.6 Bottlenecks and trade-offs

- **Single points of failure**: the Transaction Orchestrator and Transaction DB are on the critical path of every payment — mitigated with active replication of the database (synchronous replication for the transaction log specifically, since losing an uncommitted transaction record here is a correctness issue, not just an availability one) and running multiple orchestrator instances that can pick up in-flight transactions from durable state if one instance crashes (per the partial-failure handling above).
- **Hot spots**: a small number of accounts can receive disproportionate transaction volume (a popular merchant account during a sale event) — mitigated by partitioning the ledger by account ID (so a hot account's writes are isolated to its own partition rather than contending with the whole system) and by not requiring cross-partition locks for transfers between two "normal" accounts that don't share a partition.
- **Consistency vs. availability**: this system deliberately and explicitly sits at the strong-consistency end of the spectrum, the opposite default from most other lessons in this course — it is willing to reject or delay a payment (reduced availability) rather than risk an inconsistent outcome (lost or duplicated money), because the cost of an availability failure (a failed payment, retryable) is vastly lower than the cost of a consistency failure (incorrect money movement, which erodes trust in the entire system and may require manual, human reconciliation).
- **What breaks first at 10x/100x scale**: at 10x transaction volume, ledger partitioning by account ID (above) absorbs it, since most transfers don't require cross-partition coordination. At 100x, the orchestration overhead of the multi-step hold/credit/finalize sequence across many partitions and potentially many external bank systems becomes the real constraint — this is where systems typically invest heavily in asynchronous, durable message-queue-based orchestration (so each step is a queued, retryable, independently-scalable unit of work) rather than a single synchronous request-response chain, trading a bit of end-to-end latency for much higher sustainable throughput.

## 11.7 Summary

A payments system's design is dominated by one governing principle that reorders every trade-off compared to earlier lessons in this course: correctness outranks availability and latency. Idempotency keys make client retries safe, an append-only ledger makes every balance change auditable and reconstructable, and a hold-credit-finalize sequence with explicit compensating actions provides atomicity across accounts that live in entirely separate systems, without relying on a classic all-or-nothing distributed transaction. Durably recording progress at each step is what lets the system recover correctly from a crash mid-transfer, which is really the same idempotency principle applied to server-side failures as well as client-side retries.

Natural follow-ups: extending this to support multi-day settlement/reconciliation between banks (a batch process that reconciles the running ledger against each bank's own records), and handling currency conversion for cross-border transfers, which adds exchange-rate locking as a new step that must also be made atomic with the transfer itself.
