> **Learning goal**
> Design a rate limiter, able to compare the standard algorithms (token bucket, leaky bucket, fixed window, sliding window log, sliding window counter) and explain how to make rate limiting work correctly across many servers, not just one.

## 28.1 Requirements and scope

**Functional requirements**

- Limit how many requests a given client (by API key, user ID, or IP) can make within a time window (e.g., 100 requests per minute).
- Reject requests over the limit with a clear signal (HTTP 429) and tell the client when they can retry.
- Support different limits for different clients or endpoints (e.g., free tier vs. paid tier, or a stricter limit on an expensive endpoint).

**Non-functional requirements**

- **Low added latency.** A rate limiter sits in front of every request; if it adds meaningful latency itself, it defeats the purpose of protecting the system's performance.
- **Correctness under distributed load.** If the API is served by hundreds of application servers, the limiter must enforce a *global* limit per client, not a per-server limit that effectively multiplies the real limit by the number of servers.
- **Availability over strict precision.** If the rate-limiting infrastructure itself is degraded, the system should fail in a safe, predictable direction (usually: fail open and allow traffic, or fail closed and reject — a deliberate choice, not an accident) rather than take down the whole API.
- Memory-efficient: the limiter's own state shouldn't grow unboundedly with the number of clients or requests.

**Out of scope**

- Authentication/identification of clients (assume an API key or user ID is already resolved before the limiter runs).
- DDoS mitigation at the network layer (this is an application-level, per-client limiter, not a defense against volumetric attacks).
- Billing/quota systems (e.g., "1000 calls per month" — this lesson focuses on short-window rate limiting, not long-horizon quotas, though the same building blocks apply).

## 28.2 Scale estimation

Assumptions for a mid-size API platform:

- 100,000 active API clients.
- Average client makes 10 requests/minute, but the limiter must evaluate every single incoming request, not just the ones that end up over budget → at 100,000 clients × 10 req/min ≈ 16,700 req/s average platform-wide that the limiter touches.
- Peak traffic (some clients batch-processing, retries during incidents) could be 5-10x average → up to ~150,000 req/s the limiter must evaluate.

**Storage/memory:**

- Each client needs a small piece of state (a counter, or a short list of recent timestamps, depending on algorithm). At minimum, a counter + timestamp is ~16 bytes; at most (sliding window log, storing individual request timestamps) it could be tens to hundreds of bytes per active client depending on their request rate within the window.
- 100,000 clients × even a generous 1 KB of state each ≈ 100 MB — this comfortably fits in memory, which is exactly why rate limiter state almost always lives in an in-memory store (like Redis) rather than a disk-backed database: the whole point is sub-millisecond reads and writes on every single request.

**Latency budget:** if the overall request budget is, say, 50-100ms, the rate-limiter check should consume a tiny fraction of that — single-digit milliseconds at most, which rules out anything that requires a disk-backed database round-trip and points strongly toward in-memory storage, ideally colocated (same data center/region) with the application servers doing the checking.

**Read:write ratio:** effectively 1:1 — every check both reads the current count and updates it (or is itself the update, depending on algorithm). This is unlike most systems in this course where reads dominate; a rate limiter is a small, extremely hot, read-and-write-in-one system, which is precisely why algorithm choice (28.5) matters so much — small inefficiencies get multiplied by every request the whole platform serves.

## 28.3 API and data model

A rate limiter is usually not a client-facing API in the way earlier lessons had one — it's a piece of middleware/infrastructure. But it's still useful to define its contract, since it's typically built as a shared internal service or library:

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `POST /internal/rate-limit/check` | Ask "is this request allowed?" | `{clientKey, limitRuleId}` | `{allowed: bool, retryAfterMs, remaining}` |
| `PUT /internal/rate-limit/rules/{id}` | Configure a limit (admin) | `{limit, windowSeconds, scope}` | updated rule |

**Core entities:**

- `RateLimitRule { id, scope(endpoint/global/tier), limit, windowSeconds }` — the configuration, small and read-mostly, can be cached aggressively or even embedded in application config.
- `RateLimitState` — the hot, per-client counter/window data structure, whose exact shape depends entirely on the algorithm chosen (a single integer for fixed window, a sorted set of timestamps for sliding window log, etc.) — this is intentionally not a fixed schema because it's the thing 28.5 compares.

**SQL vs. NoSQL, by access pattern:**

The access pattern here is about as far from "complex queries and joins" as it gets: a single key (the client identifier) mapped to a small, frequently updated value, accessed on every request with a strict low-latency requirement. This is the canonical use case for an **in-memory key-value store** (Redis or similar) rather than any kind of relational or disk-backed database — there is no query flexibility needed, no joins, no need for durability beyond "state can reset occasionally without real harm" (losing a rate-limit counter on a restart just means a client gets a brief unrestricted window, not a correctness disaster). Rule configuration (`RateLimitRule`), being small, low-write-volume, and needing more traditional CRUD/admin access, is fine in a regular relational database or even a config file, since it's read into cache rather than looked up per-request.

## 28.4 High-level architecture

```text
Client -> Load Balancer
     -> API Gateway
          -> Rate Limiter (checks BEFORE routing to backend)
               -> In-memory store (Redis) holding per-client counters/windows
          -> [if allowed] -> Application Service
          -> [if denied]  -> 429 Too Many Requests + Retry-After header
```

**Request path:** the rate limiter sits at the edge, typically inside or immediately behind the API gateway, and runs *before* a request is allowed to reach application servers — the entire point is to reject over-limit requests as cheaply as possible, ideally before they consume any real backend capacity. On each incoming request, the gateway extracts the client identifier (API key, user ID, or IP), asks the rate limiter "is this allowed," and the rate limiter reads and atomically updates that client's counter state in the shared in-memory store, returning allow/deny in well under a millisecond in the common case.

**Why the state store must be shared, not per-server:** if each of, say, 50 application servers behind a load balancer kept its own local counter for a client, a client limited to "100 requests/minute" could actually get up to 5,000 requests/minute by having requests spread across all 50 servers, each unaware of the others' counts. A shared, centralized (or at least globally consistent) store is what makes the limit real rather than nominal — this single fact is why distributed rate limiting is a genuinely different problem from single-process rate limiting, not just the same algorithm running in more places.

## 28.5 Deep dive: algorithm comparison and distributed correctness

### The five standard algorithms

| Algorithm | How it works | Strengths | Weaknesses |
| --- | --- | --- | --- |
| **Fixed window counter** | Increment a counter per client for the current time window (e.g., current minute); reset to zero when the window rolls over. | Trivial to implement, O(1) memory per client. | Boundary burst problem: a client can send the full limit right before a window ends and again right after, getting 2x the intended rate in a short span straddling the boundary. |
| **Sliding window log** | Store a timestamp for every request in a per-client list; count how many fall within the last N seconds on each check, evicting older ones. | Perfectly accurate — no boundary issue. | Memory scales with request rate per client (could be large for high-volume clients), and each check does more work (scan/trim the log). |
| **Sliding window counter** | Approximate the sliding window using two fixed windows (current + previous) and a weighted combination based on how far into the current window we are. | Nearly as accurate as the log, O(1) memory like fixed window. | Slight approximation error (acceptable for almost all real use cases); a bit more logic than a plain counter. |
| **Token bucket** | A bucket holds up to N tokens; tokens refill at a steady rate; each request consumes one token; requests are denied when the bucket is empty. | Naturally allows short bursts up to the bucket size while enforcing a long-term average rate — matches how real traffic behaves (bursty, not perfectly smooth). | Slightly more state and configuration (bucket size *and* refill rate, two knobs instead of one). |
| **Leaky bucket** | Requests enter a queue (the "bucket") and are processed (leak out) at a fixed rate; if the queue is full, new requests are dropped. | Produces a smooth, constant outbound rate — good when the concern is protecting a downstream system that needs steady load, not just capping client request counts. | Bursty clients get queued/delayed rather than processed immediately, which can add latency; requires holding requests, not just counting them. |

For most API rate-limiting use cases (protect an API from abusive clients while allowing normal bursty usage), **token bucket** or the **sliding window counter** are the most commonly reached-for choices: token bucket because it naturally tolerates the bursty-but-bounded traffic pattern real clients produce, and sliding window counter because it's a good balance of accuracy and cheap O(1) memory when the priority is minimizing per-request overhead at very high check-rates. Fixed window is often good enough for coarse, low-stakes limits (and is the cheapest to reason about and debug), while sliding window log is used when precision genuinely matters more than memory cost (e.g., billing-adjacent limits where the boundary-burst problem is unacceptable). Leaky bucket earns its place specifically when the goal is protecting a downstream system's *processing rate*, not just counting a client's request volume — it's less common as a pure client-facing rate limiter and more common inside a system's own internal request-shaping layer.

### Distributed rate limiting and the race condition

Once state lives in a shared store like Redis, a new and easy-to-miss race condition appears: the classic "read-then-write" bug from the e-commerce inventory lesson shows up here too. If a check does `GET count`, evaluate it in the application, then `SET count+1`, two concurrent requests from the same client can both read the same starting count, both decide "still under limit," and both increment — letting the client through the limit by more than intended, exactly like two customers both buying the last unit of a product.

The fix follows the identical principle as inventory: never separate the read from the write. Practically:

- Use **atomic increment operations** (e.g., Redis's `INCR`, which increments and returns the new value in one atomic step) instead of separate GET/SET calls, so the check-and-update happens as one indivisible operation from the store's point of view.
- For algorithms needing more than a single counter (token bucket's "refill based on elapsed time, then consume" logic, or sliding window counter's weighted combination), the standard approach is to run the entire check-and-update sequence as a small atomic script executed inside the store (Redis supports this via Lua scripting, which runs to completion without interleaving with other clients' scripts) — this moves the "read, compute, write" sequence entirely inside one atomic unit rather than spanning multiple network round-trips where a race could sneak in.

There's a second distributed concern beyond races: **latency and availability of the shared store itself.** If every request across every application server must round-trip to a central Redis instance, that instance becomes both a new single point of failure and a potential latency addition to every single request platform-wide. Two common mitigations, often combined: replicate/shard the store so no single instance is a bottleneck (sharding by client key spreads load naturally, since each client's state only ever needs to live on one shard); and accept slightly relaxed precision in exchange for resilience — some designs let each application server keep a small local cache of "definitely still under limit" state and only consult the shared store near the boundary, trading a little accuracy for much lower average latency and reduced load on the central store. This mirrors the general theme across this course: perfect precision under distributed concurrency has a real cost, and the right amount of precision to pay for depends on what's actually being protected (a login-attempt limiter probably wants stronger guarantees than a "trending searches" endpoint's soft limit).

## 28.6 Bottlenecks and trade-offs

- **Single points of failure.** The shared state store (Redis) is the obvious one — if it's unreachable, does the rate limiter fail open (allow all traffic, risking overload of the backend) or fail closed (reject all traffic, risking a full outage over a rate-limiter problem)? Most production systems choose to fail open for a short grace period (protecting availability, since an unprotected-but-running API usually beats a fully down one) while alerting loudly, but this is a deliberate policy decision that should be stated explicitly, not left implicit.
- **Hot spots.** A single extremely high-volume client (or an API key being abused/shared) concentrates all its check traffic on one shard/key in the store, similar to the hot-SKU problem in e-commerce. Sharding by client key generally distributes this fine across the client population, but a single pathological client can still create a local hot key — the mitigation is the same sharded-counter idea used elsewhere in this course, splitting one client's counter across a few sub-keys if needed.
- **Consistency vs. availability.** Rate limiting inherently favors availability over perfect precision — being off by a few requests around a boundary or during a brief store hiccup is a far smaller problem than adding meaningful latency or a new hard dependency to every request in the system. This is the opposite bias from the checkout/booking problems in earlier lessons, and it's worth being able to articulate why: the cost of a rate-limiter under-count (a client sneaks through slightly over budget) is low, while the cost of an inventory over-sell is high — the acceptable error tolerance should always trace back to what's actually at stake.
- **What breaks first at 10x/100x scale:** at 10x, the shared store's throughput becomes the constraint, addressed by sharding client state across more store instances (rate limiting is naturally shardable since clients are independent of each other). At 100x, even the atomic-script-per-request overhead across a massive number of app-server-to-store round-trips starts to matter, pushing toward the local-cache-plus-periodic-sync approach mentioned above, accepting a bit more slack in exchange for taking the shared store mostly out of the hot path.

## 28.7 Summary

A rate limiter is a small, extremely hot piece of infrastructure where algorithm choice (fixed window, sliding window log/counter, token bucket, leaky bucket) trades off memory, accuracy, and burst tolerance, and where the harder problem is making the limit *actually global* across many application servers rather than accidentally multiplying it per server. The key correctness technique — atomic check-and-update, never separate read-then-write — is the same principle used for inventory and booking consistency elsewhere in this course, just applied to a counter instead of a row of data.

Natural follow-ups: how would you implement different limits for different endpoints or user tiers without proliferating rate-limiter state and configuration, and how would you rate-limit not just "requests per second" but a cost-weighted metric (e.g., an expensive search endpoint counts as 10 units against the same budget as a cheap lookup).
