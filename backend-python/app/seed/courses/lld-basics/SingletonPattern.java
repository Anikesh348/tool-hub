/**
 * Standalone demo of the Singleton pattern via the initialization-on-demand
 * holder idiom: lazy, thread-safe, no explicit locking.
 *   javac SingletonPattern.java && java SingletonPattern
 */
public class SingletonPattern {

    static class ConfigManager {
        private final java.util.Map<String, String> settings = new java.util.HashMap<>();

        private ConfigManager() {
            // Simulate loading config once, at first use.
            settings.put("maxConnections", "100");
            settings.put("environment", "production");
            System.out.println("ConfigManager constructed exactly once.");
        }

        private static class Holder {
            static final ConfigManager INSTANCE = new ConfigManager();
        }

        static ConfigManager getInstance() {
            return Holder.INSTANCE;
        }

        String get(String key) {
            return settings.get(key);
        }
    }

    public static void main(String[] args) throws InterruptedException {
        Runnable task = () -> {
            ConfigManager manager = ConfigManager.getInstance();
            System.out.println(Thread.currentThread().getName()
                    + " got instance " + System.identityHashCode(manager)
                    + " environment=" + manager.get("environment"));
        };

        // Even under concurrent first access, every thread observes the same instance.
        Thread t1 = new Thread(task, "thread-1");
        Thread t2 = new Thread(task, "thread-2");
        Thread t3 = new Thread(task, "thread-3");
        t1.start();
        t2.start();
        t3.start();
        t1.join();
        t2.join();
        t3.join();
    }
}
