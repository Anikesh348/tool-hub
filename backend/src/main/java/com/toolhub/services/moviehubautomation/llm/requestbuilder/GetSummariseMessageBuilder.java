package com.toolhub.services.moviehubautomation.llm.requestbuilder;

import com.toolhub.models.moviehubautomation.MediaState;
import com.toolhub.services.moviehubautomation.llm.prompttemplates.Templates;
import io.vertx.core.json.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.stream.Collectors;

public class GetSummariseMessageBuilder implements BaseOpenAiMessageBuilder {

    private static final Logger log = LoggerFactory.getLogger(GetSummariseMessageBuilder.class);

    @Override
    public JsonObject buildMessage(MediaState mediaState, String backendResponse) {
        log.info("Building SUMMARY message for mediaState={}, backendResponse={}",
                mediaState, backendResponse);

        return userMessage(mediaState, backendResponse);
    }

    private static JsonObject userMessage(MediaState state, String backendResponse) {

        String content = Templates.SUMMARY_PROMPT_TEMPLATE
                .replace("{MEDIA_TYPE}", valueOrMissing(state.getMediaType()))
                .replace("{TITLE}", valueOrMissing(state.getTitle()))
                .replace("{SEASON}", formatSeason(state))
                .replace("{QUALITY}", valueOrMissing(state.getQuality()))
                .replace("{BACKEND_RESPONSE}", valueOrMissing(backendResponse));

        return new JsonObject()
                .put("role", "user")
                .put("content", content);
    }

    private static String formatSeason(MediaState state) {
        if (state.getSeason() == null || state.getSeason().isEmpty()) {
            return "missing";
        }
        return state.getSeason()
                .stream()
                .map(String::valueOf)
                .collect(Collectors.joining(","));
    }

    private static String valueOrMissing(Object value) {
        return value == null ? "missing" : value.toString();
    }
}
