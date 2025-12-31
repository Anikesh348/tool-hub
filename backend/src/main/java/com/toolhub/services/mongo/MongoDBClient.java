package com.toolhub.services.mongo;

import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.mongo.MongoClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

public class MongoDBClient {
    private static final Logger log = LoggerFactory.getLogger(MongoDBClient.class);
    private final MongoClient mongoClient;

    public MongoDBClient(Vertx vertx, JsonObject config) {
        this.mongoClient = MongoClient.createShared(vertx, config);
    }

    public MongoClient getMongoClient() {
        return this.mongoClient;
    }

    public Future<Void> pingConnection() {
        Promise<Void> promise = Promise.promise();
        mongoClient.runCommand("ping", new JsonObject().put("ping", 1)).onSuccess(res -> {
            log.info("Successfully initialised mongo client {}", res);
            promise.complete();
        }).onFailure(fail -> {
            log.error("Error in creating mongo client: {}", fail.getMessage());
            handleMongoFailure(fail);
            promise.fail(fail.getMessage());
        });

        return promise.future();
    }

    public Future<Void> insertRecord(JsonObject record, String collection) {
        Promise<Void> promise = Promise.promise();
        mongoClient.insert(collection, record).onComplete(res -> {
            if (res.succeeded()) {
                String id = res.result();
                log.info("Inserted into collection:{}, with id: {}", collection, id);
                promise.complete();
            } else {
                Throwable fail = res.cause();
                log.error("error in inserting to the db: {}", fail.getMessage());
                handleMongoFailure(fail);
                promise.fail(fail.getMessage());
            }
        });
        return promise.future();
    }

    public Future<List<JsonObject>> queryRecords(JsonObject query, String collection) {
        Promise<List<JsonObject>> promise = Promise.promise();
        mongoClient.find(collection, query).onComplete(res -> {
            if (res.succeeded()) {
                log.info("queried from db");
                promise.complete(res.result());
            } else {
                Throwable fail = res.cause();
                log.error("error in querying from the db: {}", fail.getMessage());
                handleMongoFailure(fail);
                promise.fail(fail.getMessage());
            }
        });
        return promise.future();
    }

    public Future<Void> deleteRecord(JsonObject query, String collection) {
        Promise<Void> promise = Promise.promise();
        mongoClient.findOneAndDelete(collection, query).onSuccess(res -> {
            if (res == null) {
                log.warn("No document found to delete for query: {} ", query.encode());
                promise.fail("No matching document found");
            } else {
                log.info("Document deleted from {} ", collection);
                promise.complete();
            }
        }).onFailure(fail -> {
            log.error("Failed to delete document from {} ", collection, fail);
            handleMongoFailure(fail);
            promise.fail(fail);
        });
        return promise.future();
    }

    public void deleteRecordAsync(JsonObject query, String collection) {
        mongoClient.findOneAndDelete(collection, query)
                .onFailure(this::handleMongoFailure)
                .onSuccess(res -> {
            log.info("deleted the product");
        });
    }

    public Future<Void> updateRecord(JsonObject query, JsonObject updatedRecord, String collection) {
        Promise<Void> promise = Promise.promise();
        mongoClient.findOneAndUpdate(collection, query, updatedRecord).onSuccess(res -> {
            if (res == null) {
                log.warn("No document found to update for query: {} ", query.encode());
                promise.fail("No matching document found");
            } else {
                log.info("Document updated in {} ", collection);
                promise.complete();
            }
        }).onFailure(fail -> {
            log.error("Failed to update document in {} ", collection, fail);
            handleMongoFailure(fail);
            promise.fail(fail);
        });
        return promise.future();
    }

    public void updateRecordAsync(JsonObject query, JsonObject updatedRecord, String collection) {
        JsonObject update = new JsonObject().put("$set", updatedRecord);
        mongoClient.findOneAndUpdate(collection, query, update).onFailure(this::handleMongoFailure).onComplete(res -> {});
    }

    // Timeout failure handler
    private void handleMongoFailure(Throwable fail) {
        Throwable rootCause = unwrapCause(fail);
        if (rootCause instanceof com.mongodb.MongoSocketReadTimeoutException
                || rootCause instanceof com.mongodb.MongoSocketReadException
                || fail.getMessage().toLowerCase().contains("timeout")) {
            log.error("Mongo timeout detected. Exiting to trigger Docker restart.");
            System.exit(1);  // Causes container restart if `restart: always` is set
        }
    }

    // Helper to unwrap nested exceptions
    private Throwable unwrapCause(Throwable throwable) {
        Throwable cause = throwable;
        while (cause.getCause() != null && cause != cause.getCause()) {
            cause = cause.getCause();
        }
        return cause;
    }
}
