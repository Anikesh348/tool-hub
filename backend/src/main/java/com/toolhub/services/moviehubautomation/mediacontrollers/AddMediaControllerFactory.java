package com.toolhub.services.moviehubautomation.mediacontrollers;

import com.toolhub.enums.moviehubautomation.MediaType;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AddMediaControllerFactory {

    private static final Logger log = LoggerFactory.getLogger(AddMediaControllerFactory.class);

    private final Map<MediaType, AddMediaController> strategies;

    public AddMediaControllerFactory(List<AddMediaController> mediaControllers) {
        this.strategies = mediaControllers.stream().collect(Collectors.toMap(AddMediaController::get, Function.identity()));
    }

    public AddMediaController getClient(MediaType mediaType) {
        if (mediaType == null) {
            throw new IllegalStateException("mediaType cannot be null");
        }
        log.debug("ControllerFactory.get called with mediaType={}", mediaType);
        AddMediaController addMediaController = strategies.get(mediaType);
        if (addMediaController == null) {
            throw new IllegalStateException("No add controller clients available");
        }
        return addMediaController;
    }
}
