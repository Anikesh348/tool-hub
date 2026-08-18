> **Learning goal**
> Design a one-to-one and group messaging system like WhatsApp, and be able to explain how real-time delivery, ordering, receipts, and offline queuing work together.

## 12.1 Requirements and scope

**Functional requirements**

- Send a text message from one user to another (1:1 chat).
- Support group chats (a bounded number of participants, say up to a few hundred).
- Deliver messages in near real time when the recipient is online.
- Queue messages for delivery when the recipient is offline, and deliver them when they reconnect.
- Show delivery state: sent, delivered, read.

**Out of scope** (explicitly, to bound the problem): voice/video calls, media (images/video) transfer pipeline, status/stories, payments, multi-device sync details beyond a brief mention. These are real WhatsApp features but each is its own deep dive; naming them and setting them aside is part of doing this exercise well.

**Non-functional requirements**

- **Low latency** — a message should reach an online recipient in well under a second; this is a chat app, not a batch system.
- **High availability** — the system should keep accepting and queuing messages even if parts of the backend are degraded. Users tolerate a message arriving a few seconds late far more than they tolerate the app being unusable.
- **At-least-once delivery, never message loss** — losing a message silently is unacceptable; duplicate delivery is acceptable if the client can de-duplicate.
- **Ordering matters within a conversation** — messages in one 1:1 or group chat must appear in a consistent order to all participants, even if global ordering across unrelated chats does not matter at all.
- **Consistency vs. availability position**: this system leans towards availability for the "is the service up" question, but leans towards strong per-conversation ordering and durability for the messages themselves. It is fine if a message is delivered a second later than another; it is not fine if it is delivered out of order or dropped.

## 12.2 Scale estimation

Assumptions, stated explicitly:

- 500 million daily active users (DAU).
- Each user sends roughly 40 messages/day on average (mostly short text). That gives roughly 20 billion messages/day.
- Average message payload (text + metadata: sender, conversation id, timestamp, message id) is about 200 bytes.

**Traffic**

- 20 billion messages/day ÷ 86,400 seconds ≈ 230,000 messages/second average.
- Consumer messaging is bursty around evenings/holidays; assume a 3x peak factor → roughly 700,000 messages/second at peak.
- Each message typically fans out to at least one recipient connection (1:1) and up to hundreds for large groups, so the *delivery* rate (message-deliveries, not messages-sent) is higher than the send rate — call it 2-3x on average once group chats are folded in.

**Storage**

- 20 billion messages/day × 200 bytes ≈ 4 TB/day of raw message data.
- Over a year that is well over 1 PB, which immediately says: this cannot live in a single database instance, and it argues for a storage engine designed for high write throughput with simple access patterns (append messages, read a conversation's recent history) rather than a system optimized for complex joins.

**Connections**

- Not all 500M DAU are connected simultaneously, but a large fraction are (chat apps are typically kept open/backgrounded with a persistent connection). Assume 150-200 million concurrent long-lived connections at peak.
- A single modern server can hold on the order of hundreds of thousands of idle WebSocket-style connections (bounded mostly by memory per connection and file descriptor limits), so this alone implies thousands of connection-handling servers, each responsible for a shard of users.

These numbers drive two decisions used throughout this lesson: (1) message storage needs a horizontally-scalable, write-optimized store, not a single relational database, and (2) "who is connected to which server" is itself a piece of state that has to be tracked and looked up on every message send, because at this scale no single server can hold all connections.

## 12.3 API and data model

**API** (mostly delivered over a persistent connection, but shown here as logical operations):

| Operation | Description | Request | Response |
| --- | --- | --- | --- |
| `CONNECT` | Establish a long-lived connection, authenticate | `{authToken}` | `{connectionAck}` |
| `SEND_MESSAGE` | Send a message into a conversation | `{conversationId, clientMsgId, body, timestamp}` | `{serverMsgId, status: "sent"}` |
| `ACK_DELIVERED` | Recipient's client confirms receipt | `{serverMsgId}` | — |
| `ACK_READ` | Recipient's client confirms the message was viewed | `{serverMsgId}` | — |
| `GET /conversations/{id}/messages?before={msgId}&limit=50` | Paginate conversation history (for reconnect/scrollback) | — | `{messages: [...]}` |
| `POST /conversations` | Create a group conversation | `{participantIds, name}` | `{conversationId}` |

The `clientMsgId` is generated on the device before send, so that if the network drops after the send but before the ack arrives, the client can safely retry without creating a duplicate message — the server treats `(senderId, clientMsgId)` as an idempotency key.

**Core entities**

- `User { userId, phoneNumber, ... }`
- `Conversation { conversationId, type: 1:1|group, participantIds[] }`
- `Message { messageId, conversationId, senderId, clientMsgId, body, timestamp, sequenceNumber }`
- `DeliveryStatus { messageId, userId, state: sent|delivered|read, updatedAt }`
- `Connection routing state: userId -> {serverId, connectionId}` — ephemeral, lives in a fast key-value store, not the durable message store.

**SQL vs. NoSQL.** The dominant access pattern is: append a new message to a conversation, and read the last N messages of a conversation ordered by time — a narrow, high-throughput, key-based access pattern (partition key = conversationId) with no need for joins across unrelated conversations. That is exactly the profile a wide-column / key-value store (e.g., something like Cassandra or DynamoDB in spirit) is built for: it scales writes horizontally by partitioning on conversationId, and a range query "give me the last 50 messages for this conversation" is a single-partition range scan, which those stores make cheap. A traditional relational database would work for a small deployment, but at the billions-of-messages-per-day scale from Section 12.2, sharding a relational system yourself to get the same property is reinventing what these stores already do. User/account metadata (phone number, profile, contact list), which is comparatively low-volume and benefits from stronger transactional guarantees, is a reasonable candidate to keep in a relational store instead — different data, different access pattern, different choice.

## 12.4 High-level architecture

```text
Sender's Device
   |
   v
Load Balancer  --(sticky-ish routing not required; connection is stateful per-server)
   |
   v
Gateway / Connection Server (holds a long-lived WebSocket per online user)
   |
   |--- writes message ---> Message Store (partitioned by conversationId)
   |--- looks up ---------> Presence/Routing Service (userId -> which gateway server, if online)
   |
   v (if recipient online, found on gateway G2)
Gateway G2 ---> pushes message over recipient's open connection
   |
   v (if recipient offline)
Offline Queue (per-user, durable) ---> delivered on reconnect
   |
   v
Push Notification Service (APNs/FCM) ---> wakes the recipient's device so it reconnects
```

**Write path (sending a message).** The sender's client is connected to some gateway server (say G1). It sends `SEND_MESSAGE` over that connection. G1 first writes the message durably to the Message Store, keyed by `conversationId`, and assigns it a monotonically increasing sequence number *within that conversation* (more on this in the deep dive). Only after the durable write succeeds does G1 ack "sent" back to the sender — this ordering (durable-write-then-ack) is what guarantees the "never lose a message" requirement even if G1 crashes immediately after.

**Read/delivery path.** G1 then asks the Presence/Routing Service where the recipient's connection currently lives. Three cases:

1. Recipient is online, connected to some gateway (possibly G1 itself, possibly G2). The routing service returns that gateway's address, and the message is forwarded there for immediate push over the recipient's socket. This is the sub-second path.
2. Recipient is offline. The message is appended to a durable per-user offline queue and a push notification is sent through APNs/FCM so the OS wakes the app, which reconnects and drains its queue.
3. Recipient is online but on a different data center/region. The same lookup-and-forward happens, just across a cross-region hop, which is why the routing service itself needs to be either globally consistent or the design needs to accept a slightly longer path for cross-region messages.

**Reconnect path.** On reconnect, a client always asks "give me everything since sequence number N for each of my conversations" rather than relying purely on push, so a client that missed pushes (phone was off) still catches up correctly. This makes the offline queue mechanism and the "pull on reconnect" mechanism complementary, not redundant — push gets you speed when online, pull guarantees correctness regardless of what pushes were missed.

## 12.5 Deep dive: real-time delivery, ordering, receipts, offline queuing, and E2E encryption

This is the heart of the problem, so it is worth walking through each piece concretely.

**Why long-lived connections instead of polling.** HTTP polling (client asks "any new messages?" every few seconds) wastes bandwidth and adds latency up to the poll interval. A persistent connection (WebSocket, or a custom TCP protocol over TLS, which is what real chat apps typically use for efficiency) lets the server push a message the instant it arrives, and lets the server detect disconnects quickly via heartbeats. The cost is that connections are stateful — each gateway server holds a table of `connectionId -> socket`, and that state has to be tracked somewhere else too (the Presence/Routing Service) so other servers can find it. This is why "which server holds this user's connection" is modeled as its own lookup rather than assumed to be discoverable by hashing the userId directly — servers come and go, users reconnect to different servers after restarts or deploys, so the mapping has to be dynamic, typically kept in a fast in-memory store like Redis with a short TTL that's refreshed by heartbeats.

**Per-conversation ordering.** Global ordering across all of WhatsApp's messages is meaningless and unenforceable at this scale — but ordering *within one conversation* is something users will notice immediately if it breaks ("B" appearing before "A" when A was typed first). The trick is to scope the ordering guarantee narrowly: every message is assigned a sequence number that only needs to be monotonically increasing *per conversationId*, not globally. Because all messages for a given conversation are written to the same partition in the Message Store (recall the data model choice from 12.3 — partition key is conversationId), a single partition can hand out sequence numbers with a simple increment, with no cross-partition coordination needed. This is a direct payoff of the earlier data-modeling decision: by partitioning on the thing that needs an ordering guarantee, ordering becomes a local, cheap operation instead of a distributed-consensus problem.

**Delivery and read receipts.** Three states — sent, delivered, read — map to three points in the pipeline:

- *Sent*: the server durably stored the message and acked the sender. This only proves the server has it, not that the recipient has.
- *Delivered*: the recipient's device received the message over its connection (or drained it from the offline queue) and sent back an `ACK_DELIVERED`. The server updates `DeliveryStatus` and — importantly — forwards that ack back to the *original sender's* connection so their client can flip the checkmark. This means an ack is itself a small message that has to be routed the same way a chat message is, through the same presence lookup.
- *Read*: the recipient's client, once the user has actually viewed the message (a client-side UI event, not a server inference), sends `ACK_READ`, which is relayed back the same way. Because "read" is a client-observed event, the server cannot compute it — it can only relay it, which is a useful thing to notice: not every piece of "delivery state" is server-derived.

A subtlety worth naming: for group chats, "delivered"/"read" is really a *per-recipient* status, so a group message conceptually fans out into N delivery-status records, one per participant, and the UI aggregates them (e.g., "read by 3 of 8").

**Offline queuing.** When the routing lookup shows a recipient has no active connection, the message doesn't get dropped — it gets appended to a durable, per-user queue (logically like a personal mailbox). This queue must be durable for the same reason the main message store is: a device could stay offline for days. On reconnect, the client's job is simple and symmetric with the message store's ordering property: "give me everything queued since the last sequence number I saw, per conversation." A push notification (APNs/FCM) is the *trigger* that gets the OS to wake the app so it can reconnect and drain the queue promptly, but it is not itself the delivery mechanism — this separation matters because push notification services are best-effort and can be delayed or dropped by the OS, whereas the durable queue plus pull-on-reconnect guarantees eventual delivery regardless of whether the push arrived.

**End-to-end encryption, at a high level.** The property being engineered for is: only the sender's and recipient's devices can read the message content — the server stores and routes ciphertext it cannot decrypt. Conceptually this works by each device holding a key pair; when starting a conversation, devices exchange public keys (often via a protocol that also supports "forward secrecy," meaning even if a key is compromised later, past messages stay unreadable) and every message is encrypted on the sender's device with a key derived for that specific message before it ever leaves the device. The server's job in the architecture above does not change at all — it still routes and durably stores an opaque blob keyed by conversationId and sequence number — which is a good sign for the design: encryption is a payload-level concern layered on top of a routing/storage architecture that doesn't need to know or care what's inside the message. The one real architectural wrinkle is multi-device support (a user with the app open on both a phone and a laptop): each device typically needs its own key material, so a sent message may need to be encrypted separately per recipient-device rather than once per recipient-user, which increases fan-out slightly but doesn't change the overall shape of the pipeline.

## 12.6 Bottlenecks and trade-offs

- **Single points of failure.** Each gateway server holds live connection state that isn't trivially replicated; if a gateway crashes, every connection it held drops. The mitigation is cheap reconnect: clients are built to reconnect immediately to a new gateway (via the load balancer) and re-sync via "give me everything since sequence N," so a gateway crash becomes a brief hiccup rather than data loss, because durability lived in the Message Store and offline queue, not in the gateway.
- **Hot spots.** Large group chats (hundreds of participants) are the clearest hot spot — one message write turns into hundreds of routing lookups and pushes. At extreme scale (broadcast-list-like use cases), this starts to resemble the fan-out problem covered in the Twitter/Instagram lessons, and the same fan-out-on-write vs. fan-out-on-read trade-off applies: for very large groups, it can be cheaper to have recipients pull recent messages on reconnect/open rather than pushing individually to hundreds of live connections synchronously.
- **Consistency vs. availability.** The design deliberately chooses strong per-conversation ordering (via the partitioned sequence number) while staying available for the system as a whole (durable per-user offline queues absorb outages instead of rejecting sends). This matches the non-functional requirements from 12.1: never lose a message, keep ordering within a chat, but tolerate the system being "eventually" delivering rather than instantly for every message.
- **What breaks first at 10x scale (5 billion DAU-equivalent load).** The Presence/Routing Service is the first thing to feel pressure — it is on the hot path of every single message (sender lookup is implicit via its own gateway, but recipient lookup happens every time) and needs to answer in milliseconds at hundreds of thousands of queries per second. It would need to be sharded by userId across many nodes with replication for availability. The Message Store scales more gracefully because it was chosen specifically for horizontal write scaling from the start (Section 12.3), so it mostly needs more partitions and more nodes, not a redesign.
- **What breaks at 100x.** Cross-region delivery latency becomes the dominant user-facing problem — routing lookups and message forwarding that cross data centers add real latency, so a 100x design would need regional gateway clusters with a global (but eventually consistent, and refreshed frequently) directory of "which region is this user probably connected to," to avoid every message doing a global lookup.

## 12.7 Summary

This design turns "chat app" into three separable concerns: a **durable, ordered message store** partitioned by conversation so writes scale horizontally and per-conversation ordering falls out for free; a **connection/presence layer** that tracks who is reachable where, since no single server can hold all connections at this scale; and a **push-plus-pull delivery mechanism** (best-effort push notification to wake the client, durable queue plus sequence-number-based pull to guarantee correctness) that together give both speed and reliability. Delivery/read receipts are just small acks routed the same way as messages, and end-to-end encryption is layered on top as an opaque payload without changing the routing architecture.

Natural follow-ups an interviewer might push on next: how would you extend this to support multiple devices per user staying in sync (multi-device fan-out of both messages and encryption keys), and how would you support media messages (images/video) without bloating the message store — the likely answer being to store media in object storage/CDN and have the message itself carry a reference/URL rather than the bytes, which is exactly the pattern used in the Instagram and Spotify lessons.
