import java.util.ArrayList;
import java.util.List;

/**
 * Complete reference implementation for the Logging Framework LLD problem:
 * a Singleton Logger, enum-ordinal severity filtering, and fan-out to
 * multiple pluggable appenders.
 *   javac LoggingFramework.java && java LoggingFramework
 */
public class LoggingFramework {

    enum LogLevel { DEBUG, INFO, WARN, ERROR }

    interface LogAppender {
        void append(LogLevel level, String message);
    }

    static class ConsoleAppender implements LogAppender {
        public void append(LogLevel level, String message) {
            System.out.println("[console][" + level + "] " + message);
        }
    }

    static class FileAppender implements LogAppender {
        private final LogLevel minLevel;

        FileAppender(LogLevel minLevel) { this.minLevel = minLevel; }

        public void append(LogLevel level, String message) {
            if (level.ordinal() < minLevel.ordinal()) return; // per-appender threshold
            System.out.println("[file][" + level + "] " + message);
        }
    }

    static class Logger {
        private static final Logger INSTANCE = new Logger();
        private LogLevel threshold = LogLevel.INFO;
        private final List<LogAppender> appenders = new ArrayList<>();

        private Logger() {}

        static Logger getInstance() { return INSTANCE; }

        void addAppender(LogAppender appender) { appenders.add(appender); }
        void setThreshold(LogLevel threshold) { this.threshold = threshold; }

        void log(LogLevel level, String message) {
            if (level.ordinal() < threshold.ordinal()) return;
            for (LogAppender appender : appenders) {
                appender.append(level, message);
            }
        }
    }

    public static void main(String[] args) {
        Logger logger = Logger.getInstance();
        logger.addAppender(new ConsoleAppender());
        logger.addAppender(new FileAppender(LogLevel.ERROR)); // file only cares about ERROR+

        logger.log(LogLevel.DEBUG, "cache hit");      // below global threshold (INFO), fully filtered
        logger.log(LogLevel.INFO, "user logged in");  // console only (below file's ERROR threshold)
        logger.log(LogLevel.ERROR, "payment failed"); // both console and file

        System.out.println("-- raising threshold to WARN --");
        logger.setThreshold(LogLevel.WARN);
        logger.log(LogLevel.INFO, "this is now filtered globally");
        logger.log(LogLevel.WARN, "disk usage high");
    }
}
