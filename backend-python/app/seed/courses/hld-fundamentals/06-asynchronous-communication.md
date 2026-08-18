> **Learning goal**
> Understand why systems communicate asynchronously instead of always talking directly, and learn the three core mechanisms — publish/subscribe, message queues, and change data capture — that make async communication work in practice.

## 6.1 Overview

So far you might picture two systems talking to each other the way two people talk on a phone call: A calls B, B has to be available right now, and A waits until B finishes responding before doing anything else. That's **synchronous** communication, and it's the default mental model for most beginners because it's how a normal function call works. But it has a hidden cost: A and B are now coupled in time. If B is slow, A is slow. If B is down, A fails. If B suddenly gets ten times more requests than usual, A's users feel that pain immediately.

Asynchronous communication breaks that coupling by putting something durable *between* A and B — a queue, a topic, a log — so that A can hand off work and move on, and B can pick it up whenever it's ready, at its own pace, even if it's temporarily down or overwhelmed. This module covers the three main shapes this takes: **publish/subscribe**, where one event needs to reach many independent listeners (6.2); **message queues**, where a piece of work needs to be handled by exactly one worker out of a pool (6.3); and **Change Data Capture**, a specific and increasingly important technique for turning database changes into a stream of events without touching application code (6.4). These three ideas show up together constantly in real systems — you'll often see all three in the same architecture, each solving a different piece of the "how do these services know what happened without calling each other directly" problem.

## 6.2 Publish/Subscribe (Pub/Sub)

Publish/subscribe is a messaging pattern built for one specific shape of problem: **one thing happens, and multiple, independent parties need to know about it, without the thing that happened needing to know who's listening.** Imagine an e-commerce order being placed. The moment that happens, the inventory service needs to decrement stock, the email service needs to send a confirmation, the analytics service needs to log the event, and the fraud-detection service needs to check it. In a naive design, the "place order" code would call all four of those services directly — which means every time you add a fifth interested service, you have to modify the order-placing code again, and if any one of those four calls is slow or fails, it can block or break the whole order flow.

Pub/sub decouples this. The order service simply **publishes** an event — "OrderPlaced, order #4521, ..." — to a named channel called a **topic**. It doesn't know or care who's listening. Any number of **subscribers** can attach a **subscription** to that topic, and each subscription gets its own independent copy of every event published. The inventory service, email service, analytics service, and fraud service each have their own subscription to the `OrderPlaced` topic, and each processes the event on its own schedule, independently of the others.

```text
                          +--> Subscription A (Inventory service)
Publisher --> Topic ------+--> Subscription B (Email service)
(Order svc)  "OrderPlaced"+--> Subscription C (Analytics service)
                          +--> Subscription D (Fraud service)
```

This is often called **fan-out**: one published event, many independent receivers. It's the key difference between pub/sub and a plain message queue (covered next): in a queue, one message is consumed by exactly one worker; in pub/sub, one event is delivered to *every* subscription that's listening, and each subscription tracks its own delivery/acknowledgment state independently. If the fraud service is temporarily down, that doesn't affect whether the email service gets its copy.

There are two ways events actually get delivered to subscribers. In **push** delivery, the broker calls the subscriber directly (like a webhook) as soon as an event arrives — this is fast but can overwhelm a subscriber during a burst of traffic if it's not ready to handle the volume. In **pull** delivery, subscribers ask the broker for new messages whenever they're ready, giving the subscriber control over its own pace and letting it batch multiple messages together for efficiency.

A subtlety that trips up beginners: pub/sub events should be treated as *facts about what happened*, not instructions about what to do. `OrderPlaced` is a fact; it's not `SendConfirmationEmail`. This matters because facts stay useful to new subscribers you haven't even built yet — a future recommendation service can subscribe to the same `OrderPlaced` topic without the order service ever needing to change, whereas an instruction-shaped event only makes sense to the one service it was written for.

A few practical gotchas worth knowing before you use pub/sub in a design: ordering is typically only guaranteed within a narrow scope (like a single partition or a single key), not across the whole topic — don't assume global ordering unless your system explicitly provides it. Delivery is usually "at-least-once," meaning a subscriber might occasionally see the same event twice (due to retries after a network blip), so consumers need to be written to handle duplicates safely (this property is called **idempotency** — processing the same event twice has the same effect as processing it once). And if a subscriber falls behind or crashes for a while, whether it can "catch up" later depends on whether the system is durable (keeps a backlog) or ephemeral (only delivers to whoever's listening right now) — this is a real design decision, not an implementation detail, and it's worth explicitly stating which one your system needs.

## 6.3 Message Queues

Where pub/sub is about broadcasting one event to many interested listeners, a message queue solves a different, equally common problem: **you have a pile of individual tasks that need to be done, and you want a pool of workers to divide that work amongst themselves, each task handled exactly once.** Think of resizing a million uploaded images, sending a batch of push notifications, or processing video transcoding jobs — you don't want ten workers all separately resizing the *same* image; you want the pile of a million images to be spread across ten workers, each image handled once.

The core pieces are simple: a **producer** creates a message (a unit of work, e.g. `{"imageId": 5567}`) and puts it on the **queue**. A **broker** (like RabbitMQ, Amazon SQS, or Kafka used in queue-mode) durably stores that message until it's handled. A **consumer** — one of possibly many workers — pulls a message off the queue, does the work, and then sends an **acknowledgment (ack)** back to the broker confirming it's done. Only after the ack does the broker consider the message fully handled and remove it.

```text
Producers --> [ Queue: msg1, msg2, msg3, msg4, msg5 ] --> Consumer pool
                                                             Worker 1 <- msg1
                                                             Worker 2 <- msg2
                                                             Worker 3 <- msg3
```

That acknowledgment step is the whole point. If Worker 2 crashes halfway through processing msg2 and never acks it, the broker eventually notices (usually via a visibility timeout) and puts msg2 back on the queue for another worker to try. This gives you free recovery from worker crashes — something that's much harder to get right if services called each other directly and one just silently died mid-request.

Message queues buy you a few things that matter a lot at scale. They **decouple** the producer's speed from the consumer's speed — if image uploads spike to ten times normal for five minutes, the queue simply grows temporarily and the workers drain it at their own steady pace, instead of workers falling over trying to keep up in real time. This is often called **buffering** or "smoothing traffic spikes." They let you **scale producers and consumers independently** — add more workers when the queue backs up, without touching the producer at all. And they enable **background/async processing**: a user-facing request can enqueue a slow task ("generate PDF report") and return an immediate response ("we'll email you when it's ready") instead of making the user's browser wait.

A few common queue variations worth knowing by name: a **priority queue** processes urgent messages ahead of normal ones; a **delayed queue** holds a message until a specified future time before making it available (useful for "remind this user in 24 hours"); and a **dead-letter queue (DLQ)** is where messages that repeatedly fail processing get routed after a retry limit, so they don't get retried forever and block the queue — instead they sit somewhere for a human or a separate process to investigate.

The trade-offs mirror pub/sub's: most queues offer at-least-once delivery, so consumers must be idempotent (safe to process the same message twice); ordering is typically only preserved within a single queue or partition, not globally; and a growing queue depth (the backlog of unprocessed messages) is one of the most important operational metrics to alert on, because a queue that's silently growing is a system quietly falling behind until it eventually becomes a very not-silent incident.

## 6.4 Change Data Capture (CDC)

The first two topics assumed someone deliberately writes code to publish an event or enqueue a message. Change Data Capture solves a narrower but very practical problem: **what if you want other systems to react to changes in a database, without modifying the application code that writes to it?** This comes up constantly — you have an existing service with a database, and now you want to keep a search index updated, feed a data warehouse, invalidate a cache, or replicate data to another region, but you don't want to sprinkle "also publish an event" calls throughout an existing, working codebase (and risk forgetting one, or having it fail independently of the database write).

CDC works by treating the database's own record of its changes as the source of truth for what happened, and streaming that out as a series of events. There are three common ways to implement it, in increasing order of how production-grade they are:

**Timestamp-based** — add an `updated_at` column, and periodically poll the table for rows changed since the last poll. This is the simplest approach conceptually, but it has real gaps: it can't detect deletes (a deleted row isn't "updated," it's gone), it can miss rapid intermediate changes if a row is updated twice between polls, and it requires you to have discipline about setting that timestamp correctly on every write.

**Trigger-based** — set up database triggers that fire on insert/update/delete and write a record of the change into a separate audit table, which something else then reads. This captures everything, including deletes, but adds overhead to every write (the trigger has to run synchronously) and is one more piece of database logic to maintain and keep in sync with schema changes.

**Log-based** — read the database's own internal transaction log (e.g., MySQL's binlog, Postgres's write-ahead log/WAL) that it already maintains for its own crash-recovery purposes. This is considered the best approach for anything at real scale: it doesn't add write-path overhead (the log is written regardless of CDC), it naturally captures every change including deletes in the exact order they happened, and it's resilient — if the CDC reader falls behind or restarts, it can resume from its last known position in the log. Tools like Debezium are built specifically to tail these logs and turn them into a stream of change events, typically published onto a message broker like Kafka for other systems to consume.

```text
App writes to DB --> DB's transaction log (binlog/WAL)
                            |
                     CDC reader tails the log
                            |
                            v
                    Stream of change events --> search index, cache invalidation,
                                                 data warehouse, other services
```

A closely related pattern worth knowing is the **outbox pattern**, which solves a subtle problem: if your application needs to both update the database *and* publish an event about that change, doing these as two separate operations risks one succeeding and the other failing (a "dual write" problem) — e.g., the database update commits but the event never gets published because the service crashed right after. The outbox pattern fixes this by writing the business data change *and* a row representing the event into the same database transaction, in an "outbox" table. Because it's one transaction, both succeed or both fail together — there's no window where they disagree. A separate process (often CDC, tailing the log for that outbox table) then reads those outbox rows and actually publishes them to the message broker.

CDC shows up in a surprising number of practical scenarios once you know to look for it: keeping a search index (like Elasticsearch) in sync with a primary database without every write path needing to remember to update it, invalidating cache entries the moment underlying data changes rather than relying purely on TTLs, feeding a data warehouse or analytics pipeline continuously instead of via a nightly batch job, and replicating data into another service's database in a microservices architecture without that service directly querying your database (which would violate service boundaries — more on this in the architectural patterns module).

The main things to watch for operationally: the *initial snapshot* (getting the first, complete copy of existing data before you start streaming changes) can be slow and resource-intensive on a large table; *lag* between a change happening and it reaching downstream consumers needs to be monitored, since a growing lag usually signals a downstream consumer struggling to keep up; and log retention matters — if your CDC reader falls behind further than how long the database keeps its transaction log, you can permanently lose your place and need to re-snapshot from scratch.

## 6.5 Summary and how these connect

All three topics in this module exist to answer the same underlying question in different shapes: how do parts of a system learn about things that happened elsewhere, without being tightly coupled in time to the part that caused it? Pub/sub answers this for the "one event, many independent interested parties" shape — think notifications fanning out to several unrelated services. Message queues answer it for the "pile of tasks, pool of workers, each task done exactly once" shape — think background job processing. And CDC answers a more specific version of the question: how do you get events out of a database automatically, as a byproduct of normal writes, without touching application code at all — which often becomes the *source* that feeds into a pub/sub topic or queue in the first place.

In practice these three combine constantly: a database write triggers a CDC event, which gets published onto a pub/sub topic, which one subscriber turns into individual jobs pushed onto a message queue for a worker pool to process. Recognizing which of these three shapes a given problem needs — broadcast, work distribution, or database-change propagation — is one of the most useful instincts you can build for the rest of this course. And when you get to the architectural patterns module next, you'll see that event-driven architecture as a whole style of system design is really just "pub/sub and message queues, used as the primary way services talk to each other, instead of the exception."
