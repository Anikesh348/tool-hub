> **Learning goal**
> Design a distributed key-value store, and be able to explain how consistent hashing partitions data across nodes, how replication provides fault tolerance, and how quorum reads/writes (N/W/R) let you tune the consistency/availability trade-off.

## 8.1 Requirements and scope

**Functional requirements**

- `PUT(key, value)` — store or update a value for a key.
- `GET(key)` — retrieve the current value for a key.
- `DELETE(key)` — remove a key.
- The store must keep working (accepting reads and writes) even when some nodes are down or unreachable.

**Non-functional requirements**

- **Horizontal scalability**: the dataset and request load must be spreadable across many commodity machines, since a single node cannot hold or serve an internet-scale key space.
- **High availability, tunable consistency**: this is explicitly not a system that needs strict ACID transactions across keys — it needs to keep accepting reads and writes even during network partitions or node failures, and it should let the operator choose how strongly consistent reads need to be, trading off against availability and latency.
- **Fault tolerance**: losing a single node (disk failure, machine crash) must not lose data or take the system down — this requires replication.
- **Low, predictable latency**: point reads and writes should complete in single-digit milliseconds under normal operation.

**Out of scope**: complex queries (range scans, secondary indexes, joins), multi-key transactions, and a query language — this is a pure key-value interface, not a general-purpose database.

## 8.2 Scale estimation

- **Data volume**: assume 1 billion keys, each with an average value size of 1 KB → **~1 TB of raw data**. With 3x replication (a common default for fault tolerance, justified below), total stored data is **~3 TB**.
- **Node capacity**: if each node comfortably manages 500 GB of data (leaving headroom for compaction, growth, and operational overhead), storing 3 TB of replicated data requires roughly **6 nodes** at minimum just for capacity — in practice more nodes are used to spread load and improve fault tolerance, but this confirms the dataset genuinely requires multiple machines, not just one big one.
- **Request rate**: assume 50,000 reads/sec and 10,000 writes/sec at peak, a roughly 5:1 read:write ratio typical of many key-value workloads. Spread evenly across, say, 20 nodes (chosen for headroom beyond the capacity-driven minimum of 6), that's about 2,500 reads/sec and 500 writes/sec per node — well within what a single well-tuned node can handle, confirming that horizontal partitioning (not per-node optimization) is what makes this scale.
- **Replication overhead**: with a replication factor of 3, every write physically happens on 3 nodes, so the 10,000 writes/sec of *logical* traffic becomes 30,000 *physical* write operations/sec distributed across the cluster — a number worth stating explicitly since it's easy to undercount replication's effect on real write load.

The takeaway: both data volume and request rate individually justify a multi-node cluster, and replication (for fault tolerance) multiplies the physical write cost — which is exactly why the partitioning and replication strategy (8.5) is the central design decision, not an afterthought.

## 8.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `PUT /kv/{key}` | `{ "value": "...", "consistencyLevel": "quorum" }` | `200 OK` |
| `GET /kv/{key}?consistencyLevel=quorum` | — | `{ "value": "...", "version": "..." }` |
| `DELETE /kv/{key}` | — | `200 OK` (often implemented as a "tombstone" write, see 8.6) |

Exposing `consistencyLevel` as a per-request option is a deliberate design choice, not an implementation detail — it lets callers decide, request by request, whether they need strong consistency (worth extra latency) or can accept eventual consistency (worth lower latency and higher availability), which is the central trade-off this whole system is built around.

**Data model**

There is really only one entity: `(key, value, version/timestamp)`. This is the simplest possible data model — no relationships, no schema on the value (it's often treated as an opaque blob), and exactly one access pattern: exact-match lookup by key. This access pattern is the textbook justification for choosing a key-value/NoSQL data model over a relational one: there are no joins, no need for ad-hoc querying by non-key fields, and no multi-record transactions required by the functional requirements — every one of those absent needs is specifically what a relational database would otherwise be justifying its cost for. Internally, each value is typically stored with a version number or vector clock alongside it (not just the raw value) — this metadata is what lets replicas detect and reconcile conflicting writes, covered in the deep dive.

## 8.4 High-level architecture

```text
Client
  -> Coordinator node (any node in the cluster can act as coordinator for a request)
       -> uses consistent hashing to determine which nodes own this key
       -> Node A (replica 1) -----\
       -> Node B (replica 2) ------> writes/reads sent to N replicas, waits for W/R acks
       -> Node C (replica 3) -----/
```

**Write path**: a client sends a `PUT` to any node in the cluster (that node acts as the "coordinator" for this request — there's no special leader node in this leaderless-style design). The coordinator hashes the key to determine which nodes are responsible for it (8.5), forwards the write to all N replica nodes, and waits for at least W of them to acknowledge before returning success to the client, where W is the configured write-quorum size.

**Read path**: similarly, the coordinator forwards a `GET` to the replica nodes for that key and waits for at least R responses (the read-quorum size), then reconciles them if they disagree (using version numbers to determine which is most recent) before returning the result to the client.

This "any node can coordinate, requests fan out to replicas, quorum determines success" pattern is what gives the system both horizontal scalability (partitioning spreads data and load) and tunable fault tolerance (no single node's failure blocks any operation, as long as enough replicas remain reachable).

## 8.5 Deep dive: consistent hashing, replication, and quorum reads/writes

**Consistent hashing for partitioning.** With many nodes and a huge key space, the system needs a way to decide which node(s) own which keys — and that mapping needs to change minimally when nodes are added or removed (otherwise every node addition would require re-shuffling most of the data, which is prohibitively expensive at terabyte scale). Consistent hashing solves this: imagine a ring of hash values from 0 to some large maximum, with each node assigned one or more positions on that ring (using a hash of the node's ID). A key is assigned to whichever node's position is the next one clockwise from the key's own hash position. When a node is added, it only takes over a portion of the ring from its immediate neighbor — most keys' ownership is unaffected. When a node is removed, only its portion of the ring needs to be picked up by its neighbor. This is a dramatic improvement over naive hashing (`hash(key) % numNodes`), where changing the number of nodes reshuffles nearly the entire key space.

In practice, each physical node is given many positions on the ring ("virtual nodes," often 100-200 per physical node) rather than just one. This solves two problems at once: it smooths out load distribution (a single unlucky hash position no longer means one node owns a disproportionate arc of the ring), and it means that when a node fails or is added, the resulting data movement is spread across many other nodes roughly evenly, rather than dumping all of it onto one unlucky neighbor.

**Replication.** For fault tolerance, each key is stored not just on the one node its hash lands on, but on that node and the next N-1 nodes walking clockwise around the ring (a common choice is N=3). This means losing any single node still leaves the data available on the other N-1 replicas, and losing two nodes simultaneously (a much rarer event) is required before any data becomes fully unavailable. Replication is also what enables the coordinator to serve reads/writes from whichever replicas are currently reachable, rather than requiring one specific node to be up.

**Quorum reads/writes (N/W/R).** Given a replication factor N, the system doesn't need to wait for *all* N replicas to acknowledge every write, nor does it need to read from all N to get a correct answer — it needs enough overlap between the write set and the read set to guarantee a read sees the latest write. This is expressed as three tunable numbers:

- **N** — number of replicas each key is stored on.
- **W** — number of replicas that must acknowledge a write before it's considered successful.
- **R** — number of replicas that must respond to a read before returning a result.

The key correctness rule is **W + R > N**: if this holds, any read quorum and any write quorum are guaranteed to overlap on at least one replica, so a read is mathematically guaranteed to see at least one copy of the most recent successful write. With N=3, a common configuration is W=2, R=2 (2+2 > 3) — this tolerates one node being down for both reads and writes while still guaranteeing strong (read-your-writes) consistency, and is a frequently used balanced default. Other configurations trade differently:

| Configuration | Behavior | Best fit |
| --- | --- | --- |
| W=1, R=1 (N=3) | Fastest, most available; no overlap guarantee — stale reads possible | Workloads that tolerate eventual consistency (e.g., caching, analytics counters) |
| W=N, R=1 | Every write must reach all replicas (slow writes, fast reads) | Read-heavy workloads where writes are rare |
| W=1, R=N | Fast writes, but every read checks all replicas (slow reads) | Write-heavy workloads where reads are rare |
| W=2, R=2 (N=3) | Balanced; guarantees overlap, tolerates one node down | General-purpose default |

When replicas disagree (e.g., because a node was briefly partitioned and missed a write), the coordinator reconciles using version numbers or vector clocks attached to each value, returning the most recent version to the client and often triggering a background "read repair" that pushes the correct value to the stale replica — this is what keeps replicas converging toward consistency over time even under W/R settings that don't strictly guarantee it on every single read.

## 8.6 Bottlenecks and trade-offs

- **Single points of failure**: because this is a leaderless, peer-to-peer design (any node can coordinate, no single node owns metadata), there is no single point of failure by construction — this is one of the main reasons this architecture is chosen for high-availability key-value stores over a single-primary design.
- **Hot spots**: a small number of extremely popular keys can still overload the handful of nodes that own them, even with virtual nodes smoothing out *average* load — mitigated by detecting hot keys and giving them extra replicas beyond the standard N, or by adding a caching layer in front of the store for the hottest keys (the subject of the next lesson).
- **Consistency vs. availability**: this is explicitly a tunable trade-off in this design via N/W/R, rather than a fixed decision — the system can be configured toward strong consistency (higher W+R, at the cost of latency and reduced fault tolerance for partial failures) or toward higher availability and lower latency (lower W/R, accepting eventual consistency and possible stale reads).
- **What breaks first at 10x/100x scale**: at 10x data volume, adding more nodes to the ring handles it gracefully because of how consistent hashing minimizes data movement on membership changes. At 100x, the practical challenge shifts from "can it hold the data" (still solvable by adding nodes) to operational concerns: coordinating replication traffic during large-scale node additions/removals (rebalancing many terabytes takes real time and bandwidth), and metadata/gossip overhead of a much larger cluster tracking membership — this is where designs typically add more sophisticated cluster-membership protocols (e.g., gossip-based failure detection) rather than changing the core hashing/replication/quorum model.

## 8.7 Summary

A distributed key-value store's design centers on three ideas that work together: consistent hashing to partition data across nodes with minimal disruption as the cluster changes, replication across N nodes for fault tolerance, and tunable quorum reads/writes (with the W + R > N rule) to let the system dial between strong consistency and high availability per the workload's actual needs, rather than picking one point on that spectrum globally.

Natural follow-ups: adding a coordination-free conflict resolution strategy for concurrent writes to the same key (e.g., CRDTs, for workloads where "last write wins" isn't good enough), and layering a caching tier in front of the store for hot keys — which is exactly the subject of the next lesson.
