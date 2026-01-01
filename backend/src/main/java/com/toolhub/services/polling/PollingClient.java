package com.toolhub.services.polling;

import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.Predicate;
import java.util.function.Supplier;

public class PollingClient<T> {

    private static final Logger log = LoggerFactory.getLogger(PollingClient.class);

    private final Vertx vertx;
    private final long interval;
    private final int maxAttempts;

    public PollingClient(Vertx vertx, long interval, int maxAttempts) {
        this.vertx = vertx;
        this.interval = interval;
        this.maxAttempts = maxAttempts;
    }

    public Future<T> poll(Supplier<Future<T>> supplier, Predicate<T> predicate) {
        Promise<T> pollPromise = Promise.promise();

        log.error("Starting polling: interval={}ms, maxAttempts={}", interval, maxAttempts);

        try {
            attempt(0, supplier, predicate, pollPromise);
        } catch (Exception e) {
            log.error("Unexpected error while starting polling", e);
            pollPromise.fail(e);
        }

        return pollPromise.future();
    }

    private void attempt(
            int attempt,
            Supplier<Future<T>> supplier,
            Predicate<T> predicate,
            Promise<T> promise
    ) {
        if (attempt >= maxAttempts) {
            log.warn("Polling stopped: max attempts ({}) reached", maxAttempts);
            promise.fail("Polling exceeded max attempts: " + maxAttempts);
            return;
        }

        log.error("Polling attempt {}", attempt + 1);

        try {
            supplier.get()
                    .onSuccess(result -> {
                        try {
                            if (predicate.test(result)) {
                                log.info("Polling condition satisfied at attempt {}", attempt + 1);
                                promise.complete(result);
                            } else {
                                log.error("Condition not met at attempt {}, scheduling next attempt", attempt + 1);
                                scheduleNext(attempt, supplier, predicate, promise);
                            }
                        } catch (Exception e) {
                            log.error("Error while evaluating polling condition", e);
                            promise.fail(e);
                        }
                    })
                    .onFailure(err -> {
                        log.warn(
                                "Polling attempt {} failed: {}",
                                attempt + 1,
                                err.getMessage()
                        );
                        scheduleNext(attempt, supplier, predicate, promise);
                    });
        } catch (Exception e) {
            log.error("Exception while executing polling supplier", e);
            scheduleNext(attempt, supplier, predicate, promise);
        }
    }

    private void scheduleNext(
            int attempt,
            Supplier<Future<T>> supplier,
            Predicate<T> predicate,
            Promise<T> promise
    ) {
        log.error("Scheduling next polling attempt in {}ms", interval);

        vertx.setTimer(interval, id -> {
            attempt(attempt + 1, supplier, predicate, promise);
        });
    }
}
