package com.toolhub.services.ai;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import java.time.Instant;
import java.util.*;

public class AiChatService {
  private static final String CHATS = "ai_chats", MESSAGES = "ai_messages";
  private final MongoDBClient mongo;
  private final AiGatewayClient gateway;
  private final Vertx vertx;

  public AiChatService(MongoDBClient mongo, WebClient client, Vertx vertx, Dotenv env) {
    this.mongo = mongo;
    this.gateway = new AiGatewayClient(client, env);
    this.vertx = vertx;
    mongo
        .getMongoClient()
        .updateCollection(
            CHATS,
            new JsonObject().put("runStatus", "running"),
            new JsonObject().put("$set", new JsonObject().put("runStatus", "idle")));
  }

  public void health(RoutingContext ctx) {
    gateway
        .get("/readyz", 5)
        .onSuccess(body -> ok(ctx, Utility.createSuccessResponse(body)))
        .onFailure(e -> gatewayError(ctx, e));
  }

  public void createChat(RoutingContext ctx) {
    JsonObject body = ctx.body().asJsonObject();
    String title =
        Objects.toString(body == null ? null : body.getValue("title"), "New chat").trim();
    String provider =
        Objects.toString(body == null ? null : body.getValue("provider"), "codex")
            .trim()
            .toLowerCase(Locale.ROOT);
    if (title.isEmpty() || title.length() > 120) {
      fail(ctx, 400, "Chat title must contain 1 to 120 characters");
      return;
    }
    if (!provider.equals("codex")) {
      fail(ctx, 400, "Unsupported AI provider");
      return;
    }
    String now = now();
    JsonObject chat =
        new JsonObject()
            .put("id", UUID.randomUUID().toString())
            .put("ownerId", ctx.get("userId"))
            .put("title", title)
            .put("provider", provider)
            .put("status", "active")
            .put("runStatus", "idle")
            .put("providerConversationId", null)
            .put("createdAt", now)
            .put("updatedAt", now);
    mongo
        .insertRecord(chat, CHATS)
        .onSuccess(v -> ok(ctx, Utility.createSuccessResponse(publicChat(chat, false))))
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void listChats(RoutingContext ctx) {
    mongo
        .queryRecords(
            new JsonObject().put("ownerId", ctx.get("userId")).put("status", "active"), CHATS)
        .onSuccess(
            rows -> {
              rows.sort(
                  Comparator.comparing((JsonObject r) -> r.getString("updatedAt", "")).reversed());
              JsonArray items = new JsonArray();
              rows.stream().limit(50).forEach(r -> items.add(publicChat(r, false)));
              ok(ctx, Utility.createSuccessResponse(new JsonObject().put("items", items)));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void getChat(RoutingContext ctx) {
    owned(ctx)
        .onSuccess(
            chat -> {
              if (chat == null) {
                fail(ctx, 404, "AI chat not found");
                return;
              }
              mongo
                  .queryRecords(new JsonObject().put("chatId", chat.getString("id")), MESSAGES)
                  .onSuccess(
                      messages -> {
                        messages.sort(
                            Comparator.comparing((JsonObject r) -> r.getString("createdAt", ""))
                                .thenComparing(r -> r.getString("id", "")));
                        JsonArray clean = new JsonArray();
                        for (JsonObject m : messages)
                          clean.add(
                              new JsonObject()
                                  .put("id", m.getString("id"))
                                  .put("role", m.getString("role"))
                                  .put("content", m.getString("content"))
                                  .put("status", m.getString("status", "completed"))
                                  .put("createdAt", m.getString("createdAt")));
                        JsonObject out = publicChat(chat, false).put("messages", clean);
                        ok(ctx, Utility.createSuccessResponse(new JsonObject().put("chat", out)));
                      })
                  .onFailure(e -> fail(ctx, 500, e.getMessage()));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void sendMessage(RoutingContext ctx) {
    JsonObject body = ctx.body().asJsonObject();
    String content = Objects.toString(body == null ? null : body.getValue("content"), "").trim();
    if (content.isEmpty() || content.length() > 16_000) {
      fail(ctx, 400, "Message must contain 1 to 16000 characters");
      return;
    }
    final JsonArray context;
    try {
      context = cleanContext(body == null ? null : body.getValue("context"));
    } catch (IllegalArgumentException e) {
      fail(ctx, 400, e.getMessage());
      return;
    }
    owned(ctx)
        .onSuccess(
            chat -> {
              if (chat == null) {
                fail(ctx, 404, "AI chat not found");
                return;
              }
              if (!"idle".equals(chat.getString("runStatus", "idle"))) {
                fail(ctx, 409, "This chat is already processing a message");
                return;
              }
              String now = now();
              JsonObject userMessage =
                  new JsonObject()
                      .put("id", UUID.randomUUID().toString())
                      .put("chatId", chat.getString("id"))
                      .put("role", "user")
                      .put("content", content)
                      .put("context", context)
                      .put("status", "pending")
                      .put("createdAt", now);
              mongo
                  .updateRecord(
                      new JsonObject()
                          .put("id", chat.getString("id"))
                          .put("ownerId", ctx.get("userId")),
                      new JsonObject()
                          .put(
                              "$set",
                              new JsonObject().put("runStatus", "running").put("updatedAt", now)),
                      CHATS)
                  .compose(v -> mongo.insertRecord(userMessage, MESSAGES))
                  .onSuccess(
                      v -> {
                        ctx.response().setStatusCode(202);
                        ok(
                            ctx,
                            Utility.createSuccessResponse(
                                new JsonObject()
                                    .put("accepted", true)
                                    .put("userMessage", userMessage)));
                        complete(
                            chat,
                            userMessage,
                            content,
                            context,
                            Objects.toString(ctx.get("userId")));
                      })
                  .onFailure(e -> fail(ctx, 500, e.getMessage()));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  private void complete(
      JsonObject chat, JsonObject user, String content, JsonArray context, String owner) {
    JsonObject payload =
        new JsonObject()
            .put("input", content)
            .put(
                "conversation",
                new JsonObject()
                    .put("providerConversationId", chat.getValue("providerConversationId")))
            .put("context", context)
            .put("capabilityProfile", "read-only")
            .put(
                "metadata",
                new JsonObject().put("application", "toolhub").put("chatId", chat.getString("id")));
    gateway
        .post("/v1/responses", payload, 330)
        .compose(
            response -> {
              String answer = response.getString("outputText", "").trim();
              String conversationId =
                  response
                      .getJsonObject("conversation", new JsonObject())
                      .getString("providerConversationId", "")
                      .trim();
              if (answer.isBlank() || conversationId.isBlank())
                return Future.failedFuture("AI gateway returned an incomplete response");
              String completed = now();
              JsonObject assistant =
                  new JsonObject()
                      .put("id", UUID.randomUUID().toString())
                      .put("chatId", chat.getString("id"))
                      .put("role", "assistant")
                      .put("content", answer)
                      .put("status", "completed")
                      .put("providerRequestId", response.getString("id", ""))
                      .put("createdAt", completed);
              JsonObject updates =
                  new JsonObject()
                      .put("providerConversationId", conversationId)
                      .put("runStatus", "idle")
                      .put("updatedAt", completed);
              if ("New chat".equals(chat.getString("title")))
                updates.put(
                    "title",
                    content.substring(0, Math.min(60, content.length()))
                        + (content.length() > 60 ? "..." : ""));
              return mongo
                  .insertRecord(assistant, MESSAGES)
                  .compose(
                      v ->
                          mongo.updateRecord(
                              new JsonObject().put("id", user.getString("id")),
                              new JsonObject()
                                  .put("$set", new JsonObject().put("status", "completed")),
                              MESSAGES))
                  .compose(
                      v ->
                          mongo.updateRecord(
                              new JsonObject()
                                  .put("id", chat.getString("id"))
                                  .put("ownerId", owner),
                              new JsonObject().put("$set", updates),
                              CHATS));
            })
        .onFailure(
            error -> {
              mongo.updateRecord(
                  new JsonObject().put("id", user.getString("id")),
                  new JsonObject().put("$set", new JsonObject().put("status", "failed")),
                  MESSAGES);
              mongo.updateRecord(
                  new JsonObject().put("id", chat.getString("id")).put("ownerId", owner),
                  new JsonObject()
                      .put(
                          "$set",
                          new JsonObject().put("runStatus", "idle").put("updatedAt", now())),
                  CHATS);
            });
  }

  private Future<JsonObject> owned(RoutingContext ctx) {
    return mongo
        .queryRecords(
            new JsonObject()
                .put("id", ctx.pathParam("chatId"))
                .put("ownerId", ctx.get("userId"))
                .put("status", "active"),
            CHATS)
        .map(rows -> rows.isEmpty() ? null : rows.getFirst());
  }

  private JsonArray cleanContext(Object raw) {
    if (raw == null) return new JsonArray();
    if (!(raw instanceof JsonArray array))
      throw new IllegalArgumentException("Context must be an array");
    JsonArray out = new JsonArray();
    int size = 0;
    for (Object value : array) {
      if (!(value instanceof JsonObject item) || !"text".equals(item.getString("type")))
        throw new IllegalArgumentException("Unsupported context item");
      String text = item.getString("text", "").trim();
      size += text.length();
      if (size > 8000) throw new IllegalArgumentException("Context is too large");
      if (!text.isEmpty())
        out.add(
            new JsonObject()
                .put("type", "text")
                .put("label", clip(item.getString("label", "Context"), 120))
                .put("text", text));
    }
    return out;
  }

  private JsonObject publicChat(JsonObject d, boolean ignored) {
    return new JsonObject()
        .put("id", d.getString("id"))
        .put("title", d.getString("title"))
        .put("provider", d.getString("provider", "codex"))
        .put("status", d.getString("status", "active"))
        .put("runStatus", d.getString("runStatus", "idle"))
        .put(
            "providerConversationIdPresent",
            d.getValue("providerConversationId") != null
                && !d.getString("providerConversationId", "").isBlank())
        .put("createdAt", d.getString("createdAt"))
        .put("updatedAt", d.getString("updatedAt"));
  }

  private void gatewayError(RoutingContext ctx, Throwable error) {
    if (error instanceof AiGatewayClient.GatewayException e) {
      Utility.buildResponse(
          ctx,
          e.status,
          new JsonObject()
              .put("error", new JsonObject().put("code", e.code).put("message", e.getMessage())));
    } else fail(ctx, 503, error.getMessage());
  }

  private String clip(String s, int max) {
    s = Objects.toString(s, "").trim();
    return s.substring(0, Math.min(max, s.length()));
  }

  private String now() {
    return Instant.now().toString();
  }

  private void ok(RoutingContext ctx, Object body) {
    if (!ctx.response().ended()) {
      ctx.response()
          .putHeader("Content-Type", "application/json")
          .end(io.vertx.core.json.Json.encode(body));
    }
  }

  private void fail(RoutingContext ctx, int status, String message) {
    Utility.buildResponse(ctx, status, Utility.createErrorResponse(message));
  }
}
