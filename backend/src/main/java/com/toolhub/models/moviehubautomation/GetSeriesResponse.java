package com.toolhub.models.moviehubautomation;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
@JsonIgnoreProperties(ignoreUnknown = true)
public class GetSeriesResponse {

    String title;
    List<Season> season;
    Integer id;

    public Integer getId() {
        return id;
    }

    public void setId(Integer id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public List<Season> getSeason() {
        return season;
    }

    public void setSeason(List<Season> season) {
        this.season = season;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Season {
        Integer seasonNumber;
        boolean monitored;
        Statistics statistics;

        public Integer getSeasonNumber() {
            return seasonNumber;
        }

        public void setSeasonNumber(Integer seasonNumber) {
            this.seasonNumber = seasonNumber;
        }

        public boolean isMonitored() {
            return monitored;
        }

        public void setMonitored(boolean monitored) {
            this.monitored = monitored;
        }

        public Statistics getStatistics() {
            return statistics;
        }

        public void setStatistics(Statistics statistics) {
            this.statistics = statistics;
        }
    }
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Statistics {
        Integer episodeFileCount;
        Integer episodeCount;

        public Integer getEpisodeFileCount() {
            return episodeFileCount;
        }

        public void setEpisodeFileCount(Integer episodeFileCount) {
            this.episodeFileCount = episodeFileCount;
        }

        public Integer getEpisodeCount() {
            return episodeCount;
        }

        public void setEpisodeCount(Integer episodeCount) {
            this.episodeCount = episodeCount;
        }
    }


}
