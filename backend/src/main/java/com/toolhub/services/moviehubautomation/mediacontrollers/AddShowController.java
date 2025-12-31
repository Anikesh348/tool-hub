package com.toolhub.services.moviehubautomation.mediacontrollers;

import com.toolhub.Utils.Utility;
import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.models.moviehubautomation.AddShowPayload;
import com.toolhub.models.moviehubautomation.GetSeriesResponse;
import com.toolhub.models.moviehubautomation.LookUpDTO;
import com.toolhub.services.moviehubautomation.mediaclients.AddMediaClient;
import com.toolhub.services.moviehubautomation.mediaclients.GetShowClient;
import com.toolhub.services.moviehubautomation.mediaclients.LookUpClient;
import com.toolhub.services.moviehubautomation.mediaclients.ShowDownloadClient;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.atomic.AtomicInteger;

public class AddShowController implements AddMediaController {

    private static final Logger log = LoggerFactory.getLogger(AddShowController.class);

    private final String sonarrBaseUrl;
    private final String sonarrApiKey;
    private final LookUpClient lookUpClient;
    private final WebClient webClient;
    private final String addShow = "/series";
    public AddShowController(WebClient webClient, String sonarrBaseUrl, String sonarrApiKey) {
        this.webClient = webClient;
        this.sonarrBaseUrl = sonarrBaseUrl;
        this.sonarrApiKey = sonarrApiKey;
        String lookUpPath = "/series/lookup";
        this.lookUpClient = LookUpClient.get(webClient, sonarrApiKey, sonarrBaseUrl + lookUpPath);
    }

    @Override
    public MediaType get() {
        return MediaType.SHOWS;
    }

    private void downloadShow(LookUpDTO lookUpDTO, GetSeriesResponse getSeriesResponse, Integer seriesId,
                              Promise<Void> addContentPromise) {
        log.info("Starting download for seriesId={} title={}", seriesId, lookUpDTO.getTitle());
        ShowDownloadClient
                .get(webClient, sonarrApiKey, sonarrBaseUrl)
                .downloadSeasons(lookUpDTO, getSeriesResponse, seriesId)
                .onSuccess(res -> {
                    log.info("Successfully queued downloads for seriesId={} title={}", seriesId, lookUpDTO.getTitle());
                    addContentPromise.complete();
                }).onFailure(fail -> {
                    String msg = safeMessage(fail);
                    log.error("Failed to queue downloads for seriesId={} title={}: {}", seriesId, lookUpDTO.getTitle(), msg, fail);
                    addContentPromise.fail(msg);
                });
    }

    @Override
    public Future<Void> addContent(LookUpDTO lookUpDTO) {
        Promise<Void> addContentPromise = Promise.promise();
        log.debug("addContent called for title={} seasons={}", lookUpDTO.getTitle(), lookUpDTO.getSeason());
        lookUpClient.callLookUpUrl(lookUpDTO.getTitle()).onSuccess(lookUpResponse -> {
            log.debug("Lookup successful for title={}", lookUpDTO.getTitle());
            try {
                Integer tvdbId = lookUpResponse.getInteger("tvdbId");
                AddShowPayload addShowPayload = new AddShowPayload(lookUpResponse, lookUpDTO);
                GetShowClient.get(webClient, sonarrBaseUrl, sonarrApiKey).getSeries()
                        .onSuccess(seriesRes -> {
                            try {
                                JsonObject neededSeries = seriesRes.stream()
                                        .map(obj -> new JsonObject(obj.toString()))
                                        .filter(series -> tvdbId.equals(series.getInteger("tvdbId")))
                                        .findFirst()
                                        .orElse(null);
                                AtomicInteger seriesId = new AtomicInteger();
                                if (neededSeries == null) {
                                    log.info("Series not found in Sonarr for tvdbId={} title={}. Adding series.", tvdbId, lookUpDTO.getTitle());
                                    // add series
                                    AddMediaClient
                                            .add(webClient, sonarrBaseUrl + addShow,
                                                    sonarrApiKey, addShowPayload)
                                            .onSuccess(addMediaResp -> {
                                                try {
                                                    seriesId.set(addMediaResp.getInteger("id"));
                                                    log.info("Added series to Sonarr: title={} id={}", lookUpDTO.getTitle(), seriesId.get());
                                                    downloadShow(lookUpDTO, null, seriesId.get(), addContentPromise);
                                                } catch (Exception e) {
                                                    String msg = safeMessage(e);
                                                    log.error("Error handling addMediaResp for title={}: {}", lookUpDTO.getTitle(), msg, e);
                                                    addContentPromise.fail(msg);
                                                }
                                            }).onFailure(addSeriesFail -> {
                                        String msg = safeMessage(addSeriesFail);
                                        log.error("Failed to add series for title={} : {}", lookUpDTO.getTitle(), msg, addSeriesFail);
                                        addContentPromise.fail(msg);
                                    });
                                } else {
                                    GetSeriesResponse getSeriesResponse = Utility.castToClass(neededSeries, GetSeriesResponse.class);
                                    seriesId.set(getSeriesResponse.getId());
                                    log.info("Series already exists in Sonarr: title={} id={}", lookUpDTO.getTitle(), seriesId.get());
                                    downloadShow(lookUpDTO, getSeriesResponse, seriesId.get(), addContentPromise);
                                }
                            } catch (Exception e) {
                                String msg = safeMessage(e);
                                log.error("Error processing series list for title={}: {}", lookUpDTO.getTitle(), msg, e);
                                addContentPromise.fail(msg);
                            }
                        }).onFailure(seriesFail -> {
                    String msg = safeMessage(seriesFail);
                    log.error("Failed to fetch series list from Sonarr for title={}: {}", lookUpDTO.getTitle(), msg, seriesFail);
                    addContentPromise.fail(msg);
                });
            } catch (Exception e) {
                String msg = safeMessage(e);
                log.error("Unexpected error while preparing add payload for title={}: {}", lookUpDTO.getTitle(), msg, e);
                addContentPromise.fail(msg);
            }
        }).onFailure(lookUpFail -> {
            String msg = safeMessage(lookUpFail);
            log.error("Lookup failed for title={}: {}", lookUpDTO.getTitle(), msg, lookUpFail);
            addContentPromise.fail(msg);
        });
        return addContentPromise.future();
    }

    private String safeMessage(Throwable t) {
        if (t == null) return "Unknown error";
        if (t.getMessage() != null && !t.getMessage().isEmpty()) return t.getMessage();
        if (t.getCause() != null && t.getCause().getMessage() != null) return t.getCause().getMessage();
        return t.toString();
    }
}
