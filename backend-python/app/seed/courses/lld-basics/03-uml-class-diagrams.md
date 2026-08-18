> **Learning goal**
> Read and draw the handful of UML notations that actually show up in LLD interviews and design docs — enough to communicate a design on a whiteboard in minutes, not a full UML certification.

You will never be asked to produce a textbook-perfect UML diagram in an interview. You *will* be expected to sketch boxes, arrows, and a handful of symbols that unambiguously communicate your class design. This lesson covers exactly that subset.

## 3.1 The class box

A class is drawn as a box with three compartments: name, fields, methods.

```text
+-------------------------+
|        Vehicle          |
+-------------------------+
| - wheelCount: int       |
| # licensePlate: String  |
+-------------------------+
| + calculateToll(): double |
+-------------------------+
```

`-` means private, `#` means protected, `+` means public. In practice, most interview sketches drop the visibility symbols and just list the important fields/methods — the goal is clarity, not ceremony.

## 3.2 Interfaces

An interface is drawn like a class box with `<<interface>>` above the name (methods only, no state):

```text
+---------------------------+
|   <<interface>>           |
|   PaymentProcessor        |
+---------------------------+
| + charge(id, amount): bool|
+---------------------------+
```

## 3.3 Relationship arrows — the part that actually matters

This is the part interviewers watch closely, because picking the wrong relationship reveals a design flaw. From weakest to strongest coupling:

| Relationship | Arrow | Meaning | Example |
| --- | --- | --- | --- |
| Dependency | `A ..> B` (dashed, open arrow) | A briefly uses B (e.g. a method parameter) | `OrderService ..> EmailValidator` |
| Association | `A --> B` (solid, open arrow) | A holds a reference to B, both can outlive each other | `Teacher --> Course` |
| Aggregation | `A o--> B` (solid line, hollow diamond at A) | A "has" B, but B can exist independently | `Library o--> Book` |
| Composition | `A *--> B` (solid line, filled diamond at A) | A owns B; B's lifetime is tied to A's | `House *--> Room` |
| Inheritance | `A --|> B` (solid line, hollow triangle at B) | A "is-a" B | `Car --|> Vehicle` |
| Realization | `A ..|> B` (dashed line, hollow triangle at B) | A implements interface B | `CreditCardProcessor ..|> PaymentProcessor` |

Lesson 4 goes deep on association vs. aggregation vs. composition specifically, since that's the distinction interviewers probe hardest — it decides who is responsible for creating, owning, and destroying an object.

## 3.4 Multiplicity

Numbers near the ends of a relationship line say how many of each side participate:

```text
Library "1" o--> "0..*" Book
Order    "1" *--> "1..*" OrderLine
```

`0..*` reads "zero or more," `1..*` reads "one or more," a bare number means exactly that many. This is what lets a reviewer immediately see "oh, a `Library` can have zero books, but an `Order` must have at least one line" without reading a paragraph of prose.

## 3.5 A worked sketch

Putting it together — a minimal parking-lot class diagram (the full problem is lesson 2 of the LLD Practice course):

```text
+------------------+          +----------------+
|   ParkingLot     |  1    *  |  ParkingSpot   |
|------------------|o-------->|----------------|
| - spots: List    |          | - isOccupied   |
| + parkVehicle()  |          | + assign()     |
+------------------+          +----------------+
        |
        | 1..*
        v
+------------------+
|  <<interface>>   |
|  Vehicle         |
+------------------+
        ^
        | (realizes)
   +---------+---------+
   |         |          |
+-----+  +-------+  +--------+
| Car |  | Truck |  | Bike   |
+-----+  +-------+  +--------+
```

That's genuinely enough UML to whiteboard almost any LLD answer clearly. The remaining skill — *which* relationships to pick between real classes — is what lessons 4-18 build.

> **Review question**
> Sketch (in words or ASCII) the relationship between `Order` and `OrderLine`, and between `Order` and `Customer`. Which one should be composition, and which should be association? Justify using object lifetime.
