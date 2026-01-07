package com.toolhub.services.moviehubautomation.mediaclients;

import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LookUpClient {
    private static final Logger log = LoggerFactory.getLogger(LookUpClient.class);
    private final WebClient client;
    private final String apiKey;
    private final String apiUrl;

    public static LookUpClient get(WebClient client, String apikey, String apiUrl) {
        return new LookUpClient(client, apikey, apiUrl);
    }

    public LookUpClient(WebClient client, String apiKey, String apiUrl) {
        this.client = client;
        this.apiKey = apiKey;
        this.apiUrl = apiUrl;
        log.debug("LookUpClient initialized with apiUrl={}", apiUrl);
    }

    public Future<JsonObject> callLookUpUrl(String lookupQuery) {
        Promise<JsonObject> lookupPromise = Promise.promise();
        log.debug("callLookUpUrl called with query={}", lookupQuery);
        log.info("logging api url {}", apiUrl);
        try {
            client.getAbs(apiUrl)
                    .addQueryParam("term", lookupQuery)
                    .putHeader("x-api-key", apiKey)
                    .send().onSuccess(res -> {
                        int statusCode = res.statusCode();
                        log.debug("Lookup response received with statusCode={} for query={}", statusCode, lookupQuery);
                        if (statusCode >= 200 && statusCode < 300) {
                            try {
                                JsonArray arrResponse = res.bodyAsJsonArray();
                                if (!arrResponse.isEmpty()) {
                                    log.info("Lookup successful for query={}, found {} result(s)", lookupQuery, arrResponse.size());
                                    lookupPromise.complete(res.bodyAsJsonArray().getJsonObject(0));
                                } else {
                                    log.warn("Lookup returned empty results for query={}", lookupQuery);
                                    lookupPromise.fail("failure while looking up for the content");
                                }
                            } catch(Exception processingException) {
                                String errorMsg = processingException.getCause() != null ? processingException.getCause().getMessage() : processingException.getMessage();
                                log.error("Exception while processing lookup response for query={}: {}", lookupQuery, errorMsg);
                                lookupPromise.fail(errorMsg);
                            }
                        } else {
                            log.warn("Lookup returned non-success status {} for query={}: {}", statusCode, lookupQuery, res.bodyAsString());
                            lookupPromise.fail(res.bodyAsString());
                        }
                    }).onFailure(fail -> {
                        log.error("Lookup request failed for query={}: {}", lookupQuery, fail.getMessage());
                        lookupPromise.fail(fail.getMessage());
                    });
        } catch (Exception e) {
            String errorMsg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
            log.error("Exception while making lookup request for query={}: {}", lookupQuery, errorMsg);
            lookupPromise.fail(errorMsg);
        }
        return lookupPromise.future();
    }

}
