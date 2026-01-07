package com.toolhub.services.leetcode;

import com.toolhub.Utils.Utility;
import com.toolhub.models.LeetCodeQuestion;
import com.toolhub.services.batchprocessor.LeetcodeBatchProcessor;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class AddQuestionController {

    private static final Logger log = LoggerFactory.getLogger(AddQuestionController.class);
    private final MongoDBClient mongodbClient;
    private final WebClient webClient;
    public AddQuestionController(MongoDBClient mongoDBClient, WebClient webClient) {
        this.mongodbClient = mongoDBClient;
        this.webClient = webClient;
    }

    public void handle(RoutingContext context) {
        try {
            JsonObject body = context.body().asJsonObject();
            String userId = context.get("userId");

            JsonArray urls = body.getJsonArray("questionUrls");
            if (urls == null || urls.isEmpty()) {
                Utility.buildResponse(context, 400, Utility.createErrorResponse("No question URLs provided"));
                return;
            }
            List<LeetCodeQuestion> questions = new ArrayList<>();
            urls.forEach(url -> questions.add(new LeetCodeQuestion(UUID.randomUUID().toString(),
                    url.toString(), "", userId,
                    false, Instant.now(), Instant.now(), "")));
            LeetcodeBatchProcessor.process(mongodbClient, webClient, questions);
            Utility.buildResponse(context, 200, new JsonObject().put("message", "questions will be inserted"));
        } catch (Exception e) {
            log.error("Exception in AddQuestion", e);
            Utility.buildResponse(context, 500, Utility.createErrorResponse("Internal server error"));
        }
    }

}
