> **Learning goal**
> Close out the pattern catalog with two more behavioral patterns: fixing an algorithm's overall *shape* while letting subclasses vary specific steps (Template Method), and letting a request travel down a chain of handlers until one of them handles it (Chain of Responsibility).

## 18.1 Template Method — fix the skeleton, vary the steps

**The problem:** several data-import routines (CSV, JSON, XML) share the same overall shape — open, parse, validate, save — but each format parses differently. Duplicating the shared steps in every importer risks them drifting out of sync.

```java
abstract class DataImporter {
    // The template method: fixes the algorithm's shape, marked final so subclasses can't reorder it.
    final void importData(String path) {
        String raw = readFile(path);
        Object parsed = parse(raw);       // varies per format
        validate(parsed);                 // shared
        save(parsed);                     // shared
    }

    private String readFile(String path) { return "..."; }         // shared
    abstract Object parse(String raw);                              // subclass fills this in
    private void validate(Object data) { /* shared checks */ }       // shared
    private void save(Object data) { /* shared persistence */ }      // shared
}

class CsvImporter extends DataImporter {
    Object parse(String raw) { System.out.println("Parsing CSV"); return raw.split(","); }
}

class JsonImporter extends DataImporter {
    Object parse(String raw) { System.out.println("Parsing JSON"); return raw; /* real parsing omitted */ }
}
```

```java
new CsvImporter().importData("data.csv");   // shared open/validate/save, CSV-specific parse
new JsonImporter().importData("data.json"); // same shared steps, JSON-specific parse
```

The `final` on `importData` is intentional — it locks the *order* of steps so no subclass can accidentally skip validation. Only the specific step that legitimately differs (`parse`) is left open for subclasses to define. This is inheritance (lesson 1) used narrowly and safely: subclasses override one hook method, not the whole algorithm.

**Template Method vs. Strategy:** both let one step of a process vary — but Template Method uses inheritance (the varying step is an abstract method a subclass overrides) while Strategy uses composition (the varying step is a separate object passed in). Prefer Strategy when the variation needs to change at runtime or without subclassing; Template Method is simpler when the variation is fixed at compile time and the shared steps genuinely never change.

## 18.2 Chain of Responsibility — pass a request down a line of handlers

**The problem:** an expense-approval system needs different approval levels depending on amount — a manager approves small amounts, a director approves medium amounts, a VP approves large amounts — and hard-coding all three thresholds into one method makes adding a new approval level (or reordering them) awkward.

```java
abstract class Approver {
    protected Approver next;
    void setNext(Approver next) { this.next = next; }

    void approve(double amount) {
        if (canApprove(amount)) {
            System.out.println(getClass().getSimpleName() + " approved $" + amount);
        } else if (next != null) {
            next.approve(amount); // pass along the chain
        } else {
            System.out.println("No one could approve $" + amount);
        }
    }

    abstract boolean canApprove(double amount);
}

class Manager extends Approver {
    boolean canApprove(double amount) { return amount <= 1000; }
}

class Director extends Approver {
    boolean canApprove(double amount) { return amount <= 10000; }
}

class Vp extends Approver {
    boolean canApprove(double amount) { return amount <= 100000; }
}
```

```java
Approver manager = new Manager();
Approver director = new Director();
Approver vp = new Vp();
manager.setNext(director);
director.setNext(vp);

manager.approve(500);    // Manager approves
manager.approve(5000);   // passes to Director
manager.approve(50000);  // passes to Director, then VP
```

Each handler only knows one rule and one neighbor — no handler needs to know the full chain, and reordering or inserting a new approval level means relinking two `setNext` calls, not editing a monolithic conditional.

**Where you've implicitly seen this already:** middleware/filter chains in web frameworks (auth check → logging → rate limiting → your handler) are Chain of Responsibility; each middleware decides to handle the request itself or pass it to the next one.

## 18.3 Course wrap-up

You now have the full toolkit this course set out to build: the four OOP pillars (lesson 1), SOLID (lesson 2), UML notation and object relationships (lessons 3-4), the five creational patterns (lessons 5-8), the five structural patterns (lessons 9-13), and six behavioral patterns (lessons 14-18). The **LLD Practice** course applies all of it to 17 classic interview problems, starting with how to structure your answer under time pressure.

> **Review question**
> The expense-approval chain currently has a fixed maximum ($100,000, at the VP). Extend it with a `CFO` handler for anything above that, with no changes to `Manager`, `Director`, or `Vp`. What does this confirm about which SOLID principle Chain of Responsibility satisfies?
