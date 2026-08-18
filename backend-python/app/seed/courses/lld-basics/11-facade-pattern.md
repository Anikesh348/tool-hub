> **Learning goal**
> Give callers one simple entry point in front of a complex subsystem with many interacting classes, without hiding the subsystem's full power from callers who genuinely need it.

## 11.1 The problem: a subsystem with too many moving parts

A "place an order" flow in a real system might touch inventory, pricing, tax calculation, payment, and shipping — each its own class with its own interface:

```java
InventoryService inventory = new InventoryService();
PricingEngine pricing = new PricingEngine();
TaxCalculator tax = new TaxCalculator();
PaymentProcessor payment = new PaymentProcessor();
ShippingService shipping = new ShippingService();

if (inventory.reserve(itemId, quantity)) {
    double subtotal = pricing.calculate(itemId, quantity);
    double total = subtotal + tax.calculate(subtotal, region);
    if (payment.charge(customerId, total)) {
        shipping.schedule(customerId, itemId, quantity);
    } else {
        inventory.release(itemId, quantity);
    }
}
```

Every caller that wants to "just place an order" has to know this exact sequence, including the error-handling order (release inventory if payment fails). Duplicate this logic in a web controller, a CLI command, and a batch job, and a bug fix now needs three edits.

## 11.2 The Facade solution

Introduce one class that knows the correct sequence and exposes a single simple method; the subsystem classes underneath are unchanged.

```java
class OrderFacade {
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

// client code — one call, no subsystem knowledge required
new OrderFacade().placeOrder("cust-1", "item-42", 2, "US");
```

The subsystem classes (`InventoryService`, `PricingEngine`, etc.) still exist and can still be used directly by code that needs fine-grained control — Facade adds a simpler path, it doesn't remove the detailed one.

## 11.3 Facade doesn't mean "hide everything"

A common misreading of Facade is "make the subsystem private so nobody can bypass the facade." That's not the pattern's job — a good Facade coexists with direct subsystem access for callers with unusual needs (e.g. an admin tool that needs to reserve inventory without charging payment yet). Facade's contribution is purely convenience for the common case, not access control.

## 11.4 Facade vs. Adapter (lesson 9) vs. Decorator (lesson 10)

All three wrap something, which is why they're commonly confused:

| Pattern | Wraps | Purpose |
| --- | --- | --- |
| Adapter | One incompatible interface | Make it match an interface you already expect |
| Decorator | One object, same interface | Add behavior, stackable |
| Facade | Several classes/subsystems | Simplify a complex API surface into one entry point |

## 11.5 Where you'll use this

Any LLD problem description that says "the checkout flow involves inventory, payment, and shipping" is signaling a Facade. In the Movie Ticket Booking problem (LLD Practice course), a `BookingFacade` coordinating seat locking, pricing, and payment is exactly this pattern.

> **Review question**
> `OrderFacade.placeOrder` currently swallows every failure into a single `boolean` return. What's the tradeoff of that simplicity, and how would you change the design if callers needed to know *which* step failed?
