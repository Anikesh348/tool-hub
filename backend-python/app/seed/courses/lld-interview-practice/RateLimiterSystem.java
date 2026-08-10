import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Complete reference implementation for the Rate Limiter LLD problem:
 * a per-client, thread-safe token-bucket rate limiter behind a swappable
 * RateLimiter interface.
 *   javac RateLimiterSystem.java && java RateLimiterSystem
 */
public class RateLimiterSystem {

    interface RateLimiter {
        boolean allowRequest(String clientId);
    }

    static class TokenBucket {
        private double tokens;
        private final double capacity;
        private final double refillRatePerSecond;
        private long lastRefillTimeMillis;

        TokenBucket(double capacity, double refillRatePerSecond) {
            this.capacity = capacity;
            this.tokens = capacity;
            this.refillRatePerSecond = refillRatePerSecond;
            this.lastRefillTimeMillis = System.currentTimeMillis();
        }

        synchronized boolean tryConsume() {
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

    static class TokenBucketRateLimiter implements RateLimiter {
        private final Map<String, TokenBucket> buckets = new ConcurrentHashMap<>();
        private final double capacity;
        private final double refillRatePerSecond;

        TokenBucketRateLimiter(double capacity, double refillRatePerSecond) {
            this.capacity = capacity;
            this.refillRatePerSecond = refillRatePerSecond;
        }

        public boolean allowRequest(String clientId) {
            TokenBucket bucket = buckets.computeIfAbsent(clientId,
                    id -> new TokenBucket(capacity, refillRatePerSecond));
            return bucket.tryConsume();
        }
    }

    public static void main(String[] args) throws InterruptedException {
        // Allow 3 requests, refilling at 1 token/second.
        RateLimiter limiter = new TokenBucketRateLimiter(3, 1);

        for (int i = 1; i <= 5; i++) {
            boolean allowed = limiter.allowRequest("client-1");
            System.out.println("Request " + i + " for client-1: " + (allowed ? "ALLOWED" : "REJECTED"));
        }

        System.out.println("client-2 is isolated from client-1's quota:");
        System.out.println("Request 1 for client-2: " + limiter.allowRequest("client-2"));

        System.out.println("Waiting 2 seconds for refill...");
        Thread.sleep(2000);
        System.out.println("Request after wait for client-1: " + limiter.allowRequest("client-1"));
    }
}
