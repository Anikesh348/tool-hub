package com.toolhub.services.auth;

import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.http.Cookie;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;

/** Client for the shared ToolHub authentication service used by the Python backend. */
public final class ToolHubAuthClient {
  private final WebClient web;
  private final String baseUrl;
  private final String secret;
  private final String application;
  private final String accessCookie;
  private final String refreshCookie;
  private final boolean cookieSecure;

  public ToolHubAuthClient(WebClient web, Dotenv env) {
    this.web = web;
    this.baseUrl =
        first(env.get("TOOLHUB_AUTH_URL"), env.get("GOOGLE_AUTH_URL")).replaceAll("/+$", "");
    this.secret =
        first(env.get("TOOLHUB_AUTH_INTERNAL_SECRET"), env.get("GOOGLE_AUTH_INTERNAL_SECRET"));
    this.application = env.get("TOOLHUB_AUTH_APPLICATION", "toolhub").trim();
    this.accessCookie = env.get("AUTH_ACCESS_COOKIE", "toolhub_access_token").trim();
    this.refreshCookie = env.get("AUTH_REFRESH_COOKIE", "toolhub_refresh_token").trim();
    this.cookieSecure = bool(env.get("AUTH_COOKIE_SECURE", "false"));
  }

  public Future<JsonObject> verifyIdentity(String provider, String credential) {
    return request(
        "/v1/providers/" + provider + "/verify",
        new JsonObject().put("credential", credential),
        "Invalid " + provider + " credential");
  }

  public Future<JsonObject> issueSession(JsonObject user) {
    return request(
        "/v1/sessions",
        new JsonObject()
            .put("subject", user.getString("userId"))
            .put("role", user.getString("role", "USER"))
            .put("email", user.getString("email", ""))
            .put("application", application),
        "Unable to create session");
  }

  public Future<JsonObject> refreshSession(String token) {
    return request(
        "/v1/sessions/refresh",
        new JsonObject().put("refreshToken", token),
        "Invalid refresh session");
  }

  public Future<Void> revokeSession(String token) {
    if (token == null || token.isBlank()) return Future.succeededFuture();
    return request(
            "/v1/sessions/revoke",
            new JsonObject().put("refreshToken", token),
            "Unable to revoke session")
        .map(ignored -> (Void) null)
        .recover(ignored -> Future.succeededFuture((Void) null));
  }

  public void setSessionCookies(RoutingContext context, JsonObject tokens) {
    boolean secure = secure(context);
    context
        .response()
        .addCookie(
            Cookie.cookie(accessCookie, tokens.getString("accessToken"))
                .setMaxAge(tokens.getLong("accessExpiresIn", 900L))
                .setHttpOnly(true)
                .setSecure(secure)
                .setSameSite(io.vertx.core.http.CookieSameSite.LAX)
                .setPath("/"));
    context
        .response()
        .addCookie(
            Cookie.cookie(refreshCookie, tokens.getString("refreshToken"))
                .setMaxAge(tokens.getLong("refreshExpiresIn", 259200L))
                .setHttpOnly(true)
                .setSecure(secure)
                .setSameSite(io.vertx.core.http.CookieSameSite.LAX)
                .setPath("/api/"));
  }

  public void clearSessionCookies(RoutingContext context) {
    boolean secure = secure(context);
    context
        .response()
        .addCookie(
            Cookie.cookie(accessCookie, "")
                .setMaxAge(0)
                .setHttpOnly(true)
                .setSecure(secure)
                .setSameSite(io.vertx.core.http.CookieSameSite.LAX)
                .setPath("/"));
    context
        .response()
        .addCookie(
            Cookie.cookie(refreshCookie, "")
                .setMaxAge(0)
                .setHttpOnly(true)
                .setSecure(secure)
                .setSameSite(io.vertx.core.http.CookieSameSite.LAX)
                .setPath("/api/"));
  }

  public String refreshCookie(RoutingContext context) {
    Cookie cookie = context.request().getCookie(refreshCookie);
    return cookie == null ? "" : cookie.getValue().trim();
  }

  private Future<JsonObject> request(String path, JsonObject payload, String fallback) {
    if (baseUrl.isBlank() || secret.isBlank())
      return Future.failedFuture("ToolHub Auth is not configured");
    return web.postAbs(baseUrl + path)
        .timeout(15_000)
        .putHeader("X-Internal-Auth", secret)
        .sendJsonObject(payload)
        .compose(
            response -> {
              JsonObject body;
              try {
                body = response.bodyAsJsonObject();
              } catch (Exception ignored) {
                body = new JsonObject();
              }
              if (response.statusCode() >= 400)
                return Future.failedFuture(body.getString("detail", fallback));
              return Future.succeededFuture(body);
            })
        .recover(
            error ->
                Future.failedFuture(
                    error.getMessage() == null
                        ? "Authentication service is unavailable"
                        : error.getMessage()));
  }

  private boolean secure(RoutingContext context) {
    String forwarded = context.request().getHeader("x-forwarded-proto");
    return cookieSecure
        || forwarded != null && "https".equalsIgnoreCase(forwarded.split(",", 2)[0].trim());
  }

  private static String first(String left, String right) {
    if (left != null && !left.trim().isEmpty()) return left.trim();
    return right == null ? "" : right.trim();
  }

  private static boolean bool(String value) {
    return value != null
        && switch (value.trim().toLowerCase()) {
          case "1", "true", "yes", "on" -> true;
          default -> false;
        };
  }
}
