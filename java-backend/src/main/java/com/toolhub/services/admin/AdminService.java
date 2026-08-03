package com.toolhub.services.admin;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.*;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.mongo.UpdateOptions;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import io.vertx.redis.client.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;

public class AdminService {
  private static final String AUDIT = "adminsettingsaudit";
  private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
  private static final Set<String> SPEED_TARGETS =
      Set.of("hp-purva", "ubuntu-purva", "homeassistant", "hp-codex", "pi-purva");
  private final MongoDBClient mongo;
  private final WebClient web;
  private final Vertx vertx;
  private final Dotenv env;
  private final HostAdminClient hosts;
  private final Map<String, Node> nodes;
  private final String defaultNode;
  private final Redis redis;

  public AdminService(MongoDBClient mongo, WebClient web, Vertx vertx, Dotenv env) {
    this.mongo = mongo;
    this.web = web;
    this.vertx = vertx;
    this.env = env;
    this.hosts = new HostAdminClient(vertx, web, env);
    this.nodes =
        Map.of(
            "pi5",
            new Node(
                "pi5",
                "Pi 5",
                env.get(
                        "NETDATA_PI_URL",
                        env.get("NETDATA_URL", "http://host.docker.internal:19999"))
                    .replaceAll("/+$", "")),
            "ubuntu",
            new Node(
                "ubuntu",
                "HP / Ubuntu",
                env.get("NETDATA_UBUNTU_URL", "http://192.168.68.117:19999")
                    .replaceAll("/+$", "")));
    String configured = env.get("NETDATA_DEFAULT_NODE", "pi5");
    this.defaultNode = nodes.containsKey(configured) ? configured : "pi5";
    this.redis = Redis.createClient(vertx, env.get("REDIS_URL", "redis://redis:6379/0"));
  }

  public void register(Router a) {
    a.get("/proxy/authorize").handler(c -> ok(c, new JsonObject().put("authorized", true)));
    a.get("/log-digest").handler(this::logDigest);
    a.get("/log-digest/days").handler(this::logDays);
    a.get("/uptime").handler(this::uptime);
    a.get("/system-metrics/live").handler(this::metricsLive);
    a.get("/system-metrics/stream").handler(this::metricsStream);
    a.get("/system-metrics").handler(this::metricsFull);
    a.get("/remote/pi5-render").handler(c -> remote(c, "GET", "/v1/pi5-render", 5));
    a.post("/remote/pi5-render/pause").handler(c -> remote(c, "POST", "/v1/pi5-render/pause", 45));
    a.post("/remote/pi5-render/resume")
        .handler(c -> remote(c, "POST", "/v1/pi5-render/resume", 45));
    a.post("/remote/pi5-airplay/start")
        .handler(c -> remote(c, "POST", "/v1/pi5-airplay/start", 45));
    a.post("/remote/pi5-airplay/stop").handler(c -> remote(c, "POST", "/v1/pi5-airplay/stop", 45));
    a.get("/settings/status").handler(this::settingsStatus);
    a.get("/settings/audit").handler(this::auditList);
    a.post("/settings/cache/clear").handler(this::cacheClear);
    a.get("/settings/speedtest").handler(this::latestSpeedtest);
    a.post("/settings/speedtest").handler(c -> runSpeed(c, null));
    a.post("/settings/speedtest/:targetId").handler(c -> runSpeed(c, c.pathParam("targetId")));
    a.post("/settings/restart-toolhub").handler(this::restart);
    a.post("/settings/reboot").handler(this::reboot);
    a.get("/home/small-lights-guard").handler(this::getSmallLightsGuard);
    a.post("/home/small-lights-guard/:state").handler(this::setSmallLightsGuard);
  }

  private void getSmallLightsGuard(RoutingContext context) {
    mongo
        .queryRecords(new JsonObject().put("key", "small_lights_guard"), "homeguardstate")
        .onSuccess(
            rows -> {
              boolean enabled = !rows.isEmpty() && rows.getFirst().getBoolean("enabled", false);
              ok(context, Utility.createSuccessResponse(new JsonObject().put("enabled", enabled)));
            })
        .onFailure(error -> fail(context, 503, error.getMessage()));
  }

  private void setSmallLightsGuard(RoutingContext context) {
    String state = Objects.toString(context.pathParam("state"), "");
    if (!Set.of("status", "on", "off").contains(state)) {
      smallLightsFailure(context, state, "Invalid Small Lights safeguard state");
      return;
    }
    String webhook = env.get("HOME_ASSISTANT_SMALL_LIGHTS_GUARD_WEBHOOK_URL", "").trim();
    if (!(webhook.startsWith("http://") || webhook.startsWith("https://"))) {
      smallLightsFailure(context, state, "Small Lights safeguard control is not configured");
      return;
    }
    web.postAbs(webhook)
        .timeout(8_000)
        .sendJsonObject(new JsonObject().put("state", state))
        .compose(
            response ->
                response.statusCode() < 400
                    ? Future.succeededFuture()
                    : Future.failedFuture("Home Assistant rejected the safeguard request"))
        .compose(
            ignored -> {
              boolean enabled = "on".equals(state);
              return mongo
                  .getMongoClient()
                  .updateCollectionWithOptions(
                      "homeguardstate",
                      new JsonObject().put("key", "small_lights_guard"),
                      new JsonObject().put("$set", new JsonObject().put("enabled", enabled)),
                      new UpdateOptions().setUpsert(true))
                  .map(enabled);
            })
        .onSuccess(
            enabled -> {
              JsonObject result = new JsonObject().put("enabled", enabled);
              audit(
                  context,
                  "SMALL_LIGHTS_GUARD",
                  "COMPLETED",
                  new JsonObject().put("requestedState", state).mergeIn(result));
              ok(context, Utility.createSuccessResponse(result));
            })
        .onFailure(
            error ->
                smallLightsFailure(
                    context, state, "Home Assistant Small Lights safeguard is unavailable"));
  }

  private void smallLightsFailure(RoutingContext context, String state, String message) {
    audit(
        context,
        "SMALL_LIGHTS_GUARD",
        "FAILED",
        new JsonObject().put("requestedState", state).put("error", message));
    fail(context, 503, message);
  }

  private void remote(RoutingContext c, String m, String p, int t) {
    hosts
        .pi(m, p, t)
        .onSuccess(v -> ok(c, Utility.createSuccessResponse(v)))
        .onFailure(e -> fail(c, 503, e.getMessage()));
  }

  private void settingsStatus(RoutingContext c) {
    hosts
        .host("GET", "/v1/status", 5)
        .recover(e -> Future.succeededFuture(new JsonObject().put("available", false)))
        .onSuccess(
            host -> {
              if (!host.containsKey("available")) host.put("available", true);
              redisInfo()
                  .onSuccess(
                      info ->
                          ok(
                              c,
                              Utility.createSuccessResponse(
                                  new JsonObject().put("host", host).put("redis", info))));
            });
  }

  private Future<JsonObject> redisInfo() {
    return Future.all(
            redis.send(Request.cmd(Command.PING)),
            redis.send(Request.cmd(Command.DBSIZE)),
            redis.send(Request.cmd(Command.INFO).arg("memory")))
        .map(
            all -> {
              String info = all.resultAt(2).toString();
              return new JsonObject()
                  .put("status", "up")
                  .put("keys", Long.parseLong(all.resultAt(1).toString()))
                  .put("usedMemoryBytes", redisField(info, "used_memory"))
                  .put("maxMemoryBytes", redisField(info, "maxmemory"));
            })
        .recover(
            e ->
                Future.succeededFuture(
                    new JsonObject()
                        .put("status", "down")
                        .put("keys", 0)
                        .put("usedMemoryBytes", 0)
                        .put("maxMemoryBytes", 0)));
  }

  private long redisField(String info, String key) {
    for (String line : info.split("\\r?\\n"))
      if (line.startsWith(key + ":"))
        try {
          return Long.parseLong(line.substring(key.length() + 1).trim());
        } catch (Exception ignored) {
        }
    return 0;
  }

  private void auditList(RoutingContext c) {
    mongo
        .queryRecords(new JsonObject(), AUDIT)
        .onSuccess(
            rows -> {
              rows.sort(
                  Comparator.comparing((JsonObject r) -> r.getString("createdAt", "")).reversed());
              ok(
                  c,
                  Utility.createSuccessResponse(
                      new JsonObject()
                          .put(
                              "items", new JsonArray(rows.subList(0, Math.min(20, rows.size()))))));
            })
        .onFailure(e -> fail(c, 500, e.getMessage()));
  }

  private void cacheClear(RoutingContext c) {
    scanDelete("buzzwatch:*")
        .onSuccess(
            count -> {
              JsonObject result =
                  new JsonObject()
                      .put("message", "BuzzWatch cache cleared")
                      .put("deletedKeys", count);
              audit(c, "BUZZWATCH_CACHE_CLEAR", "COMPLETED", result);
              ok(c, Utility.createSuccessResponse(result));
            })
        .onFailure(
            e -> {
              JsonObject result =
                  new JsonObject().put("message", "BuzzWatch cache cleared").put("deletedKeys", 0);
              audit(c, "BUZZWATCH_CACHE_CLEAR", "COMPLETED", result);
              ok(c, Utility.createSuccessResponse(result));
            });
  }

  private Future<Integer> scanDelete(String pattern) {
    return redis
        .send(Request.cmd(Command.KEYS).arg(pattern))
        .compose(
            keys -> {
              if (keys == null || keys.size() == 0) return Future.succeededFuture(0);
              Request request = Request.cmd(Command.DEL);
              keys.forEach(x -> request.arg(x.toString()));
              return redis.send(request).map(x -> Integer.parseInt(x.toString()));
            });
  }

  private void latestSpeedtest(RoutingContext c) {
    mongo
        .queryRecords(
            new JsonObject()
                .put("action", "SERVER_FLEET_SPEEDTEST")
                .put(
                    "status",
                    new JsonObject().put("$in", new JsonArray().add("COMPLETED").add("PARTIAL"))),
            AUDIT)
        .onSuccess(
            rows -> {
              rows.sort(
                  Comparator.comparing((JsonObject r) -> r.getString("createdAt", "")).reversed());
              if (rows.isEmpty())
                ok(c, Utility.createSuccessResponse(new JsonObject().put("available", false)));
              else
                ok(
                    c,
                    Utility.createSuccessResponse(
                        new JsonObject()
                            .put("available", true)
                            .mergeIn(rows.getFirst().getJsonObject("details", new JsonObject()))));
            });
  }

  private void runSpeed(RoutingContext c, String target) {
    if (target != null && !SPEED_TARGETS.contains(target)) {
      fail(c, 404, "Unknown speed-test target");
      return;
    }
    String action = target == null ? "SERVER_FLEET_SPEEDTEST" : "SERVER_NODE_SPEEDTEST",
        path = target == null ? "/v1/fleet-speedtest" : "/v1/speedtest/" + target;
    hosts
        .codex("POST", path, 300)
        .onSuccess(
            result -> {
              int failed = 0;
              for (Object x : result.getJsonArray("results", new JsonArray()))
                if (x instanceof JsonObject j && !"ok".equals(j.getString("status"))) failed++;
              String status = failed > 0 ? "PARTIAL" : "COMPLETED";
              audit(c, action, status, result);
              String subject = target == null ? "Fleet" : target;
              ok(
                  c,
                  Utility.createSuccessResponse(
                      new JsonObject()
                          .put(
                              "message",
                              subject + " speed test " + (failed > 0 ? "failed" : "completed"))
                          .mergeIn(result)));
            })
        .onFailure(
            e -> {
              audit(
                  c,
                  action,
                  "FAILED",
                  new JsonObject().put("targetId", target).put("error", e.getMessage()));
              fail(c, 503, e.getMessage());
            });
  }

  private void restart(RoutingContext c) {
    confirmAction(
        c,
        "RESTART TOOLHUB",
        "TOOLHUB_RESTART",
        hosts.host("POST", "/v1/restart-toolhub", 5),
        "ToolHub restart scheduled");
  }

  private void reboot(RoutingContext c) {
    confirmAction(
        c,
        "RESTART PI",
        "PI_REBOOT",
        hosts.host("POST", "/v1/reboot", 5),
        "Raspberry Pi restart scheduled");
  }

  private void confirmAction(
      RoutingContext c, String expected, String action, Future<JsonObject> call, String message) {
    JsonObject b = c.body().asJsonObject();
    if (b == null || !expected.equals(b.getString("confirmation"))) {
      fail(c, 400, "Type \"" + expected + "\" to confirm this action");
      return;
    }
    call.onSuccess(
            r -> {
              audit(c, action, "ACCEPTED", new JsonObject());
              ok(
                  c,
                  Utility.createSuccessResponse(
                      new JsonObject().put("message", message).mergeIn(r)));
            })
        .onFailure(
            e -> {
              audit(c, action, "FAILED", new JsonObject().put("error", e.getMessage()));
              fail(c, 503, e.getMessage());
            });
  }

  private void audit(RoutingContext c, String action, String status, JsonObject details) {
    mongo.insertRecord(
        new JsonObject()
            .put("userId", c.get("userId"))
            .put("email", c.get("userEmail"))
            .put("action", action)
            .put("status", status)
            .put("details", details)
            .put("createdAt", Instant.now().toString()),
        AUDIT);
  }

  private void logDigest(RoutingContext c) {
    String date = c.request().getParam("date");
    Path base = Path.of(env.get("LOG_DIGEST_PATH", "/data/log-digest/latest.json"));
    Path target = base;
    if (date != null) {
      if (!DATE.matcher(date).matches()) {
        fail(c, 400, "Invalid digest date");
        return;
      }
      target = base.getParent().resolve(date + ".json");
    }
    readDigest(c, target);
  }

  private void readDigest(RoutingContext c, Path path) {
    try {
      if (!Files.exists(path)) {
        fail(c, 404, "No log digest has been published yet");
        return;
      }
      if (Files.size(path) > 2L * 1024 * 1024) {
        fail(c, 503, "Log digest is too large");
        return;
      }
      JsonObject report = new JsonObject(Files.readString(path));
      if (!Set.of(1, 2, 3).contains(report.getInteger("schemaVersion"))) {
        fail(c, 503, "Log digest format is invalid");
        return;
      }
      ok(c, report);
    } catch (Exception e) {
      fail(c, 503, "Log digest is temporarily unavailable");
    }
  }

  private void logDays(RoutingContext c) {
    Path base = Path.of(env.get("LOG_DIGEST_PATH", "/data/log-digest/latest.json")).getParent();
    JsonArray days = new JsonArray();
    try {
      if (base == null || !Files.isDirectory(base)) {
        ok(c, new JsonObject().put("days", days));
        return;
      }
      try (var paths = Files.list(base)) {
        paths
            .filter(
                p ->
                    DATE.matcher(p.getFileName().toString().replaceFirst("\\.json$", "")).matches())
            .sorted(Comparator.reverseOrder())
            .limit(90)
            .forEach(
                p -> {
                  try {
                    JsonObject r = new JsonObject(Files.readString(p));
                    days.add(
                        new JsonObject()
                            .put(
                                "date",
                                r.getString(
                                    "reportDate", p.getFileName().toString().replace(".json", "")))
                            .put("generatedAt", r.getValue("generatedAt"))
                            .put("overallStatus", r.getValue("overallStatus"))
                            .put("summary", r.getJsonObject("summary", new JsonObject())));
                  } catch (Exception ignored) {
                  }
                });
      }
      ok(c, new JsonObject().put("days", days));
    } catch (Exception e) {
      fail(c, 503, "Log digest history is temporarily unavailable");
    }
  }

  private void uptime(RoutingContext c) {
    web.getAbs(
            env.get("GATUS_URL", "http://gatus:8082").replaceAll("/+$", "")
                + "/api/v1/endpoints/statuses")
        .timeout(10_000)
        .send()
        .onSuccess(
            res -> {
              if (res.statusCode() >= 400) {
                fail(c, 502, "Uptime data is temporarily unavailable");
                return;
              }
              JsonArray endpoints = new JsonArray();
              for (Object v : res.bodyAsJsonArray()) {
                if (!(v instanceof JsonObject ep)) continue;
                JsonArray results = ep.getJsonArray("results", new JsonArray());
                JsonObject latest =
                    results.isEmpty()
                        ? new JsonObject()
                        : results.getJsonObject(results.size() - 1);
                int success = 0;
                double duration = 0;
                for (Object x : results)
                  if (x instanceof JsonObject r) {
                    if (r.getBoolean("success", false)) success++;
                    duration += number(r.getValue("duration"), 0) / 1_000_000;
                  }
                endpoints.add(
                    new JsonObject()
                        .put("key", ep.getValue("key"))
                        .put("name", ep.getValue("name"))
                        .put("group", ep.getString("group", "Other"))
                        .put("healthy", latest.getBoolean("success", false))
                        .put(
                            "uptimePercent",
                            results.isEmpty() ? 0 : success * 100.0 / results.size())
                        .put("averageResponseMs", results.isEmpty() ? 0 : duration / results.size())
                        .put("lastResponseMs", number(latest.getValue("duration"), 0) / 1_000_000)
                        .put("lastCheckedAt", latest.getValue("timestamp"))
                        .put("statusCode", latest.getValue("status"))
                        .put("errors", latest.getJsonArray("errors", new JsonArray()))
                        .put("sampleCount", results.size()));
              }
              ok(
                  c,
                  Utility.createSuccessResponse(
                      new JsonObject()
                          .put("generatedAt", Instant.now().getEpochSecond())
                          .put("endpoints", endpoints)));
            })
        .onFailure(e -> fail(c, 502, "Uptime data is temporarily unavailable"));
  }

  private void metricsLive(RoutingContext c) {
    currentMetrics(node(c))
        .onSuccess(v -> ok(c, v))
        .onFailure(e -> fail(c, 502, "System metrics are temporarily unavailable"));
  }

  private void metricsStream(RoutingContext c) {
    Node n = node(c);
    if (n == null) return;
    var response =
        c.response()
            .setChunked(true)
            .putHeader("Content-Type", "text/event-stream")
            .putHeader("Cache-Control", "no-cache, no-transform")
            .putHeader("X-Accel-Buffering", "no");
    response.write("retry: 2000\n\n");
    long timer =
        vertx.setPeriodic(
            1000,
            id ->
                currentMetrics(n)
                    .onSuccess(
                        v ->
                            response.write(
                                "id: "
                                    + v.getLong("sampledAt")
                                    + "\nevent: metrics\ndata: "
                                    + v.encode()
                                    + "\n\n"))
                    .onFailure(
                        e ->
                            response.write(
                                "event: stream-error\ndata: {\"message\":\"System metrics are temporarily unavailable\"}\n\n")));
    c.request().connection().closeHandler(v -> vertx.cancelTimer(timer));
  }

  private void metricsFull(RoutingContext c) {
    Node n = node(c);
    if (n == null) return;
    Future.all(
            List.of(
                netdata(n, "/api/v1/info", Map.of()),
                netdata(n, "/api/v1/alarms", Map.of("all", "true")),
                currentMetrics(n),
                chart(n, "system.cpu"),
                chart(n, "system.ram"),
                chart(n, "system.load"),
                chart(n, "system.io"),
                chart(n, "system.net"),
                chart(n, "sensors.temperature_cpu_thermal-virtual-0_temp1_input")))
        .onSuccess(
            all -> {
              JsonObject info = all.resultAt(0),
                  alarmData = all.resultAt(1),
                  live = all.resultAt(2);
              JsonArray alarms = new JsonArray();
              for (String name : alarmData.getJsonObject("alarms", new JsonObject()).fieldNames()) {
                JsonObject a = alarmData.getJsonObject("alarms").getJsonObject(name);
                if (Set.of("WARNING", "CRITICAL").contains(a.getString("status")))
                  alarms.add(
                      new JsonObject()
                          .put("name", name)
                          .put("status", a.getValue("status"))
                          .put("value", a.getValue("value"))
                          .put("units", a.getValue("units"))
                          .put("info", a.getValue("info")));
              }
              JsonArray mirrored =
                  info.getJsonArray("mirrored_hosts", new JsonArray().add(n.label));
              JsonObject host =
                  new JsonObject()
                      .put("hostname", mirrored.getValue(0))
                      .put("version", info.getValue("version"))
                      .put("osName", info.getValue("os_name"))
                      .put("osVersion", info.getValue("os_version"))
                      .put("kernelVersion", info.getValue("kernel_version"))
                      .put("architecture", info.getValue("architecture"))
                      .put("cores", info.getValue("cores_total"))
                      .put("cpuFrequency", info.getValue("cpu_freq"))
                      .put("ramBytes", info.getValue("ram_total"))
                      .put("diskBytes", info.getValue("total_disk_space"));
              JsonObject charts =
                  new JsonObject()
                      .put("cpu", all.resultAt(3))
                      .put("memory", all.resultAt(4))
                      .put("load", all.resultAt(5))
                      .put("diskIo", all.resultAt(6))
                      .put("network", all.resultAt(7))
                      .put("temperature", all.resultAt(8));
              ok(
                  c,
                  new JsonObject()
                      .put("node", n.id)
                      .put(
                          "nodes",
                          new JsonArray(
                              nodes.values().stream()
                                  .map(x -> new JsonObject().put("id", x.id).put("label", x.label))
                                  .toList()))
                      .put("host", host)
                      .put("live", live)
                      .put("charts", charts)
                      .put("alarms", alarms));
            })
        .onFailure(e -> fail(c, 502, "System metrics are temporarily unavailable"));
  }

  private Future<JsonObject> currentMetrics(Node n) {
    if (n == null) return Future.failedFuture("Unknown metrics node");
    return netdata(
            n,
            "/api/v1/allmetrics",
            Map.of(
                "format",
                "json",
                "filter",
                "system.cpu system.ram system.load system.io system.net system.uptime app.*_cpu_utilization app.*_mem_usage app.*_processes disk_space./ sensors.temperature_cpu_thermal-virtual-0_temp1_input"))
        .map(
            snapshot -> {
              Metric cpu = dim(snapshot, "system.cpu"),
                  memory = dim(snapshot, "system.ram"),
                  load = dim(snapshot, "system.load"),
                  io = dim(snapshot, "system.io"),
                  network = dim(snapshot, "system.net"),
                  temperature =
                      dim(snapshot, "sensors.temperature_cpu_thermal-virtual-0_temp1_input"),
                  disk = dim(snapshot, "disk_space./"),
                  uptime = dim(snapshot, "system.uptime");
              long sampled =
                  List.of(cpu, memory, load, io, network, temperature, disk, uptime).stream()
                      .mapToLong(x -> x.updated)
                      .max()
                      .orElse(Instant.now().getEpochSecond());
              double total = sum(memory.values, "free", "used", "cached", "buffers"),
                  usable = sum(disk.values, "used", "avail"),
                  active =
                      cpu.values.entrySet().stream()
                          .filter(e -> !e.getKey().equals("idle"))
                          .mapToDouble(Map.Entry::getValue)
                          .sum();
              return new JsonObject()
                  .put("sampledAt", sampled)
                  .put("sampleAgeSeconds", Math.max(0, Instant.now().getEpochSecond() - sampled))
                  .put(
                      "cpu",
                      new JsonObject()
                          .put("percent", Math.max(0, Math.min(100, active)))
                          .put("user", get(cpu, "user"))
                          .put("system", get(cpu, "system"))
                          .put("nice", get(cpu, "nice"))
                          .put("iowait", get(cpu, "iowait"))
                          .put("softirq", get(cpu, "softirq"))
                          .put("irq", get(cpu, "irq"))
                          .put("steal", get(cpu, "steal")))
                  .put(
                      "memory",
                      new JsonObject()
                          .put("percent", total == 0 ? 0 : get(memory, "used") / total * 100)
                          .put("usedMiB", get(memory, "used"))
                          .put("cachedMiB", get(memory, "cached"))
                          .put("freeMiB", get(memory, "free"))
                          .put("availableMiB", sum(memory.values, "free", "cached", "buffers"))
                          .put("totalMiB", total))
                  .put(
                      "load",
                      new JsonObject()
                          .put("load1", get(load, "load1"))
                          .put("load5", get(load, "load5"))
                          .put("load15", get(load, "load15")))
                  .put(
                      "disk",
                      new JsonObject()
                          .put("percent", usable == 0 ? 0 : get(disk, "used") / usable * 100)
                          .put("usedGiB", get(disk, "used"))
                          .put("availableGiB", get(disk, "avail"))
                          .put("usableGiB", usable)
                          .put("reservedGiB", get(disk, "reserved for root")))
                  .put(
                      "diskIo",
                      new JsonObject()
                          .put("readKiBps", Math.abs(get(io, "reads")))
                          .put("writeKiBps", Math.abs(get(io, "writes"))))
                  .put(
                      "network",
                      new JsonObject()
                          .put("receivedKbps", Math.abs(get(network, "received")))
                          .put("sentKbps", Math.abs(get(network, "sent"))))
                  .put("temperatureCelsius", get(temperature, "input"))
                  .put("uptimeSeconds", get(uptime, "uptime"))
                  .put("processes", new JsonArray());
            });
  }

  private Future<JsonObject> chart(Node n, String name) {
    return netdata(
            n,
            "/api/v1/data",
            Map.of(
                "chart", name, "after", "-120", "points", "60", "group", "average", "format",
                "json"))
        .recover(
            e ->
                Future.succeededFuture(
                    new JsonObject()
                        .put("labels", new JsonArray().add("time"))
                        .put("data", new JsonArray())));
  }

  private Future<JsonObject> netdata(Node n, String path, Map<String, String> params) {
    var req = web.getAbs(n.url + path).timeout(5000);
    for (var e : params.entrySet()) req.addQueryParam(e.getKey(), e.getValue());
    return req.send()
        .compose(
            r ->
                r.statusCode() >= 200 && r.statusCode() < 300
                    ? Future.succeededFuture(r.bodyAsJsonObject())
                    : Future.failedFuture("netdata " + r.statusCode()));
  }

  private Metric dim(JsonObject snapshot, String chart) {
    JsonObject metric = snapshot.getJsonObject(chart, new JsonObject()),
        dims = metric.getJsonObject("dimensions", new JsonObject());
    Map<String, Double> values = new HashMap<>();
    for (String key : dims.fieldNames()) {
      JsonObject d = dims.getJsonObject(key);
      values.put(d.getString("name", key), number(d.getValue("value"), 0));
    }
    return new Metric(metric.getLong("last_updated", 0L), values);
  }

  private Node node(RoutingContext c) {
    String id = Objects.toString(c.request().getParam("node"), defaultNode);
    Node n = nodes.get(id);
    if (n == null) fail(c, 404, "Unknown metrics node");
    return n;
  }

  private double get(Metric m, String k) {
    return m.values.getOrDefault(k, 0d);
  }

  private double sum(Map<String, Double> m, String... keys) {
    return Arrays.stream(keys).mapToDouble(k -> m.getOrDefault(k, 0d)).sum();
  }

  private double number(Object v, double f) {
    try {
      return Double.parseDouble(Objects.toString(v));
    } catch (Exception e) {
      return f;
    }
  }

  private void ok(RoutingContext c, Object b) {
    c.response()
        .putHeader("Content-Type", "application/json")
        .end(io.vertx.core.json.Json.encode(b));
  }

  private void fail(RoutingContext c, int s, String m) {
    Utility.buildResponse(c, s, Utility.createErrorResponse(m));
  }

  private record Node(String id, String label, String url) {}

  private record Metric(long updated, Map<String, Double> values) {}
}
