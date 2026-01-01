package com.toolhub.services.moviehubautomation.llm.requestbuilder;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.models.moviehubautomation.MediaState;
import com.toolhub.services.moviehubautomation.llm.prompttemplates.Templates;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OpenAiRequestBuilder {

    private static final Logger log = LoggerFactory.getLogger(OpenAiRequestBuilder.class);

    public static JsonObject buildPayload(MediaState mediaState, String input, Intent intent) {
        log.info("Building OpenAI request payload for intent={}", intent);

        JsonObject request = new JsonObject()
                .put("model", "gpt-4o-mini")
                .put("temperature", 0)
                .put("max_tokens", 200);
        JsonArray messages = new JsonArray()
                .add(systemMessage())
                .add(OpenAiMessageFactory.build(intent)
                        .buildMessage(mediaState, input));

        log.info("Built OpenAI request with model=gpt-4o-mini, messages count={}", messages.size());
        return request.put("messages", messages);
    }

    private static JsonObject systemMessage() {
        return new JsonObject()
                .put("role", "system")
                .put("content", Templates.SYSTEM_PROMPT);
    }
}
