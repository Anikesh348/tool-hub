> **Learning goal**
> Ground every later lesson in this course in the four pillars of object-oriented programming — encapsulation, abstraction, inheritance, and polymorphism — and see each one expressed as actual Java, not just definitions.

Low-level design interviews are really asking one question over and over: *can you take a fuzzy real-world system and turn it into a small set of well-behaved classes?* Every pattern and every practice problem later in this track is built on the same four ideas.

## 1.1 Encapsulation — hiding state behind behavior

Encapsulation means an object's internal data is private, and the only way to read or change it is through the methods the object chooses to expose. The object protects its own invariants instead of trusting every caller to keep them.

```java
public class BankAccount {
    private double balance; // no outside class can touch this directly

    public void deposit(double amount) {
        if (amount <= 0) throw new IllegalArgumentException("Deposit must be positive");
        balance += amount;
    }

    public void withdraw(double amount) {
        if (amount > balance) throw new IllegalStateException("Insufficient funds");
        balance -= amount;
    }

    public double getBalance() {
        return balance;
    }
}
```

Nothing outside `BankAccount` can push `balance` negative or skip validation — the class is the single place that rule lives. In an interview, "how do you stop balance from going negative from anywhere in the codebase" is exactly the kind of question encapsulation answers.

## 1.2 Abstraction — exposing *what*, hiding *how*

Abstraction is about defining a contract (an interface or abstract class) so callers depend on *what* an object does, not *how* it does it.

```java
public interface PaymentProcessor {
    boolean charge(String customerId, double amount);
}

public class CreditCardProcessor implements PaymentProcessor {
    @Override
    public boolean charge(String customerId, double amount) {
        // talk to a card network, handle retries, etc.
        return true;
    }
}
```

Calling code only ever depends on `PaymentProcessor`. Swap `CreditCardProcessor` for `UpiProcessor` later and nothing that calls `charge(...)` has to change. This is the seed of the Strategy pattern (lesson 14) and of most "design a pluggable X" interview answers.

## 1.3 Inheritance — sharing structure through an "is-a" relationship

Inheritance lets a subclass reuse a superclass's fields and methods, and override behavior where it needs to differ.

```java
public abstract class Vehicle {
    protected int wheelCount;
    public abstract double calculateToll();
}

public class Car extends Vehicle {
    public Car() { this.wheelCount = 4; }
    @Override public double calculateToll() { return 50.0; }
}

public class Truck extends Vehicle {
    public Truck() { this.wheelCount = 6; }
    @Override public double calculateToll() { return 120.0; }
}
```

Inheritance is powerful but easy to overuse — a common LLD interview trap is modeling something as "is-a" when it's really "has-a" (see lesson 4 on composition). A `Car` genuinely *is a* `Vehicle`; a `Car` is not a good place to inherit from `Engine`.

## 1.4 Polymorphism — one interface, many behaviors

Polymorphism means code written against a supertype automatically does the right thing for whichever subtype is actually passed in at runtime.

```java
List<Vehicle> vehicles = List.of(new Car(), new Truck());
double totalToll = 0;
for (Vehicle v : vehicles) {
    totalToll += v.calculateToll(); // resolves to Car's or Truck's override at runtime
}
```

This is what makes an LLD design *extensible*: adding a `Motorcycle` later means writing one new class, not touching this loop. Every pattern in lessons 5-18 is, at its core, a structured way of applying polymorphism to solve one recurring kind of problem — creating objects flexibly, wrapping behavior, or letting an object's behavior change with its state.

## 1.5 How this maps to interviews

When an interviewer says "make this extensible" or "avoid a giant `if/else` chain," they are almost always asking you to reach for abstraction + polymorphism instead of inheritance-for-code-reuse. Keep that distinction in mind through the rest of this course — lesson 2 (SOLID) turns it into concrete rules, and lessons 5-18 turn it into named, reusable solutions.

> **Review question**
> A junior engineer implements `Truck extends Car` because "a truck is basically a bigger car and I don't want to repeat the toll calculation logic." What's wrong with this, and how would you fix it using the four pillars above?
