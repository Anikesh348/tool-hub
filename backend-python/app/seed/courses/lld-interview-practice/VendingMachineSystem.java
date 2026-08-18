import java.util.HashMap;
import java.util.Map;

/**
 * Complete reference implementation for the Vending Machine LLD problem:
 * State-pattern-driven purchase flow (Idle -> HasMoney -> Dispensing).
 *   javac VendingMachineSystem.java && java VendingMachineSystem
 */
public class VendingMachineSystem {

    static class Product {
        private final String code;
        private final String name;
        private final double price;
        private int quantity;

        Product(String code, String name, double price, int quantity) {
            this.code = code;
            this.name = name;
            this.price = price;
            this.quantity = quantity;
        }

        String getCode() { return code; }
        String getName() { return name; }
        double getPrice() { return price; }
        int getQuantity() { return quantity; }
        void decrement() { quantity--; }
    }

    static class Inventory {
        private final Map<String, Product> products = new HashMap<>();

        void addProduct(Product product) { products.put(product.getCode(), product); }
        Product get(String code) { return products.get(code); }
    }

    interface VendingMachineState {
        void insertCoin(VendingMachine machine, double amount);
        void selectProduct(VendingMachine machine, String code);
        void cancel(VendingMachine machine);
        String name();
    }

    static class IdleState implements VendingMachineState {
        public void insertCoin(VendingMachine machine, double amount) {
            machine.addBalance(amount);
            machine.setState(new HasMoneyState());
        }

        public void selectProduct(VendingMachine machine, String code) {
            System.out.println("Insert money before selecting a product.");
        }

        public void cancel(VendingMachine machine) {
            System.out.println("Nothing to cancel.");
        }

        public String name() { return "IDLE"; }
    }

    static class HasMoneyState implements VendingMachineState {
        public void insertCoin(VendingMachine machine, double amount) {
            machine.addBalance(amount);
        }

        public void selectProduct(VendingMachine machine, String code) {
            Product product = machine.getInventory().get(code);
            if (product == null || product.getQuantity() == 0) {
                System.out.println("Product unavailable: " + code);
                return;
            }
            if (machine.getBalance() < product.getPrice()) {
                System.out.println("Insufficient funds for " + product.getName()
                        + ". Need $" + product.getPrice() + ", have $" + machine.getBalance());
                return;
            }
            machine.setState(new DispensingState());
            double change = machine.getBalance() - product.getPrice();
            product.decrement();
            System.out.println("Dispensing " + product.getName() + ". Change returned: $" + change);
            machine.resetBalance();
            machine.setState(new IdleState());
        }

        public void cancel(VendingMachine machine) {
            System.out.println("Refunding $" + machine.getBalance());
            machine.resetBalance();
            machine.setState(new IdleState());
        }

        public String name() { return "HAS_MONEY"; }
    }

    static class DispensingState implements VendingMachineState {
        public void insertCoin(VendingMachine machine, double amount) {
            System.out.println("Please wait, dispensing in progress.");
        }

        public void selectProduct(VendingMachine machine, String code) {
            System.out.println("Please wait, dispensing in progress.");
        }

        public void cancel(VendingMachine machine) {
            System.out.println("Cannot cancel mid-dispense.");
        }

        public String name() { return "DISPENSING"; }
    }

    static class VendingMachine {
        private final Inventory inventory;
        private VendingMachineState state = new IdleState();
        private double balance = 0;

        VendingMachine(Inventory inventory) { this.inventory = inventory; }

        void insertCoin(double amount) { state.insertCoin(this, amount); }
        void selectProduct(String code) { state.selectProduct(this, code); }
        void cancel() { state.cancel(this); }

        void setState(VendingMachineState state) { this.state = state; }
        void addBalance(double amount) { balance += amount; }
        void resetBalance() { balance = 0; }
        double getBalance() { return balance; }
        Inventory getInventory() { return inventory; }
    }

    public static void main(String[] args) {
        Inventory inventory = new Inventory();
        inventory.addProduct(new Product("A1", "Soda", 0.75, 2));
        inventory.addProduct(new Product("A2", "Chips", 1.25, 0)); // out of stock

        VendingMachine machine = new VendingMachine(inventory);

        machine.selectProduct("A1"); // rejected: no money yet
        machine.insertCoin(1.00);
        machine.selectProduct("A1"); // dispenses, $0.25 change

        machine.insertCoin(0.50);
        machine.selectProduct("A2"); // rejected: out of stock
        machine.cancel(); // refunds $0.50
    }
}
