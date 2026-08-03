package com.toolhub.services.notifications;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.CompositeFuture;
import io.vertx.core.Future;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

public class NotificationService {
  private static final String COLLECTION = "notifications";
  private static final Set<String> AUDIENCES = Set.of("ADMIN", "USER");
  private static final Set<String> SEVERITIES =
      Set.of("INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL");
  private final MongoDBClient mongo;
  private final Dotenv env;

  public NotificationService(MongoDBClient mongo, Dotenv env) {
    this.mongo = mongo;
    this.env = env;
  }

  public void list(RoutingContext ctx) {
    String viewer = viewerId(ctx);
    int limit = boundedInt(ctx.request().getParam("limit"), 80, 1, 200);
    mongo
        .queryRecords(visibilityQuery(ctx), COLLECTION)
        .onSuccess(
            records -> {
              records.sort(
                  Comparator.comparing((JsonObject row) -> row.getString("createdAt", ""))
                      .reversed());
              JsonArray notifications = new JsonArray();
              long unread = 0;
              for (JsonObject source : records) {
                if (notifications.size() >= limit) break;
                JsonObject item = source.copy();
                item.remove("_id");
                JsonArray readBy = item.getJsonArray("readBy", new JsonArray());
                boolean read = readBy.contains(viewer);
                if (!read) unread++;
                item.remove("readBy");
                item.put("read", read);
                notifications.add(item);
              }
              Utility.buildResponse(
                  ctx,
                  200,
                  Utility.createSuccessResponse(
                      new JsonObject()
                          .put("notifications", notifications)
                          .put("unreadCount", unread)));
            })
        .onFailure(error -> failure(ctx, error));
  }

  public void publish(RoutingContext ctx) {
    createFromRequest(ctx, ctx.get("userId"), false);
  }

  public void ingest(RoutingContext ctx) {
    String expected = env.get("TOOLHUB_ALERT_INGEST_KEY", "").trim();
    String supplied = Objects.toString(ctx.request().getHeader("X-ToolHub-Alert-Key"), "").trim();
    if (expected.isEmpty()
        || supplied.isEmpty()
        || !MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) {
      Utility.buildResponse(ctx, 401, Utility.createErrorResponse("Invalid alert ingest key"));
      return;
    }
    createFromRequest(ctx, "external-ingest", true);
  }

  private void createFromRequest(RoutingContext ctx, String createdBy, boolean external) {
    JsonObject body = ctx.body().asJsonObject();
    try {
      String audience = text(body, "audience", 20).toUpperCase(Locale.ROOT);
      String severity = text(body, "severity", 20).toUpperCase(Locale.ROOT);
      if (severity.isBlank()) severity = "INFO";
      if (!AUDIENCES.contains(audience))
        throw new IllegalArgumentException("audience must be ADMIN or USER");
      if (!SEVERITIES.contains(severity))
        throw new IllegalArgumentException("invalid notification severity");
      String target = nullable(text(body, "targetUserId", 100));
      String email = text(body, "targetEmail", 320).toLowerCase(Locale.ROOT);
      final String resolvedSeverity = severity;
      Future<String> targetFuture =
          !email.isBlank() && target == null ? resolveUser(email) : Future.succeededFuture(target);
      targetFuture
          .onSuccess(
              targetUserId -> {
                if (!email.isBlank() && targetUserId == null) {
                  Utility.buildResponse(
                      ctx, 400, Utility.createErrorResponse("target user email was not found"));
                  return;
                }
                JsonObject record;
                try {
                  record = record(body, audience, resolvedSeverity, targetUserId, createdBy);
                } catch (IllegalArgumentException e) {
                  Utility.buildResponse(ctx, 400, Utility.createErrorResponse(e.getMessage()));
                  return;
                }
                mongo
                    .insertRecord(record, COLLECTION)
                    .onSuccess(
                        ignored ->
                            Utility.buildResponse(ctx, 201, Utility.createSuccessResponse(record)))
                    .onFailure(error -> failure(ctx, error));
              })
          .onFailure(error -> failure(ctx, error));
    } catch (IllegalArgumentException error) {
      Utility.buildResponse(ctx, 400, Utility.createErrorResponse(error.getMessage()));
    }
  }

  public void markRead(RoutingContext ctx) {
    String id = ctx.pathParam("notificationId");
    mongo
        .queryRecords(
            new JsonObject()
                .put(
                    "$and",
                    new JsonArray()
                        .add(visibilityQuery(ctx))
                        .add(new JsonObject().put("notificationId", id))),
            COLLECTION)
        .onSuccess(
            rows -> {
              if (rows.isEmpty()) {
                Utility.buildResponse(
                    ctx, 404, Utility.createErrorResponse("Notification not found"));
                return;
              }
              JsonArray readBy = rows.getFirst().getJsonArray("readBy", new JsonArray());
              if (!readBy.contains(viewerId(ctx))) readBy.add(viewerId(ctx));
              mongo
                  .updateRecord(
                      new JsonObject().put("notificationId", id),
                      new JsonObject().put("$set", new JsonObject().put("readBy", readBy)),
                      COLLECTION)
                  .onSuccess(
                      v ->
                          Utility.buildResponse(
                              ctx,
                              200,
                              Utility.createSuccessResponse(
                                  new JsonObject().put("notificationId", id).put("read", true))))
                  .onFailure(error -> failure(ctx, error));
            })
        .onFailure(error -> failure(ctx, error));
  }

  public void markAllRead(RoutingContext ctx) {
    String viewer = viewerId(ctx);
    mongo
        .queryRecords(visibilityQuery(ctx), COLLECTION)
        .onSuccess(
            rows -> {
              List<Future<?>> updates = new ArrayList<>();
              int changed = 0;
              for (JsonObject row : rows) {
                JsonArray readBy = row.getJsonArray("readBy", new JsonArray());
                if (readBy.contains(viewer)) continue;
                changed++;
                readBy.add(viewer);
                updates.add(
                    mongo.updateRecord(
                        new JsonObject().put("notificationId", row.getString("notificationId")),
                        new JsonObject().put("$set", new JsonObject().put("readBy", readBy)),
                        COLLECTION));
              }
              int count = changed;
              CompositeFuture.all((List) updates)
                  .onSuccess(
                      v ->
                          Utility.buildResponse(
                              ctx,
                              200,
                              Utility.createSuccessResponse(
                                  new JsonObject().put("updated", count))))
                  .onFailure(error -> failure(ctx, error));
            })
        .onFailure(error -> failure(ctx, error));
  }

  public void delete(RoutingContext ctx) {
    String id = ctx.pathParam("notificationId");
    mongo
        .deleteRecord(new JsonObject().put("notificationId", id), COLLECTION)
        .onSuccess(
            v ->
                Utility.buildResponse(
                    ctx,
                    200,
                    Utility.createSuccessResponse(
                        new JsonObject().put("notificationId", id).put("deleted", true))))
        .onFailure(
            error ->
                Utility.buildResponse(
                    ctx, 404, Utility.createErrorResponse("Notification not found")));
  }

  private Future<String> resolveUser(String email) {
    return mongo
        .queryRecords(
            new JsonObject()
                .put(
                    "$or",
                    new JsonArray()
                        .add(new JsonObject().put("email", email))
                        .add(new JsonObject().put("emailLower", email))),
            "users")
        .map(rows -> rows.isEmpty() ? null : rows.getFirst().getString("userId"));
  }

  private JsonObject record(
      JsonObject body, String audience, String severity, String target, String createdBy) {
    String title = text(body, "title", 140), message = text(body, "message", 2000);
    if (title.isBlank() || message.isBlank())
      throw new IllegalArgumentException("title and message are required");
    return new JsonObject()
        .put("notificationId", UUID.randomUUID().toString())
        .put("audience", audience)
        .put("targetUserId", audience.equals("ADMIN") ? null : target)
        .put("title", title)
        .put("message", message)
        .put("severity", severity)
        .put("category", lowerOr(body, "category", "general", 60))
        .put("source", lowerOr(body, "source", "toolhub", 60))
        .put("actionUrl", nullable(text(body, "actionUrl", 500)))
        .put("metadata", body.getJsonObject("metadata", new JsonObject()))
        .put("readBy", new JsonArray())
        .put("createdBy", createdBy)
        .put("createdAt", Instant.now().toString());
  }

  private JsonObject visibilityQuery(RoutingContext ctx) {
    String viewer = viewerId(ctx);
    JsonArray choices =
        new JsonArray()
            .add(new JsonObject().put("audience", "USER").put("targetUserId", viewer))
            .add(new JsonObject().put("audience", "USER").put("targetUserId", null))
            .add(
                new JsonObject()
                    .put("audience", "USER")
                    .put("targetUserId", new JsonObject().put("$exists", false)));
    if ("ADMIN".equalsIgnoreCase(ctx.get("role")))
      choices.add(new JsonObject().put("audience", "ADMIN"));
    return new JsonObject().put("$or", choices);
  }

  private String viewerId(RoutingContext ctx) {
    return Objects.toString(ctx.get("userId"), Objects.toString(ctx.get("userEmail"), ""));
  }

  private String text(JsonObject body, String key, int max) {
    String v = body == null ? "" : Objects.toString(body.getValue(key), "").trim();
    return v.substring(0, Math.min(v.length(), max));
  }

  private String lowerOr(JsonObject body, String key, String fallback, int max) {
    String v = text(body, key, max);
    return (v.isBlank() ? fallback : v).toLowerCase(Locale.ROOT);
  }

  private String nullable(String value) {
    return value == null || value.isBlank() ? null : value;
  }

  private int boundedInt(String raw, int fallback, int min, int max) {
    try {
      return Math.max(min, Math.min(max, Integer.parseInt(raw)));
    } catch (Exception e) {
      return fallback;
    }
  }

  private void failure(RoutingContext ctx, Throwable error) {
    Utility.buildResponse(ctx, 500, Utility.createErrorResponse(error.getMessage()));
  }
}
