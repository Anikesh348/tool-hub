package com.toolhub.services.moviehubautomation.mediacontrollers;

import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.models.moviehubautomation.AddMoviePayload;
import com.toolhub.models.moviehubautomation.LookUpDTO;
import com.toolhub.services.moviehubautomation.mediaclients.AddMediaClient;
import com.toolhub.services.moviehubautomation.mediaclients.LookUpClient;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
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
    log.debug(
        "AddMovieController initialized with radarrBaseUrl={} addMoviePath={}",
        radarrBaseUrl,
        addMoviePath);
  }

  @Override
  public MediaType get() {
    return MediaType.MOVIES;
  }

  @Override
  public Future<Void> addContent(LookUpDTO lookUpDTO) {
    Promise<Void> addContentPromise = Promise.promise();
    log.debug(
        "addContent called for title={} qualityProfile={}",
        lookUpDTO.getTitle(),
        lookUpDTO.getQuality());
    lookUpClient
        .callLookUpUrlList(lookUpDTO.getTitle())
        .onSuccess(
            lookupResults -> {
              JsonObject lookUpResponse = selectMovieLookupResult(lookupResults, lookUpDTO);
              if (lookUpResponse == null) {
                addContentPromise.fail("Unable to resolve the requested movie from lookup results");
                return;
              }
              log.debug("Lookup successful for title={}", lookUpDTO.getTitle());
              AddMoviePayload addMoviePayload = new AddMoviePayload(lookUpResponse, lookUpDTO);
              AddMediaClient.add(
                      webClient, radarrBaseUrl + addMoviePath, radarrApiKey, addMoviePayload)
                  .onComplete(
                      res -> {
                        if (res.succeeded()) {
                          log.info(
                              "Successfully added movie {} to Radarr", addMoviePayload.getTitle());
                          addContentPromise.complete();
                        } else {
                          log.error(
                              "Failed to add movie {}: {}",
                              addMoviePayload.getTitle(),
                              res.cause().getMessage());
                          addContentPromise.fail(res.cause().getMessage());
                        }
                      });
            })
        .onFailure(
            fail -> {
              log.error("Lookup failed for title {}: {}", lookUpDTO.getTitle(), fail.getMessage());
              addContentPromise.fail(fail.getMessage());
            });
    return addContentPromise.future();
  }

  private JsonObject selectMovieLookupResult(JsonArray lookupResults, LookUpDTO lookUpDTO) {
    if (lookupResults == null || lookupResults.isEmpty()) {
      return null;
    }

    Integer requestedTmdbId = lookUpDTO.getTmdbId();
    String requestedImdbId = lookUpDTO.getImdbId();

    if (requestedTmdbId != null) {
      for (Object item : lookupResults) {
        if (!(item instanceof JsonObject candidate)) {
          continue;
        }
        Integer tmdbId = candidate.getInteger("tmdbId");
        if (requestedTmdbId.equals(tmdbId)) {
          return candidate;
        }
      }
      log.warn(
          "No movie lookup match found for tmdbId={} title={}",
          requestedTmdbId,
          lookUpDTO.getTitle());
      return null;
    }

    if (requestedImdbId != null && !requestedImdbId.isBlank()) {
      for (Object item : lookupResults) {
        if (!(item instanceof JsonObject candidate)) {
          continue;
        }
        String imdbId = candidate.getString("imdbId");
        if (requestedImdbId.equalsIgnoreCase(imdbId)) {
          return candidate;
        }
      }
      log.warn(
          "No movie lookup match found for imdbId={} title={}",
          requestedImdbId,
          lookUpDTO.getTitle());
      return null;
    }

    return lookupResults.getJsonObject(0);
  }
}
