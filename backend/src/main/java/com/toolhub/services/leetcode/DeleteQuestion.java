package com.toolhub.services.leetcode;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class DeleteQuestion {
    private static final Logger log = LoggerFactory.getLogger(DeleteQuestion.class);
    private final MongoDBClient mongoDBClient;

    public DeleteQuestion(MongoDBClient mongoDBClient) {
        this.mongoDBClient = mongoDBClient;
    }

    public void handle(RoutingContext context) {
        JsonObject body = context.body().asJsonObject();
        String questionId = body.getString("questionId");
        String userId = context.get("userId");

        if (questionId == null) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse("Missing questionId"));
            return;
        }

        JsonObject query = new JsonObject()
                .put("questionId", questionId)
                .put("userId", userId);

        mongoDBClient.deleteRecord(query, "leetcode").onSuccess(res -> {
            log.info("Deleted question {} for user {}", questionId, userId);
            Utility.buildResponse(context, 200, Utility.createSuccessResponse("Question deleted"));
        }).onFailure(fail -> {
            log.error("Failed to delete question {}: {}", questionId, fail.getMessage());
            Utility.buildResponse(context, 500, Utility.createErrorResponse("Error deleting question"));
        });
    }
}
