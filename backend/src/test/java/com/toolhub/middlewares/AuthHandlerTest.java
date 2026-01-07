package com.toolhub.middlewares;

import com.auth0.jwt.interfaces.DecodedJWT;
import io.vertx.ext.web.RoutingContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.*;

class AuthHandlerTest {
    private AuthHandler authHandler;
    private RoutingContext context;

    @BeforeEach
    void setUp() {
        authHandler = new AuthHandler();
        context = mock(RoutingContext.class);
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
        when(request.getHeader("Authorization")).thenReturn("Bearer validtoken");
        var decodedJWT = mock(DecodedJWT.class);
        var claim = mock(com.auth0.jwt.interfaces.Claim.class);
        when(decodedJWT.getClaim("userId")).thenReturn(claim);
        when(claim.asString()).thenReturn("user123");
        authHandler.handle(context);
    }
}
