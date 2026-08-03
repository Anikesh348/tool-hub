package com.toolhub.services.speedtest;

import com.toolhub.Utils.Utility;
import io.vertx.core.Vertx;
import io.vertx.core.buffer.Buffer;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class SpeedTestService {
  private static final long TTL_MS = 300_000L;
  private static final long DOWNLOAD_LIMIT = 1024L * 1024 * 1024;
  private static final long UPLOAD_LIMIT = 512L * 1024 * 1024;
  private static final int MAX_SAMPLE = 32 * 1024 * 1024;
  private static final byte[] CHUNK = new byte[256 * 1024];

  static {
    new SecureRandom().nextBytes(CHUNK);
  }

  private final Vertx vertx;
  private final Map<String, Session> sessions = new ConcurrentHashMap<>();
  private final Map<String, Long> lastSessionByClient = new ConcurrentHashMap<>();

  public SpeedTestService(Vertx vertx) {
    this.vertx = vertx;
  }

  public void createSession(RoutingContext ctx) {
    long now = System.currentTimeMillis();
    cleanup(now);
    String client = clientId(ctx);
    if (now - lastSessionByClient.getOrDefault(client, 0L) < 10_000L) {
      Utility.buildResponse(
          ctx,
          429,
          Utility.createErrorResponse("Wait a few seconds before starting another speed test"));
      return;
    }
    String id = UUID.randomUUID().toString().replace("-", "");
    sessions.put(id, new Session(client, now + TTL_MS));
    lastSessionByClient.put(client, now);
    Utility.buildResponse(
        ctx,
        200,
        Utility.createSuccessResponse(
            new JsonObject().put("sessionId", id).put("expiresInSeconds", 300)));
  }

  public void ping(RoutingContext ctx) {
    if (requireSession(ctx) == null) return;
    Utility.buildResponse(
        ctx,
        200,
        Utility.createSuccessResponse(
            new JsonObject().put("serverTimeMs", System.currentTimeMillis())));
  }

  public void download(RoutingContext ctx) {
    Session session = requireSession(ctx);
    if (session == null) return;
    int bytes = intParam(ctx, "bytes", 512 * 1024);
    if (bytes < 64 * 1024 || bytes > MAX_SAMPLE) {
      Utility.buildResponse(
          ctx, 422, Utility.createErrorResponse("bytes must be between 65536 and 33554432"));
      return;
    }
    synchronized (session) {
      if (session.downloaded + bytes > DOWNLOAD_LIMIT) {
        Utility.buildResponse(
            ctx, 429, Utility.createErrorResponse("Speed test download limit reached"));
        return;
      }
      session.downloaded += bytes;
    }
    var response =
        ctx.response()
            .setChunked(true)
            .putHeader("Content-Type", "application/octet-stream")
            .putHeader("Cache-Control", "no-store, no-cache, must-revalidate")
            .putHeader("Content-Length", Integer.toString(bytes))
            .putHeader("X-Content-Type-Options", "nosniff");
    int full = bytes / CHUNK.length;
    for (int i = 0; i < full; i++) response.write(Buffer.buffer(CHUNK));
    int tail = bytes % CHUNK.length;
    if (tail > 0) response.write(Buffer.buffer(Arrays.copyOf(CHUNK, tail)));
    response.end();
  }

  public void upload(RoutingContext ctx) {
    Session session = requireSession(ctx);
    if (session == null) return;
    String header = ctx.request().getHeader("Content-Length");
    if (header == null) {
      Utility.buildResponse(ctx, 411, Utility.createErrorResponse("Content-Length is required"));
      return;
    }
    long declared;
    try {
      declared = Long.parseLong(header);
    } catch (NumberFormatException e) {
      declared = 0;
    }
    if (declared <= 0) {
      Utility.buildResponse(ctx, 411, Utility.createErrorResponse("Content-Length is required"));
      return;
    }
    if (declared > MAX_SAMPLE) {
      Utility.buildResponse(ctx, 413, Utility.createErrorResponse("Upload sample is too large"));
      return;
    }
    synchronized (session) {
      if (session.uploaded + declared > UPLOAD_LIMIT) {
        Utility.buildResponse(
            ctx, 429, Utility.createErrorResponse("Speed test upload limit reached"));
        return;
      }
      session.uploaded += declared;
    }
    long received = ctx.body().buffer().length();
    if (received != declared) {
      synchronized (session) {
        session.uploaded = Math.max(0, session.uploaded - declared + received);
      }
    }
    Utility.buildResponse(
        ctx, 200, Utility.createSuccessResponse(new JsonObject().put("receivedBytes", received)));
  }

  private Session requireSession(RoutingContext ctx) {
    cleanup(System.currentTimeMillis());
    String id = ctx.request().getParam("session");
    Session state = id == null ? null : sessions.get(id);
    if (id == null
        || id.length() < 16
        || id.length() > 64
        || state == null
        || !state.client.equals(clientId(ctx))) {
      Utility.buildResponse(
          ctx, 404, Utility.createErrorResponse("Speed test session was not found or has expired"));
      return null;
    }
    return state;
  }

  private void cleanup(long now) {
    sessions.entrySet().removeIf(e -> e.getValue().expiresAt <= now);
  }

  private String clientId(RoutingContext ctx) {
    String forwarded = ctx.request().getHeader("x-forwarded-for");
    if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",", 2)[0].trim();
    return ctx.request().remoteAddress() == null
        ? "anonymous"
        : ctx.request().remoteAddress().host();
  }

  private int intParam(RoutingContext ctx, String name, int fallback) {
    try {
      return Integer.parseInt(ctx.request().getParam(name));
    } catch (Exception ignored) {
      return fallback;
    }
  }

  private static final class Session {
    final String client;
    final long expiresAt;
    long downloaded;
    long uploaded;

    Session(String client, long expiresAt) {
      this.client = client;
      this.expiresAt = expiresAt;
    }
  }
}
