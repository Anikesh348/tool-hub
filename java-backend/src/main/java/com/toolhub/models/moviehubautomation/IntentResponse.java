package com.toolhub.models.moviehubautomation;

import io.vertx.core.json.JsonArray;

public class IntentResponse {
  String message;
  JsonArray options;

  public String getMessage() {
    return message;
  }

  public void setMessage(String message) {
    this.message = message;
  }

  public JsonArray getOptions() {
    return options;
  }

  public void setOptions(JsonArray options) {
    this.options = options;
  }
}
