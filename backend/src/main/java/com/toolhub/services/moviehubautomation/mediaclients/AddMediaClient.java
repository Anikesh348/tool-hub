package com.toolhub.services.moviehubautomation.mediaclients;

import com.toolhub.models.moviehubautomation.AddMediaPayload;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AddMediaClient {
    private static final Logger log = LoggerFactory.getLogger(AddMediaClient.class);
    private final WebClient client;
    private final String apiUrl;
    private final String apiKey;
    public static Future<JsonObject> add(WebClient webClient, String addMovieUrl, String apiKey, AddMediaPayload addMediaPayload) {
       return new AddMediaClient(webClient, addMovieUrl, apiKey).addMedia(addMediaPayload);

    }

    private AddMediaClient(WebClient webClient, String addMovieUrl, String apiKey)  {
        this.client = webClient;
        this.apiKey = apiKey;
        this.apiUrl = addMovieUrl;
        log.debug("AddMovieClient initialized with apiUrl={}", addMovieUrl);
    }

    private Future<JsonObject> addMedia(AddMediaPayload addMediaPayload) {
        Promise<JsonObject> addMoviePromise = Promise.promise();
        try {
            JsonObject jsonPayload = JsonObject.mapFrom(addMediaPayload);
            log.info("Sending add movie request to {} with payload={}", apiUrl, jsonPayload.encode());
            client.postAbs(apiUrl)
                    .putHeader("x-api-key", apiKey)
                    .sendJsonObject(jsonPayload)
                    .onSuccess(res -> {
                        if (res.statusCode() >= 200 && res.statusCode() < 300) {
                            log.info("Add movie request succeeded for title={}", addMediaPayload.getTitle());
                            addMoviePromise.complete(res.bodyAsJsonObject());
                        } else {
                            log.warn("Add movie request returned non-success status {} for title={}", res.statusCode(), addMediaPayload.getTitle());
                            addMoviePromise.fail(res.bodyAsString());
                        }
                    }).onFailure(fail -> {
                        log.error("Add movie request failed for title={}: {}", addMediaPayload.getTitle(), fail.getMessage());
                        addMoviePromise.fail(fail.getMessage());
                    });
        } catch (Exception e) {
            String causeMsg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
            log.error("Exception while creating add movie payload: {}", causeMsg);
            addMoviePromise.fail(causeMsg);
        }
        return addMoviePromise.future();
    }
}
