package com.toolhub.models.moviehubautomation;

import io.vertx.core.json.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AddMoviePayload extends AddMediaPayload {
  private static final Logger log = LoggerFactory.getLogger(AddMoviePayload.class);

  Integer tmdbId;
  String minimumAvailability;

  public AddMoviePayload(JsonObject lookUpResponse, LookUpDTO lookUpDTO) {
    super();
    String quality = lookUpDTO.getQuality() == null ? "any" : lookUpDTO.getQuality().toLowerCase();
    this.rootFolderPath = isUhdQuality(quality) ? "/uhdmovies" : "/movies";
    this.minimumAvailability = "released";
    this.addOptions = new JsonObject().put("searchForMovie", true);
    this.title = lookUpResponse.getString("title");
    this.tmdbId = lookUpResponse.getInteger("tmdbId");
    this.qualityProfileId = QUALITY_PROFILE_MAP.getOrDefault(quality, DEFAULT_QUALITY_PROFILE_ID);
  }

  private boolean isUhdQuality(String quality) {
    return "4k".equals(quality)
        || "2160p".equals(quality)
        || "uhd".equals(quality)
        || "ultra-hd".equals(quality);
  }

  public String getMinimumAvailability() {
    return minimumAvailability;
  }

  public void setMinimumAvailability(String minimumAvailability) {
    this.minimumAvailability = minimumAvailability;
  }

  public Integer getTmdbId() {
    return tmdbId;
  }

  public void setTmdbId(Integer tmdbId) {
    this.tmdbId = tmdbId;
  }
}
