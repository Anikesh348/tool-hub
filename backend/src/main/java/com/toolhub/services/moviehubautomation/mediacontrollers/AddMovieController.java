package com.toolhub.services.moviehubautomation.mediacontrollers;

import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.models.moviehubautomation.AddMoviePayload;
import com.toolhub.models.moviehubautomation.LookUpDTO;
import com.toolhub.services.moviehubautomation.mediaclients.LookUpClient;

import com.toolhub.services.moviehubautomation.mediaclients.AddMediaClient;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.ext.web.client.WebClient;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AddMovieController implements AddMediaController {
    private static final Logger log = LoggerFactory.getLogger(AddMovieController.class);

    private final String radarrBaseUrl;
    private final String radarrApiKey;
    private final LookUpClient lookUpClient;
    private final String addMoviePath = "/movie";
    private final WebClient webClient;

    public AddMovieController(WebClient client, String radarrBaseUrl, String radarrApiKey) {
        this.radarrBaseUrl = radarrBaseUrl;
        this.radarrApiKey = radarrApiKey;
        this.webClient = client;
        String lookUpPath = "/movie/lookup";
        this.lookUpClient = LookUpClient.get(webClient, radarrApiKey, radarrBaseUrl + lookUpPath);
        log.debug("AddMovieController initialized with radarrBaseUrl={} addMoviePath={}", radarrBaseUrl, addMoviePath);
    }

    @Override
    public MediaType get() {
        return MediaType.MOVIES;
    }

    @Override
    public Future<Void> addContent(LookUpDTO lookUpDTO) {
        Promise<Void> addContentPromise = Promise.promise();
        log.debug("addContent called for title={} qualityProfile={}", lookUpDTO.getTitle(), lookUpDTO.getQuality());
        lookUpClient.callLookUpUrl(lookUpDTO.getTitle()).onSuccess(lookUpResponse -> {
            log.debug("Lookup successful for title={}", lookUpDTO.getTitle());
            AddMoviePayload addMoviePayload = new AddMoviePayload(lookUpResponse, lookUpDTO);
            AddMediaClient.add(webClient, radarrBaseUrl + addMoviePath, radarrApiKey, addMoviePayload)
                    .onComplete(res -> {
                        if (res.succeeded()) {
                            log.info("Successfully added movie {} to Radarr", addMoviePayload.getTitle());
                            addContentPromise.complete();
                        } else {
                            log.error("Failed to add movie {}: {}", addMoviePayload.getTitle(), res.cause().getMessage());
                            addContentPromise.fail(res.cause().getMessage());
                        }
                    });
        }).onFailure(fail -> {
            log.error("Lookup failed for title {}: {}", lookUpDTO.getTitle(), fail.getMessage());
            addContentPromise.fail(fail.getMessage());
        });
        return addContentPromise.future();
    
    }

}
