> **Learning goal**
> Design a group expense-splitting system, whose most interesting sub-problem is a small graph/algorithm question hiding inside an LLD problem: minimizing the number of settlement transactions.

## 16.1 Requirements and scope

**Functional requirements:** users belong to groups; any user can add an expense paid by one user and split among several (equally, by exact amounts, or by percentage); the system tracks who owes whom, and can compute a simplified settlement plan minimizing the number of payments needed to clear all balances.

**Non-functional constraints:** in-memory ledger; balances must be exact (use integer cents or `BigDecimal`, never raw floating point, to avoid rounding drift across many transactions).

**Non-goals:** actual payment execution (settlement is a computed plan, not a real money transfer), multi-currency support.

## 16.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `User` | A person who can owe or be owed money |
| `Expense` | Amount, payer, and a `SplitStrategy` describing how it's divided |
| `SplitStrategy` (interface) | `EqualSplit`, `ExactSplit`, `PercentSplit` — a **Strategy** (LLD Basics lesson 14) |
| `Group` | A set of users sharing expenses |
| `Ledger` | Running balance between every pair of users |
| `SettlementCalculator` | Computes the minimal set of payments to zero out the ledger |

## 16.3 Key design decisions

**Splitting is Strategy, almost verbatim.** Just as `FeeCalculator` (Parking Lot, lesson 2) varies pricing without touching the surrounding class, `SplitStrategy` varies how one expense's amount is divided among participants without touching `Expense` or `Ledger`:

```java
interface SplitStrategy {
    Map<User, Long> split(long totalAmountCents, List<User> participants);
}

class EqualSplit implements SplitStrategy {
    public Map<User, Long> split(long totalAmountCents, List<User> participants) {
        long share = totalAmountCents / participants.size();
        long remainder = totalAmountCents - share * participants.size(); // leftover cents from integer division
        Map<User, Long> result = new LinkedHashMap<>();
        for (int i = 0; i < participants.size(); i++) {
            result.put(participants.get(i), share + (i < remainder ? 1 : 0)); // distribute remainder cents
        }
        return result;
    }
}
```

Note the remainder-cent handling — splitting $10.00 three ways is $3.34 + $3.33 + $3.33, not three equal-but-wrong $3.33 shares that lose a cent. This kind of exactness question is a good signal to raise proactively in an interview.

**The ledger is a graph, and settlement is graph simplification.** Model debts as a directed graph: an edge `A → B` with weight `w` means "A owes B $w." After every expense, update the ledger. The naive settlement (everyone pays back exactly what they individually owe on every edge) can require far more transactions than necessary — if A owes B $10 and B owes C $10, that's really just "A owes C $10," collapsible to one payment instead of two.

**Minimizing transaction count — the actual algorithm.** Reduce each user to a single **net balance** (total owed to them minus total they owe), then greedily match the largest debtor with the largest creditor, settle the smaller of the two amounts, and repeat until every net balance is zero:

```java
List<Payment> simplify(Map<User, Long> netBalances) {
    PriorityQueue<Map.Entry<User, Long>> creditors = new PriorityQueue<>((a, b) -> Long.compare(b.getValue(), a.getValue()));
    PriorityQueue<Map.Entry<User, Long>> debtors = new PriorityQueue<>((a, b) -> Long.compare(a.getValue(), b.getValue()));
    // populate both from netBalances (positive = creditor, negative = debtor), then repeatedly
    // pop the largest creditor and largest debtor, settle min(|amounts|), push back any remainder.
    ...
}
```

This greedy approach provably minimizes transactions for this kind of "net it all out" problem — worth stating that guarantee out loud, since it's the part of the answer that separates a strong response from an average one.

## 16.4 Walking through the scenarios

*Simple expense:* Alice pays $30 for dinner, split equally among Alice, Bob, Carol → `EqualSplit` produces $10 each → ledger updates: Bob owes Alice $10, Carol owes Alice $10.

*Chained debt collapsing:* after several expenses, net balances end up Alice: +$20, Bob: -$5, Carol: -$15 → settlement plan: Carol pays Alice $15, Bob pays Alice $5 — two payments total, regardless of how many individual expenses produced those balances.

*Exact split validation:* an `ExactSplit` where the provided amounts don't sum to the total expense amount should be rejected at expense-creation time, not silently create an inconsistent ledger.

> **Review question**
> Why does the settlement algorithm operate on *net* balances per user rather than trying to directly cancel out matching debts on individual ledger edges? What would go wrong (or just be much harder) with the edge-cancellation approach?
