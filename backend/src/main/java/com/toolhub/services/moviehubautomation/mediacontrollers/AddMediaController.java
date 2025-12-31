package com.toolhub.services.moviehubautomation.mediacontrollers;

import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.models.moviehubautomation.LookUpDTO;

import io.vertx.core.Future;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public interface AddMediaController {
    static final Logger log = LoggerFactory.getLogger(AddMediaController.class);
    MediaType get();
    Future<Void> addContent(LookUpDTO lookUpDTO);
}
