package com.toolhub.services.moviehubautomation.mediaclients;

import com.toolhub.models.moviehubautomation.GetSeriesResponse;
import com.toolhub.models.moviehubautomation.LookUpDTO;
import io.vertx.core.CompositeFuture;
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

    private Future<Void> downloadSeason(Integer seriesId, Integer seasonNumber, String title) {
        Promise<Void> promise = Promise.promise();
        try {
            JsonObject request = new JsonObject()
                    .put("name", "SeasonSearch")
                    .put("seasonNumber", seasonNumber)
                    .put("seriesId", seriesId);
            log.info("calling: {} with request: {}", downloadSeriesUrl, request);
            webClient.postAbs(downloadSeriesUrl)
                    .putHeader("x-api-key", apiKey)
                    .sendJsonObject(request)
                    .onSuccess(res -> {
                        int statusCode = res.statusCode();
                        if ((statusCode >= 200 && statusCode < 300) || statusCode == 409) {
                            log.info("Queued season {} for seriesId={} title={} status={}", seasonNumber, seriesId, title, statusCode);
                            promise.complete();
                            return;
                        }
                        String body = res.bodyAsString();
                        log.warn("Season search command failed status={} seriesId={} season={} title={} body={}",
                                statusCode, seriesId, seasonNumber, title, body);
                        promise.fail("Sonarr season search failed with status " + statusCode);
                    })
                    .onFailure(fail -> {
                        String msg = safeMessage(fail);
                        log.error("Error while queuing season {} for seriesId={} title={}: {}", seasonNumber, seriesId, title, msg, fail);
                        promise.fail(msg);
                    });
        } catch (Exception e) {
            String msg = safeMessage(e);
            log.error("Unexpected error building/starting request for season {} seriesId={} title={}: {}", seasonNumber, seriesId, title, msg, e);
            promise.fail(msg);
        }
        return promise.future();
    }

    private Future<Void> downloadSeries(Integer seriesId, String title) {
        Promise<Void> promise = Promise.promise();
        try {
            JsonObject request = new JsonObject()
                    .put("name", "SeriesSearch")
                    .put("seriesId", seriesId);
            log.info("calling: {} with request: {}", downloadSeriesUrl, request);
            webClient.postAbs(downloadSeriesUrl)
                    .putHeader("x-api-key", apiKey)
                    .sendJsonObject(request)
                    .onSuccess(res -> {
                        int statusCode = res.statusCode();
                        if ((statusCode >= 200 && statusCode < 300) || statusCode == 409) {
                            log.info("Queued series search for seriesId={} title={} status={}", seriesId, title, statusCode);
                            promise.complete();
                            return;
                        }
                        String body = res.bodyAsString();
                        log.warn("Series search command failed status={} seriesId={} title={} body={}",
                                statusCode, seriesId, title, body);
                        promise.fail("Sonarr series search failed with status " + statusCode);
                    })
                    .onFailure(fail -> {
                        String msg = safeMessage(fail);
                        log.error("Error while queuing series search for seriesId={} title={}: {}", seriesId, title, msg, fail);
                        promise.fail(msg);
                    });
        } catch (Exception e) {
            String msg = safeMessage(e);
            log.error("Unexpected error building/starting series search for seriesId={} title={}: {}", seriesId, title, msg, e);
            promise.fail(msg);
        }
        return promise.future();
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
            if (userSeasonRequest.isEmpty()) {
                log.info("No specific seasons requested for seriesId={} title={}; queueing full series search", seriesId, title);
                return downloadSeries(seriesId, title);
            }
            String msg = "These seasons already exist";
            log.info("No seasons to download for seriesId={} title={}: {}", seriesId, title, msg);
            downloadSeasonPromise.fail(msg);
            return downloadSeasonPromise.future();
        }

        List<Future> downloadCommands = new ArrayList<>();
        for (Integer season : seasonList) {
            try {
                if (season == null) {
                    log.warn("Skipping null season number for seriesId={} title={}", seriesId, title);
                    continue;
                }
                downloadCommands.add(downloadSeason(seriesId, season, title));
                log.debug("Requested queueing for season {} on seriesId={} title={}", season, seriesId, title);
            } catch (Exception e) {
                String msg = safeMessage(e);
                log.error("Failed to request download for season {} seriesId={} title={}: {}", season, seriesId, title, msg, e);
            }
        }

        if (downloadCommands.isEmpty()) {
            String msg = "No valid seasons requested";
            downloadSeasonPromise.fail(msg);
            return downloadSeasonPromise.future();
        }

        CompositeFuture.all(downloadCommands)
                .onSuccess(result -> downloadSeasonPromise.complete())
                .onFailure(fail -> downloadSeasonPromise.fail(safeMessage(fail)));
        return downloadSeasonPromise.future();
    }

    private String safeMessage(Throwable t) {
        if (t == null) return "Unknown error";
        if (t.getMessage() != null && !t.getMessage().isEmpty()) return t.getMessage();
        if (t.getCause() != null && t.getCause().getMessage() != null) return t.getCause().getMessage();
        return t.toString();
    }

}
