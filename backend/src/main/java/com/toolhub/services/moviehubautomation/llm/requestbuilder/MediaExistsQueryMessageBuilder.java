package com.toolhub.services.moviehubautomation.llm.requestbuilder;

import com.toolhub.models.moviehubautomation.MediaState;
import com.toolhub.services.moviehubautomation.llm.prompttemplates.Templates;
import io.vertx.core.json.JsonObject;

public class MediaExistsQueryMessageBuilder implements BaseOpenAiMessageBuilder {

    @Override
    public JsonObject buildMessage(MediaState mediaState, String userInput) {
        String content = Templates.MEDIA_EXISTS_QUERY_PROMPT
                .replace("{USER_INPUT}", valueOrMissing(userInput));
        return new JsonObject()
                .put("role", "user")
                .put("content", content);
    }

    private static String valueOrMissing(Object value) {
        return value == null ? "" : value.toString();
    }
}

