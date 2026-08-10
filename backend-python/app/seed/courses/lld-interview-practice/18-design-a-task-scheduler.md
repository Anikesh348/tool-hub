> **Learning goal**
> Close out the practice set with a system that combines several patterns from the LLD Basics course at once — Command for the tasks themselves, priority-based scheduling, and a worker-pool execution model — closer to real backend infrastructure than the earlier, more self-contained problems.

## 18.1 Requirements and scope

**Functional requirements:** clients submit tasks with a priority and either an immediate or scheduled future execution time; a pool of workers picks up and executes ready tasks; a task can be cancelled before it starts; the scheduler should execute higher-priority ready tasks before lower-priority ones.

**Non-functional constraints:** thread-safe under concurrent submission and concurrent worker execution; should not busy-wait burning CPU while waiting for the next scheduled task.

**Non-goals:** distributed scheduling across multiple machines, task persistence across a restart, retries/dead-letter handling (worth mentioning as real-world extensions).

## 18.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Task` (interface, extends `Command`) | `execute()` — reusing **Command** (LLD Basics lesson 17) so a task is a self-contained, queueable unit of work |
| `ScheduledTask` | Wraps a `Task` with priority + earliest-execution-time metadata |
| `TaskScheduler` | Accepts submissions, holds the ready queue, hands work to workers |
| `Worker` | Pulls the next ready task and executes it |

## 18.3 Key design decisions

**A task is a Command.** Every submitted unit of work implements the same `execute()` contract from LLD Basics lesson 17 — the scheduler never needs to know what a task actually *does*, only that it can be executed, exactly like `RemoteControl` not knowing it was controlling a `Light`.

```java
interface Task {
    void execute();
}
```

**Priority + time via one ordering, not two separate structures.** `ScheduledTask` implements `Comparable`, ordering first by earliest-eligible-time (tasks not yet due sort after tasks that are), then by priority among tasks equally eligible — a single `PriorityBlockingQueue<ScheduledTask>` (thread-safe out of the box) replaces what might otherwise become two separate, harder-to-keep-in-sync structures.

```java
class ScheduledTask implements Comparable<ScheduledTask> {
    final Task task;
    final int priority; // lower number = higher priority, matching PriorityQueue's natural ordering
    final long eligibleAtMillis;
    volatile boolean cancelled = false;

    public int compareTo(ScheduledTask other) {
        int timeCompare = Long.compare(this.eligibleAtMillis, other.eligibleAtMillis);
        if (timeCompare != 0) return timeCompare;
        return Integer.compare(this.priority, other.priority);
    }
}
```

**Not busy-waiting for future tasks.** A naive worker loop that just polls the queue in a tight `while(true)` and skips not-yet-eligible tasks burns CPU. Two practical fixes: (a) a separate lightweight scheduling thread that sleeps until the next task's eligible time before re-checking, or (b) using `DelayQueue` instead of a plain `PriorityBlockingQueue`, which natively blocks `take()` until an element's delay has expired — the reference implementation below uses approach (a) for clarity, but naming `DelayQueue` as the more idiomatic real answer is worth doing in an interview.

**Cancellation as a flag, not a queue removal.** Removing an arbitrary element from a priority queue is O(N); instead, mark `cancelled = true` on the `ScheduledTask` and have the worker check the flag immediately before executing — cheap, thread-safe with a `volatile` field, and avoids mutating the queue's internal structure concurrently with other operations.

**Worker pool, not one dedicated thread per task.** A fixed pool of `Worker` threads pulling from one shared queue (the classic producer-consumer setup) scales far better than spawning a new thread per submitted task, especially under bursty submission — this is the same reasoning a real thread-pool executor is built on.

## 18.4 Walking through the scenarios

*Immediate high-priority task:* submitted with `eligibleAtMillis = now`, low priority number → sorts to the front among currently-eligible tasks → picked up by the next free worker.

*Future scheduled task:* submitted with `eligibleAtMillis = now + 60000` → sits in the queue but is skipped by workers until that time arrives, without any worker busy-spinning the whole minute.

*Cancellation:* a task is cancelled after submission but before a worker reaches it → the worker's pre-execution check sees `cancelled == true` and discards it without running `execute()`.

> **Review question**
> Two equally-eligible tasks have the same priority. What ordering do they end up in with the `ScheduledTask.compareTo` shown above, and is that a problem? How would you make ties deterministic (e.g. FIFO among equal priorities)?
