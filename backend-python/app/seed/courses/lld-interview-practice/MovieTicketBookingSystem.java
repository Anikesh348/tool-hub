import java.util.ArrayList;
import java.util.List;

/**
 * Complete reference implementation for the Movie Ticket Booking System LLD
 * problem: per-seat holds with expiry, and a BookingFacade sequencing
 * hold -> payment -> confirm with rollback on partial failure.
 *   javac MovieTicketBookingSystem.java && java MovieTicketBookingSystem
 */
public class MovieTicketBookingSystem {

    enum SeatStatus { AVAILABLE, HELD, BOOKED }

    static class Seat {
        private final String seatId;
        private SeatStatus status = SeatStatus.AVAILABLE;
        private String heldByUserId;
        private long holdExpiryMillis;

        Seat(String seatId) { this.seatId = seatId; }

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

        synchronized void releaseHold(String userId) {
            if (status == SeatStatus.HELD && userId.equals(heldByUserId)) {
                status = SeatStatus.AVAILABLE;
                heldByUserId = null;
            }
        }

        private void releaseIfExpired() {
            if (status == SeatStatus.HELD && System.currentTimeMillis() > holdExpiryMillis) {
                status = SeatStatus.AVAILABLE;
                heldByUserId = null;
            }
        }

        String getSeatId() { return seatId; }
    }

    interface PaymentProcessor {
        boolean charge(String userId, double amount);
    }

    static class StubPaymentProcessor implements PaymentProcessor {
        public boolean charge(String userId, double amount) {
            System.out.println("Charged " + userId + " $" + amount);
            return true;
        }
    }

    static class Booking {
        final String userId;
        final List<Seat> seats;

        Booking(String userId, List<Seat> seats) {
            this.userId = userId;
            this.seats = seats;
        }
    }

    static class BookingFacade {
        private final PaymentProcessor paymentProcessor;
        private static final long HOLD_DURATION_MILLIS = 5 * 60 * 1000;

        BookingFacade(PaymentProcessor paymentProcessor) { this.paymentProcessor = paymentProcessor; }

        Booking book(String userId, List<Seat> requestedSeats, double pricePerSeat) {
            List<Seat> held = new ArrayList<>();
            for (Seat seat : requestedSeats) {
                if (seat.tryHold(userId, HOLD_DURATION_MILLIS)) {
                    held.add(seat);
                } else {
                    System.out.println("Seat " + seat.getSeatId() + " unavailable - rolling back holds");
                    for (Seat h : held) h.releaseHold(userId); // all-or-nothing
                    return null;
                }
            }

            boolean paid = paymentProcessor.charge(userId, pricePerSeat * held.size());
            if (!paid) {
                for (Seat h : held) h.releaseHold(userId);
                return null;
            }

            for (Seat seat : held) seat.confirmBooking(userId);
            return new Booking(userId, held);
        }
    }

    public static void main(String[] args) {
        Seat a1 = new Seat("A1");
        Seat a2 = new Seat("A2");
        Seat a3 = new Seat("A3");

        BookingFacade facade = new BookingFacade(new StubPaymentProcessor());

        Booking booking1 = facade.book("user-1", List.of(a1, a2), 12.50);
        System.out.println("user-1 booking: " + (booking1 != null ? "confirmed" : "failed"));

        // user-2 tries to book a1 (already booked) and a3 (still available) - must roll back a3's hold too.
        Booking booking2 = facade.book("user-2", List.of(a1, a3), 12.50);
        System.out.println("user-2 booking: " + (booking2 != null ? "confirmed" : "failed"));

        // a3 should be free again after the rollback.
        Booking booking3 = facade.book("user-3", List.of(a3), 12.50);
        System.out.println("user-3 booking: " + (booking3 != null ? "confirmed" : "failed"));
    }
}
