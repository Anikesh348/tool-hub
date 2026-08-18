> **Learning goal**
> Design a file sync and sharing system like Dropbox, and be able to explain how large files are chunked for efficient sync, how delta sync avoids re-uploading unchanged data, and how conflicting edits made offline on two devices get reconciled.

## 41.1 Requirements and scope

**Functional requirements**

- A user can upload a file/folder to their account, and it becomes available to download from any of their other devices.
- Changes made to a file on one device propagate to the user's other devices automatically (sync), without the user re-uploading the whole file manually.
- A user can share a file or folder with another user or via a public link.
- The system keeps a version history of a file and lets a user revert to a previous version.
- Sync must work reasonably well even when a device was offline for a while and reconnects with local changes.

**Non-functional requirements**

- **Bandwidth efficiency**: uploading/downloading an entire large file every time a small change is made (a one-line edit in a large document, for instance) is wasteful and slow — sync should transfer only what changed.
- **Durability**: a file, once synced, must not be lost — this is one of the most trust-critical properties a storage product has.
- **Eventual consistency across devices**: it's acceptable for a change to take a few seconds to propagate to another device, but every device must eventually converge on the same file content (or a well-defined conflict artifact if two edits genuinely conflict — see below).
- **Offline support**: a device without connectivity should still let the user read and edit local files, syncing once connectivity returns.
- **Scale**: hundreds of millions of users, files ranging from tiny documents to multi-gigabyte media files, with heavy skew toward a small number of very active/large files per user.

**Out of scope**: real-time collaborative co-editing within a single file while online (that's the Google Docs lesson — this lesson assumes a file is generally edited by one device at a time, with occasional offline conflicts as the exception, not simultaneous live editing as the norm), granular in-file permissions, malware scanning.

## 41.2 Scale estimation

Stated, round assumptions:

- **Users and devices**: assume 500 million users, averaging 3 devices each → 1.5 billion syncing devices.
- **File uploads**: assume the average active user changes/uploads a few files per day — say 5 million users actively syncing changes at any given hour, each producing a handful of change events → on the order of **tens of thousands of file-change events/sec** at peak platform-wide, dominated by the sheer number of users rather than any single user's activity.
- **File size distribution**: heavily skewed — most files are small (documents, code, photos, a few KB to a few MB) but a meaningful fraction are large (videos, disk images, multi-GB backups) — this skew is exactly why chunking (Section 41.5) matters: treating "upload a file" as one atomic blob transfer is fine for a 20 KB document but is slow, fragile (a network blip mid-transfer means starting over), and wasteful (a 1-byte edit to a 2 GB file shouldn't mean re-uploading 2 GB) for the large end of the distribution.
- **Total storage**: assume an average of 20 GB stored per user (photos, documents, videos accumulate) × 500 million users ≈ **10 exabytes** of total stored data — an enormous figure that immediately rules out anything but a horizontally distributed object storage layer (the same foundational problem as the distributed-cloud-storage lesson later in this course; this lesson treats "durable blob storage at this scale" as a building block rather than re-deriving it, and focuses on the sync-specific problems layered on top).
- **Sync/metadata traffic**: separate from the actual file bytes, every device needs to know "what changed since I last synced" — this is comparatively small (metadata: filenames, chunk hashes, version numbers) but needs to be read frequently (every device periodically checks or subscribes for updates), making metadata query volume, not metadata storage volume, the relevant scaling concern.

The dominant insight: this system layers a **sync protocol** (chunking, delta detection, conflict handling) on top of a **durable blob storage layer**, and the two need to be reasoned about somewhat separately — bulk storage capacity is a solved, horizontally-scalable problem; efficient, correct multi-device sync is the genuinely interesting part.

## 41.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /files/{id}/chunks/check` | `{ "chunkHashes": [...] }` | `{ "missingChunks": [...] }` (which of these chunks the server doesn't already have) |
| `PUT /chunks/{hash}` | Raw chunk bytes | `201 Created` |
| `POST /files/{id}/commit` | `{ "chunkList": [hash1, hash2, ...], "baseVersion": N }` | `{ "newVersion": N+1 }` or `409 Conflict` |
| `GET /files/{id}/changes?sinceVersion=` | — | `{ "chunkList", "version" }` for the current state, used by other devices to sync down |
| `GET /sync/subscribe` (long-lived, push) | — | Stream of `{ "fileId", "newVersion" }` events for changed files across the account |

The chunk-centric shape of this API (check → upload missing chunks → commit a new chunk list) is deliberate — it's what makes delta sync possible (Section 41.5), rather than a simpler "upload the whole file" endpoint that would defeat the bandwidth-efficiency requirement.

**Data model**

Core entities:

- `File { id (PK), ownerId, name, path, currentVersion, sizeBytes }`
- `FileVersion { fileId, version, chunkList (ordered list of chunk hashes), createdAt, deviceId }` — each version is really just a manifest: an ordered list of which chunks make up the file at that version, not the file content itself.
- `Chunk { hash (PK), sizeBytes, storageLocation }` — the actual content-addressed blob data, stored once regardless of how many files/versions reference it.

The most important modeling decision here is **content-addressed, deduplicated chunk storage**: chunks are keyed by a hash of their own content (not by which file they belong to), so if two different files — or two versions of the same file — happen to share an identical chunk (extremely common: an unchanged portion of a large edited file, or two users independently uploading the same stock photo), that chunk is stored exactly once and simply referenced from multiple `FileVersion` manifests. This is a natural fit for a **key-value store** keyed by chunk hash, since the access pattern is pure point lookups by a well-distributed key (a hash), with no need for relational structure at the chunk-storage layer. The `File`/`FileVersion` metadata, by contrast, has real relational structure (a file has many versions, a version has an ordered list of chunks, a user has many files) and benefits from a relational or document database for that structured querying — again, the familiar split between a simple high-volume key-value layer for content and a smaller structured store for metadata.

## 41.4 High-level architecture

```text
Client (local sync agent)
   -> detects local file change -> chunk the file, hash each chunk
   -> Sync Service: "check which chunks are missing" -> Chunk Store (content-addressed, dedup'd, backed by object storage)
   -> upload only missing chunks -> Chunk Store
   -> commit new version (chunk list + baseVersion) -> Metadata Service -> Metadata DB
                                                                |
                                                                v
                                          Change notification -> Sync Service -> push to other devices
                                                                                       |
                                                                                       v
                                                                    Other device: pull changed chunk list,
                                                                    download only chunks it doesn't already have locally
```

**Upload/change path**: when a local sync agent detects a file change, it re-chunks the file (Section 41.5 covers the chunking strategy in detail), hashes each chunk, and asks the Sync Service which of those chunk hashes the server doesn't already have (deduplication check). It uploads only the missing chunks to the Chunk Store, then commits a new file version — an ordered manifest of chunk hashes — to the Metadata Service, which validates the commit against the expected `baseVersion` (rejecting with a conflict if another device already committed a newer version first, the trigger for conflict handling in Section 41.5) and writes the new version record.

**Sync-down path**: other devices for the same account are subscribed (via a long-lived push channel, or periodic polling as a fallback) for change notifications. On receiving one, a device fetches the new version's chunk manifest, compares it against the chunks it already has locally (many chunks are typically unchanged and already present), and downloads only the missing/changed chunks — the same dedup logic applied symmetrically on the download side.

**Sharing**: sharing a file/folder is primarily a metadata-layer operation (granting another user's account read/write access to a `File` record and its version history) rather than a data-copying operation — the underlying chunks are unaffected and are simply now referenced by more than one user's access-control entries.

## 41.5 Deep dive: chunking, delta sync, and offline conflict resolution

### Chunking large files

The first design decision is how to split a file into chunks at all. The simplest approach — **fixed-size chunking** (e.g., split every file into 4 MB blocks at fixed offsets) — has a subtle but serious flaw when it comes to detecting what changed: inserting or deleting even a single byte near the start of a file shifts every subsequent fixed-size boundary, meaning every chunk after the edit point hashes differently from before, even though most of the file's actual content didn't change. This defeats the whole purpose of delta sync for exactly the kind of edit (an insertion, not just an in-place overwrite) that's extremely common in real usage.

The standard fix is **content-defined chunking**: instead of cutting at fixed byte offsets, a rolling hash function scans the file's byte stream and declares a chunk boundary whenever the rolling hash of the current window satisfies some condition (e.g., its low bits equal a fixed pattern) — a boundary rule that depends only on local content, not absolute position in the file. Because the boundary decision is based on a sliding local window of content rather than a fixed distance from the start of the file, an insertion near the beginning of the file shifts the *position* of later boundaries but not the *content* on either side of each boundary — so the chunks on either side of and after the insertion point still hash identically to before, and only the chunk(s) actually containing the new bytes differ. This is what makes delta sync effective for real-world edits like insertions and deletions, not just pure in-place overwrites.

### Delta sync: transferring only what changed

Once a file is chunked this way, "sync a change" reduces to a three-step protocol already implied by the API in Section 41.3: hash all current chunks locally, ask the server which of those hashes it doesn't already have, and upload only those. For a large file with a small localized edit, this means the vast majority of chunks are already present on the server (from the previous version, or even from an entirely different file that happens to share content) and only a small number of new/changed chunks actually cross the network — turning what would be, say, a 2 GB re-upload into a transfer of a few MB. The same logic runs symmetrically on the download side for every other device syncing the change, and the content-addressed, hash-keyed chunk store (Section 41.3) is what makes the "do you already have this?" check a cheap point lookup rather than requiring any per-file bookkeeping about which device has which bytes.

An important secondary benefit of content-addressing falls out of this design essentially for free: **cross-file and cross-user deduplication**. If two completely unrelated files (or two different users' files) happen to contain an identical chunk, it's stored exactly once, referenced by both files' manifests — this is a direct, low-effort consequence of keying chunk storage by content hash rather than by file/owner, and can meaningfully reduce total storage at the scale established in Stage 2, especially for common file types where large shared regions are more likely (software installers, stock templates, common media).

### Handling offline conflicts

The genuinely hard problem: a user edits the same file on two devices while both are offline (or otherwise unable to sync with each other), then both reconnect. Both devices believe they have the latest version, and both have made real, independent, potentially incompatible changes — this is a true conflict, not something a background process can always safely resolve unilaterally.

**Detecting the conflict.** Every commit (Section 41.3's `POST /files/{id}/commit`) carries the `baseVersion` the device believed it was building on. If Device A commits version 5 based on version 4, and Device B — which had also been at version 4 while offline — later tries to commit its own changes also based on version 4, the server rejects Device B's commit with a conflict (version 4 is no longer current; version 5 already superseded it) rather than silently overwriting Device A's changes or silently merging byte streams that were never designed to be merged. This mirrors the same optimistic-concurrency, conditional-write pattern used for the atomic driver-acceptance and order-state-transition problems in earlier lessons in this course — a write is only accepted if the state it assumes is still current.

**Resolving the conflict.** Unlike a structured data record (where a conflict might sometimes be automatically mergeable field by field) or a CRDT-based collaborative document (where the data structure is explicitly designed for order-independent merging), an arbitrary binary or text file has no general-purpose safe way to automatically merge two independently modified versions without risking silently corrupting the user's data or losing content either side cared about. The standard, pragmatic approach is **not** to attempt an automatic content merge at all for the general case: the losing device's changes are preserved as a separate artifact — commonly saved as a conflicted copy (e.g., `report (conflicted copy, Device B, 2026-08-08).docx`) alongside the winning version, and the user is left to manually reconcile the two if needed. This is a conscious, product-level trade-off: it sacrifices a "seamless" automatic merge (which, for arbitrary file content, cannot be done safely and generally) in favor of never silently discarding a user's work — a strong bias toward the durability/never-lose-data requirement from Stage 1, in tension with the ideal of frictionless sync, and the conflicted-copy approach resolves that tension by keeping both, rather than choosing between "guess which one is 'right'" and "risk losing one entirely."

A narrower class of files (some structured formats, or products that layer a CRDT-style editor on top, as in the Google Docs lesson) can support smarter automatic merging, but that requires format-aware logic specific to that file type — it's not a general solution applicable to arbitrary files, which is the scope of a general-purpose file-sync product like this one.

## 41.6 Bottlenecks and trade-offs

- **Single points of failure**: the Metadata Service (which owns version numbers and conflict detection) is a SPOF for the correctness of the commit/conflict protocol specifically — mitigated with standard database replication/failover, and by keeping the service itself stateless so any instance can process any file's commit (state lives in the versioned metadata store). The Chunk Store, being built on distributed object storage, is designed for durability and availability by construction (see the distributed-cloud-storage lesson for how that's achieved) rather than being a single point of failure itself.
- **Hot spots**: a small number of very large, frequently-changing files (e.g., a shared team document edited constantly, or a large log/database file kept in a synced folder) can generate disproportionate chunk-upload and metadata-commit traffic relative to a typical file — mitigated by rate-limiting/batching rapid successive local changes into fewer sync commits (not committing on every single keystroke-level filesystem event) rather than treating every change as an independently urgent sync.
- **Consistency vs. availability**: this system favors availability strongly for reads (a device can always read its local cached copy, online or offline) while requiring a real consistency guarantee at the commit step specifically (the `baseVersion` check) to correctly detect conflicts rather than silently losing data — a similar split to earlier lessons, where the vast majority of the system is eventually-consistent but one specific operation needs a hard, atomic guarantee.
- **What breaks first at 10x/100x scale**: at 10x users, the metadata store and chunk-existence-check path need horizontal sharding (naturally shardable by `fileId` or `chunkHash`, since neither needs cross-shard transactions). At 100x, the chunk-existence-check ("which of these hashes do you already have") becomes a genuinely high-volume point-lookup workload across an enormous, ever-growing key space, pushing toward a bloom-filter or similar probabilistic pre-check layer in front of the full chunk store to cheaply rule out "definitely don't have this chunk" without a full lookup, reducing load on the authoritative store for the common case of genuinely new content.

## 41.7 Summary

A file sync system's real complexity is not storing bytes durably (a solved problem at the object-storage layer) but syncing changes *efficiently* and *correctly* across multiple devices: content-defined chunking makes small edits produce small, localized diffs even when bytes are inserted or deleted (not just overwritten), delta sync transfers only the chunks that actually changed by checking content hashes against what the server already has, and offline conflicts are detected via optimistic version checks and resolved by preserving both versions as separate artifacts rather than risking an unsafe automatic merge of arbitrary file content.

Natural follow-ups an interviewer might raise: supporting real-time collaborative co-editing for specific file types (which pushes toward the CRDT/OT machinery from the Google Docs lesson for those formats specifically), and optimizing chunk transfer further with compression and multi-chunk parallel uploads for very large files.
