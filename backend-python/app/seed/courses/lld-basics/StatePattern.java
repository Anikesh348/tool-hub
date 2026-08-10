/**
 * Standalone demo of the State pattern: an Order whose legal transitions
 * are decided by whichever state object it currently holds.
 *   javac StatePattern.java && java StatePattern
 */
public class StatePattern {

    interface OrderState {
        OrderState ship();
        OrderState deliver();
        OrderState cancel();
        String name();
    }

    static class PlacedState implements OrderState {
        public OrderState ship() { System.out.println("Shipping order"); return new ShippedState(); }
        public OrderState deliver() { throw new IllegalStateException("Can only deliver a shipped order"); }
        public OrderState cancel() { System.out.println("Cancelling order"); return new CancelledState(); }
        public String name() { return "PLACED"; }
    }

    static class ShippedState implements OrderState {
        public OrderState ship() { throw new IllegalStateException("Already shipped"); }
        public OrderState deliver() { System.out.println("Delivering order"); return new DeliveredState(); }
        public OrderState cancel() { System.out.println("Cancelling order"); return new CancelledState(); }
        public String name() { return "SHIPPED"; }
    }

    static class DeliveredState implements OrderState {
        public OrderState ship() { throw new IllegalStateException("Already delivered"); }
        public OrderState deliver() { throw new IllegalStateException("Already delivered"); }
        public OrderState cancel() { throw new IllegalStateException("Cannot cancel a delivered order"); }
        public String name() { return "DELIVERED"; }
    }

    static class CancelledState implements OrderState {
        public OrderState ship() { throw new IllegalStateException("Order was cancelled"); }
        public OrderState deliver() { throw new IllegalStateException("Order was cancelled"); }
        public OrderState cancel() { throw new IllegalStateException("Already cancelled"); }
        public String name() { return "CANCELLED"; }
    }

    static class Order {
        private OrderState state = new PlacedState();

        void ship() { state = state.ship(); }
        void deliver() { state = state.deliver(); }
        void cancel() { state = state.cancel(); }
        String status() { return state.name(); }
    }

    public static void main(String[] args) {
        Order order = new Order();
        System.out.println("Status: " + order.status());
        order.ship();
        System.out.println("Status: " + order.status());
        order.deliver();
        System.out.println("Status: " + order.status());

        try {
            order.cancel(); // illegal: already delivered
        } catch (IllegalStateException e) {
            System.out.println("Rejected: " + e.getMessage());
        }
    }
}
