import java.util.ArrayList;
import java.util.List;

/**
 * Standalone demo of the Observer pattern: a StockPrice subject that
 * notifies subscribed observers without knowing their concrete types.
 *   javac ObserverPattern.java && java ObserverPattern
 */
public class ObserverPattern {

    interface PriceObserver {
        void onPriceChanged(double newPrice);
    }

    static class StockPrice {
        private double price;
        private final List<PriceObserver> observers = new ArrayList<>();

        void subscribe(PriceObserver observer) { observers.add(observer); }
        void unsubscribe(PriceObserver observer) { observers.remove(observer); }

        void setPrice(double price) {
            this.price = price;
            // Copy to avoid ConcurrentModificationException if an observer unsubscribes mid-notify.
            for (PriceObserver observer : new ArrayList<>(observers)) {
                observer.onPriceChanged(price);
            }
        }
    }

    static class UiDisplay implements PriceObserver {
        public void onPriceChanged(double newPrice) {
            System.out.println("UI updated: $" + newPrice);
        }
    }

    static class AuditLog implements PriceObserver {
        public void onPriceChanged(double newPrice) {
            System.out.println("Logged price change: $" + newPrice);
        }
    }

    static class AlertService implements PriceObserver {
        public void onPriceChanged(double newPrice) {
            if (newPrice > 1000) System.out.println("ALERT: price above threshold!");
        }
    }

    public static void main(String[] args) {
        StockPrice stock = new StockPrice();
        UiDisplay display = new UiDisplay();
        stock.subscribe(display);
        stock.subscribe(new AuditLog());
        stock.subscribe(new AlertService());

        stock.setPrice(950.0);
        stock.setPrice(1050.0); // triggers the AlertService this time

        stock.unsubscribe(display);
        System.out.println("-- UI unsubscribed --");
        stock.setPrice(1100.0); // UiDisplay no longer reacts
    }
}
