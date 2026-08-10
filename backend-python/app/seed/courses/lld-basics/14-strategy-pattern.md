> **Learning goal**
> Make an algorithm swappable at runtime by extracting it behind an interface — the first of the **behavioral** patterns, and the most common answer to "avoid a giant if/else chain" in LLD interviews.

## 14.1 The problem: behavior baked in with conditionals

A route planner that supports several travel modes tends to start like this:

```java
class RoutePlanner {
    String plan(String mode, String from, String to) {
        if (mode.equals("car")) return "Drive from " + from + " to " + to;
        else if (mode.equals("bike")) return "Bike route from " + from + " to " + to;
        else if (mode.equals("walk")) return "Walking directions from " + from + " to " + to;
        throw new IllegalArgumentException("Unknown mode: " + mode);
    }
}
```

Adding "public transit" means editing `RoutePlanner` again — an OCP violation (lesson 2) — and every mode's logic is tangled together in one method, making each one harder to test in isolation.

## 14.2 The Strategy solution

Extract each algorithm into its own class implementing a shared interface, and have the context class hold a reference to whichever strategy is currently selected.

```java
interface RouteStrategy {
    String buildRoute(String from, String to);
}

class CarStrategy implements RouteStrategy {
    public String buildRoute(String from, String to) { return "Drive from " + from + " to " + to; }
}

class BikeStrategy implements RouteStrategy {
    public String buildRoute(String from, String to) { return "Bike route from " + from + " to " + to; }
}

class RoutePlanner {
    private RouteStrategy strategy;

    void setStrategy(RouteStrategy strategy) { this.strategy = strategy; }

    String plan(String from, String to) {
        return strategy.buildRoute(from, to); // no idea which concrete strategy this is, and doesn't need to
    }
}
```

```java
RoutePlanner planner = new RoutePlanner();
planner.setStrategy(new BikeStrategy());
System.out.println(planner.plan("Home", "Office"));

planner.setStrategy(new CarStrategy()); // swapped at runtime, RoutePlanner unchanged
System.out.println(planner.plan("Home", "Office"));
```

Adding "public transit" is now a new class, `TransitStrategy`, with zero edits to `RoutePlanner` or any existing strategy — a direct fix for the OCP violation.

## 14.3 Strategy vs. State (preview of lesson 16)

These two patterns have near-identical structure (a context holding a reference to an interchangeable interface implementation), and it's a very common interview mix-up:

| | Strategy | State |
| --- | --- | --- |
| Who picks the implementation | The client, explicitly (`setStrategy(...)`) | The object itself, based on its own internal transitions |
| Implementations aware of each other? | No — strategies are independent | Often yes — one state's logic decides which state comes next |
| Typical use | Swappable algorithms (sorting, routing, payment) | An object whose behavior legitimately changes as it moves through a lifecycle (order status, traffic light) |

If the "strategy" is switched by the client from outside, it's Strategy. If the object switches its own behavior in response to what just happened to it, it's State.

## 14.4 Where you'll use this

Interchangeable sorting/compression algorithms, pluggable `PaymentProcessor`s (lesson 1's abstraction example is already Strategy), different fare-calculation rules for a ride-sharing app, or picking a parking-fee strategy by vehicle type in the Parking Lot problem (LLD Practice course) — all Strategy.

> **Review question**
> Why does `RoutePlanner.plan()` not need a `mode` parameter at all in the Strategy version, when the naive version needed one? What does that tell you about where "which mode" now lives?
