import java.util.ArrayList;
import java.util.List;

/**
 * Complete reference implementation for the Notification/Alerting System
 * LLD problem: Observer-based subscription with per-user, per-channel
 * fan-out and isolated channel failures.
 *   javac NotificationSystem.java && java NotificationSystem
 */
public class NotificationSystem {

    static class Notification {
        private final String message;
        private final String severity;

        Notification(String message, String severity) {
            this.message = message;
            this.severity = severity;
        }

        String getMessage() { return message; }
        String getSeverity() { return severity; }
    }

    interface Subscriber {
        void onNotify(Notification notification);
    }

    interface NotificationChannel {
        void send(User user, Notification notification);
    }

    static class EmailChannel implements NotificationChannel {
        public void send(User user, Notification notification) {
            System.out.println("Emailing " + user.getName() + ": " + notification.getMessage());
        }
    }

    static class SmsChannel implements NotificationChannel {
        public void send(User user, Notification notification) {
            if (user.getName().equals("Flaky")) {
                throw new RuntimeException("SMS provider timeout");
            }
            System.out.println("Texting " + user.getName() + ": " + notification.getMessage());
        }
    }

    static class User implements Subscriber {
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
                }
            }
        }

        String getName() { return name; }
    }

    static class NotificationSubject {
        private final List<Subscriber> subscribers = new ArrayList<>();

        void subscribe(Subscriber subscriber) { subscribers.add(subscriber); }
        void unsubscribe(Subscriber subscriber) { subscribers.remove(subscriber); }

        void notifyAll(Notification notification) {
            for (Subscriber subscriber : new ArrayList<>(subscribers)) {
                subscriber.onNotify(notification);
            }
        }
    }

    public static void main(String[] args) {
        NotificationSubject subject = new NotificationSubject();

        User alice = new User("Alice", List.of(new EmailChannel(), new SmsChannel()));
        User flaky = new User("Flaky", List.of(new EmailChannel(), new SmsChannel()));

        subject.subscribe(alice);
        subject.subscribe(flaky);

        subject.notifyAll(new Notification("Price dropped below threshold", "INFO"));

        subject.unsubscribe(flaky);
        System.out.println("-- Flaky unsubscribed --");
        subject.notifyAll(new Notification("Critical system alert", "CRITICAL"));
    }
}
