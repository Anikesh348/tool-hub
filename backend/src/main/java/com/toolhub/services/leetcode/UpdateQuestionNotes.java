package com.toolhub.services.leetcode;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;

public class UpdateQuestionNotes {
    private static final Logger log = LoggerFactory.getLogger(UpdateQuestionNotes.class);
    private final MongoDBClient mongoDBClient;

    public UpdateQuestionNotes(MongoDBClient mongoDBClient) {
        this.mongoDBClient = mongoDBClient;
    }

    public void handle(RoutingContext context) {
        JsonObject body = context.body().asJsonObject();
        String questionId = body.getString("questionId");
        String notes = body.getString("notes");
        String userId = context.get("userId");

        if (questionId == null || notes == null) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse("Missing questionId or notes"));
            return;
        }

        JsonObject query = new JsonObject()
                .put("questionId", questionId)
                .put("userId", userId);

        JsonObject update = new JsonObject().put("$set",
                new JsonObject().put("notes", notes).put("updatedAt", Instant.now().toString()));

        mongoDBClient.updateRecord(query, update, "leetcode").onSuccess(res -> {
            log.info("Updated notes for question {} by user {}", questionId, userId);
            Utility.buildResponse(context, 200, Utility.createSuccessResponse("Notes updated"));
        }).onFailure(fail -> {
            log.error("Failed to update notes for question {}: {}", questionId, fail.getMessage());
            Utility.buildResponse(context, 500, Utility.createErrorResponse("Error updating notes"));
        });
    }
}

