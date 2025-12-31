package com.toolhub.services.leetcode;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

public class GetQuestions {
    private static final Logger log = LoggerFactory.getLogger(GetQuestions.class);
    private final MongoDBClient mongoDBClient;

    public GetQuestions(MongoDBClient mongoDBClient) {
        this.mongoDBClient = mongoDBClient;
    }

    public void handle(RoutingContext context) {
        String userId = context.get("userId");

        JsonObject query = new JsonObject().put("userId", userId);

        List<String> tags = context.request().params().getAll("tags");
        String operation = context.request().getParam("operation");
        if (operation == null) operation = "union";

        if (tags != null && !tags.isEmpty()) {
            JsonArray arr = new JsonArray();
            for (String t : tags) {
                if (t != null && !t.trim().isEmpty()) arr.add(t);
            }
            if (!arr.isEmpty()) {
                if ("intersection".equalsIgnoreCase(operation) || "interestion".equalsIgnoreCase(operation)) {
                    query.put("tags", new JsonObject().put("$all", arr));
                } else {
                    query.put("tags", new JsonObject().put("$in", arr));
                }
                log.info("Querying leetcode for user={} with tags={} operation={}", userId, arr.encode(), operation);
            }
        }

        mongoDBClient.queryRecords(query, "leetcode").onSuccess(res -> {
            log.info("Fetched {} questions for user {}", res.size(), userId);
            Utility.buildResponse(context, 200, res);
        }).onFailure(fail -> {
            log.error("Error fetching leetcode questions: {}", fail.getMessage());
            Utility.buildResponse(context, 500, Utility.createErrorResponse("Error fetching questions"));
        });
    }
}
