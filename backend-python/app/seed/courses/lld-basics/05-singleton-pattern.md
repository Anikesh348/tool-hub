> **Learning goal**
> Implement a thread-safe Singleton correctly (most attempts get concurrency wrong), and know when it's actually the right tool versus a smell.

Singleton is the first of the **creational** patterns — patterns concerned with *how* objects get created. Singleton restricts a class to exactly one instance and gives the whole application one shared access point to it.

## 5.1 The problem it solves

Some objects genuinely should exist once: a logging framework's writer, a connection pool, a configuration reader, the `ParkingLot` in the practice-course problem (there's only one physical lot). Without Singleton, nothing stops five different parts of the codebase from each constructing their own `ConfigManager`, reading the config file five times and potentially disagreeing with each other.

## 5.2 The naive (broken) version

```java
public class ConfigManager {
    private static ConfigManager instance;
    private ConfigManager() {}

    public static ConfigManager getInstance() {
        if (instance == null) {
            instance = new ConfigManager(); // NOT thread-safe
        }
        return instance;
    }
}
```

Under concurrent access, two threads can both pass the `null` check before either finishes constructing, producing two instances — defeating the entire point of the pattern.

## 5.3 Correct approaches

**Eager initialization** — simplest, safe, but constructs the instance even if it's never used:

```java
public class ConfigManager {
    private static final ConfigManager INSTANCE = new ConfigManager();
    private ConfigManager() {}
    public static ConfigManager getInstance() { return INSTANCE; }
}
```

**Double-checked locking** — lazy (only builds it when first needed) and thread-safe, at the cost of a bit more code:

```java
public class ConfigManager {
    private static volatile ConfigManager instance;
    private ConfigManager() {}

    public static ConfigManager getInstance() {
        if (instance == null) {
            synchronized (ConfigManager.class) {
                if (instance == null) {
                    instance = new ConfigManager();
                }
            }
        }
        return instance;
    }
}
```

The `volatile` keyword is not optional here — without it, another thread can observe a partially-constructed object due to instruction reordering.

**Initialization-on-demand holder** — the idiomatic Java approach, lazy and thread-safe without any explicit locking, relying on the JVM's class-loading guarantees:

```java
public class ConfigManager {
    private ConfigManager() {}

    private static class Holder {
        static final ConfigManager INSTANCE = new ConfigManager();
    }

    public static ConfigManager getInstance() {
        return Holder.INSTANCE;
    }
}
```

The JVM guarantees `Holder` is only loaded (and its static field only initialized) the first time `getInstance()` is called, and class loading is already thread-safe — so this gets laziness and thread safety with none of the manual locking.

## 5.4 The downsides — why Singleton has a bad reputation

- **Hidden global state.** Any class can call `ConfigManager.getInstance()` from anywhere, which is a form of the same problem DIP (lesson 2) warns about — dependencies become invisible instead of showing up in a constructor.
- **Hard to test.** A Singleton can't easily be swapped for a mock in a unit test, since callers reach for the static instance directly instead of receiving it as a collaborator.
- **Not actually one instance in some environments** — a class loaded by two different classloaders, or run in separate JVM processes, gets one Singleton *per loader/process*, silently breaking the "exactly one" guarantee.

Prefer dependency injection (pass the single shared instance into constructors, as in lesson 2's DIP example) over a static `getInstance()` wherever the surrounding framework supports it — you get the same "one instance" property with none of the testability cost.

## 5.5 Where you'll actually use it

In the LLD Practice course, the `ParkingLot` and the `ATM`'s cash dispenser are natural Singleton candidates — see lessons 2 and 6 of that course.

> **Review question**
> Why does the naive version's bug specifically require *concurrent* access to manifest? Walk through the interleaving of two threads that both call `getInstance()` at the same time and produces two separate instances.
