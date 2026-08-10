> **Learning goal**
> Understand what an API actually is and how the pieces around it — gateways, communication styles, real-time channels, reliability mechanisms, and traffic controls — fit together, so that later "design X" lessons can reference these building blocks instead of re-explaining them.

## 3.1 Overview

Almost every system design problem, no matter how different the product, eventually comes down to two systems talking to each other over a network. This module is about that conversation: how it is structured (APIs), how it is fronted and protected at scale (API gateways), which shape it takes (REST, GraphQL, WebSockets, webhooks), and which guarantees keep it trustworthy under retries and heavy load (idempotency, rate limiting). None of these topics are exotic — they are the vocabulary every later lesson in this course assumes you already have, the same way you can't discuss sentence structure without first agreeing on what a word is. By the end of this module you should be able to look at any client-server interaction and immediately ask the right questions: what's the contract, who fronts it, is it request-response or persistent, and what happens if the same request arrives twice?

## 3.2 What is an API

An API (Application Programming Interface) is a contract that lets one piece of software ask another piece of software to do something, without either side needing to know how the other is built internally. Think of it as a restaurant menu: you don't need to know how the kitchen works to order a dish — you just need to know what you can ask for, what you'll get back, and roughly how long it'll take. The kitchen can change its recipes, swap suppliers, or renovate entirely, and as long as the menu items still arrive as described, you (the customer) never notice.

The problem an API solves is coupling. Without a defined interface, every piece of software that wants to use a feature would need to understand that feature's internal code — its database schema, its programming language, its file layout. That makes change terrifying: touch one internal detail and a dozen unrelated callers break. An API draws a line: "here is the stable surface you can depend on; everything behind this line is mine to change freely."

Concretely, an API contract defines: what operations are available (e.g., "create an order," "get a user's profile"), what inputs each operation needs, what shape the output takes, what error conditions look like, and often what performance or reliability guarantees apply. When exposed over a network, this typically becomes an HTTP endpoint: a method (GET, POST, PUT, DELETE), a path (`/orders/123`), a request body, and a response with a status code and body.

```text
Client                         API                          Server internals
  |  "create an order"          |                                  |
  |  POST /orders {items:[...]} |                                  |
  |----------------------------->  validates, translates request   |
  |                              |--------------------------------->  writes to DB, charges card
  |  201 Created {orderId: 42}  |<---------------------------------  returns internal result
  |<-----------------------------|                                  |
```

APIs come in a few flavors depending on who's allowed to call them: **public APIs** (open to any developer, like a weather service), **partner APIs** (shared under a business agreement, like a shipping carrier's rate API given to a specific retailer), **internal APIs** (used only between a company's own services, like an internal "checkout service"), and **library APIs** (function calls within the same running program, no network involved at all).

The gotcha beginners run into: an API is a promise, not an implementation detail. Once external callers depend on it, changing the contract (renaming a field, changing what an error code means) can break every client that relies on it — which is exactly why the rest of this module exists: gateways, versioning conventions, and design practices all exist to manage that promise responsibly as a system grows.

## 3.3 API Gateway

Once a system has more than one or two backend services, letting every client talk directly to every service becomes unmanageable. An API gateway is the fix: a single, dedicated entry point that sits between clients and your backend services, so clients only ever need to know one address, and every cross-cutting concern (auth, rate limits, logging) is handled in one place instead of being copy-pasted into every service.

Picture a delivery app with separate services for orders, payments, restaurants, and delivery tracking. Without a gateway, the mobile app would need to know the network address of all four services, implement authentication four separate times, and hope every team remembers to add rate limiting consistently. With a gateway, the app talks to one hostname, and the gateway internally figures out "this request is for `/orders`, route it to the orders service."

```text
Mobile App --> API Gateway --> Orders Service
                    |--------> Payments Service
                    |--------> Restaurant Service
                    |--------> Delivery Tracking Service
```

A gateway typically does several jobs on every request, roughly in this order: authenticate the caller (check a token or API key), check whether they're allowed to do this (authorization), check whether they've exceeded their allowed request rate, possibly transform the request (e.g., convert an old API version's format into what the backend now expects), route it to the correct backend service, and finally log/monitor the whole exchange. Many gateways also cache common responses and act as a load balancer, spreading requests across multiple instances of a backend service. Some add circuit breaking: if a backend service is timing out or erroring heavily, the gateway temporarily stops sending it traffic so it can recover instead of getting hammered further.

The trade-off to understand: a gateway is powerful because it centralizes control, but that also makes it a single point of failure and a potential bottleneck — every request passes through it, so it needs to be highly available and fast, usually achieved by running many stateless gateway instances behind a load balancer of their own. It's also easy to over-stuff a gateway with business logic that really belongs in a backend service; the healthy rule of thumb is that a gateway should handle *cross-cutting* concerns (things every service needs) and leave domain logic (like "how do we calculate an order's total") to the services themselves. When you see "API Gateway" in a high-level design diagram in later lessons, this is the box doing all of that unglamorous but essential work.

## 3.4 REST vs GraphQL

REST and GraphQL are two different philosophies for shaping the API contract discussed in 3.2, and the choice between them shows up constantly in system design discussions.

REST (Representational State Transfer) organizes an API around *resources*, each identified by a URL, manipulated with standard HTTP verbs: `GET /users/42` fetches a user, `POST /users` creates one, `PUT /users/42` updates one, `DELETE /users/42` removes one. Each endpoint returns a fixed, predetermined shape of data — the server decides what fields come back.

GraphQL flips this: instead of many fixed-shape endpoints, there's a single endpoint (commonly `/graphql`), and the client sends a query describing exactly which fields it wants, across potentially multiple related resources, in one request. The server has a schema describing everything that's queryable, and it returns exactly what was asked for — no more, no less.

The motivating problem GraphQL solves is over-fetching and under-fetching. Imagine a mobile screen that needs a user's name, their last three orders, and each order's item count. With REST, that's plausibly three separate requests (`GET /users/42`, `GET /users/42/orders`, `GET /orders/{id}/items` for each order) — and each response probably includes fields the screen doesn't even need (over-fetching), while still requiring multiple round trips (under-fetching in a single call). With GraphQL, the client sends one query asking for exactly `name`, `orders { id, itemCount }` and gets exactly that back in one round trip.

```text
REST:  GET /users/42          -> {id, name, email, address, ...}   (extra fields unused)
       GET /users/42/orders   -> [{id, total, items: [...]}, ...]   (second round trip)

GraphQL: POST /graphql
         { user(id: 42) { name, orders { id, itemCount } } }
      -> exactly {name, orders:[{id, itemCount}]}   (one round trip, no extra fields)
```

REST's strength is simplicity and maturity: it maps naturally onto HTTP, which means HTTP caching (browsers, CDNs, proxies) works out of the box, and most engineers already understand it. Its weakness is rigidity — every new client need (a mobile screen wanting a different shape than the web dashboard) tends to spawn a new endpoint or a bloated one-size-fits-all response.

GraphQL's strength is flexibility for many different clients hitting the same underlying data with different shape needs, plus a strongly-typed schema that documents itself. Its weaknesses are real, though: caching is harder because every query can be different (no simple URL to cache against), a poorly-designed query can accidentally trigger enormous backend work (asking for deeply nested relationships), and the server-side setup (resolvers, schema, query cost limits) is meaningfully more complex than a handful of REST routes.

The practical rule of thumb: reach for REST when your API is simple, resource-shaped, and benefits from HTTP-level caching; reach for GraphQL when you have many different client types (web, mobile, third-party) each wanting differently-shaped views of the same underlying data, and you're willing to invest in the extra server-side machinery.

## 3.5 WebSockets

Every API style discussed so far — REST, GraphQL — is fundamentally request-response: the client asks, the server answers, and the connection is done. That model breaks down the moment a server needs to *push* data to a client without being asked — a chat message arriving, a stock price ticking, an opponent's move in a live game. WebSockets exist to solve that.

A WebSocket is a persistent, two-way connection between a client and a server. It starts as a normal HTTP request (a "handshake" with an `Upgrade` header asking to switch protocols), and once the server agrees (HTTP 101 status), the same underlying TCP connection stops speaking HTTP and starts speaking the WebSocket protocol — a lightweight framing format where either side can send a message to the other, at any time, without re-establishing a connection.

Contrast this with the alternatives beginners often reach for first:

| Approach | How it works | Cost |
| --- | --- | --- |
| Polling | Client asks "anything new?" every N seconds | Wasted requests when nothing changed; laggy when something did |
| Long polling | Client asks, server holds the request open until there's data, then responds; client immediately re-asks | Better latency than polling, but still repeated connection overhead |
| WebSockets | One connection stays open; either side sends data the instant it exists | Lowest latency, lowest overhead, but the connection itself must be kept alive and managed |

A simple concrete example: a live chat app. With polling, your phone would ask "any new messages?" every 3 seconds — most of the time the answer is no, and even when it's yes, the message could be waiting up to 3 seconds to be noticed. With a WebSocket, the moment a friend sends a message, the server pushes it down your open connection immediately — no request needed, no polling delay.

Because WebSocket frames carry very little overhead compared to a fresh HTTP request each time (no repeated headers, no new TCP handshake), they're also more efficient at scale for high-frequency updates — useful for things like multiplayer games, collaborative editors, live sports scores, and financial tickers, not just chat.

The gotchas: a WebSocket connection is *stateful* — the server must keep track of which client is connected to which server instance, which complicates horizontal scaling (you now need something like sticky sessions or a shared pub/sub layer so a message can reach a client connected to a different server node). Load balancers, proxies, and corporate firewalls sometimes mishandle the protocol upgrade, so production systems often need a fallback path. And because the connection is long-lived, you need to handle reconnection gracefully — networks drop, phones go to sleep, and a robust client re-establishes the connection and catches up on anything missed. When a later lesson's design calls for "real-time updates," this is almost always the mechanism being described.

## 3.6 Webhooks

REST and GraphQL assume the client initiates every interaction; WebSockets let a server push data over a connection the client kept open. Webhooks solve a related but distinct problem: how does one *system* tell another system "something happened," when there's no open connection between them and the systems might be owned by entirely different companies?

A webhook is simply an HTTP request that a provider system sends to a URL you registered with it, whenever some event occurs. It's often described as "the opposite of polling" — instead of your system repeatedly asking a payment provider "has this payment succeeded yet?", you register an endpoint once, and the payment provider calls *you*, via a normal `POST` request, the moment the payment status changes.

```text
Without webhooks (polling):        With webhooks:
You -> "any updates?" -> Provider  You register https://you.com/hooks/payments
You -> "any updates?" -> Provider  ...time passes...
You -> "any updates?" -> Provider  Provider -> POST https://you.com/hooks/payments {event: "paid"}
   (mostly wasted requests)           (exactly one request, right when it matters)
```

The typical lifecycle: you register an endpoint URL with the provider (often through a dashboard or API call); an event happens on the provider's side (a payment clears, a file finishes uploading, a GitHub pull request gets a new commit); the provider sends a `POST` request to your URL with details about the event, usually including a signature in the headers so you can verify it genuinely came from them; your endpoint responds quickly with a 2xx status to acknowledge receipt.

A few practices matter a lot in production, because webhooks fail in specific, predictable ways. First, always verify the signature before trusting the payload — anyone can guess your webhook URL and send fake requests otherwise. Second, treat delivery as "at least once, not exactly once, and not guaranteed ordered" — providers retry failed deliveries, so the same event might arrive twice, and two events might arrive out of order; your handler needs to be safe to run twice (this connects directly to idempotency, covered next) and shouldn't assume event A always arrives before event B. Third, don't do heavy work inside the webhook handler itself — acknowledge receipt fast (save the event, return 200), and process it asynchronously in a background worker, because a slow handler risks the provider timing out and retrying, compounding the duplicate-delivery problem.

The trade-off to keep in mind: webhooks are great for timely, event-driven notification between independent systems, but they require you to run a reliable, publicly reachable endpoint, and because delivery isn't perfectly guaranteed, critical systems (like billing) often pair webhooks with a periodic reconciliation job that double-checks state via a regular API call, just in case a webhook was silently lost.

## 3.7 Idempotency

Networks are unreliable — requests time out, connections drop mid-response, clients retry. Idempotency is the property that makes retrying safe: an operation is idempotent if performing it multiple times has exactly the same effect as performing it once.

The problem it solves is concrete and common: imagine a client sends "charge this customer $50," the server processes the charge successfully, but the response is lost on the way back (say, the network drops). From the client's point of view, it looks like the request failed, so it retries. Without idempotency, that customer is now charged $100. The server did nothing wrong — the charge succeeded both times it was asked — but the *client* couldn't tell the difference between "my request never arrived" and "my request succeeded but the answer got lost."

Some operations are naturally idempotent and need no special handling: setting `status = "cancelled"` gives the same end state no matter how many times you set it; deleting a resource that's already deleted is still "deleted" the second time. In HTTP terms, `PUT` and `DELETE` are meant to behave this way by convention, while `GET` is naturally safe (it doesn't change anything at all).

`POST`, however — the verb typically used for "create" or "do a thing" operations like charging a card or placing an order — is not naturally idempotent, because calling it twice usually means "do the thing twice." This is where *engineered* idempotency comes in, via an **idempotency key**: the client generates a unique identifier for this specific logical operation (e.g., a UUID it creates once, before the first attempt) and sends it along with every attempt, including retries.

```text
Attempt 1: POST /charge  {amount: 50, idempotencyKey: "abc-123"}  -> times out (response lost)
Attempt 2: POST /charge  {amount: 50, idempotencyKey: "abc-123"}  -> server recognizes "abc-123"
                                                                       was already processed,
                                                                       returns the SAME result
                                                                       without charging again
```

On the server side, this is typically implemented by storing idempotency keys in a table: when a request with a given key arrives, the server checks whether that key has already been processed (or is currently in progress); if so, it returns the stored result instead of re-executing the operation; if not, it atomically reserves the key, performs the operation, and stores the result for future duplicate requests to reuse. That "atomically reserves" step matters — if two retries arrive at nearly the same instant, a naive check-then-act approach can let both slip through, so this reservation typically relies on a database unique constraint.

The gotcha worth remembering for design discussions: idempotency keys must be generated once by the client and reused across every retry of that *same* logical operation — generating a new key on each retry defeats the entire purpose. This concept quietly underlies almost every "how do we make this reliable" conversation involving payments, order creation, or any operation with a real-world side effect that must not be duplicated.

## 3.8 Rate Limiting

Rate limiting is the practice of capping how many requests a client can make in a given period, and it protects a system from being overwhelmed — whether by a buggy client stuck in a retry loop, a traffic spike, or a deliberate abuse attempt. It's often enforced right at the API gateway layer discussed in 3.3, before a request ever reaches a backend service.

There are a handful of standard algorithms, each with a different trade-off between accuracy, burst tolerance, and memory cost:

**Fixed window counter** divides time into fixed blocks (e.g., each calendar minute) and counts requests per block, resetting to zero at each boundary. It's simple, but has a boundary problem: a client could send its full quota in the last second of one window and its full quota again in the first second of the next, doubling the effective rate right at the seam.

**Sliding window log** keeps a timestamp for every request and, on each new request, counts how many timestamps fall within the trailing window (e.g., "last 60 seconds"). This is precise — no boundary trick — but it can use a lot of memory per client under high volume, since every timestamp must be stored.

**Sliding window counter** approximates the sliding log's accuracy cheaply: it keeps just two counters (current window and previous window) and computes a weighted estimate — for example, if you're 25% into the current window, the effective count is `0.75 * previous_window_count + current_window_count`. Much less memory than the log, much more accurate than a plain fixed window.

**Token bucket** models a bucket that holds up to N tokens, refilling at a steady rate (e.g., 10 tokens/second, capped at a bucket of 100). Each request consumes one token; if the bucket is empty, the request is rejected or delayed. This naturally allows short bursts — if a client has been idle and built up a full bucket, it can send a burst up to the bucket's capacity — while still enforcing a steady long-run rate.

**Leaky bucket** is the mirror image: requests queue up and are processed ("leak out") at a strictly constant rate, regardless of how bursty the incoming traffic is. It smooths traffic out perfectly but handles sudden bursts poorly — excess requests just queue up or get dropped rather than being served quickly.

```text
Token bucket:  [🪙🪙🪙🪙🪙] capacity 5, refills 1/sec
               request -> consumes 1 token -> [🪙🪙🪙🪙]
               (allows a burst of up to 5 if the bucket was full)

Leaky bucket:  requests --> [ queue ] --> processed at fixed 1/sec, no bursts
```

In practice, token bucket is the most common default because it tolerates real-world burstiness gracefully while still capping sustained load, and sliding window counter is a strong choice when precision at low memory cost matters more than burst tolerance. Whichever algorithm is used, good API design surfaces the limit to the client via response headers (remaining quota, reset time) so well-behaved clients can self-throttle instead of hammering the API until they get rejected — this connects back to idempotency too, since a client that gets rate-limited and retries later needs its retry to be safe.

## 3.9 API Design Best Practices

Beyond picking a style (REST vs GraphQL) and bolting on a gateway, there's a set of habits that separate an API that's pleasant and safe to build against from one that quietly generates support tickets for years. These aren't rules for their own sake — each one exists because of a real failure mode someone hit first.

**Model URLs around resources, not actions.** `GET /orders/42` reads naturally as "the order with id 42"; `GET /getOrderById?id=42` mixes a verb into the URL when the HTTP verb (`GET`) is already doing that job. Plural nouns for collections (`/orders`, not `/order`) and nesting for ownership (`/users/42/orders`) keep the URL space predictable enough that developers can often guess an endpoint before reading the docs.

**Use HTTP status codes and methods as intended, not as decoration.** A `404` should mean "this specific resource doesn't exist," a `400` should mean "your request was malformed," a `401` "you're not authenticated," a `403` "you're authenticated but not allowed." An API that returns `200 OK` with `{"error": "not found"}` buried in the body forces every client to parse the body just to know if the call worked at all, defeating decades of tooling (browsers, proxies, monitoring) built around status codes meaning something.

**Version your API deliberately.** Once external clients depend on a contract, you can't silently change field meanings or remove fields without breaking them. Common approaches: a version in the URL (`/v1/orders`), a version header, or additive-only changes (only ever add optional fields, never remove or repurpose existing ones). The point isn't which scheme you pick — it's committing to one before you have external consumers, because retrofitting versioning onto a live API with real clients is far more painful.

**Paginate anything that returns a list.** `GET /orders` for a customer with 5 orders is harmless; the same endpoint for a customer with 5 million orders can take down your database or your client's memory. Cursor-based pagination (`?after=order_881&limit=50`) scales better than offset-based pagination (`?page=3&limit=50`) for large or frequently-changing datasets, because offsets shift under you as new rows are inserted.

**Be consistent, and don't over-fetch or under-fetch by default.** Consistent naming (`createdAt` everywhere, not `created_at` in one endpoint and `dateCreated` in another), consistent error shapes, and consistent pagination conventions reduce the cognitive load of using more than one endpoint. And design responses around what clients actually need — this is the same over/under-fetching tension discussed in section 3.4, and part of why some teams reach for GraphQL instead of trying to make one REST shape fit everyone.

**Secure by default.** Require authentication unless a route is deliberately public, validate and sanitize all input server-side (never trust the client to enforce business rules), and never put secrets or sensitive identifiers in a URL, since URLs end up in logs, browser history, and proxy caches.

None of these practices exist in isolation — pagination interacts with rate limiting (large exports should be throttled), status codes interact with idempotency (a retried request should return the same status code as the original), and versioning interacts with the gateway (which can route different versions to different backend deployments). Good API design is really about making these pieces cohere, not applying each rule independently.

## 3.10 Summary and how these connect

Zoom back out and the eight topics in this module form a single story about one client talking to one backend, with increasing levels of real-world messiness layered in. Section 3.2 established the basic idea: an API is a contract. Section 3.3 addressed what happens once there's more than one backend service — a gateway becomes the single front door that enforces that contract's cross-cutting rules (auth, rate limits, routing) in one place. Sections 3.4 through 3.6 covered the different *shapes* that conversation can take: request-response with a fixed resource shape (REST), request-response with a flexible client-specified shape (GraphQL), a persistent two-way channel for server-initiated pushes (WebSockets), and provider-initiated one-off notifications between separate systems (webhooks). Sections 3.7 and 3.8 covered what keeps that conversation trustworthy and safe under real-world conditions: idempotency handles the "the same request might arrive twice" reality of unreliable networks, and rate limiting handles the "too many requests might arrive at once" reality of unpredictable traffic. Section 3.9 tied it together into the discipline of designing the contract well from the start, since a badly designed API multiplies the cost of every one of the other concerns.

When later lessons in this course draw a box labeled "API Gateway" or say "the client polls via WebSocket" or "we use an idempotency key here," they're now assuming the vocabulary this module built. The next module, on database fundamentals, picks up right where the API layer hands off — once a request has been authenticated, routed, and validated, it usually needs to read or write data, and that's where the real design trade-offs about consistency, scale, and storage shape begin.
