package com.toolhub.services.moviehubautomation.intentparser;

import com.toolhub.enums.moviehubautomation.Intent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

public class IntentStrategyFactory {

    private static final Logger log = LoggerFactory.getLogger(IntentStrategyFactory.class);

    private final Map<Intent, IntentStrategy> strategies;

    public IntentStrategyFactory(List<IntentStrategy> strategyList) {
        this.strategies = strategyList.stream()
                .collect(Collectors.toMap(
                        IntentStrategy::getIntent,
                        Function.identity()
                ));
        log.debug("IntentStrategyFactory initialized with {} strategies: {}", strategies.size(), strategies.keySet());
    }

    public IntentStrategy getStrategy(Intent intent) {
        log.debug("Getting strategy for intent: {}", intent);
        IntentStrategy strategy = strategies.get(intent);
        if (strategy == null) {
            log.error("No strategy registered for intent: {}", intent);
            throw new IllegalStateException(
                    "No strategy registered for intent: " + intent
            );
        }
        log.debug("Found strategy: {} for intent: {}", strategy.getClass().getSimpleName(), intent);
        return strategy;
    }
}
