> **Learning goal**
> Design a multi-elevator system that assigns incoming requests to the best elevator and processes each elevator's stops in a sensible order — the LLD problem most focused on **State** and scheduling logic.

## 3.1 Requirements and scope

**Functional requirements:** a building has multiple elevators; a user on a floor presses up/down (an external request); a user inside an elevator presses a destination floor (an internal request); the system must pick which elevator answers each external request and process each elevator's stops efficiently (not necessarily strict FIFO — a real elevator serves floors along its current direction first).

**Non-functional constraints:** single process, in-memory; elevator state changes (moving, doors, direction) must be modeled explicitly since this is the crux of the problem.

**Non-goals:** physical door-sensor hardware integration, exact motor control — treat "move one floor" as an atomic simulated step.

## 3.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `ElevatorController` | Owns all elevators, decides which elevator answers an external request |
| `Elevator` | Tracks its own floor, direction, door state, and pending stops |
| `ElevatorState` | Idle / Moving / DoorsOpen — an application of **State** (LLD Basics lesson 16) |
| `Request` | An external (floor + direction) or internal (destination floor) request |

## 3.3 Class design

```text
ElevatorController "1" *--> "1..*" Elevator
Elevator "1" --> "1" ElevatorState
Elevator "1" *--> "0..*" Request   (pending stops)
```

## 3.4 Key design decisions

**Elevator selection strategy.** When an external request comes in (floor 5, going up), the controller scores each elevator — e.g. prefer an idle elevator, then one already moving *toward* floor 5 in the same direction, then the closest by distance — and assigns to the best score. This selection logic is naturally a **Strategy** (LLD Basics lesson 14): swap in a different scoring function without touching `ElevatorController`.

**Stop ordering — the SCAN algorithm.** Rather than serving requests in the order they arrived, a real elevator keeps moving in its current direction, picking up every pending stop along the way, then reverses — this is the classic "elevator algorithm" (SCAN). Model pending stops as two sorted sets: `upStops` and `downStops`. While moving up, pop the smallest `upStop` greater than the current floor; once none remain, switch to `downStops` from the top.

**State transitions.** `ElevatorState` (IDLE → MOVING → DOORS_OPEN → IDLE/MOVING) governs what's a legal next action — this is exactly LLD Basics lesson 16's State pattern: you can't accept a new destination floor request mid-door-open the same way you would while idle.

## 3.5 Walking through the scenarios

*External request:* user on floor 5 presses "up" → `ElevatorController.requestElevator(5, UP)` scores all elevators → best one gets `5` added to its `upStops` (or `downStops` if it's already past floor 5 going up, needing a reversal) → elevator's own loop picks it up along its SCAN pass.

*Internal request:* a rider already inside elevator 2 presses "8" → added directly to elevator 2's stop set, no controller-level selection needed.

*Two requests, opposite directions, same floor:* someone on floor 5 wants to go up, someone else on floor 5 wants to go down — these are two independent `Request`s (different direction), and might legitimately be served by two different elevators.

> **Review question**
> An elevator is moving up, currently at floor 3, with pending stops at floors 6 and 8. A new external request arrives: floor 2, going down. Should this elevator take it, or should the controller prefer a different (possibly idle) elevator? Justify using the SCAN behavior above.
