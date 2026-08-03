package com.toolhub.models.moviehubautomation;

import com.toolhub.enums.moviehubautomation.Intent;
import io.vertx.core.json.JsonArray;

public class ConversationContext {
  String conversationId;
  MediaState mediaState;
  Intent intent;
  long lastUpdated;
  boolean completed;
  boolean awaitingSelection;
  JsonArray selectionOptions;
  String userId;
  String userRole;

  public ConversationContext(String conversationId) {
    this.conversationId = conversationId;
    this.mediaState = new MediaState();
    this.intent = Intent.UNKNOWN;
    this.completed = false;
    this.awaitingSelection = false;
    this.selectionOptions = new JsonArray();
    this.userId = "";
    this.userRole = "";
  }

  public String getConversationId() {
    return conversationId;
  }

  public void setConversationId(String conversationId) {
    this.conversationId = conversationId;
  }

  public MediaState getMediaState() {
    return mediaState;
  }

  public void setMediaState(MediaState mediaState) {
    this.mediaState = mediaState;
  }

  public Intent getIntent() {
    return intent;
  }

  public void setIntent(Intent intent) {
    this.intent = intent;
  }

  public long getLastUpdated() {
    return lastUpdated;
  }

  public void setLastUpdated(long lastUpdated) {
    this.lastUpdated = lastUpdated;
  }

  public boolean isCompleted() {
    return completed;
  }

  public void setCompleted(boolean completed) {
    this.completed = completed;
  }

  public boolean isAwaitingSelection() {
    return awaitingSelection;
  }

  public void setAwaitingSelection(boolean awaitingSelection) {
    this.awaitingSelection = awaitingSelection;
  }

  public JsonArray getSelectionOptions() {
    return selectionOptions;
  }

  public void setSelectionOptions(JsonArray selectionOptions) {
    this.selectionOptions = selectionOptions;
  }

  public String getUserId() {
    return userId;
  }

  public void setUserId(String userId) {
    this.userId = userId;
  }

  public String getUserRole() {
    return userRole;
  }

  public void setUserRole(String userRole) {
    this.userRole = userRole;
  }

  public void reset() {
    this.intent = Intent.UNKNOWN;
    this.completed = false;
    this.mediaState.reset();
    this.awaitingSelection = false;
    this.selectionOptions = new JsonArray();
  }
}
