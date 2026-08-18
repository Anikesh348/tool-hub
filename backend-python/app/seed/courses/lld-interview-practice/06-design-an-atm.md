> **Learning goal**
> Design an ATM's withdrawal flow, combining State (the transaction lifecycle) with a genuinely interesting algorithmic sub-problem: dispensing the correct mix of bills for an amount.

## 6.1 Requirements and scope

**Functional requirements:** a user inserts a card, enters a PIN, selects an account and an action (withdraw, check balance), and — for withdrawal — the ATM validates funds and available cash, then dispenses the fewest bills that sum to the requested amount.

**Non-functional constraints:** single ATM, in-memory account balances and cash inventory; withdrawal amount must be a valid combination given the bill denominations stocked.

**Non-goals:** card-network communication/fraud checks (assume a `BankService` black box), deposits.

## 6.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Atm` | Owns cash inventory and current `AtmState`; the single hardware unit (**Singleton**, LLD Basics lesson 5) |
| `AtmState` | IdleState / HasCardState / AuthenticatedState / DispensingState |
| `CashDispenser` | Given an amount, computes the bill breakdown and decrements inventory |
| `BankService` | Interface for balance checks and debits — the real bank system, treated as external |
| `Account` | Bank account being operated on |

## 6.3 Class design

```text
Atm "1" --> "1" AtmState
Atm "1" *--> "1" CashDispenser
Atm ..> BankService   (dependency, not ownership - DIP from LLD Basics lesson 2)
```

## 6.4 Key design decisions

**State drives the transaction lifecycle.** `IdleState` only accepts `insertCard`; `HasCardState` only accepts `enterPin`; `AuthenticatedState` accepts `withdraw`/`checkBalance`/`ejectCard`; this is the same shape as the Vending Machine (lesson 4) — each state answers only "what's legal from here."

**The bill-dispensing algorithm.** Given denominations `[100, 50, 20, 10]` and an amount, a greedy algorithm (use as many of the largest bill as possible, then the next, etc.) works correctly *because* these specific denominations happen to have that property — but greedy isn't correct for arbitrary denominations in general (a classic algorithmic trap). For interview purposes, state this assumption explicitly, and mention that a general solution would need dynamic programming (minimum coin/bill change) if denominations weren't guaranteed greedy-friendly.

```java
Map<Integer, Integer> dispense(int amount, int[] denominations) {
    Map<Integer, Integer> result = new LinkedHashMap<>();
    for (int d : denominations) { // must be sorted descending
        int count = amount / d;
        if (count > 0) {
            result.put(d, count);
            amount -= count * d;
        }
    }
    if (amount != 0) throw new IllegalArgumentException("Cannot make exact amount with available denominations");
    return result;
}
```

**Insufficient cash vs. insufficient funds are different failures.** The ATM must check *both* independently: does the account have enough balance, *and* does the machine physically have enough bills of the right denominations left. Both should be checked before debiting the account — debiting first and then discovering the machine is out of $20 bills would require an error-prone reversal.

## 6.5 Walking through the scenarios

*Happy path:* insert card → `HasCardState` → correct PIN → `AuthenticatedState` → withdraw $170 → `BankService.debit` succeeds, `CashDispenser.dispense(170, [100,50,20,10])` returns `{100:1, 50:1, 20:1}` → cash dispensed, back to `IdleState`.

*Wrong PIN:* stays in `HasCardState`, with an attempt counter — after 3 failures, eject the card and return to `IdleState` (a good place to mention a `MaxAttemptsExceededState` if the interviewer wants more detail).

*Amount not dispensable:* user requests $15 but the machine only stocks $20/$50/$100 bills — reject *before* debiting the account.

> **Review question**
> The ATM runs out of $20 bills but still has plenty of $10s and $50s. A user requests $40. Walk through what the greedy algorithm in section 6.4 does, and whether it produces a correct result here.
