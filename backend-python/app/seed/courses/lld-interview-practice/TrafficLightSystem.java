import java.util.List;

/**
 * Complete reference implementation for the Traffic Light System LLD
 * problem: State-driven light cycles and a simulated tick-based clock.
 *   javac TrafficLightSystem.java && java TrafficLightSystem
 */
public class TrafficLightSystem {

    interface LightState {
        long durationMillis();
        LightState next();
        String colorName();
    }

    static class RedState implements LightState {
        public long durationMillis() { return 5000; }
        public LightState next() { return new GreenState(); }
        public String colorName() { return "RED"; }
    }

    static class GreenState implements LightState {
        public long durationMillis() { return 5000; }
        public LightState next() { return new YellowState(); }
        public String colorName() { return "GREEN"; }
    }

    static class YellowState implements LightState {
        public long durationMillis() { return 2000; }
        public LightState next() { return new RedState(); }
        public String colorName() { return "YELLOW"; }
    }

    static class TrafficLight {
        private final String direction;
        private LightState state;
        private long elapsedInState = 0;

        TrafficLight(String direction, LightState initial) {
            this.direction = direction;
            this.state = initial;
        }

        void tick(long deltaMillis) {
            elapsedInState += deltaMillis;
            if (elapsedInState >= state.durationMillis()) {
                elapsedInState = 0;
                state = state.next();
                System.out.println(direction + " -> " + state.colorName());
            }
        }

        String getDirection() { return direction; }
        String getColor() { return state.colorName(); }
    }

    static class Intersection {
        private final List<TrafficLight> lights;

        Intersection(List<TrafficLight> lights) { this.lights = lights; }

        void tick(long deltaMillis) {
            for (TrafficLight light : lights) {
                light.tick(deltaMillis);
            }
        }

        void printStatus() {
            for (TrafficLight light : lights) {
                System.out.println(light.getDirection() + ": " + light.getColor());
            }
        }
    }

    public static void main(String[] args) {
        // North-South starts Green while East-West starts Red - a simple two-phase intersection.
        TrafficLight northSouth = new TrafficLight("North-South", new GreenState());
        TrafficLight eastWest = new TrafficLight("East-West", new RedState());
        Intersection intersection = new Intersection(List.of(northSouth, eastWest));

        long[] steps = {1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000};
        for (long step : steps) {
            intersection.tick(step);
        }
        System.out.println("-- final status --");
        intersection.printStatus();
    }
}
