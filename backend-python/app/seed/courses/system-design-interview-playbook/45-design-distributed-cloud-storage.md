> **Learning goal**
> Design a distributed object storage system like S3, and be able to explain the durability trade-offs between replication and erasure coding, and how metadata for object listing stays fast and consistent at a scale of trillions of objects.

## 45.1 Requirements and scope

**Functional requirements**

- A client can upload (`PUT`), download (`GET`), and delete an object identified by a bucket and key.
- A client can list objects within a bucket, optionally filtered by a key prefix.
- Objects can be large (up to many GB/TB) and must support efficient upload/download, including partial/resumed transfers.
- The system supports at least basic per-bucket access control.

**Non-functional requirements**

- **Extreme durability**: this is the single most important property of the system — "eleven nines" (99.999999999%) durability is the industry-standard bar to reason about, meaning the probability of losing a given object in a year is vanishingly small. Users trust this system as the bottom layer of their own durability story; losing data here is close to the worst possible failure mode.
- **High availability**: reads and writes should succeed even during regional infrastructure issues, though (as covered below) durability and availability are evaluated somewhat separately — data can be durable (not lost) even during a window where it's briefly unavailable.
- **Massive scale**: trillions of objects, exabytes of total data, supporting many independent tenants (buckets) with wildly varying object sizes and access patterns.
- **Strong-enough consistency for listing/metadata**: a client that just wrote an object should reliably see it in a subsequent read or list operation — stale or missing results here directly undermine trust in the system.
- **Cost efficiency at scale**: given the sheer volume of data being stored, the storage overhead of whatever durability mechanism is chosen (how many extra bytes are stored per byte of actual data) has a very real, very large cost impact — this is a first-class design constraint, not an afterthought.

**Out of scope**: fine-grained IAM-style permission policies, lifecycle management (auto-archival to colder storage tiers), server-side encryption key management, cross-region replication policies. These are real product features layered on top of the core durable-storage-and-metadata problem this lesson focuses on.

## 45.2 Scale estimation

Stated, round assumptions:

- **Total objects and data**: assume 10 trillion objects, averaging 500 KB each → **~5 exabytes** of total stored data — a figure that immediately rules out any storage design that isn't horizontally distributed across an enormous number of physical disks/machines from day one.
- **Request rate**: assume 5 million `PUT`/`GET` requests/sec platform-wide at peak, heavily skewed toward reads (a common pattern — content is written once and read many times) — say a 10:1 read:write ratio, so roughly 500,000 writes/sec and 4.5 million reads/sec.
- **Object size distribution**: heavily skewed, similar to the file-sharing lesson — many small objects (KBs) and a smaller number of very large objects (GBs-TBs, e.g., backups, video files) — this skew is why large objects are typically split into parts/chunks for upload (allowing parallel, resumable transfer of pieces rather than one giant atomic transfer), reusing the same underlying motivation as chunking in the file-sync lesson even though the goal here (parallel throughput and resumability) differs slightly from that lesson's goal (efficient delta sync).
- **Durability overhead cost matters at this scale**: storing 5 exabytes of *actual* data at 3x naive full replication would require **15 exabytes** of raw physical storage — a 3x storage cost multiplier that, at this scale, represents an enormous ongoing infrastructure cost. This single fact is the strongest argument in the whole system for considering erasure coding as an alternative to simple replication (Section 45.5), since even a modest reduction in storage overhead translates to a massive absolute cost saving at exabyte scale.
- **Metadata volume**: 10 trillion objects each need a metadata record (bucket, key, size, location pointers, timestamps) — even a compact ~200-byte metadata record per object means **~2 PB of metadata alone**, which, while tiny relative to the 5 exabytes of actual object data, is still a genuinely large, high-query-volume dataset in its own right (every single read/write/list touches metadata) and needs to be treated as its own scaling problem, not an afterthought bolted onto the data storage layer.

The dominant insight: this system has two distinct hard problems at very different scales and with very different concerns — **durably storing exabytes of object bytes as cheaply as possible** (Section 45.5's erasure coding discussion) and **serving trillions of metadata lookups/listings consistently and fast** (Section 45.5's metadata discussion) — and conflating them into one undifferentiated "storage" problem is the most common mistake in approaching this design.

## 45.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `PUT /{bucket}/{key}` | Object bytes (or multipart: initiate, upload parts, complete) | `200 OK` with an ETag |
| `GET /{bucket}/{key}` | — | Object bytes (supports `Range` header for partial reads) |
| `DELETE /{bucket}/{key}` | — | `204 No Content` |
| `GET /{bucket}?prefix=&continuation-token=` | — | `{ "objects": [{ "key", "size", "lastModified" }, ...], "nextContinuationToken" }` |

Large object uploads use a **multipart** pattern (initiate a multipart upload, upload individual parts — potentially in parallel, from multiple connections — then a final "complete" call that assembles the parts into one logical object) rather than a single giant `PUT`, directly addressing the resumability and parallel-throughput needs implied by the large-object tail of Stage 2's size distribution. The list endpoint uses prefix filtering plus a continuation token (cursor-based pagination) rather than an offset, since object counts within a bucket can be enormous and offset-based pagination degrades badly (and can return inconsistent results under concurrent writes) at that scale.

**Data model**

Two genuinely distinct storage problems, matching the Stage 2 insight:

1. **Object data itself** — the actual bytes. These are broken into fixed-size chunks (or stored as one unit for small objects) and distributed across a large fleet of storage nodes using replication or erasure coding (Section 45.5) for durability. This layer has essentially no relational structure at all — it's addressed purely by a chunk/object identifier, making it, at its core, a massive content/identifier-addressed blob layer.
2. **Metadata** — `Object { bucket, key (composite PK), size, etag, storageLocations/chunkMap, lastModified, storageClass }`. The access pattern here is dominated by two very different query shapes: point lookups by exact `(bucket, key)` (for `GET`/`PUT`/`DELETE`) and **ordered range scans by key prefix** (for `LIST` with a prefix filter) — this second access pattern is the one that most constrains the choice of metadata store, because it needs keys sorted lexicographically, not just hashed for point-lookup distribution. This favors a **distributed, sorted key-value store** (a wide-column or LSM-tree-based store that keeps keys in sorted order, such as the family of systems built on a sorted-string-table design) over a pure hash-based key-value store — a pure hash-based store would make point lookups trivially fast but would make prefix-range listing essentially impossible to do efficiently, since hashing destroys the lexicographic ordering that a prefix scan depends on. This is a good example of a case where the access pattern (not just "point lookups at scale," which alone might suggest any key-value store) drives a more specific choice within the NoSQL family.

## 45.4 High-level architecture

```text
Client
  -> Load Balancer -> API Gateway
       -> Write path: Metadata Service -> Metadata Store (sorted key-value, partitioned by bucket+key prefix)
                       Data Service -> Chunker -> Erasure Coding / Replication -> Storage Node Fleet (many nodes, many racks/AZs)
       -> Read path:  Metadata Service -> Metadata Store (locate chunks) -> Data Service -> Storage Node Fleet -> reassemble -> Client
       -> List path:  Metadata Service -> Metadata Store (sorted range scan by key prefix)
```

**Write path**: an uploaded object is split into chunks (for large objects; small objects may be handled as a single chunk), each chunk is encoded for durability (Section 45.5) and its resulting pieces are distributed across multiple storage nodes spread across failure domains (different racks, different availability zones) — critically, spread so that a single rack, node, or even entire zone failure cannot make the object unrecoverable. Once the data is durably written, the Metadata Service commits a metadata record mapping the object's key to its chunk locations — this ordering matters: metadata should only reflect an object as existing once its data is actually durably persisted, not before, since the metadata record is what every subsequent `GET`/`LIST` trusts.

**Read path**: a `GET` first looks up the object's metadata (which chunks, on which nodes, encoded how) and then fetches and reassembles the necessary chunks from the storage node fleet — for erasure-coded data, this may mean fetching only a subset of the original pieces plus reconstructing the rest computationally, detailed in Section 45.5.

**List path**: because the metadata store keeps keys in sorted order, listing all objects under a prefix is an efficient contiguous range scan, not a search across an unordered space — this is precisely the property that motivated choosing a sorted key-value store over a purely hash-partitioned one in Section 45.3.

## 45.5 Deep dive: durability via replication vs. erasure coding, and metadata at massive scale

### Simple replication

The straightforward approach to durability: store N full copies of each chunk (commonly 3) on different nodes/failure domains. If any one copy is lost (disk failure, node failure), the others still have the complete data, and a new copy can be re-replicated from a surviving one to restore full redundancy. This is simple to reason about and simple to implement (reading requires fetching from just one healthy replica, no reconstruction math involved), and it tolerates the loss of up to N-1 copies of a given chunk without data loss. The cost, as Stage 2 established, is stark: 3x replication means storing 3 bytes of raw physical storage for every 1 byte of actual data — at exabyte scale, this overhead is enormous in absolute terms.

### Erasure coding

Erasure coding achieves comparable (often better) durability guarantees with substantially less storage overhead, at the cost of more computational complexity. The core idea: instead of storing complete copies, split a chunk of data into k data fragments, then compute m additional parity fragments derived mathematically from the data fragments (using techniques from coding theory, e.g., Reed-Solomon codes), such that the original data can be fully reconstructed from **any** k of the total (k+m) fragments — meaning the system can tolerate the loss of up to m fragments (regardless of which specific ones are lost) without losing the underlying data.

A concrete, commonly cited configuration: a 10-data, 4-parity scheme (often written 10+4) stores 14 total fragments for every original chunk, and can survive the loss of any 4 of those 14 fragments while still fully reconstructing the original 10 data fragments. The storage overhead here is 14/10 = 1.4x — compare that to 3x replication for a similar (in this configuration, often even stronger) durability guarantee against simultaneous failures. This overhead reduction is exactly why erasure coding is the standard choice for durability at the exabyte scale this system operates at: the storage cost savings compound enormously across 5 exabytes of data.

The trade-offs that come with this efficiency:

- **Reconstruction cost.** Recovering a lost fragment (after a node/disk failure) requires reading k other fragments and performing a computation to reconstruct the missing one — this is real CPU work and network bandwidth (fetching k fragments from k different nodes) that a straight replication scheme avoids entirely (just copy the one surviving replica). This makes erasure-coded recovery slower and more resource-intensive per-failure than replication's recovery, even though it needs to happen less often on a per-byte basis given the storage savings.
- **Read latency for degraded reads.** In the common case (no failures), reading an erasure-coded object still just needs to fetch k fragments (not all k+m) and can typically avoid reconstruction overhead if the data fragments themselves are read directly. But if some of the specific data fragments needed happen to be on currently-unavailable nodes, a "degraded read" must fetch a different, available combination of k fragments (a mix of data and parity) and perform the reconstruction computation to serve the read — meaningfully slower than the pure-replication equivalent (just try another replica). This is a real latency cost that's more likely to surface exactly when the system is already under some stress (nodes down), which is a notable trade-off to flag explicitly.
- **Small-object inefficiency.** Erasure coding's overhead math works out favorably for larger chunks, but splitting a very small object into k fragments each becomes wastefully tiny, and the fixed overhead of managing many small fragments (metadata per fragment, network round trips) can outweigh the storage savings. Real systems commonly apply erasure coding above a size threshold and use simple replication (or even just storing 2-3 full copies) for smaller objects, where the storage-cost delta in absolute bytes is small anyway.

| Property | Replication (3x) | Erasure coding (10+4) |
| --- | --- | --- |
| Storage overhead | 3x (200% extra) | 1.4x (40% extra) |
| Failures tolerated | Up to 2 of 3 copies lost | Up to 4 of 14 fragments lost |
| Read cost (healthy case) | Fetch 1 replica | Fetch k fragments (or fewer if optimized) |
| Read cost (degraded case) | Fetch a different replica — same cost | Fetch k fragments + reconstruction compute — slower |
| Recovery cost after a failure | Copy one surviving replica | Read k fragments + compute — more expensive per event |
| Best suited for | Small objects, latency-critical hot data | Large objects, the bulk of cold/warm exabyte-scale data |

A production system commonly uses **both**, matched to the object/data characteristics: erasure coding as the default for the bulk of stored data (where the storage-cost savings dominate at scale), with plain replication reserved for smaller objects and perhaps for the most latency-sensitive, frequently accessed "hot" data, where erasure coding's reconstruction overhead is a worse trade than its storage savings are worth.

### Metadata management at massive scale

The metadata layer faces a different kind of scaling challenge: not "how do we not lose bytes" but "how do we serve trillions of point lookups and range scans, consistently, fast." Three key design points:

- **Partitioning that preserves lexicographic order.** As established in Section 45.3, the metadata store needs to support efficient prefix-range scans for `LIST`, which means it must be partitioned in a way that keeps keys in roughly sorted order *within* a shard, not simply hashed to spread load (which would scatter a prefix's keys randomly across every shard, making a prefix scan require querying every shard and merging results — workable, but far less efficient than a scan localized to one or a few shards). A common approach partitions by key ranges directly (shard boundaries defined by key prefixes) rather than by hash, accepting that this requires active rebalancing when certain prefixes become disproportionately hot or large (an uneven-load problem conceptually similar to the density imbalance seen in the geospatial-indexing lessons, just along a different dimension — lexicographic key space instead of physical geography).
- **Read-after-write consistency for metadata specifically.** Given the stated requirement that a client should reliably see an object it just wrote, the metadata store needs strong consistency for a given key's own reads and writes (this is a smaller, more tractable consistency scope than "the whole system is strongly consistent" — it's specifically "my own most recent write to this exact key is visible to my next read"), typically achieved by routing all reads and writes for a given key range through the shard that owns it, avoiding the classic distributed-consistency pitfall of two replicas of the same metadata disagreeing about an object's current state.
- **Separating metadata durability from data durability.** Because a lost metadata record effectively makes an object's data unreachable (even if the underlying erasure-coded/replicated bytes are perfectly intact on disk somewhere, nothing can find them without their metadata pointer), the metadata store itself needs its own strong durability guarantees — commonly achieved via its own replication (a smaller-scale, more conventional replication problem than the exabyte-scale object data itself, since 2 PB of metadata is a much more tractable volume to replicate 3x than 5 exabytes would be).

## 45.6 Bottlenecks and trade-offs

- **Single points of failure**: no single storage node or even rack/zone should be able to make any object unrecoverable — this is the entire point of spreading replicas/fragments across independent failure domains, and it's why "durability" and "availability" are evaluated somewhat separately in this design: a zone-wide outage might make some objects briefly *unavailable* (their metadata shard or a majority of nearby fragments happen to be in that zone) without making them *lost*, since the remaining fragments/replicas elsewhere are still sufficient to reconstruct the data once the outage resolves.
- **Hot spots**: a small number of extremely popular objects or a bucket with a rapidly, sequentially incrementing key pattern (e.g., timestamp-prefixed keys, all landing on the same metadata shard due to the very sortedness that makes prefix-listing efficient) can create metadata or read hot spots — mitigated by encouraging (or automatically detecting and splitting) better-distributed key naming, and by caching hot object metadata and even hot object data in front of the base storage tier.
- **Consistency vs. availability**: this system draws a clear line — strong, read-your-writes consistency for metadata of a specific key (a correctness requirement users depend on), but broader availability-favoring behavior for the system as a whole under partial failure (an object being briefly unreachable during a localized outage is acceptable; an object's metadata reflecting a write that then reverts, or two clients seeing different metadata for the same key at the same time, is not).
- **What breaks first at 10x/100x scale**: at 10x total data (50 exabytes), the storage node fleet and erasure-coding scheme scale by adding more capacity and more shards — a largely horizontal story given chunks are already spread across many independent nodes. At 100x, the metadata layer's rebalancing becomes the harder problem: with 1,000 trillion objects, even small imperfections in key-space partitioning compound into meaningfully uneven shard sizes, pushing toward more dynamic, automated shard-splitting (continuously monitoring shard size/load and splitting hot or oversized key ranges, rather than a largely static initial partitioning) as a first-class, always-running background process rather than an occasional manual intervention.

## 45.7 Summary

The core of a large-scale object storage system splits into two genuinely different problems: durably storing an enormous volume of object bytes as cheaply as possible (erasure coding trades a real increase in reconstruction/degraded-read complexity for a dramatically lower storage-overhead multiplier than simple replication, which matters enormously at exabyte scale, with replication still reserved for smaller or especially latency-sensitive data), and serving metadata lookups and prefix-based listings fast and consistently at a trillion-object scale (which specifically requires a sorted, range-partitioned key-value store rather than a purely hash-partitioned one, because listing by prefix depends on preserved lexicographic ordering).

Natural follow-ups an interviewer might raise: supporting storage-class tiering (automatically migrating rarely-accessed objects to cheaper, higher-latency storage — often implemented as a background process that re-encodes or relocates cold data without changing its externally visible metadata), and cross-region replication for disaster recovery (extending the same durability reasoning across entire geographic regions, not just racks/zones within one).
