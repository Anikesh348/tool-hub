package com.toolhub.services.leetcode;

import com.toolhub.models.LeetCodeQuestion;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.buffer.Buffer;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.HttpResponse;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

public class FetchLeetCodeMetaData {

    private static final Logger log = LoggerFactory.getLogger(FetchLeetCodeMetaData.class);
    private final WebClient webClient;
    private final LeetCodeQuestion question;
    public static Future<LeetCodeQuestion> fetchTags(WebClient webClient, LeetCodeQuestion question) {
         return new FetchLeetCodeMetaData(webClient, question).makeFetchCall();
    }
    private FetchLeetCodeMetaData(WebClient webClient, LeetCodeQuestion question) {
        this.webClient = webClient;
        this.question = question;
    }

    private Future<LeetCodeQuestion> makeFetchCall() {
        Promise<LeetCodeQuestion> tagsPromise = Promise.promise();
        String slug = extractSlugFromUrl(question.getUrl());
        if (slug == null || slug.isEmpty()) {
            tagsPromise.fail("invalid slug");
            return tagsPromise.future();
        }

        String query = "query getQuestionDetail($titleSlug: String!) { question(titleSlug: $titleSlug) { title difficulty stats acRate topicTags { name slug } } }";
        JsonObject payload = new JsonObject()
                .put("query", query)
                .put("variables", new JsonObject().put("titleSlug", slug));

        String host = "leetcode.com";
        String uri = "/graphql";

        webClient.post(443, host, uri)
                .putHeader("Content-Type", "application/json")
                .ssl(true)
                .sendJsonObject(payload, ar -> {
                    if (ar.succeeded()) {
                        HttpResponse<Buffer> response = ar.result();
                        int status = response.statusCode();
                        if (status >= 200 && status < 300) {
                            try {
                                JsonObject body = response.bodyAsJsonObject();
                                if (body == null) {
                                    tagsPromise.fail("empty response body");
                                    return;
                                }
                                JsonObject data = body.getJsonObject("data");
                                if (data == null) {
                                    tagsPromise.fail("missing data in response");
                                    return;
                                }
                                JsonObject questionObj = data.getJsonObject("question");
                                if (questionObj == null) {
                                    tagsPromise.fail("question not found");
                                    return;
                                }

                                String title = questionObj.getString("title");
                                String difficulty = questionObj.getString("difficulty");
                                Double acRate = null;
                                if (questionObj.containsKey("acRate")) {
                                    acRate = questionObj.getDouble("acRate");
                                } else if (questionObj.containsKey("stats")) {
                                    Object statsObj = questionObj.getValue("stats");
                                    if (statsObj instanceof String) {
                                        try {
                                            JsonObject statsJson = new JsonObject((String) statsObj);
                                            acRate = statsJson.getDouble("acRate");
                                        } catch (Exception ignore) {
                                        }
                                    } else if (statsObj instanceof JsonObject statsJson) {
                                        acRate = statsJson.getDouble("acRate");
                                    }
                                }

                                List<String> tags = new ArrayList<>();
                                JsonArray topicTags = questionObj.getJsonArray("topicTags");
                                if (topicTags != null) {
                                    for (int i = 0; i < topicTags.size(); i++) {
                                        JsonObject tagObj = topicTags.getJsonObject(i);
                                        if (tagObj != null) {
                                            String name = tagObj.getString("name");
                                            if (name != null) tags.add(name);
                                        }
                                    }
                                }

                                try {
                                    question.setTitle(title);
                                } catch (Exception ignored) {}
                                try {
                                    question.setDifficulty(difficulty);
                                } catch (Exception ignored) {}
                                try {
                                    if (acRate != null) question.setAcRate(acRate);
                                } catch (Exception ignored) {}
                                try {
                                    question.setTags(tags);
                                } catch (Exception ignored) {}
                                log.info("logging question {}", JsonObject.mapFrom(question));
                                tagsPromise.complete(question);

                            } catch (Exception e) {
                                log.error("Failed to parse response body", e);
                                tagsPromise.fail(e);
                            }
                        } else {
                            tagsPromise.fail("unexpected status: " + status + " body: " + response.bodyAsString());
                        }
                    } else {
                        log.error("HTTP request failed", ar.cause());
                        tagsPromise.fail(ar.cause());
                    }
                });

        return tagsPromise.future();
    }

    private String extractSlugFromUrl(String url) {
        if (url == null || url.trim().isEmpty()) {
            return null;
        }

        try {
            java.net.URI uri = new java.net.URI(url);
            String path = uri.getPath();
            if (path == null || path.isEmpty()) {
                return null;
            }
            String[] parts = path.split("/");
            for (int i = 0; i < parts.length; i++) {
                if ("problems".equals(parts[i]) && i + 1 < parts.length) {
                    String slug = parts[i + 1];
                    if (slug != null && !slug.isEmpty()) {
                        return slug;
                    }
                }
            }
            for (int i = parts.length - 1; i >= 0; i--) {
                if (parts[i] != null && !parts[i].isEmpty()) {
                    return parts[i];
                }
            }
            return null;
        } catch (Exception e) {
            log.debug("URI parsing failed for url={}, falling back to simple split", url, e);
            String withoutQuery = url.split("\\?")[0];
            String[] parts = withoutQuery.split("/");
            for (int i = parts.length - 1; i >= 0; i--) {
                if (parts[i] != null && !parts[i].isEmpty()) {
                    return parts[i];
                }
            }
            return null;
        }
    }

}
