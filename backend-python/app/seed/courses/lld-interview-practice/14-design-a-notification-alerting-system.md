> **Learning goal**
> Design a multi-channel notification system where users subscribe to alerts and each channel delivers independently — a direct, larger-scale application of the Observer pattern (LLD Basics lesson 15).

## 14.1 Requirements and scope

**Functional requirements:** an event source (e.g. a price alert, a system incident) publishes notifications; users can subscribe to be notified via one or more channels (email, SMS, push); each user's notification preferences can differ; a failure sending on one channel shouldn't block delivery on others.

**Non-functional constraints:** in-memory; delivery should be per-channel independent (no single channel's slowness should block another's).

**Non-goals:** actual integration with real email/SMS providers (treat each as a stub `NotificationChannel.send(...)`), retry/backoff logic.

## 14.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `NotificationSubject` | The event source; holds subscribers, triggers notifications (the Observer *subject*) |
| `Subscriber` (interface) | `onNotify(Notification)` — the Observer *observer* role |
| `User` | Implements `Subscriber`; holds a list of preferred `NotificationChannel`s |
| `NotificationChannel` (interface) | `send(User, Notification)` — email/SMS/push, a **Strategy** per delivery mechanism |
| `Notification` | The message content and metadata (severity, timestamp) |

## 14.3 Key design decisions

**This is Observer (LLD Basics lesson 15), with channels layered on as Strategy.** `NotificationSubject` holds `List<Subscriber>` and calls `onNotify` on each — structurally identical to the `StockPrice`/`PriceObserver` example. What's new here is that each `Subscriber` (`User`) doesn't just react directly — it fans the notification out across its own list of `NotificationChannel` strategies:

```java
interface Subscriber {
    void onNotify(Notification notification);
}

interface NotificationChannel {
    void send(User user, Notification notification);
}

class EmailChannel implements NotificationChannel {
    public void send(User user, Notification notification) {
        System.out.println("Emailing " + user.getName() + ": " + notification.getMessage());
    }
}

class User implements Subscriber {
    private final String name;
    private final List<NotificationChannel> channels;

    User(String name, List<NotificationChannel> channels) {
        this.name = name;
        this.channels = channels;
    }

    public void onNotify(Notification notification) {
        for (NotificationChannel channel : channels) {
            try {
                channel.send(this, notification);
            } catch (Exception e) {
                System.out.println("Delivery failed on one channel for " + name + ": " + e.getMessage());
                // deliberately doesn't rethrow - one channel's failure shouldn't block the others
            }
        }
    }

    String getName() { return name; }
}

class NotificationSubject {
    private final List<Subscriber> subscribers = new ArrayList<>();

    void subscribe(Subscriber subscriber) { subscribers.add(subscriber); }
    void unsubscribe(Subscriber subscriber) { subscribers.remove(subscriber); }

    void notifyAll(Notification notification) {
        for (Subscriber subscriber : new ArrayList<>(subscribers)) { // copy, per lesson 15's mid-iteration caution
            subscriber.onNotify(notification);
        }
    }
}
```

**Per-channel failure isolation.** Wrapping each `channel.send(...)` call individually (not the whole loop) in error handling means an SMS provider outage doesn't prevent email delivery to the same user, and doesn't prevent notifying the *next* user at all — failure is contained to exactly the one channel that failed.

**Severity-based channel selection (an optional extension).** A user might only want SMS for `CRITICAL` notifications but email for everything — this is naturally modeled by filtering `channels` by a `minSeverity` field per channel subscription, another Strategy-flavored decision kept out of `NotificationSubject`.

## 14.4 Walking through the scenarios

*Normal delivery:* a price alert fires → `NotificationSubject.notifyAll(...)` → each subscribed `User.onNotify` fans out to their configured channels.

*Partial channel failure:* a user has both email and SMS configured; the SMS provider throws → email still succeeds because each channel is isolated in its own try/catch.

*Dynamic subscription:* a user unsubscribes mid-session → the next `notifyAll` simply doesn't include them, no special-casing needed since `NotificationSubject` never held a hardcoded reference to any specific subscriber.

> **Review question**
> How would you change this design so notification delivery happens asynchronously (each channel send runs on its own thread/task) without changing `NotificationSubject`'s public API?
