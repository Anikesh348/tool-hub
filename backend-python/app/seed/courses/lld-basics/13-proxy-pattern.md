> **Learning goal**
> Control access to an object — lazily creating it, checking permissions, or crossing a network — behind the same interface the real object exposes, so callers can't tell the difference.

## 13.1 The problem: expensive or sensitive direct access

Loading a large image, calling a remote service, or exposing an admin operation all need something *extra* around the real work — but adding that logic directly to the real class either bloats it with unrelated concerns or isn't possible at all (e.g. the real class is a generated remote-service stub).

## 13.2 The Proxy solution

Create a class implementing the same interface as the real object, which controls access before delegating to it (or deciding not to).

**Virtual proxy — defers expensive creation until actually needed:**

```java
interface Image {
    void display();
}

class RealImage implements Image {
    private final String filename;
    RealImage(String filename) {
        this.filename = filename;
        loadFromDisk(); // expensive — happens at construction
    }
    private void loadFromDisk() { System.out.println("Loading " + filename + " from disk"); }
    public void display() { System.out.println("Displaying " + filename); }
}

class ImageProxy implements Image {
    private final String filename;
    private RealImage real; // not created yet

    ImageProxy(String filename) { this.filename = filename; }

    public void display() {
        if (real == null) {
            real = new RealImage(filename); // only loads on first actual display
        }
        real.display();
    }
}
```

If a gallery holds 500 `ImageProxy` objects but the user only scrolls to see 10, only those 10 ever pay the loading cost.

**Protection proxy — checks permissions before delegating:**

```java
interface AdminPanel {
    void deleteUser(String userId);
}

class RealAdminPanel implements AdminPanel {
    public void deleteUser(String userId) { System.out.println("Deleted " + userId); }
}

class AdminPanelProtectionProxy implements AdminPanel {
    private final RealAdminPanel real = new RealAdminPanel();
    private final String currentUserRole;

    AdminPanelProtectionProxy(String currentUserRole) { this.currentUserRole = currentUserRole; }

    public void deleteUser(String userId) {
        if (!"ADMIN".equals(currentUserRole)) {
            throw new SecurityException("Only admins can delete users");
        }
        real.deleteUser(userId);
    }
}
```

## 13.3 Proxy vs. Decorator — same shape, different intent

This is the distinction lesson 10 flagged as a preview. Structurally, Proxy and Decorator are nearly identical (a class implementing the same interface as, and holding a reference to, another instance of that interface). The difference is entirely about *intent*:

| | Decorator | Proxy |
| --- | --- | --- |
| Purpose | Add new behavior/responsibilities | Control access to existing behavior |
| Wrapped object | Usually always delegated to | Might not be created or called at all |
| Stackable | Yes, designed to be composed | Usually one proxy per concern |

An `ImageProxy` doesn't add anything `RealImage` doesn't already do — it just controls *when* the real work happens. A `MilkDecorator` genuinely adds new cost/behavior on top of what `SimpleCoffee` does.

## 13.4 Other common Proxy variants

- **Remote proxy** — represents an object living in a different address space (a different process or server), hiding the network call behind a local-looking method call.
- **Caching proxy** — stores results of expensive calls and returns the cached value on repeat requests, only delegating to the real object on a cache miss.

## 13.5 Where you'll use this

Lazy-loading large resources, enforcing role-based access on sensitive operations, and wrapping a remote microservice client so the rest of the app calls it like a local object, are all Proxy use cases you'll see across both LLD courses.

> **Review question**
> Design a `CachingProxy` for a `WeatherService` interface with `getForecast(String city)`. What needs to happen if the cached forecast is more than 10 minutes old?
