package com.toolhub.verticles;

import com.toolhub.services.buzzwatch.BuzzWatchService;
import com.toolhub.services.flights.FlightService;
import com.toolhub.services.moviehubautomation.portal.MovieHubRequestPortalService;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.AbstractVerticle;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.ext.web.client.WebClient;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Seven boundary-aligned, non-overlapping jobs matching Python's ToolHubScheduler. */
public final class ToolHubSchedulerVerticle extends AbstractVerticle {
  private static final Logger log = LoggerFactory.getLogger(ToolHubSchedulerVerticle.class);
  private final Dotenv env;
  private final WebClient web;
  private final FlightService flights;
  private final MovieHubRequestPortalService movieHub;
  private final BuzzWatchService buzzWatch;
  private final List<Long> timerIds = new ArrayList<>();

  public ToolHubSchedulerVerticle(
      Dotenv env,
      WebClient web,
      FlightService flights,
      MovieHubRequestPortalService movieHub,
      BuzzWatchService buzzWatch) {
    this.env = env;
    this.web = web;
    this.flights = flights;
    this.movieHub = movieHub;
    this.buzzWatch = buzzWatch;
  }

  @Override
  public void start(Promise<Void> promise) {
    if (!boolEnv("TOOLHUB_SCHEDULER_ENABLED", true)) {
      log.info("ToolHub scheduler disabled");
      promise.complete();
      return;
    }
    schedule(
        "price-check",
        seconds("PRICE_CHECK_INTERVAL_SECONDS", 1200),
        () -> internalGet("/v2/schedule"));
    schedule(
        "flight-price-check",
        seconds("FLIGHT_CHECK_INTERVAL_SECONDS", 3600),
        flights::checkAllWatches);
    schedule(
        "moviehub-reconcile-downloads",
        seconds("MOVIEHUB_RECONCILE_INTERVAL_SECONDS", 900),
        movieHub::reconcileAllDownloadedRequests);
    schedule(
        "buzzwatch-refresh",
        seconds("BUZZWATCH_REFRESH_INTERVAL_SECONDS", 21_600),
        buzzWatch::refreshCatalog);
    schedule(
        "buzzwatch-year-warm",
        seconds("BUZZWATCH_YEAR_WARM_INTERVAL_SECONDS", 86_400),
        buzzWatch::warmYearCache);
    schedule(
        "yt-download-check",
        seconds("YT_DOWNLOAD_CHECK_INTERVAL_SECONDS", 300),
        () -> internalGet("/v2/yt/download/check"));
    schedule(
        "yt-download-start",
        seconds("YT_DOWNLOAD_START_INTERVAL_SECONDS", 60),
        () -> internalGet("/v2/yt/download/cronStart"));
    promise.complete();
  }

  private void schedule(String name, long intervalSeconds, Supplier<Future<?>> action) {
    AtomicBoolean running = new AtomicBoolean();
    long intervalMillis = intervalSeconds * 1000L;
    long firstDelay = intervalMillis - Math.floorMod(System.currentTimeMillis(), intervalMillis);
    long firstId =
        vertx.setTimer(
            firstDelay,
            ignored -> {
              run(name, running, action);
              long periodicId = vertx.setPeriodic(intervalMillis, id -> run(name, running, action));
              timerIds.add(periodicId);
            });
    timerIds.add(firstId);
    log.info("{} scheduler started. Interval: {} seconds", name, intervalSeconds);
  }

  private void run(String name, AtomicBoolean running, Supplier<Future<?>> action) {
    if (!running.compareAndSet(false, true)) {
      log.warn("{} scheduler skipped run because previous run is still active", name);
      return;
    }
    long started = System.nanoTime();
    try {
      action
          .get()
          .onComplete(
              result -> {
                running.set(false);
                long durationMs = (System.nanoTime() - started) / 1_000_000;
                if (result.succeeded())
                  log.info(
                      "Scheduled job completed: {} in {} ms: {}",
                      name,
                      durationMs,
                      result.result());
                else
                  log.error("Scheduled job failed: {} in {} ms", name, durationMs, result.cause());
              });
    } catch (Exception error) {
      running.set(false);
      log.error("Scheduled job failed before dispatch: {}", name, error);
    }
  }

  private Future<Void> internalGet(String path) {
    return web.get(8080, "127.0.0.1", path)
        .timeout(10 * 60_000L)
        .send()
        .compose(
            response ->
                response.statusCode() >= 200 && response.statusCode() < 300
                    ? Future.succeededFuture()
                    : Future.failedFuture(path + " returned HTTP " + response.statusCode()));
  }

  private long seconds(String name, long fallback) {
    try {
      return Math.max(60, Long.parseLong(env.get(name, Long.toString(fallback))));
    } catch (Exception ignored) {
      return fallback;
    }
  }

  private boolean boolEnv(String name, boolean fallback) {
    String raw = env.get(name);
    if (raw == null) return fallback;
    return switch (raw.trim().toLowerCase()) {
      case "1", "true", "yes", "on" -> true;
      default -> false;
    };
  }

  @Override
  public void stop(Promise<Void> promise) {
    timerIds.forEach(vertx::cancelTimer);
    timerIds.clear();
    promise.complete();
  }
}
