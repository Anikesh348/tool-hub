> **Learning goal**
> Design a vending machine whose behavior — what buttons/coins do — genuinely changes depending on where it is in its purchase flow, making it one of the cleanest real-world applications of the State pattern.

## 4.1 Requirements and scope

**Functional requirements:** the machine stocks several products, each with a price and quantity; a user inserts coins, selects a product, and either receives the product and any change, or can cancel and get their money back; the machine must reject selecting a product with insufficient funds or that's out of stock.

**Non-functional constraints:** single machine, in-memory inventory.

**Non-goals:** card/contactless payment (assume coins only), physical dispensing hardware.

## 4.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `VendingMachine` | Holds inventory, current balance, and the current state; delegates actions to the state |
| `VendingMachineState` | IdleState / HasMoneyState / DispensingState — each defines what `insertCoin`, `selectProduct`, and `cancel` do *from that state* |
| `Product` | Name, price, quantity in stock |
| `Inventory` | Maps product codes to `Product` + slot quantities |

## 4.3 Class design

```text
VendingMachine "1" --> "1" VendingMachineState
VendingMachine "1" *--> "1" Inventory
Inventory "1" *--> "0..*" Product
```

## 4.4 Key design decisions — this is a State-pattern problem

This is the textbook case for LLD Basics lesson 16. Compare the three states' behavior for the *same two methods*:

| | `IdleState` | `HasMoneyState` | `DispensingState` |
| --- | --- | --- | --- |
| `insertCoin(amount)` | Adds to balance, transitions to `HasMoneyState` | Adds to balance, stays in `HasMoneyState` | Rejected — mid-dispense |
| `selectProduct(code)` | Rejected — insert money first | If balance covers price: dispense, transition to `DispensingState` → back to `IdleState`. If not: reject with "insufficient funds" | Rejected — already dispensing |
| `cancel()` | No-op | Refunds balance, back to `IdleState` | Rejected — too late |

Writing this as one class with a `status` enum and a growing `if/else` in every method (the anti-pattern LLD Basics lesson 16 opens with) becomes unreadable fast; three small state classes, each answering only "what happens from here," stays clear as the machine grows more states (e.g. `OutOfStockState`).

**Change calculation.** On successful purchase, `change = balance - product.price()`; keep this as a pure function on `VendingMachine` so it's trivially unit-testable independent of state transitions.

## 4.5 Walking through the scenarios

*Happy path:* idle → insert $1 → `HasMoneyState` → select a $0.75 soda → dispenses, returns $0.25 change → back to `IdleState`.

*Insufficient funds:* idle → insert $0.50 → select a $0.75 soda → `HasMoneyState.selectProduct` rejects, balance stays at $0.50 (not returned automatically — user can add more coins or cancel).

*Out of stock:* selecting a product with `quantity == 0` should be rejected regardless of balance — a good place for an `OutOfStockState` per-slot check rather than a global state, since other slots remain purchasable.

> **Review question**
> Add an `OutOfStockState` transition for a specific slot without affecting the rest of the machine's inventory. Does this belong on `VendingMachineState` (global) or on `Product`/inventory slot (per-item)? Justify your answer.
