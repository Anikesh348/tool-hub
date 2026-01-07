package com.toolhub.services.moviehubautomation.mediaclients;

import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;

public class GetSelectSeriesClient {

    private final String getSeriesUrl;
    private final WebClient webClient;
    private final String sonarrApiKey;
    public static GetSelectSeriesClient get(WebClient webClient, String sonarrBaseUrl, String sonarrApiKey) {
        return new GetSelectSeriesClient(webClient, sonarrBaseUrl, sonarrApiKey);
    }

    private GetSelectSeriesClient(WebClient webClient, String sonarrBaseUrl, String sonarrApiKey) {
        this.getSeriesUrl = sonarrBaseUrl + "/series/";
        this.webClient = webClient;
        this.sonarrApiKey = sonarrApiKey;
    }

    public Future<JsonObject> getSeriesDetails(Integer seriesId) {
        Promise<JsonObject> promise = Promise.promise();
        String url = getSeriesUrl + seriesId;
        webClient.getAbs(url)
                .putHeader("Authorization", "Bearer " + sonarrApiKey)
                .send()
                .onSuccess(res -> {
                    promise.complete(res.bodyAsJsonObject());
                }).onFailure(fail -> {
                    promise.fail(fail.getMessage());
                });
        return promise.future();
    }
}
