package com.toolhub.middlewares;

import io.vertx.core.Handler;
import io.vertx.ext.web.RoutingContext;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

/** Prometheus-compatible request metrics matching the Python middleware contract. */
public final class RequestMetricsHandler implements Handler<RoutingContext> {
  private static final double[] BUCKETS = {0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10};
  private static final Map<RequestKey, LongAdder> REQUESTS = new ConcurrentHashMap<>();
  private static final Map<RouteKey, Histogram> DURATIONS = new ConcurrentHashMap<>();
  private static final Map<String, LongAdder> IN_PROGRESS = new ConcurrentHashMap<>();

  @Override
  public void handle(RoutingContext context) {
    String path = context.normalizedPath();
    String method = context.request().method().name();
    if ("OPTIONS".equals(method) || "/metrics".equals(path) || "/health".equals(path)) {
      context.next();
      return;
    }

    long started = System.nanoTime();
    IN_PROGRESS.computeIfAbsent(method, ignored -> new LongAdder()).increment();
    context.addEndHandler(
        ignored -> {
          double seconds = (System.nanoTime() - started) / 1_000_000_000.0;
          String route = routeTemplate(context);
          int status = context.response().getStatusCode();
          REQUESTS
              .computeIfAbsent(new RequestKey(method, route, status), key -> new LongAdder())
              .increment();
          DURATIONS
              .computeIfAbsent(new RouteKey(method, route), key -> new Histogram())
              .observe(seconds);
          IN_PROGRESS.get(method).decrement();
        });
    context.next();
  }

  public static void respond(RoutingContext context) {
    String tokenPath =
        System.getenv().getOrDefault("METRICS_TOKEN_PATH", "/run/secrets/toolhub_metrics_token");
    String expected = readToken(Path.of(tokenPath));
    String supplied = context.request().getHeader("Authorization");
    supplied = supplied != null && supplied.startsWith("Bearer ") ? supplied.substring(7) : "";
    if (expected.isBlank()
        || !MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) {
      context.response().setStatusCode(404).end();
      return;
    }
    context
        .response()
        .setStatusCode(200)
        .putHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        .end(exposition());
  }

  static String exposition() {
    StringBuilder out = new StringBuilder();
    out.append("# HELP toolhub_http_requests_total Total Tool Hub HTTP requests\n")
        .append("# TYPE toolhub_http_requests_total counter\n");
    REQUESTS.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .forEach(
            entry -> {
              RequestKey key = entry.getKey();
              out.append("toolhub_http_requests_total{method=\"")
                  .append(escape(key.method))
                  .append("\",route=\"")
                  .append(escape(key.route))
                  .append("\",status_code=\"")
                  .append(key.status)
                  .append("\"} ")
                  .append(entry.getValue().sum())
                  .append('\n');
            });
    out.append(
            "# HELP toolhub_http_request_duration_seconds Tool Hub HTTP request duration in seconds\n")
        .append("# TYPE toolhub_http_request_duration_seconds histogram\n");
    DURATIONS.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .forEach(entry -> entry.getValue().append(out, entry.getKey()));
    out.append(
            "# HELP toolhub_http_requests_in_progress Tool Hub HTTP requests currently in progress\n")
        .append("# TYPE toolhub_http_requests_in_progress gauge\n");
    IN_PROGRESS.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .forEach(
            entry ->
                out.append("toolhub_http_requests_in_progress{method=\"")
                    .append(escape(entry.getKey()))
                    .append("\"} ")
                    .append(entry.getValue().sum())
                    .append('\n'));
    return out.toString();
  }

  private static String routeTemplate(RoutingContext context) {
    if (context.currentRoute() != null && context.currentRoute().getPath() != null) {
      return context.currentRoute().getPath();
    }
    return context.normalizedPath() == null ? "unmatched" : context.normalizedPath();
  }

  private static String readToken(Path path) {
    try {
      return Files.isRegularFile(path) ? Files.readString(path, StandardCharsets.UTF_8).trim() : "";
    } catch (IOException ignored) {
      return "";
    }
  }

  private static String escape(String value) {
    return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
  }

  private record RequestKey(String method, String route, int status)
      implements Comparable<RequestKey> {
    @Override
    public int compareTo(RequestKey other) {
      int value = method.compareTo(other.method);
      if (value == 0) value = route.compareTo(other.route);
      return value == 0 ? Integer.compare(status, other.status) : value;
    }
  }

  private record RouteKey(String method, String route) implements Comparable<RouteKey> {
    @Override
    public int compareTo(RouteKey other) {
      int value = method.compareTo(other.method);
      return value == 0 ? route.compareTo(other.route) : value;
    }
  }

  private static final class Histogram {
    private final List<LongAdder> counts = new ArrayList<>();
    private final LongAdder count = new LongAdder();
    private final AtomicLong sumBits = new AtomicLong(Double.doubleToRawLongBits(0));

    private Histogram() {
      for (int ignored = 0; ignored < BUCKETS.length; ignored++) counts.add(new LongAdder());
    }

    private void observe(double seconds) {
      for (int i = 0; i < BUCKETS.length; i++) if (seconds <= BUCKETS[i]) counts.get(i).increment();
      count.increment();
      sumBits.updateAndGet(
          bits -> Double.doubleToRawLongBits(Double.longBitsToDouble(bits) + seconds));
    }

    private void append(StringBuilder out, RouteKey key) {
      String labels = "method=\"" + escape(key.method) + "\",route=\"" + escape(key.route) + "\"";
      for (int i = 0; i < BUCKETS.length; i++)
        out.append("toolhub_http_request_duration_seconds_bucket{")
            .append(labels)
            .append(",le=\"")
            .append(BUCKETS[i])
            .append("\"} ")
            .append(counts.get(i).sum())
            .append('\n');
      out.append("toolhub_http_request_duration_seconds_bucket{")
          .append(labels)
          .append(",le=\"+Inf\"} ")
          .append(count.sum())
          .append('\n')
          .append("toolhub_http_request_duration_seconds_sum{")
          .append(labels)
          .append("} ")
          .append(Double.longBitsToDouble(sumBits.get()))
          .append('\n')
          .append("toolhub_http_request_duration_seconds_count{")
          .append(labels)
          .append("} ")
          .append(count.sum())
          .append('\n');
    }
  }
}
