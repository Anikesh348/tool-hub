package com.toolhub.services.flights;

import com.toolhub.Utils.Utility;
import com.toolhub.services.alerts.MailService;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.redis.RedisCache;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Pattern;

public class FlightService {
  private static final String WATCHES = "flightwatches";
  private static final String HISTORY = "flighthistory";
  private static final String ALERT_STATE = "flight-alert-state";
  private static final Pattern IATA = Pattern.compile("^[A-Z]{3}$");
  private static final Set<String> CABINS =
      Set.of("ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST");
  private final MongoDBClient mongo;
  private final WebClient client;
  private final Dotenv env;
  private final MailService mail;
  private final RedisCache cache;

  public FlightService(MongoDBClient mongo, WebClient client, Vertx vertx, Dotenv env) {
    this.mongo = mongo;
    this.client = client;
    this.env = env;
    this.mail = new MailService(client);
    this.cache = new RedisCache(vertx);
  }

  public void providerStatus(RoutingContext ctx) {
    Utility.buildResponse(
        ctx,
        200,
        new JsonObject()
            .put("provider", "multi-provider-flight-scraper")
            .put("configured", true)
            .put("baseUrl", scraperBase())
            .put(
                "note",
                "Uses ToolHub scraper container with Kiwi, Google Flights, and Skyscanner fallbacks when available."));
  }

  public void places(RoutingContext ctx) {
    String query =
        Objects.toString(ctx.request().getParam("query"), "").trim().replaceAll("\\s+", " ");
    int limit = intRange(ctx.request().getParam("limit"), 12, 1, 25);
    if (query.length() < 2) {
      Utility.buildResponse(
          ctx, 200, new JsonObject().put("query", query).put("results", new JsonArray()));
      return;
    }
    String cacheKey =
        "toolhub:v1:flight-places:"
            + RedisCache.token(query.toLowerCase(Locale.ROOT))
            + ":"
            + limit;
    cache
        .get(cacheKey)
        .onSuccess(
            cached -> {
              if (cached != null) {
                Utility.buildResponse(ctx, 200, cached);
                return;
              }
              client
                  .getAbs(scraperUrl("/v2/flights/places"))
                  .addQueryParam("query", query.toLowerCase(Locale.ROOT))
                  .addQueryParam("limit", Integer.toString(limit))
                  .send()
                  .onSuccess(
                      res -> {
                        JsonObject payload = safeJson(res.bodyAsString());
                        if (res.statusCode() >= 200 && res.statusCode() < 300) {
                          cache.set(
                              cacheKey, payload, intEnv("FLIGHT_PLACE_CACHE_SECONDS", 86_400));
                          Utility.buildResponse(ctx, 200, payload);
                        } else
                          Utility.buildResponse(
                              ctx,
                              200,
                              new JsonObject()
                                  .put("query", query)
                                  .put("results", new JsonArray())
                                  .put("error", error(payload, res.statusCode())));
                      })
                  .onFailure(
                      e ->
                          Utility.buildResponse(
                              ctx,
                              200,
                              new JsonObject()
                                  .put("query", query)
                                  .put("results", new JsonArray())
                                  .put("error", e.getMessage())));
            });
  }

  public void createWatch(RoutingContext ctx) {
    final JsonObject watch;
    try {
      watch = normalize(ctx.body().asJsonObject(), ctx);
    } catch (IllegalArgumentException e) {
      Utility.buildResponse(ctx, 400, Utility.createErrorResponse(e.getMessage()));
      return;
    }
    mongo
        .insertRecord(watch, WATCHES)
        .onSuccess(
            v ->
                check(watch)
                    .onSuccess(
                        result ->
                            Utility.buildResponse(
                                ctx,
                                200,
                                Utility.createSuccessResponse(result.getJsonObject("watch"))))
                    .onFailure(
                        e ->
                            recordFailure(watch, e.getMessage())
                                .onComplete(
                                    v2 -> {
                                      JsonObject result =
                                          watch
                                              .copy()
                                              .put("lastError", e.getMessage())
                                              .put("lastCheckedAt", now());
                                      Utility.buildResponse(
                                          ctx, 200, Utility.createSuccessResponse(result));
                                    })))
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void listWatches(RoutingContext ctx) {
    mongo
        .queryRecords(new JsonObject().put("userId", ctx.get("userId")), WATCHES)
        .onSuccess(
            rows -> {
              rows.sort(
                  Comparator.comparing((JsonObject r) -> r.getString("createdAt", "")).reversed());
              Utility.buildResponse(ctx, 200, rows);
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void getWatch(RoutingContext ctx) {
    owned(ctx)
        .onSuccess(
            watch -> {
              if (watch == null) fail(ctx, 404, "Flight watch not found");
              else Utility.buildResponse(ctx, 200, watch);
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void deleteWatch(RoutingContext ctx) {
    JsonObject query = ownerQuery(ctx);
    mongo
        .getMongoClient()
        .removeDocuments(WATCHES, query)
        .compose(v -> mongo.getMongoClient().removeDocuments(ALERT_STATE, query))
        .onSuccess(
            v ->
                Utility.buildResponse(
                    ctx, 200, Utility.createSuccessResponse("Flight watch deleted")))
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void history(RoutingContext ctx) {
    owned(ctx)
        .compose(
            watch ->
                watch == null
                    ? Future.succeededFuture(List.of())
                    : mongo.queryRecords(ownerQuery(ctx), HISTORY))
        .onSuccess(
            rows -> {
              rows.sort(
                  Comparator.comparing((JsonObject r) -> r.getString("createdAt", "")).reversed());
              Utility.buildResponse(ctx, 200, rows.subList(0, Math.min(120, rows.size())));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void checkWatch(RoutingContext ctx) {
    owned(ctx)
        .onSuccess(
            watch -> {
              if (watch == null) {
                fail(ctx, 404, "Flight watch not found");
                return;
              }
              check(watch)
                  .onSuccess(
                      result ->
                          Utility.buildResponse(ctx, 200, Utility.createSuccessResponse(result)))
                  .onFailure(
                      e ->
                          recordFailure(watch, e.getMessage())
                              .onComplete(v -> fail(ctx, 502, e.getMessage())));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  /** Scheduler entrypoint: checks all active watches with bounded concurrency. */
  public Future<JsonObject> checkAllWatches() {
    return mongo
        .queryRecords(new JsonObject().put("active", new JsonObject().put("$ne", false)), WATCHES)
        .compose(
            rows ->
                checkWatchBatch(
                    rows,
                    0,
                    intEnv("FLIGHT_CHECK_WORKERS", 4),
                    new JsonObject().put("checked", 0).put("succeeded", 0).put("failed", 0)))
        .map(summary -> summary.put("completedAt", now()));
  }

  private Future<JsonObject> checkWatchBatch(
      List<JsonObject> rows, int offset, int workers, JsonObject summary) {
    if (offset >= rows.size()) return Future.succeededFuture(summary);
    int end = Math.min(rows.size(), offset + Math.max(1, workers));
    List<Future<?>> checks = new ArrayList<>();
    for (JsonObject watch : rows.subList(offset, end)) {
      checks.add(
          check(watch)
              .map(
                  result -> {
                    summary.put("checked", summary.getInteger("checked") + 1);
                    summary.put("succeeded", summary.getInteger("succeeded") + 1);
                    return result;
                  })
              .recover(
                  error ->
                      recordFailure(watch, error.getMessage())
                          .map(
                              ignored -> {
                                summary.put("checked", summary.getInteger("checked") + 1);
                                summary.put("failed", summary.getInteger("failed") + 1);
                                return null;
                              })));
    }
    return Future.all(checks).compose(ignored -> checkWatchBatch(rows, end, workers, summary));
  }

  private Future<JsonObject> check(JsonObject watch) {
    JsonObject payload =
        new JsonObject()
            .put("origin", watch.getString("origin"))
            .put("destination", watch.getString("destination"))
            .put("departureDate", watch.getString("departureDate"))
            .put("returnDate", watch.getString("returnDate"))
            .put("adults", watch.getInteger("adults", 1))
            .put("children", watch.getInteger("children", 0))
            .put("infants", watch.getInteger("infants", 0))
            .put("cabin", watch.getString("cabin", "ECONOMY"))
            .put("currency", watch.getString("currency", "INR"))
            .put("maxStops", watch.getValue("maxStops"));
    return client
        .postAbs(scraperUrl("/v2/flights/search"))
        .sendJsonObject(payload)
        .compose(
            res -> {
              JsonObject body = safeJson(res.bodyAsString());
              if (res.statusCode() < 200
                  || res.statusCode() >= 300
                  || !"success".equals(body.getString("status")))
                return Future.failedFuture(error(body, res.statusCode()));
              double price = number(body.getValue("price"), 0);
              if (price <= 0)
                return Future.failedFuture("Flight scraper did not return a valid price");
              JsonArray offers =
                  normalizeOffers(body.getJsonArray("offers", new JsonArray()), watch, body);
              JsonObject result =
                  new JsonObject()
                      .put("price", round2(price))
                      .put(
                          "currency",
                          body.getString("currency", watch.getString("currency", "INR")))
                      .put("airlines", body.getJsonArray("airlines", new JsonArray()))
                      .put("stops", body.getValue("stops"))
                      .put("departureAt", body.getValue("departureAt"))
                      .put("arrivalAt", body.getValue("arrivalAt"))
                      .put("sourceUrl", body.getString("url"))
                      .put("fetchedUrl", body.getString("fetchedUrl"))
                      .put("rawProvider", body.getString("provider", "flight-price-provider"))
                      .put("offers", offers);
              JsonObject history = historyRecord(watch, result, "ok", "");
              return mongo
                  .insertRecord(history, HISTORY)
                  .compose(v -> alertIfNeeded(watch, result))
                  .compose(
                      alerted -> {
                        String checked = now();
                        JsonObject update =
                            new JsonObject()
                                .put("lastPrice", result.getDouble("price"))
                                .put("lastCurrency", result.getString("currency"))
                                .put("lastAirlines", result.getJsonArray("airlines"))
                                .put("lastStops", result.getValue("stops"))
                                .put("sourceUrl", result.getString("sourceUrl"))
                                .put("lastProvider", result.getString("rawProvider"))
                                .put("lastOffers", offers)
                                .put("lastCheckedAt", checked)
                                .put("lastError", "")
                                .put("updatedAt", checked);
                        if (alerted) update.put("lastAlertedAt", checked);
                        return mongo
                            .updateRecord(
                                new JsonObject().put("watchId", watch.getString("watchId")),
                                new JsonObject().put("$set", update),
                                WATCHES)
                            .map(
                                x ->
                                    new JsonObject()
                                        .put("watch", watch.copy().mergeIn(update))
                                        .put("history", history)
                                        .put("alerted", alerted));
                      });
            });
  }

  private Future<Boolean> alertIfNeeded(JsonObject watch, JsonObject result) {
    double price = result.getDouble("price"),
        threshold = number(watch.getValue("thresholdPrice"), 0);
    JsonObject query =
        new JsonObject()
            .put("watchId", watch.getString("watchId"))
            .put("userId", watch.getString("userId"));
    return mongo
        .queryRecords(query, ALERT_STATE)
        .compose(
            rows -> {
              JsonObject state = rows.isEmpty() ? new JsonObject() : rows.getFirst();
              if (price > threshold)
                return upsertAlertState(
                        query, new JsonObject().put("active", false).put("lastSeenPrice", price))
                    .map(false);
              boolean should =
                  !state.getBoolean("active", false)
                      || price < number(state.getValue("lastAlertedPrice"), threshold + 1);
              if (!should)
                return upsertAlertState(query, new JsonObject().put("lastSeenPrice", price))
                    .map(false);
              String recipient = watch.getString("userEmail", "").trim();
              if (recipient.isBlank()) return Future.succeededFuture(false);
              String subject =
                  "Flight drop: "
                      + routeLabel(watch)
                      + " is "
                      + money(price, result.getString("currency", "INR"));
              String html =
                  "<html><body><h3>Flight price alert</h3><p><strong>"
                      + escape(routeLabel(watch))
                      + "</strong> is now available at <strong>"
                      + escape(money(price, result.getString("currency", "INR")))
                      + "</strong>.</p><p>Your alert threshold is <strong>"
                      + escape(money(threshold, watch.getString("currency", "INR")))
                      + "</strong>.</p></body></html>";
              return mail.sendEmail(subject, recipient, html)
                  .compose(
                      v ->
                          upsertAlertState(
                              query,
                              new JsonObject()
                                  .put("active", true)
                                  .put("thresholdPrice", threshold)
                                  .put("lastAlertedPrice", price)
                                  .put("lastSeenPrice", price)
                                  .put("lastAlertedAt", now())))
                  .map(true);
            });
  }

  private Future<Void> upsertAlertState(JsonObject query, JsonObject values) {
    String timestamp = now();
    values.put("lastCheckedAt", timestamp).put("updatedAt", timestamp);
    return mongo
        .getMongoClient()
        .updateCollectionWithOptions(
            ALERT_STATE,
            query,
            new JsonObject()
                .put("$set", values)
                .put("$setOnInsert", new JsonObject().put("createdAt", timestamp)),
            new io.vertx.ext.mongo.UpdateOptions().setUpsert(true))
        .mapEmpty();
  }

  private JsonObject normalize(JsonObject body, RoutingContext ctx) {
    if (body == null) throw new IllegalArgumentException("request body is required");
    String origin = iata(body.getValue("origin")), destination = iata(body.getValue("destination"));
    if (origin.equals(destination))
      throw new IllegalArgumentException("Origin and destination must be different");
    String departure = date(body.getValue("departureDate"), "Departure date");
    String returning = Objects.toString(body.getValue("returnDate"), "").trim();
    if (!returning.isBlank()) {
      returning = date(returning, "Return date");
      if (returning.compareTo(departure) < 0)
        throw new IllegalArgumentException("Return date cannot be before departure date");
    }
    String cabin =
        Objects.toString(body.getValue("cabin"), "ECONOMY").trim().toUpperCase(Locale.ROOT);
    if (!CABINS.contains(cabin))
      throw new IllegalArgumentException(
          "Cabin must be ECONOMY, PREMIUM_ECONOMY, BUSINESS, or FIRST");
    int adults = positive(body.getValue("adults"), "Adults", 1, 1, 9);
    int infants = positive(body.getValue("infants"), "Infants", 0, 0, adults);
    Object maxStopsRaw = body.getValue("maxStops");
    Integer maxStops =
        maxStopsRaw == null || Objects.toString(maxStopsRaw, "").isBlank()
            ? null
            : positive(maxStopsRaw, "Max stops", 0, 0, 3);
    double threshold = number(body.getValue("thresholdPrice"), -1);
    if (threshold <= 0)
      throw new IllegalArgumentException("Threshold price must be greater than 0");
    String currency =
        Objects.toString(body.getValue("currency"), "INR").trim().toUpperCase(Locale.ROOT);
    if (!IATA.matcher(currency).matches())
      throw new IllegalArgumentException("Currency must be a 3-letter code");
    String timestamp = now();
    return new JsonObject()
        .put("watchId", UUID.randomUUID().toString().replace("-", ""))
        .put("userId", ctx.get("userId"))
        .put("userEmail", Objects.toString(ctx.get("userEmail"), ""))
        .put("origin", origin)
        .put("originLabel", clipped(body.getString("originLabel", origin), 120))
        .put("destination", destination)
        .put("destinationLabel", clipped(body.getString("destinationLabel", destination), 120))
        .put("departureDate", departure)
        .put("returnDate", returning)
        .put("tripType", returning.isBlank() ? "one-way" : "return")
        .put("adults", adults)
        .put("children", positive(body.getValue("children"), "Children", 0, 0, 9))
        .put("infants", infants)
        .put("cabin", cabin)
        .put("currency", currency)
        .put("thresholdPrice", round2(threshold))
        .put("maxStops", maxStops)
        .put("note", clipped(body.getString("note", ""), 160))
        .put("active", true)
        .put("provider", "skyscanner-scraper")
        .put("createdAt", timestamp)
        .put("updatedAt", timestamp);
  }

  private JsonArray normalizeOffers(JsonArray raw, JsonObject watch, JsonObject fallback) {
    Map<String, JsonObject> unique = new LinkedHashMap<>();
    for (Object value : raw)
      if (value instanceof JsonObject offer) {
        double price = number(offer.getValue("price"), 0);
        if (price <= 0) continue;
        JsonObject normalized =
            new JsonObject()
                .put("price", round2(price))
                .put(
                    "currency",
                    offer
                        .getString("currency", watch.getString("currency", "INR"))
                        .toUpperCase(Locale.ROOT))
                .put("airlines", offer.getJsonArray("airlines", new JsonArray()))
                .put("stops", offer.getValue("stops"))
                .put("departureAt", offer.getValue("departureAt"))
                .put("arrivalAt", offer.getValue("arrivalAt"))
                .put("sourceUrl", offer.getString("sourceUrl", offer.getString("url")))
                .put("fetchedUrl", offer.getString("fetchedUrl"))
                .put(
                    "provider",
                    offer.getString("provider", offer.getString("source", "flight-price-provider")))
                .put("source", offer.getValue("source"));
        unique.put(normalized.encode(), normalized);
      }
    List<JsonObject> sorted = new ArrayList<>(unique.values());
    sorted.sort(Comparator.comparingDouble(x -> x.getDouble("price")));
    if (sorted.isEmpty())
      sorted.add(
          new JsonObject()
              .put("price", round2(number(fallback.getValue("price"), 0)))
              .put("currency", fallback.getString("currency", watch.getString("currency", "INR")))
              .put("airlines", fallback.getJsonArray("airlines", new JsonArray()))
              .put("stops", fallback.getValue("stops"))
              .put("sourceUrl", fallback.getString("url"))
              .put("provider", fallback.getString("provider", "flight-price-provider")));
    return new JsonArray(sorted.subList(0, Math.min(8, sorted.size())));
  }

  private JsonObject historyRecord(
      JsonObject watch, JsonObject result, String status, String message) {
    return new JsonObject()
        .put("historyId", UUID.randomUUID().toString().replace("-", ""))
        .put("watchId", watch.getString("watchId"))
        .put("userId", watch.getString("userId"))
        .put("origin", watch.getString("origin"))
        .put("originLabel", watch.getString("originLabel"))
        .put("destination", watch.getString("destination"))
        .put("destinationLabel", watch.getString("destinationLabel"))
        .put("departureDate", watch.getString("departureDate"))
        .put("returnDate", watch.getString("returnDate"))
        .put("tripType", watch.getString("tripType"))
        .put("price", result.getValue("price"))
        .put("currency", result.getString("currency", watch.getString("currency")))
        .put("airlines", result.getJsonArray("airlines", new JsonArray()))
        .put("stops", result.getValue("stops"))
        .put("sourceUrl", result.getValue("sourceUrl"))
        .put("provider", result.getValue("rawProvider"))
        .put("offers", result.getJsonArray("offers", new JsonArray()))
        .put("status", status)
        .put("message", message)
        .put("createdAt", now());
  }

  private Future<Void> recordFailure(JsonObject watch, String message) {
    JsonObject update =
        new JsonObject()
            .put("lastError", message)
            .put("lastCheckedAt", now())
            .put("updatedAt", now());
    return mongo
        .insertRecord(historyRecord(watch, new JsonObject(), "error", message), HISTORY)
        .compose(
            v ->
                mongo.updateRecord(
                    new JsonObject().put("watchId", watch.getString("watchId")),
                    new JsonObject().put("$set", update),
                    WATCHES));
  }

  private Future<JsonObject> owned(RoutingContext ctx) {
    return mongo
        .queryRecords(ownerQuery(ctx), WATCHES)
        .map(rows -> rows.isEmpty() ? null : rows.getFirst());
  }

  private JsonObject ownerQuery(RoutingContext ctx) {
    return new JsonObject()
        .put("watchId", ctx.pathParam("watchId"))
        .put("userId", ctx.get("userId"));
  }

  private String scraperBase() {
    String v =
        env.get(
            "SCRAPPER_FLIGHT_URL",
            env.get("SCRAPPER_SEARCH_URL", "http://scraper-beautifulsoup:8001"));
    v = v.replaceAll("/+$", "");
    return v.endsWith("/v2/search") ? v.substring(0, v.length() - 10) : v;
  }

  private String scraperUrl(String path) {
    return scraperBase() + (path.startsWith("/") ? path : "/" + path);
  }

  private String iata(Object value) {
    String code = Objects.toString(value, "").trim().toUpperCase(Locale.ROOT);
    if (!IATA.matcher(code).matches())
      throw new IllegalArgumentException("Choose a city or airport from the search results");
    return code;
  }

  private String date(Object value, String label) {
    try {
      LocalDate d = LocalDate.parse(Objects.toString(value, "").trim());
      if (d.isBefore(LocalDate.now(java.time.ZoneOffset.UTC)))
        throw new IllegalArgumentException(label + " cannot be in the past");
      return d.toString();
    } catch (DateTimeParseException e) {
      throw new IllegalArgumentException(label + " must use YYYY-MM-DD");
    }
  }

  private int positive(Object value, String label, int fallback, int min, int max) {
    if (value == null || Objects.toString(value, "").isBlank()) return fallback;
    try {
      int n = Integer.parseInt(Objects.toString(value));
      if (n < min || n > max)
        throw new IllegalArgumentException(label + " must be between " + min + " and " + max);
      return n;
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException(label + " must be a number");
    }
  }

  private int intRange(String raw, int fallback, int min, int max) {
    try {
      return Math.max(min, Math.min(max, Integer.parseInt(raw)));
    } catch (Exception e) {
      return fallback;
    }
  }

  private int intEnv(String key, int fallback) {
    try {
      return Integer.parseInt(env.get(key, Integer.toString(fallback)));
    } catch (Exception e) {
      return fallback;
    }
  }

  private double number(Object value, double fallback) {
    try {
      return Double.parseDouble(Objects.toString(value));
    } catch (Exception e) {
      return fallback;
    }
  }

  private double round2(double v) {
    return Math.round(v * 100.0) / 100.0;
  }

  private String now() {
    return Instant.now().toString();
  }

  private String clipped(String v, int max) {
    v = Objects.toString(v, "").trim();
    return v.substring(0, Math.min(max, v.length()));
  }

  private JsonObject safeJson(String text) {
    try {
      return new JsonObject(text == null || text.isBlank() ? "{}" : text);
    } catch (Exception e) {
      return new JsonObject();
    }
  }

  private String error(JsonObject body, int status) {
    return body.getString("error", "Flight scraper returned HTTP " + status);
  }

  private String routeLabel(JsonObject w) {
    String dates =
        w.getString("departureDate", "")
            + (w.getString("returnDate", "").isBlank() ? "" : " to " + w.getString("returnDate"));
    return w.getString("originLabel", w.getString("origin"))
        + " to "
        + w.getString("destinationLabel", w.getString("destination"))
        + " on "
        + dates;
  }

  private String money(double v, String currency) {
    return String.format(Locale.US, "%s %,.2f", currency, v);
  }

  private String escape(String v) {
    return v.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;");
  }

  private void fail(RoutingContext ctx, int status, String message) {
    Utility.buildResponse(ctx, status, Utility.createErrorResponse(message));
  }
}
