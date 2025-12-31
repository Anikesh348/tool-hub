package com.toolhub.services.mongo;

import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MongoDBClientTest {
    private Vertx vertx;
    private JsonObject config;

    @BeforeEach
    void setUp() {
        vertx = Vertx.vertx(); // Use real Vertx instance
        config = new JsonObject().put("connection_string", "mongodb://localhost:27017/test");
    }

    @AfterEach
    void tearDown() {
        vertx.close();
    }

    @Test
    void testConstructorAndGetMongoClient() {
        MongoDBClient client = new MongoDBClient(vertx, config);
        assertNotNull(client.getMongoClient());
    }
}
