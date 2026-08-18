import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Complete reference implementation for the Hotel / Car Rental Booking
 * System LLD problem: a DateRange value object, overlap-based availability
 * checks, and an atomic per-unit locked reserve() operation.
 *   javac BookingSystem.java && java BookingSystem
 */
public class BookingSystem {

    record DateRange(LocalDate start, LocalDate end) {
        boolean overlaps(DateRange other) {
            return start.isBefore(other.end) && other.start.isBefore(end);
        }
    }

    static class User {
        private final String name;
        User(String name) { this.name = name; }
        String getName() { return name; }
    }

    static class Reservation {
        private final Unit unit;
        private final User user;
        private final DateRange dateRange;

        Reservation(Unit unit, User user, DateRange dateRange) {
            this.unit = unit;
            this.user = user;
            this.dateRange = dateRange;
        }

        DateRange getDateRange() { return dateRange; }
        Unit getUnit() { return unit; }
        User getUser() { return user; }
    }

    static class Unit {
        private final String id;
        private final String type;
        private final List<Reservation> reservations = new ArrayList<>();

        Unit(String id, String type) {
            this.id = id;
            this.type = type;
        }

        String getId() { return id; }
        String getType() { return type; }
        List<Reservation> getReservations() { return reservations; }
        void addReservation(Reservation reservation) { reservations.add(reservation); }
    }

    static class UnitUnavailableException extends RuntimeException {
        UnitUnavailableException(Unit unit, DateRange range) {
            super("Unit " + unit.getId() + " unavailable for " + range.start() + " to " + range.end());
        }
    }

    static class Inventory {
        private final List<Unit> units = new ArrayList<>();

        void addUnit(Unit unit) { units.add(unit); }

        List<Unit> findAvailable(String type, DateRange range) {
            List<Unit> result = new ArrayList<>();
            for (Unit unit : units) {
                if (unit.getType().equals(type) && isAvailable(unit, range)) {
                    result.add(unit);
                }
            }
            return result;
        }

        boolean isAvailable(Unit unit, DateRange requested) {
            return unit.getReservations().stream().noneMatch(r -> r.getDateRange().overlaps(requested));
        }
    }

    static class BookingService {
        private final Inventory inventory;

        BookingService(Inventory inventory) { this.inventory = inventory; }

        synchronized Reservation reserve(Unit unit, User user, DateRange range) {
            if (!inventory.isAvailable(unit, range)) {
                throw new UnitUnavailableException(unit, range);
            }
            Reservation reservation = new Reservation(unit, user, range);
            unit.addReservation(reservation);
            return reservation;
        }
    }

    public static void main(String[] args) {
        Inventory inventory = new Inventory();
        Unit room101 = new Unit("101", "Deluxe");
        inventory.addUnit(room101);
        inventory.addUnit(new Unit("102", "Deluxe"));

        BookingService bookingService = new BookingService(inventory);
        User alice = new User("Alice");
        User bob = new User("Bob");

        DateRange aliceStay = new DateRange(LocalDate.of(2026, 1, 10), LocalDate.of(2026, 1, 15));
        bookingService.reserve(room101, alice, aliceStay);
        System.out.println("Alice booked room 101 for Jan 10-15");

        // Back-to-back booking, same room, no overlap - should succeed.
        DateRange bobStay = new DateRange(LocalDate.of(2026, 1, 15), LocalDate.of(2026, 1, 20));
        bookingService.reserve(room101, bob, bobStay);
        System.out.println("Bob booked room 101 for Jan 15-20 (back-to-back, allowed)");

        // Overlapping booking on the same room - should fail.
        DateRange conflicting = new DateRange(LocalDate.of(2026, 1, 12), LocalDate.of(2026, 1, 13));
        try {
            bookingService.reserve(room101, new User("Carol"), conflicting);
        } catch (UnitUnavailableException e) {
            System.out.println("Rejected: " + e.getMessage());
        }

        List<Unit> availableDeluxe = inventory.findAvailable("Deluxe",
                new DateRange(LocalDate.of(2026, 1, 12), LocalDate.of(2026, 1, 13)));
        System.out.println("Available Deluxe units for Jan 12-13: "
                + availableDeluxe.stream().map(Unit::getId).toList());
    }
}
