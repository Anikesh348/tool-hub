package com.toolhub.services.ytdownload;

import static com.toolhub.Utils.Constants.YT_DOWNLOADS_COLLECTION;
import static com.toolhub.Utils.Utility.buildResponse;
import static com.toolhub.Utils.Utility.createErrorResponse;
import static com.toolhub.Utils.Utility.createSuccessResponse;

import com.toolhub.services.alerts.MailService;
import com.toolhub.services.mongo.MongoDBClient;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.CompositeFuture;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import io.vertx.core.http.HttpClient;
import io.vertx.core.http.HttpMethod;
import io.vertx.core.http.RequestOptions;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class YtDownloadProxyService {
  private static final Logger log = LoggerFactory.getLogger(YtDownloadProxyService.class);
  private static final Set<String> HOP_BY_HOP_HEADERS =
      Set.of(
          "connection",
          "keep-alive",
          "proxy-authenticate",
          "proxy-authorization",
          "te",
          "trailer",
          "transfer-encoding",
          "upgrade");
  private static final String STATUS_REQUESTED = "REQUESTED";
  private static final String STATUS_DOWNLOADING = "DOWNLOADING";
  private static final String STATUS_DOWNLOADED = "DOWNLOADED";
  private static final String STATUS_FAILED = "FAILED";
  private static final Set<String> FAILED_STATUSES = Set.of("FAILED", "ERROR", "CANCELLED");

  private final WebClient webClient;
  private final HttpClient httpClient;
  private final MongoDBClient mongoDBClient;
  private final MailService mailService;
  private final String ytDownloadApiBaseUrl;
  private final String ytServerDownloadPath;
  private final String ytSongsDownloadPath;
  private final String jellyfinBaseUrl;
  private final String jellyfinApiKey;
  private final String ytJellyfinId;
  private final Deque<String> pendingQueue = new ConcurrentLinkedDeque<>();
  private final Set<String> queuedRequestIds = ConcurrentHashMap.newKeySet();
  private final AtomicBoolean startDispatchInProgress = new AtomicBoolean(false);

  public YtDownloadProxyService(
      WebClient webClient, Vertx vertx, MongoDBClient mongoDBClient, Dotenv dotenv) {
    this.webClient = webClient;
    this.httpClient = vertx.createHttpClient();
    this.mongoDBClient = mongoDBClient;
    this.mailService = new MailService(webClient);
    this.ytDownloadApiBaseUrl = sanitizeBaseUrl(dotenv.get("YT_DOWNLOAD_API_BASE_URL"));
    this.ytServerDownloadPath = dotenv.get("YT_DOWNLOAD_SERVER_PATH");
    this.ytSongsDownloadPath = dotenv.get("YT_DOWNLOAD_SONGS_PATH");
    this.jellyfinBaseUrl = sanitizeBaseUrl(dotenv.get("JELLYFIN_BASE_URL"));
    this.jellyfinApiKey = firstNonBlank(dotenv.get("JELLYFIN_API_KEY", ""));
    this.ytJellyfinId = firstNonBlank(dotenv.get("YT_JELLYFIN_ID", ""));
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
    webClient
        .postAbs(endpoint)
        .putHeader("Content-Type", "application/json")
        .sendJsonObject(payload)
        .onSuccess(
            upstreamRes -> {
              log.info(
                  "YT formats upstream response userId={} status={} contentType={}",
                  userId,
                  upstreamRes.statusCode(),
                  upstreamRes.getHeader("Content-Type"));
              context.response().setStatusCode(upstreamRes.statusCode());
              String contentType = upstreamRes.getHeader("Content-Type");
              if (contentType != null && !contentType.isBlank()) {
                context.response().putHeader("Content-Type", contentType);
              } else {
                context.response().putHeader("Content-Type", "application/json");
              }
              context.response().end(upstreamRes.bodyAsBuffer());
            })
        .onFailure(
            err -> {
              log.error("Failed to call YT formats API userId={} url={}", userId, url, err);
              buildResponse(
                  context, 502, createErrorResponse("failed to fetch formats from yt api"));
            });
  }

  public void handleAdd(RoutingContext context) {
    JsonObject payload = parseRequestBody(context);
    if (payload == null) {
      return;
    }
    String userId = context.get("userId");
    String videoId = payload.getString("videoId", "").trim();
    if (videoId.isBlank()) {
      buildResponse(context, 400, createErrorResponse("videoId is required"));
      return;
    }
    boolean isSong = payload.getBoolean("isSong", payload.getBoolean("is_song", false));
    String downloadPath;
    if (isSong) {
      downloadPath = ytSongsDownloadPath == null ? "" : ytSongsDownloadPath.trim();
      if (downloadPath.isBlank()) {
        buildResponse(
            context, 500, createErrorResponse("YT_DOWNLOAD_SONGS_PATH is not configured"));
        return;
      }
    } else {
      downloadPath = payload.getString("download_path", "").trim();
      if (downloadPath.isBlank()) {
        downloadPath = ytServerDownloadPath == null ? "" : ytServerDownloadPath.trim();
      }
      if (downloadPath.isBlank()) {
        buildResponse(context, 400, createErrorResponse("download_path is required"));
        return;
      }
    }
    final String resolvedDownloadPath = downloadPath;

    JsonObject format = payload.getJsonObject("format", new JsonObject());
    String quality = format.getString("quality", "").trim();
    if (quality.isBlank()) {
      buildResponse(context, 400, createErrorResponse("format.quality is required"));
      return;
    }
    String now = Instant.now().toString();
    String safeUserId = firstNonBlank(userId);
    JsonObject requestFormat =
        new JsonObject().put("quality", quality).put("ext", format.getString("ext", "mp4"));

    String userEmailFromClaim = context.get("userEmail");
    String userEmail = firstNonBlank(userEmailFromClaim, payload.getString("userEmail", ""));

    JsonObject duplicateCheckQuery = new JsonObject().put("videoId", videoId);
    mongoDBClient
        .queryRecords(duplicateCheckQuery, YT_DOWNLOADS_COLLECTION)
        .onSuccess(
            existingRequests -> {
              if (existingRequests != null && !existingRequests.isEmpty()) {
                JsonObject latestRecord =
                    existingRequests.stream()
                        .max(Comparator.comparing(existing -> existing.getString("createdAt", "")))
                        .orElse(existingRequests.getFirst());
                String existingRequestId = latestRecord.getString("requestId", "").trim();
                String existingStatus = latestRecord.getString("status", "UNKNOWN");
                if (STATUS_FAILED.equalsIgnoreCase(existingStatus)) {
                  if (existingRequestId.isBlank()) {
                    buildResponse(
                        context,
                        500,
                        createErrorResponse("failed request entry is missing requestId"));
                    return;
                  }
                  JsonObject update =
                      new JsonObject()
                          .put("videoId", videoId)
                          .put("url", payload.getString("url", ""))
                          .put("title", payload.getString("title", ""))
                          .put("filename", payload.getString("filename", ""))
                          .put("download_path", resolvedDownloadPath)
                          .put("isSong", isSong)
                          .put("format", requestFormat)
                          .put("status", STATUS_REQUESTED)
                          .put("downloadAlertSent", false)
                          .put("downloadAlertSentAt", null)
                          .put("startedAt", null)
                          .put("downloadedAt", null)
                          .put("movieHubRefreshTriggered", false)
                          .put("movieHubRefreshTriggeredAt", null)
                          .put("lastStatusPayload", null)
                          .put("lastStartResponse", null)
                          .put("error", null)
                          .put("startError", null)
                          .put("userId", safeUserId)
                          .put("userEmail", userEmail)
                          .put("updatedAt", now);

                  updateDownloadRecord(existingRequestId, update)
                      .onSuccess(
                          v -> {
                            enqueueRequest(existingRequestId);
                            buildResponse(
                                context,
                                200,
                                createSuccessResponse(
                                    new JsonObject()
                                        .put("message", "failed download request re-queued")
                                        .put("requestId", existingRequestId)
                                        .put("status", STATUS_REQUESTED)
                                        .put("videoId", videoId)));
                          })
                      .onFailure(
                          fail -> {
                            log.error(
                                "Failed to re-queue failed yt request requestId={} videoId={}",
                                existingRequestId,
                                videoId,
                                fail);
                            buildResponse(
                                context,
                                500,
                                createErrorResponse("failed to re-queue download request"));
                          });
                  return;
                }
                buildResponse(
                    context,
                    409,
                    createErrorResponse(
                        "download request already exists for this videoId (status: "
                            + existingStatus
                            + ")"));
                return;
              }
              String requestId = UUID.randomUUID().toString();
              JsonObject record =
                  new JsonObject()
                      .put("requestId", requestId)
                      .put("videoId", videoId)
                      .put("url", payload.getString("url", ""))
                      .put("title", payload.getString("title", ""))
                      .put("filename", payload.getString("filename", ""))
                      .put("download_path", resolvedDownloadPath)
                      .put("isSong", isSong)
                      .put("format", requestFormat)
                      .put("status", STATUS_REQUESTED)
                      .put("downloadAlertSent", false)
                      .put("userId", safeUserId)
                      .put("userEmail", userEmail)
                      .put("createdAt", now)
                      .put("updatedAt", now);
              mongoDBClient
                  .insertRecord(record, YT_DOWNLOADS_COLLECTION)
                  .onSuccess(
                      res -> {
                        enqueueRequest(requestId);
                        buildResponse(
                            context,
                            200,
                            createSuccessResponse(
                                new JsonObject()
                                    .put("message", "download request added")
                                    .put("requestId", requestId)
                                    .put("status", STATUS_REQUESTED)
                                    .put("videoId", videoId)));
                      })
                  .onFailure(
                      fail -> {
                        log.error(
                            "Failed to add yt download request requestId={} videoId={}",
                            requestId,
                            videoId,
                            fail);
                        buildResponse(
                            context, 500, createErrorResponse("failed to add download request"));
                      });
            })
        .onFailure(
            fail -> {
              log.error("Failed to check duplicate yt download request videoId={}", videoId, fail);
              buildResponse(
                  context, 500, createErrorResponse("failed to validate download request"));
            });
  }

  public void handleStart(RoutingContext context) {
    startDownloadFromQueue(context);
  }

  public void handleCronStart(RoutingContext context) {
    startDownloadFromQueue(context);
  }

  public void handleCheckAndUpdate(RoutingContext context) {
    if (!validateBaseUrl(context)) {
      return;
    }
    fetchDownloadsForStatusCheck()
        .compose(this::checkAndUpdateDownloads)
        .onSuccess(summary -> buildResponse(context, 200, createSuccessResponse(summary)))
        .onFailure(
            fail -> {
              log.error("Failed to run yt download status check", fail);
              buildResponse(
                  context, 500, createErrorResponse("failed to check yt download status"));
            });
  }

  public void handleListRequests(RoutingContext context) {
    mongoDBClient
        .queryRecords(new JsonObject(), YT_DOWNLOADS_COLLECTION)
        .onSuccess(
            records -> {
              List<JsonObject> sorted = new ArrayList<>(records);
              sorted.sort(
                  (a, b) -> b.getString("createdAt", "").compareTo(a.getString("createdAt", "")));
              buildResponse(
                  context, 200, createSuccessResponse(new JsonObject().put("requests", sorted)));
            })
        .onFailure(
            fail -> {
              log.error("Failed to fetch yt download requests", fail);
              buildResponse(
                  context, 500, createErrorResponse("failed to fetch yt download requests"));
            });
  }

  public void handleDeleteRequest(RoutingContext context) {
    String requestId = firstNonBlank(context.pathParam("requestId")).trim();
    if (requestId.isBlank()) {
      buildResponse(context, 400, createErrorResponse("requestId path param is required"));
      return;
    }

    fetchDownloadByRequestId(requestId)
        .onSuccess(
            record -> {
              if (record == null) {
                buildResponse(context, 404, createErrorResponse("download request not found"));
                return;
              }

              String status = record.getString("status", "");
              boolean allowedToDelete = !STATUS_DOWNLOADING.equalsIgnoreCase(status);
              if (!allowedToDelete) {
                buildResponse(
                    context,
                    409,
                    createErrorResponse(
                        "DOWNLOADING requests cannot be deleted (current status: "
                            + firstNonBlank(status, "UNKNOWN")
                            + ")"));
                return;
              }

              pendingQueue.remove(requestId);
              queuedRequestIds.remove(requestId);
              mongoDBClient
                  .deleteRecord(
                      new JsonObject().put("requestId", requestId), YT_DOWNLOADS_COLLECTION)
                  .onSuccess(
                      v ->
                          buildResponse(
                              context,
                              200,
                              createSuccessResponse(
                                  new JsonObject()
                                      .put("message", "download request deleted")
                                      .put("requestId", requestId))))
                  .onFailure(
                      fail -> {
                        String failMessage = fail == null ? "" : fail.getMessage();
                        if (failMessage != null
                            && failMessage.toLowerCase().contains("no matching")) {
                          buildResponse(
                              context, 404, createErrorResponse("download request not found"));
                          return;
                        }
                        log.error("Failed to delete yt request requestId={}", requestId, fail);
                        buildResponse(
                            context, 500, createErrorResponse("failed to delete download request"));
                      });
            })
        .onFailure(
            fail -> {
              log.error("Failed to fetch yt request for delete requestId={}", requestId, fail);
              buildResponse(context, 500, createErrorResponse("failed to delete download request"));
            });
  }

  public void handleListLibraryItems(RoutingContext context) {
    if (!validateJellyfinConfig(context)) {
      return;
    }

    int startIndex = parseNonNegativeInt(context.request().getParam("startIndex"), 0);
    int limit = parsePositiveInt(context.request().getParam("limit"), 100);
    String parentId = firstNonBlank(context.request().getParam("parentId"), ytJellyfinId).trim();
    if (parentId.isBlank()) {
      buildResponse(context, 500, createErrorResponse("YT_JELLYFIN_ID is not configured"));
      return;
    }

    String endpoint =
        jellyfinBaseUrl
            + "/Items?ParentId="
            + encodeQueryValue(parentId)
            + "&StartIndex="
            + startIndex
            + "&Limit="
            + limit
            + "&Fields=Path,SortName,ChildCount,MediaSourceCount"
            + "&SortBy=SortName"
            + "&SortOrder=Ascending";

    webClient
        .getAbs(endpoint)
        .putHeader("accept", "application/json")
        .putHeader("authorization", buildJellyfinAuthorizationHeader())
        .putHeader("X-Emby-Token", jellyfinApiKey)
        .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
        .putHeader("X-Api-Key", jellyfinApiKey)
        .send()
        .onSuccess(
            res -> {
              if (res.statusCode() < 200 || res.statusCode() >= 300) {
                log.error("Failed to list jellyfin yt library items status={}", res.statusCode());
                buildResponse(context, 502, createErrorResponse("failed to list yt library items"));
                return;
              }

              JsonObject payload = toJsonObjectSafe(res.bodyAsString());
              JsonArray items = payload.getJsonArray("Items", new JsonArray());
              buildResponse(
                  context,
                  200,
                  createSuccessResponse(
                      new JsonObject()
                          .put("items", items)
                          .put(
                              "totalRecordCount",
                              payload.getInteger("TotalRecordCount", items.size()))
                          .put("startIndex", payload.getInteger("StartIndex", startIndex))
                          .put("limit", limit)
                          .put("parentId", parentId)));
            })
        .onFailure(
            err -> {
              log.error("Failed to call jellyfin items endpoint for yt library", err);
              buildResponse(context, 502, createErrorResponse("failed to list yt library items"));
            });
  }

  public void handleDeleteLibraryItem(RoutingContext context) {
    if (!validateJellyfinConfig(context)) {
      return;
    }
    String itemId = firstNonBlank(context.pathParam("itemId")).trim();
    if (itemId.isBlank()) {
      buildResponse(context, 400, createErrorResponse("itemId path param is required"));
      return;
    }

    String endpoint = jellyfinBaseUrl + "/Items/" + encodeQueryValue(itemId);
    webClient
        .deleteAbs(endpoint)
        .putHeader("accept", "*/*")
        .putHeader("authorization", buildJellyfinAuthorizationHeader())
        .putHeader("X-Emby-Token", jellyfinApiKey)
        .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
        .putHeader("X-Api-Key", jellyfinApiKey)
        .send()
        .onSuccess(
            res -> {
              if (res.statusCode() < 200 || res.statusCode() >= 300) {
                log.error(
                    "Failed to delete jellyfin yt library item itemId={} status={}",
                    itemId,
                    res.statusCode());
                buildResponse(
                    context, 502, createErrorResponse("failed to delete yt library item"));
                return;
              }

              buildResponse(
                  context,
                  200,
                  createSuccessResponse(
                      new JsonObject()
                          .put("message", "yt library item deleted")
                          .put("itemId", itemId)));
            })
        .onFailure(
            err -> {
              log.error("Failed to call jellyfin delete item endpoint itemId={}", itemId, err);
              buildResponse(context, 502, createErrorResponse("failed to delete yt library item"));
            });
  }

  public void handleStatus(RoutingContext context) {
    if (!validateBaseUrl(context)) {
      return;
    }
    String videoId = context.pathParam("videoId");
    if (videoId == null || videoId.isBlank()) {
      buildResponse(context, 400, createErrorResponse("videoId path param is required"));
      return;
    }
    fetchDownloadStatus(videoId.trim())
        .onSuccess(payload -> buildResponse(context, 200, createSuccessResponse(payload)))
        .onFailure(
            fail -> {
              log.error("Failed to fetch yt status for videoId={}", videoId, fail);
              buildResponse(context, 502, createErrorResponse("failed to fetch yt status"));
            });
  }

  public void handleStatusStream(RoutingContext context) {
    if (!validateBaseUrl(context)) {
      return;
    }
    String videoId = context.pathParam("videoId");
    if (videoId == null || videoId.isBlank()) {
      buildResponse(context, 400, createErrorResponse("videoId path param is required"));
      return;
    }

    String endpoint = ytDownloadApiBaseUrl + "/api/download/status/stream/" + videoId.trim();
    RequestOptions options =
        new RequestOptions().setMethod(HttpMethod.GET).setAbsoluteURI(endpoint);

    httpClient
        .request(options)
        .onSuccess(
            upstreamReq -> {
              upstreamReq.putHeader("Accept", "text/event-stream");
              context
                  .response()
                  .exceptionHandler(
                      err -> {
                        if (!isBenignStreamClose(err)) {
                          log.warn(
                              "Downstream SSE response exception for videoId={}", videoId, err);
                        }
                      });
              upstreamReq
                  .send()
                  .onSuccess(
                      upstreamRes -> {
                        if (context.response().ended() || context.response().closed()) {
                          upstreamRes.request().reset();
                          return;
                        }
                        context.response().setStatusCode(upstreamRes.statusCode());
                        upstreamRes
                            .headers()
                            .forEach(
                                entry -> {
                                  if (!HOP_BY_HOP_HEADERS.contains(entry.getKey().toLowerCase())
                                      && !"content-length".equalsIgnoreCase(entry.getKey())) {
                                    context.response().putHeader(entry.getKey(), entry.getValue());
                                  }
                                });
                        if (context.response().headers().get("Content-Type") == null) {
                          context.response().putHeader("Content-Type", "text/event-stream");
                        }
                        context.response().setChunked(true);

                        context.response().closeHandler(v -> upstreamRes.request().reset());

                        upstreamRes.exceptionHandler(
                            err -> {
                              if (isBenignStreamClose(err)) {
                                return;
                              }
                              log.error(
                                  "Failed while streaming status SSE for videoId={}", videoId, err);
                              if (!context.response().ended() && !context.response().closed()) {
                                context.response().end();
                              }
                            });

                        upstreamRes.endHandler(
                            v -> {
                              if (!context.response().ended() && !context.response().closed()) {
                                context.response().end();
                              }
                            });

                        upstreamRes.handler(
                            chunk -> {
                              if (context.response().ended() || context.response().closed()) {
                                upstreamRes.request().reset();
                                return;
                              }
                              try {
                                if (context.response().writeQueueFull()) {
                                  upstreamRes.pause();
                                  context.response().drainHandler(done -> upstreamRes.resume());
                                }
                                context
                                    .response()
                                    .write(chunk)
                                    .onFailure(
                                        err -> {
                                          if (!isBenignStreamClose(err)) {
                                            log.error(
                                                "Failed to write SSE chunk for videoId={}",
                                                videoId,
                                                err);
                                          }
                                          upstreamRes.request().reset();
                                          if (!context.response().ended()
                                              && !context.response().closed()) {
                                            context.response().end();
                                          }
                                        });
                              } catch (Throwable err) {
                                if (!isBenignStreamClose(err)) {
                                  log.error(
                                      "Failed to write SSE chunk for videoId={}", videoId, err);
                                }
                                upstreamRes.request().reset();
                                if (!context.response().ended() && !context.response().closed()) {
                                  context.response().end();
                                }
                              }
                            });
                      })
                  .onFailure(
                      err -> {
                        if (isBenignStreamClose(err)
                            || context.response().closed()
                            || context.response().ended()) {
                          return;
                        }
                        log.error(
                            "Failed to call upstream status stream for videoId={}", videoId, err);
                        buildResponse(
                            context, 502, createErrorResponse("failed to call status stream"));
                      });
            })
        .onFailure(
            err -> {
              if (isBenignStreamClose(err)
                  || context.response().closed()
                  || context.response().ended()) {
                return;
              }
              log.error(
                  "Failed to initialize upstream status stream request for videoId={}",
                  videoId,
                  err);
              buildResponse(
                  context, 502, createErrorResponse("failed to initialize status stream request"));
            });
  }

  private boolean isBenignStreamClose(Throwable err) {
    if (err == null) {
      return false;
    }
    String typeName = err.getClass().getName().toLowerCase();
    if (typeName.contains("closedchannelexception")) {
      return true;
    }
    String message = firstNonBlank(err.getMessage()).toLowerCase();
    return message.contains("response has already been written")
        || message.contains("connection was closed")
        || message.contains("broken pipe")
        || message.contains("connection reset");
  }

  private void startDownloadFromQueue(RoutingContext context) {
    if (!validateBaseUrl(context)) {
      return;
    }
    if (!startDispatchInProgress.compareAndSet(false, true)) {
      buildResponse(
          context,
          200,
          createSuccessResponse(
              new JsonObject()
                  .put("message", "download dispatch already in progress")
                  .put("queued", pendingQueue.size())));
      return;
    }

    checkIfDownloadRunning()
        .compose(
            running -> {
              if (running) {
                return Future.succeededFuture(
                    new JsonObject()
                        .put("started", false)
                        .put("message", "your request will be downloaded")
                        .put("queued", pendingQueue.size()));
              }
              return fetchNextRequestedDownload()
                  .compose(
                      nextRequest -> {
                        if (nextRequest == null) {
                          return Future.succeededFuture(
                              new JsonObject()
                                  .put("started", false)
                                  .put("message", "no pending download request")
                                  .put("queued", 0));
                        }
                        String requestId = nextRequest.getString("requestId", "");
                        return triggerDownload(nextRequest)
                            .compose(
                                startResponse -> {
                                  JsonObject update =
                                      new JsonObject()
                                          .put("status", STATUS_DOWNLOADING)
                                          .put("downloadAlertSent", false)
                                          .put("startedAt", Instant.now().toString())
                                          .put("updatedAt", Instant.now().toString())
                                          .put("lastStartResponse", startResponse);
                                  return updateDownloadRecord(requestId, update)
                                      .map(
                                          new JsonObject()
                                              .put("started", true)
                                              .put("message", "download started")
                                              .put("requestId", requestId)
                                              .put("videoId", nextRequest.getString("videoId"))
                                              .put("status", STATUS_DOWNLOADING));
                                })
                            .recover(
                                fail -> {
                                  log.error(
                                      "Failed to trigger yt download for requestId={}",
                                      requestId,
                                      fail);
                                  if (!requestId.isBlank()) {
                                    enqueueRequestFront(requestId);
                                  }
                                  JsonObject update =
                                      new JsonObject()
                                          .put("status", STATUS_REQUESTED)
                                          .put("updatedAt", Instant.now().toString())
                                          .put("startError", fail.getMessage());
                                  Future<Void> recordUpdate =
                                      requestId.isBlank()
                                          ? Future.succeededFuture()
                                          : updateDownloadRecord(requestId, update);
                                  return recordUpdate
                                      .recover(
                                          updateFail -> {
                                            log.error(
                                                "Failed to reset request status after start failure requestId={}",
                                                requestId,
                                                updateFail);
                                            return Future.succeededFuture();
                                          })
                                      .map(
                                          new JsonObject()
                                              .put("started", false)
                                              .put("message", "failed to start download")
                                              .put("error", fail.getMessage()));
                                });
                      });
            })
        .onComplete(
            ar -> {
              startDispatchInProgress.set(false);
              if (ar.succeeded()) {
                buildResponse(context, 200, createSuccessResponse(ar.result()));
              } else {
                log.error("Failed to start yt download flow", ar.cause());
                buildResponse(context, 500, createErrorResponse("failed to start yt download"));
              }
            });
  }

  private boolean validateBaseUrl(RoutingContext context) {
    if (ytDownloadApiBaseUrl == null || ytDownloadApiBaseUrl.isBlank()) {
      buildResponse(
          context, 500, createErrorResponse("YT_DOWNLOAD_API_BASE_URL is not configured"));
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

  private void enqueueRequest(String requestId) {
    if (requestId == null || requestId.isBlank()) {
      return;
    }
    if (queuedRequestIds.add(requestId)) {
      pendingQueue.addLast(requestId);
    }
  }

  private void enqueueRequestFront(String requestId) {
    if (requestId == null || requestId.isBlank()) {
      return;
    }
    if (queuedRequestIds.add(requestId)) {
      pendingQueue.addFirst(requestId);
    }
  }

  private Future<Boolean> checkIfDownloadRunning() {
    String endpoint = ytDownloadApiBaseUrl + "/api/download/running";
    Promise<Boolean> promise = Promise.promise();
    webClient
        .getAbs(endpoint)
        .send()
        .onSuccess(
            res -> {
              if (res.statusCode() < 200 || res.statusCode() >= 300) {
                promise.fail("running check failed with status " + res.statusCode());
                return;
              }
              JsonObject body = toJsonObjectSafe(res.bodyAsString());
              promise.complete(parseRunningResponse(body));
            })
        .onFailure(promise::fail);
    return promise.future();
  }

  private Future<JsonObject> fetchNextRequestedDownload() {
    Promise<JsonObject> promise = Promise.promise();
    fetchNextRequestedDownloadFromQueue(promise, 0);
    return promise.future();
  }

  private void fetchNextRequestedDownloadFromQueue(
      Promise<JsonObject> promise, int inspectedCount) {
    String requestId = pendingQueue.pollFirst();
    if (requestId == null || requestId.isBlank()) {
      fetchOldestRequestedFromDb().onSuccess(promise::complete).onFailure(promise::fail);
      return;
    }
    queuedRequestIds.remove(requestId);
    fetchDownloadByRequestId(requestId)
        .onSuccess(
            record -> {
              if (record == null) {
                fetchNextRequestedDownloadFromQueue(promise, inspectedCount + 1);
                return;
              }
              String status = record.getString("status", "");
              if (!STATUS_REQUESTED.equalsIgnoreCase(status)) {
                fetchNextRequestedDownloadFromQueue(promise, inspectedCount + 1);
                return;
              }
              promise.complete(record);
            })
        .onFailure(promise::fail);
  }

  private Future<JsonObject> fetchOldestRequestedFromDb() {
    Promise<JsonObject> promise = Promise.promise();
    mongoDBClient
        .queryRecords(new JsonObject().put("status", STATUS_REQUESTED), YT_DOWNLOADS_COLLECTION)
        .onSuccess(
            records -> {
              if (records == null || records.isEmpty()) {
                promise.complete(null);
                return;
              }
              JsonObject oldest =
                  records.stream()
                      .min(Comparator.comparing(record -> record.getString("createdAt", "")))
                      .orElse(records.getFirst());
              String requestId = oldest.getString("requestId");
              if (requestId != null && !requestId.isBlank()) {
                pendingQueue.remove(requestId);
                queuedRequestIds.remove(requestId);
              }
              promise.complete(oldest);
            })
        .onFailure(fail -> promise.fail(fail.getMessage()));
    return promise.future();
  }

  private Future<JsonObject> fetchDownloadByRequestId(String requestId) {
    Promise<JsonObject> promise = Promise.promise();
    if (requestId == null || requestId.isBlank()) {
      promise.complete(null);
      return promise.future();
    }
    mongoDBClient
        .queryRecords(new JsonObject().put("requestId", requestId), YT_DOWNLOADS_COLLECTION)
        .onSuccess(
            records -> {
              if (records == null || records.isEmpty()) {
                promise.complete(null);
                return;
              }
              promise.complete(records.getFirst());
            })
        .onFailure(fail -> promise.fail(fail.getMessage()));
    return promise.future();
  }

  private Future<JsonObject> triggerDownload(JsonObject requestRecord) {
    Promise<JsonObject> promise = Promise.promise();
    String endpoint = ytDownloadApiBaseUrl + "/api/download";
    JsonObject requestPayload =
        new JsonObject()
            .put("videoId", requestRecord.getString("videoId"))
            .put("download_path", requestRecord.getString("download_path"))
            .put("progress_updates", false)
            .put("format", requestRecord.getJsonObject("format", new JsonObject()));
    String filename = requestRecord.getString("filename", "").trim();
    if (!filename.isBlank()) {
      requestPayload.put("filename", filename);
    }

    webClient
        .postAbs(endpoint)
        .putHeader("Content-Type", "application/json")
        .putHeader("Accept", "application/json")
        .sendJsonObject(requestPayload)
        .onSuccess(
            res -> {
              if (res.statusCode() < 200 || res.statusCode() >= 300) {
                promise.fail("download trigger failed with status " + res.statusCode());
                return;
              }
              JsonObject responsePayload = toJsonObjectSafe(res.bodyAsString());
              promise.complete(
                  new JsonObject()
                      .put("statusCode", res.statusCode())
                      .put("body", responsePayload));
            })
        .onFailure(promise::fail);
    return promise.future();
  }

  private Future<Void> updateDownloadRecord(String requestId, JsonObject setPayload) {
    JsonObject query = new JsonObject().put("requestId", requestId);
    JsonObject update = new JsonObject().put("$set", setPayload);
    return mongoDBClient.updateRecord(query, update, YT_DOWNLOADS_COLLECTION);
  }

  private Future<List<JsonObject>> fetchDownloadsForStatusCheck() {
    JsonObject query =
        new JsonObject()
            .put("status", STATUS_DOWNLOADING)
            .put(
                "$or",
                new JsonArray()
                    .add(new JsonObject().put("downloadAlertSent", false))
                    .add(
                        new JsonObject()
                            .put("downloadAlertSent", new JsonObject().put("$exists", false))));
    return mongoDBClient.queryRecords(query, YT_DOWNLOADS_COLLECTION);
  }

  private Future<JsonObject> checkAndUpdateDownloads(List<JsonObject> downloads) {
    Promise<JsonObject> promise = Promise.promise();
    JsonObject summary =
        new JsonObject()
            .put("total", downloads == null ? 0 : downloads.size())
            .put("checked", 0)
            .put("downloaded", 0)
            .put("failed", 0)
            .put("emailSent", 0)
            .put("movieHubRefreshTriggered", 0)
            .put("stillDownloading", 0);
    if (downloads == null || downloads.isEmpty()) {
      promise.complete(summary);
      return promise.future();
    }
    processDownloadChecks(downloads, 0, summary, promise);
    return promise.future();
  }

  private void processDownloadChecks(
      List<JsonObject> downloads, int idx, JsonObject summary, Promise<JsonObject> promise) {
    if (idx >= downloads.size()) {
      promise.complete(summary);
      return;
    }
    JsonObject record = downloads.get(idx);
    processSingleDownloadCheck(record, summary)
        .onComplete(res -> processDownloadChecks(downloads, idx + 1, summary, promise));
  }

  private Future<Void> processSingleDownloadCheck(JsonObject record, JsonObject summary) {
    String videoId = record.getString("videoId", "").trim();
    String requestId = record.getString("requestId", "");
    summary.put("checked", summary.getInteger("checked", 0) + 1);
    if (videoId.isBlank()) {
      JsonObject update =
          new JsonObject()
              .put("status", STATUS_FAILED)
              .put("updatedAt", Instant.now().toString())
              .put("error", "missing videoId for tracking");
      summary.put("failed", summary.getInteger("failed", 0) + 1);
      return updateDownloadRecord(requestId, update).recover(fail -> Future.succeededFuture());
    }

    return fetchDownloadStatus(videoId)
        .compose(
            statusPayload -> {
              if (isCompletedStatus(statusPayload)) {
                summary.put("downloaded", summary.getInteger("downloaded", 0) + 1);
                return markDownloadedAndAlert(record, statusPayload, summary);
              }
              if (isFailedStatus(statusPayload)) {
                summary.put("failed", summary.getInteger("failed", 0) + 1);
                return markFailed(record, statusPayload);
              }
              summary.put("stillDownloading", summary.getInteger("stillDownloading", 0) + 1);
              return Future.succeededFuture();
            })
        .recover(
            fail -> {
              log.error(
                  "Failed while checking status for requestId={} videoId={}",
                  requestId,
                  videoId,
                  fail);
              return Future.succeededFuture();
            });
  }

  private Future<JsonObject> fetchDownloadStatus(String videoId) {
    Promise<JsonObject> promise = Promise.promise();
    String endpoint = ytDownloadApiBaseUrl + "/api/download/status/" + videoId;
    webClient
        .getAbs(endpoint)
        .putHeader("Accept", "application/json")
        .send()
        .onSuccess(
            res -> {
              if (res.statusCode() < 200 || res.statusCode() >= 300) {
                promise.fail("status check failed with status " + res.statusCode());
                return;
              }
              promise.complete(toJsonObjectSafe(res.bodyAsString()));
            })
        .onFailure(promise::fail);
    return promise.future();
  }

  private Future<Void> markDownloadedAndAlert(
      JsonObject record, JsonObject statusPayload, JsonObject summary) {
    String requestId = record.getString("requestId", "");
    String title =
        firstNonBlank(
            statusPayload.getString("title", ""),
            record.getString("title", ""),
            record.getString("videoId", "Unknown Video"));
    String userEmail = record.getString("userEmail", "").trim();
    Future<Boolean> sendMailFuture;
    if (userEmail.isBlank()) {
      sendMailFuture = Future.succeededFuture(false);
    } else {
      sendMailFuture =
          sendDownloadedEmail(userEmail, title)
              .map(true)
              .recover(
                  fail -> {
                    log.error("Failed to send yt download email for requestId={}", requestId, fail);
                    return Future.succeededFuture(false);
                  });
    }
    Future<Boolean> refreshFuture =
        triggerMovieHubLibraryRefresh()
            .map(true)
            .recover(
                fail -> {
                  log.error(
                      "Failed to trigger moviehub library refresh for requestId={}",
                      requestId,
                      fail);
                  return Future.succeededFuture(false);
                });

    return CompositeFuture.all(sendMailFuture, refreshFuture)
        .compose(
            result -> {
              boolean emailSent = result.resultAt(0);
              boolean refreshTriggered = result.resultAt(1);
              if (emailSent) {
                summary.put("emailSent", summary.getInteger("emailSent", 0) + 1);
              }
              if (refreshTriggered) {
                summary.put(
                    "movieHubRefreshTriggered",
                    summary.getInteger("movieHubRefreshTriggered", 0) + 1);
              }
              JsonObject update =
                  new JsonObject()
                      .put("status", STATUS_DOWNLOADED)
                      .put("title", title)
                      .put("downloadAlertSent", emailSent)
                      .put("downloadAlertSentAt", emailSent ? Instant.now().toString() : null)
                      .put("movieHubRefreshTriggered", refreshTriggered)
                      .put(
                          "movieHubRefreshTriggeredAt",
                          refreshTriggered ? Instant.now().toString() : null)
                      .put("downloadedAt", Instant.now().toString())
                      .put("updatedAt", Instant.now().toString())
                      .put("lastStatusPayload", statusPayload);
              return updateDownloadRecord(requestId, update);
            });
  }

  private Future<Void> triggerMovieHubLibraryRefresh() {
    if (jellyfinBaseUrl == null || jellyfinBaseUrl.isBlank()) {
      return Future.failedFuture("JELLYFIN_BASE_URL is not configured");
    }
    if (jellyfinApiKey == null || jellyfinApiKey.isBlank()) {
      return Future.failedFuture("JELLYFIN_API_KEY is not configured");
    }
    if (ytJellyfinId == null || ytJellyfinId.isBlank()) {
      return Future.failedFuture("YT_JELLYFIN_ID is not configured");
    }

    String endpoint =
        jellyfinBaseUrl
            + "/Items/"
            + ytJellyfinId
            + "/Refresh?Recursive=true&ImageRefreshMode=Default&MetadataRefreshMode=Default"
            + "&ReplaceAllImages=false&RegenerateTrickplay=false&ReplaceAllMetadata=false";

    Promise<Void> promise = Promise.promise();
    webClient
        .postAbs(endpoint)
        .putHeader("accept", "*/*")
        .putHeader("authorization", buildJellyfinAuthorizationHeader())
        .putHeader("X-Emby-Token", jellyfinApiKey)
        .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
        .putHeader("X-Api-Key", jellyfinApiKey)
        .send()
        .onSuccess(
            res -> {
              if (res.statusCode() >= 200 && res.statusCode() < 300) {
                log.info(
                    "Triggered moviehub library refresh itemId={} status={}",
                    ytJellyfinId,
                    res.statusCode());
                promise.complete();
                return;
              }
              promise.fail("moviehub refresh failed with status " + res.statusCode());
            })
        .onFailure(promise::fail);
    return promise.future();
  }

  private Future<Void> markFailed(JsonObject record, JsonObject statusPayload) {
    String requestId = record.getString("requestId", "");
    JsonObject update =
        new JsonObject()
            .put("status", STATUS_FAILED)
            .put("updatedAt", Instant.now().toString())
            .put("lastStatusPayload", statusPayload)
            .put(
                "error",
                firstNonBlank(
                    statusPayload.getString("error", ""),
                    statusPayload.getString("message", ""),
                    "download failed"));
    return updateDownloadRecord(requestId, update);
  }

  private Future<Void> sendDownloadedEmail(String userEmail, String title) {
    String subject = "YouTube download completed: " + title;
    String htmlBody =
        """
                <html>
                  <body style="font-family: Arial, sans-serif; line-height:1.6; color:#1f2937;">
                    <h3 style="margin-bottom: 8px;">Download Completed</h3>
                    <p>Your requested YouTube download is complete.</p>
                    <p><strong>Title:</strong> %s</p>
                  </body>
                </html>
                """
            .formatted(title);
    return mailService.sendEmail(subject, userEmail, htmlBody);
  }

  private boolean parseRunningResponse(JsonObject payload) {
    if (payload == null || payload.isEmpty()) {
      return false;
    }
    if (payload.getValue("running") instanceof Boolean running) {
      return running;
    }
    return true;
  }

  private boolean isCompletedStatus(JsonObject payload) {
    if (payload == null || payload.isEmpty()) {
      return false;
    }
    return payload.getString("status", "").equalsIgnoreCase("downloaded")
        && payload.getString("phase", "").equalsIgnoreCase("completed");
  }

  private boolean isFailedStatus(JsonObject payload) {
    if (payload == null || payload.isEmpty()) {
      return false;
    }
    if (payload.containsKey("error")
        && payload.getString("error") != null
        && !payload.getString("error").isBlank()) {
      return true;
    }
    String event = payload.getString("event", "").trim().toUpperCase();
    if ("ERROR".equals(event)) {
      return true;
    }
    String status = payload.getString("status", "").trim().toUpperCase();
    return FAILED_STATUSES.contains(status);
  }

  private boolean validateJellyfinConfig(RoutingContext context) {
    if (jellyfinBaseUrl == null || jellyfinBaseUrl.isBlank()) {
      buildResponse(context, 500, createErrorResponse("JELLYFIN_BASE_URL is not configured"));
      return false;
    }
    if (jellyfinApiKey == null || jellyfinApiKey.isBlank()) {
      buildResponse(context, 500, createErrorResponse("JELLYFIN_API_KEY is not configured"));
      return false;
    }
    return true;
  }

  private int parseNonNegativeInt(String value, int fallback) {
    if (value == null || value.isBlank()) {
      return fallback;
    }
    try {
      int parsed = Integer.parseInt(value.trim());
      return Math.max(0, parsed);
    } catch (NumberFormatException ignored) {
      return fallback;
    }
  }

  private int parsePositiveInt(String value, int fallback) {
    int parsed = parseNonNegativeInt(value, fallback);
    return parsed <= 0 ? fallback : parsed;
  }

  private String encodeQueryValue(String value) {
    if (value == null) {
      return "";
    }
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  private String firstNonBlank(String... candidates) {
    if (candidates == null) {
      return "";
    }
    for (String candidate : candidates) {
      if (candidate != null && !candidate.isBlank()) {
        return candidate;
      }
    }
    return "";
  }

  private String buildJellyfinAuthorizationHeader() {
    return "MediaBrowser Client=\"ToolHub\", Device=\"ToolHub\", DeviceId=\"toolhub-web\", Version=\"10.11.6\", Token=\""
        + jellyfinApiKey
        + "\"";
  }

  private JsonObject toJsonObjectSafe(String payload) {
    if (payload == null || payload.isBlank()) {
      return new JsonObject();
    }
    try {
      return new JsonObject(payload);
    } catch (Exception ignored) {
      return new JsonObject().put("raw", payload);
    }
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
