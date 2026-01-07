// backend/src/main/java/com/pricedrop/models/moviehubautomation/LookUpDTO.java
package com.toolhub.models.moviehubautomation;

import com.toolhub.enums.moviehubautomation.MediaType;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LookUpDTO {
    private static final Logger log = LoggerFactory.getLogger(LookUpDTO.class);

    private String title;
    private MediaType mediaType;
    private String quality;
    private List<Integer> season;

    public List<Integer> getSeason() {
        return season;
    }

    public void setSeason(List<Integer> season) {
        this.season = season;
    }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public MediaType getMediaType() { return mediaType; }
    public void setMediaType(MediaType mediaType) { this.mediaType = mediaType; }
    public String getQuality() { return quality; }
    public void setQuality(String quality) { this.quality = quality; }
    private static String normalizeTitle(String title) {
        return title
                .trim()
                .replaceAll("\\s+", "+");
    }
    public static LookUpDTO fromJson(JsonObject json) throws IllegalArgumentException {
        List<String> errors = new ArrayList<>();
        if (json == null) {
            throw new IllegalArgumentException("request body is missing");
        }

        String title = json.getString("title");
        if (title == null || title.trim().isEmpty()) {
            errors.add("title must not be empty");
        }

        String mediaTypeRaw = json.getString("mediaType");
        MediaType mediaType = null;
        if (mediaTypeRaw == null || mediaTypeRaw.trim().isEmpty()) {
            errors.add("mediaType is required");
        } else {
            try {
                mediaType = MediaType.valueOf(mediaTypeRaw.trim().toUpperCase());
            } catch (Exception ex) {
                errors.add("mediaType must be one of: " + Arrays.toString(MediaType.values()));
            }
        }
        List<Integer> season = new ArrayList<>();
        if (MediaType.SHOWS.toString().equals(mediaTypeRaw)) {
            JsonArray seasonArr =  json.getJsonArray("season");
            if (seasonArr == null) {
                errors.add("season is required for media type: show");
            } else {
                seasonArr.forEach(s -> season.add(Integer.valueOf(s.toString())));
            }
        }

        String qualityProfileId = json.getString("qualityProfileId");
        if (!errors.isEmpty()) {
            throw new IllegalArgumentException(String.join("; ", errors));
        }


        LookUpDTO dto = new LookUpDTO();
        dto.setTitle(normalizeTitle(title));
        dto.setMediaType(mediaType);
        dto.setQuality(qualityProfileId);
        dto.setSeason(season);
        return dto;
    }
}
