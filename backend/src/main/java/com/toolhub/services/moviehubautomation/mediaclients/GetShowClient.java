package com.toolhub.services.moviehubautomation.mediaclients;

import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GetShowClient {

    private static final Logger log = LoggerFactory.getLogger(GetShowClient.class);

    private final WebClient webClient;
    private final String getSeriesUrl;
    private final String sonarrApiKey;
    public static GetShowClient get(WebClient webClient, String sonarrApiUrl, String sonarrApiKey) {
        return new GetShowClient(webClient, sonarrApiUrl, sonarrApiKey);
    }

    public GetShowClient(WebClient webClient, String sonarrApiUrl, String sonarrApiKey) {
        this.webClient = webClient;
        this.sonarrApiKey = sonarrApiKey;
        this.getSeriesUrl = sonarrApiUrl + "/series";
    }

    public Future<JsonArray> getSeries() {
        Promise<JsonArray> getSeriesPromise = Promise.promise();
        log.debug("Requesting series list from Sonarr: {}", getSeriesUrl);
        webClient.getAbs(getSeriesUrl)
                .putHeader("Authorization", "Bearer " + sonarrApiKey)
                .send()
                .onSuccess(res -> {
                    int statusCode = res.statusCode();
                    if (statusCode >= 200 && statusCode < 300) {
                        try {
                            JsonArray series = res.bodyAsJsonArray();
                            log.debug("Fetched {} series entries from Sonarr", series.size());
                            getSeriesPromise.complete(series);
                        } catch (Exception e) {
                            String msg = safeMessage(e);
                            log.error("Failed to parse series response from Sonarr: {}", msg, e);
                            getSeriesPromise.fail(msg);
                        }
                    } else {
                        String body = null;
                        try { body = res.bodyAsString(); } catch (Exception ignored) {}
                        String msg = String.format("Unexpected response from Sonarr: status=%d body=%s", statusCode, body);
                        log.error(msg);
                        getSeriesPromise.fail(msg);
                    }
                }).onFailure(fail -> {
                    String msg = safeMessage(fail);
                    log.error("HTTP error while fetching series from Sonarr: {}", msg, fail);
                    getSeriesPromise.fail(msg);
                });
        return getSeriesPromise.future();
    }

    private String safeMessage(Throwable t) {
        if (t == null) return "Unknown error";
        if (t.getMessage() != null && !t.getMessage().isEmpty()) return t.getMessage();
        if (t.getCause() != null && t.getCause().getMessage() != null) return t.getCause().getMessage();
        return t.toString();
    }
}
