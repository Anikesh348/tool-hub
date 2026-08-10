> **Learning goal**
> Let an object change its own behavior when its internal state changes, replacing a status-flag-plus-if/else mess with one class per state that knows only about its own transitions.

## 16.1 The problem: a status field driving behavior everywhere

An order-tracking system with a `status` field tends to sprawl the same conditional across every method:

```java
class Order {
    String status = "PLACED"; // "PLACED", "SHIPPED", "DELIVERED", "CANCELLED"

    void ship() {
        if (status.equals("PLACED")) status = "SHIPPED";
        else throw new IllegalStateException("Can only ship a placed order");
    }

    void deliver() {
        if (status.equals("SHIPPED")) status = "DELIVERED";
        else throw new IllegalStateException("Can only deliver a shipped order");
    }

    void cancel() {
        if (status.equals("PLACED") || status.equals("SHIPPED")) status = "CANCELLED";
        else throw new IllegalStateException("Cannot cancel a delivered order");
    }
}
```

Every method re-derives "which transitions are legal from here," and the rules for a given status are scattered across every method instead of living in one place.

## 16.2 The State solution

Model each status as its own class implementing a shared `OrderState` interface; each state class only knows the transitions legal *from itself*, and the `Order` simply delegates to whichever state object it currently holds.

```java
interface OrderState {
    OrderState ship();
    OrderState deliver();
    OrderState cancel();
}

class PlacedState implements OrderState {
    public OrderState ship() { System.out.println("Shipping order"); return new ShippedState(); }
    public OrderState deliver() { throw new IllegalStateException("Can only deliver a shipped order"); }
    public OrderState cancel() { System.out.println("Cancelling order"); return new CancelledState(); }
}

class ShippedState implements OrderState {
    public OrderState ship() { throw new IllegalStateException("Already shipped"); }
    public OrderState deliver() { System.out.println("Delivering order"); return new DeliveredState(); }
    public OrderState cancel() { System.out.println("Cancelling order"); return new CancelledState(); }
}

class DeliveredState implements OrderState {
    public OrderState ship() { throw new IllegalStateException("Already delivered"); }
    public OrderState deliver() { throw new IllegalStateException("Already delivered"); }
    public OrderState cancel() { throw new IllegalStateException("Cannot cancel a delivered order"); }
}

class CancelledState implements OrderState {
    public OrderState ship() { throw new IllegalStateException("Order was cancelled"); }
    public OrderState deliver() { throw new IllegalStateException("Order was cancelled"); }
    public OrderState cancel() { throw new IllegalStateException("Already cancelled"); }
}

class Order {
    private OrderState state = new PlacedState();

    void ship() { state = state.ship(); }
    void deliver() { state = state.deliver(); }
    void cancel() { state = state.cancel(); }
}
```

Each state class is a small, independently readable answer to "what's legal from here, and what comes next." Adding a new status (say, `ReturnedState`) means writing one new class — no existing state's code needs to change.

## 16.3 State vs. Strategy — resolving lesson 14's preview

Now that you've seen both: `RoutePlanner.setStrategy(...)` is called by the *client*, choosing between independent, mutually-unaware algorithms. `Order`'s state transitions are decided by *the state objects themselves* (`PlacedState.ship()` returns a `ShippedState`) — the object drives its own lifecycle, and the states are deeply aware of each other's existence (which is legal to come next). If your "states" don't reference each other at all, you might actually have Strategy; if your "strategies" need to know what came before, you might actually have State.

## 16.4 Where you'll use this

Order status, a traffic light's phase (LLD Practice course, lesson 5), a vending machine's dispense flow (has money been inserted yet? lesson 4), or a game character's state (idle/walking/attacking) are all textbook State pattern applications.

> **Review question**
> Why does each state's method return a *new* `OrderState` object rather than just mutating `this.status` on a shared state instance? What would go wrong with a single shared `PlacedState` singleton if this pattern were applied across multiple concurrent `Order` objects?
