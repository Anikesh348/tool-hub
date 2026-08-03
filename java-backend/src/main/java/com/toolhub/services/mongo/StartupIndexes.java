package com.toolhub.services.mongo;

import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.mongo.IndexOptions;
import java.util.ArrayList;
import java.util.List;

/** Mongo index declarations from the Python lifespan initializers. */
public final class StartupIndexes {
  private StartupIndexes() {}

  public static Future<Void> ensure(MongoDBClient database) {
    var mongo = database.getMongoClient();
    List<Future<?>> work = new ArrayList<>();
    add(work, mongo, "ai_chats", new JsonObject().put("id", 1), true);
    add(work, mongo, "ai_chats", new JsonObject().put("ownerId", 1).put("updatedAt", -1), false);
    add(work, mongo, "ai_messages", new JsonObject().put("id", 1), true);
    add(
        work,
        mongo,
        "ai_messages",
        new JsonObject().put("chatId", 1).put("createdAt", 1).put("id", 1),
        false);

    add(work, mongo, "courses", new JsonObject().put("id", 1), true);
    add(work, mongo, "course_modules", new JsonObject().put("id", 1), true);
    add(
        work,
        mongo,
        "course_modules",
        new JsonObject().put("courseId", 1).put("position", 1),
        true);
    add(work, mongo, "course_questions", new JsonObject().put("id", 1), true);
    add(
        work,
        mongo,
        "course_questions",
        new JsonObject().put("ownerId", 1).put("moduleId", 1).put("createdAt", -1),
        false);
    add(
        work,
        mongo,
        "course_progress",
        new JsonObject().put("ownerId", 1).put("moduleId", 1),
        true);

    add(work, mongo, "blogposts", new JsonObject().put("slug", 1), true);
    add(work, mongo, "blogposts", new JsonObject().put("status", 1).put("publishedAt", -1), false);
    add(work, mongo, "blogevents", new JsonObject().put("slug", 1).put("createdAt", -1), false);
    add(
        work,
        mongo,
        "blogevents",
        new JsonObject().put("visitorHash", 1).put("createdAt", -1),
        false);
    add(work, mongo, "blogreactions", new JsonObject().put("slug", 1).put("visitorHash", 1), true);
    add(work, mongo, "blogcomments", new JsonObject().put("slug", 1).put("createdAt", -1), false);
    add(work, mongo, "blogtermsummaries", new JsonObject().put("slug", 1).put("termId", 1), true);
    add(work, mongo, "blogversions", new JsonObject().put("slug", 1).put("versionId", 1), true);
    add(
        work,
        mongo,
        "blogversions",
        new JsonObject().put("slug", 1).put("versionNumber", -1),
        false);
    work.add(
        mongo.createIndexWithOptions(
            "blogversions",
            new JsonObject().put("slug", 1).put("seedKey", 1),
            new IndexOptions(
                new JsonObject()
                    .put("unique", true)
                    .put(
                        "partialFilterExpression",
                        new JsonObject()
                            .put("seedKey", new JsonObject().put("$type", "string"))))));
    add(work, mongo, "blogpublicationannouncements", new JsonObject().put("publishKey", 1), true);
    add(work, mongo, "blogpublicationannouncements", new JsonObject().put("createdAt", 1), false);

    add(work, mongo, "notifications", new JsonObject().put("createdAt", -1), false);
    add(
        work,
        mongo,
        "notifications",
        new JsonObject().put("audience", 1).put("targetUserId", 1).put("createdAt", -1),
        false);
    add(work, mongo, "notifications", new JsonObject().put("notificationId", 1), true);
    return Future.all(work).mapEmpty();
  }

  private static void add(
      List<Future<?>> work,
      io.vertx.ext.mongo.MongoClient mongo,
      String collection,
      JsonObject fields,
      boolean unique) {
    work.add(
        mongo.createIndexWithOptions(
            collection, fields, new IndexOptions(new JsonObject().put("unique", unique))));
  }
}
