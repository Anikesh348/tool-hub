> **Learning goal**
> Let a set of dependent objects (observers) automatically get notified whenever another object (the subject) changes state, without the subject needing to know anything concrete about who's listening.

## 15.1 The problem: manually pushing updates to everyone interested

A `StockPrice` object might need to update several unrelated things whenever the price changes: a UI display, a logging system, and an alerting service.

```java
class StockPrice {
    private double price;
    private UiDisplay display;
    private AuditLog log;
    private AlertService alerts;

    void setPrice(double price) {
        this.price = price;
        display.refresh(price);   // StockPrice now knows about every consumer...
        log.record(price);        // ...and has to be edited every time a new one is added
        alerts.checkThreshold(price);
    }
}
```

`StockPrice` has to import and directly reference every single thing that cares about it — a clear SRP/DIP violation (lesson 2), and it means "add a new consumer" always requires editing `StockPrice` itself.

## 15.2 The Observer solution

Define an `Observer` interface with an `update` method, let the subject hold a list of observers it knows nothing concrete about, and notify all of them uniformly.

```java
interface PriceObserver {
    void onPriceChanged(double newPrice);
}

class StockPrice {
    private double price;
    private final List<PriceObserver> observers = new ArrayList<>();

    void subscribe(PriceObserver observer) { observers.add(observer); }
    void unsubscribe(PriceObserver observer) { observers.remove(observer); }

    void setPrice(double price) {
        this.price = price;
        for (PriceObserver observer : observers) {
            observer.onPriceChanged(price); // StockPrice has no idea what these actually do
        }
    }
}

class UiDisplay implements PriceObserver {
    public void onPriceChanged(double newPrice) { System.out.println("UI updated: $" + newPrice); }
}

class AlertService implements PriceObserver {
    public void onPriceChanged(double newPrice) {
        if (newPrice > 1000) System.out.println("ALERT: price above threshold!");
    }
}
```

```java
StockPrice stock = new StockPrice();
stock.subscribe(new UiDisplay());
stock.subscribe(new AlertService());
stock.setPrice(1050.0); // both observers react, StockPrice never named either of them
```

Adding a new consumer (say, `AuditLog`) is now `stock.subscribe(new AuditLog())` — zero changes to `StockPrice` itself.

## 15.3 Push vs. pull observers

The example above **pushes** the new value directly into `onPriceChanged(newPrice)`. An alternative is to **pull**: notify with no data (`onPriceChanged()`), and let each observer call `subject.getPrice()` itself if it needs the value. Push is simpler for a single piece of changing data; pull scales better when different observers need different pieces of the subject's state, since it avoids growing the notification signature every time a new observer needs one more field.

## 15.4 A caution: unsubscribing and memory leaks

If observers are never removed (`unsubscribe`), a long-lived subject holds references to every observer that ever subscribed, forever — a classic memory leak, especially in UI code where a screen's observers should be removed when the screen closes. Always pair every `subscribe` with a corresponding `unsubscribe` at the natural point where the observer's lifecycle ends.

## 15.5 Where you'll use this

This is precisely the mechanism behind real-world "pub/sub" and event systems: a `NotificationService` module notifying multiple channels (lesson 2's example, revisited), price/inventory alerting, or a chat room broadcasting a new message to every connected `User` — the Notification/Alerting System problem in the LLD Practice course builds directly on this lesson.

> **Review question**
> Two observers are subscribed to the same `StockPrice`. One of them, while handling `onPriceChanged`, calls `stock.unsubscribe(itself)`. What could go wrong with the simple `for` loop in `setPrice`, and how would you make iteration safe against observers modifying the subscriber list mid-notification?
