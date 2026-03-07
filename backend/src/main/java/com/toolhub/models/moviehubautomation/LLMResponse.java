package com.toolhub.models.moviehubautomation;


import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.enums.moviehubautomation.MediaType;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class LLMResponse {
    Payload payload;
    String clarification;
    Intent intent;
    String summary;
    Query query;

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public Query getQuery() {
        return query;
    }

    public void setQuery(Query query) {
        this.query = query;
    }

    public Payload getPayload() {
        return payload;
    }

    public Intent getIntent() {
        return intent;
    }

    public void setIntent(Intent intent) {
        this.intent = intent;
    }

    public void setPayload(Payload payload) {
        this.payload = payload;
    }

    public String getClarification() {
        return clarification;
    }

    public void setClarification(String clarification) {
        this.clarification = clarification;
    }
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Payload {
        String title;
        MediaType mediaType;
        String quality;
        List<Integer> season;

        public List<Integer> getSeason() {
            return season;
        }

        public void setSeason(List<Integer> season) {
            this.season = season;
        }

        public String getTitle() {
            return title;
        }

        public void setTitle(String title) {
            this.title = title;
        }

        public MediaType getMediaType() {
            return mediaType;
        }

        public void setMediaType(MediaType mediaType) {
            this.mediaType = mediaType;
        }

        public String getQuality() {
            return quality;
        }

        public void setQuality(String quality) {
            this.quality = quality;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Query {
        String title;
        MediaType mediaType;
        String scope;

        public String getTitle() {
            return title;
        }

        public void setTitle(String title) {
            this.title = title;
        }

        public MediaType getMediaType() {
            return mediaType;
        }

        public void setMediaType(MediaType mediaType) {
            this.mediaType = mediaType;
        }

        public String getScope() {
            return scope;
        }

        public void setScope(String scope) {
            this.scope = scope;
        }
    }
}
