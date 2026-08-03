package com.toolhub.middlewares;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.toolhub.Utils.Utility;
import com.toolhub.services.jwt.JWTProvider;
import io.vertx.core.Handler;
import io.vertx.core.http.Cookie;
import io.vertx.ext.web.RoutingContext;
import java.util.Set;

public class AuthHandler implements Handler<RoutingContext> {
  private final boolean honorPublicPaths;
  private final boolean allowMissing;

  public AuthHandler() {
    this(true, false);
  }

  private AuthHandler(boolean honorPublicPaths, boolean allowMissing) {
    this.honorPublicPaths = honorPublicPaths;
    this.allowMissing = allowMissing;
  }

  public static AuthHandler required() {
    return new AuthHandler(false, false);
  }

  public static AuthHandler optional() {
    return new AuthHandler(false, true);
  }

  private static final Set<String> PUBLIC_PATHS =
      Set.of(
          "/v2/login",
          "/v2/register",
          "/v2/token/refresh",
          "/v2/moviehub/reconcile-downloads",
          "/v2/yt/download/cronStart",
          "/v2/yt/download/check",
          "/v2/flights/provider-status",
          "/v2/flights/places",
          "/v2/search",
          "/v2/speedtest/session",
          "/v2/speedtest/ping",
          "/v2/speedtest/download",
          "/v2/speedtest/upload",
          "/v2/notifications/events");

  @Override
  public void handle(RoutingContext context) {
    String path = context.normalizedPath();
    if (honorPublicPaths
        && (PUBLIC_PATHS.contains(path)
            || path.equals("/v2/blogs")
            || path.startsWith("/v2/blogs/")
            || path.startsWith("/v2/blog-assets/"))) {
      context.next();
      return;
    }
    String authHeader = context.request().getHeader("Authorization");
    Cookie accessCookie =
        context
            .request()
            .getCookie(System.getenv().getOrDefault("AUTH_ACCESS_COOKIE", "toolhub_access_token"));
    String token =
        authHeader != null && authHeader.startsWith("Bearer ")
            ? authHeader.substring("Bearer ".length()).trim()
            : accessCookie == null ? null : accessCookie.getValue();
    if (token == null || token.isBlank()) {
      if (allowMissing) {
        context.next();
        return;
      }
      Utility.buildResponse(context, 401, Utility.createErrorResponse("missing auth token"));
    } else {
      try {
        DecodedJWT decodedJWT = JWTProvider.verifyAccessToken(token);
        String userId = decodedJWT.getSubject();
        if (userId == null || userId.isBlank()) userId = decodedJWT.getClaim("userId").asString();
        String role = decodedJWT.getClaim("role").asString();
        String email = decodedJWT.getClaim("email").asString();
        context.put("userId", userId);
        context.put("role", role);
        context.put("userEmail", email == null ? "" : email);
        context.next();
      } catch (Exception e) {
        Utility.buildResponse(
            context, 401, Utility.createErrorResponse("invalid access token in headers"));
      }
    }
  }
}
