package com.toolhub.services.moviehubautomation.llm.requestbuilder;

import com.toolhub.enums.moviehubautomation.Intent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

public class OpenAiMessageFactory {

    private static final Logger log = LoggerFactory.getLogger(OpenAiMessageFactory.class);

    private static final Map<Intent, BaseOpenAiMessageBuilder> INTENT_TO_MESSAGE_BUILDER = Map.of(
            Intent.DOWNLOAD_MEDIA, new AddMediaMessageBuilder(),
            Intent.RAISE_REQUEST, new AddMediaMessageBuilder(),
            Intent.CHECK_DOWNLOAD_STATUS, new DownloadStatusQueryMessageBuilder(),
            Intent.LIST_DOWNLOADS, new DownloadStatusQueryMessageBuilder(),
            Intent.CHECK_MEDIA_EXISTS, new MediaExistsQueryMessageBuilder(),
            Intent.UNKNOWN, new GetIntentMessageBuilder(),
            Intent.SUMMARIZE, new GetSummariseMessageBuilder());

    public static BaseOpenAiMessageBuilder build(Intent intent) {
        log.info("Building message builder for intent: {}", intent);
        BaseOpenAiMessageBuilder builder = INTENT_TO_MESSAGE_BUILDER.get(intent);
        if (builder == null) {
            log.error("No message builder available for intent: {}", intent);
            throw new IllegalStateException("No message builder available for intent: " + intent);
        }
        log.info("Returning message builder: {} for intent: {}", builder.getClass().getSimpleName(), intent);
        return builder;
    }
}
