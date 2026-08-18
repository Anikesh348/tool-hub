> **Learning goal**
> Understand the core mechanisms databases use to stay correct, fast, and available as data and traffic grow — transactions, indexing, replication, sharding, and the different database types — so later lessons can reason about data-layer trade-offs instead of treating "the database" as a black box.

## 4.1 Overview

If the previous module was about how a request travels between client and server, this module is about what happens once that request needs to touch data that must survive, stay correct, and be found again quickly — often while a thousand other requests are doing the same thing at the same moment. Every database design decision in this module traces back to one tension: a single machine is fast and simple to reason about, but it eventually runs out of CPU, memory, disk, or all three, and it's also a single point of failure. The topics here fall into three natural groups: how a single database stays correct under concurrent use (ACID transactions), how to make it fast to read from (indexes, bloom filters), and how to make it survive growth and failure (replication, sharding, scaling strategies, and the different specialized database types built for different shapes of that problem). By the end, you should be able to explain not just *that* a system "uses a database," but which kind, why, and what it gives up to get there.

## 4.2 ACID Transactions

A transaction is a group of database operations that must succeed or fail together, as a single unit. ACID is the set of four guarantees — Atomicity, Consistency, Isolation, Durability — that well-behaved transactions provide, and together they're what let you trust a database with things that must never end up half-done, like moving money between two bank accounts.

Take that exact example: transferring $100 from Account A to Account B requires two writes — subtract $100 from A, add $100 to B. If the database crashes after the first write but before the second, and there were no transaction guarantees, $100 would simply vanish. A transaction wraps both writes so that either both happen or neither does.

**Atomicity** is that all-or-nothing property directly: every operation inside the transaction takes effect, or none of them do. There's no state where A lost money and B never got it.

**Consistency** means a completed transaction leaves the database obeying its defined rules — data types match, foreign keys point to real rows, uniqueness constraints hold, custom check constraints pass. It's worth noting this is a narrower guarantee than it sounds: the database can enforce "account balance is a non-negative number" if you tell it to, but it cannot know on its own that "the sum of all account balances at a bank should never change during an internal transfer" unless that logic is built into the transaction itself. Consistency here means constraint-consistency, not automatic business-logic correctness.

**Isolation** governs what concurrent transactions can see of each other while both are mid-flight. Imagine two transfers touching Account A at the same instant — without isolation, one transaction might read a balance the other hasn't finished updating yet, leading to a lost update. Databases offer several isolation levels (read uncommitted, read committed, repeatable read, serializable) that trade strictness for performance: stricter isolation prevents more anomalies but forces more transactions to wait on each other or retry.

**Durability** guarantees that once a transaction is confirmed as committed, it survives a crash immediately afterward — even if the power goes out one millisecond later. Databases typically achieve this with a write-ahead log: the intended change is written to a durable log *before* the transaction is acknowledged as successful, so on restart the database can replay the log and recover any change that was committed but not yet reflected in the main data files.

```text
BEGIN TRANSACTION
  A.balance -= 100
  B.balance += 100
COMMIT
  -> both writes durable, or neither happened at all
```

The practical gotcha: ACID protects the database's internal integrity, not the real world outside it. If step two of a transaction sends a confirmation email, and the transaction later rolls back, the email doesn't un-send. Keep transactions short and focused on data that the database itself can roll back, and keep external side effects (emails, third-party API calls) outside the transaction boundary, usually triggered only after a successful commit.

## 4.3 SQL vs NoSQL

This is usually the single most consequential early decision in a database design, and the honest answer to "which one" is almost always "it depends on your access pattern" rather than one being universally better.

SQL (relational) databases store data in tables with a fixed schema — defined columns, defined types — and relationships between tables are expressed through foreign keys. Because the schema is enforced by the database itself, malformed data is rejected before it's ever stored, and the database can efficiently support arbitrary queries that join multiple tables together (e.g., "give me every order, with the customer's name and the product's price, placed in the last 30 days").

NoSQL is an umbrella term for several different data models, each optimized for a specific access pattern rather than for general-purpose querying:

| Type | Shape | Good fit for |
| --- | --- | --- |
| Key-value | key -> opaque value | Simple lookups by ID, session storage, caching |
| Document | key -> flexible JSON-like object | Semi-structured records with varying fields, e.g., product catalogs |
| Wide-column | row key + column groups | Very large, time-oriented or event data at massive scale |
| Graph | nodes + edges | Highly connected data, e.g., social networks, recommendation paths |

The motivating example for choosing NoSQL: a key-value store that only ever needs to answer "given this user ID, return their session data" doesn't need — and shouldn't pay for — the overhead of a general-purpose relational engine capable of complex joins it will never run. It can be radically simpler and faster because it optimizes for exactly one access pattern.

The trade-off that trips people up: NoSQL's flexible schema doesn't mean "no data design needed" — it means the responsibility for keeping records consistent shifts from the database to the application code. And multi-record transactions, which relational databases give you for free, are often limited or entirely absent in NoSQL systems — some support atomic operations only on a single key, others offer transactional guarantees only within a single document or partition.

A simple decision heuristic: if your data is highly relational, your queries are varied and evolve over time, and you need multi-record transactions, lean relational. If your access pattern is narrow, well-known in advance, and needs to scale past what a single relational primary can handle, a NoSQL model built for that exact pattern is often the better fit. This decision connects directly to the next several sections — indexing, sharding, and replication all look different depending on which side of this choice you land on.

## 4.4 Database Indexes

Without an index, finding a row that matches a condition means scanning every single row in the table — fine for a hundred rows, unworkable for a hundred million. A database index is an extra data structure, stored alongside the table, that lets the database jump straight to the matching rows instead of checking every one.

The most common implementation is a B-tree: a balanced, sorted tree structure over the indexed column's values. Because the values are sorted, the database can binary-search down to the right area of the tree in a handful of steps, rather than reading the whole table — the same intuition as flipping to the right section of a phone book by letter, instead of reading it cover to cover.

```text
Without index:  scan every row, check email = 'a@x.com'   -> O(n)
With index:     jump via B-tree straight to 'a@x.com'      -> O(log n)
```

Not every column benefits equally. **Selectivity** describes how much an index narrows things down: indexing an `email` column (nearly every value unique) eliminates almost the entire table on a lookup; indexing a `is_active` boolean (only two possible values) barely narrows anything, since the database still ends up reading a large fraction of matching rows either way.

Indexes can also span multiple columns, and **column order matters**: a good rule of thumb is to put columns you filter on with an exact match first, columns you filter on with a range (like a date range) second, and columns used only for sorting last. An index on `(status, created_at)` efficiently serves a query filtering on an exact `status` and a range of `created_at`, but a query filtering only on `created_at` can't make good use of that same index, because the index is sorted by `status` first.

A **covering index** goes a step further by including every column a specific query needs, so the database can answer the query entirely from the index itself without a second lookup into the main table — often the difference between a fast and a merely acceptable query.

The trade-off is unavoidable: every index speeds up reads that match it, but it also has to be updated on every write to the table, slows those writes down, and consumes extra disk and memory. A table with ten rarely-used indexes pays that write cost ten times over for benefits it may never realize on the read side. The healthy practice is to add indexes based on real, observed query patterns (using a query planner / `EXPLAIN` to confirm an index is actually being used) rather than indexing defensively, and to periodically remove indexes that turn out to be unused.

## 4.5 Database Sharding

Sharding is what happens when indexing, caching, and a bigger single machine (vertical scaling) all stop being enough — the dataset or write volume has outgrown what any single database node can hold or handle, so the data is split across multiple independent nodes, each holding only a slice of the total.

Three pieces make sharding work: a **shard key** (the field used to decide where a given row lives — e.g., `user_id`), a mapping from key to shard, and a **router** that inspects each incoming request and directs it to the right shard. The shard key is the single most consequential decision in the whole design, because it determines both how evenly load spreads and how expensive cross-shard operations end up being.

```text
Shard key: user_id % 4

user_id=101 -> shard 1        user_id=104 -> shard 0
user_id=102 -> shard 2        user_id=105 -> shard 1
user_id=103 -> shard 3        user_id=106 -> shard 2
```

Common strategies: **hash-based** sharding (hash the key, spreads data evenly, but makes range queries across shards awkward and complicates adding new shards later since most keys need to be reshuffled); **range-based** sharding (contiguous key ranges per shard, e.g., users A-M on shard 1, N-Z on shard 2, which supports efficient range queries but risks a "hot" shard if one range gets disproportionate traffic, like a celebrity's data landing next to yours); **directory-based** sharding (an explicit lookup table mapping keys to shards, flexible but adds a lookup hop and a new single point of failure if that directory isn't itself made highly available); and **geo-based** sharding (data placed by region, useful for latency and data-residency/compliance requirements).

The real cost of sharding shows up in anything that used to be simple on one machine and now spans multiple: a query that needs to join data from two different users now potentially needs a **scatter-gather** — querying every relevant shard and merging results in the application layer, which is slower and more complex than a single-node join. Multi-row transactions across shards become difficult or require specialized distributed-transaction protocols. And rebalancing — moving data around when a shard grows too hot or too full — has to be done carefully to avoid downtime or misrouted requests during the migration.

Because of this cost, sharding is usually the *last* lever pulled, after indexing, caching, and read replicas have been tried and measured as insufficient — not the first solution reached for. When it is needed, the shard key should be chosen from real, dominant query patterns (so that most operations only ever need to touch one shard), avoiding keys with only a few possible values (which limits how many shards you can ever spread across).

## 4.6 Data Replication

Where sharding splits *different* data across multiple nodes, replication keeps *copies of the same data* across multiple nodes. The goal is different too: replication is primarily about surviving failure and spreading read load, not about fitting more total data than one machine can hold.

One node — the primary (or "source") — typically accepts writes. As writes happen, those changes are captured (often by reading the database's internal transaction log, a technique called change data capture) and streamed to one or more replicas, which apply the same changes and end up holding the same data.

There are two fundamentally different timing strategies, and the choice is a direct consistency-versus-latency trade-off:

- **Synchronous replication**: the primary waits for a replica to confirm it received and applied a write before telling the original client "success." This guarantees the replica is never behind, at the cost of extra latency on every write — workable when replicas are close by (same data center), painful across long distances.
- **Asynchronous replication**: the primary confirms the write immediately and sends it to replicas afterward. Writes are fast, but there's a window (replication lag) where a replica might not yet reflect the latest write, and if the primary fails during that window, the not-yet-replicated write can be lost.

```text
Synchronous:                          Asynchronous:
Client -> Primary -> wait for ACK     Client -> Primary -> ACK immediately
              -> Replica confirms                  -> Replica (catches up shortly after)
Client <- "done" (slower, safer)      Client <- "done" (faster, tiny lag window)
```

Replication earns its complexity through two very concrete benefits. First, disaster recovery: if the primary fails, a replica can be promoted to take over, and how much data could be lost versus how long the system is down are captured by two standard metrics — Recovery Point Objective (how much recent data you can afford to lose) and Recovery Time Objective (how long you can afford to be down). Second, read scaling: since replicas hold a copy of the data, read-only queries (which are often the majority of traffic in real systems) can be spread across replicas instead of all landing on the primary, freeing the primary to focus on writes.

The gotcha that catches people building their first replicated system: a read sent to a replica immediately after a write to the primary can return stale data during the lag window. If a user updates their profile and immediately reloads a page that happens to read from a lagging replica, they may briefly see their old data. Systems that care about this either route "read your own write" requests back to the primary, use synchronous replication for that specific path, or accept the staleness as a deliberate trade-off for the availability and performance gained everywhere else. When multiple nodes are allowed to accept writes rather than just one (active-active setups), a further problem appears — conflicting writes to the same record — which section 4.10 picks up directly.

## 4.7 Database Scaling

Scaling a database is rarely one technique — it's usually several of the tools from this module, applied together and in a sensible order as the system's real, measured bottlenecks reveal themselves.

**Vertical scaling** — giving the existing single machine more CPU, RAM, or faster disks — is the simplest lever and often the first one pulled, because it requires no architectural change at all. Its ceiling is real, though: eventually you're paying steeply for diminishing hardware improvements, and a single machine remains a single point of failure no matter how powerful.

**Indexing** (4.4) speeds up the specific queries that are actually slow, usually with far less effort and risk than any structural change.

**Caching** puts frequently-requested data in a much faster layer (typically in-memory) in front of the database, so repeat reads never have to touch disk at all — enormously effective for read-heavy workloads with a "hot" subset of frequently accessed data.

**Read replicas** (an application of replication, 4.6) offload read traffic from the primary, which matters because most production systems are read-heavy.

**Vertical partitioning** splits a wide table into narrower ones grouped by which columns are accessed together — for example, splitting rarely-read "biography" text out of a `users` table that's queried constantly for just `id` and `name`, so the common query touches less data per row.

**Materialized views** pre-compute and store the result of an expensive query (like a daily aggregate report) so future reads fetch the stored result instead of recomputing it from scratch every time, at the cost of that stored result being only as fresh as the last refresh.

**Denormalization** intentionally duplicates data across tables to avoid expensive joins on the read path — for example, storing a customer's name directly on each of their orders rather than joining to a customers table every time — trading some write complexity and storage for faster, simpler reads.

**Sharding** (4.5) is the heaviest tool, splitting data itself across multiple nodes when write volume or total data size has outgrown a single primary even after the above techniques are applied.

```text
Escalating order (roughly, most systems don't need every step):
vertical scaling -> indexing -> caching -> read replicas
   -> partitioning/materialized views/denormalization -> sharding
```

The overarching lesson: reach for the cheapest, least disruptive fix that addresses the *actual measured* bottleneck first. A system that jumps straight to sharding because "that's what big companies do" often ends up with all of sharding's complexity (scatter-gather queries, harder transactions, rebalancing) while a well-placed index or a cache would have solved the real problem with a fraction of the effort.

## 4.8 Types of Databases

Not every database is a general-purpose relational or document store — as systems mature, specific problems justify reaching for a database purpose-built for one job rather than forcing a general-purpose one to do it awkwardly. Recognizing these types (and when each earns its place) is as much a part of database literacy as understanding SQL vs NoSQL.

- **Relational (RDBMS)** — tables, fixed schema, SQL, ACID transactions, strong support for joins across related data. General-purpose default when relationships and consistency matter.
- **Key-value stores** — the simplest model, a key maps to an opaque value; extremely fast lookups by ID; used for caching, session storage, feature flags.
- **Document databases** — store semi-structured, JSON-like records with flexible fields; good when different records naturally have different shapes, like a product catalog spanning very different product types.
- **Wide-column stores** — built for very large volumes of data organized by row key and grouped columns, often time- or event-oriented; used when write throughput and horizontal scale matter more than flexible querying.
- **Graph databases** — model data explicitly as nodes and edges, optimized for traversing relationships (friend-of-a-friend, recommendation paths) that would require expensive repeated joins in a relational model.
- **Time-series databases** — optimized for timestamped, sequential data (metrics, sensor readings), with storage and query patterns tuned for "give me this metric over this time range" rather than arbitrary lookups.
- **In-memory databases** — keep data in RAM rather than on disk, trading durability risk (data can be lost on a crash unless backed by persistence) for very low latency; commonly used as caches or for workloads where speed dominates.
- **Search/text databases** — index unstructured text specifically to support fast full-text search and relevance ranking, something relational `LIKE` queries handle poorly at scale.
- **Spatial databases** — optimized for geographic queries ("find all locations within 5 km"), typically using spatial indexes like R-trees rather than standard B-trees.
- **Blob/object stores** — store large unstructured files (images, videos, backups) cheaply, rather than trying to cram binary data into rows of a relational table.
- **Ledger databases** — append-only and tamper-evident, used where an immutable audit trail of every change is itself a requirement, such as financial record-keeping.
- **Vector databases** — store high-dimensional numeric vectors (embeddings) and support similarity search, used heavily in modern search and AI-powered recommendation systems.
- **Embedded databases** — run inside the application process itself rather than as a separate server, useful for local storage on a device or in a single-process application with no need for network access.

The principle tying all of these together: there is no universally "best" database, only a best fit for a given access pattern, and real production systems very often use several of these types side by side — a relational database as the source of truth, a key-value cache in front of it, a search database for full-text queries, and a blob store for uploaded files — each doing the one job it's actually good at.

## 4.9 Bloom Filters

A Bloom filter answers one narrow question extremely cheaply: "have I possibly seen this item before?" It's a probabilistic data structure, meaning it trades perfect accuracy for a dramatic reduction in memory use, and it's used constantly as a cheap pre-check in front of an expensive lookup.

Internally, it's just a bit array of some size `m`, all initially 0, plus `k` independent hash functions. Adding an item hashes it `k` different ways, and sets the bit at each of those `k` positions to 1. Checking whether an item might be present hashes it the same `k` ways and looks at those same positions.

```text
Bit array (m=10):  0 0 0 0 0 0 0 0 0 0

Add "apple"  (hashes to positions 1, 4, 7):  0 1 0 0 1 0 0 1 0 0
Add "banana" (hashes to positions 2, 4, 9):  0 1 1 0 1 0 0 1 0 1

Check "apple"  -> positions 1,4,7 all 1  -> "probably present" (correct)
Check "cherry" -> positions 2,4,9 all 1 (by coincidence!) -> "probably present" (FALSE POSITIVE)
Check "grape"  -> position 3 is 0        -> "definitely absent" (always correct)
```

This gives the Bloom filter its defining, one-directional guarantee: if it says "absent," that's always true — there are never false negatives for items that were actually added. But if it says "present," that's only *probably* true — two different items can happen to hash to the same set of bit positions, producing a false positive. The false-positive rate is tunable: more bits per item and more hash functions reduce it, at the cost of more memory (roughly 9.6 bits per item gets you down to about a 1% false-positive rate).

The motivating use case: imagine a system that needs to check "does this key exist in our huge on-disk dataset" — say, a database engine checking whether a key might exist in a particular data file before doing an expensive disk read. If a small in-memory Bloom filter can say "definitely not in this file" for the vast majority of misses, the expensive disk read is skipped entirely for those cases, and only genuine candidates (plus the occasional false positive) pay the real lookup cost. This exact pattern is used inside LSM-tree-based databases to skip whole files that definitely don't contain a queried key, in web crawlers to avoid reprocessing URLs already visited, and in caches to avoid looking up items that were never cached in the first place, avoiding what's sometimes called the "cache penetration" problem.

The gotcha: a Bloom filter can never be used where correctness absolutely depends on its answer, because a false positive means "might be present" is sometimes wrong — it must always be paired with a real, authoritative check for anything where a false positive would cause a real problem. It also can't safely support deletion in its basic form (clearing a bit might belong to another item too) — a variant called a Counting Bloom filter, which stores small counters instead of single bits, is needed if deletion is required.

## 4.10 Database Architectures (Active-Active and Beyond)

Sections 4.6 and 4.7 mostly assumed one primary node accepting writes, with replicas that are read-only followers. That's called an **active-passive** (or primary-replica) architecture: one node is "active" for writes, the others stand by, and if the active node fails, one of the passive replicas is promoted to take over — which necessarily involves some failover delay while that promotion happens and clients reconnect.

An **active-active** architecture removes that restriction: multiple nodes, often spread across different geographic regions, all accept both reads *and* writes simultaneously, and changes made at each node propagate to the others.

```text
Active-passive:                    Active-active:
[Primary] <--writes-- Client       [Node US] <--writes-- US clients
    |  (replicates)                    <-->  (syncs both ways)
[Replica] (read-only,               [Node EU] <--writes-- EU clients
 promoted only on failure)
```

The motivating problem this solves: a single global primary means every write from a user in, say, Singapore has to cross the network to reach a primary in, say, the US, adding real latency to every write. With active-active, a user's writes land on the node nearest to them, which then syncs to the other regions in the background — writes feel fast locally, and if one region's node goes down entirely, the others keep serving live traffic immediately, with no failover delay, since they were never passive to begin with.

The cost of this design is the problem active-passive architectures conveniently avoid: since more than one node can accept a write to the *same* record at nearly the same time, from different regions, before either has heard from the other, conflicts are inevitable. Two users (or the same user from two devices) might update the same record in different regions within the same second, and the system needs a deterministic way to reconcile that. Common strategies include **last-write-wins** (simplest: whichever write has the later timestamp survives, but the earlier write is silently discarded, which is unacceptable for some data like financial balances), **application-defined conflict resolution** (custom logic decides how to merge, e.g., "keep the higher value" for a counter), and **CRDTs** (Conflict-free Replicated Data Types — data structures specifically designed so that concurrent updates from different nodes can always be merged automatically into a single consistent result, without losing either update, for supported data shapes like counters, sets, and certain text structures).

The practical decision point: active-passive is simpler to reason about (one clear source of truth at any moment) and is the right default for most systems, especially anything where write conflicts must never be silently resolved incorrectly, like account balances. Active-active earns its extra complexity specifically when a system has genuinely global users who need low write latency in their own region and can tolerate (or has designed around) the reality of merging concurrent writes — think collaborative editing tools, global session state, or shopping carts, where "eventually merged correctly" is an acceptable trade for "always fast, always available, everywhere."

## 4.11 Summary and how these connect

Step back, and this module traced the same underlying tension from four different angles. Section 4.2 established what "correct" even means for a single database under concurrent use — ACID transactions. Section 4.3 was the fork in the road: relational structure and strong transactional guarantees, or a NoSQL model built tightly around one access pattern, a decision that shapes everything after it. Sections 4.4 and 4.9 were both about making reads cheap — indexes for exact and range lookups inside the database itself, Bloom filters for cheaply ruling out lookups before they ever reach the expensive layer. Sections 4.5, 4.6, and 4.7 were about surviving growth and failure: sharding splits data across nodes when one node can't hold or serve it all, replication keeps safety copies and spreads read load, and scaling ties every technique in the module together into a sequence, cheapest first. Section 4.8 was the reminder that all of this exists in service of matching a tool to a shape of data and access pattern, not applying one database type everywhere by default. And section 4.10 pushed replication one step further, into architectures where the "one primary, many followers" assumption itself is relaxed, and conflict resolution becomes a first-class design problem.

Put the two modules together and you have the two halves of nearly every system design conversation: module 3 covered how a request gets from a client to your system correctly and safely, and this module covered what happens once that request needs to read or write data that must survive, scale, and stay correct under concurrent, distributed access. Later lessons that walk through full "design X" problems will lean on both vocabularies simultaneously — an API gateway routing a request that ultimately needs a sharded, replicated datastore behind a cache and a Bloom filter is not a special case; it's the default shape of a real system, built from exactly the pieces these two modules just named.
