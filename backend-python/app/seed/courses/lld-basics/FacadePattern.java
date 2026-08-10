/**
 * Standalone demo of the Facade pattern: OrderFacade sequences five
 * subsystem classes behind one simple placeOrder() call.
 *   javac FacadePattern.java && java FacadePattern
 */
public class FacadePattern {

    static class InventoryService {
        boolean reserve(String itemId, int quantity) {
            System.out.println("Reserved " + quantity + " of " + itemId);
            return true;
        }
        void release(String itemId, int quantity) {
            System.out.println("Released " + quantity + " of " + itemId);
        }
    }

    static class PricingEngine {
        double calculate(String itemId, int quantity) {
            return quantity * 19.99;
        }
    }

    static class TaxCalculator {
        double calculate(double subtotal, String region) {
            return "US".equals(region) ? subtotal * 0.08 : subtotal * 0.05;
        }
    }

    static class PaymentProcessor {
        boolean charge(String customerId, double amount) {
            System.out.println("Charged " + customerId + " $" + String.format("%.2f", amount));
            return true;
        }
    }

    static class ShippingService {
        void schedule(String customerId, String itemId, int quantity) {
            System.out.println("Scheduled shipment of " + quantity + " " + itemId + " to " + customerId);
        }
    }

    static class OrderFacade {
        private final InventoryService inventory = new InventoryService();
        private final PricingEngine pricing = new PricingEngine();
        private final TaxCalculator tax = new TaxCalculator();
        private final PaymentProcessor payment = new PaymentProcessor();
        private final ShippingService shipping = new ShippingService();

        boolean placeOrder(String customerId, String itemId, int quantity, String region) {
            if (!inventory.reserve(itemId, quantity)) return false;
            double subtotal = pricing.calculate(itemId, quantity);
            double total = subtotal + tax.calculate(subtotal, region);
            if (!payment.charge(customerId, total)) {
                inventory.release(itemId, quantity);
                return false;
            }
            shipping.schedule(customerId, itemId, quantity);
            return true;
        }
    }

    public static void main(String[] args) {
        OrderFacade facade = new OrderFacade();
        boolean success = facade.placeOrder("cust-1", "item-42", 2, "US");
        System.out.println("Order placed: " + success);
    }
}
