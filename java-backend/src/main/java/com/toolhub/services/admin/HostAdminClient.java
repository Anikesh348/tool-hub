package com.toolhub.services.admin;

import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import java.io.ByteArrayOutputStream;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;

public class HostAdminClient {
  private final Vertx vertx;
  private final WebClient web;
  private final Dotenv env;

  public HostAdminClient(Vertx vertx, WebClient web, Dotenv env) {
    this.vertx = vertx;
    this.web = web;
    this.env = env;
  }

  public Future<JsonObject> host(String method, String path, int timeout) {
    return request(
        method,
        path,
        timeout,
        env.get("TOOLHUB_ADMIN_AGENT_SECRET", "").trim(),
        null,
        env.get("TOOLHUB_ADMIN_SOCKET", "/run/toolhub-admin/agent.sock"));
  }

  public Future<JsonObject> pi(String method, String path, int timeout) {
    String url = env.get("TOOLHUB_PI_ADMIN_URL", "").trim();
    return url.isBlank()
        ? host(method, path, timeout)
        : request(
            method,
            path,
            timeout,
            env.get("TOOLHUB_PI_ADMIN_AGENT_SECRET", env.get("TOOLHUB_ADMIN_AGENT_SECRET", ""))
                .trim(),
            url,
            null);
  }

  public Future<JsonObject> codex(String method, String path, int timeout) {
    String url = env.get("TOOLHUB_CODEX_ADMIN_URL", "").trim();
    if (url.isBlank()) return Future.failedFuture("Codex fleet speed-test agent is not configured");
    return request(
        method,
        path,
        timeout,
        env.get("TOOLHUB_CODEX_ADMIN_AGENT_SECRET", env.get("TOOLHUB_ADMIN_AGENT_SECRET", ""))
            .trim(),
        url,
        null);
  }

  private Future<JsonObject> request(
      String method, String path, int timeout, String secret, String base, String socket) {
    if (secret.isBlank()) return Future.failedFuture("Host administration agent is not configured");
    if (base != null)
      return web.requestAbs(
              io.vertx.core.http.HttpMethod.valueOf(method), base.replaceAll("/+$", "") + path)
          .timeout(timeout * 1000L)
          .putHeader("X-ToolHub-Admin-Secret", secret)
          .send()
          .compose(
              res -> {
                JsonObject body = safe(res.bodyAsString());
                return res.statusCode() >= 400
                    ? Future.failedFuture(
                        body.getString("error", "Host administration action failed"))
                    : Future.succeededFuture(body);
              })
          .recover(e -> Future.failedFuture("Host administration agent is unavailable"));
    return vertx
        .executeBlocking(() -> unixRequest(method, path, secret, socket), false)
        .recover(e -> Future.failedFuture("Host administration agent is unavailable"));
  }

  private JsonObject unixRequest(String method, String path, String secret, String socket)
      throws Exception {
    try (SocketChannel channel = SocketChannel.open(StandardProtocolFamily.UNIX)) {
      channel.connect(UnixDomainSocketAddress.of(socket));
      String request =
          method
              + " "
              + path
              + " HTTP/1.1\r\nHost: localhost\r\nX-ToolHub-Admin-Secret: "
              + secret
              + "\r\nConnection: close\r\n\r\n";
      channel.write(ByteBuffer.wrap(request.getBytes(StandardCharsets.UTF_8)));
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      ByteBuffer buf = ByteBuffer.allocate(8192);
      while (channel.read(buf) >= 0) {
        buf.flip();
        byte[] b = new byte[buf.remaining()];
        buf.get(b);
        out.write(b);
        buf.clear();
      }
      String response = out.toString(StandardCharsets.UTF_8);
      int split = response.indexOf("\r\n\r\n");
      String head = split < 0 ? response : response.substring(0, split),
          body = split < 0 ? "{}" : response.substring(split + 4);
      String[] status = head.split("\\s+");
      int code = status.length > 1 ? Integer.parseInt(status[1]) : 500;
      JsonObject json = safe(body);
      if (code >= 400)
        throw new IllegalStateException(
            json.getString("error", "Host administration action failed"));
      return json;
    }
  }

  private JsonObject safe(String value) {
    try {
      return new JsonObject(value == null || value.isBlank() ? "{}" : value);
    } catch (Exception e) {
      return new JsonObject();
    }
  }
}
