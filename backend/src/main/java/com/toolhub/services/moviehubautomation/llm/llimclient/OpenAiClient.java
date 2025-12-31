package com.toolhub.services.moviehubautomation.llm.llimclient;

import com.toolhub.Utils.Utility;
import com.toolhub.enums.moviehubautomation.AiModel;
import com.toolhub.models.moviehubautomation.LLMResponse;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OpenAiClient implements AiClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAiClient.class);

    private final WebClient webClient;
    private final String openAiUrl;
    private final String openAiApiKey;

    public OpenAiClient(WebClient webClient, String openAiUrl, String openAiApiKey) {
        this.webClient = webClient;
        this.openAiUrl = openAiUrl;
        this.openAiApiKey = openAiApiKey;
        log.info("OpenAiClient initialized with url={}", openAiUrl);
    }

    public AiModel get() {
        return AiModel.OPENAI;
    }

    public Future<LLMResponse> makeAiCall(JsonObject request) {
        Promise<LLMResponse> llmResponsePromise = Promise.promise();
        log.info("Making OpenAI API call to {}", openAiUrl);

        webClient.postAbs(openAiUrl)
                .putHeader("Authorization", "Bearer " + openAiApiKey)
                .sendJsonObject(request)
                .onSuccess(res -> {
                    log.info("OpenAI API response received with status={}", res.statusCode());
                    if (res.statusCode() >= 200 && res.statusCode() < 300) {
                        try {
                            String response = res.bodyAsJsonObject()
                                    .getJsonArray("choices")
                                    .getJsonObject(0)
                                    .getJsonObject("message")
                                    .getString("content");
                            log.info("Raw LLM content: [{}]", response);
                            JsonObject parsedJson = new JsonObject(response);
                            LLMResponse llmResponse = Utility.castToClass(parsedJson, LLMResponse.class);
                            log.info("Successfully parsed LLM response");
                            llmResponsePromise.complete(llmResponse);
                        } catch (Exception e) {
                            String errorMsg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
                            log.error("Failed to parse OpenAI response: {}", errorMsg);
                            llmResponsePromise.fail(errorMsg);
                        }
                    } else {
                        log.error("OpenAI API returned non-success status={}, body={}",
                                res.statusCode(), res.bodyAsString());
                        llmResponsePromise.fail("OpenAI API error: " + res.statusCode());
                    }
                }).onFailure(fail -> {
                    log.error("OpenAI API call failed: {}", fail.getMessage());
                    llmResponsePromise.fail(fail.getMessage());
                });
        return llmResponsePromise.future();
    }
}
