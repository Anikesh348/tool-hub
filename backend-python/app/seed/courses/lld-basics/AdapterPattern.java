/**
 * Standalone demo of the Adapter pattern: a legacy XML audit writer
 * adapted to the JsonLogger interface the rest of the application expects.
 *   javac AdapterPattern.java && java AdapterPattern
 */
public class AdapterPattern {

    interface JsonLogger {
        void log(String jsonPayload);
    }

    // Third-party / legacy class with an incompatible interface - not editable.
    static class LegacyXmlAuditWriter {
        void writeXmlEntry(String xmlPayload) {
            System.out.println("[legacy audit file] " + xmlPayload);
        }
    }

    static class XmlAuditLoggerAdapter implements JsonLogger {
        private final LegacyXmlAuditWriter legacyWriter;

        XmlAuditLoggerAdapter(LegacyXmlAuditWriter legacyWriter) {
            this.legacyWriter = legacyWriter;
        }

        @Override
        public void log(String jsonPayload) {
            String xmlPayload = convertJsonToXml(jsonPayload);
            legacyWriter.writeXmlEntry(xmlPayload);
        }

        private String convertJsonToXml(String json) {
            return "<entry>" + json + "</entry>";
        }
    }

    static class ConsoleJsonLogger implements JsonLogger {
        @Override
        public void log(String jsonPayload) {
            System.out.println("[console] " + jsonPayload);
        }
    }

    static void auditLogin(JsonLogger logger, String userId) {
        logger.log("{\"event\":\"login\",\"user\":\"" + userId + "\"}");
    }

    public static void main(String[] args) {
        JsonLogger consoleLogger = new ConsoleJsonLogger();
        JsonLogger legacyAdapter = new XmlAuditLoggerAdapter(new LegacyXmlAuditWriter());

        // Both look identical to calling code, even though one is secretly XML underneath.
        auditLogin(consoleLogger, "user-42");
        auditLogin(legacyAdapter, "user-42");
    }
}
