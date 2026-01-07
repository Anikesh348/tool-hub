package com.toolhub.services.moviehubautomation.llm.requestbuilder;

import com.toolhub.models.moviehubautomation.MediaState;
import com.toolhub.services.moviehubautomation.llm.prompttemplates.Templates;
import io.vertx.core.json.JsonObject;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GetIntentMessageBuilder implements BaseOpenAiMessageBuilder {

    private static final Logger log = LoggerFactory.getLogger(GetIntentMessageBuilder.class);

    public GetIntentMessageBuilder() {
    }

    @Override
    public JsonObject buildMessage(MediaState mediaState, String userInput) {
        log.info("Building GET_INTENT message for userInput={}", userInput);
        return userMessage(userInput);
    }

    private static JsonObject userMessage(String userInput) {
        String content = Templates.INTENT_CLASSIFICATION_USER_PROMPT
                .replace("{USER_INPUT}", valueOrMissing(userInput));
        return new JsonObject().put("role", "user").put("content", content);
    }

    private static String valueOrMissing(Object value) {
        return value == null ? "missing" : value.toString();
    }
}
