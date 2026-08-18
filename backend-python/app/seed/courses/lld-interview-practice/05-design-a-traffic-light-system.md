> **Learning goal**
> A short, focused problem for practicing clean State-pattern transitions and simple time-based scheduling — good warm-up before the more elaborate problems later in this course.

## 5.1 Requirements and scope

**Functional requirements:** an intersection has traffic lights for multiple directions; each light cycles Red → Green → Yellow → Red; only one direction (or one non-conflicting pair, e.g. North-South together) should be Green at a time; each color has a configurable duration.

**Non-functional constraints:** single intersection, in-memory scheduling (a real system would use hardware timers; here, a simulated `tick()`).

**Non-goals:** pedestrian signals, emergency-vehicle preemption, multi-intersection coordination.

## 5.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Intersection` | Owns the set of `TrafficLight`s and enforces that only non-conflicting directions are Green simultaneously |
| `TrafficLight` | Tracks its own current `LightState` and how long it's been in that state |
| `LightState` | RedState / GreenState / YellowState — knows its own duration and what state comes next |

## 5.3 Class design

```text
Intersection "1" *--> "2..4" TrafficLight
TrafficLight "1" --> "1" LightState
```

## 5.4 Key design decisions

**State drives its own duration and transition.** Each `LightState` implementation knows two things about itself: how long it lasts, and what state comes after it — this keeps `TrafficLight` itself completely ignorant of the cycle order (Red → Green → Yellow → Red), matching LLD Basics lesson 16's core idea that state objects, not the context, decide what's next.

```java
interface LightState {
    long durationMillis();
    LightState next();
    String colorName();
}

class RedState implements LightState {
    public long durationMillis() { return 5000; }
    public LightState next() { return new GreenState(); }
    public String colorName() { return "RED"; }
}
```

**Conflict groups, not one Green at a time.** A real intersection lets North-South be Green together while East-West is Red, then swaps. Model this as `Intersection` holding named "phases" (a phase is a set of directions allowed to be Green simultaneously) rather than a single global "whose turn is it" flag — this generalizes cleanly to intersections with turn lanes later, without a redesign.

**Simulated scheduling.** Rather than real timers (which would make the reference implementation non-deterministic and hard to demo), each `TrafficLight.tick(elapsedMillis)` advances its own internal clock and transitions state once `elapsedMillis >= currentState.durationMillis()` — this is the same idea a real embedded scheduler would use, just simplified to a manual loop for the demo.

## 5.5 Walking through the scenarios

*Normal cycle:* North-South light starts Red → after 5s tick, transitions to Green (5s) → after that, Yellow (2s) → back to Red — while East-West stays Red throughout North-South's Green+Yellow phase, only starting its own cycle once North-South returns to Red.

*Mid-cycle configuration change:* operations wants to extend Yellow to 3s during rush hour — because duration lives on the `LightState` object itself, this is a one-line change to `YellowState`, with zero changes to `TrafficLight` or `Intersection`.

> **Review question**
> How would you add an `AllRedState` (a brief all-directions-red safety pause between phase swaps) without `TrafficLight` or `Intersection` needing new conditional logic?
