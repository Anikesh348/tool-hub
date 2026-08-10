> **Learning goal**
> Turn "make it extensible" and "make it maintainable" into five concrete, checkable rules — the same five an interviewer is silently grading your design against.

SOLID is five principles, each fixing a specific way object-oriented code rots over time. You don't need to name-drop them in an interview, but every good LLD answer follows them, and every classic anti-pattern violates one.

## 2.1 Single Responsibility Principle (SRP)

*A class should have only one reason to change.*

```java
// Violates SRP: persistence, formatting, and business rules are tangled together.
class Invoice {
    double calculateTotal() { /* ... */ return 0; }
    void saveToDatabase() { /* ... */ }
    String formatAsPdf() { /* ... */ return ""; }
}

// Fixed: each class owns exactly one concern.
class Invoice { double calculateTotal() { /* ... */ return 0; } }
class InvoiceRepository { void save(Invoice invoice) { /* ... */ } }
class InvoicePdfFormatter { String format(Invoice invoice) { /* ... */ return ""; } }
```

If "add a new database" and "change the tax rule" both mean editing the same class, that class has too many reasons to change.

## 2.2 Open/Closed Principle (OCP)

*Classes should be open for extension, but closed for modification.*

```java
// Violates OCP: adding a shape means editing this method.
double area(Object shape) {
    if (shape instanceof Circle c) return Math.PI * c.radius() * c.radius();
    if (shape instanceof Square s) return s.side() * s.side();
    throw new IllegalArgumentException("Unknown shape");
}

// Fixed: new shapes plug in without touching existing code.
interface Shape { double area(); }
class Circle implements Shape { double radius; public double area() { return Math.PI * radius * radius; } }
class Square implements Shape { double side; public double area() { return side * side; } }
```

Adding a `Triangle` now means writing one new class — nothing existing is at risk of breaking.

## 2.3 Liskov Substitution Principle (LSP)

*A subclass must be usable anywhere its superclass is expected, without breaking correctness.*

```java
// Classic LSP violation: Square "is-a" Rectangle mathematically, but not behaviorally.
class Rectangle {
    protected int width, height;
    void setWidth(int w) { width = w; }
    void setHeight(int h) { height = h; }
    int area() { return width * height; }
}
class Square extends Rectangle {
    @Override void setWidth(int w) { width = w; height = w; } // surprising side effect
    @Override void setHeight(int h) { width = h; height = h; }
}
```

Code that does `rect.setWidth(5); rect.setHeight(10); assert rect.area() == 50;` silently breaks if `rect` is actually a `Square`. When a subclass has to override a method to *narrow* or *change* its contract, that's an LSP smell — prefer composition or a shared interface both can honestly implement.

## 2.4 Interface Segregation Principle (ISP)

*Don't force a class to implement methods it doesn't need.*

```java
// Violates ISP: a Robot has no legs, but must implement walk().
interface Worker { void work(); void eat(); void walk(); }

// Fixed: split into focused interfaces, implement only what applies.
interface Workable { void work(); }
interface Eatable { void eat(); }
interface Walkable { void walk(); }
class Human implements Workable, Eatable, Walkable { /* all three */ }
class Robot implements Workable { /* only work() */ }
```

A fat interface forces every implementer to either support things that don't make sense for them, or throw `UnsupportedOperationException` — both are red flags.

## 2.5 Dependency Inversion Principle (DIP)

*Depend on abstractions, not concrete implementations — and let concrete classes be plugged in from the outside.*

```java
// Violates DIP: OrderService is hard-wired to one specific processor.
class OrderService {
    private final CreditCardProcessor processor = new CreditCardProcessor();
}

// Fixed: OrderService depends only on the interface; the concrete type is injected.
class OrderService {
    private final PaymentProcessor processor;
    OrderService(PaymentProcessor processor) { this.processor = processor; }
}
```

This is the same idea as abstraction from lesson 1, applied specifically to *how objects get their collaborators* — via constructor/setter injection instead of `new`-ing them internally. It's what makes a class testable (swap in a fake) and reusable (swap in a different real implementation).

## 2.6 How the rest of this course uses SOLID

Nearly every design pattern in lessons 5-18 is a named, battle-tested way to satisfy one or more SOLID principles: Strategy and Observer are OCP/DIP in practice; Factory patterns keep object-creation logic from violating SRP; Decorator extends behavior without modifying existing classes (OCP). When you're stuck on "how should I structure this," ask which SOLID rule is under pressure — the right pattern usually falls out of the answer.

> **Review question**
> A `NotificationService.send(User user, String message)` method has a growing `if/else` chain: `if (user.prefersEmail()) ... else if (user.prefersSms()) ... else if (user.prefersPush()) ...`. Which SOLID principle(s) does this violate, and how would you redesign it?
