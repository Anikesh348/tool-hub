/**
 * Standalone demo of the Strategy pattern: a RoutePlanner whose travel
 * algorithm is swapped at runtime instead of chosen via if/else.
 *   javac StrategyPattern.java && java StrategyPattern
 */
public class StrategyPattern {

    interface RouteStrategy {
        String buildRoute(String from, String to);
    }

    static class CarStrategy implements RouteStrategy {
        public String buildRoute(String from, String to) { return "Drive from " + from + " to " + to; }
    }

    static class BikeStrategy implements RouteStrategy {
        public String buildRoute(String from, String to) { return "Bike route from " + from + " to " + to; }
    }

    static class WalkStrategy implements RouteStrategy {
        public String buildRoute(String from, String to) { return "Walking directions from " + from + " to " + to; }
    }

    static class RoutePlanner {
        private RouteStrategy strategy;

        void setStrategy(RouteStrategy strategy) { this.strategy = strategy; }

        String plan(String from, String to) {
            if (strategy == null) throw new IllegalStateException("No strategy set");
            return strategy.buildRoute(from, to);
        }
    }

    public static void main(String[] args) {
        RoutePlanner planner = new RoutePlanner();

        planner.setStrategy(new BikeStrategy());
        System.out.println(planner.plan("Home", "Office"));

        planner.setStrategy(new CarStrategy());
        System.out.println(planner.plan("Home", "Office"));

        planner.setStrategy(new WalkStrategy());
        System.out.println(planner.plan("Home", "Office"));
    }
}
