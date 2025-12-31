package com.toolhub.models.moviehubautomation;

import com.toolhub.enums.moviehubautomation.MediaType;

import java.util.ArrayList;
import java.util.List;

public class MediaState {
    String title;
    String quality;
    MediaType mediaType;
    List<Integer> season;

    public void reset() {
        this.title = "";
        this.quality = "";
        this.mediaType = MediaType.UNKNOWN;
        this.season = new ArrayList<>();
    }

    public MediaState() {
        this.title = "";
        this.quality = "";
        this.mediaType = MediaType.UNKNOWN;
        this.season = new ArrayList<>();
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getQuality() {
        return quality;
    }

    public void setQuality(String quality) {
        this.quality = quality;
    }

    public MediaType getMediaType() {
        return mediaType;
    }

    public void setMediaType(MediaType mediaType) {
        this.mediaType = mediaType;
    }

    public List<Integer> getSeason() {
        return season;
    }

    public void setSeason(List<Integer> season) {
        this.season = season;
    }
}
