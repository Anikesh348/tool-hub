package com.toolhub.services.moviehubautomation.mediaclients;

import com.toolhub.models.moviehubautomation.GetSeriesResponse;
import com.toolhub.models.moviehubautomation.LookUpDTO;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

public class ShowDownloadClient {
    private static final Logger log = LoggerFactory.getLogger(ShowDownloadClient.class);
    private final WebClient webClient;
    private final String downloadSeriesUrl;
    private final String apiKey;

    public static ShowDownloadClient get(WebClient webClient, String apiKey, String apiBaseUrl) {
        return new ShowDownloadClient(webClient, apiKey, apiBaseUrl);
    }

    private ShowDownloadClient(WebClient webClient, String apiKey, String apiBaseUrl) {
        String path = "/command";
        this.downloadSeriesUrl = apiBaseUrl + path;
        this.apiKey = apiKey;
        this.webClient = webClient;
    }

    private void downloadSeason(Integer seriesId, Integer seasonNumber, String title) {
        try {
            JsonObject request = new JsonObject()
                    .put("name", "SeasonSearch")
                    .put("seasonNumber", seasonNumber)
                    .put("seriesId", seriesId);
            log.info("calling: {} with request: {}", downloadSeriesUrl, request);
            webClient.postAbs(downloadSeriesUrl)
                    .putHeader("Authorization", "Bearer " + apiKey)
                    .sendJsonObject(request)
                    .onSuccess(res -> log.info("Queued season {} for seriesId={} title={}", seasonNumber, seriesId, title))
                    .onFailure(fail -> {
                        String msg = safeMessage(fail);
                        log.error("Error while queuing season {} for seriesId={} title={}: {}", seasonNumber, seriesId, title, msg, fail);
                    });
        } catch (Exception e) {
            String msg = safeMessage(e);
            log.error("Unexpected error building/starting request for season {} seriesId={} title={}: {}", seasonNumber, seriesId, title, msg, e);
        }
    }

    public Future<Void> downloadSeasons(LookUpDTO lookUpDTO, GetSeriesResponse getSeriesResponse, Integer seriesId) {
        Promise<Void> downloadSeasonPromise = Promise.promise();
        String title = lookUpDTO == null ? "" : lookUpDTO.getTitle();
        log.debug("downloadSeasons called title={} seriesId={}", title, seriesId);

        List<Integer> userSeasonRequest = (lookUpDTO == null || lookUpDTO.getSeason() == null) ? List.of() : lookUpDTO.getSeason();
        List<Integer> seasonList = new ArrayList<>(userSeasonRequest);

        if (getSeriesResponse != null && getSeriesResponse.getSeason() != null) {
            try {
                List<Integer> filtered = new ArrayList<>();
                for (GetSeriesResponse.Season season : getSeriesResponse.getSeason()) {
                    if (season == null) continue;
                    Integer seasonNum = season.getSeasonNumber();
                    if (seasonNum == null) continue;
                    if (!userSeasonRequest.contains(seasonNum)) continue;

                    Integer fileCount = season.getStatistics() == null ? null : season.getStatistics().getEpisodeFileCount();
                    Integer episodeCount = season.getStatistics() == null ? null : season.getStatistics().getEpisodeCount();

                    boolean needsDownload;
                    if (fileCount == null || episodeCount == null) {
                        needsDownload = true;
                    } else {
                        needsDownload = !fileCount.equals(episodeCount);
                    }

                    if (needsDownload) {
                        filtered.add(seasonNum);
                    } else {
                        log.debug("Skipping season {} for seriesId={} title={} because files={} episodes={}", seasonNum, seriesId, title, fileCount, episodeCount);
                    }
                }
                seasonList = filtered;
            } catch (Exception e) {
                String msg = safeMessage(e);
                log.error("Error while filtering seasons for download for seriesId={} title={}: {}", seriesId, title, msg, e);
                downloadSeasonPromise.fail(msg);
                return downloadSeasonPromise.future();
            }
        }

        if (seasonList.isEmpty()) {
            String msg = "These seasons already exists or no seasons requested";
            log.info("No seasons to download for seriesId={} title={}: {}", seriesId, title, msg);
            downloadSeasonPromise.fail(msg);
            return downloadSeasonPromise.future();
        }

        // async download - keep original completion behavior but add logs and guard per-call
        downloadSeasonPromise.complete();

        for (Integer season : seasonList) {
            try {
                if (season == null) {
                    log.warn("Skipping null season number for seriesId={} title={}", seriesId, title);
                    continue;
                }
                // preserve original argument order to avoid changing external behavior
                downloadSeason(seriesId, season, title);
                log.debug("Requested queueing for season {} on seriesId={} title={}", season, seriesId, title);
            } catch (Exception e) {
                String msg = safeMessage(e);
                log.error("Failed to request download for season {} seriesId={} title={}: {}", season, seriesId, title, msg, e);
            }
        }

        return downloadSeasonPromise.future();
    }

    private String safeMessage(Throwable t) {
        if (t == null) return "Unknown error";
        if (t.getMessage() != null && !t.getMessage().isEmpty()) return t.getMessage();
        if (t.getCause() != null && t.getCause().getMessage() != null) return t.getCause().getMessage();
        return t.toString();
    }

}
