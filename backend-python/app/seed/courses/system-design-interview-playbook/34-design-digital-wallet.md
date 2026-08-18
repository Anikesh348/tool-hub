> **Learning goal**
> Design a digital wallet, able to explain double-entry ledger design as the backbone of correct balances, how debits and credits move atomically across two wallets, and how transfers stay idempotent under retries.

## 34.1 Requirements and scope

**Functional requirements**

- A user has a wallet with a balance in a given currency.
- A user can add funds to their wallet (from a linked bank account or card, treated as an external funding source).
- A user can transfer funds from their wallet to another user's wallet.
- A user can withdraw funds from their wallet to an external account.
- A user can view their current balance and full transaction history.

**Non-functional requirements**

- **Balances must always be exactly correct — no money can be created or destroyed by the system itself.** Every unit of currency that appears in one wallet must be traceable to where it came from, and every unit that leaves must be traceable to where it went. This is a stronger and more specific requirement than general data correctness elsewhere in this course: it's not just "don't lose data," it's "the sum of all balances must always be explainable by the sum of all money that ever entered or left the system."
- **Atomicity across accounts.** A transfer debiting wallet A and crediting wallet B must never partially apply — A must never lose funds without B gaining them, and vice versa, even under a crash or concurrent operation in the middle of the transfer.
- **Idempotent transfers.** A retried transfer request (due to a client timeout) must never move funds twice — the same core problem as the payment system's idempotent charges, applied here to money movement *between* wallets rather than *into* the system from a card network.
- Strong auditability: a full, immutable history of every balance change, similar in spirit to the payment system's state-transition log, but here the record itself (the ledger) *is* the source of truth for the balance, not a side effect of it.

**Out of scope**

- Currency conversion / multi-currency wallets (assume single-currency wallets for simplicity).
- Card/bank linking and KYC (know-your-customer) identity verification flows.
- Interest, rewards, or wallet-tier features.
- The actual external bank transfer rails for funding/withdrawal (treated as an external system, similar to the payment network in the previous lesson).

## 34.2 Scale estimation

Assumptions for a consumer digital wallet platform:

- 20 million active wallets.
- Average of 3 transactions per active wallet per day (a mix of transfers, fund-additions, withdrawals) → 60 million transactions/day.
- Roughly 60% of these are peer-to-peer transfers (touching two wallets at once), the rest are fund/withdraw operations (touching one wallet plus an external system).

**Traffic (requests/sec):**

- 60M/86,400 ≈ 700 transactions/sec average; consumer payment apps see meaningful peaks around specific times (paydays, holidays, bill-due dates) — assume 5x peak → ~3,500 transactions/sec.

**Storage:**

- Every transaction produces at least two ledger entries (one debit, one credit — the double-entry principle explained in the deep dive) — 60M × 2 = 120 million ledger entries/day. At roughly 200 bytes per entry (account ID, amount, direction, transaction reference, timestamp), that's ~24 GB/day, or ~8.8 TB/year — a moderate, very manageable volume, and one that, like the payment system's records, cannot be casually discarded or downsampled, since the ledger is the literal financial record.
- Current balances: 20 million wallets × a small fixed-size balance record ≈ trivial storage, but this is the single hottest, most contended piece of data in the whole system, discussed at length in the deep dive.

**Read:write ratio:** balance checks (viewing your balance, or the system checking your balance before allowing a debit) happen far more often than transactions themselves — assume every transaction involves at least one balance check, plus users checking balances independently (opening the app) at maybe 5x the rate of actual transactions → a read-heavy overall system, but with the critical caveat that the *write* path (recording a transaction) has by far the strictest correctness requirements in the system, so unlike a typical read-heavy system, this design cannot simply cache balances loosely and call it solved — the deep dive addresses exactly this tension.

## 34.3 API and data model

**Core endpoints:**

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `GET /wallets/{id}/balance` | Get current balance | — | `{balance, currency}` |
| `POST /wallets/{id}/fund` | Add funds from external source | `{amount, sourceToken, idempotencyKey}` | `{transactionId, status}` |
| `POST /transfers` | Transfer between wallets | `{fromWalletId, toWalletId, amount, idempotencyKey}` | `{transactionId, status}` |
| `POST /wallets/{id}/withdraw` | Withdraw to external account | `{amount, destinationToken, idempotencyKey}` | `{transactionId, status}` |
| `GET /wallets/{id}/transactions` | Transaction history | — | list of ledger entries |

**Core entities:**

- `Wallet { id, userId, currency, cachedBalance }` — `cachedBalance` is explicitly labeled as a cache/derived value, not the source of truth, per the deep dive.
- `LedgerEntry { id, walletId, transactionId, direction(debit/credit), amount, timestamp, balanceAfter }` — the actual source of truth; append-only, immutable once written.
- `Transaction { id, type(transfer/fund/withdraw), status, idempotencyKey, createdAt }` — groups the related `LedgerEntry` rows that make up one logical operation (e.g., one transfer produces exactly two entries: a debit on the sender's wallet and a credit on the receiver's).

**SQL vs. NoSQL, by access pattern:**

This is one of the clearest-cut SQL cases in the entire course. The ledger needs multi-row atomic transactions (a transfer's debit and credit must commit together or not at all — this is the textbook definition of what ACID transactions exist to guarantee), strict uniqueness constraints (an idempotency key must never be claimed twice, same mechanism as the payment system), and precise, auditable range/aggregate queries (sum all entries for a wallet to compute a balance, list a wallet's history in order). A relational database is not just a reasonable choice here, it's close to the only responsible choice — reaching for a NoSQL store to gain write throughput would be actively counterproductive, because the throughput here (700-3,500 transactions/sec) is well within what a properly indexed, appropriately sharded relational database handles, while the correctness guarantees a relational database provides natively are exactly what this problem needs and would otherwise have to be painstakingly rebuilt in application code. Sharding, when needed, is naturally done by wallet ID — the one wrinkle being that a transfer touches *two* wallets, which may live on different shards, addressed directly in the deep dive.

## 34.4 High-level architecture

```text
Client
  -> API Gateway (auth)
       -> Wallet Service
            -> Idempotency Check (same mechanism as the payment system lesson)
                 -> [if new] -> Ledger DB
                                  BEGIN TRANSACTION
                                    INSERT LedgerEntry (debit, fromWallet)
                                    INSERT LedgerEntry (credit, toWallet)
                                    UPDATE Wallet.cachedBalance (both wallets)
                                  COMMIT
                 -> [if seen] -> return prior stored result
       -> Balance Read Path -> Wallet.cachedBalance (fast path)
                             -> Ledger DB (fallback / reconciliation source of truth)

External funding/withdrawal:
  Wallet Service -> External Bank/Card Network (same idempotent-call pattern as payment system)
```

**Write path (transfer):** exactly like the payment system's charge path, every write begins with an idempotency check. If new, the Wallet Service opens a single database transaction that inserts both ledger entries (the debit and the credit) and updates both wallets' cached balances — all within one atomic commit, so a crash or failure partway through leaves no trace at all (the whole transaction rolls back) rather than a half-applied transfer. This is the most important sentence in this lesson: **the debit and the credit are not two separate operations that need to be kept in sync — they are two rows written inside one atomic transaction**, which is what makes "atomicity across accounts" achievable using ordinary relational database guarantees rather than a bespoke distributed-transaction protocol.

**Read path (balance check):** for speed, the `Wallet.cachedBalance` column is read directly for everyday balance checks — it's kept in sync with the ledger because it's updated inside the very same transaction as every ledger write, so it's never actually stale in normal operation, just labeled as a derived value on principle, because the ledger, not the cache, is what's audited and what would be trusted if the two ever needed to be reconciled (e.g., after a bug or a manual data fix).

**External funding/withdrawal path:** functionally similar to a transfer, except one side of the transaction is an external system (bank/card network) rather than another wallet — this reuses the exact idempotent-call pattern from the payment system lesson, since moving money in from or out to an external system has the identical "did the network call actually succeed" ambiguity under a timeout.

## 34.5 Deep dive: double-entry ledger design, atomic cross-wallet operations, and idempotent transfers

### Double-entry bookkeeping as the consistency backbone

The single most important design decision in this entire lesson is that **a wallet's balance is never stored as an independently-updated number that gets incremented or decremented directly** — instead, it's *derived* from the sum of all ledger entries for that wallet, and every transaction is recorded as at least two entries that must always net to zero across the transaction (one debit, one credit, of equal amount). This is the double-entry bookkeeping principle borrowed directly from traditional accounting, and it earns its place here for a very concrete engineering reason, not just historical convention: it makes an entire class of bugs structurally impossible rather than merely unlikely.

Consider the alternative: `UPDATE wallet SET balance = balance - amount WHERE id = fromWallet` followed by `UPDATE wallet SET balance = balance + amount WHERE id = toWallet`. If anything goes wrong between these two statements — a crash, a bug, a partial failure — money can vanish from one wallet without appearing in the other, and *there is no record anywhere of what should have happened*, because the only representation of the money movement was the instantaneous act of updating two numbers. With double-entry ledger entries instead, every transaction leaves a permanent, append-only record of exactly what moved and why, and — critically — the system's global invariant ("the sum of every debit must equal the sum of every credit across the whole ledger, always, for all time") becomes a checkable, provable property rather than an assumption. This is what makes reconciliation possible: at any point, an auditor (automated or human) can independently recompute every wallet's balance purely from its ledger entries and confirm it matches the cached value, and can confirm the platform-wide sum of all entries nets to zero (money only entering via external funding and leaving via external withdrawal, never appearing or disappearing internally). This single design choice is why "how would you prove your system never lost or created money" has a clean, direct answer here, whereas it would be a genuinely hard forensic question in the naive increment/decrement design.

### Atomic debit/credit across wallets

Because a transfer's debit and credit are two rows, the correctness of a transfer reduces to a question already familiar from this course: how do you guarantee two writes either both happen or neither does? Within a single database (both wallets' ledgers live in the same database instance or shard), the answer is the same as always — wrap both inserts in a single ACID transaction, exactly as shown in 34.4, and let the database's own transaction guarantees do the work. No custom distributed-transaction logic is needed as long as both sides of the transfer live in the same transactional boundary.

The genuinely hard version of this problem appears once the system is sharded and a transfer's two wallets happen to live on different shards (say, sharded by wallet ID across many database instances for scale) — now a single ACID transaction can't span both writes directly, because they're on physically different databases. This is where the saga pattern from the e-commerce lesson reappears in a new form: the transfer is broken into ordered steps with compensating actions — debit the source wallet first (in its own local transaction, on its shard), then credit the destination wallet (in its own local transaction, on its shard); if the credit step fails after the debit succeeded, a compensating transaction re-credits the source wallet to undo the debit, recorded as its own explicit ledger entries (never silently rolled back at the row level, since the debit's ledger entry, once written, is meant to be immutable — the undo is a new, offsetting entry, not an erasure of history). The transaction as a whole is tracked in a `pending` state until both legs succeed, mirroring the payment system's state machine, and a background process sweeps transactions stuck in `pending` past a timeout to either complete or compensate them. This is a genuine trade-off versus the single-shard case: cross-shard transfers give up the simplicity of one atomic commit in exchange for the scalability of sharding wallets across many databases, and the saga's compensating-entry approach is what keeps the double-entry invariant intact even when a transfer can't be a single atomic operation.

### Idempotent transfers

The mechanism here is identical in structure to the payment system's idempotency keys, applied to wallet-to-wallet movement instead of external charges: a client generates a unique idempotency key per logical transfer attempt, the Wallet Service checks it against a uniqueness-constrained record before doing any ledger writes, and a retried request with the same key returns the original result rather than executing a second transfer. The same concurrent-retry race condition applies and is closed the same way (a unique index on the idempotency key causing the second concurrent insert to fail fast rather than race past the check).

One detail specific to wallets is worth calling out: because the ledger is append-only and every transaction is fully recorded, idempotency here has a second layer of protection beyond the key lookup itself — even in the rare case where an idempotency check somehow failed to catch a duplicate (a bug, a key collision), the ledger still contains a full, inspectable history that a reconciliation process could use to detect an unexplained double-transfer between the same two wallets for the same amount close together in time, and flag it for review. This doesn't replace correct idempotency-key handling (that's still the primary defense, and the one the request path relies on in real time), but it's a meaningful example of how the double-entry ledger's auditability provides a genuine safety net that a naive balance-increment design simply wouldn't have.

## 34.6 Bottlenecks and trade-offs

- **Single points of failure.** The Ledger DB is the single most critical component in the entire system — every write depends on it, and it holds the one true record of every wallet's funds; it needs synchronous replication and rigorous failover testing, more so than almost any other datastore in this course, given that data loss here is equivalent to losing track of real money.
- **Hot spots.** A wallet involved in an unusually high volume of transactions (a business account receiving many small payments, e.g.) becomes a concentration point for ledger writes and for the row-level locking a transaction needs while updating that wallet's cached balance — mitigated by keeping the lock duration extremely short (the transaction only needs to hold the lock for the two-insert-plus-balance-update, not for anything else) and, at the extreme, by treating very high-volume wallets similarly to the sharded-counter/hot-tenant pattern used elsewhere in this course.
- **Consistency vs. availability.** This system sits at the strong-consistency end of the spectrum, essentially identically to the payment system in the previous lesson and for the same reason: an unavailable wallet service (reject the transfer, ask the client to retry) is unambiguously better than one that might have moved money incorrectly. There is no part of this design that trades correctness for availability the way, say, the TikTok or analytics lessons do for like counts or dashboard freshness — money is exactly the kind of data where that trade isn't acceptable.
- **What breaks first at 10x/100x scale:** at 10x, single-shard transaction throughput on the busiest wallets becomes the first constraint, pushing toward sharding wallets across more database instances — which immediately surfaces the cross-shard transfer problem described in the deep dive as a first-class design concern rather than an edge case. At 100x, the saga-based cross-shard transfer path's operational complexity (tracking and sweeping `pending` transactions, handling compensating entries reliably) becomes as significant an engineering investment as the core ledger itself, and the system likely needs dedicated tooling just for monitoring and resolving stuck cross-shard transfers.

## 34.7 Summary

A digital wallet's correctness rests on treating the ledger, not a simple balance number, as the source of truth: every transaction is recorded as balanced debit/credit entries inside one atomic transaction, which makes "money never appears or disappears" a provable, auditable invariant rather than an assumption. Cross-wallet atomicity is straightforward within a single shard (one ACID transaction) and becomes a saga — ordered steps with compensating ledger entries — once wallets are sharded across databases for scale. Idempotency keys, structured identically to the payment system's, prevent retried requests from double-moving funds, with the append-only ledger itself serving as a secondary, inspectable safety net.

Natural follow-ups: how would you support a wallet going negative temporarily during a race between a debit check and a concurrent withdrawal (generally prevented the same way as inventory: an atomic conditional update that checks sufficient balance and debits in one statement, never a separate check-then-write), and how would you extend this design to support scheduled/recurring transfers without duplicating the idempotency and atomicity guarantees built for one-off transfers.
