> **Learning goal**
> Apply the five-stage framework (lesson 1) to the most commonly asked LLD problem — designing a multi-level parking lot with different vehicle and spot sizes.

## 2.1 Requirements and scope

**Functional requirements:**
- The lot has multiple levels, each with parking spots of different sizes (motorcycle, compact, large).
- A vehicle can only park in a spot of matching or larger size.
- On entry, the system finds an available spot and issues a ticket. On exit, it calculates the fee and frees the spot.
- The fee depends on how long the vehicle was parked.

**Non-functional constraints:** assume single-process, in-memory state; multiple entry points may try to reserve a spot concurrently, so spot assignment must be thread-safe.

**Non-goals:** payment processing itself is a black box (`PaymentProcessor` from LLD Basics lesson 1); reservations ahead of time are out of scope.

## 2.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `ParkingLot` | Owns all levels, finds an available spot, coordinates entry/exit (a natural **Singleton**, LLD Basics lesson 5 — there's only one physical lot) |
| `Level` | Owns a set of spots on one floor |
| `ParkingSpot` | Tracks its own size and occupancy |
| `Vehicle` | Knows its own size category |
| `Ticket` | Records entry time, assigned spot, and vehicle |
| `FeeCalculator` | Computes cost from a `Ticket` (a **Strategy**, LLD Basics lesson 14 — hourly vs. flat-rate pricing can vary) |

## 2.3 Class design

```text
ParkingLot "1" *--> "1..*" Level
Level      "1" *--> "1..*" ParkingSpot
ParkingSpot "1" -- "0..1" Vehicle   (occupied spot references its vehicle)
ParkingLot ..> Ticket                (creates on entry)
Ticket "1" --> "1" ParkingSpot
```

`Level`/`ParkingSpot` are composition (a spot has no meaning outside its lot) — the same reasoning as LLD Basics lesson 4's `House`/`Room` example.

## 2.4 Key design decisions

**Spot-size matching.** `VehicleSize` and `SpotSize` are both an `enum` ordered `MOTORCYCLE < COMPACT < LARGE`; a vehicle can use any spot with `spotSize.ordinal() >= vehicleSize.ordinal()`, but the allocator should prefer the *smallest* fitting spot first to leave large spots free for large vehicles.

**Thread safety.** Each `ParkingSpot` has its own lock (or uses `AtomicBoolean` for occupancy) — locking the whole `ParkingLot` for every entry would serialize unrelated cars parking on different floors, which is unnecessary contention.

**Fee strategy.** `FeeCalculator` is an interface so `HourlyFeeCalculator` and `FlatRateFeeCalculator` are interchangeable without touching `ParkingLot` — this is Strategy, not a hardcoded formula.

## 2.5 Walking through the scenarios

*Happy path:* a `Car` arrives → `ParkingLot.parkVehicle(car)` scans levels for the smallest available `COMPACT`-or-larger spot → marks it occupied, creates a `Ticket` → on exit, `FeeCalculator` computes cost from `now - ticket.entryTime()`, spot is freed.

*No spot available:* `parkVehicle` returns `Optional.empty()` (or throws a specific `NoAvailableSpotException`) rather than silently failing — the caller (a gate controller) decides what to display.

*Concurrent entries:* two cars arrive at the same instant at different gates; each gate thread calls `parkVehicle` independently, and because each spot's occupancy check-and-set is atomic, they can never be assigned the same spot.

> **Review question**
> How would you extend this design to support a $5 discount for the first hour of electric-vehicle charging spots, without modifying `FeeCalculator`'s existing implementations?
