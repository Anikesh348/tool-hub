import java.util.List;
import java.util.TreeSet;

/**
 * Complete reference implementation for the Elevator System LLD problem:
 * multiple elevators, controller-side selection strategy, and per-elevator
 * SCAN-style stop ordering.
 *   javac ElevatorSystem.java && java ElevatorSystem
 */
public class ElevatorSystem {

    enum Direction { UP, DOWN, IDLE }

    interface ElevatorState {
        String name();
    }

    static class IdleState implements ElevatorState { public String name() { return "IDLE"; } }
    static class MovingState implements ElevatorState { public String name() { return "MOVING"; } }
    static class DoorsOpenState implements ElevatorState { public String name() { return "DOORS_OPEN"; } }

    static class Elevator {
        private final int id;
        private int currentFloor = 0;
        private Direction direction = Direction.IDLE;
        private ElevatorState state = new IdleState();
        private final TreeSet<Integer> upStops = new TreeSet<>();
        private final TreeSet<Integer> downStops = new TreeSet<>();

        Elevator(int id) { this.id = id; }

        int getId() { return id; }
        int getCurrentFloor() { return currentFloor; }
        Direction getDirection() { return direction; }

        void addStop(int floor) {
            if (floor > currentFloor) upStops.add(floor);
            else if (floor < currentFloor) downStops.add(floor);
            if (direction == Direction.IDLE) {
                direction = floor >= currentFloor ? Direction.UP : Direction.DOWN;
            }
        }

        /** Advances one simulated step using SCAN: keep going in the current
         *  direction, serving stops along the way, before reversing. */
        void step() {
            state = new MovingState();
            if (direction == Direction.UP) {
                if (!upStops.isEmpty()) {
                    currentFloor = upStops.pollFirst();
                    state = new DoorsOpenState();
                } else if (!downStops.isEmpty()) {
                    direction = Direction.DOWN; // reverse: no more up-stops, but down-stops remain
                } else {
                    direction = Direction.IDLE;
                    state = new IdleState();
                }
            } else if (direction == Direction.DOWN) {
                if (!downStops.isEmpty()) {
                    currentFloor = downStops.pollLast();
                    state = new DoorsOpenState();
                } else if (!upStops.isEmpty()) {
                    direction = Direction.UP;
                } else {
                    direction = Direction.IDLE;
                    state = new IdleState();
                }
            }
        }

        // Higher score = better candidate for a new external request.
        int scoreFor(int requestFloor, Direction requestDirection) {
            if (direction == Direction.IDLE) return 100 - Math.abs(currentFloor - requestFloor);
            boolean movingToward = (direction == Direction.UP && requestFloor >= currentFloor)
                    || (direction == Direction.DOWN && requestFloor <= currentFloor);
            boolean sameDirection = direction == requestDirection;
            if (movingToward && sameDirection) return 80 - Math.abs(currentFloor - requestFloor);
            return 10 - Math.abs(currentFloor - requestFloor); // moving away or opposite direction
        }
    }

    static class ElevatorController {
        private final List<Elevator> elevators;

        ElevatorController(List<Elevator> elevators) { this.elevators = elevators; }

        Elevator requestElevator(int floor, Direction direction) {
            Elevator best = elevators.get(0);
            int bestScore = Integer.MIN_VALUE;
            for (Elevator e : elevators) {
                int score = e.scoreFor(floor, direction);
                if (score > bestScore) {
                    bestScore = score;
                    best = e;
                }
            }
            best.addStop(floor);
            return best;
        }
    }

    public static void main(String[] args) {
        Elevator e1 = new Elevator(1);
        Elevator e2 = new Elevator(2);
        ElevatorController controller = new ElevatorController(List.of(e1, e2));

        // External request: someone on floor 5 wants to go up.
        Elevator assigned = controller.requestElevator(5, Direction.UP);
        System.out.println("Elevator " + assigned.getId() + " assigned to floor 5 (up)");

        // Internal request: rider inside elevator 1 presses floor 8.
        e1.addStop(8);

        for (int i = 0; i < 6; i++) {
            e1.step();
            System.out.println("Elevator 1 now at floor " + e1.getCurrentFloor() + ", direction " + e1.getDirection());
        }
    }
}
