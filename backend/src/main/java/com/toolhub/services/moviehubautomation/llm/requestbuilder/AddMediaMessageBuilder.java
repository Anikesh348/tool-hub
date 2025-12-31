package com.toolhub.services.moviehubautomation.llm.requestbuilder;

import com.toolhub.models.moviehubautomation.MediaState;
import com.toolhub.services.moviehubautomation.llm.prompttemplates.Templates;
import io.vertx.core.json.JsonObject;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.stream.Collectors;

public class AddMediaMessageBuilder implements BaseOpenAiMessageBuilder {

    private static final Logger log = LoggerFactory.getLogger(AddMediaMessageBuilder.class);

    public AddMediaMessageBuilder() {
    }

    @Override
    public JsonObject buildMessage(MediaState mediaState, String userInput) {
        log.info("Building ADD_MEDIA message with title={}, mediaType={}, quality={}",
                mediaState.getTitle(), mediaState.getMediaType(), mediaState.getQuality());
        return userMessage(mediaState, userInput);
    }

    private static JsonObject userMessage(MediaState state, String userInput) {

        String seasonValue = formatSeason(state.getSeason());

        String content = Templates.USER_PROMPT_TEMPLATE
                .replace("{TITLE}", valueOrMissing(state.getTitle()))
                .replace("{MEDIA_TYPE}", valueOrMissing(
                        state.getMediaType() != null ? state.getMediaType().toString() : null
                ))
                .replace("{QUALITY}", valueOrMissing(state.getQuality()))
                .replace("{SEASON}", seasonValue)
                .replace("{USER_INPUT}", userInput == null ? "" : userInput.trim());

        return new JsonObject()
                .put("role", "user")
                .put("content", content);
    }

    private static String formatSeason(List<Integer> seasons) {
        if (seasons == null || seasons.isEmpty()) {
            return "missing";
        }
        return seasons.stream()
                .map(String::valueOf)
                .collect(Collectors.joining(","));
    }



    private static String valueOrMissing(Object value) {
        return value == null ? "missing" : value.toString();
    }
}
