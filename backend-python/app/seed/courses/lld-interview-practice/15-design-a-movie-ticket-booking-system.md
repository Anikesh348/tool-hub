> **Learning goal**
> Design a booking system with concurrent seat locking — arguably the most interview-relevant concurrency problem in this course, since "prevent double-booking" is the crux of the entire design.

## 15.1 Requirements and scope

**Functional requirements:** a cinema has multiple screens, each showing multiple movies at scheduled times (`Show`s), each `Show` has a seating layout; a user selects seats for a show, holds them briefly while completing payment, and either confirms (permanently books) or the hold expires and seats become available again.

**Non-functional constraints:** two users must never be able to book the same seat for the same show — this is the core correctness requirement under concurrency.

**Non-goals:** seat pricing tiers, payment gateway integration (a `PaymentProcessor` black box, LLD Basics lesson 1), refunds/cancellation flow.

## 15.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Movie`, `Screen`, `Show` | Catalog: a movie, playing on a screen, at a specific time |
| `Seat` | One physical seat on a screen, with its own lock state |
| `Booking` | A confirmed reservation: user, show, seats, payment status |
| `BookingFacade` | Coordinates seat-holding, payment, and confirmation (**Facade**, LLD Basics lesson 11) |

## 15.3 Class design

```text
Show "1" --> "1" Movie
Show "1" --> "1" Screen
Screen "1" *--> "1..*" Seat
Booking "1" --> "1" Show
Booking "1" *--> "1..*" Seat
```

## 15.4 Key design decisions — this problem is about concurrency, not just structure

**The core race condition.** Two users click "book" on the same seat within milliseconds of each other. Without synchronization, both could read "seat is available," both proceed to payment, and both succeed — a double-booking. The fix has to happen at the *seat-locking* step, not after payment.

**Per-seat locking, held only during the hold window.** Rather than one lock for the whole `Show` (which would serialize booking across every seat, killing throughput for a popular showtime), lock at the individual `Seat` level, and only for a short "hold" duration (e.g. 5 minutes) while the user completes payment — not for the entire booking flow's wall-clock time if it involves waiting on a slow payment gateway.

```java
enum SeatStatus { AVAILABLE, HELD, BOOKED }

class Seat {
    private final String seatId;
    private volatile SeatStatus status = SeatStatus.AVAILABLE;
    private String heldByUserId;
    private long holdExpiryMillis;

    synchronized boolean tryHold(String userId, long holdDurationMillis) {
        releaseIfExpired();
        if (status != SeatStatus.AVAILABLE) return false;
        status = SeatStatus.HELD;
        heldByUserId = userId;
        holdExpiryMillis = System.currentTimeMillis() + holdDurationMillis;
        return true;
    }

    synchronized boolean confirmBooking(String userId) {
        releaseIfExpired();
        if (status != SeatStatus.HELD || !heldByUserId.equals(userId)) return false;
        status = SeatStatus.BOOKED;
        return true;
    }

    private void releaseIfExpired() {
        if (status == SeatStatus.HELD && System.currentTimeMillis() > holdExpiryMillis) {
            status = SeatStatus.AVAILABLE; // hold timed out - seat becomes bookable again
            heldByUserId = null;
        }
    }
}
```

The `synchronized` methods make the check-then-set on each individual seat atomic — the same pattern the Parking Lot problem (lesson 2) used for `ParkingSpot.tryOccupy`.

**`BookingFacade` sequences the flow.** Select seats → try-hold each one (rolling back any partial holds if even one seat in the group fails) → run payment → confirm all held seats. This is Facade (LLD Basics lesson 11) coordinating several steps behind one method, exactly like that lesson's `OrderFacade`.

**Expired holds must be reclaimed.** A user who abandons checkout shouldn't permanently lock a seat — `releaseIfExpired()` lazily reclaims it on the *next* access, avoiding the need for a separate background sweep thread for a reference implementation (though a real system would likely add one for seats nobody ever revisits).

## 15.5 Walking through the scenarios

*Successful booking:* user selects 2 seats → both held → payment succeeds → `BookingFacade` confirms both → `Booking` created.

*Concurrent conflict:* two users both call `tryHold` on the same seat within the same millisecond → `synchronized` guarantees only one succeeds; the other's `BookingFacade` call sees a hold failure and must release any *other* seats it already held for that same request (all-or-nothing).

*Abandoned checkout:* user holds seats, closes the tab → 5 minutes later, another user's `tryHold` call on the same seat calls `releaseIfExpired()` and successfully re-holds it.

> **Review question**
> A user tries to hold 3 seats; seats A and B succeed, seat C fails (already held by someone else). What must `BookingFacade` do with A and B's holds, and why is skipping that cleanup a correctness bug, not just a UX annoyance?
