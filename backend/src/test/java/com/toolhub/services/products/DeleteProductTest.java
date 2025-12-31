package com.toolhub.services.products;

import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.junit5.VertxExtension;
import io.vertx.junit5.VertxTestContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.mockito.Mockito.*;

@ExtendWith(VertxExtension.class)
class DeleteProductTest {
    private MongoDBClient mongoDBClient;
    private RoutingContext context;

    @BeforeEach
    void setUp() {
        mongoDBClient = mock(MongoDBClient.class);
        context = mock(RoutingContext.class);
    }

    @Test
    void testDeleteProductConstructor(Vertx vertx, VertxTestContext testContext) {
        var requestBody = mock(io.vertx.ext.web.RequestBody.class);
        when(context.body()).thenReturn(requestBody);
        when(requestBody.asJsonObject()).thenReturn(new JsonObject().put("productId", "pid").put("targetPrice", "100"));
        when(context.get("userId")).thenReturn("uid");
        when(mongoDBClient.updateRecord(any(), any(), any())).thenReturn(io.vertx.core.Future.succeededFuture());
        when(mongoDBClient.deleteRecord(any(), any())).thenReturn(io.vertx.core.Future.succeededFuture());
        new DeleteProduct(mongoDBClient, context);
        testContext.completeNow();
    }
}
