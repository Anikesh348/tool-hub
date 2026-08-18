> **Learning goal**
> Design a per-client rate limiter, and be able to explain the trade-offs between the token bucket, sliding window, and fixed window algorithms — this problem is graded almost entirely on whether you understand *why* you picked one over the others.

## 12.1 Requirements and scope

**Functional requirements:** given a client identifier, `allowRequest(clientId)` returns whether the request should be permitted, enforcing a limit like "100 requests per minute per client."

**Non-functional constraints:** must work correctly under concurrent requests from the same client; O(1) or near-O(1) per check, since this sits on the hot path of every request.

**Non-goals:** distributed rate limiting across multiple servers (mention Redis-backed shared counters as the real-world extension, but a single-process reference implementation is the expected scope).

## 12.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `RateLimiter` (interface) | `allowRequest(clientId): boolean` — a **Strategy** (LLD Basics lesson 14), so the algorithm is swappable |
| `TokenBucketRateLimiter` | Implements token bucket |
| `SlidingWindowRateLimiter` | Implements sliding window log |
| `Bucket` | Per-client state (tokens remaining, or a request timestamp log, depending on algorithm) |

## 12.3 Algorithm comparison — this is the actual interview content

**Fixed window counter.** Count requests in the current fixed time window (e.g. "12:00:00-12:01:00"), reset to zero at each window boundary. Simplest to implement, but has a real burst problem: a client could send 100 requests at 12:00:59 and another 100 at 12:01:00 — 200 requests in 1 second, right at the window edge, despite the "100/minute" limit.

**Sliding window log.** Store a timestamp for every request in the last window; on each check, drop timestamps older than `now - windowSize`, then compare the remaining count to the limit. Accurate — no edge-boundary burst problem — but memory grows with request volume per client, since every timestamp is retained until it ages out.

**Token bucket.** Each client has a bucket holding up to `capacity` tokens, refilled at a steady `rate` per second; a request is allowed only if a token is available (and consumes one). This is the industry-standard choice: smooths bursts (a client can spend saved-up tokens quickly, but can't sustain above the refill rate), and needs only two numbers per client (`tokens`, `lastRefillTime`) — O(1) memory regardless of traffic volume.

```java
class TokenBucket {
    private double tokens;
    private final double capacity;
    private final double refillRatePerSecond;
    private long lastRefillTimeMillis;

    boolean tryConsume() {
        refill();
        if (tokens >= 1) {
            tokens -= 1;
            return true;
        }
        return false;
    }

    private void refill() {
        long now = System.currentTimeMillis();
        double secondsElapsed = (now - lastRefillTimeMillis) / 1000.0;
        tokens = Math.min(capacity, tokens + secondsElapsed * refillRatePerSecond);
        lastRefillTimeMillis = now;
    }
}
```

| Algorithm | Memory per client | Handles boundary bursts | Complexity |
| --- | --- | --- | --- |
| Fixed window | O(1) | No | Lowest |
| Sliding window log | O(requests in window) | Yes | Medium |
| Token bucket | O(1) | Yes (smooths, doesn't fully prevent) | Medium |

## 12.4 Key design decisions

**Per-client isolation.** `RateLimiter` holds a `Map<String, Bucket>` keyed by client ID, so one client's traffic never affects another's remaining quota — and a `ConcurrentHashMap` (with `computeIfAbsent` to lazily create a client's bucket) makes this safe under concurrent requests without a global lock.

**Making it swappable.** Since fixed-window/sliding-window/token-bucket all satisfy the same `RateLimiter` interface, switching algorithms in production (e.g. after discovering the boundary-burst problem) is a one-line change, not a rewrite — the exact benefit Strategy (LLD Basics lesson 14) is built for.

## 12.5 Walking through the scenarios

*Under limit:* client has tokens available → request allowed, one token consumed.

*Over limit:* bucket empty, refill hasn't produced a new token yet → request rejected (HTTP 429 in a real API).

*Burst then quiet:* client sends nothing for 2 minutes, bucket refills to full capacity, then sends a burst — token bucket allows the burst up to `capacity`, then throttles to the steady refill rate.

> **Review question**
> Two threads call `tryConsume()` on the same client's bucket at nearly the same instant, and both read `tokens >= 1` as true before either decrements. What's the bug, and how would you fix `TokenBucket` to be thread-safe?
