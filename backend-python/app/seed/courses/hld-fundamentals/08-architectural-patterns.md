> **Learning goal**
> Recognize the major high-level architectural styles — client-server, microservices, serverless, event-driven, and peer-to-peer — understand the problem each one is a response to, and know the trade-offs that determine when each is the right fit.

## 8.1 Overview

Everything you've learned so far in this course — caching, message queues, pub/sub, CDC — are *components* you place inside a system. This module zooms out one level, to the *shape* of the system those components live inside. An architectural pattern is really just a recurring answer to a small set of structural questions: Who initiates work, and who responds? Is the system one deployable unit or many? Does anyone own a central server at all, or do participants deal with each other directly? Is work triggered by direct calls, or by things that happened?

These aren't competing "best answers" — they're tools shaped for different problems, and most real systems are actually a blend (a microservices backend that's internally event-driven, exposed to the world through a plain client-server API, with a couple of serverless functions handling occasional spiky work). This module covers five patterns: client-server, the default shape almost everything else builds on (8.2); microservices, which splits a server into many independently deployable pieces (8.3); serverless, which removes server management from the picture entirely (8.4); event-driven architecture, which reorganizes communication around things that happened rather than direct calls — tying directly back to the pub/sub and queues you learned in the previous module (8.5); and peer-to-peer, which removes the central server altogether (8.6). By the end, you should be able to look at a system and describe its shape, not just its components.

## 8.2 Client-Server Architecture

Client-server is the architecture almost every beginner already has an intuitive feel for, even before learning the term: a **client** (a browser, a mobile app, another backend service) sends a request, and a **server** processes it and sends back a response. The server owns the resources that matter — the database, the business rules, sensitive data — and the client's job is mostly to ask, display, and collect input. This is the foundational split that basically every other pattern in this module either builds on or reacts against.

The reason this split exists at all, rather than every device just managing its own data locally, is control and consistency. Imagine a banking app where account balances lived only on each user's phone — there'd be no way to guarantee two people don't both spend the same money at the same time, no way to enforce rules centrally, and no way to protect sensitive data if a phone is lost. By centralizing the source of truth on a server, you get one place that enforces rules, one place that's secured and audited, and one place you can update without needing every client to upgrade simultaneously.

A useful way to see how this idea scales is through "tiers." A **1-tier** application is just local software with no network involved at all (a spreadsheet). A **2-tier** setup has a client talking directly to a database — simple, but it means every client needs direct database credentials and business logic gets duplicated across clients, which doesn't hold up once you have more than a handful of trusted users. The **3-tier** model most web systems use today separates this into a presentation layer (the client), an application layer (the server, holding business logic), and a data layer (the database) — the client never touches the database directly, it goes through the application layer, which is what lets you change your database technology or scale it without every client needing to know or care. **N-tier** just extends this further, adding more specialized layers (a caching layer, a queueing layer, separate services) as a system's needs grow more complex.

```text
Client --(request)--> [Presentation] --> [Application/business logic] --> [Data layer]
Client <--(response)-- ------------------------------------------------------
```

A typical request's journey looks like this: the client resolves the server's address via DNS, opens a connection (usually encrypted, via TLS), sends a formatted request (an HTTP method, path, and body), the server validates it, applies whatever business logic is needed, reads or writes data, and sends back a response, which the client then renders or acts on.

The trade-offs here are ones you'll keep running into throughout this whole course. Centralizing on a server means the server becomes a scaling bottleneck and a single point of failure if you're not careful — which is exactly why concepts like load balancing (spreading requests across many server instances) and caching exist. It also means every request pays network latency, and the server has to handle failures gracefully (timeouts, retries) rather than assuming the client is always reachable and honest. And because clients can be old versions running on users' devices you don't control, servers have to support API versioning — you can't force every phone to update the instant you change your backend.

The reason this section comes first in the module is that every other pattern here is a variation on client-server, not a replacement for it: microservices is "many small servers instead of one big one," serverless is "someone else manages the server for you," and event-driven is "requests are replaced by events, but there's still a producer and a consumer." Only peer-to-peer, the last topic, genuinely breaks from this shape.

## 8.3 Microservices Architecture

A microservices architecture takes the "server" side of client-server and splits it into many small, independently deployable services, each responsible for one focused piece of the business (an Order service, a User service, an Inventory service), each with its own codebase, and — importantly — usually its own database, communicating with each other over the network (typically via APIs, or via the message queues and pub/sub systems from the previous module).

This is a direct response to the pain of a **monolith**: a single, large application containing all the business logic in one codebase, deployed as one unit. Monoliths are genuinely the right starting point for most new products — they're simpler to build, test, and reason about when a team is small. But as a codebase and an organization grow, monoliths start to hurt in specific, predictable ways: every team's changes ship together, so one team's slow test suite or risky deploy blocks everyone else; the whole application has to be scaled together even if only one part (say, image processing) actually needs more resources; and a bug in one unrelated corner of the code can, in the worst case, crash the entire application for every user.

Microservices address each of these directly. Because each service is a separate codebase with its own deployment pipeline, the Order team can ship ten times a day without ever touching or waiting on the Inventory team. Because each service runs as its own set of instances, you can scale just the Inventory service during a flash sale without scaling everything else along with it. And because services are separate processes, a crash in one (say, the recommendation service falling over) doesn't necessarily take down checkout — the rest of the system can degrade gracefully instead of failing completely. Microservices also let different teams pick the best tool for their specific job (one service in Python for its ML libraries, another in Go for raw throughput) instead of the whole organization being locked into one language and one database.

```text
Client --> API Gateway --> Order Service   --> Order DB
                        --> Inventory Svc  --> Inventory DB
                        --> User Service   --> User DB
                        (services call each other, or communicate via events)
```

None of this is free, though, and the costs are exactly why "just use microservices" is bad advice for a small team building something new. You now have a distributed system: a single logical operation (placing an order) might touch four services over the network, and each of those network calls can fail independently in ways a single in-process function call never could. Debugging requires tracing a request across multiple services and logs instead of reading one stack trace. Data consistency gets harder — since each service owns its own database, you can't just run one SQL transaction across "place order" and "decrement inventory" anymore; you need patterns like the outbox pattern and events (from the previous module) to keep things eventually consistent. And operationally, you now need infrastructure most small teams don't need on day one: an API gateway as a single entry point, service discovery so services can find each other as instances come and go, and resilience patterns like the **circuit breaker** (stop calling a service that's clearly failing, instead of retrying into a wall and making the outage worse) and the **bulkhead** pattern (isolate resources per dependency, so one slow downstream service can't exhaust every thread and take unrelated features down with it).

The practical guidance nearly every experienced team converges on: start with a well-organized monolith, and split out microservices only when you have a concrete, felt pain point (a team blocked by another team's deploys, a component that needs to scale wildly differently from the rest) — not because it's the "modern" thing to do.

## 8.4 Serverless Architecture

Serverless architecture takes the "who manages the server" question and answers it with "not you." You write individual functions (this style is often called **Function-as-a-Service**, or FaaS — AWS Lambda, Google Cloud Functions, Azure Functions are the well-known examples), upload them to a cloud provider, and the provider takes care of provisioning machines, scaling them up and down, patching the operating system, and tearing them back down when there's no traffic. You don't manage a server at all — not because there isn't one, but because it's entirely someone else's problem.

The motivating problem serverless solves is wasted capacity and operational overhead for workloads that are naturally spiky or infrequent. Imagine a function that resizes a profile picture whenever someone uploads one. With a traditional server, you'd have to keep a machine running 24/7 just in case an upload happens, paying for idle capacity most of the time. With serverless, the function only runs — and you only pay — when an upload event actually triggers it. If a thousand uploads arrive at once, the provider spins up a thousand parallel instances of that function automatically; when the traffic disappears, so does the capacity and the cost.

```text
Event (file uploaded, HTTP request, message on a queue)
        |
        v
  Cloud provider spins up a function instance on demand
        |
        v
  Function runs, does its one job, returns/terminates
        |
        v
  Provider tears the instance down when idle (you pay only for execution time)
```

Serverless functions are typically triggered by events rather than being long-running processes waiting for connections — an HTTP request through an API gateway, a new file landing in object storage, a message arriving on a queue, a scheduled timer. This makes serverless a very natural fit for the event-driven style covered next: a serverless function is often literally the "consumer" sitting at the end of a pub/sub subscription or a queue.

The trade-offs are real and worth knowing before reaching for serverless by default. The most notorious is the **cold start**: if a function hasn't run recently, the provider has to allocate and initialize a fresh instance before it can execute, adding noticeable latency (anywhere from tens of milliseconds to a few seconds depending on the runtime) to that first request — this makes serverless a poor fit for latency-sensitive, constantly-hot request paths unless you pay extra to keep instances "warm." Functions are also typically stateless and short-lived by design (often with a hard execution time limit, like 15 minutes on Lambda), so they're a poor fit for long-running processes or anything that needs to hold significant in-memory state between requests — that state has to live somewhere else (a database, a cache). And because you're billed per invocation and per execution time, a workload with constant, predictable, high traffic can actually end up *more* expensive on serverless than on a normally-provisioned server that's kept busy — serverless earns its cost advantage specifically on spiky or infrequent workloads, not steady ones.

The practical rule of thumb: reach for serverless for event-triggered, short, bursty, or infrequent tasks (image processing, webhook handlers, scheduled jobs, glue code between other services), and reach for traditional servers or containers for steady, latency-critical, long-running, or stateful workloads.

## 8.5 Event-Driven Architecture

Event-driven architecture (EDA) isn't really a new set of components — it's a reorganization of how the components you already know (client-server-style services, message queues, pub/sub) talk to each other. Instead of Service A directly calling Service B's API whenever something happens ("tell the shipping service to create a shipment"), Service A simply announces that something happened ("OrderPlaced") onto an event broker, and any service that cares — shipping, billing, analytics — reacts independently, without A ever needing to know they exist. If this sounds exactly like the pub/sub pattern from the previous module, that's because it is — event-driven architecture is what you get when you make "communicate via events" the primary, default way services interact across an entire system, rather than an occasional pattern used for a couple of notifications.

The motivating problem is the same tight coupling that microservices without EDA tend to accumulate: if every service calls every other service it depends on directly, you end up with a tangled web where Service A has to know about, and be resilient to failures in, every single downstream service it triggers — and adding one new interested party means modifying A's code again. EDA breaks this: producers publish facts about what happened, and the set of consumers can grow or shrink without ever touching the producer.

```text
Order Service --publishes--> [Event Broker] --> Shipping Service (creates shipment)
  (OrderPlaced)                              --> Billing Service (charges card)
                                              --> Analytics Service (logs event)
                                              --> (new) Loyalty Service (adds points)
                                                   ^-- added later, zero changes to Order Service
```

The core building blocks are the same ones you already know: **event producers** (services that emit events), **event consumers** (services that react to them), and an **event broker** (Kafka being the dominant real-world choice, though any pub/sub or queue system qualifies) that durably stores and routes events between them. On top of this base, a few related patterns commonly show up: **event sourcing**, where instead of storing only the current state of an entity, you store the full sequence of events that led to that state (so "account balance = $50" is derived by replaying "deposited $100, withdrew $50" rather than stored directly) — this gives you a complete audit trail and the ability to reconstruct state as of any point in time. And **CQRS** (Command Query Responsibility Segregation), which separates the model used for writes from the model used for reads, often paired with event sourcing so the read side can be rebuilt from the event stream in whatever shape is fastest to query.

EDA's benefits track closely with what you already learned about pub/sub and queues: independent scaling of each consumer, real-time reactivity (a fraud check can start the instant an order is placed, not on some batch schedule), and resilience — since events are durably stored, a consumer that's down for maintenance can replay the events it missed once it's back, rather than having permanently lost that information the way a direct API call would.

The costs are also familiar, but worth restating because they compound at a whole-system level rather than a single-integration level: strict ordering guarantees become hard to reason about system-wide (you generally only get ordering within a partition, not globally), the system settles into eventual consistency rather than everything being instantly up to date everywhere, and debugging a business process that's spread across a chain of asynchronous event reactions is genuinely harder than reading a single synchronous call stack — you often need distributed tracing tools specifically built for this. EDA is a powerful default for systems built from many independent services that need to react to the same real-world happenings, but it's not "free decoupling" — it trades one kind of complexity (tangled direct calls) for another (reasoning about asynchronous, eventually-consistent flows).

## 8.6 Peer-to-Peer (P2P) Architecture

Every pattern so far kept the client-server split in some form — even microservices and serverless still have identifiable "servers" handling requests. Peer-to-peer architecture removes that split entirely. In a P2P system, every participant (a **peer**) can act as both a client and a server at the same time — requesting data from other peers and serving data to other peers — and there's no single central server that everyone depends on.

The motivating problem is exactly the weaknesses of centralization: a client-server system has one place (or one small cluster) that all traffic funnels through, which means the operator of that server bears the entire bandwidth and storage cost, and if that server goes down or gets overwhelmed, every user is affected simultaneously. P2P spreads both the cost and the risk across all participants. The canonical historical example is file-sharing protocols like BitTorrent: instead of one server hosting a large file and paying to serve it to every downloader individually, a file is broken into many small pieces, and peers download different pieces from each other simultaneously, then serve the pieces they already have to other peers who still need them — the more people downloading a file, the more capacity is available to serve it, not less.

```text
Client-Server:                     Peer-to-Peer:
   Peer A                          Peer A <---> Peer B
      \                               ^  \        ^
       v                              |   \       |
   [ Server ] <--- everyone           v    v      v
      ^  /                          Peer D <---> Peer C
     /  v
   Peer C   Peer B
```

There are a couple of common structural variants worth knowing. In an **unstructured** P2P network, peers connect somewhat arbitrarily and finding a specific piece of data means flooding a query out to neighboring peers, hoping someone has it — simple to build, but inefficient at scale. In a **structured** P2P network (built on something like a distributed hash table, or DHT), peers and data are organized so that any peer can find which other peer holds a given piece of data in a small, predictable number of hops — much more efficient, at the cost of more complex bookkeeping when peers join or leave.

The trade-offs of going fully peer-to-peer are significant, which is why most modern products you use are not pure P2P despite the model's appeal. There's no central authority to enforce rules, moderate content, or guarantee any single peer is trustworthy, which makes P2P a poor fit for anything requiring strong consistency, access control, or accountability (you generally wouldn't build a banking system this way). Peers can join and leave unpredictably (this churn is a real engineering problem — data available a minute ago might vanish if the peer holding it disconnects), which is why replication across many peers matters even more here than in a distributed cache. And discovery itself is nontrivial — a brand-new peer needs some way to find its first few peers to connect to, which in practice often means at least a small, lightly centralized bootstrapping mechanism (like a tracker or a set of seed nodes), meaning many real-world "P2P" systems are actually hybrids rather than purely decentralized.

Where P2P genuinely shines is exactly the scenario client-server struggles with: distributing very large, popular, relatively static content (file sharing, some blockchain and cryptocurrency networks, certain video-streaming and CDN-offload systems) where spreading cost and load across participants outweighs the loss of central control. It's the architectural pattern most worth knowing conceptually even if you rarely build one yourself, because it's the clearest illustration of what you give up, and what you gain, when you remove the central server that every other pattern in this module still assumes exists.

## 8.7 Summary and how these connect

Step back and these five patterns form a spectrum around one question: where does control and responsibility live? Client-server centralizes everything in one server, the simplest and most common starting point. Microservices keeps that centralization of "the backend" but splits it internally into many independently deployable pieces, trading simplicity for team autonomy and independent scaling. Serverless keeps the client-server request/response shape but hands the server itself off to a cloud provider, optimizing for spiky, infrequent workloads at the cost of cold starts and statelessness. Event-driven architecture keeps services separate (often microservices) but replaces direct calls between them with the pub/sub and queue mechanisms from the previous module, trading tight coupling for eventual consistency and asynchronous complexity. And peer-to-peer removes the central server altogether, trading control, consistency, and easy accountability for resilience and shared cost at scale.

None of these are mutually exclusive, and recognizing that is the real skill this module is building. A real production system is usually client-server at its outermost layer (a mobile app talking to a backend), built from microservices internally, with a few serverless functions handling odd bursty jobs, wired together with event-driven messaging for cross-service communication, and almost never peer-to-peer unless the product specifically calls for it. With caching (module 5), asynchronous communication (module 6), and now these architectural shapes in hand, you have the full vocabulary this course's later "Design X" modules will assume you already know — every one of those lessons is really just a question of which combination of these patterns fits a specific problem's requirements.
