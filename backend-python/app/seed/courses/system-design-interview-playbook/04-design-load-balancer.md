> **Learning goal**
> Design a load balancer for a large web service, and be able to explain the difference between L4 and L7 balancing, compare common load-balancing algorithms, and describe how health checks keep traffic off failed backends.

## 4.1 Requirements and scope

**Functional requirements**

- Distribute incoming client requests across a pool of backend servers so no single server is overwhelmed.
- Detect when a backend is unhealthy and stop routing traffic to it.
- Support adding and removing backend servers from the pool without downtime (for scaling and deploys).
- Optionally support routing rules based on request content (e.g., path-based routing to different services).

**Non-functional requirements**

- **High availability**: the load balancer sits in front of everything else, so it cannot itself be a single point of failure — its own failure would take down the entire service behind it.
- **Low added latency**: the balancer is on the critical path of every single request, so it must add negligible overhead (sub-millisecond to a few milliseconds).
- **High throughput**: it must handle the aggregate request rate of the entire service, which is by definition higher than any one backend handles alone.
- **Fairness**: no backend should be persistently overloaded while others sit idle.

**Out of scope**: full API gateway features like authentication and rate limiting per client (a load balancer can sit alongside these but they are a separate concern), and global multi-region traffic steering (that's closer to DNS-based/anycast routing, covered conceptually in the CDN lesson).

## 4.2 Scale estimation

- **Request volume**: assume the service behind the load balancer handles 1 billion requests/day → roughly **11,600 requests/sec** average, with peaks of 2-3x → **~30,000 requests/sec peak**. The load balancer must sustain at least this rate without becoming the bottleneck itself.
- **Backend fleet size**: if each backend server can comfortably handle 500 requests/sec, then at 30,000 requests/sec peak the service needs roughly **60 backend instances**. The load balancer needs to track health and route to all of them, which is a trivially small "routing table" size (tens to low hundreds of entries) — this tells us the balancer's memory/state footprint for backend tracking is not a real constraint; its own throughput capacity is.
- **Connection volume**: for an L4 (TCP-level) balancer, what matters is concurrent connections, not just request rate — with HTTP keep-alive, a client might hold one connection open across many requests. Assume an average of 5,000 concurrent connections per balancer instance is well within reach for modern hardware, meaning a single well-tuned load balancer instance can plausibly handle several thousand requests/sec, so a small cluster of balancer instances (not just one) is enough to cover the 30,000 requests/sec peak.
- **Health check overhead**: if the balancer pings each of 60 backends every 5 seconds with a lightweight health check, that's only ~12 extra requests/sec — negligible compared to the 30,000 requests/sec of real traffic, confirming health checking is cheap enough to run frequently without being a load concern itself.

The takeaway: the load balancer's own compute cost per request must be extremely low (since it multiplies across every request in the system), and because even a single powerful instance can handle a meaningful fraction of the total load, the design mainly needs a small redundant cluster of balancers plus a mechanism to distribute traffic across *that* cluster too (addressed in Stage 4.6).

## 4.3 API and data model

A load balancer is not a typical CRUD service with a client-facing JSON API — its "API" is the network traffic it forwards, plus a small control-plane API for operators to manage the backend pool.

**Control-plane API** (used by deployment tooling, not end users)

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /api/backends` | `{ "host": "10.0.1.5", "port": 8080, "weight": 1 }` | `201 Created` |
| `DELETE /api/backends/{id}` | — | `204 No Content` (drains connections first) |
| `GET /api/backends` | — | `[{ "id", "host", "port", "healthy": true, "activeConnections": 42 }]` |

**Data model**

Core entity: `Backend { id, host, port, weight, healthy, activeConnections }`. This is a small, frequently-updated, in-memory structure — every health check tick and every connection open/close updates it. There is no meaningful "SQL vs NoSQL" decision here in the traditional sense, because this state does not need to be durably persisted in a database at all: it is operational, ephemeral routing state that can be rebuilt from service discovery (e.g., backends registering themselves) and live health checks if the balancer restarts. This is worth stating explicitly in an interview — not every piece of state needs a database; some state is correctly treated as an in-memory cache of ground truth that lives elsewhere (the actual running backend processes).

## 4.4 High-level architecture

```text
Client
  -> DNS (resolves to a small set of Load Balancer IPs)
       -> Load Balancer cluster (each instance independently capable of routing)
            -> Backend pool
                 [Backend 1] [Backend 2] ... [Backend N]
       (health checks run continuously against every backend)
```

**Request path**: a client resolves the service's domain via DNS to one of a handful of load balancer IPs (DNS round robin or an anycast IP spreads clients across balancer instances — this is how the balancer cluster itself avoids being a single point of failure, addressed further in 4.6). The chosen load balancer instance picks a healthy backend using its configured algorithm (4.5), forwards the request, and relays the response back to the client. For an L4 balancer this forwarding happens at the TCP/connection level; for an L7 balancer it happens after parsing the HTTP request, which allows content-aware routing decisions.

**Health-check path (background, off the request path)**: independently of client traffic, the load balancer periodically probes each backend (e.g., `GET /health` every few seconds, or a TCP-level connect check). A backend that fails a threshold of consecutive checks (e.g., 3 in a row) is marked unhealthy and removed from the active routing pool immediately, without waiting for a client request to fail first — this is what keeps the "low added latency" and "fairness" requirements intact even when backends fail.

## 4.5 Deep dive: L4 vs L7 balancing, algorithms, and health checks

**L4 vs L7.** These describe *which layer of the network stack* the balancer makes decisions at.

- **L4 (transport layer)**: the balancer looks only at IP and TCP/UDP headers — source/destination IP and port — and forwards packets or proxies the raw connection to a backend without ever parsing HTTP. This is extremely fast (minimal per-packet work) and protocol-agnostic (works for any TCP/UDP traffic, not just HTTP), but it cannot make decisions based on request content — it can't route `/api/video` differently from `/api/text`, and it can't inspect cookies or headers.
- **L7 (application layer)**: the balancer terminates the connection, parses the full HTTP request (path, headers, cookies, body if needed), and then makes a routing decision — e.g., path-based routing to different backend pools, or sticky sessions based on a cookie. This costs more CPU per request (HTTP parsing, potentially TLS termination) but enables much richer routing logic.

A practical design often layers both: an L4 balancer (or anycast/DNS) spreads traffic across a cluster of L7 balancers, which then do the content-aware routing to backend services. Given our requirements — a fairly generic web service without complex content-based routing needs stated — a straightforward L7 balancer per service is usually sufficient, since request volume here (tens of thousands/sec) is well within what modern L7 balancers handle.

**Load-balancing algorithms.**

| Algorithm | How it works | Best fit | Weakness |
| --- | --- | --- | --- |
| Round robin | Cycles through backends in order | Uniform backends, uniform request cost | Ignores actual backend load — a slow backend still gets its turn |
| Weighted round robin | Round robin, but backends with higher capacity get proportionally more turns | Heterogeneous backend hardware | Weights are usually static, don't adapt to real-time load |
| Least connections | Routes to whichever backend currently has the fewest active connections | Variable request cost (some requests take much longer than others) | Requires the balancer to track live connection counts per backend |
| Consistent hashing | Routes based on a hash of some request property (e.g., client ID, cache key) so the same input consistently reaches the same backend | Sticky sessions, or when backends hold local state/cache that benefits from repeat hits | Less even load distribution than least-connections; needs care to rebalance smoothly when backends are added/removed |

For a generic stateless web service, **least connections** is usually a strong default because request costs vary in practice (some endpoints are much heavier than others) and it self-corrects for that without needing to know request cost in advance. **Consistent hashing** becomes the right choice specifically when backends are *not* interchangeable from the client's perspective — e.g., routing to a backend that already has a user's session cached, or (as in the distributed cache lesson later in this course) routing a key to the specific node that owns it. The key idea behind consistent hashing is arranging backends and request hashes on a conceptual ring, so that when a backend is added or removed, only the requests that hashed to the region near that backend need to move — not the entire mapping — which keeps rebalancing cheap and predictable.

**Health checks.** Two flavors, often used together:

- **Active health checks**: the balancer proactively pings each backend on a schedule (e.g., every 5 seconds) with a lightweight endpoint or TCP connect. This catches failures even on backends that currently have zero live traffic.
- **Passive health checks**: the balancer observes real traffic outcomes — if requests to a backend start timing out or returning 5xx errors above a threshold, it's marked unhealthy without waiting for the next scheduled probe. This catches failures faster for actively-used backends, at the cost of a few real user requests failing first.

A backend is typically only restored to the healthy pool after passing several consecutive successful checks (not just one), to avoid rapidly flapping a backend in and out of rotation if it's marginally unstable.

## 4.6 Bottlenecks and trade-offs

- **Single points of failure**: a single load balancer instance is a textbook SPOF for the entire service behind it. The mitigation is running a small cluster of balancer instances behind DNS round robin or an anycast IP, so client traffic is spread across multiple independent balancers and no single instance failing takes the whole system down.
- **Hot spots**: consistent hashing, while good for cache locality, can create uneven load if the hash of incoming keys isn't well distributed (e.g., one very popular customer ID). Mitigated with "virtual nodes" — each physical backend is represented multiple times at different points on the hash ring, smoothing out uneven distribution.
- **Consistency vs. availability**: a load balancer's health-check logic makes an availability trade explicitly — marking a backend unhealthy after a few failed checks means some genuinely-fine-but-slow-to-respond backends get temporarily removed (a false positive), which is usually the right trade since routing around a possibly-fine backend is cheaper than routing traffic into a possibly-dead one.
- **What breaks first at 10x/100x scale**: at 10x request volume, adding more balancer instances and more backends scales roughly linearly. At 100x, the DNS-round-robin approach for spreading traffic across the balancer cluster itself starts to strain (DNS caching means traffic doesn't rebalance quickly if a balancer instance fails), which is when architectures typically move to anycast IP addressing or a dedicated global traffic manager in front of the balancer cluster.

## 4.7 Summary

A load balancer's core job — spread requests across backends while routing around failures — sounds simple but hinges on two real decisions: which layer to operate at (L4 for raw throughput and protocol-agnosticism, L7 for content-aware routing) and which algorithm best matches the backend pool's characteristics (round robin for uniform backends, least connections for variable request cost, consistent hashing for sticky or stateful routing). Health checks, run both actively and passively, are what keep the routing decisions honest in the face of real failures.

Natural follow-ups: global (multi-region) load balancing, where DNS-based or anycast routing directs users to their nearest healthy region before a local load balancer ever gets involved; and TLS termination strategy — whether the load balancer decrypts traffic (enabling L7 routing but adding CPU cost) or passes encrypted traffic through to backends.
