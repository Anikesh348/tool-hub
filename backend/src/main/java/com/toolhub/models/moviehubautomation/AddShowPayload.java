package com.toolhub.models.moviehubautomation;

import io.vertx.core.json.JsonObject;

public class AddShowPayload extends AddMediaPayload {

    Integer tvdbId;
    Boolean seasonFolder;

    public AddShowPayload(JsonObject lookUpResponse, LookUpDTO lookUpDTO) {
        super();
        this.rootFolderPath = "/tv";
        this.addOptions = new JsonObject()
                .put("monitor", "all")
                .put("searchForMissingEpisodes", false)
                .put("searchForCutoffUnmetEpisodes", false);
        this.tvdbId = lookUpResponse.getInteger("tvdbId");
        this.seasonFolder = true;
        this.qualityProfileId = QUALITY_PROFILE_MAP.getOrDefault(lookUpDTO.getQuality(), 4);
        this.title = lookUpResponse.getString("title");
    }

    public Integer getTvdbId() {
        return tvdbId;
    }

    public void setTvdbId(Integer tvdbId) {
        this.tvdbId = tvdbId;
    }

    public Boolean getSeasonFolder() {
        return seasonFolder;
    }

    public void setSeasonFolder(Boolean seasonFolder) {
        this.seasonFolder = seasonFolder;
    }
}
