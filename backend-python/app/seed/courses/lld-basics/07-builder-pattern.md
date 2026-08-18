> **Learning goal**
> Replace constructors with 6+ parameters (and the exponential "telescoping constructor" overloads they spawn) with a fluent, readable, and safe way to build complex objects step by step.

## 7.1 The problem: telescoping constructors

A `Pizza` with many optional toppings quickly explodes into an unreadable set of overloaded constructors:

```java
class Pizza {
    Pizza(String size) { /* ... */ }
    Pizza(String size, boolean cheese) { /* ... */ }
    Pizza(String size, boolean cheese, boolean pepperoni) { /* ... */ }
    Pizza(String size, boolean cheese, boolean pepperoni, boolean mushrooms) { /* ... */ }
    // ...and it keeps growing
}
```

Even if you collapse this to one constructor with every parameter, callers end up writing `new Pizza("large", true, false, true, false, true)` — unreadable, and error-prone (which boolean was which, again?).

## 7.2 The Builder solution

A Builder is a separate object that accumulates configuration through chained method calls, then produces the final immutable object in one `build()` call.

```java
class Pizza {
    private final String size;
    private final boolean cheese;
    private final boolean pepperoni;
    private final boolean mushrooms;

    private Pizza(Builder builder) {
        this.size = builder.size;
        this.cheese = builder.cheese;
        this.pepperoni = builder.pepperoni;
        this.mushrooms = builder.mushrooms;
    }

    static class Builder {
        private final String size; // required
        private boolean cheese = false;
        private boolean pepperoni = false;
        private boolean mushrooms = false;

        Builder(String size) { this.size = size; } // required fields go in the constructor

        Builder cheese(boolean value) { this.cheese = value; return this; }
        Builder pepperoni(boolean value) { this.pepperoni = value; return this; }
        Builder mushrooms(boolean value) { this.mushrooms = value; return this; }

        Pizza build() { return new Pizza(this); }
    }
}

// client code
Pizza pizza = new Pizza.Builder("large")
        .cheese(true)
        .pepperoni(true)
        .build();
```

Every field on `Pizza` itself is `final` — once built, it's immutable, which is exactly the guarantee you want for a value object being passed around a codebase. The required field (`size`) lives in the `Builder`'s constructor, so it's impossible to build a `Pizza` without specifying it, while every optional field has a sensible default.

## 7.3 Enforcing validity — the part naive Builders skip

A Builder can also validate combinations of fields before construction, something a plain constructor with all-public setters can't do as cleanly:

```java
Pizza build() {
    if (!cheese && !pepperoni && !mushrooms) {
        throw new IllegalStateException("Pizza needs at least one topping");
    }
    return new Pizza(this);
}
```

This check runs exactly once, at the single point where the object transitions from "being configured" to "fully built" — there's no window where an invalid half-built `Pizza` could leak out and be used.

## 7.4 Builder vs. just using a mutable object with setters

You could skip the Builder and just expose setters on `Pizza` directly — but then `Pizza` is mutable forever (any code with a reference can change it after construction), and there's no single moment to validate the full combination of fields. Builder buys you: immutability of the final object, readable call sites, and one clear validation point — at the cost of one extra class.

## 7.5 Where you'll use this

Any LLD problem with an object that has several optional configuration knobs is a Builder candidate — constructing a `SearchQuery`, an `HttpRequest`, or (in the LLD Practice course) configuring a complex `Order` with optional discounts, gift-wrapping, and delivery instructions.

> **Review question**
> Why does the `Builder` in this lesson take required fields (`size`) as a constructor parameter instead of another chained method like `.size("large")`? What could go wrong if `size` were optional-looking like the toppings?
