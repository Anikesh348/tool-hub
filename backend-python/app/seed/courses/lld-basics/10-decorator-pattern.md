> **Learning goal**
> Add responsibilities to an individual object at runtime by wrapping it, instead of creating an exploding number of subclasses for every combination of features.

## 10.1 The problem: subclass combinatorial explosion

A coffee shop menu with a base `Coffee` plus optional add-ons (milk, sugar, whipped cream) looks tempting to model with inheritance:

```java
class Coffee { double cost() { return 2.0; } }
class CoffeeWithMilk extends Coffee { double cost() { return super.cost() + 0.5; } }
class CoffeeWithMilkAndSugar extends CoffeeWithMilk { double cost() { return super.cost() + 0.25; } }
class CoffeeWithMilkAndSugarAndCream extends CoffeeWithMilkAndSugar { /* ... */ }
```

Every new combination of add-ons needs its own subclass. Three optional add-ons already means up to 2³ = 8 possible subclasses; a real menu with six add-ons would need dozens. This is OCP (lesson 2) breaking down under combinatorics, not just a single change.

## 10.2 The Decorator solution

Wrap the base object in decorator objects that each add one responsibility, and implement the *same* interface as what they wrap — so decorators can be stacked in any combination, and the result is still usable wherever the base type was expected.

```java
interface Coffee {
    double cost();
    String description();
}

class SimpleCoffee implements Coffee {
    public double cost() { return 2.0; }
    public String description() { return "Coffee"; }
}

abstract class CoffeeDecorator implements Coffee {
    protected final Coffee wrapped;
    CoffeeDecorator(Coffee wrapped) { this.wrapped = wrapped; }
}

class MilkDecorator extends CoffeeDecorator {
    MilkDecorator(Coffee wrapped) { super(wrapped); }
    public double cost() { return wrapped.cost() + 0.5; }
    public String description() { return wrapped.description() + " + Milk"; }
}

class SugarDecorator extends CoffeeDecorator {
    SugarDecorator(Coffee wrapped) { super(wrapped); }
    public double cost() { return wrapped.cost() + 0.25; }
    public String description() { return wrapped.description() + " + Sugar"; }
}
```

```java
Coffee order = new SugarDecorator(new MilkDecorator(new SimpleCoffee()));
System.out.println(order.description() + " = $" + order.cost());
// "Coffee + Milk + Sugar = $2.75"
```

Any subset of add-ons, in any order, is now just a matter of chaining constructors — zero new classes needed per combination. Each decorator only knows about *one* responsibility and delegates everything else to what it wraps.

## 10.3 Decorator vs. inheritance — when to reach for which

Inheritance is fine when there's a small, fixed, non-combinatorial set of variants (lesson 1's `Car`/`Truck`). Decorator is the right call specifically when features can be **combined independently at runtime** — the object's exact configuration might not even be known until the program is running (e.g. a user picking toppings interactively).

## 10.4 Decorator vs. Proxy (preview of lesson 13)

Structurally these look almost identical — both wrap an object behind the same interface. They differ in intent: Decorator's job is to *add behavior*; Proxy's job (lesson 13) is to *control access* to the wrapped object (lazy-loading, permission checks, remote calls) without adding new functionality. It's common for a Proxy implementation to literally reuse the Decorator structure, just with a different purpose in mind.

## 10.5 Where you'll use this

Adding gift-wrapping, express-shipping, and insurance as independently combinable add-ons to an `Order`, or layering caching/logging/retry behavior around a `PaymentProcessor` implementation, are both classic Decorator use cases.

> **Review question**
> A `WhippedCreamDecorator` needs to add $0.75 to cost, and it should only be allowed on top of a `MilkDecorator` (whipped cream requires milk in this shop's rules). Where would you enforce that constraint, and does it weaken any of Decorator's usual benefits?
