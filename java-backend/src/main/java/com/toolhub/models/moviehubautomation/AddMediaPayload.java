package com.toolhub.models.moviehubautomation;

import io.vertx.core.json.JsonObject;
import java.util.HashMap;
import java.util.Map;

public abstract class AddMediaPayload {
  protected static final int DEFAULT_QUALITY_PROFILE_ID = 1;

  protected String title;
  protected Integer qualityProfileId;
  protected String rootFolderPath;
  protected Boolean monitored;
  protected JsonObject addOptions;

  protected static final Map<String, Integer> QUALITY_PROFILE_MAP =
      new HashMap<String, Integer>() {
        {
          put("any", 1);
          put("720", 3);
          put("1080p", 4);
          put("720p", 3);
          put("1080", 4);
          put("4k", 5);
          put("2160p", 5);
          put("uhd", 5);
          put("ultra-hd", 5);
        }
      };

  public AddMediaPayload() {
    this.monitored = true;
  }

  // Getters and Setters
  public String getTitle() {
    return title;
  }

  public void setTitle(String title) {
    this.title = title;
  }

  public Integer getQualityProfileId() {
    return qualityProfileId;
  }

  public void setQualityProfileId(Integer qualityProfileId) {
    this.qualityProfileId = qualityProfileId;
  }

  public String getRootFolderPath() {
    return rootFolderPath;
  }

  public void setRootFolderPath(String rootFolderPath) {
    this.rootFolderPath = rootFolderPath;
  }

  public Boolean getMonitored() {
    return monitored;
  }

  public void setMonitored(Boolean monitored) {
    this.monitored = monitored;
  }

  public JsonObject getAddOptions() {
    return addOptions;
  }

  public void setAddOptions(JsonObject addOptions) {
    this.addOptions = addOptions;
  }
}
