package com.toolhub.middlewares;

import static org.mockito.Mockito.*;

import com.toolhub.services.jwt.JWTProvider;
import io.vertx.core.http.HttpServerResponse;
import io.vertx.ext.web.RoutingContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AuthHandlerTest {
  private AuthHandler authHandler;
  private RoutingContext context;

  @BeforeEach
  void setUp() {
    authHandler = new AuthHandler();
    context = mock(RoutingContext.class);
    when(context.normalizedPath()).thenReturn("/v2/admin/private");
    when(context.response()).thenReturn(mock(HttpServerResponse.class, RETURNS_SELF));
  }

  @Test
  void testHandle_MissingAuthHeader() {
    var request = mock(io.vertx.core.http.HttpServerRequest.class);
    when(context.request()).thenReturn(request);
    when(request.getHeader("Authorization")).thenReturn(null);
    authHandler.handle(context);
    verify(context, never()).next();
  }

  @Test
  void testHandle_InvalidToken() {
    var request = mock(io.vertx.core.http.HttpServerRequest.class);
    when(context.request()).thenReturn(request);
    when(request.getHeader("Authorization")).thenReturn("Bearer invalidtoken");
    authHandler.handle(context);
    verify(context, never()).next();
  }

  @Test
  void testHandle_ValidToken() {
    var request = mock(io.vertx.core.http.HttpServerRequest.class);
    when(context.request()).thenReturn(request);
    String token = JWTProvider.generateAccessToken("user123", "USER", "test@example.com");
    when(request.getHeader("Authorization")).thenReturn("Bearer " + token);
    authHandler.handle(context);
    verify(context).put("userId", "user123");
    verify(context).next();
  }
}
