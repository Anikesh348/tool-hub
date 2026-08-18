> **Learning goal**
> Wrap an incompatible interface (usually third-party or legacy) so it fits the interface your code already expects, without modifying either side.

Adapter is the first of the **structural** patterns — patterns concerned with how classes and objects are composed to form larger structures.

## 9.1 The problem: two interfaces that don't match

Your application code depends on a clean interface, but the implementation you need to use — a third-party library, a legacy class, or an external API client — exposes a different, incompatible shape.

```java
// The interface your application already expects everywhere:
interface JsonLogger {
    void log(String jsonPayload);
}

// A third-party library you don't control, with an incompatible interface:
class LegacyXmlAuditWriter {
    void writeXmlEntry(String xmlPayload) { /* writes XML to a legacy audit file */ }
}
```

You can't edit `LegacyXmlAuditWriter` (it ships in a jar), and rewriting every call site in your app to work in XML instead of JSON would be a huge, invasive change.

## 9.2 The Adapter solution

Write a small class that implements the interface your code expects, and internally translates each call into whatever the incompatible class actually needs.

```java
class XmlAuditLoggerAdapter implements JsonLogger {
    private final LegacyXmlAuditWriter legacyWriter;

    XmlAuditLoggerAdapter(LegacyXmlAuditWriter legacyWriter) {
        this.legacyWriter = legacyWriter;
    }

    @Override
    public void log(String jsonPayload) {
        String xmlPayload = convertJsonToXml(jsonPayload); // the actual translation work
        legacyWriter.writeXmlEntry(xmlPayload);
    }

    private String convertJsonToXml(String json) {
        // format conversion logic
        return "<entry>" + json + "</entry>";
    }
}

// client code — completely unaware it's talking to a legacy XML system
JsonLogger logger = new XmlAuditLoggerAdapter(new LegacyXmlAuditWriter());
logger.log("{\"event\":\"login\"}");
```

Neither `JsonLogger`'s other implementations nor `LegacyXmlAuditWriter` itself had to change. The adapter is the only new code, and it's isolated to exactly the translation logic.

## 9.3 Object adapter vs. class adapter

The example above is an **object adapter** — it holds a reference to the adaptee and delegates to it. Java (lacking multiple inheritance) almost always uses this form. A **class adapter** would instead *inherit* from the adaptee and implement the target interface simultaneously — only possible in languages with multiple inheritance, and rarely used even there, since it locks the adapter to one specific adaptee subclass instead of any implementation of it.

## 9.4 Adapter vs. Facade (preview of lesson 11)

Both wrap another class, which makes them easy to confuse:

| | Adapter | Facade |
| --- | --- | --- |
| Goal | Make an incompatible interface match one you already expect | Simplify a complex subsystem's interface, whether or not it's "incompatible" |
| Interface count wrapped | Usually one | Usually several classes/interfaces |
| Driven by | An existing contract you must conform to | A desire for a simpler API, from scratch |

Adapter is about *compatibility*; Facade (lesson 11) is about *simplicity*.

## 9.5 Where you'll use this

Any time an LLD problem says "integrate with an existing payment gateway SDK" or "this system already has a `LegacyInventoryService`, wire it into your new `InventoryProvider` interface" — that's an Adapter, applying the DIP principle (lesson 2) so the rest of the app depends on your clean interface, not the legacy shape.

> **Review question**
> Your application's `PaymentProcessor` interface has `charge(String customerId, double amountInCents)`. A third-party SDK you must integrate exposes `submitPayment(PaymentRequest request)` where `PaymentRequest` is built via its own builder and expects dollars, not cents. Sketch the adapter class.
