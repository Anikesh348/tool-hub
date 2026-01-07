package com.toolhub.services.leetcode;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;

public class UpdateQuestionStatus {
    private static final Logger log = LoggerFactory.getLogger(UpdateQuestionStatus.class);
    private final MongoDBClient mongoDBClient;

    public UpdateQuestionStatus(MongoDBClient mongoDBClient) {
        this.mongoDBClient = mongoDBClient;
    }

    public void handle(RoutingContext context) {
        JsonObject body = context.body().asJsonObject();
        String questionId = body.getString("questionId");
        String newStatus = body.getString("status");
        String userId = context.get("userId");

        if (questionId == null || newStatus == null) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse("Missing questionId or status"));
            return;
        }

        JsonObject query = new JsonObject()
                .put("questionId", questionId)
                .put("userId", userId);
        JsonObject update = new JsonObject().put("$set",
                new JsonObject().put("status", newStatus).put("updatedAt", Instant.now().toString()));

        mongoDBClient.updateRecord(query, update, "leetcode").onSuccess(res -> {
            log.info("Updated question {} to {} for user {}", questionId, newStatus, userId);
            Utility.buildResponse(context, 200, Utility.createSuccessResponse("Status updated"));
        }).onFailure(fail -> {
            log.error("Failed to update status for question {}: {}", questionId, fail.getMessage());
            Utility.buildResponse(context, 500, Utility.createErrorResponse("Error updating status"));
        });
    }
}
