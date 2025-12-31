package com.toolhub.verticles;

import io.vertx.core.Vertx;
import io.vertx.junit5.VertxExtension;
import io.vertx.junit5.VertxTestContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(VertxExtension.class)
public class MainTest {
    @Test
    void testMainVerticleDeployment(Vertx vertx, VertxTestContext testContext) {
        // Simulate the logic in Main.main by deploying PriceDropBaseVerticle
        vertx.deployVerticle(new ToolHubBaseVerticle())
                .onSuccess(id -> testContext.completeNow())
                .onFailure(testContext::failNow);
    }
}
