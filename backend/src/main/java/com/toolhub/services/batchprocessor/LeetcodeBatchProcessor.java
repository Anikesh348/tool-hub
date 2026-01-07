package com.toolhub.services.batchprocessor;

import com.toolhub.models.LeetCodeQuestion;
import com.toolhub.services.leetcode.AddQuestion;
import com.toolhub.services.leetcode.FetchLeetCodeMetaData;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.Future;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

public class LeetcodeBatchProcessor implements BatchProcessor<LeetCodeQuestion> {
    private static final int LIMIT = 10;
    private static final Logger log = LoggerFactory.getLogger(LeetcodeBatchProcessor.class);
    private final MongoDBClient mongoDBClient;
    private final WebClient webClient;
    public static void process(MongoDBClient mongoDBClient, WebClient webClient, List<LeetCodeQuestion> questions) {
         new LeetcodeBatchProcessor(mongoDBClient, webClient).handleBatch(0,  questions);
    }
    public LeetcodeBatchProcessor(MongoDBClient mongoDBClient, WebClient webClient) {
        this.mongoDBClient = mongoDBClient;
        this.webClient = webClient;
    }
    @Override
    public void handleBatch(int start, List<LeetCodeQuestion> questions) {
        if (start >= questions.size()) return;
        log.info("calling in batches with start: {}", start);
        List<LeetCodeQuestion> subListQuestions = questions.subList(start,
                Math.min(start + LIMIT, questions.size()));
        List<Future<LeetCodeQuestion>> productQueryFutures = new ArrayList<>();
        subListQuestions.forEach(question -> {
            productQueryFutures.add(FetchLeetCodeMetaData.fetchTags(webClient, question));
        });
        Future.join(productQueryFutures).onComplete(res -> {
            log.info("extracted question meta data");
            productQueryFutures.forEach(future -> {
                if (future.succeeded()) {
                    AddQuestion.add(mongoDBClient, future.result());
                }
            });
            handleBatch(start + LIMIT, questions);
        });
    }
}
