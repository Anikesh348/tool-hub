import java.util.List;

/**
 * Standalone demo of the four OOP pillars: encapsulation, abstraction,
 * inheritance, and polymorphism. Compile and run directly:
 *   javac OopFundamentals.java && java OopFundamentals
 */
public class OopFundamentals {

    // --- Encapsulation ---
    static class BankAccount {
        private double balance;

        void deposit(double amount) {
            if (amount <= 0) throw new IllegalArgumentException("Deposit must be positive");
            balance += amount;
        }

        void withdraw(double amount) {
            if (amount > balance) throw new IllegalStateException("Insufficient funds");
            balance -= amount;
        }

        double getBalance() {
            return balance;
        }
    }

    // --- Abstraction ---
    interface PaymentProcessor {
        boolean charge(String customerId, double amount);
    }

    static class CreditCardProcessor implements PaymentProcessor {
        @Override
        public boolean charge(String customerId, double amount) {
            System.out.println("Charged $" + amount + " to credit card for " + customerId);
            return true;
        }
    }

    static class UpiProcessor implements PaymentProcessor {
        @Override
        public boolean charge(String customerId, double amount) {
            System.out.println("Charged $" + amount + " via UPI for " + customerId);
            return true;
        }
    }

    // --- Inheritance + Polymorphism ---
    abstract static class Vehicle {
        protected int wheelCount;
        abstract double calculateToll();
    }

    static class Car extends Vehicle {
        Car() { this.wheelCount = 4; }
        @Override double calculateToll() { return 50.0; }
    }

    static class Truck extends Vehicle {
        Truck() { this.wheelCount = 6; }
        @Override double calculateToll() { return 120.0; }
    }

    public static void main(String[] args) {
        // Encapsulation: BankAccount protects its own invariant.
        BankAccount account = new BankAccount();
        account.deposit(100);
        account.withdraw(40);
        System.out.println("Balance: " + account.getBalance());

        // Abstraction: caller only knows about the PaymentProcessor contract.
        PaymentProcessor processor = new CreditCardProcessor();
        processor.charge("cust-1", 25.0);
        processor = new UpiProcessor();
        processor.charge("cust-2", 15.0);

        // Inheritance + polymorphism: each Vehicle resolves calculateToll() differently.
        List<Vehicle> vehicles = List.of(new Car(), new Truck());
        double totalToll = 0;
        for (Vehicle v : vehicles) {
            totalToll += v.calculateToll();
        }
        System.out.println("Total toll: " + totalToll);
    }
}
