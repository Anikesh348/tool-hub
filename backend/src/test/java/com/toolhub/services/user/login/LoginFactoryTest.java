package com.toolhub.services.user.login;

import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LoginFactoryTest {
    @Test
    void testCreateLogin_Google() {
        RoutingContext context = mock(RoutingContext.class);
        MongoDBClient mongoDBClient = mock(MongoDBClient.class);
        JsonObject body = new JsonObject().put("type", "google");
        when(context.body()).thenReturn(mock(io.vertx.ext.web.RequestBody.class));
        when(context.body().asJsonObject()).thenReturn(body);
        Login login = LoginFactory.createLogin(context, mongoDBClient);
        assertTrue(login instanceof GoogleLogin);
    }

    @Test
    void testCreateLogin_Base() {
        RoutingContext context = mock(RoutingContext.class);
        MongoDBClient mongoDBClient = mock(MongoDBClient.class);
        JsonObject body = new JsonObject().put("type", "base");
        when(context.body()).thenReturn(mock(io.vertx.ext.web.RequestBody.class));
        when(context.body().asJsonObject()).thenReturn(body);
        Login login = LoginFactory.createLogin(context, mongoDBClient);
        assertTrue(login.getClass().getSimpleName().equals("BaseLogin"));
    }

    @Test
    void testCreateLogin_UnknownType() {
        RoutingContext context = mock(RoutingContext.class);
        MongoDBClient mongoDBClient = mock(MongoDBClient.class);
        JsonObject body = new JsonObject().put("type", "unknown");
        when(context.body()).thenReturn(mock(io.vertx.ext.web.RequestBody.class));
        when(context.body().asJsonObject()).thenReturn(body);
        assertThrows(IllegalArgumentException.class, () -> LoginFactory.createLogin(context, mongoDBClient));
    }
}

