> **Learning goal**
> Move "which concrete class do I instantiate?" decisions out of client code and into one dedicated place — first with Factory Method, then one level higher with Abstract Factory.

## 6.1 The problem: `new` scattered everywhere

Without a creational pattern, deciding *which* concrete class to instantiate ends up duplicated across the codebase:

```java
Shape shape;
if (type.equals("circle")) shape = new Circle();
else if (type.equals("square")) shape = new Square();
else throw new IllegalArgumentException("Unknown type");
```

Every place that needs a `Shape` repeats this chain, and adding a new shape means hunting down and editing every copy — a direct OCP violation from lesson 2.

## 6.2 Factory Method — delegate creation to a method

Factory Method defines a method whose only job is to construct and return an object, letting subclasses (or a simple parameterized factory) decide the concrete type.

```java
interface Shape { double area(); }
class Circle implements Shape { double r; Circle(double r) { this.r = r; } public double area() { return Math.PI * r * r; } }
class Square implements Shape { double s; Square(double s) { this.s = s; } public double area() { return s * s; } }

class ShapeFactory {
    static Shape create(String type, double size) {
        return switch (type) {
            case "circle" -> new Circle(size);
            case "square" -> new Square(size);
            default -> throw new IllegalArgumentException("Unknown type: " + type);
        };
    }
}

// client code
Shape shape = ShapeFactory.create("circle", 5);
```

The `if/else` chain still exists, but now it lives in exactly one place. Every caller depends only on `Shape` and `ShapeFactory` — swap in a `Triangle` by editing the factory once, and no caller needs to change.

## 6.3 Abstract Factory — a factory of related factories

Abstract Factory steps up one level: instead of creating *one* kind of object, it creates a **family of related objects** that need to stay consistent with each other.

```java
interface Button { void render(); }
interface Checkbox { void render(); }

class WindowsButton implements Button { public void render() { System.out.println("Windows button"); } }
class WindowsCheckbox implements Checkbox { public void render() { System.out.println("Windows checkbox"); } }
class MacButton implements Button { public void render() { System.out.println("Mac button"); } }
class MacCheckbox implements Checkbox { public void render() { System.out.println("Mac checkbox"); } }

interface UiFactory {
    Button createButton();
    Checkbox createCheckbox();
}

class WindowsUiFactory implements UiFactory {
    public Button createButton() { return new WindowsButton(); }
    public Checkbox createCheckbox() { return new WindowsCheckbox(); }
}

class MacUiFactory implements UiFactory {
    public Button createButton() { return new MacButton(); }
    public Checkbox createCheckbox() { return new MacCheckbox(); }
}
```

The critical guarantee Abstract Factory adds: once you pick `WindowsUiFactory`, every widget it hands you is a Windows widget — it's structurally impossible to accidentally mix a `MacButton` with a `WindowsCheckbox`. That consistency-across-a-family is exactly what plain Factory Method doesn't give you.

## 6.4 Factory Method vs. Abstract Factory — how to tell them apart

| | Factory Method | Abstract Factory |
| --- | --- | --- |
| Creates | One product | A family of related products |
| Structure | Usually one method | An interface with several creation methods |
| Use when | You need to decouple "which subclass" from callers | You need several objects that must be mutually consistent |

A useful rule of thumb: if you find yourself writing an Abstract Factory whose interface only has one `create` method, you've actually just written a Factory Method — that's fine, it just means the "family" only has one member so far.

## 6.5 Where you'll use this

The `NotificationChannel` selection in lesson 2's SOLID example, and picking `PaymentProcessor` implementations, are both Factory Method use cases. Abstract Factory shows up naturally in the Vending Machine problem (lesson 4 of LLD Practice) when different product families need matching dispensing + payment mechanisms.

> **Review question**
> You're building a document editor that must support both "Modern" and "Classic" themes, where every widget (button, scrollbar, menu) needs to match the chosen theme. Would you reach for Factory Method or Abstract Factory, and why?
