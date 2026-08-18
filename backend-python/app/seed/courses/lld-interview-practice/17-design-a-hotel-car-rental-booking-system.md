> **Learning goal**
> Design a reservation system centered on availability over a date range — the interview problem most focused on correctly modeling overlapping-interval conflicts, which shows up in scheduling problems generally, not just bookings.

## 17.1 Requirements and scope

**Functional requirements:** an inventory of bookable units (hotel rooms, or rental cars) each has a type/category; a user searches for availability of a given type across a date range and books a specific unit for that range; the system must never double-book the same unit for overlapping dates.

**Non-functional constraints:** availability search should be efficient even with many existing bookings per unit; booking a unit must be safe under concurrent requests, same correctness bar as the Movie Ticket Booking problem (lesson 15).

**Non-goals:** dynamic pricing, loyalty/rewards programs, multi-property search.

## 17.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Inventory Unit` (`Room` or `Car`) | A single bookable resource with a type/category |
| `DateRange` | A `(startDate, endDate)` value object with an `overlaps(other)` check |
| `Reservation` | A confirmed booking: unit, user, date range |
| `Inventory` | Owns all units of a type, answers availability queries |
| `BookingService` | Coordinates availability check + reservation creation atomically |

## 17.3 Key design decisions

**`DateRange` as its own value object, not two raw fields scattered everywhere.** Centralizing the overlap check in one place avoids subtly different (and possibly buggy) date-comparison logic being duplicated at every call site:

```java
record DateRange(LocalDate start, LocalDate end) {
    boolean overlaps(DateRange other) {
        return start.isBefore(other.end) && other.start.isBefore(end); // classic interval-overlap check
    }
}
```

Note the strict `isBefore` on both sides — this correctly treats back-to-back bookings (one guest checks out the same day another checks in) as *not* overlapping, which is usually the desired real-world behavior; get this comparison direction wrong and you'll either reject valid back-to-back bookings or allow genuinely overlapping ones.

**Checking availability: scan existing reservations for overlap, not a day-by-day calendar grid.** For a unit with a manageable number of reservations, checking a new request against every existing `Reservation`'s `DateRange` via `overlaps()` is simpler and often faster than maintaining a full per-day availability calendar — the calendar approach only pays off at very high booking density per unit, worth mentioning as a scaling follow-up rather than defaulting to it.

```java
boolean isAvailable(Unit unit, DateRange requested) {
    return unit.getReservations().stream().noneMatch(r -> r.getDateRange().overlaps(requested));
}
```

**Atomicity: check-then-book must be a single locked operation.** Exactly the same race condition as the Movie Ticket Booking problem (lesson 15): if "check availability" and "create reservation" are two separate steps, two concurrent requests can both see "available" before either commits. Lock at the unit level (`synchronized` on the specific `Unit`, or a per-unit lock object) around the combined check-and-reserve:

```java
synchronized Reservation reserve(Unit unit, User user, DateRange range) {
    if (!isAvailable(unit, range)) throw new UnitUnavailableException(unit, range);
    Reservation reservation = new Reservation(unit, user, range);
    unit.addReservation(reservation);
    return reservation;
}
```

**Searching across many units of a type.** `Inventory.findAvailable(type, range)` filters all units of the requested type through `isAvailable`, returning the first (or all) that pass — this is a plain filter, no special data structure needed unless the inventory is large enough to warrant an interval tree, which is worth naming as a scaling option without necessarily implementing it.

## 17.4 Walking through the scenarios

*Successful booking:* user searches for a "Deluxe" room, Jan 10-15 → `Inventory` returns units passing `isAvailable` → user books one → `BookingService.reserve` locks that unit, re-verifies availability, creates the `Reservation`.

*Back-to-back, not a conflict:* Room 101 has a reservation Jan 10-15; a new request for Jan 15-20 is correctly accepted, since checkout and check-in share the boundary date without overlapping.

*Race condition, caught:* two users both search and see Room 101 as available for Jan 10-15 at nearly the same time; both call `reserve` — the `synchronized` block serializes them, so the second call's `isAvailable` re-check (now seeing the first reservation) correctly rejects it.

> **Review question**
> How would `DateRange.overlaps` need to change if the business rule were "same-day turnover isn't allowed — checkout and check-in must be on different days"? What's the minimal code change?
