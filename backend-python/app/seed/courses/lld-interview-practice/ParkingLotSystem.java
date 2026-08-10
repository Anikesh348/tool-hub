import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Complete reference implementation for the Parking Lot LLD problem:
 * multi-level lot, size-matched spot allocation, thread-safe occupancy,
 * and a pluggable fee-calculation strategy.
 *   javac ParkingLotSystem.java && java ParkingLotSystem
 */
public class ParkingLotSystem {

    enum VehicleSize { MOTORCYCLE, COMPACT, LARGE }

    static class Vehicle {
        private final String licensePlate;
        private final VehicleSize size;

        Vehicle(String licensePlate, VehicleSize size) {
            this.licensePlate = licensePlate;
            this.size = size;
        }

        VehicleSize getSize() { return size; }
        String getLicensePlate() { return licensePlate; }
    }

    static class ParkingSpot {
        private final int id;
        private final VehicleSize size;
        private final AtomicBoolean occupied = new AtomicBoolean(false);
        private Vehicle vehicle;

        ParkingSpot(int id, VehicleSize size) {
            this.id = id;
            this.size = size;
        }

        boolean fits(Vehicle v) { return size.ordinal() >= v.getSize().ordinal(); }

        // Atomic check-and-set: two threads racing for the same spot can't both succeed.
        synchronized boolean tryOccupy(Vehicle v) {
            if (occupied.get()) return false;
            occupied.set(true);
            vehicle = v;
            return true;
        }

        synchronized void release() {
            occupied.set(false);
            vehicle = null;
        }

        int getId() { return id; }
        VehicleSize getSize() { return size; }
    }

    static class Level {
        private final int floor;
        private final List<ParkingSpot> spots;

        Level(int floor, List<ParkingSpot> spots) {
            this.floor = floor;
            this.spots = spots;
        }

        Optional<ParkingSpot> findAndOccupySpot(Vehicle vehicle) {
            return spots.stream()
                    .filter(s -> s.fits(vehicle))
                    .sorted((a, b) -> a.getSize().compareTo(b.getSize())) // smallest fitting spot first
                    .filter(s -> s.tryOccupy(vehicle))
                    .findFirst();
        }

        int getFloor() { return floor; }
    }

    static class Ticket {
        private final String id;
        private final Vehicle vehicle;
        private final ParkingSpot spot;
        private final long entryTimeMillis;

        Ticket(String id, Vehicle vehicle, ParkingSpot spot, long entryTimeMillis) {
            this.id = id;
            this.vehicle = vehicle;
            this.spot = spot;
            this.entryTimeMillis = entryTimeMillis;
        }

        ParkingSpot getSpot() { return spot; }
        long getEntryTimeMillis() { return entryTimeMillis; }
        String getId() { return id; }
    }

    interface FeeCalculator {
        double calculate(Ticket ticket, long exitTimeMillis);
    }

    static class HourlyFeeCalculator implements FeeCalculator {
        private final double ratePerHour;
        HourlyFeeCalculator(double ratePerHour) { this.ratePerHour = ratePerHour; }

        public double calculate(Ticket ticket, long exitTimeMillis) {
            long durationMillis = exitTimeMillis - ticket.getEntryTimeMillis();
            double hours = Math.max(1, Math.ceil(durationMillis / 3600000.0)); // round up, minimum 1 hour
            return hours * ratePerHour;
        }
    }

    static class NoAvailableSpotException extends RuntimeException {
        NoAvailableSpotException(String message) { super(message); }
    }

    // Singleton: there is exactly one physical parking lot.
    static class ParkingLot {
        private static final ParkingLot INSTANCE = new ParkingLot();
        private final List<Level> levels = new ArrayList<>();
        private final java.util.Map<String, Ticket> activeTickets = new java.util.concurrent.ConcurrentHashMap<>();
        private FeeCalculator feeCalculator = new HourlyFeeCalculator(2.0);
        private int nextTicketId = 1;

        private ParkingLot() {}

        static ParkingLot getInstance() { return INSTANCE; }

        void addLevel(Level level) { levels.add(level); }
        void setFeeCalculator(FeeCalculator calculator) { this.feeCalculator = calculator; }

        Ticket parkVehicle(Vehicle vehicle) {
            for (Level level : levels) {
                Optional<ParkingSpot> spot = level.findAndOccupySpot(vehicle);
                if (spot.isPresent()) {
                    Ticket ticket = new Ticket("T-" + nextTicketId++, vehicle, spot.get(), System.currentTimeMillis());
                    activeTickets.put(ticket.getId(), ticket);
                    return ticket;
                }
            }
            throw new NoAvailableSpotException("No spot available for " + vehicle.getLicensePlate());
        }

        double unparkVehicle(String ticketId) {
            Ticket ticket = activeTickets.remove(ticketId);
            if (ticket == null) throw new IllegalArgumentException("Unknown ticket: " + ticketId);
            double fee = feeCalculator.calculate(ticket, System.currentTimeMillis());
            ticket.getSpot().release();
            return fee;
        }
    }

    public static void main(String[] args) {
        ParkingLot lot = ParkingLot.getInstance();
        lot.addLevel(new Level(1, List.of(
                new ParkingSpot(1, VehicleSize.MOTORCYCLE),
                new ParkingSpot(2, VehicleSize.COMPACT),
                new ParkingSpot(3, VehicleSize.LARGE)
        )));

        Vehicle car = new Vehicle("ABC-123", VehicleSize.COMPACT);
        Ticket ticket = lot.parkVehicle(car);
        System.out.println("Parked " + car.getLicensePlate() + " with ticket " + ticket.getId()
                + " in spot " + ticket.getSpot().getId());

        double fee = lot.unparkVehicle(ticket.getId());
        System.out.println("Fee charged: $" + fee);

        Vehicle bigTruck = new Vehicle("TRUCK-1", VehicleSize.LARGE);
        Vehicle motorcycle = new Vehicle("BIKE-1", VehicleSize.MOTORCYCLE);
        lot.parkVehicle(bigTruck);
        lot.parkVehicle(motorcycle);
        try {
            lot.parkVehicle(new Vehicle("ANOTHER-COMPACT", VehicleSize.COMPACT)); // no spot left
        } catch (NoAvailableSpotException e) {
            System.out.println("Rejected: " + e.getMessage());
        }
    }
}
