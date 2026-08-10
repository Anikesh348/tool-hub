> **Learning goal**
> Recognize the recurring, named trade-offs that system design interviews and real architectures keep coming back to, and build the habit of justifying a choice by its consequences rather than picking a side by default.

## 9.1 Overview

Most of system design is not memorizing the "correct" architecture — it's learning a short list of forks in the road that show up in nearly every design, and building the judgment to pick a side deliberately, with reasons. "Should this be synchronous or asynchronous? Strongly or eventually consistent? Scaled up or scaled out?" These are not questions with one universally right answer; they're questions where the right answer depends on what the system actually needs, and a strong engineer can articulate that dependency instead of reciting a rule.

This module walks through twelve of the trade-offs that appear over and over. They cluster loosely: some are about *how you add capacity* (vertical vs. horizontal scaling, concurrency vs. parallelism), some are about *how components talk to each other* (long polling vs. WebSockets, REST vs. RPC, synchronous vs. asynchronous, push vs. pull), some are about *how data is processed and kept consistent* (batch vs. stream, strong vs. eventual consistency, read-through vs. write-through caching), and some are about *fundamental properties you're optimizing for* (stateful vs. stateless, latency vs. throughput). None of these choices is free — each one buys you something by giving something else up. The goal of this module is to make that exchange explicit for each pair, so that when you face a design decision, you reach for a specific, named trade-off instead of a vague instinct.

## 9.2 Top System Design Trade-offs (a map, not a list to memorize)

Before diving into individual pairs, it helps to see why trade-offs are the right *unit of study* for system design in the first place, rather than individual technologies. A technology (Redis, Kafka, PostgreSQL) is just an implementation of a position on one or more of these trade-offs. Learning "Redis is a cache" is much less useful than learning "sometimes you want fast approximate reads at the cost of possible staleness, and Redis-backed caching is one way to buy that."

Nearly every trade-off in system design reduces to spending one desirable property to gain another, and the properties that get traded most often are: speed of an individual operation vs. total volume handled, immediate correctness vs. availability during failure, simplicity vs. flexibility, and cost vs. headroom for growth. When you look at almost any pair in this module through that lens, the pattern repeats:

```
Strong consistency      spends latency & availability     to buy   correctness guarantees
Vertical scaling        spends a ceiling on growth         to buy   operational simplicity
Synchronous calls       spends throughput & availability   to buy   simplicity & immediate results
Stateful design         spends horizontal scalability      to buy   fewer round trips & personalization
```

A useful discipline when you hit one of these forks in an actual design: name the trade-off explicitly ("I'm choosing eventual consistency here"), then justify it by pointing at a concrete requirement from earlier in the design ("...because this is a like-count, and a few seconds of staleness is invisible to users, but blocking every write on cross-region replication would hurt write latency for no real benefit"). That justification is what interviewers — and, more importantly, real production incidents — are actually testing for. The rest of this module works through each pair with exactly that kind of reasoning.

## 9.3 Vertical vs. Horizontal Scaling

When a system runs out of capacity, there are only two directions to grow in: make the existing machine bigger, or add more machines. **Vertical scaling** (scaling up) means giving a single server more CPU, memory, or faster disks. **Horizontal scaling** (scaling out) means adding more servers and spreading the work across them.

The motivating example is a database that's starting to slow down under load. Scaling vertically means moving it to a bigger instance — more RAM lets more of the working set live in memory, a faster CPU processes queries quicker. This requires no changes to the application's architecture: the database is still one machine, just a stronger one. Scaling horizontally means splitting the data across multiple database nodes (sharding) or adding read replicas, which lets the system handle far more total load than any single machine could — but now the application has to know how to route a query to the right shard, and operations that used to be a single-node transaction may now span multiple nodes.

```
Vertical:   [ small server ] -> [ bigger server ]           (same node, more power)
Horizontal: [ server ] -> [ server ][ server ][ server ]     (more nodes, shared load)
```

Vertical scaling's core limitation is that it has a ceiling — there's a maximum size of machine you can buy — and that machine remains a single point of failure; if it goes down, everything on it goes down. It's also comparatively cheap and simple at moderate scale, which is why most systems start there. Horizontal scaling removes the ceiling (in principle you can keep adding nodes indefinitely) and improves fault tolerance (losing one of many nodes is a partial, survivable event), but it introduces real coordination costs: load balancing, data partitioning, and the harder consistency questions that show up later in this module.

In practice, production systems use both, applied to different layers. Stateless application servers scale out easily and cheaply because any instance can handle any request. Databases and caches, which hold state, are often scaled up first (bigger instance) because that avoids the complexity of sharding, and only scaled out once a single node genuinely can't keep up. The trade-off to internalize: vertical scaling is the simpler first move, horizontal scaling is the move that actually removes the ceiling — and knowing which one a given component needs depends on whether it's stateless or stateful, a distinction that comes up again directly in 9.6.

## 9.4 Concurrency vs. Parallelism

These two terms get used almost interchangeably in casual conversation, but they describe genuinely different things, and mixing them up leads to real design mistakes — reaching for more CPU cores when what you actually needed was better task scheduling, or vice versa.

**Concurrency** is about *structuring* a program to deal with multiple things happening around the same time — it doesn't require multiple CPUs at all. A single-core web server handling a thousand simultaneous connections is being concurrent: it rapidly switches attention between connections, making a little progress on each, especially useful while some of them are just waiting on I/O (a slow database call, a network request) where the CPU would otherwise sit idle. **Parallelism** is about actually *executing* multiple things at the exact same instant, which does require multiple processing units — multiple CPU cores, multiple machines — genuinely running different work simultaneously.

A concrete way to see the difference: imagine one chef in a kitchen juggling four dishes, checking on the oven, then chopping vegetables, then stirring a pot, switching rapidly between tasks — that's concurrency, one worker, interleaved progress. Now imagine four chefs, each cooking their own dish start to finish at the same time — that's parallelism, multiple workers, simultaneous progress.

```
Concurrency (1 core):   [Task A][Task B][Task A][Task C][Task B]...   (interleaved)
Parallelism (4 cores):  Core1: Task A ->->->->
                        Core2: Task B ->->->->
                        Core3: Task C ->->->->    (simultaneous)
```

These two properties are independent, not opposite ends of one spectrum — a system can be concurrent without being parallel (a single-core server juggling connections), parallel without being meaningfully concurrent (a task split into independent chunks that each run start-to-finish on their own core), both at once (a multi-core server handling many independent, multi-step requests), or neither (a simple script that does one thing after another).

The practical gotcha is that concurrency is about *managing* many things, and it comes with its own hazards — race conditions, deadlocks, the need for locks or other synchronization — even on a single core, because task switching can happen in the middle of an operation you assumed was atomic. Parallelism's main cost is that not every problem can actually be split into independent chunks; some computations are inherently sequential (each step needs the previous step's result), and throwing more cores at them doesn't help. When you're evaluating "should this be async/concurrent" versus "should this be parallelized across more machines," the right question is whether the bottleneck is *waiting* (favor concurrency) or *computing* (favor parallelism).

## 9.5 Long Polling vs. WebSockets

Plain HTTP is built around a strict request-response model: the client asks a question, the server answers, and the connection is done. That's a mismatch for anything that needs to feel "live" — a chat message arriving, a notification badge updating, a live score changing — because the server has no way to proactively tell the client "something happened" without the client asking first.

**Long polling** works around this without abandoning ordinary HTTP: the client sends a request, and instead of the server answering immediately, it holds the connection open until either new data becomes available or a timeout is reached — then the client immediately opens a new request and repeats the cycle. It looks like the server is "pushing" data, but it's really the client re-asking, over and over, cleverly timed so it feels near-instant.

```
Client -> "anything new?" -> Server holds request open...
                              ...new data arrives -> Server responds
Client -> "anything new?" -> (immediately re-asks) -> Server holds again...
```

**WebSockets** take a fundamentally different approach: the client and server perform one handshake to upgrade an ordinary HTTP connection into a persistent, full-duplex socket, and after that, either side can send a message to the other at any time, with no need to re-establish a connection or repeat a request. This removes the repeated handshake overhead of long polling entirely and gives genuinely low latency, since a new message doesn't have to wait for a client-initiated request cycle.

The trade-off is complexity and resource shape. Long polling is simple to implement, works through virtually any firewall or proxy (it's just HTTP), and is a reasonable choice for low-frequency updates like occasional notifications — but it holds many connections open on the server waiting for something to happen, and it adds latency equal to however long a round trip plus reconnect takes. WebSockets give near-instant, low-overhead bidirectional messaging, ideal for chat applications, multiplayer games, and live dashboards — but they require the server to maintain a persistent open connection per client (which has its own memory and scaling cost), some older or more restrictive network infrastructure blocks WebSocket upgrades, and the client-side and server-side code is meaningfully more involved than firing off HTTP requests. A related option worth knowing about is **Server-Sent Events (SSE)**, a simpler middle ground for cases where data only needs to flow server-to-client, not both directions.

## 9.6 Batch vs. Stream Processing

Data processing systems have to decide when work gets done relative to when data arrives: all at once, on a schedule, after a bunch has piled up — or continuously, as each piece of data shows up.

**Batch processing** collects data over a window of time — an hour, a day, a week — and then processes the whole accumulated set in one pass. Think of a nightly job that reconciles every transaction from the day and produces a billing report each morning. **Stream processing** handles each piece of data as it arrives, continuously, with results available within milliseconds to seconds rather than hours.

```
Batch:   [-------- accumulate all day --------] -> [process everything at 2am] -> report ready
Stream:  event -> process -> result   event -> process -> result   event -> process -> result
         (continuous, as each event arrives)
```

The reason this trade-off exists rather than everyone just always using streaming is that batch processing is genuinely simpler to reason about and often more efficient per unit of data: it can apply optimizations across the whole dataset at once (better compression, bulk I/O, deduplication across the full window) that a system processing one event at a time can't. It's the right fit whenever the *answer doesn't need to exist yet* — end-of-day billing, monthly reports, large-scale historical analytics.

Stream processing exists for the cases where waiting is the actual problem — fraud detection needs to flag a suspicious transaction within seconds, not find it in tomorrow's batch report; a live dashboard showing current active users needs to be current, not a snapshot from six hours ago. The cost is real added complexity: stream systems have to deal with data arriving out of order, have to maintain running state incrementally instead of computing fresh over a complete dataset, and have to define what "done" even means for a continuous, theoretically infinite stream of events.

A common middle ground worth knowing is **micro-batching** (used by systems like Spark Streaming), which processes small batches every few seconds — not truly event-by-event, but close enough to feel real-time while keeping much of batch processing's operational simplicity. When choosing between the two for a design, the deciding question is almost always: does a stale answer from an hour ago actually hurt anyone, or does the value of the insight expire within seconds?

## 9.7 Stateful vs. Stateless Design

This trade-off is about whether a server remembers anything about a client between one request and the next. **State**, in this context, means any data tied to an ongoing interaction — a logged-in session, a shopping cart, a game's current position — as opposed to data that's just permanently stored (like a user's profile in a database, which any server can look up).

A **stateful** server keeps that per-client context in its own memory or local storage across requests. A **stateless** server doesn't — every request must arrive with everything the server needs to handle it, because the server has no memory of what happened before. Consider a shopping cart: a stateful implementation keeps the cart's contents in the memory of whichever server the user first connected to, so later requests need to reach that *same* server (usually enforced with "sticky sessions" at the load balancer). A stateless implementation instead has the client hold a token (or the server stores cart contents in a shared external store like Redis, reachable by every server) — so any server can handle any request from that user, because nothing needed for the request is missing.

```
Stateful:   Client -> Load Balancer -> [always Server A]  (Server A remembers the cart)
Stateless:  Client -> Load Balancer -> [Server A, B, or C — any of them]
                                        (cart data travels with the request, or lives externally)
```

Statelessness is what makes horizontal scaling (9.3) genuinely easy: because any server can handle any request, you can add or remove servers freely without worrying about which server "owns" a given user's context, and a server crashing doesn't lose anything because it wasn't holding anything unique. This is why REST APIs, most microservices, and CDN edge nodes are designed stateless by convention. The cost is that stateless designs need somewhere else for state to live — a shared session store, a client-held token — and requests may need to carry more information each time (a JWT token, a cart ID) instead of relying on server memory.

Stateful design earns its keep in scenarios where the interaction really is a multi-step conversation and the round trips saved by "the server already remembers" matter — real-time multiplayer games, a live video call, a database connection that needs to preserve an open transaction. The gotcha in both directions: forcing state into a stateless model without an external store just re-creates statefulness informally and loses the benefit (a session "pinned" to one server because that's the only place its data lives is stateful in every way that matters, whatever you call it); and building something genuinely stateful without a plan for what happens when that server dies is a reliability trap waiting to happen.

## 9.8 Strong vs. Eventual Consistency

When data is replicated across multiple nodes — for availability, for speed, for geographic proximity to users — you have to decide how quickly a write on one replica needs to be visible to a read on another. That decision is what "consistency model" means in distributed systems.

**Strong consistency** guarantees that once a write completes, every subsequent read from any replica will see that write (or something newer) — the system behaves, from the outside, as if there were only one copy of the data, even though there are actually several. To achieve this, a write typically has to wait for acknowledgment from enough replicas before it's considered complete, which is real added latency, and if too many replicas are unreachable, the system may have to refuse the write entirely rather than risk disagreement — trading away availability to protect correctness.

**Eventual consistency** relaxes that guarantee: a write is acknowledged quickly, often by just one node, and the update propagates to other replicas in the background. Reads immediately after a write, on a *different* replica than the one written to, may briefly return stale data — but if no new writes happen, every replica is guaranteed to eventually converge on the same value.

```
Strong:    Write -> wait for replicas to ack -> confirm to client -> ALL reads now see it
Eventual:  Write -> confirm to client immediately -> replicas sync in background
                                                       (a read elsewhere might lag briefly)
```

The deciding question is simple to state and genuinely important to get right: does a stale read cause real harm, or is it just cosmetic? A bank transfer needs strong consistency — reading a stale balance and allowing an overdraft is a real financial and correctness problem. A social media like-count or view-count is a great fit for eventual consistency — if it's briefly off by a few, essentially no one notices or cares, and demanding strong consistency there would only add latency for no real benefit. This is why banking systems, inventory counts, and distributed locks (from Module 7) lean strong, while social feeds, DNS, CDNs, and most analytics dashboards lean eventual.

It's also worth knowing that "eventual consistency" isn't one single guarantee — there are useful intermediate models, like **read-your-own-writes** (you always see your own recent updates, even if others haven't yet) and **monotonic reads** (once you've seen a value, you never see something older on a later read), which give applications a middle ground between full strong consistency and the loosest possible eventual model.

## 9.9 Read-Through vs. Write-Through Cache

Caching speeds up reads by keeping a copy of frequently accessed data somewhere faster than the primary data store — typically in memory. But a cache is only useful if it's kept honestly in sync with the underlying data, and there are a few standard patterns for how reads and writes interact with the cache, each with different trade-offs.

In a **read-through** cache, the application always asks the cache for data first. If the data is present ("a cache hit"), it's returned immediately. If it's absent ("a cache miss"), the cache itself is responsible for fetching the value from the underlying database, storing a copy, and then returning it — so the cache sits transparently in front of the database from the application's point of view. This is a great fit for read-heavy workloads with a "hot" subset of data accessed far more often than the rest, because once that hot data is cached, the vast majority of reads never touch the database at all.

In a **write-through** cache, every write goes to the cache and the underlying database *at the same time*, as a single logical operation, before the write is considered complete. This guarantees the cache is never stale relative to the database, at the cost of every write now paying the latency of two operations instead of one.

```
Read-through:                          Write-through:
Client -> Cache                        Client -> Cache -> Database
  (hit)  -> return cached value          (both updated together, write only
  (miss) -> Cache fetches from DB,        confirmed once both succeed)
            stores it, returns it
```

The motivating example for write-through is something like a seat-booking or inventory system, where letting the cache and the database drift apart — even briefly — could mean two customers are shown the same "available" seat that's actually already sold. Write-through closes that gap by making sure the cache is never ahead of, or behind, the source of truth.

It's worth knowing the two patterns these are usually compared against: **cache-aside** (the application itself checks the cache, and on a miss, manually fetches from the database and populates the cache — more manual, more common in simple setups), and **write-behind** (writes go to the cache immediately and are asynchronously flushed to the database later, which is fast but risks losing recent writes if the cache fails before flushing). The general trade-off across all of these: the closer you keep the cache and the database in lockstep, the safer your data is against staleness, but the more latency and complexity you pay on every write — so the right pattern depends entirely on how costly a stale or lost value would actually be for that specific piece of data.

## 9.10 Push vs. Pull Architecture

This trade-off is about who initiates the transfer of data between two systems — the sender or the receiver. It shows up constantly, from how monitoring systems collect metrics to how content gets delivered to end users.

In a **push** model, the producer of data proactively sends it to the consumer as soon as it's available, without being asked. A notification service pushing an alert to your phone the instant something happens is a push design — the server initiates. In a **pull** model, the consumer periodically asks the producer, "do you have anything new for me?" — the receiver initiates, on its own schedule.

```
Push:  Producer -> (sends data as soon as it's ready) -> Consumer
Pull:  Consumer -> "anything new?" -> Producer -> responds
       Consumer -> "anything new?" -> Producer -> responds   (repeated on an interval)
```

Push has the advantage of minimal latency — the moment data exists, it's on its way, with no delay waiting for the next poll — and it avoids wasted "anything new?" checks when nothing has actually changed. Its cost is that the producer has to know about every consumer and manage delivering to each one, which gets harder as the number of consumers grows and if a consumer is temporarily offline, the producer needs a retry or buffering strategy so the message isn't simply lost.

Pull flips those trade-offs. The consumer controls its own pace, which is simpler for the producer (it doesn't need to track who's listening or manage delivery — it just answers whoever asks) and naturally handles a consumer that's offline (it just picks up wherever it left off next time it polls). The cost is added latency (data sits until the next poll interval) and wasted work when polls come back empty, which is why polling intervals are a real design lever — too frequent and you waste resources on empty checks, too infrequent and data goes stale before the consumer notices.

A concrete comparison: a metrics-collection system that periodically *pulls* metrics from each service (like Prometheus's default model) is simpler to operate because the collector controls load and doesn't need to be told about every service instance in advance — it just knows where to poll. A real-time alerting pipeline, by contrast, is much better served by a *push* model, because a five-second polling delay on a critical alert could be the difference between catching an incident early and not. As with several other trade-offs in this module, the deciding factor is almost always latency sensitivity versus operational simplicity.

## 9.11 REST vs. RPC

Once you've decided two services need to talk over a network, you still need to decide the shape of that conversation — and REST and RPC represent two different philosophies for that.

**REST (Representational State Transfer)** models an API around **resources** — nouns, like a user or an order — manipulated through a small, standard set of HTTP verbs (GET to read, POST to create, PUT/PATCH to update, DELETE to remove). A REST API for orders might look like `GET /orders/123` to fetch an order and `POST /orders` to create one. This gives you a predictable, self-describing structure: anyone familiar with HTTP semantics can guess roughly how a well-designed REST API behaves without reading much documentation, and REST plays natively with the web's existing infrastructure — caching proxies, browsers, standard HTTP tooling all understand it for free.

**RPC (Remote Procedure Call)** models an API around **actions** — verbs, like `createOrder()` or `cancelSubscription()` — that look and feel like calling a function on a remote machine, even though it's actually a network call underneath. Modern implementations like gRPC define these calls with a strict schema (via Protocol Buffers), generate client and server code automatically from that schema, and communicate over an efficient binary format instead of human-readable JSON.

```
REST:  POST /orders {"item": "X"}          -> 201 Created {"orderId": 123}
       GET  /orders/123                     -> 200 OK {"id": 123, "status": "pending"}

RPC:   client.createOrder({item: "X"})     -> returns Order{id: 123}
       client.getOrder({id: 123})          -> returns Order{id: 123, status: PENDING}
```

The practical trade-off: REST's resource-oriented, text-based design is easier for humans to explore and debug (you can poke at a REST API with a browser or curl and read the response), and it's the natural choice for public-facing APIs consumed by many different, unpredictable clients, since HTTP and JSON are close to universally supported. RPC's contract-first, binary-encoded design is faster on the wire (smaller payloads, less parsing overhead) and gives you strong type safety and generated client code, which is why it's the common choice for internal service-to-service communication inside a microservices architecture, where every caller and callee is under your own control and raw performance matters more than human readability.

The gotcha worth internalizing: this isn't "REST is public APIs, RPC is internal APIs" as a strict rule — it's that REST optimizes for broad compatibility and discoverability, while RPC optimizes for performance and type-safety between systems you control, and you pick based on which of those two properties actually matters more for the specific integration you're building.

## 9.12 Synchronous vs. Asynchronous Communication

This is a close relative of several trade-offs already covered, but it's worth naming directly, because it's the most fundamental fork in how one part of a system asks another part to do something.

In **synchronous** communication, the caller sends a request and blocks — waits, doing nothing else — until it receives a response. A checkout flow calling a payment service and waiting for "approved" or "declined" before showing the user a confirmation is inherently synchronous: the user needs that answer before the interaction can meaningfully continue. In **asynchronous** communication, the caller sends a request (often by dropping a message onto a queue) and moves on immediately, without waiting for the work to finish — the result, if there is one, arrives later, through a separate channel: a callback, a notification, or the caller polling for status.

```
Synchronous:   Caller -> request -> [waits...] -> Service -> response -> Caller continues

Asynchronous:  Caller -> request -> Queue -> Caller continues immediately
                                       |
                                       v
                                  Worker processes it eventually -> (result delivered later)
```

The motivating example for asynchronous design is a photo or video upload: the user shouldn't have to sit and watch a spinner while the system generates thumbnails, runs content moderation, and updates a search index — those can all happen in the background after the upload itself is acknowledged, and the user can move on immediately. Making that synchronous would mean the user waits for the slowest part of a pipeline that doesn't actually need to block them at all.

Synchronous communication's advantage is simplicity: the caller gets an immediate, definitive answer, error handling is straightforward (the response either succeeded or it didn't, right now), and there's no need to build a separate mechanism for delivering results later. Its cost is that the caller is now coupled to the callee's availability and speed — if the payment service is slow or down, the checkout flow is stuck waiting right along with it, and under load, synchronous chains are exactly what causes the cascading-failure problem the circuit breaker pattern (Module 7) exists to contain.

Asynchronous communication decouples the caller from the callee's immediate availability and lets the system absorb bursts of work by queuing it rather than forcing the caller to wait or fail — but it adds real complexity: the caller needs a way to find out about the eventual result (or accept that it doesn't need to), and the system needs to handle cases like a worker crashing mid-task without losing the request. The deciding question, once again: does the caller genuinely need the result before it can do anything else useful, or is "acknowledge now, finish later" good enough? If it's the latter, asynchronous almost always wins on resilience and user-perceived speed.

## 9.13 Latency vs. Throughput

The last trade-off in this module is arguably the most fundamental performance concept in all of system design, and it's easy to conflate the two terms if you haven't had them pulled apart explicitly.

**Latency** is how long a single operation takes from start to finish — the delay experienced by one request. It's usually measured in milliseconds. **Throughput** is how much total work the system can get through in a given period of time — the volume, not the delay of any one item. It's usually measured in requests per second, or in a data pipeline, megabytes or gigabytes per second.

A classic analogy makes the distinction concrete: think of a highway. Latency is how long it takes one car to drive from the on-ramp to the off-ramp. Throughput is how many total cars pass a given point per hour. You can have low latency with low throughput (an empty highway where each car drives fast, but there simply aren't many cars), or high throughput with high latency (a highway packed bumper to bumper — huge numbers of cars get through per hour in aggregate, even though each individual car's trip now takes much longer because of congestion).

```
Low latency, low throughput:   [car]......................[car]......   (fast, sparse)
High throughput, high latency: [car][car][car][car][car][car][car][car] (slow-moving, dense)
```

These two aren't strictly opposed — a well-designed system tries to improve both — but they pull against each other under load in a specific, important way: as more requests compete for the same finite resources (CPU, network bandwidth, database connections), each individual request tends to wait longer in a queue behind the others, so latency rises even as throughput (the total volume processed) climbs toward the system's ceiling. Past that ceiling, throughput plateaus or drops (the highway is fully congested) while latency keeps getting worse, because work is piling up faster than it can be drained.

Which one matters more depends entirely on what the system is for. A multiplayer game or a stock-trading platform cares intensely about latency — a 200ms delay is a genuinely bad, sometimes disqualifying, experience, even if the system as a whole could handle huge request volume. A nightly analytics pipeline or a bulk data export cares intensely about throughput — nobody notices or cares if any single record took an extra 50 milliseconds, but everyone notices if the whole job can't finish overnight. Techniques like caching, CDNs, and geographically distributed servers primarily attack latency (getting data physically or logically closer to where it's needed); techniques like batching, connection pooling, and horizontal scaling (9.3) primarily attack throughput (getting more total work done per unit time). Knowing which one your system's users actually feel is often the single most important early decision in a design, because it quietly determines which class of solution — caching and proximity, versus parallelism and batching — you should be reaching for.

## 9.14 Summary and how these connect

Every pair in this module is a variation on the same underlying exercise: name what you're spending, and name what you're buying with it. Vertical vs. horizontal scaling spends operational simplicity or growth ceiling. Concurrency vs. parallelism spends CPU cores or scheduling complexity. Long polling vs. WebSockets, push vs. pull, and REST vs. RPC all spend implementation simplicity for lower latency or tighter coupling. Batch vs. stream and strong vs. eventual consistency spend immediacy for either processing efficiency or availability. Stateful vs. stateless spends memory and personalization for scalability. Read-through vs. write-through caching spends write latency for read-time safety. Synchronous vs. asynchronous communication spends immediate answers for resilience under load. And latency vs. throughput is the resource-contention pattern that quietly underlies almost every one of the other eleven.

None of these trade-offs has a universally correct side — the correct side is whichever one the specific requirements of the system in front of you actually demand, which is exactly the discipline Module 1's requirements-gathering framework was built to produce, and exactly what the distributed-systems mechanisms in Module 7 (consensus, gossip, circuit breakers) exist to implement once a trade-off has been chosen. Fluency with this module's twelve pairs is what lets you move through a system design conversation quickly and confidently: instead of inventing a justification on the spot, you recognize which named trade-off you're standing in front of, and you already know its shape.
