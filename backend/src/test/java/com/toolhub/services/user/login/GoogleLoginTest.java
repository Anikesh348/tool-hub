package com.toolhub.services.user.login;

import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.ext.web.RoutingContext;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GoogleLoginTest {
    @Test
    void testGoogleLoginConstructor() {
        MongoDBClient mongoDBClient = mock(MongoDBClient.class);
        RoutingContext context = mock(RoutingContext.class);
        GoogleLogin googleLogin = new GoogleLogin(mongoDBClient, context);
        assertNotNull(googleLogin);
    }
}

