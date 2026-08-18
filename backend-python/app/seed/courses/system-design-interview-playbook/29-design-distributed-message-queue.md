> **Learning goal**
> Design a distributed message queue like Kafka, able to explain partitioning and ordering guarantees, how consumer groups track progress, and how replication keeps messages durable when a broker fails.

## 29.1 Requirements and scope

**Functional requirements**

- Producers publish messages to a named topic.
- Consumers subscribe to a topic and read messages, typically as part of a consumer group that splits the work.
- Messages within a topic can be organized so that related messages (e.g., all events for one user) are processed in the order they were produced.
- Consumers can resume from where they left off after a restart, without reprocessing everything or losing messages.

**Non-functional requirements**

- **Durability.** Once a producer receives an acknowledgment that a message was accepted, it must survive a broker crash — this is the whole reason to use a message queue instead of a direct service-to-service call.
- **High throughput**, both for writes (producers) and reads (many consumers), ideally scaling roughly linearly by adding more machines.
- **Ordering guarantee, but only where it's promised.** Strict global ordering across an entire topic is expensive and rarely needed; ordering *within a partition* (a subset of the topic) is the guarantee that's actually useful and achievable at scale.
- **At-least-once delivery** as the baseline guarantee (a message might be redelivered after a failure, but should never silently vanish); exactly-once semantics are called out as a harder, optional extension.

**Out of scope**

- Exactly-once processing semantics in full detail (mentioned as an extension, not designed here).
- Message queue administration UI/tooling.
- Schema registry / message format evolution.
- Cross-datacenter/geo-replication (this lesson assumes a single cluster in one region).

## 29.2 Scale estimation

Assumptions for a message queue backing a mid-to-large event-driven system:

- 500 producing services, together publishing 2 million messages/sec at peak across all topics combined (this is plausible for a company-wide event bus handling things like clickstream events, order events, and log shipping).
- Average message size: 1 KB.
- Retention: messages kept for 7 days for replay/recovery purposes (a defining feature of a Kafka-like queue vs. a simpler "delete on consume" queue).

**Throughput:**

- Write: 2,000,000 messages/sec × 1 KB ≈ 2 GB/s of incoming data at peak — clearly beyond what a single machine can absorb, which is the foundational argument for partitioning across many brokers from day one, not as a later optimization.
- Read: assume on average each message is read by 3 different consumer groups (e.g., one for real-time processing, one for analytics, one for archival) → 6 GB/s of aggregate read throughput.

**Storage:**

- 2 GB/s × 86,400 sec/day × 7 days retention ≈ 1.2 PB of data held at any time across the cluster. This is a firm requirement that the design store messages on disk (not purely in memory) and spread that storage across many brokers — no single machine holds anywhere near this much fast storage.

**Partition count:** if a single partition (handled by a single broker for writes, at least for its leader) can sustain roughly 10-20 MB/s of write throughput (a reasonable assumption for sequential disk writes plus network overhead), then handling 2 GB/s requires on the order of 100-200 partitions minimum, and topics with especially high volume would need proportionally more. This number directly drives the data model decision in 29.3: partition count is not a minor config value, it's sized from the throughput requirement.

**Read:write ratio:** roughly 3:1 here (each message read by ~3 consumer groups), but unlike the web-application lessons in this course, both sides are enormous in absolute terms — this is a system built entirely around sustained high throughput in both directions, not a read-heavy-with-a-cache pattern.

## 29.3 API and data model

A message queue's "API" is closer to a protocol than a typical REST interface, but it's useful to define the core operations:

| Operation | Purpose | Request | Response |
| --- | --- | --- | --- |
| `produce(topic, key, value)` | Publish a message | topic name, optional partition key, payload | offset assigned, partition |
| `subscribe(topic, consumerGroup)` | Join a consumer group for a topic | topic, group ID | partition assignment |
| `poll(consumerId)` | Fetch the next batch of messages | consumer ID | batch of `{partition, offset, value}` |
| `commitOffset(consumerGroup, partition, offset)` | Record progress | group, partition, offset | ack |

**Core entities:**

- `Topic { name, partitionCount, replicationFactor }`
- `Partition { topicName, partitionId, leaderBrokerId, replicaBrokerIds[] }` — an ordered, append-only log; this is the fundamental storage unit of the whole system.
- `Message { partition, offset, key, value, timestamp }` — offset is a simple monotonically increasing integer *per partition*, not globally unique across the topic; this is what makes the log append cheap (no coordination needed across partitions to assign the next offset).
- `ConsumerGroupOffset { groupId, topic, partition, committedOffset }` — the record of "how far has this group read," described in the deep dive.

**SQL vs. NoSQL, by access pattern:**

Neither a traditional relational database nor a generic key-value store fits this workload well, which is itself an instructive point: the dominant access pattern is **sequential append writes** and **sequential reads from a bookmark forward** (a consumer says "give me everything after offset X"), not random point lookups, not joins, not ad-hoc queries. This is why message queues use a purpose-built storage structure — an append-only, segmented log file per partition, where writes are always at the end (cheap, sequential disk I/O, which is dramatically faster than random writes) and reads are sequential scans starting from a given offset (also cheap, since the OS page cache and sequential disk reads both favor this pattern). `ConsumerGroupOffset`, in contrast, is a small, frequently-updated key-value mapping (group+partition -> offset) with no need for range queries — a simple key-value store (or, in real systems, often the queue itself, treating offset commits as just another special topic) is the right fit for that piece specifically.

## 29.4 High-level architecture

```text
Producers -> Broker Cluster
                Topic "orders" -> [Partition 0 (leader: Broker A, replicas: B, C)]
                                  [Partition 1 (leader: Broker B, replicas: A, C)]
                                  [Partition 2 (leader: Broker C, replicas: A, B)]
                                  ...
             (each partition is an append-only log on disk)

Consumers (Consumer Group "order-processor")
   Consumer 1 -> reads Partition 0
   Consumer 2 -> reads Partition 1
   Consumer 3 -> reads Partition 2
   (each partition read by exactly one consumer within a given group)

Coordination: Metadata Service (tracks partition leaders, consumer group membership, offsets)
```

**Write path:** a producer sends a message to a topic, optionally with a key (e.g., a user ID or order ID). The broker layer routes it to a specific partition — typically by hashing the key, so all messages with the same key always land on the same partition — and the partition's leader broker appends it to its log and replicates it to follower brokers before acknowledging success back to the producer (the durability/replication mechanics are covered in the deep dive). The message is assigned the next sequential offset within that partition.

**Read path:** a consumer, as part of a consumer group, is assigned one or more partitions to read from. It polls the broker for messages starting after its last committed offset, processes them, and periodically commits its new offset back to the queue's tracking mechanism — this commit is what lets the consumer (or a replacement, if it crashes) resume from the right place rather than reprocessing everything or skipping messages.

## 29.5 Deep dive: partitioning and ordering, consumer groups, and replication

This problem's core tension is that a single ordered log would be simple to reason about but cannot scale past one machine's throughput, while splitting into many independent logs (partitions) scales throughput but gives up global ordering — and the entire design of a system like this is about making that trade-off precise and usable rather than pretending it doesn't exist.

### Partitioning and ordering guarantees

A topic is split into N partitions, each an independent, ordered, append-only log with its own offset sequence. Within one partition, order is absolute: message offset 5 was written before offset 6, always, and consumers reading that partition see them in that order. Across partitions, there is no ordering guarantee at all — partition 0's offset 100 and partition 1's offset 50 have no defined relationship in time.

This is a deliberate, not accidental, design choice: it converts "keep a strict order for absolutely everything" (which forces all writes through one bottleneck) into "keep a strict order for everything that needs to be ordered relative to each other" (which can be parallelized freely). The mechanism that makes this useful rather than just a limitation is **key-based partitioning**: a producer includes a key (e.g., `orderId` or `userId`) with each message, and the broker layer hashes that key to consistently pick the same partition for every message sharing that key. The practical effect: all events for order #12345 always land on the same partition, in the order they were produced, so a consumer processing that partition sees a correctly ordered stream of that order's events — while a completely unrelated order #67890's events, landing on a different partition, are processed fully in parallel with no coordination needed between the two. Choosing a good partition key is one of the most consequential decisions when using a system like this: too few distinct key values (or one dominant "hot" key) concentrates load on a small number of partitions, which is exactly the hot-spot problem discussed in 29.6.

### Consumer groups and offset tracking

A **consumer group** is a set of consumers that cooperatively read a topic, with the queue guaranteeing that each partition is consumed by exactly one consumer within a given group at a time — this is what turns "many partitions" into "parallel processing" from the consumer side: with 12 partitions and 4 consumers in a group, each consumer is assigned 3 partitions, and adding more consumers (up to one per partition) increases parallelism without any code change, just a rebalance of partition assignments.

Multiple independent consumer groups can read the *same* topic without interfering with each other at all, because each group tracks its own offset per partition — this is what lets, for example, a real-time fraud-detection service and a nightly analytics batch job both consume the exact same order-events topic independently, each at their own pace, each with their own "how far have I read" bookmark.

Offset tracking itself needs the same durability guarantees as the messages: if a consumer commits its offset (e.g., "I've fully processed up through offset 500 on partition 2") and then crashes, a replacement consumer taking over that partition resumes from offset 501, not from the beginning and not from wherever the old consumer happened to stop mid-batch. The two common commit strategies represent a direct trade-off: **commit before processing** (fewer duplicate-processing risks... actually the opposite — committing before processing risks losing a message if the consumer crashes mid-processing, since the offset already says "done" for a message that wasn't) versus **commit after processing** (the safer default: if the consumer crashes after processing but before committing, the same message gets redelivered and reprocessed on restart — this is exactly where "at-least-once" delivery comes from, and why consumers should generally be written to be idempotent, tying back to the idempotency theme that recurs throughout this course).

### Replication for durability

A partition's data can't safely live on only one broker — a single disk or machine failure would permanently lose every message on it, violating the durability requirement outright. Each partition therefore has a **leader** (the broker that handles all reads and writes for that partition) and a configurable number of **follower replicas** on other brokers that continuously copy the leader's log.

The durability/latency trade-off shows up in how "acknowledged" is defined: a producer can ask for acknowledgment as soon as the leader has written the message locally (fast, but a leader crash before followers catch up could lose that message), or it can wait until a minimum number of replicas (e.g., a majority) have confirmed they've also written it (slower per message, but a message is only ever acknowledged once it's durable against a single broker failure). Most systems make this configurable per-producer or per-topic, because not all data deserves the same trade-off — a critical financial event justifies waiting for full replication acknowledgment, while a high-volume, loss-tolerant metrics stream might accept leader-only acknowledgment for lower latency and higher throughput.

If a leader broker fails, one of its in-sync followers (a replica that was fully caught up at the time of failure) is promoted to leader, and producers/consumers are redirected to it — this is why the metadata/coordination layer (tracking which broker currently leads which partition) is itself a critical piece of the system, separate from the brokers holding the actual message data.

## 29.6 Bottlenecks and trade-offs

- **Single points of failure.** An individual partition's leader is a point of failure for that partition specifically (mitigated by replica promotion as above); the metadata/coordination service that tracks leadership and group membership is a system-wide point of failure if it isn't itself made highly available (typically via its own consensus-based replication, since incorrect leadership information could cause split-brain writes).
- **Hot spots.** A poorly chosen partition key (e.g., partitioning by a boolean flag, or by a single dominant customer ID that accounts for a large fraction of traffic) concentrates writes and reads onto one partition, capping the system's effective throughput at that one partition's single-broker limit regardless of how many total brokers exist. This is the single most common real-world tuning problem with systems like this, and the fix is almost always a better choice of key (more distinct, more evenly distributed values) rather than more infrastructure.
- **Consistency vs. availability.** The replication acknowledgment setting is a direct, explicit dial on this trade-off: wait-for-majority favors consistency/durability at the cost of write latency and availability during a partial outage (if not enough replicas are reachable, writes may stall); leader-only acknowledgment favors availability and latency at the cost of a small durability window. Stating which one a given topic uses, and why, is exactly the kind of trade-off articulation this course's framework is built around.
- **What breaks first at 10x/100x scale:** at 10x, individual hot partitions (from imperfect key distribution) become the first constraint even if total cluster capacity is nowhere near exhausted — this pushes toward re-partitioning topics with more partitions and re-examining key choices. At 100x, the metadata/coordination layer itself (tracking potentially tens of thousands of partitions across a large cluster) becomes a scaling concern, along with the operational cost of rebalancing partition assignments across a much larger, more frequently changing set of brokers and consumers.

## 29.7 Summary

A distributed message queue scales past a single machine by splitting each topic into independent, ordered partitions — trading a strict global order (expensive, hard to scale) for a strict per-partition order (cheap, fully parallelizable), made useful via key-based partitioning that keeps related messages together. Consumer groups let many consumers split partition ownership for parallel processing, with per-group offset tracking making each group's progress independent of every other group reading the same topic. Replication (leader plus follower replicas, with a configurable acknowledgment threshold) is what makes "message accepted" actually mean "message durable," at an explicit, tunable cost in write latency.

Natural follow-ups: how would you implement exactly-once processing on top of an at-least-once foundation (typically via idempotent consumers keyed on message ID, or transactional writes that tie offset commits to output writes), and how would you handle a topic whose traffic grows so much that its original partition count is no longer enough (repartitioning an existing topic is disruptive because it changes which partition a given key hashes to, breaking the "same key, same partition" guarantee for existing data).
