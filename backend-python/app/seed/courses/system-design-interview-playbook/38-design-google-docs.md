> **Learning goal**
> Design a real-time collaborative document editor like Google Docs, and be able to explain the two dominant approaches to resolving concurrent edits — Operational Transformation and CRDTs — well enough to compare their trade-offs and describe how edits propagate between clients with low latency.

## 38.1 Requirements and scope

**Functional requirements**

- Multiple users can open the same document and edit it concurrently, seeing each other's changes appear live.
- Each user sees a consistent final document — everyone's view converges to the same content, even if they typed at the same moment.
- Users can see who else is currently viewing/editing (presence) and often see live cursor positions.
- Changes are durably saved and a document has a version history a user can browse and revert to.
- A document can be shared with specific users at specific permission levels (view/comment/edit) — basic access control, not a full permissions engine.

**Non-functional requirements**

- **Low-latency propagation**: another user's keystroke should visibly appear in your view within a few hundred milliseconds at most — this is the defining UX requirement of "feels real-time."
- **Convergence/consistency**: every client must eventually arrive at the exact same document content given the same set of edits, regardless of the order those edits were received in locally — this is a correctness requirement, not just a nice property.
- **Availability with graceful offline handling**: a brief network blip shouldn't corrupt the document or lose a user's local edits; edits made while briefly offline should merge in once reconnected.
- **Durability**: edits must not be lost once acknowledged by the server, even across server restarts/failures.
- **Moderate scale per document, large scale overall**: any single document typically has a handful to a few dozen concurrent editors (not millions), but the platform overall serves a very large number of documents and users.

**Out of scope**: rich formatting/embedded objects (images, tables) beyond plain text edits, comment threads, offline conflict UI, full document search/indexing, granular per-paragraph permissions. These are real product features layered on top of the same core sync mechanism this lesson focuses on.

## 38.2 Scale estimation

Stated round assumptions:

- **Concurrent editors per document**: the sharp contrast with every other lesson in this course — a single document is a small-scale problem (typically 1-50 concurrent editors), so per-document throughput is low. The scale challenge here is **breadth** (many documents, many users) rather than depth (huge traffic on one document).
- **Total active documents**: assume 10 million documents being actively edited at any given moment across the platform (a large but plausible number for a widely used product) → this is the number that actually needs horizontal scaling — the system needs to support millions of independent, small, low-latency real-time sessions, not one huge one.
- **Edit rate per active user**: an actively typing user produces roughly 1-5 keystroke-level edit operations per second during a burst of typing → for a document with 10 concurrent editors all actively typing, that's roughly **10-50 edit ops/sec for that single document** — small in absolute terms, but each one needs to propagate to every other connected client within the latency budget above.
- **Aggregate platform write rate**: 10 million active documents × a much lower average edit rate per document (most documents are idle most of the time, only a fraction have someone actively typing at any given instant — say 5% actively edited at once, each producing a few ops/sec) → still yields on the order of **hundreds of thousands of edit ops/sec platform-wide**, which is a real distributed-systems throughput number even though any single document's load is tiny.
- **Storage**: a document's full text plus its edit history (every operation ever applied, useful for version history) — a moderately long document is tens of KB of text, but the operation log for a heavily-edited document over its lifetime can be substantially larger than the document itself. At scale this argues for periodic compaction (collapsing old operations into a snapshot, Section 38.5) rather than keeping every operation forever.

The dominant insight: this is a **fan-out and low-latency propagation problem at massive breadth**, not a raw-throughput-per-object problem — each document is its own small, isolated real-time collaboration session, and the system's job is to host millions of these cheaply and reliably in parallel while guaranteeing every session's participants converge on the same content.

## 38.3 API and data model

**API**

Real-time collaborative editing is not well served by simple request/response REST calls for the edit stream itself — it needs a persistent connection. The API is best described as a mix:

| Method & Path / Channel | Request | Response |
| --- | --- | --- |
| `POST /documents` | `{ "title" }` | `{ "documentId" }` |
| `GET /documents/{id}` | — | `{ "content", "version" }` (initial load / snapshot) |
| `WS /documents/{id}/sync` (WebSocket) | Client sends: `{ "op": ..., "baseVersion": N }` | Server broadcasts: `{ "op": ..., "version": N+1, "authorId" }` to all connected clients |
| `GET /documents/{id}/history` | — | List of saved versions/snapshots for revert |

The WebSocket channel is the heart of the system: every connected client for a given document keeps this open, sends its local edits as operations (not the whole document — sending a full document body on every keystroke would be wasteful and would also lose the fine-grained ordering information needed for conflict resolution), and receives every other client's operations the same way.

**Data model**

Core entities:

- `Document { id (PK), title, ownerId, currentSnapshot, currentVersion }`
- `Operation { id, documentId, version (monotonic per doc), authorId, opPayload, timestamp }` — an ordered, append-only log of every edit operation applied to a document.
- `Snapshot { documentId, version, fullContent, createdAt }` — periodic materialized full-content checkpoints, so reconstructing current state doesn't require replaying every operation since document creation.

The operation log's access pattern — append-only writes, ordered by a per-document monotonic sequence number, read sequentially from a given point forward — is a strong fit for a **log-structured or wide-column store** (or even a dedicated append-only log system) rather than a general relational table, especially at the "hundreds of thousands of ops/sec platform-wide" scale from Stage 2: the writes are naturally partitioned by `documentId` (no cross-document transactions needed), and reads are always "give me everything after version N for this document" — a range scan on a sorted key, not an ad-hoc query needing joins. The `Document` and `Snapshot` metadata, by contrast, is small, low-volume, and benefits from a simple relational or key-value store for straightforward lookups by `documentId`. So again — as in earlier lessons — the honest answer is a split: an append-only, partitioned log store for operations, and a simple metadata store for documents/snapshots.

## 38.4 High-level architecture

```text
Client A --\                                    /-- Client B
            \                                  /
             WebSocket Gateway (per-document session routing)
                          |
                          v
              Document Session Service (one logical owner per document,
                          |               applies transform/merge logic,
                          |               assigns monotonic version numbers)
                          v
              Operation Log (append-only, partitioned by documentId)
                          |
                          v
              Periodic Snapshot Compactor -> Snapshot Store
```

**Write path (a user types)**: the client applies the edit optimistically to its own local view immediately (so typing feels instant, never waiting on a round trip), and asynchronously sends the operation to the server over the WebSocket connection, tagged with the client's last-known document version. The Document Session Service for that document — a single logical component responsible for serializing and ordering all edits to one document, even though many server processes exist, this is achieved by routing all connections for a given `documentId` to the same session owner, similar in spirit to a chat room's single owning shard — applies the necessary transformation or merge logic (Section 38.5) against any operations that happened concurrently, assigns the operation the next monotonic version number, appends it to the operation log, and broadcasts the transformed operation to every other connected client for that document.

**Read path (opening a document, or another client's edit arriving)**: opening a document for the first time loads the latest snapshot plus any operations since that snapshot's version, reconstructing current content without replaying the entire history. An already-open client simply receives broadcast operations over its WebSocket connection and applies them locally in the background — this is the steady-state "live collaboration" path and is push-based, not poll-based, to meet the low-latency propagation requirement.

Because each document's session is independently owned and small in scale (Stage 2), the system scales by running very many of these small sessions in parallel across many server processes, routed by a consistent mapping from `documentId` to session owner (the same principle as consistent hashing routes a key to a shard) — not by making any single session bigger or more sophisticated.

## 38.5 Deep dive: resolving concurrent edits — Operational Transformation vs. CRDTs

This is the one genuinely hard problem in this system: two users type at nearly the same moment, potentially on overlapping parts of the document, and every client needs to converge on the identical final content — without a slow, synchronous lock-step protocol that would break the low-latency requirement.

### The core problem with a naive approach

If edits were just applied in "whatever order the server happens to receive them," two clients that started from the same document state but made different concurrent edits would each compute a different result once their own edit is applied locally (optimistically, before the round trip completes) versus what the server ultimately stores — a divergence that needs correcting rather than allowing to silently corrupt the shared document. Consider: the document is `"cat"`, and simultaneously Client A inserts `"s"` at position 3 (making `"cats"`) while Client B inserts `"the "` at position 0 (making `"the cat"`). Both edits are valid individually, but naively applying B's operation (as originally computed, "insert at position 0") to A's already-modified state, or vice versa, can still work out fine in this particular example, but with edits that both touch the *same* position or delete overlapping text, naive replay produces corrupted or nonsensical results (e.g., an insert position that no longer means what it meant when the operation was created, because the text shifted underneath it).

### Operational Transformation (OT)

OT's approach: define edit operations (insert, delete) in terms of a position, and provide a **transform function** that takes two concurrent operations (both based on the same original document state) and adjusts one against the effect of the other, producing a new operation that, when applied *after* the other one, produces the same final result regardless of which order they're actually applied in. Concretely, if Client A's operation is "insert 's' at position 3" and Client B's concurrent operation is "insert 'the ' at position 0" (4 characters), transforming A's operation against B's means shifting A's insertion position by the length of B's insertion (since B's text, once applied, pushes everything after position 0 forward by 4 characters) — so A's operation becomes "insert 's' at position 7," which correctly still lands right after "cat" in the now-longer document "the cat".

The server is the natural place to perform this transformation in the classic OT architecture: it receives operations tagged with the version they were created against, transforms each incoming operation against any operations that have been applied since that version (using the transform function above), assigns it the next version number, and broadcasts the transformed operation to all clients — every client applies the same, already-correctly-transformed operation, so they all converge. The catch: writing a correct transform function is notoriously subtle and error-prone — it needs to handle every pairwise combination of operation types (insert-vs-insert, insert-vs-delete, delete-vs-delete with overlapping ranges) correctly, and a single subtle bug in one combination can cause silent, hard-to-reproduce document corruption. This is why real-world OT implementations (e.g., the one historically used by Google Docs) represent a large amount of accumulated engineering effort, not something typically built from scratch.

### CRDTs (Conflict-free Replicated Data Types)

CRDTs take a different approach: instead of transforming operations against each other, design the data structure itself so that operations from any client, applied in *any* order, mathematically always converge to the same result — no central transform step required. For collaborative text editing, a common CRDT approach assigns each character a unique, stable identifier derived from its position relative to its neighbors at the time of insertion (rather than a raw numeric index that shifts as the document changes), often built from a fractional-indexing or tree-based scheme so a new character can always be given an identifier that sorts correctly between its neighbors without needing to renumber anything else. Because every character's identity is stable and independent of other characters' current positions, two clients can insert or delete concurrently, exchange their operations in any order (or even out of order, or with duplicates, which is important since network delivery isn't always neat), and still deterministically compute the same final sequence of characters, because the merge rule ("sort all live characters by their stable identifiers") doesn't depend on the order operations were received.

The trade-off: CRDTs shift complexity from "one hard, central transform function" to "a data structure with more metadata per character than the raw text itself" (each character effectively carries an identifier, not just its value), which increases memory/storage overhead per edit and can make certain operations (particularly large deletes/rewrites) less efficient than in a simpler positional-index model. CRDTs also don't require a single, ordering-authoritative server component the way classic OT effectively does — any two replicas (including peer-to-peer, without a server) can merge directly — which is a meaningful architectural advantage for offline-first or decentralized designs, though most products still route through a server for presence, persistence, and access control regardless.

| Property | Operational Transformation | CRDTs |
| --- | --- | --- |
| Convergence mechanism | Central transform function reorders/adjusts ops | Data structure design guarantees order-independent merge |
| Needs an ordering-authoritative server | Effectively yes, in the classic architecture | No — any two replicas can merge directly |
| Implementation difficulty | High (subtle transform-function correctness) | Moderate-high (data structure design), but no transform function |
| Per-edit metadata overhead | Low (position-based) | Higher (stable IDs per character/element) |
| Well suited to offline / peer-to-peer | Harder | Naturally suited |

For a Google-Docs-style product where a central server already exists for persistence, access control, and presence, either approach is defensible; the field has broadly moved toward CRDT-based designs for new systems in recent years specifically because they sidestep the correctness fragility of hand-written transform functions, at the cost of some memory overhead that's generally an acceptable trade for a text-editing workload.

### Propagating edits with low latency

Regardless of which conflict-resolution approach is used, the propagation path is the same: clients apply their own edits optimistically and locally the instant they're typed (so local latency is zero), send the operation to the server asynchronously, and the server's job is purely to establish a canonical order/transformed form and rebroadcast — the WebSocket push model (Section 38.4) ensures other clients receive it within roughly one network round trip rather than waiting on any polling interval. If the transform/merge result differs from what a client guessed optimistically (rare, but possible under heavy concurrent editing), the client silently reconciles its local state to match the authoritative version — this is the same "optimistic update, server as final authority, client corrects itself if wrong" pattern used broadly in real-time systems.

## 38.6 Bottlenecks and trade-offs

- **Single points of failure**: because a single Document Session Service instance owns the ordering/transform authority for a given document, that instance failing mid-session is a real availability risk for anyone editing that specific document — mitigated by making session ownership reassignable (a new instance can take over by replaying the operation log from the last snapshot) and by keeping the operation log durably replicated so no acknowledged edit is ever lost even if the session owner crashes immediately after.
- **Hot spots**: an unusually large collaborative session (dozens of people editing the same document at once — e.g., a shared meeting-notes doc) can push a single document's session owner and its broadcast fan-out past what one instance comfortably handles, since all clients' operations funnel through one owning session. Mitigation is generally about optimizing that single session's throughput (batching broadcasts, efficient transform/merge implementations) rather than sharding a single document further, since a document's edit ordering fundamentally needs one authoritative owner.
- **Consistency vs. availability**: this system favors availability and low local latency very strongly (a user's own typing is never blocked waiting on the network) while still requiring eventual strong convergence — everyone must agree on the final content. This is a good illustration that "eventual consistency" doesn't mean "consistency doesn't matter," it means the *guarantee* (all replicas converge) is preserved even though the *timing* of when everyone agrees is relaxed.
- **What breaks first at 10x/100x scale**: per-document load rarely grows 10x-100x (human typing speed and realistic concurrent-editor counts don't scale with the platform), so the strain at higher scale shows up almost entirely in the *number* of simultaneous documents/sessions the platform hosts, not any single document's complexity — this pushes toward more session-owner instances and better routing/load-balancing of documents across them, and toward more aggressive snapshot compaction so cold-document reload doesn't require replaying an ever-growing operation history.

## 38.7 Summary

The defining challenge of a collaborative document editor is guaranteeing that every client converges on identical content despite concurrent, independently-typed edits arriving in different orders at different times — solved either through Operational Transformation's central transform function or a CRDT's order-independent-by-construction data structure, both layered under an optimistic-local-edit, WebSocket-broadcast propagation model that keeps latency low. Unlike most systems in this course, the scale challenge here is breadth (millions of small, independent sessions) rather than depth (one massive session), which shapes a design built around cheaply hosting many small, per-document authorities rather than one large shared system.

Natural follow-ups an interviewer might raise: extending the same conflict-resolution machinery to rich formatting and structured content (tables, embedded objects) rather than plain text, and supporting robust offline editing with a longer reconciliation window (a client that was offline for hours needs to merge a large batch of local edits against a large batch of remote edits, which is a harder version of the same convergence problem at a coarser granularity).
