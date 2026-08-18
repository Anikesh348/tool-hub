import java.util.List;
import java.util.concurrent.PriorityBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Complete reference implementation for the Task Scheduler LLD problem:
 * Command-based tasks, priority+time ordering, flag-based cancellation,
 * and a small worker pool.
 *   javac TaskSchedulerSystem.java && java TaskSchedulerSystem
 */
public class TaskSchedulerSystem {

    interface Task {
        void execute();
    }

    static class ScheduledTask implements Comparable<ScheduledTask> {
        final Task task;
        final int priority; // lower number = higher priority
        final long eligibleAtMillis;
        final String name;
        volatile boolean cancelled = false;

        ScheduledTask(Task task, int priority, long eligibleAtMillis, String name) {
            this.task = task;
            this.priority = priority;
            this.eligibleAtMillis = eligibleAtMillis;
            this.name = name;
        }

        public int compareTo(ScheduledTask other) {
            int timeCompare = Long.compare(this.eligibleAtMillis, other.eligibleAtMillis);
            if (timeCompare != 0) return timeCompare;
            return Integer.compare(this.priority, other.priority);
        }
    }

    static class TaskScheduler {
        private final PriorityBlockingQueue<ScheduledTask> queue = new PriorityBlockingQueue<>();
        private final List<Thread> workers = new java.util.ArrayList<>();
        private final AtomicBoolean running = new AtomicBoolean(true);

        TaskScheduler(int workerCount) {
            for (int i = 0; i < workerCount; i++) {
                Thread worker = new Thread(this::workerLoop, "worker-" + i);
                worker.setDaemon(true);
                workers.add(worker);
                worker.start();
            }
        }

        ScheduledTask submit(Task task, int priority, long delayMillis, String name) {
            ScheduledTask scheduled = new ScheduledTask(task, priority, System.currentTimeMillis() + delayMillis, name);
            queue.put(scheduled);
            return scheduled;
        }

        void cancel(ScheduledTask task) {
            task.cancelled = true;
        }

        private void workerLoop() {
            while (running.get()) {
                try {
                    ScheduledTask next = queue.take(); // blocks until something is available
                    long waitMillis = next.eligibleAtMillis - System.currentTimeMillis();
                    if (waitMillis > 0) {
                        // Not yet eligible: put it back and sleep briefly rather than busy-spinning.
                        queue.put(next);
                        Thread.sleep(Math.min(waitMillis, 50));
                        continue;
                    }
                    if (next.cancelled) {
                        System.out.println("Skipped cancelled task: " + next.name);
                        continue;
                    }
                    System.out.println(Thread.currentThread().getName() + " executing " + next.name);
                    next.task.execute();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        void shutdown() { running.set(false); }
    }

    public static void main(String[] args) throws InterruptedException {
        TaskScheduler scheduler = new TaskScheduler(2);

        scheduler.submit(() -> System.out.println("Sending welcome email"), 5, 0, "welcome-email");
        scheduler.submit(() -> System.out.println("Processing urgent payment"), 1, 0, "urgent-payment");
        ScheduledTask reminder = scheduler.submit(() -> System.out.println("Reminder: renew subscription"), 3, 500, "reminder");
        scheduler.submit(() -> System.out.println("Generating daily report"), 2, 0, "daily-report");

        scheduler.cancel(reminder); // cancelled before it becomes eligible

        Thread.sleep(1500); // let the worker pool drain the queue
        scheduler.shutdown();
    }
}
