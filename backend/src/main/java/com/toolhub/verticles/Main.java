package com.toolhub.verticles;

import io.vertx.core.Vertx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class Main {
    private static final Logger log = LoggerFactory.getLogger(Main.class);
    public static void main(String[] args) {
        Vertx vertx = Vertx.vertx();
        vertx.deployVerticle(new ToolHubBaseVerticle())
                .onSuccess(id -> log.info("Verticle deployed with ID: {}", id))
                .onFailure(err -> log.error("failed to deploy verticle {}", err.toString()));
    }
}
