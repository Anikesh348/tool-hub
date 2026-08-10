> **Learning goal**
> A repeatable five-stage framework for answering any "design a ___" LLD interview question under time pressure — applied to a specific problem in every lesson that follows.

An LLD interview (45-60 minutes, typically) is not a test of whether you've memorized a specific answer — it's a test of whether you can structure an ambiguous problem methodically, out loud, while trading off decisions in real time. The framework below is what every lesson in this course applies.

## 1.1 Stage 1 — Clarify requirements and scope (5 minutes)

Never start designing before you've pinned down scope. Ask, and write down:
- **Functional requirements**: what must the system actually do? (e.g. "can a user reserve a spot, or only park/unpark?")
- **Non-functional constraints**: how many concurrent users? Does it need to be thread-safe? Persisted, or in-memory for this exercise?
- **Explicit non-goals**: what's out of scope? ("Assume payment is a black box we call, not something we design.")

Skipping this stage is the single most common way candidates run out of time — they design a system nobody asked for, or one so broad they can't finish any part of it.

## 1.2 Stage 2 — Identify the core objects (nouns) and their responsibilities (10 minutes)

Pull the nouns out of the requirements and ask what each one is responsible for. For a Parking Lot: `ParkingLot`, `ParkingSpot`, `Vehicle`, `Ticket`, `Payment`. Assign each a *single* clear responsibility (SRP, from the LLD Basics course) — resist the urge to let one class do everything.

## 1.3 Stage 3 — Define relationships and draw the class diagram (10-15 minutes)

For each pair of related classes, decide: association, aggregation, or composition (LLD Basics lesson 4), and inheritance vs. interface implementation (LLD Basics lesson 1). Sketch it — even rough ASCII boxes and arrows communicate far more than a wall of prose. This is where most of your actual "design" thinking happens.

## 1.4 Stage 4 — Apply design patterns where they genuinely fit (10 minutes)

Don't force a pattern in — but do actively check for the common triggers:
- A component that must be a single shared instance → **Singleton**
- Object creation logic that would otherwise be duplicated → **Factory**
- An algorithm that needs to vary (pricing, routing) → **Strategy**
- An object whose behavior legitimately changes with its lifecycle → **State**
- Something needs to be notified whenever another thing changes → **Observer**

Naming the pattern out loud ("I'll use Strategy here so the fee calculation can vary by vehicle type") signals fluency far more than silently writing the same code without naming it.

## 1.5 Stage 5 — Walk through key scenarios and discuss trade-offs (10 minutes)

Trace 2-3 concrete flows through your design end-to-end (e.g. "a car with no available spot arrives — walk me through what happens"). This is where design gaps surface. Close by naming at least one real trade-off you made — concurrency handling, in-memory vs. persisted state, or where you deliberately kept something simple due to time.

## 1.6 A concurrency checklist, since it comes up constantly

Most LLD problems touch shared mutable state somewhere (a parking spot, a bank balance, an elevator's queue). Be ready to name:
- Where a race condition could occur (two threads reserving the same spot)
- What you'd lock, and at what granularity (a lock per spot, not one giant lock for the whole lot)
- Whether `synchronized`, a `ReentrantLock`, or an atomic/concurrent collection is the right tool

You don't need to fully implement thread safety in every lesson's code — but you should always be able to point at *where* it matters and *how* you'd add it.

## 1.7 How this course is organized

Each following lesson picks one classic problem, applies exactly this five-stage framework, and ends with a complete, downloadable Java implementation plus a review question. Problems are roughly ordered easy → complex, but each stands alone — jump to whichever is most relevant to your prep.

> **Review question**
> Pick any system you use daily (a ride-sharing app, a food delivery app, a music streaming app). Spend 5 minutes on just Stage 1 — write down 4 functional requirements, 2 non-functional constraints, and 2 explicit non-goals.
