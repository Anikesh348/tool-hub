import java.util.List;

/**
 * Standalone demo of all five SOLID principles applied together:
 * an invoicing + shipping notification flow where each class has one
 * job, new shapes/notification channels plug in without edits, and
 * OrderService depends only on interfaces.
 *   javac SolidPrinciples.java && java SolidPrinciples
 */
public class SolidPrinciples {

    // --- SRP: each class has exactly one reason to change ---
    static class Invoice {
        private final double amount;
        Invoice(double amount) { this.amount = amount; }
        double getAmount() { return amount; }
    }

    static class InvoiceRepository {
        void save(Invoice invoice) {
            System.out.println("Saved invoice for $" + invoice.getAmount());
        }
    }

    // --- OCP: new Shape types plug in without touching existing code ---
    interface Shape { double area(); }

    static class Circle implements Shape {
        private final double radius;
        Circle(double radius) { this.radius = radius; }
        public double area() { return Math.PI * radius * radius; }
    }

    static class Square implements Shape {
        private final double side;
        Square(double side) { this.side = side; }
        public double area() { return side * side; }
    }

    // --- LSP: NotificationChannel implementations are all honestly substitutable ---
    interface NotificationChannel { void send(String message); }

    static class EmailChannel implements NotificationChannel {
        public void send(String message) { System.out.println("Email: " + message); }
    }

    static class SmsChannel implements NotificationChannel {
        public void send(String message) { System.out.println("SMS: " + message); }
    }

    // --- ISP: focused interfaces instead of one fat "Worker" interface ---
    interface Workable { void work(); }
    interface Eatable { void eat(); }

    static class Human implements Workable, Eatable {
        public void work() { System.out.println("Human working"); }
        public void eat() { System.out.println("Human eating"); }
    }

    static class Robot implements Workable {
        public void work() { System.out.println("Robot working"); }
    }

    // --- DIP: OrderService depends only on the NotificationChannel abstraction ---
    static class OrderService {
        private final InvoiceRepository repository;
        private final List<NotificationChannel> channels;

        OrderService(InvoiceRepository repository, List<NotificationChannel> channels) {
            this.repository = repository;
            this.channels = channels;
        }

        void placeOrder(double amount) {
            Invoice invoice = new Invoice(amount);
            repository.save(invoice);
            for (NotificationChannel channel : channels) {
                channel.send("Your order for $" + amount + " was placed.");
            }
        }
    }

    public static void main(String[] args) {
        List<Shape> shapes = List.of(new Circle(2), new Square(3));
        for (Shape shape : shapes) {
            System.out.println(shape.getClass().getSimpleName() + " area: " + shape.area());
        }

        List<Workable> workers = List.of(new Human(), new Robot());
        for (Workable worker : workers) {
            worker.work();
        }

        OrderService orderService = new OrderService(
                new InvoiceRepository(),
                List.of(new EmailChannel(), new SmsChannel())
        );
        orderService.placeOrder(49.99);
    }
}
