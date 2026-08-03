package com.toolhub.services.ai;

import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public class AiGatewayClient {
  private final WebClient client;
  private final String baseUrl;
  private final String clientId;
  private final Path secretFile;

  public AiGatewayClient(WebClient client, Dotenv env) {
    this.client = client;
    this.baseUrl = env.get("AI_CODEX_GATEWAY_URL", "").trim().replaceAll("/+$", "");
    this.clientId = env.get("AI_GATEWAY_CLIENT_ID", "").trim();
    this.secretFile =
        Path.of(env.get("AI_GATEWAY_SECRET_FILE", "/run/secrets/ai_gateway_client_secret"));
  }

  public Future<JsonObject> get(String path, int timeoutSeconds) {
    return request("GET", path, null, timeoutSeconds);
  }

  public Future<JsonObject> post(String path, JsonObject payload, int timeoutSeconds) {
    return request("POST", path, payload, timeoutSeconds);
  }

  private Future<JsonObject> request(
      String method, String path, JsonObject payload, int timeoutSeconds) {
    if (baseUrl.isBlank())
      return Future.failedFuture(
          new GatewayException("AI gateway is not configured", 503, "gateway_not_configured"));
    final String secret;
    try {
      secret = Files.readString(secretFile, StandardCharsets.UTF_8).trim();
    } catch (Exception e) {
      return Future.failedFuture(
          new GatewayException(
              "AI gateway authentication is not configured", 503, "gateway_not_configured"));
    }
    if (secret.length() < 32 || clientId.isBlank())
      return Future.failedFuture(
          new GatewayException(
              "AI gateway authentication is not configured", 503, "gateway_not_configured"));
    String body = payload == null ? "" : payload.encode();
    String timestamp = Long.toString(Instant.now().getEpochSecond()),
        nonce = UUID.randomUUID().toString().replace("-", "");
    String signature;
    try {
      signature = signature(secret, method, path, clientId, timestamp, nonce, body);
    } catch (Exception e) {
      return Future.failedFuture(e);
    }
    var request =
        client
            .requestAbs(io.vertx.core.http.HttpMethod.valueOf(method), baseUrl + path)
            .timeout(timeoutSeconds * 1000L)
            .putHeader("Accept", "application/json")
            .putHeader("X-AI-Client-Id", clientId)
            .putHeader("X-AI-Timestamp", timestamp)
            .putHeader("X-AI-Nonce", nonce)
            .putHeader("X-AI-Signature", signature)
            .putHeader("X-Request-Id", UUID.randomUUID().toString());
    Future<io.vertx.ext.web.client.HttpResponse<io.vertx.core.buffer.Buffer>> sent =
        payload == null
            ? request.send()
            : request
                .putHeader("Content-Type", "application/json")
                .sendBuffer(io.vertx.core.buffer.Buffer.buffer(body));
    return sent.compose(
            response -> {
              JsonObject result;
              try {
                result = response.bodyAsJsonObject();
              } catch (Exception e) {
                return Future.failedFuture(
                    new GatewayException(
                        "AI gateway returned an invalid response", 503, "gateway_unavailable"));
              }
              if (response.statusCode() >= 400) {
                JsonObject error = result == null ? null : result.getJsonObject("error");
                int status =
                    switch (response.statusCode()) {
                      case 400, 404, 409, 413, 429, 503 -> response.statusCode();
                      default -> 503;
                    };
                return Future.failedFuture(
                    new GatewayException(
                        error == null
                            ? "AI gateway request failed"
                            : error.getString("message", "AI gateway request failed"),
                        status,
                        error == null
                            ? "gateway_error"
                            : error.getString("code", "gateway_error")));
              }
              return Future.succeededFuture(result == null ? new JsonObject() : result);
            })
        .recover(
            error ->
                error instanceof GatewayException
                    ? Future.failedFuture(error)
                    : Future.failedFuture(
                        new GatewayException(
                            "AI gateway is unavailable", 503, "gateway_unavailable")));
  }

  static String signature(
      String secret,
      String method,
      String path,
      String id,
      String timestamp,
      String nonce,
      String body)
      throws Exception {
    String bodyHash =
        HexFormat.of()
            .formatHex(
                MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8)));
    String canonical =
        String.join("\n", method.toUpperCase(), path, id, timestamp, nonce, bodyHash);
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return HexFormat.of().formatHex(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
  }

  public static class GatewayException extends RuntimeException {
    public final int status;
    public final String code;

    public GatewayException(String message, int status, String code) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
}
