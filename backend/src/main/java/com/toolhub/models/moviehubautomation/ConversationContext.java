package com.toolhub.models.moviehubautomation;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.enums.moviehubautomation.MediaType;

public class ConversationContext {
    String conversationId;
    MediaState mediaState;
    Intent intent;
    long lastUpdated;
    boolean completed;

    public ConversationContext(String conversationId) {
        this.conversationId = conversationId;
        this.mediaState = new MediaState();
        this.intent = Intent.UNKNOWN;
        this.completed = false;
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

    public void reset() {
        this.intent = Intent.UNKNOWN;
        this.completed = false;
        this.mediaState.reset();
    }

}
