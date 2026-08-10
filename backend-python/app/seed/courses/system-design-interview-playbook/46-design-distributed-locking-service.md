> **Learning goal**
> Design a distributed locking service like ZooKeeper or etcd-based locks, and be able to explain — at a conceptual level — why consensus algorithms like Paxos/Raft are the basis for the service's correctness, and how leases and fencing tokens prevent split-brain when a lock holder fails or stalls.

## 46.1 Requirements and scope

**Functional requirements**

- A client can acquire an exclusive lock on a named resource, do its work, and release the lock.
- If the current lock holder crashes or becomes unreachable, the lock is eventually released so another client can acquire it — without requiring manual intervention.
- Clients can watch a lock (or a more general key) for changes and be notified when it's released or its value changes.
- The service supports storing small amounts of coordination metadata (configuration values, leader-election state) beyond just locks — locks are really a specific pattern built on top of a more general small, strongly-consistent key-value store.

**Non-functional requirements**

- **Correctness above all else**: this is the load-bearing requirement of the entire system. A distributed lock that can, even rarely, be held by two clients simultaneously (split-brain) is worse than useless — it actively creates the exact bugs (concurrent unsafe access to a shared resource) that the lock exists to prevent. Every other requirement is secondary to this one.
- **Consistency over availability**: unlike almost every other system in this course, this service must choose consistency (CP, in CAP-theorem terms) over availability when the two conflict — it is strictly better for the lock service to become unavailable (refuse to grant any lock) than to risk granting the same lock to two clients during a network partition.
- **Small data, small scale, high reliability**: this system stores a small amount of data (locks, config values — kilobytes to megabytes total, not the exabyte-scale datasets seen elsewhere in this course) but needs extremely high reliability, since many other systems depend on it for correctness.
- **Bounded failure recovery time**: when a lock holder fails, the system needs to detect this and release the lock within a bounded, reasonably short time window — an unbounded "we're not sure if the holder is still alive" state blocks all other clients indefinitely.

**Out of scope**: general-purpose distributed transactions across arbitrary services, large-value storage (this service is explicitly not a general-purpose database), the client-side retry/backoff libraries that typically wrap lock acquisition calls.

## 46.2 Scale estimation

Stated, round assumptions — deliberately different in shape from every other lesson in this course:

- **Cluster size**: a distributed lock/coordination service is almost always run as a small cluster — commonly 5 or 7 nodes (an odd number, for reasons covered in Section 46.5) — not thousands of horizontally-scaled instances. This is a deliberate, structural property of consensus-based systems, not an oversight: the whole mechanism that provides correctness (Section 46.5) requires every node to participate in agreement on every write, so adding more nodes does not add write throughput the way adding shards does in most other systems in this course — it can even reduce it, since more participants means more round trips to reach agreement.
- **Request rate**: assume a client base of a few thousand services using the lock service for coordination (leader election, distributed locks around critical sections, configuration watches), each performing lock operations relatively infrequently — say, on the order of a few operations per second across the whole client base at typical load, and perhaps a few thousand operations/sec during a large-scale coordinated event (e.g., many services simultaneously re-electing leaders after a regional failover). This is orders of magnitude below the throughput figures elsewhere in this course, and that's expected and correct — this service is not built for high throughput, it's built for correctness under contention and failure.
- **Data volume**: the total data stored (lock names, small config values, ephemeral session metadata) is typically megabytes to low gigabytes even for a large deployment — small enough to be replicated in full on every node in the cluster, which is in fact exactly what happens (Section 46.5) and is only feasible because the data volume is kept intentionally small.
- **Watch/notification fan-out**: a single lock or config key can be watched by many clients (e.g., hundreds of service instances all watching for a leader-election result) — so while write throughput is low, read/watch fan-out for a popular key can be significant, and needs to be served efficiently without funneling every watcher through the same expensive consensus path that writes require.

The dominant insight: this system deliberately trades away the horizontal write scalability that defines almost every other system in this course, in exchange for the one property that actually matters for its purpose — a small number of nodes agreeing, with mathematical certainty, on a single, consistent view of a small amount of critical coordination state, even while individual nodes fail.

## 46.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /locks/{name}/acquire` | `{ "clientId", "leaseDurationMs" }` | `{ "acquired": true, "fencingToken": N }` or `{ "acquired": false }` |
| `POST /locks/{name}/renew` | `{ "clientId", "leaseId" }` | `{ "renewed": true }` or `{ "renewed": false }` (lease already expired/lost) |
| `POST /locks/{name}/release` | `{ "clientId", "leaseId" }` | `204 No Content` |
| `GET /keys/{key}` | — | `{ "value", "version" }` |
| `PUT /keys/{key}` | `{ "value", "expectedVersion" }` (conditional write) | `200 OK` or `409 Conflict` |
| `WATCH /keys/{key}` (long-lived) | — | Stream of `{ "value", "version" }` on every change |

`acquire` returns a **fencing token** — a monotonically increasing number — alongside success, which is central to correctness and covered in depth in Section 46.5. `PUT` supports an optional conditional write (`expectedVersion`) so a client can implement "update this value only if it hasn't changed since I last read it" — the same optimistic-concurrency pattern seen in several earlier lessons in this course, here elevated to a first-class, general-purpose primitive rather than an application-specific trick.

**Data model**

The entire dataset is conceptually a single, small, hierarchical or flat key-value namespace: `Key { path, value, version, ephemeralOwner (nullable), leaseExpiry (nullable) }`. Locks are modeled as a special case of this general key-value store — acquiring a lock is really just a conditional write (create a key only if it doesn't already exist, or claim ownership of an existing key only if its current lease has expired), and the lock's "release" is just a delete or an expiry of that key.

There is no meaningful SQL-vs-NoSQL debate to have here in the usual sense, because neither category fits: the requirement isn't "efficient queries over a large dataset" (the defining question that usually drives that choice) — it's "an extremely small dataset, replicated identically and consistently across every node in a small cluster, with every write agreed upon by a majority before it's considered committed." This is closer to a **replicated state machine** than either a relational database or a typical NoSQL store: every node maintains an identical copy of the full key-value namespace, and consensus (Section 46.5) is precisely the mechanism that keeps those copies identical despite concurrent writes and node failures. This is a useful thing to say explicitly in an interview — recognizing when a problem's shape doesn't fit the usual SQL/NoSQL framing at all is itself a sign of understanding the problem, not a gap.

## 46.4 High-level architecture

```text
Client
  -> (any node in the cluster, but writes are forwarded to the current leader)
       Node 1 (may be leader)  <-\
       Node 2                    | consensus protocol (Raft/Paxos):
       Node 3                    | leader replicates every write to a majority
       Node 4                    | before it's considered committed
       Node 5                  <-/
            |
            v
     Every node: identical, fully replicated key-value state machine
```

**Write path (e.g., acquiring a lock)**: a client's request is routed to (or automatically forwarded to, if it landed on a non-leader node) the cluster's current leader — a single node elected by the consensus protocol to sequence all writes (Section 46.5 explains why a single leader, and how one is chosen and replaced). The leader proposes the write to the rest of the cluster; only once a **majority** of nodes have durably acknowledged it is the write considered committed, at which point the leader applies it to its own state machine and responds to the client, and the other nodes apply the same committed write to their own replicas shortly after. This majority-acknowledgment requirement — not "all nodes," specifically a majority — is the crux of how the system tolerates node failures without sacrificing correctness, detailed in Section 46.5.

**Read path**: reads can often be served by any node without going through the full write-consensus path (since the data is small and identically replicated), though a client requiring the absolute latest committed value (rather than a value that might be a few writes behind an in-progress round) typically reads from the leader, or via a mechanism that confirms the responding node is still current before answering — the exact guarantee offered (strictly latest vs. "recent enough") is a real, explicit consistency-vs-latency choice this system's API surface typically exposes rather than hides.

**Watch path**: a client registers a long-lived watch on a key; when that key's committed value changes, the responsible node pushes a notification to every registered watcher — this fans out from the small set of writes to a potentially much larger set of watching clients, but importantly this fan-out happens *after* a write is already committed, so it doesn't add load to the consensus path itself.

## 46.5 Deep dive: consensus as the basis for correctness, and handling lock-holder failure

### Why this needs consensus at all

The fundamental problem a distributed lock service solves is getting multiple independent nodes (which can fail, be slow, or be temporarily cut off from each other by a network partition) to agree on a single, unambiguous answer to "who currently holds this lock" — even though any individual node's view of the world could, at any moment, be stale, wrong, or simply unreachable from some clients. If the service were just a single node holding lock state in memory, it would be trivially correct but would also be a single point of failure that defeats the whole purpose of building a *reliable* coordination service — so the design needs multiple nodes for fault tolerance, but multiple independent nodes each unilaterally deciding "yes, you have the lock" is exactly how split-brain (two clients both believing they hold the same lock) happens.

Consensus algorithms — Paxos and its more explicitly-designed-for-understandability successor Raft are the two most commonly referenced — solve this specific problem: getting a cluster of nodes, some of which may fail or be temporarily partitioned from the rest, to agree on a single, ordered sequence of operations (a replicated log), such that every node that applies the log ends up with an identical final state, and critically, such that this agreement is achieved correctly even if some nodes are down or slow, as long as a **majority** of the cluster is up and able to communicate.

### The majority-quorum mechanism, conceptually

The mechanism that makes this work, at a conceptual level (without diving into the full algorithmic proof, which is genuinely intricate and not something to attempt to derive from scratch in an interview): a write is only considered committed once it has been acknowledged by a **majority** of the cluster's nodes (for a 5-node cluster, that's 3 nodes; for a 7-node cluster, 4 nodes). This single requirement is what provides the core safety guarantee: because any two majorities out of the same cluster must overlap by at least one node (a basic property of majorities — you cannot have two disjoint majority subsets of the same set), any new decision being made is guaranteed to involve at least one node that participated in and knows about the previous decision, which is what prevents the cluster from ever "forgetting" a committed write or accepting two conflicting decisions as both final. This is precisely why cluster sizes are typically odd numbers (5 or 7, as noted in Stage 2) — an odd size maximizes fault tolerance per node added (a 5-node cluster tolerates 2 failures with a majority of 3; a 6-node cluster still only tolerates 2 failures, needing a majority of 4, while paying for an extra node with no added fault tolerance).

**Leader election.** Rather than every node independently trying to propose writes (which would create constant conflict), the protocol elects a single leader responsible for sequencing all writes at any given time — clients send writes to the leader, which replicates them to the rest of the cluster and only confirms success once a majority has acknowledged. If the leader fails or becomes unreachable, the remaining nodes detect this (typically via a timeout on expected heartbeat messages from the leader) and hold a new election among themselves, again requiring a majority to agree on the new leader — the same majority-overlap property ensures the newly elected leader's view of the committed log is consistent with what the old leader had already committed, so no already-committed write is ever lost or contradicted by the leadership change.

**Why this matters for lock correctness specifically**: because every lock acquisition is, underneath, just a write to the replicated key-value state machine, and every write goes through this majority-agreement process, two clients racing to acquire the same lock will have their conditional-write requests serialized through the same leader and the same consensus log — exactly one of them can be the write that successfully creates/claims the lock key, and the other's conditional write will correctly fail (since the key's state changed under it), the same conditional-write correctness pattern seen throughout this course, but here backed by a cluster-wide, fault-tolerant agreement mechanism rather than a single database's local transaction guarantee.

### Handling lock-holder failure: leases and fencing tokens

Consensus solves "how do multiple lock-service nodes agree on who holds the lock" — but there's a separate, equally important problem: **what happens when the client holding the lock crashes, stalls, or gets disconnected while still supposedly holding it?** Without a mechanism to handle this, a crashed client would hold the lock forever, permanently blocking every other client — clearly unacceptable given the bounded-recovery-time requirement from Stage 1.

**Leases.** Rather than a lock being held indefinitely until an explicit release, a lock acquisition is granted for a bounded time window (a lease, e.g., 10 seconds), and the holding client is responsible for periodically renewing it (the `renew` endpoint from Section 46.3) before it expires, as a heartbeat proving it's still alive and still wants the lock. If the client crashes or gets disconnected, it simply stops renewing, and once the lease expires, the lock service considers the lock free and allows another client to acquire it — this bounds the maximum time any single failure can block progress to roughly the lease duration, directly satisfying the bounded-recovery-time requirement.

**The subtle danger leases alone don't solve: a "zombie" holder.** Leases handle the case of a genuinely crashed client cleanly, but there's a nastier scenario: a client that holds the lock, experiences a long pause (a garbage-collection stall, a slow network, being descheduled by its OS for an extended period) that causes it to miss its renewal window, has its lease expire and the lock granted to a second client — and then the *first* client "wakes back up," still believing it holds the lock (it never received or processed the expiry), and proceeds to act on the shared resource, completely unaware that a second client now legitimately holds the same lock. This is a real, well-known failure mode, and it's the reason a lease alone is not a sufficient guarantee — the shared resource itself also needs to be able to reject a stale client's actions, not just the lock service.

**Fencing tokens.** The fix: every successful lock acquisition returns a **monotonically increasing token** (the `fencingToken` in Section 46.3's API) — each new acquisition of a given lock gets a strictly higher number than every previous acquisition of that same lock, guaranteed by the same consensus-backed, strictly-ordered replicated log that handles every other write. Clients are then required to present this token whenever they act on the actual shared resource being protected (not just when talking to the lock service itself) — and the shared resource (e.g., a storage system, a downstream service) is responsible for rejecting any request that presents a token lower than the highest token it has already seen. In the zombie scenario above: the first client's stale actions carry its old, now-superseded fencing token; once the second client (holding a higher token) has interacted with the shared resource even once, any subsequent request from the first client bearing the older token is rejected outright by the resource itself, regardless of what the first client mistakenly believes about its own lock status.

This is the crucial, easy-to-miss insight: **the lock service alone cannot fully prevent split-brain on its own — it needs the cooperation of the resource being protected**, which must itself enforce the fencing-token ordering. A lock service that hands out leases but whose tokens are never actually checked by the protected resource offers only a probabilistic, best-effort safety guarantee (very likely fine in practice, given how rare extreme pauses are, but not a hard guarantee) — the fencing token is what converts that probabilistic safety into a real, enforced one.

| Mechanism | Problem it solves | What it does NOT solve alone |
| --- | --- | --- |
| Consensus (majority quorum) | Multiple lock-service nodes agreeing on lock state despite node failures | A crashed/stalled *client* holding the lock forever |
| Leases | Bounding how long a failed client can block others | A "zombie" client waking up after its lease expired and acting anyway |
| Fencing tokens | A stale, zombie client's actions being rejected by the protected resource itself | Nothing on its own — it's a guarantee that must be checked *by the resource*, not just held by the client |

## 46.6 Bottlenecks and trade-offs

- **Single points of failure**: the elected leader is a temporary single point of coordination for writes — but unlike most SPOFs in this course, this one is handled by design, not as an afterthought: leader failure triggers automatic re-election among the remaining majority, and because commits require majority acknowledgment before being confirmed, no committed data is lost in the transition. The system as a whole is only unavailable for writes if a majority of nodes are simultaneously down or partitioned from each other — an explicit, accepted trade given the consistency-over-availability requirement from Stage 1.
- **Hot spots**: a single extremely popular lock or config key (watched by, say, thousands of service instances during a coordinated event) can create a large notification fan-out from one node — mitigated by serving watch notifications as a separate concern from the write/consensus path (Section 46.4), so a popular key's fan-out load doesn't slow down unrelated writes elsewhere in the namespace.
- **Consistency vs. availability**: this is the one lesson in this course where the answer is unambiguous and stated upfront — the system deliberately chooses consistency over availability, because for its specific purpose (coordinating access to prevent unsafe concurrent behavior elsewhere), an unavailable-but-correct lock service is vastly preferable to an available-but-occasionally-wrong one. This is worth explicitly contrasting with nearly every other lesson in this course, most of which lean the opposite way, to demonstrate the trade-off is a deliberate choice tied to the specific problem, not a universal default.
- **What breaks first at 10x/100x scale**: unlike every other system in this course, this system is not designed to scale write throughput by adding more nodes — quite the opposite, more nodes in the consensus cluster generally means more round-trip overhead per write, not more capacity. At meaningfully higher load (10x-100x more coordination traffic across an organization), the correct scaling response is not "add more nodes to this cluster" but "run multiple independent lock-service clusters, each responsible for a different namespace/domain of locks" — since there's rarely a need for a lock in one unrelated part of a system to be coordinated through the exact same consensus group as a lock in a completely different part, this kind of service typically scales by partitioning responsibility across independent clusters, not by growing any single cluster.

## 46.7 Summary

A distributed locking service's entire value proposition rests on correctness under failure, which is why it deliberately trades away the horizontal write-scalability that defines most systems in this course in exchange for consensus (Paxos/Raft) — a majority-quorum-based agreement mechanism that lets a small cluster tolerate node failures without ever risking two conflicting decisions being treated as both final. Leases bound how long a failed lock holder can block others, but leases alone don't prevent a "zombie" client from acting after its lease has silently expired — that requires fencing tokens, monotonically increasing values checked not just by the lock service but by the protected resource itself, which is the detail most often missed in a first-pass design of this system.

Natural follow-ups an interviewer might raise: extending this same primitive to implement distributed leader election for other systems (which is, underneath, the exact same "acquire a lock, hold it with a lease, lose it gracefully" pattern applied to "who is the active leader" rather than "who holds this named lock"), and read scaling for watch-heavy workloads (serving a very large number of watchers on popular keys without funneling all of them through nodes also handling the write-consensus path).
