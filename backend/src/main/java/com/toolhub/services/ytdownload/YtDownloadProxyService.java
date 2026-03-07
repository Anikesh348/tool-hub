package com.toolhub.services.ytdownload;

import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.buffer.Buffer;
import io.vertx.core.http.HttpClient;
import io.vertx.core.http.HttpMethod;
import io.vertx.core.http.RequestOptions;
import io.vertx.core.json.JsonObject;
import io.vertx.core.Vertx;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Set;

import static com.toolhub.Utils.Utility.buildResponse;
import static com.toolhub.Utils.Utility.createErrorResponse;

public class YtDownloadProxyService {
    private static final Logger log = LoggerFactory.getLogger(YtDownloadProxyService.class);
    private static final Set<String> HOP_BY_HOP_HEADERS = Set.of(
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade"
    );

    private final WebClient webClient;
    private final HttpClient httpClient;
    private final String ytDownloadApiBaseUrl;
    private final String ytServerDownloadPath;

    public YtDownloadProxyService(WebClient webClient, Vertx vertx, Dotenv dotenv) {
        this.webClient = webClient;
        this.httpClient = vertx.createHttpClient();
        this.ytDownloadApiBaseUrl = sanitizeBaseUrl(dotenv.get("YT_DOWNLOAD_API_BASE_URL"));
        this.ytServerDownloadPath = dotenv.get("YT_DOWNLOAD_SERVER_PATH");
    }

    public void handleFormats(RoutingContext context) {
        JsonObject payload = parseRequestBody(context);
        if (payload == null) {
            return;
        }
        String userId = context.get("userId");
        String url = payload.getString("url", "");
        log.info("YT formats request received userId={} url={}", userId, url);
        if (!validateUrl(context, payload)) {
            return;
        }
        if (!validateBaseUrl(context)) {
            return;
        }

        String endpoint = ytDownloadApiBaseUrl + "/api/formats";
        webClient.postAbs(endpoint)
                .putHeader("Content-Type", "application/json")
                .sendJsonObject(payload)
                .onSuccess(upstreamRes -> {
                    log.info("YT formats upstream response userId={} status={} contentType={}",
                            userId, upstreamRes.statusCode(), upstreamRes.getHeader("Content-Type"));
                    context.response().setStatusCode(upstreamRes.statusCode());
                    String contentType = upstreamRes.getHeader("Content-Type");
                    if (contentType != null && !contentType.isBlank()) {
                        context.response().putHeader("Content-Type", contentType);
                    } else {
                        context.response().putHeader("Content-Type", "application/json");
                    }
                    context.response().end(upstreamRes.bodyAsBuffer());
                })
                .onFailure(err -> {
                    log.error("Failed to call YT formats API userId={} url={}", userId, url, err);
                    buildResponse(context, 502, createErrorResponse("failed to fetch formats from yt api"));
                });
    }

    public void handleDownloadStream(RoutingContext context) {
        JsonObject payload = parseRequestBody(context);
        if (payload == null) {
            return;
        }
        String userId = context.get("userId");
        String url = payload.getString("url", "");
        log.info("YT stream download request received userId={} url={}", userId, url);
        if (!validateUrl(context, payload)) {
            return;
        }
        if (!validateBaseUrl(context)) {
            return;
        }

        // Stream route always streams file bytes back to client.
        payload.remove("download_path");
        payload.remove("progress_updates");
        proxyDownload(context, payload, false, "download-stream");
    }

    public void handleDownloadToServer(RoutingContext context) {
        JsonObject payload = parseRequestBody(context);
        if (payload == null) {
            return;
        }
        String userId = context.get("userId");
        String url = payload.getString("url", "");
        log.info("YT server download request received userId={} url={}", userId, url);
        if (!validateUrl(context, payload)) {
            return;
        }
        if (!validateBaseUrl(context)) {
            return;
        }

        String downloadPath = payload.getString("download_path");
        if (downloadPath == null || downloadPath.isBlank()) {
            if (ytServerDownloadPath == null || ytServerDownloadPath.isBlank()) {
                log.error("YT server download path missing userId={} url={}", userId, url);
                buildResponse(context, 500, createErrorResponse("YT_DOWNLOAD_SERVER_PATH is not configured"));
                return;
            }
            payload.put("download_path", ytServerDownloadPath);
            log.info("YT server download path defaulted userId={} path={}", userId, ytServerDownloadPath);
        }

        if (!payload.containsKey("progress_updates")) {
            payload.put("progress_updates", true);
        }

        boolean progressUpdates = payload.getBoolean("progress_updates", true);
        log.info("YT server download dispatch userId={} progress_updates={} download_path={} quality={} ext={}",
                userId,
                progressUpdates,
                payload.getString("download_path", ""),
                payload.getJsonObject("format", new JsonObject()).getString("quality", ""),
                payload.getJsonObject("format", new JsonObject()).getString("ext", "mp4"));
        proxyDownload(context, payload, progressUpdates, "download-server");
    }

    private void proxyDownload(RoutingContext context, JsonObject payload, boolean preferSse, String operation) {
        String endpoint = ytDownloadApiBaseUrl + "/api/download";
        String userId = context.get("userId");
        log.info("YT proxy request start operation={} userId={} endpoint={} preferSse={}",
                operation, userId, endpoint, preferSse);

        RequestOptions options = new RequestOptions()
                .setMethod(HttpMethod.POST)
                .setAbsoluteURI(endpoint);

        httpClient.request(options)
                .onSuccess(upstreamReq -> {
                    upstreamReq.putHeader("Content-Type", "application/json");
                    String inboundAccept = context.request().getHeader("Accept");
                    if (inboundAccept != null && !inboundAccept.isBlank()) {
                        upstreamReq.putHeader("Accept", inboundAccept);
                    } else if (preferSse) {
                        upstreamReq.putHeader("Accept", "text/event-stream");
                    }

                    upstreamReq.send(Buffer.buffer(payload.encode()))
                            .onSuccess(upstreamRes -> {
                                log.info("YT proxy upstream connected operation={} userId={} status={} contentType={}",
                                        operation, userId, upstreamRes.statusCode(), upstreamRes.getHeader("Content-Type"));
                                context.response().setStatusCode(upstreamRes.statusCode());
                                upstreamRes.headers().forEach(entry -> {
                                    if (!HOP_BY_HOP_HEADERS.contains(entry.getKey().toLowerCase())
                                            && !"content-length".equalsIgnoreCase(entry.getKey())) {
                                        context.response().putHeader(entry.getKey(), entry.getValue());
                                    }
                                });
                                context.response().setChunked(true);
                                if (preferSse && context.response().headers().get("Content-Type") == null) {
                                    context.response().putHeader("Content-Type", "text/event-stream");
                                }

                                upstreamRes.pipeTo(context.response())
                                        .onSuccess(v -> log.info("YT proxy stream completed operation={} userId={}",
                                                operation, userId))
                                        .onFailure(err -> {
                                            log.error("Failed while streaming YT download response operation={} userId={}",
                                                    operation, userId, err);
                                            if (!context.response().ended()) {
                                                context.response().end();
                                            }
                                        });
                            })
                            .onFailure(err -> {
                                log.error("Failed to call YT download API operation={} userId={}",
                                        operation, userId, err);
                                buildResponse(context, 502, createErrorResponse("failed to call yt download api"));
                            });
                })
                .onFailure(err -> {
                    log.error("Failed to initialize request to YT download API operation={} userId={}",
                            operation, userId, err);
                    buildResponse(context, 502, createErrorResponse("failed to initialize yt download request"));
                });
    }

    private boolean validateBaseUrl(RoutingContext context) {
        if (ytDownloadApiBaseUrl == null || ytDownloadApiBaseUrl.isBlank()) {
            buildResponse(context, 500, createErrorResponse("YT_DOWNLOAD_API_BASE_URL is not configured"));
            return false;
        }
        return true;
    }

    private boolean validateUrl(RoutingContext context, JsonObject payload) {
        String url = payload.getString("url");
        if (url == null || url.isBlank()) {
            buildResponse(context, 400, createErrorResponse("url is required"));
            return false;
        }
        return true;
    }

    private JsonObject parseRequestBody(RoutingContext context) {
        JsonObject payload = context.body().asJsonObject();
        if (payload == null) {
            buildResponse(context, 400, createErrorResponse("request body must be a valid json object"));
            return null;
        }
        return payload.copy();
    }

    private String sanitizeBaseUrl(String baseUrl) {
        if (baseUrl == null) {
            return null;
        }
        String trimmed = baseUrl.trim();
        if (trimmed.endsWith("/")) {
            return trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }
}
