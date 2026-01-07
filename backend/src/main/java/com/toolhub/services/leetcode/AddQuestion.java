package com.toolhub.services.leetcode;

import com.toolhub.models.LeetCodeQuestion;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;

public class AddQuestion {
    private static final Logger log = LoggerFactory.getLogger(AddQuestion.class);
    private final MongoDBClient mongoDBClient;
    private final LeetCodeQuestion question;

    public static void add(MongoDBClient mongoDBClient, LeetCodeQuestion question) {
        new AddQuestion(mongoDBClient, question).insertOrUpdateRecord();
    }
    public AddQuestion(MongoDBClient mongoDBClient, LeetCodeQuestion question) {
        this.mongoDBClient = mongoDBClient;
        this.question = question;
    }

    public void insertOrUpdateRecord() {
        try {
            if (question == null) {
                log.warn("insertOrUpdateRecord called with null question");
                return;
            }

            String title = question.getTitle();
            String userId = question.getUserId();
            if (title == null || title.trim().isEmpty() || userId == null || userId.trim().isEmpty()) {
                log.warn("Missing url or userId on question: url='{}' userId='{}'", title, userId);
                return;
            }

            JsonObject query = new JsonObject().put("title", title).put("userId", userId);

            JsonObject doc = JsonObject.mapFrom(question);

            try {
                doc.put("updatedAt", Instant.now().toString());
            } catch (Exception ignore) {}

            mongoDBClient.queryRecords(query, "leetcode")
                    .onSuccess(records -> {
                        if (records != null && !records.isEmpty()) {
                            JsonObject existing = records.stream().findFirst().orElse(null);

                            try {
                                Object existingStatus = existing.getValue("status");
                                Object createdTimestamp = existing.getValue("createdAt");
                                Object existingNotes = existing.getValue("notes");
                                if (existingStatus != null) doc.put("status", existingStatus);
                                if (createdTimestamp != null) doc.put("createdAt", createdTimestamp);
                                if (existingNotes != null) doc.put("notes", existingNotes);
                            } catch (Exception ignore) {}


                            JsonObject update = new JsonObject().put("$set", doc);
                            mongoDBClient.updateRecord(query, update, "leetcode")
                                    .onSuccess(v -> log.info("Updated existing LeetCode question for title={} userId={}", title, userId))
                                    .onFailure(fail -> log.error("Failed to update question title={} userId={} : {}", title, userId, fail.getMessage()));
                        } else {
                            try {
                                if (!doc.containsKey("createdAt")) doc.put("createdAt", Instant.now().toString());
                            } catch (Exception ignore) {}

                            mongoDBClient.insertRecord(doc, "leetcode")
                                    .onSuccess(i -> log.info("Inserted new LeetCode question for title={} userId={}", title, userId))
                                    .onFailure(insertFail -> log.error("Failed to insert question title={} userId={} : {}", title, userId, insertFail.getMessage()));
                        }
                    })
                    .onFailure(fail -> log.error("Failed to query existing LeetCode question for url={} userId={} : {}", title, userId, fail.getMessage()));

        } catch (Exception e) {
            log.error("Exception in AddQuestion.insertOrUpdateRecord", e);
        }
    }
}
