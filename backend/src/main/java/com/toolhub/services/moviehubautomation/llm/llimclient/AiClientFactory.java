package com.toolhub.services.moviehubautomation.llm.llimclient;

import com.toolhub.enums.moviehubautomation.AiModel;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

public class AiClientFactory {

    private static final Logger log = LoggerFactory.getLogger(AiClientFactory.class);

    private final Map<AiModel, AiClient> strategies;

    public AiClientFactory(List<AiClient> clientsList) {
        this.strategies = clientsList.stream().collect(Collectors.toMap(AiClient::get, Function.identity()));
        log.info("AiClientFactory initialized with {} clients: {}", strategies.size(), strategies.keySet());
    }

    public AiClient getClient(AiModel model) {
        log.info("Getting AI client for model: {}", model);
        if (model == null) {
            log.error("Requested AI model is null");
            throw new IllegalStateException("AI model cannot be null");
        }
        AiClient aiClient = strategies.get(model);
        if (aiClient == null) {
            log.error("No AI client registered for model: {}", model);
            throw new IllegalStateException("No AI client registered for model: " + model);
        }
        log.info("Returning AI client: {} for model: {}", aiClient.getClass().getSimpleName(), model);
        return aiClient;
    }
}
