package com.toolhub.services.products;

import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.Vertx;
import io.vertx.ext.web.RoutingContext;
import io.vertx.junit5.VertxExtension;
import io.vertx.junit5.VertxTestContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.mockito.Mockito.*;

@ExtendWith(VertxExtension.class)
class GetProductsTest {
    private MongoDBClient mongoDBClient;
    private RoutingContext context;

    @BeforeEach
    void setUp() {
        mongoDBClient = mock(MongoDBClient.class);
        context = mock(RoutingContext.class);
        when(context.get("userId")).thenReturn("uid");
    }

    @Test
    void testGetProductsConstructor(Vertx vertx, VertxTestContext testContext) {
        when(context.get("userId")).thenReturn("uid");
        when(mongoDBClient.queryRecords(any(), any()))
                .thenReturn(io.vertx.core.Future.succeededFuture(new java.util.ArrayList<>()));
        new GetProducts(mongoDBClient, context);
        testContext.completeNow();
    }
}
