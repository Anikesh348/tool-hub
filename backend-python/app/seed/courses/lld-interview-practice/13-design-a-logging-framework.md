> **Learning goal**
> Design a small but extensible logging framework — a compact problem that touches Singleton, Chain of Responsibility, and Strategy all at once, making it a good "review" problem late in the practice set.

## 13.1 Requirements and scope

**Functional requirements:** log messages at different severity levels (DEBUG, INFO, WARN, ERROR); only messages at or above a configured threshold should actually be output; support multiple simultaneous output destinations (console, file); the logger should be globally accessible from anywhere in an application.

**Non-functional constraints:** adding a new severity level or output destination shouldn't require editing existing code.

**Non-goals:** log rotation, distributed log aggregation, structured/JSON logging formats.

## 13.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Logger` | Application-wide entry point (**Singleton**, LLD Basics lesson 5); holds the configured threshold and a chain of appenders |
| `LogLevel` | An ordered enum: `DEBUG < INFO < WARN < ERROR` |
| `LogAppender` (interface) | Writes a message somewhere — console, file, etc. |
| `ConsoleAppender`, `FileAppender` | Concrete output destinations |

## 13.3 Key design decisions

**Level filtering via enum ordinal comparison.** `LogLevel` as an `enum` in severity order lets filtering be a single comparison (`messageLevel.ordinal() >= threshold.ordinal()`) rather than a lookup table — the same technique the Parking Lot problem (lesson 2) used for vehicle/spot size matching.

**Multiple appenders via Chain of Responsibility-flavored fan-out, not a single output.** Rather than hardcoding "write to console" inside `Logger`, hold a `List<LogAppender>` and forward every accepted message to all of them — this is structurally similar to Chain of Responsibility (LLD Basics lesson 18) in that a request passes through multiple handlers, except here every appender handles it (fan-out) rather than the first capable one stopping the chain. Adding a `NetworkAppender` later is one new class, zero edits to `Logger`.

```java
enum LogLevel { DEBUG, INFO, WARN, ERROR }

interface LogAppender {
    void append(LogLevel level, String message);
}

class ConsoleAppender implements LogAppender {
    public void append(LogLevel level, String message) {
        System.out.println("[" + level + "] " + message);
    }
}

class Logger {
    private static final Logger INSTANCE = new Logger();
    private LogLevel threshold = LogLevel.INFO;
    private final List<LogAppender> appenders = new ArrayList<>();

    private Logger() {}
    static Logger getInstance() { return INSTANCE; }

    void addAppender(LogAppender appender) { appenders.add(appender); }
    void setThreshold(LogLevel threshold) { this.threshold = threshold; }

    void log(LogLevel level, String message) {
        if (level.ordinal() < threshold.ordinal()) return; // below configured threshold, skip
        for (LogAppender appender : appenders) {
            appender.append(level, message);
        }
    }
}
```

**Singleton, but injectable where it matters.** `Logger.getInstance()` is convenient for quick call sites, but per lesson 5's caution about Singleton hurting testability, a class under test should still ideally receive its `Logger` (or a narrower logging interface) via constructor injection rather than reaching for the static instance directly — the Singleton guarantees *one* instance exists application-wide; nothing stops you from also passing that one instance around explicitly.

**Message formatting as its own concern.** A `LogFormatter` interface (plain text vs. timestamped vs. JSON) can sit between `Logger` and each `LogAppender`, another SRP-driven split (LLD Basics lesson 2) keeping "what to say" separate from "where to send it."

## 13.4 Walking through the scenarios

*Below threshold:* `logger.log(DEBUG, "cache hit")` with threshold `INFO` → filtered out before reaching any appender, zero output.

*Multiple appenders:* `logger.log(ERROR, "payment failed")` → both `ConsoleAppender` and `FileAppender` receive and independently write the message.

*Runtime threshold change:* ops raises the threshold to `WARN` during an incident to reduce noise — a one-line `setThreshold` call, no application restart needed since `Logger` is the single shared instance.

> **Review question**
> How would you extend this design so each `LogAppender` can have its *own* independent threshold (e.g. console shows INFO+, but the file appender only writes ERROR+)? Where does that threshold check move to?
