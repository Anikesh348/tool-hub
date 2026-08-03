package com.toolhub.services.redis;

import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.Json;
import io.vertx.redis.client.Command;
import io.vertx.redis.client.Redis;
import io.vertx.redis.client.Request;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Best-effort JSON cache. Redis failures deliberately become misses, as in the Python backend. */
public final class RedisCache implements AutoCloseable {
  private final Redis redis;

  public RedisCache(Vertx vertx) {
    redis =
        Redis.createClient(
            vertx, System.getenv().getOrDefault("REDIS_URL", "redis://redis:6379/0"));
  }

  public Future<Object> get(String key) {
    return redis
        .send(Request.cmd(Command.GET).arg(key))
        .map(response -> response == null ? null : Json.decodeValue(response.toString()))
        .recover(ignored -> Future.succeededFuture(null));
  }

  public Future<Void> set(String key, Object value, int ttlSeconds) {
    return redis
        .send(
            Request.cmd(Command.SETEX)
                .arg(key)
                .arg(Math.max(1, ttlSeconds))
                .arg(Json.encode(value)))
        .map(response -> (Void) null)
        .recover(ignored -> Future.succeededFuture((Void) null));
  }

  public Future<Boolean> add(String key, Object value, int ttlSeconds) {
    return redis
        .send(
            Request.cmd(Command.SET)
                .arg(key)
                .arg(Json.encode(value))
                .arg("EX")
                .arg(Math.max(1, ttlSeconds))
                .arg("NX"))
        .map(response -> response != null)
        .recover(ignored -> Future.succeededFuture(false));
  }

  public Future<Boolean> delete(String key) {
    return redis
        .send(Request.cmd(Command.DEL).arg(key))
        .map(response -> response != null && response.toLong() > 0)
        .recover(ignored -> Future.succeededFuture(false));
  }

  public static String token(Object value) {
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256")
              .digest(String.valueOf(value).getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest).substring(0, 24);
    } catch (Exception impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  @Override
  public void close() {
    redis.close();
  }
}
