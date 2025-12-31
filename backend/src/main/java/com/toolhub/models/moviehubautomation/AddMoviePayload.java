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
        this.rootFolderPath = "/movies";
        this.minimumAvailability = "released";
        this.addOptions = new JsonObject().put("searchForMovie", true);
        this.title = lookUpResponse.getString("title");
        this.tmdbId = lookUpResponse.getInteger("tmdbId");
        this.qualityProfileId = QUALITY_PROFILE_MAP.getOrDefault(lookUpDTO.getQuality(), 4);
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
