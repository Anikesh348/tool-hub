package com.toolhub.services.moviehubautomation.portal;

import com.toolhub.Utils.Utility;
import com.toolhub.enums.moviehubautomation.MediaRequestStatus;
import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.models.moviehubautomation.LookUpDTO;
import com.toolhub.models.moviehubautomation.MediaDownloadRequest;
import com.toolhub.services.alerts.MailService;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.moviehubautomation.mediaclients.LookUpClient;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddMediaControllerFactory;
import com.toolhub.enums.user.Role;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.CompositeFuture;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static com.toolhub.Utils.Constants.MEDIA_REQUESTS_COLLECTION;
import static com.toolhub.Utils.Constants.USER_COLLECTION;

public class MovieHubRequestPortalService {

    private static final Logger log = LoggerFactory.getLogger(MovieHubRequestPortalService.class);
    private static final String DEFAULT_QUALITY_PROFILE = "any";
    private static final String DOWNLOAD_SCOPE_MINE = "mine";
    private static final String DOWNLOAD_SCOPE_ALL = "all";
    private static final Set<String> ALLOWED_QUALITY_PROFILES = Set.of("any", "720p", "1080p");

    private final MongoDBClient mongoDBClient;
    private final AddMediaControllerFactory addMediaControllerFactory;
    private final LookUpClient movieLookupClient;
    private final LookUpClient showLookupClient;
    private final WebClient webClient;
    private final String radarrMovieListUrl;
    private final String sonarrSeriesListUrl;
    private final String radarrQueueUrl;
    private final String sonarrQueueUrl;
    private final String radarrCommandUrl;
    private final String sonarrCommandUrl;
    private final String radarrApiKey;
    private final String sonarrApiKey;

    public MovieHubRequestPortalService(MongoDBClient mongoDBClient,
                                        AddMediaControllerFactory addMediaControllerFactory,
                                        WebClient webClient,
                                        String radarrBaseUrl,
                                        String radarrApiKey,
                                        String sonarrBaseUrl,
                                        String sonarrApiKey) {
        this.mongoDBClient = mongoDBClient;
        this.addMediaControllerFactory = addMediaControllerFactory;
        this.webClient = webClient;
        this.radarrApiKey = radarrApiKey;
        this.sonarrApiKey = sonarrApiKey;
        this.radarrMovieListUrl = radarrBaseUrl + "/movie";
        this.sonarrSeriesListUrl = sonarrBaseUrl + "/series";
        this.radarrQueueUrl = radarrBaseUrl + "/queue";
        this.sonarrQueueUrl = sonarrBaseUrl + "/queue";
        this.radarrCommandUrl = radarrBaseUrl + "/command";
        this.sonarrCommandUrl = sonarrBaseUrl + "/command";
        this.movieLookupClient = LookUpClient.get(webClient, radarrApiKey, radarrBaseUrl + "/movie/lookup");
        this.showLookupClient = LookUpClient.get(webClient, sonarrApiKey, sonarrBaseUrl + "/series/lookup");
    }

    public void handleSearch(RoutingContext context) {
        String term = context.request().getParam("term");
        MediaType mediaType = parseMediaType(context.request().getParam("mediaType"));
        if (term == null || term.trim().isEmpty()) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse("term query param is required"));
            return;
        }
        if (mediaType == MediaType.UNKNOWN) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse("mediaType must be MOVIES or SHOWS"));
            return;
        }
        LookUpClient lookUpClient = mediaType == MediaType.MOVIES ? movieLookupClient : showLookupClient;
        lookUpClient.callLookUpUrlList(term.trim())
                .onSuccess(results -> {
                    JsonArray normalized = normalizeLookupResults(results, mediaType);
                    Utility.buildResponse(context, 200, Utility.createSuccessResponse(normalized));
                }).onFailure(fail -> {
                    log.error("Lookup failed for term={} mediaType={}", term, mediaType, fail);
                    Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
                });
    }

    public Future<JsonArray> getTopLookupOptions(String term, MediaType mediaType, int limit) {
        if (term == null || term.trim().isEmpty()) {
            return Future.failedFuture("title is required");
        }
        if (mediaType == null || MediaType.UNKNOWN.equals(mediaType)) {
            return Future.failedFuture("mediaType must be MOVIES or SHOWS");
        }
        LookUpClient lookUpClient = mediaType == MediaType.MOVIES ? movieLookupClient : showLookupClient;
        return lookUpClient.callLookUpUrlList(term.trim()).map(results -> {
            JsonArray normalized = normalizeLookupResults(results, mediaType);
            int effectiveLimit = limit <= 0 ? normalized.size() : Math.min(limit, normalized.size());
            JsonArray topOptions = new JsonArray();
            for (int i = 0; i < effectiveLimit; i++) {
                topOptions.add(normalized.getJsonObject(i));
            }
            return topOptions;
        });
    }

    public Future<JsonObject> createRequestFromAutomation(String userId, LookUpDTO lookUpDTO) {
        if (userId == null || userId.isBlank()) {
            return Future.failedFuture("userId is required");
        }
        if (lookUpDTO == null) {
            return Future.failedFuture("media request payload is required");
        }
        MediaType mediaType = lookUpDTO.getMediaType();
        if (mediaType == null || MediaType.UNKNOWN.equals(mediaType)) {
            return Future.failedFuture("mediaType must be MOVIES or SHOWS");
        }
        String title = lookUpDTO.getTitle();
        if (title == null || title.trim().isEmpty()) {
            return Future.failedFuture("title is required");
        }
        String qualityProfileId = normalizeQualityProfileId(lookUpDTO.getQuality());
        List<Integer> seasons = normalizeSeasonList(lookUpDTO.getSeason());
        if (MediaType.SHOWS.equals(mediaType) && seasons.isEmpty()) {
            return Future.failedFuture("season is required for mediaType SHOWS");
        }
        ParsedCreateRequest parsedCreateRequest = new ParsedCreateRequest(
                title.trim(),
                mediaType,
                qualityProfileId,
                seasons
        );

        return validateAvailabilityBeforeCreate(parsedCreateRequest)
                .compose(conflictMessage -> {
                    if (conflictMessage != null && !conflictMessage.isBlank()) {
                        return Future.failedFuture(conflictMessage);
                    }
                    return fetchUserById(userId);
                })
                .compose(user -> {
                    Instant now = Instant.now();
                    MediaDownloadRequest mediaDownloadRequest = new MediaDownloadRequest();
                    mediaDownloadRequest.setRequestId(UUID.randomUUID().toString());
                    mediaDownloadRequest.setUserId(userId);
                    mediaDownloadRequest.setUserEmail(user.getString("email"));
                    mediaDownloadRequest.setUserName(user.getString("name", user.getString("userName", "")));
                    mediaDownloadRequest.setTitle(parsedCreateRequest.title());
                    mediaDownloadRequest.setMediaType(parsedCreateRequest.mediaType());
                    mediaDownloadRequest.setQualityProfileId(parsedCreateRequest.qualityProfileId());
                    mediaDownloadRequest.setSeason(parsedCreateRequest.season());
                    mediaDownloadRequest.setStatus(MediaRequestStatus.PENDING);
                    mediaDownloadRequest.setCreatedAt(now);
                    mediaDownloadRequest.setUpdatedAt(now);
                    return mongoDBClient.insertRecord(JsonObject.mapFrom(mediaDownloadRequest), MEDIA_REQUESTS_COLLECTION)
                            .map(new JsonObject()
                                    .put("message", "request created")
                                    .put("requestId", mediaDownloadRequest.getRequestId())
                                    .put("status", mediaDownloadRequest.getStatus().name()));
                });
    }

    public Future<JsonObject> createApprovedRequestFromAutomation(String adminUserId, LookUpDTO lookUpDTO) {
        if (adminUserId == null || adminUserId.isBlank()) {
            return Future.failedFuture("adminUserId is required");
        }
        if (lookUpDTO == null) {
            return Future.failedFuture("media request payload is required");
        }
        MediaType mediaType = lookUpDTO.getMediaType();
        if (mediaType == null || MediaType.UNKNOWN.equals(mediaType)) {
            return Future.failedFuture("mediaType must be MOVIES or SHOWS");
        }
        String title = lookUpDTO.getTitle();
        if (title == null || title.trim().isEmpty()) {
            return Future.failedFuture("title is required");
        }
        String qualityProfileId = normalizeQualityProfileId(lookUpDTO.getQuality());
        List<Integer> seasons = normalizeSeasonList(lookUpDTO.getSeason());
        if (MediaType.SHOWS.equals(mediaType) && seasons.isEmpty()) {
            return Future.failedFuture("season is required for mediaType SHOWS");
        }

        return fetchUserById(adminUserId)
                .compose(user -> {
                    Instant now = Instant.now();
                    MediaDownloadRequest mediaDownloadRequest = new MediaDownloadRequest();
                    mediaDownloadRequest.setRequestId(UUID.randomUUID().toString());
                    mediaDownloadRequest.setUserId(adminUserId);
                    mediaDownloadRequest.setUserEmail(user.getString("email"));
                    mediaDownloadRequest.setUserName(user.getString("name", user.getString("userName", "")));
                    mediaDownloadRequest.setTitle(title.trim());
                    mediaDownloadRequest.setMediaType(mediaType);
                    mediaDownloadRequest.setQualityProfileId(qualityProfileId);
                    mediaDownloadRequest.setSeason(seasons);
                    mediaDownloadRequest.setStatus(MediaRequestStatus.APPROVED);
                    mediaDownloadRequest.setApprovedBy(adminUserId);
                    mediaDownloadRequest.setApprovedAt(now);
                    mediaDownloadRequest.setCreatedAt(now);
                    mediaDownloadRequest.setUpdatedAt(now);
                    return mongoDBClient.insertRecord(JsonObject.mapFrom(mediaDownloadRequest), MEDIA_REQUESTS_COLLECTION)
                            .compose(v -> sendApprovalEmail(mediaDownloadRequest)
                                    .onSuccess(mailRes -> markNotificationSent(mediaDownloadRequest.getRequestId()))
                                    .map(new JsonObject()
                                            .put("message", "approved request tracking created")
                                            .put("requestId", mediaDownloadRequest.getRequestId())
                                            .put("status", mediaDownloadRequest.getStatus().name())
                                            .put("notification", "sent"))
                                    .recover(mailFail -> {
                                        log.error("Failed to send approval email for admin automation requestId={}",
                                                mediaDownloadRequest.getRequestId(), mailFail);
                                        return Future.succeededFuture(new JsonObject()
                                                .put("message", "approved request tracking created")
                                                .put("requestId", mediaDownloadRequest.getRequestId())
                                                .put("status", mediaDownloadRequest.getStatus().name())
                                                .put("notification", "failed"));
                                    }));
                });
    }

    public void handleCreateRequest(RoutingContext context) {
        try {
            JsonObject body = context.body().asJsonObject();
            if (body == null) {
                Utility.buildResponse(context, 400, Utility.createErrorResponse("request body is required"));
                return;
            }
            ParsedCreateRequest parsedCreateRequest = parseCreateRequest(body);
            validateAvailabilityBeforeCreate(parsedCreateRequest)
                    .onSuccess(conflictMessage -> {
                        if (conflictMessage != null && !conflictMessage.isBlank()) {
                            Utility.buildResponse(context, 409, Utility.createErrorResponse(conflictMessage));
                            return;
                        }
                        String userId = context.get("userId");
                        fetchUserById(userId).onSuccess(user -> {
                            Instant now = Instant.now();
                            MediaDownloadRequest mediaDownloadRequest = new MediaDownloadRequest();
                            mediaDownloadRequest.setRequestId(UUID.randomUUID().toString());
                            mediaDownloadRequest.setUserId(userId);
                            mediaDownloadRequest.setUserEmail(user.getString("email"));
                            mediaDownloadRequest.setUserName(user.getString("name", user.getString("userName", "")));
                            mediaDownloadRequest.setTitle(parsedCreateRequest.title());
                            mediaDownloadRequest.setMediaType(parsedCreateRequest.mediaType());
                            mediaDownloadRequest.setQualityProfileId(parsedCreateRequest.qualityProfileId());
                            mediaDownloadRequest.setSeason(parsedCreateRequest.season());
                            mediaDownloadRequest.setStatus(MediaRequestStatus.PENDING);
                            mediaDownloadRequest.setCreatedAt(now);
                            mediaDownloadRequest.setUpdatedAt(now);
                            mongoDBClient.insertRecord(JsonObject.mapFrom(mediaDownloadRequest), MEDIA_REQUESTS_COLLECTION)
                                    .onSuccess(res -> Utility.buildResponse(
                                            context,
                                            201,
                                            Utility.createSuccessResponse(new JsonObject()
                                                    .put("message", "request created")
                                                    .put("requestId", mediaDownloadRequest.getRequestId())
                                                    .put("status", mediaDownloadRequest.getStatus().name())
                                            )))
                                    .onFailure(fail -> {
                                        log.error("Failed to create media request for userId={}", userId, fail);
                                        Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
                                    });
                        }).onFailure(fail -> {
                            log.error("Failed to resolve user while creating media request for userId={}", userId, fail);
                            Utility.buildResponse(context, 400, Utility.createErrorResponse(fail.getMessage()));
                        });
                    })
                    .onFailure(fail -> {
                        log.error("Failed to validate availability before request creation", fail);
                        Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
                    });
        } catch (IllegalArgumentException e) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse(e.getMessage()));
        } catch (Exception e) {
            log.error("Unexpected error while creating media request", e);
            Utility.buildResponse(context, 500, Utility.createErrorResponse(e.getMessage()));
        }
    }

    private Future<String> validateAvailabilityBeforeCreate(ParsedCreateRequest parsedCreateRequest) {
        if (parsedCreateRequest.mediaType() == MediaType.MOVIES) {
            return fetchAvailableMovies().map(availableMovies -> {
                boolean alreadyAvailable = availableMovies.stream()
                        .filter(JsonObject.class::isInstance)
                        .map(JsonObject.class::cast)
                        .anyMatch(movie -> isSameTitle(movie.getString("title"), parsedCreateRequest.title()));
                return alreadyAvailable ? "Movie already available in library" : null;
            });
        }

        return fetchAvailableShows().map(availableShows -> {
            JsonObject matchingShow = availableShows.stream()
                    .filter(JsonObject.class::isInstance)
                    .map(JsonObject.class::cast)
                    .filter(show -> isSameTitle(show.getString("title"), parsedCreateRequest.title()))
                    .findFirst()
                    .orElse(null);
            if (matchingShow == null) {
                return null;
            }
            Set<Integer> availableSeasons = toIntegerSet(matchingShow.getJsonArray("availableSeasons", new JsonArray()));
            if (availableSeasons.isEmpty()) {
                return null;
            }
            boolean allRequestedSeasonsAvailable = parsedCreateRequest.season().stream()
                    .allMatch(availableSeasons::contains);
            if (!allRequestedSeasonsAvailable) {
                return null;
            }
            String requestedSeasons = parsedCreateRequest.season().stream()
                    .sorted()
                    .map(String::valueOf)
                    .collect(Collectors.joining(", "));
            return "Selected season(s) already available for this series: " + requestedSeasons;
        });
    }

    private boolean isSameTitle(String lhs, String rhs) {
        if (lhs == null || rhs == null) {
            return false;
        }
        return lhs.trim().equalsIgnoreCase(rhs.trim());
    }

    private Set<Integer> toIntegerSet(JsonArray values) {
        Set<Integer> set = new HashSet<>();
        for (Object value : values) {
            if (value instanceof Number number) {
                set.add(number.intValue());
            }
        }
        return set;
    }

    public void handleGetMyRequests(RoutingContext context) {
        String userId = context.get("userId");
        JsonObject query = new JsonObject().put("userId", userId);
        mongoDBClient.queryRecords(query, MEDIA_REQUESTS_COLLECTION)
                .onSuccess(records -> Utility.buildResponse(
                        context,
                        200,
                        Utility.createSuccessResponse(formatRequestRecords(records))
                )).onFailure(fail -> {
                    log.error("Failed to fetch media requests for userId={}", userId, fail);
                    Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
                });
    }

    public void handleGetAllRequests(RoutingContext context) {
        mongoDBClient.queryRecords(new JsonObject(), MEDIA_REQUESTS_COLLECTION)
                .onSuccess(records -> Utility.buildResponse(
                        context,
                        200,
                        Utility.createSuccessResponse(formatRequestRecords(records))
                )).onFailure(fail -> {
                    log.error("Failed to fetch all media requests", fail);
                    Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
                });
    }

    public void handleApproveRequest(RoutingContext context) {
        String requestId = context.pathParam("requestId");
        String adminUserId = context.get("userId");
        if (requestId == null || requestId.trim().isEmpty()) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse("requestId path param is required"));
            return;
        }
        fetchRequestById(requestId).onSuccess(request -> {
            if (!MediaRequestStatus.PENDING.equals(request.getStatus())) {
                Utility.buildResponse(context, 400, Utility.createErrorResponse("only pending requests can be approved"));
                return;
            }
            LookUpDTO lookUpDTO = new LookUpDTO();
            lookUpDTO.setTitle(request.getTitle());
            lookUpDTO.setMediaType(request.getMediaType());
            lookUpDTO.setQuality(request.getQualityProfileId());
            lookUpDTO.setSeason(request.getSeason() == null ? List.of() : request.getSeason());
            try {
                addMediaControllerFactory.getClient(request.getMediaType()).addContent(lookUpDTO)
                        .onSuccess(res -> markRequestApproved(request, adminUserId).onSuccess(v -> {
                            sendApprovalEmail(request).onSuccess(mailRes -> {
                                markNotificationSent(request.getRequestId());
                                Utility.buildResponse(
                                        context,
                                        200,
                                        Utility.createSuccessResponse(new JsonObject()
                                                .put("message", "Request approved and media queued for download")
                                                .put("requestId", request.getRequestId())
                                                .put("notification", "sent"))
                                );
                            }).onFailure(mailFailure -> {
                                log.error("Failed to send approval email for requestId={}", request.getRequestId(), mailFailure);
                                Utility.buildResponse(
                                        context,
                                        200,
                                        Utility.createSuccessResponse(new JsonObject()
                                                .put("message", "Request approved and media queued for download")
                                                .put("requestId", request.getRequestId())
                                                .put("notification", "failed"))
                                );
                            });
                        }).onFailure(updateFailure -> {
                            log.error("Failed to mark request approved for requestId={}", request.getRequestId(), updateFailure);
                            Utility.buildResponse(context, 500, Utility.createErrorResponse(updateFailure.getMessage()));
                        })).onFailure(downloadFailure -> {
                            log.error("Failed to queue media for requestId={}", request.getRequestId(), downloadFailure);
                            Utility.buildResponse(context, 500, Utility.createErrorResponse(downloadFailure.getMessage()));
                        });
            } catch (Exception e) {
                log.error("Unexpected error while approving requestId={}", request.getRequestId(), e);
                Utility.buildResponse(context, 500, Utility.createErrorResponse(e.getMessage()));
            }
        }).onFailure(fail -> {
            if (fail instanceof NoSuchElementException) {
                Utility.buildResponse(context, 404, Utility.createErrorResponse(fail.getMessage()));
                return;
            }
            log.error("Failed to fetch request for approval requestId={}", requestId, fail);
            Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
        });
    }

    public void handleDeleteRequest(RoutingContext context) {
        String requestId = context.pathParam("requestId");
        String requestUserId = context.get("userId");
        String requestUserRole = context.get("role");
        if (requestId == null || requestId.trim().isEmpty()) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse("requestId path param is required"));
            return;
        }
        fetchRequestById(requestId).onSuccess(request -> {
            boolean isAdmin = Role.ADMIN.name().equalsIgnoreCase(requestUserRole);
            boolean isOwner = requestUserId != null && requestUserId.equals(request.getUserId());

            MediaRequestStatus status = request.getStatus();
            if (MediaRequestStatus.PENDING.equals(status)) {
                if (!isAdmin && !isOwner) {
                    Utility.buildResponse(context, 403, Utility.createErrorResponse("you are not allowed to delete this request"));
                    return;
                }
            } else if (MediaRequestStatus.APPROVED.equals(status)) {
                if (!isAdmin) {
                    Utility.buildResponse(context, 403, Utility.createErrorResponse("only admins can delete approved requests"));
                    return;
                }
            } else {
                Utility.buildResponse(context, 400, Utility.createErrorResponse("only pending or approved requests can be deleted"));
                return;
            }
            JsonObject query = new JsonObject().put("requestId", requestId);
            mongoDBClient.deleteRecord(query, MEDIA_REQUESTS_COLLECTION)
                    .onSuccess(res -> Utility.buildResponse(
                            context,
                            200,
                            Utility.createSuccessResponse(new JsonObject()
                                    .put("message", "request deleted")
                                    .put("requestId", requestId)
                            )
                    )).onFailure(fail -> {
                        log.error("Failed to delete requestId={}", requestId, fail);
                        Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
                    });
        }).onFailure(fail -> {
            if (fail instanceof NoSuchElementException) {
                Utility.buildResponse(context, 404, Utility.createErrorResponse(fail.getMessage()));
                return;
            }
            log.error("Failed to fetch request for deletion requestId={}", requestId, fail);
            Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
        });
    }

    public void handleGetAvailableMedia(RoutingContext context) {
        String mediaTypeParam = context.request().getParam("mediaType");
        MediaType mediaType = parseMediaType(mediaTypeParam);
        if (mediaType == MediaType.UNKNOWN) {
            Utility.buildResponse(context, 400, Utility.createErrorResponse("mediaType query param must be MOVIES or SHOWS"));
            return;
        }
        getAvailableMedia(mediaType).onSuccess(items ->
                Utility.buildResponse(context, 200, Utility.createSuccessResponse(items))
        ).onFailure(fail -> {
            log.error("Failed to fetch available media for type={}", mediaType, fail);
            Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
        });
    }

    public Future<JsonArray> getAvailableMedia(MediaType mediaType) {
        if (mediaType == null || mediaType == MediaType.UNKNOWN) {
            return Future.failedFuture("mediaType must be MOVIES or SHOWS");
        }
        return mediaType == MediaType.MOVIES
                ? fetchAvailableMovies()
                : fetchAvailableShows();
    }

    public void handleGetDownloadQueue(RoutingContext context) {
        String userId = context.get("userId");
        String userRole = context.get("role");
        String requestedScope = context.request().getParam("scope");
        getDownloadQueue(userId, userRole, requestedScope)
                .onSuccess(payload -> Utility.buildResponse(
                        context,
                        200,
                        Utility.createSuccessResponse(payload)
                )).onFailure(fail -> {
            log.error("Failed to fetch download queue", fail);
            Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
        });
    }

    public void handleGetCompletedDownloads(RoutingContext context) {
        String userId = context.get("userId");
        String userRole = context.get("role");
        String requestedScope = context.request().getParam("scope");
        getCompletedDownloads(userId, userRole, requestedScope)
                .onSuccess(payload -> Utility.buildResponse(
                        context,
                        200,
                        Utility.createSuccessResponse(payload)
                )).onFailure(fail -> {
                    log.error("Failed to fetch completed downloads", fail);
                    Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
                });
    }

    public Future<JsonObject> getDownloadQueue(String userId, String userRole, String requestedScope) {
        boolean isAdmin = Role.ADMIN.name().equalsIgnoreCase(userRole);
        String normalizedScope = requestedScope == null ? DOWNLOAD_SCOPE_MINE : requestedScope.trim().toLowerCase();
        boolean includeAllDownloads = isAdmin && DOWNLOAD_SCOPE_ALL.equals(normalizedScope);

        Future<List<MediaDownloadRequest>> requestScopeFuture = includeAllDownloads
                ? Future.succeededFuture(Collections.emptyList())
                : fetchApprovedRequestsForUser(userId);

        return reconcileDownloadedRequestsBestEffort()
                .compose(v -> refreshMonitoredDownloadsBestEffort())
                .compose(v -> CompositeFuture.all(
                        fetchMovieQueueRecords(),
                        fetchSeriesQueueRecords(),
                        requestScopeFuture
                ).map(result -> {
                    JsonArray movieQueue = result.resultAt(0);
                    JsonArray seriesQueue = result.resultAt(1);
                    List<MediaDownloadRequest> userRequests = result.resultAt(2);

                    JsonArray combinedQueue = combineAndNormalizeQueue(movieQueue, seriesQueue);
                    JsonArray scopedQueue = includeAllDownloads
                            ? combinedQueue
                            : filterQueueByUserRequests(combinedQueue, userRequests);

                    return new JsonObject()
                            .put("scope", includeAllDownloads ? DOWNLOAD_SCOPE_ALL : DOWNLOAD_SCOPE_MINE)
                            .put("downloads", scopedQueue);
                }));
    }

    public Future<JsonObject> getCompletedDownloads(String userId, String userRole, String requestedScope) {
        boolean isAdmin = Role.ADMIN.name().equalsIgnoreCase(userRole);
        String normalizedScope = requestedScope == null ? DOWNLOAD_SCOPE_MINE : requestedScope.trim().toLowerCase();
        boolean includeAllDownloads = isAdmin && DOWNLOAD_SCOPE_ALL.equals(normalizedScope);

        JsonObject query = new JsonObject();
        if (!includeAllDownloads) {
            query.put("userId", userId);
        }
        query.put("status", new JsonObject().put("$in", new JsonArray()
                .add(MediaRequestStatus.DOWNLOADED.name())
                .add(MediaRequestStatus.APPROVED.name())));

        return reconcileDownloadedRequestsBestEffort()
                .compose(v -> mongoDBClient.queryRecords(query, MEDIA_REQUESTS_COLLECTION))
                .compose(records -> {
                    List<JsonObject> sanitized = records.stream()
                            .map(this::sanitizeRequestRecord)
                            .toList();
                    List<JsonObject> completedRecords = sanitized.stream()
                            .filter(record -> MediaRequestStatus.DOWNLOADED.name()
                                    .equalsIgnoreCase(record.getString("status", "")))
                            .toList();
                    List<MediaDownloadRequest> approvedRequests = sanitized.stream()
                            .filter(record -> MediaRequestStatus.APPROVED.name()
                                    .equalsIgnoreCase(record.getString("status", "")))
                            .map(record -> record.mapTo(MediaDownloadRequest.class))
                            .toList();

                    if (approvedRequests.isEmpty()) {
                        return Future.succeededFuture(buildCompletedDownloadsPayload(
                                completedRecords,
                                includeAllDownloads
                        ));
                    }

                    return refreshMonitoredDownloadsBestEffort()
                            .compose(v -> CompositeFuture.all(
                                    fetchMovieQueueRecords(),
                                    fetchSeriesQueueRecords(),
                                    fetchAvailableMovies(),
                                    fetchAvailableShows()
                            ))
                            .map(result -> {
                                JsonArray movieQueue = result.resultAt(0);
                                JsonArray seriesQueue = result.resultAt(1);
                                JsonArray availableMovies = result.resultAt(2);
                                JsonArray availableShows = result.resultAt(3);
                                JsonArray combinedQueue = combineAndNormalizeQueue(movieQueue, seriesQueue);

                                List<JsonObject> detectedCompleted = approvedRequests.stream()
                                        .filter(request -> !isRequestPresentInQueue(request, combinedQueue))
                                        .filter(request -> isRequestDownloaded(request, availableMovies, availableShows))
                                        .map(this::toDetectedCompletedRecord)
                                        .toList();

                                List<JsonObject> merged = new ArrayList<>(completedRecords);
                                Set<String> seenRequestIds = merged.stream()
                                        .map(record -> record.getString("requestId"))
                                        .filter(id -> id != null && !id.isBlank())
                                        .collect(Collectors.toSet());
                                for (JsonObject detected : detectedCompleted) {
                                    String requestId = detected.getString("requestId");
                                    if (requestId != null && seenRequestIds.contains(requestId)) {
                                        continue;
                                    }
                                    if (requestId != null && !requestId.isBlank()) {
                                        seenRequestIds.add(requestId);
                                    }
                                    merged.add(detected);
                                }
                                return buildCompletedDownloadsPayload(merged, includeAllDownloads);
                            });
                });
    }

    private Future<Void> reconcileDownloadedRequestsBestEffort() {
        return mongoDBClient.queryRecords(new JsonObject(), MEDIA_REQUESTS_COLLECTION)
                .compose(this::reconcileDownloadedRequests)
                .map(summary -> (Void) null)
                .recover(fail -> {
                    log.warn("Best-effort download reconciliation failed: {}", fail.getMessage());
                    return Future.succeededFuture((Void) null);
                });
    }

    private JsonObject buildCompletedDownloadsPayload(List<JsonObject> completedRecords, boolean includeAllDownloads) {
        List<JsonObject> sorted = completedRecords.stream()
                .sorted(Comparator.comparing(this::extractDownloadedAt, Comparator.reverseOrder()))
                .toList();
        JsonArray completedDownloads = new JsonArray(sorted.stream()
                .map(record -> mapCompletedDownloadRecord(record, includeAllDownloads))
                .toList());
        return new JsonObject()
                .put("scope", includeAllDownloads ? DOWNLOAD_SCOPE_ALL : DOWNLOAD_SCOPE_MINE)
                .put("downloads", completedDownloads);
    }

    private Future<Void> refreshMonitoredDownloadsBestEffort() {
        Future<Void> radarrRefresh = triggerRefreshMonitoredDownloads(radarrCommandUrl, radarrApiKey, "radarr")
                .recover(fail -> {
                    log.warn("Failed to trigger Radarr RefreshMonitoredDownloads: {}", fail.getMessage());
                    return Future.succeededFuture();
                });
        Future<Void> sonarrRefresh = triggerRefreshMonitoredDownloads(sonarrCommandUrl, sonarrApiKey, "sonarr")
                .recover(fail -> {
                    log.warn("Failed to trigger Sonarr RefreshMonitoredDownloads: {}", fail.getMessage());
                    return Future.succeededFuture();
                });
        return CompositeFuture.all(radarrRefresh, sonarrRefresh).mapEmpty();
    }

    private Future<Void> triggerRefreshMonitoredDownloads(String commandUrl, String apiKey, String source) {
        Promise<Void> promise = Promise.promise();
        JsonObject payload = new JsonObject().put("name", "RefreshMonitoredDownloads");
        webClient.postAbs(commandUrl)
                .putHeader("x-api-key", apiKey)
                .sendJsonObject(payload)
                .onSuccess(res -> {
                    int statusCode = res.statusCode();
                    if ((statusCode >= 200 && statusCode < 300) || statusCode == 409) {
                        log.info("Triggered {} RefreshMonitoredDownloads, status={}", source, statusCode);
                        promise.complete();
                        return;
                    }
                    promise.fail("failed to trigger refresh for " + source + ", status=" + statusCode);
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    public void handleReconcileDownloadedRequests(RoutingContext context) {
        mongoDBClient.queryRecords(new JsonObject(), MEDIA_REQUESTS_COLLECTION)
                .compose(this::reconcileDownloadedRequests)
                .onSuccess(summary -> Utility.buildResponse(
                        context,
                        200,
                        Utility.createSuccessResponse(summary)
                ))
                .onFailure(fail -> {
                    log.error("Failed to reconcile downloaded requests", fail);
                    Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
                });
    }

    private Future<JsonObject> reconcileDownloadedRequests(List<JsonObject> records) {
        List<MediaDownloadRequest> requests = records.stream()
                .map(record -> record.mapTo(MediaDownloadRequest.class))
                .toList();

        List<MediaDownloadRequest> approvedRequests = requests.stream()
                .filter(request -> MediaRequestStatus.APPROVED.equals(request.getStatus()))
                .toList();
        List<MediaDownloadRequest> downloadedWithoutAlert = requests.stream()
                .filter(request -> MediaRequestStatus.DOWNLOADED.equals(request.getStatus()))
                .filter(request -> request.getDownloadedNotificationSentAt() == null)
                .toList();

        JsonObject summary = new JsonObject()
                .put("totalRequests", requests.size())
                .put("approvedChecked", approvedRequests.size())
                .put("downloadedMissingAlert", downloadedWithoutAlert.size())
                .put("inQueue", 0)
                .put("downloadedDetected", 0)
                .put("statusUpdated", 0)
                .put("alertsSent", 0)
                .put("alertsFailed", 0);

        if (approvedRequests.isEmpty() && downloadedWithoutAlert.isEmpty()) {
            return Future.succeededFuture(summary);
        }

        return refreshMonitoredDownloadsBestEffort().compose(refreshResult -> CompositeFuture.all(
                fetchAvailableMovies(),
                fetchAvailableShows()
        ).compose(result -> {
            JsonArray availableMovies = result.resultAt(0);
            JsonArray availableShows = result.resultAt(1);

            int[] inQueue = {0};
            int[] downloadedDetected = {0};
            int[] statusUpdated = {0};
            int[] alertsSent = {0};
            int[] alertsFailed = {0};
            List<Future> updateFutures = new ArrayList<>();

            for (MediaDownloadRequest request : approvedRequests) {
                if (!isRequestDownloaded(request, availableMovies, availableShows)) {
                    continue;
                }
                downloadedDetected[0]++;
                Future<Void> updateFuture = markRequestDownloaded(request)
                        .compose(updateResult -> {
                            statusUpdated[0]++;
                            return sendDownloadedEmailIfNeeded(request);
                        })
                        .map(sent -> {
                            if (sent) {
                                alertsSent[0]++;
                            } else {
                                alertsFailed[0]++;
                            }
                            return (Void) null;
                        })
                        .recover(fail -> {
                            alertsFailed[0]++;
                            log.error("Failed to finalize downloaded requestId={}", request.getRequestId(), fail);
                            return Future.succeededFuture();
                        });
                updateFutures.add(updateFuture);
            }

            for (MediaDownloadRequest request : downloadedWithoutAlert) {
                Future<Void> notifyFuture = sendDownloadedEmailIfNeeded(request)
                        .map(sent -> {
                            if (sent) {
                                alertsSent[0]++;
                            } else {
                                alertsFailed[0]++;
                            }
                            return (Void) null;
                        })
                        .recover(fail -> {
                            alertsFailed[0]++;
                            log.error("Failed to send pending downloaded alert for requestId={}", request.getRequestId(), fail);
                            return Future.succeededFuture();
                        });
                updateFutures.add(notifyFuture);
            }

            Future<Void> completionFuture = updateFutures.isEmpty()
                    ? Future.succeededFuture()
                    : CompositeFuture.all(updateFutures).mapEmpty();

            return completionFuture.map(completionResult -> summary
                    .put("inQueue", inQueue[0])
                    .put("downloadedDetected", downloadedDetected[0])
                    .put("statusUpdated", statusUpdated[0])
                    .put("alertsSent", alertsSent[0])
                    .put("alertsFailed", alertsFailed[0]));
        })).recover(fail -> {
            log.error("Failed during downloaded request reconciliation", fail);
            summary.put("error", fail.getMessage());
            return Future.succeededFuture(summary);
        });
    }

    private boolean isRequestDownloaded(MediaDownloadRequest request, JsonArray availableMovies, JsonArray availableShows) {
        if (request == null || request.getMediaType() == null) {
            return false;
        }
        if (request.getMediaType() == MediaType.MOVIES) {
            return availableMovies.stream()
                    .filter(JsonObject.class::isInstance)
                    .map(JsonObject.class::cast)
                    .anyMatch(movie -> isSameTitle(movie.getString("title"), request.getTitle()));
        }
        if (request.getMediaType() == MediaType.SHOWS) {
            JsonObject matchingShow = availableShows.stream()
                    .filter(JsonObject.class::isInstance)
                    .map(JsonObject.class::cast)
                    .filter(show -> isSameTitle(show.getString("title"), request.getTitle()))
                    .findFirst()
                    .orElse(null);
            if (matchingShow == null) {
                return false;
            }
            Set<Integer> availableSeasons = toIntegerSet(matchingShow.getJsonArray("availableSeasons", new JsonArray()));
            if (request.getSeason() == null || request.getSeason().isEmpty()) {
                return !availableSeasons.isEmpty();
            }
            return request.getSeason().stream().allMatch(availableSeasons::contains);
        }
        return false;
    }

    private Future<Void> markRequestDownloaded(MediaDownloadRequest request) {
        JsonObject query = new JsonObject().put("requestId", request.getRequestId());
        Instant now = Instant.now();
        JsonObject update = new JsonObject()
                .put("$set", new JsonObject()
                        .put("status", MediaRequestStatus.DOWNLOADED.name())
                        .put("downloadedAt", now)
                        .put("updatedAt", now));
        return mongoDBClient.updateRecord(query, update, MEDIA_REQUESTS_COLLECTION);
    }

    private boolean isRequestPresentInQueue(MediaDownloadRequest request, JsonArray queueItems) {
        if (request == null) {
            return false;
        }
        return queueItems.stream()
                .filter(JsonObject.class::isInstance)
                .map(JsonObject.class::cast)
                .anyMatch(queueItem -> matchesAnyRequest(queueItem, List.of(request)));
    }

    private Future<Boolean> sendDownloadedEmailIfNeeded(MediaDownloadRequest request) {
        if (request.getDownloadedNotificationSentAt() != null) {
            return Future.succeededFuture(false);
        }
        if (request.getUserEmail() == null || request.getUserEmail().isBlank()) {
            log.warn("Skipping downloaded email because userEmail is missing for requestId={}", request.getRequestId());
            return Future.succeededFuture(false);
        }
        String subject = "Download completed: " + request.getTitle();
        return resolvePosterForRequest(request).compose(posterUrl -> {
            String htmlBody = buildMediaStatusEmailHtml(
                    request,
                    "Download Completed",
                    "Your requested media is now downloaded and available on your server.",
                    "Downloaded",
                    posterUrl
            );
            return new MailService(webClient).sendEmail(subject, request.getUserEmail(), htmlBody);
        })
                .compose(v -> markDownloadedNotificationSent(request.getRequestId()))
                .map(v -> true)
                .recover(fail -> {
                    log.error("Failed to send downloaded email for requestId={}", request.getRequestId(), fail);
                    return Future.succeededFuture(false);
                });
    }

    private Future<Void> markDownloadedNotificationSent(String requestId) {
        JsonObject query = new JsonObject().put("requestId", requestId);
        JsonObject update = new JsonObject()
                .put("$set", new JsonObject()
                        .put("downloadedNotificationSentAt", Instant.now())
                        .put("updatedAt", Instant.now()));
        return mongoDBClient.updateRecord(query, update, MEDIA_REQUESTS_COLLECTION);
    }

    private Future<JsonObject> fetchUserById(String userId) {
        Promise<JsonObject> promise = Promise.promise();
        JsonObject query = new JsonObject().put("userId", userId);
        mongoDBClient.queryRecords(query, USER_COLLECTION)
                .onSuccess(users -> {
                    if (users == null || users.isEmpty()) {
                        promise.fail("requesting user not found");
                        return;
                    }
                    promise.complete(users.getFirst());
                }).onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<MediaDownloadRequest> fetchRequestById(String requestId) {
        Promise<MediaDownloadRequest> promise = Promise.promise();
        JsonObject query = new JsonObject().put("requestId", requestId);
        mongoDBClient.queryRecords(query, MEDIA_REQUESTS_COLLECTION)
                .onSuccess(records -> {
                    if (records == null || records.isEmpty()) {
                        promise.fail(new NoSuchElementException("media request not found"));
                        return;
                    }
                    promise.complete(records.getFirst().mapTo(MediaDownloadRequest.class));
                }).onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<List<MediaDownloadRequest>> fetchApprovedRequestsForUser(String userId) {
        Promise<List<MediaDownloadRequest>> promise = Promise.promise();
        JsonObject query = new JsonObject()
                .put("userId", userId)
                .put("status", MediaRequestStatus.APPROVED.name());
        mongoDBClient.queryRecords(query, MEDIA_REQUESTS_COLLECTION)
                .onSuccess(records -> {
                    List<MediaDownloadRequest> requests = records.stream()
                            .map(record -> record.mapTo(MediaDownloadRequest.class))
                            .toList();
                    promise.complete(requests);
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<JsonArray> fetchMovieQueueRecords() {
        return fetchQueueRecords(radarrQueueUrl, radarrApiKey, "includeUnknownMovieItems");
    }

    private Future<JsonArray> fetchSeriesQueueRecords() {
        return fetchQueueRecords(sonarrQueueUrl, sonarrApiKey, "includeUnknownSeriesItems");
    }

    private Future<JsonArray> fetchQueueRecords(String queueUrl, String apiKey, String includeUnknownParam) {
        Promise<JsonArray> promise = Promise.promise();
        webClient.getAbs(queueUrl)
                .addQueryParam("page", "1")
                .addQueryParam("pageSize", "250")
                .addQueryParam("sortDirection", "ascending")
                .addQueryParam("sortKey", "timeleft")
                .addQueryParam(includeUnknownParam, "true")
                .putHeader("x-api-key", apiKey)
                .send()
                .onSuccess(res -> {
                    if (res.statusCode() < 200 || res.statusCode() >= 300) {
                        promise.fail("failed to fetch queue: " + res.bodyAsString());
                        return;
                    }
                    JsonObject responseBody = res.bodyAsJsonObject();
                    if (responseBody == null) {
                        promise.complete(new JsonArray());
                        return;
                    }
                    promise.complete(responseBody.getJsonArray("records", new JsonArray()));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private JsonArray combineAndNormalizeQueue(JsonArray movieQueue, JsonArray seriesQueue) {
        JsonArray normalizedMovies = normalizeQueueRecords(movieQueue, MediaType.MOVIES);
        JsonArray normalizedSeries = normalizeQueueRecords(seriesQueue, MediaType.SHOWS);
        List<JsonObject> combined = new ArrayList<>();
        normalizedMovies.forEach(item -> {
            if (item instanceof JsonObject object) {
                combined.add(object);
            }
        });
        normalizedSeries.forEach(item -> {
            if (item instanceof JsonObject object) {
                combined.add(object);
            }
        });
        combined.sort(Comparator.comparing(
                item -> item.getString("added", ""),
                Comparator.reverseOrder()
        ));
        return new JsonArray(combined);
    }

    private JsonArray normalizeQueueRecords(JsonArray queueRecords, MediaType mediaType) {
        Map<String, JsonObject> byDownloadId = new LinkedHashMap<>();
        for (Object item : queueRecords) {
            if (!(item instanceof JsonObject queueRecord)) {
                continue;
            }
            String key = queueRecord.getString("downloadId");
            if (key == null || key.isBlank()) {
                key = String.valueOf(queueRecord.getValue("id"));
            }
            JsonObject normalizedRecord = byDownloadId.computeIfAbsent(
                    key,
                    ignored -> buildBaseQueueRecord(queueRecord, mediaType)
            );
            if (mediaType == MediaType.SHOWS) {
                Integer seasonNumber = parseInteger(queueRecord.getValue("seasonNumber"));
                if (seasonNumber != null && seasonNumber > 0) {
                    JsonArray seasonNumbers = normalizedRecord.getJsonArray("seasonNumbers", new JsonArray());
                    if (!seasonNumbers.contains(seasonNumber)) {
                        seasonNumbers.add(seasonNumber);
                        normalizedRecord.put("seasonNumbers", seasonNumbers);
                    }
                }
                normalizedRecord.put("episodeCount", normalizedRecord.getInteger("episodeCount", 0) + 1);
            }
        }
        return new JsonArray(new ArrayList<>(byDownloadId.values()));
    }

    private JsonObject buildBaseQueueRecord(JsonObject queueRecord, MediaType mediaType) {
        Long size = parseLong(queueRecord.getValue("size"));
        Long sizeLeft = parseLong(queueRecord.getValue("sizeleft"));
        JsonObject normalized = new JsonObject()
                .put("queueItemId", queueRecord.getValue("id"))
                .put("downloadId", queueRecord.getString("downloadId"))
                .put("title", queueRecord.getString("title", "Unknown title"))
                .put("mediaType", mediaType.name())
                .put("status", queueRecord.getString("status"))
                .put("trackedDownloadStatus", queueRecord.getString("trackedDownloadStatus"))
                .put("trackedDownloadState", queueRecord.getString("trackedDownloadState"))
                .put("protocol", queueRecord.getString("protocol"))
                .put("downloadClient", queueRecord.getString("downloadClient"))
                .put("indexer", queueRecord.getString("indexer"))
                .put("timeleft", queueRecord.getString("timeleft"))
                .put("added", queueRecord.getString("added"))
                .put("estimatedCompletionTime", queueRecord.getString("estimatedCompletionTime"))
                .put("size", size == null ? 0L : size)
                .put("sizeleft", sizeLeft == null ? 0L : sizeLeft)
                .put("progressPercent", calculateProgress(size, sizeLeft));
        if (mediaType == MediaType.SHOWS) {
            normalized.put("seasonNumbers", new JsonArray());
            normalized.put("episodeCount", 0);
        }
        return normalized;
    }

    private JsonArray filterQueueByUserRequests(JsonArray queueItems, List<MediaDownloadRequest> userRequests) {
        if (userRequests == null || userRequests.isEmpty()) {
            return new JsonArray();
        }
        List<JsonObject> filtered = queueItems.stream()
                .filter(JsonObject.class::isInstance)
                .map(JsonObject.class::cast)
                .filter(queueItem -> matchesAnyRequest(queueItem, userRequests))
                .toList();
        return new JsonArray(filtered);
    }

    private boolean matchesAnyRequest(JsonObject queueItem, List<MediaDownloadRequest> userRequests) {
        MediaType queueMediaType = parseMediaType(queueItem.getString("mediaType"));
        if (queueMediaType == MediaType.UNKNOWN) {
            return false;
        }
        String queueTitle = normalizeTitle(queueItem.getString("title"));
        if (queueTitle.isBlank()) {
            return false;
        }
        Set<Integer> queueSeasons = toIntegerSet(queueItem.getJsonArray("seasonNumbers", new JsonArray()));
        for (MediaDownloadRequest request : userRequests) {
            if (request.getMediaType() == null || !request.getMediaType().equals(queueMediaType)) {
                continue;
            }
            String requestTitle = normalizeTitle(request.getTitle());
            if (!titlesLikelyMatch(queueTitle, requestTitle)) {
                continue;
            }
            if (queueMediaType == MediaType.SHOWS
                    && request.getSeason() != null
                    && !request.getSeason().isEmpty()
                    && !queueSeasons.isEmpty()) {
                boolean seasonIntersection = request.getSeason().stream().anyMatch(queueSeasons::contains);
                if (!seasonIntersection) {
                    continue;
                }
            }
            return true;
        }
        return false;
    }

    private String normalizeTitle(String title) {
        if (title == null) {
            return "";
        }
        String normalized = title;
        normalized = normalized.replaceAll("(?i)\\[[^\\]]*\\]", " ");
        normalized = normalized.replaceAll("(?i)\\([^)]*\\)", " ");
        normalized = normalized.replaceAll("(?i)\\bS\\d{1,2}(E\\d{1,2})?\\b.*", " ");
        normalized = normalized.replaceAll("(?i)\\b\\d{3,4}p\\b.*", " ");
        normalized = normalized.toLowerCase();
        normalized = normalized.replaceAll("[^a-z0-9]+", "");
        return normalized.trim();
    }

    private JsonObject mapCompletedDownloadRecord(JsonObject record, boolean includeRequesterDetails) {
        JsonObject mapped = new JsonObject()
                .put("requestId", record.getString("requestId"))
                .put("title", record.getString("title", "Unknown title"))
                .put("mediaType", record.getString("mediaType", MediaType.UNKNOWN.name()))
                .put("qualityProfileId", record.getString("qualityProfileId", DEFAULT_QUALITY_PROFILE))
                .put("season", record.getJsonArray("season", new JsonArray()))
                .put("status", record.getString("status", MediaRequestStatus.DOWNLOADED.name()))
                .put("createdAt", record.getValue("createdAt"))
                .put("approvedAt", record.getValue("approvedAt"))
                .put("downloadedAt", record.getValue("downloadedAt"))
                .put("detectedCompleted", record.getBoolean("detectedCompleted", false));
        if (includeRequesterDetails) {
            mapped.put("requestedBy", new JsonObject()
                    .put("userId", record.getString("userId"))
                    .put("userName", record.getString("userName"))
                    .put("userEmail", record.getString("userEmail")));
        }
        return mapped;
    }

    private JsonObject toDetectedCompletedRecord(MediaDownloadRequest request) {
        JsonObject detected = JsonObject.mapFrom(request);
        detected.put("status", MediaRequestStatus.DOWNLOADED.name());
        if (detected.getValue("downloadedAt") == null) {
            Object updatedAt = detected.getValue("updatedAt");
            if (updatedAt != null) {
                detected.put("downloadedAt", updatedAt);
            }
        }
        detected.put("detectedCompleted", true);
        return sanitizeRequestRecord(detected);
    }

    private boolean titlesLikelyMatch(String queueTitle, String requestTitle) {
        if (queueTitle.isBlank() || requestTitle.isBlank()) {
            return false;
        }
        if (requestTitle.length() <= 2) {
            return queueTitle.equals(requestTitle) || queueTitle.startsWith(requestTitle);
        }
        return queueTitle.contains(requestTitle);
    }

    private Long parseLong(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (Exception ignored) {
            return null;
        }
    }

    private Integer parseInteger(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception ignored) {
            return null;
        }
    }

    private double calculateProgress(Long size, Long sizeLeft) {
        if (size == null || size <= 0 || sizeLeft == null) {
            return 0.0;
        }
        double downloaded = Math.max(0L, size - sizeLeft);
        double progress = (downloaded / size.doubleValue()) * 100.0;
        return Math.min(100.0, Math.max(0.0, progress));
    }

    private Future<JsonArray> fetchAvailableMovies() {
        Promise<JsonArray> promise = Promise.promise();
        webClient.getAbs(radarrMovieListUrl)
                .putHeader("x-api-key", radarrApiKey)
                .send()
                .onSuccess(res -> {
                    if (res.statusCode() < 200 || res.statusCode() >= 300) {
                        promise.fail("failed to fetch movies from Radarr: " + res.bodyAsString());
                        return;
                    }
                    JsonArray movies = res.bodyAsJsonArray();
                    JsonArray availableMovies = new JsonArray();
                    for (Object item : movies) {
                        if (!(item instanceof JsonObject movie)) continue;
                        if (!movie.getBoolean("hasFile", false)) continue;
                        availableMovies.add(new JsonObject()
                                .put("title", movie.getString("title"))
                                .put("year", movie.getInteger("year"))
                                .put("overview", movie.getString("overview"))
                                .put("poster", getPoster(movie))
                                .put("mediaType", MediaType.MOVIES.name())
                                .put("hasFile", movie.getBoolean("hasFile", false))
                                .put("qualityProfileId", movie.getValue("qualityProfileId"))
                                .put("path", movie.getString("path"))
                                .put("imdbId", movie.getString("imdbId"))
                                .put("tmdbId", movie.getValue("tmdbId"))
                                .put("added", movie.getString("added"))
                                .put("radarrId", movie.getValue("id")));
                    }
                    promise.complete(sortByTitle(availableMovies));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<JsonArray> fetchAvailableShows() {
        Promise<JsonArray> promise = Promise.promise();
        webClient.getAbs(sonarrSeriesListUrl)
                .putHeader("x-api-key", sonarrApiKey)
                .send()
                .onSuccess(res -> {
                    if (res.statusCode() < 200 || res.statusCode() >= 300) {
                        promise.fail("failed to fetch series from Sonarr: " + res.bodyAsString());
                        return;
                    }
                    JsonArray shows = res.bodyAsJsonArray();
                    JsonArray availableShows = new JsonArray();
                    for (Object item : shows) {
                        if (!(item instanceof JsonObject show)) continue;
                        JsonObject statistics = show.getJsonObject("statistics", new JsonObject());
                        Integer episodeFileCount = statistics.getInteger("episodeFileCount", 0);
                        if (episodeFileCount == null || episodeFileCount <= 0) continue;
                        availableShows.add(new JsonObject()
                                .put("title", show.getString("title"))
                                .put("year", show.getInteger("year"))
                                .put("overview", show.getString("overview"))
                                .put("poster", getPoster(show))
                                .put("mediaType", MediaType.SHOWS.name())
                                .put("qualityProfileId", show.getValue("qualityProfileId"))
                                .put("path", show.getString("path"))
                                .put("imdbId", show.getString("imdbId"))
                                .put("tvdbId", show.getValue("tvdbId"))
                                .put("added", show.getString("added"))
                                .put("sonarrId", show.getValue("id"))
                                .put("episodeFileCount", episodeFileCount)
                                .put("episodeCount", statistics.getInteger("episodeCount", 0))
                                .put("totalEpisodeCount", statistics.getInteger("totalEpisodeCount", 0))
                                .put("percentOfEpisodes", statistics.getDouble("percentOfEpisodes", 0.0))
                                .put("availableSeasons", getAvailableSeasons(show)));
                    }
                    promise.complete(sortByTitle(availableShows));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private JsonArray getAvailableSeasons(JsonObject show) {
        JsonArray seasons = show.getJsonArray("seasons", new JsonArray());
        Set<Integer> availableSeasons = new HashSet<>();
        for (Object seasonObj : seasons) {
            if (!(seasonObj instanceof JsonObject seasonJson)) {
                continue;
            }
            Integer seasonNumber = seasonJson.getInteger("seasonNumber");
            if (seasonNumber == null || seasonNumber < 1) {
                continue;
            }
            JsonObject seasonStats = seasonJson.getJsonObject("statistics", new JsonObject());
            Integer seasonEpisodeFileCount = seasonStats.getInteger("episodeFileCount", 0);
            if (seasonEpisodeFileCount != null && seasonEpisodeFileCount > 0) {
                availableSeasons.add(seasonNumber);
            }
        }
        return new JsonArray(availableSeasons.stream().sorted().toList());
    }

    private JsonArray sortByTitle(JsonArray items) {
        List<JsonObject> sorted = items.stream()
                .filter(JsonObject.class::isInstance)
                .map(JsonObject.class::cast)
                .sorted(Comparator.comparing(
                        item -> item.getString("title", ""),
                        String.CASE_INSENSITIVE_ORDER))
                .toList();
        return new JsonArray(sorted);
    }

    private Future<Void> markRequestApproved(MediaDownloadRequest request, String adminUserId) {
        JsonObject query = new JsonObject().put("requestId", request.getRequestId());
        Instant now = Instant.now();
        JsonObject update = new JsonObject()
                .put("$set", new JsonObject()
                        .put("status", MediaRequestStatus.APPROVED.name())
                        .put("approvedBy", adminUserId)
                        .put("approvedAt", now)
                        .put("updatedAt", now));
        return mongoDBClient.updateRecord(query, update, MEDIA_REQUESTS_COLLECTION);
    }

    private void markNotificationSent(String requestId) {
        JsonObject query = new JsonObject().put("requestId", requestId);
        JsonObject update = new JsonObject()
                .put("notificationSentAt", Instant.now())
                .put("updatedAt", Instant.now());
        mongoDBClient.updateRecordAsync(query, update, MEDIA_REQUESTS_COLLECTION);
    }

    private Future<Void> sendApprovalEmail(MediaDownloadRequest request) {
        if (request.getUserEmail() == null || request.getUserEmail().isBlank()) {
            return Future.failedFuture("recipient email is missing for approval notification");
        }
        String subject = "Request approved: " + request.getTitle();
        return resolvePosterForRequest(request).compose(posterUrl -> {
            String htmlBody = buildMediaStatusEmailHtml(
                    request,
                    "Request Approved",
                    "Your request was approved and has been queued for download.",
                    "Approved",
                    posterUrl
            );
            return new MailService(webClient).sendEmail(subject, request.getUserEmail(), htmlBody);
        });
    }

    private Future<String> resolvePosterForRequest(MediaDownloadRequest request) {
        if (request == null || request.getMediaType() == null || request.getTitle() == null || request.getTitle().isBlank()) {
            return Future.succeededFuture("");
        }
        return getTopLookupOptions(request.getTitle(), request.getMediaType(), 5)
                .map(options -> extractBestPoster(options, request.getTitle()))
                .recover(fail -> {
                    log.warn("Failed to resolve poster for requestId={} title={}: {}",
                            request.getRequestId(), request.getTitle(), fail.getMessage());
                    return Future.succeededFuture("");
                });
    }

    private String extractBestPoster(JsonArray options, String requestTitle) {
        if (options == null || options.isEmpty()) {
            return "";
        }
        String fallbackPoster = "";
        for (Object item : options) {
            if (!(item instanceof JsonObject option)) {
                continue;
            }
            String poster = option.getString("poster", "");
            if (fallbackPoster.isBlank() && poster != null && !poster.isBlank()) {
                fallbackPoster = poster;
            }
            String optionTitle = option.getString("title", "");
            if (isSameTitle(optionTitle, requestTitle) && poster != null && !poster.isBlank()) {
                return poster;
            }
        }
        return fallbackPoster;
    }

    private String buildMediaStatusEmailHtml(MediaDownloadRequest request,
                                             String heading,
                                             String leadText,
                                             String statusBadge,
                                             String posterUrl) {
        String safeHeading = escapeHtml(heading);
        String safeLead = escapeHtml(leadText);
        String safeBadge = escapeHtml(statusBadge);
        String safeTitle = escapeHtml(request.getTitle());
        String safeType = escapeHtml(toMediaTypeLabel(request.getMediaType()));
        String safeQuality = escapeHtml(toQualityLabel(request.getQualityProfileId()));
        String safeSeasons = escapeHtml(formatSeasons(request.getSeason()));
        String safePoster = escapeHtml(posterUrl == null ? "" : posterUrl);

        String posterBlock = "";
        if (!safePoster.isBlank()) {
            posterBlock = """
                    <tr>
                      <td style="padding: 24px 24px 8px 24px; text-align: center;">
                        <img src="%s" alt="%s poster" style="width: 180px; max-width: 100%%; height: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.22);" />
                      </td>
                    </tr>
                    """.formatted(safePoster, safeTitle);
        }

        String seasonRow = "";
        if (MediaType.SHOWS.equals(request.getMediaType())) {
            seasonRow = """
                    <tr>
                      <td style="padding: 0 24px 12px 24px; font-size: 14px; color: #c3c7e5;">
                        <strong style="color: #ffffff;">Seasons:</strong> %s
                      </td>
                    </tr>
                    """.formatted(safeSeasons);
        }

        return """
                <html>
                  <body style="margin:0; padding:0; background:#070d22; font-family: 'Segoe UI', Arial, sans-serif; color:#e8ecff;">
                    <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background:#070d22; padding: 24px 0;">
                      <tr>
                        <td align="center">
                          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px; max-width:92%%; border-radius:18px; overflow:hidden; border:1px solid #243050; background:linear-gradient(180deg, #0f1a3a 0%%, #0a1126 100%%);">
                            <tr>
                              <td style="padding: 20px 24px 8px 24px;">
                                <span style="display:inline-block; padding:6px 12px; border-radius:999px; background:linear-gradient(90deg, #3674ff, #8a38ff); font-size:12px; font-weight:700; letter-spacing:0.3px;">
                                  %s
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 0 24px 6px 24px; font-size: 28px; line-height: 1.2; color: #ffffff; font-weight: 700;">
                                %s
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 0 24px 8px 24px; font-size: 15px; line-height: 1.55; color: #c3c7e5;">
                                %s
                              </td>
                            </tr>
                            %s
                            <tr>
                              <td style="padding: 8px 24px 12px 24px; font-size: 14px; color: #c3c7e5;">
                                <strong style="color: #ffffff;">Title:</strong> %s
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 0 24px 12px 24px; font-size: 14px; color: #c3c7e5;">
                                <strong style="color: #ffffff;">Type:</strong> %s
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 0 24px 12px 24px; font-size: 14px; color: #c3c7e5;">
                                <strong style="color: #ffffff;">Quality:</strong> %s
                              </td>
                            </tr>
                            %s
                            <tr>
                              <td style="padding: 16px 24px 24px 24px; font-size: 12px; color: #9aa3c7;">
                                Sent by ToolHub MovieHub Automation
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </body>
                </html>
                """.formatted(safeBadge, safeHeading, safeLead, posterBlock, safeTitle, safeType, safeQuality, seasonRow);
    }

    private String toMediaTypeLabel(MediaType mediaType) {
        if (MediaType.SHOWS.equals(mediaType)) {
            return "Series";
        }
        if (MediaType.MOVIES.equals(mediaType)) {
            return "Movie";
        }
        return "Media";
    }

    private String toQualityLabel(String qualityProfileId) {
        if (qualityProfileId == null || qualityProfileId.isBlank()) {
            return "Any";
        }
        return switch (qualityProfileId.trim().toLowerCase()) {
            case "720p" -> "HD 720p";
            case "1080p" -> "HD 1080p";
            default -> "Any";
        };
    }

    private String formatSeasons(List<Integer> seasons) {
        if (seasons == null || seasons.isEmpty()) {
            return "All monitored seasons";
        }
        return seasons.stream()
                .sorted()
                .map(String::valueOf)
                .collect(Collectors.joining(", "));
    }

    private String escapeHtml(String input) {
        if (input == null) {
            return "";
        }
        return input
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    private JsonArray normalizeLookupResults(JsonArray results, MediaType mediaType) {
        JsonArray normalized = new JsonArray();
        if (results == null || results.isEmpty()) {
            return normalized;
        }
        for (Object item : results) {
            if (!(item instanceof JsonObject lookupItem)) {
                continue;
            }
            if (mediaType == MediaType.MOVIES) {
                normalized.add(normalizeMovieLookup(lookupItem));
            } else if (mediaType == MediaType.SHOWS) {
                normalized.add(normalizeShowLookup(lookupItem));
            }
        }
        return normalized;
    }

    private JsonObject normalizeMovieLookup(JsonObject lookupItem) {
        return new JsonObject()
                .put("title", lookupItem.getString("title"))
                .put("year", lookupItem.getInteger("year"))
                .put("overview", lookupItem.getString("overview"))
                .put("tmdbId", lookupItem.getInteger("tmdbId"))
                .put("imdbId", lookupItem.getString("imdbId"))
                .put("poster", getPoster(lookupItem))
                .put("mediaType", MediaType.MOVIES.name());
    }

    private JsonObject normalizeShowLookup(JsonObject lookupItem) {
        return new JsonObject()
                .put("title", lookupItem.getString("title"))
                .put("year", lookupItem.getInteger("year"))
                .put("overview", lookupItem.getString("overview"))
                .put("tvdbId", lookupItem.getInteger("tvdbId"))
                .put("imdbId", lookupItem.getString("imdbId"))
                .put("poster", getPoster(lookupItem))
                .put("seasonOptions", getSeasonOptions(lookupItem))
                .put("mediaType", MediaType.SHOWS.name());
    }

    private String getPoster(JsonObject lookupItem) {
        String poster = lookupItem.getString("remotePoster");
        if (poster != null && !poster.isBlank()) {
            return poster;
        }
        JsonArray images = lookupItem.getJsonArray("images", new JsonArray());
        for (Object imageObj : images) {
            if (!(imageObj instanceof JsonObject image)) {
                continue;
            }
            if ("poster".equalsIgnoreCase(image.getString("coverType"))) {
                return image.getString("remoteUrl");
            }
        }
        return "";
    }

    private JsonArray getSeasonOptions(JsonObject lookupItem) {
        JsonArray seasons = lookupItem.getJsonArray("seasons", new JsonArray());
        Set<Integer> seasonSet = new HashSet<>();
        for (Object seasonObj : seasons) {
            if (!(seasonObj instanceof JsonObject seasonJson)) {
                continue;
            }
            Integer seasonNumber = seasonJson.getInteger("seasonNumber");
            if (seasonNumber == null || seasonNumber < 1) {
                continue;
            }
            seasonSet.add(seasonNumber);
        }
        List<Integer> ordered = seasonSet.stream().sorted().toList();
        return new JsonArray(ordered);
    }

    private ParsedCreateRequest parseCreateRequest(JsonObject body) {
        String title = body.getString("title");
        if (title == null || title.trim().isEmpty()) {
            throw new IllegalArgumentException("title is required");
        }
        MediaType mediaType = parseMediaType(body.getString("mediaType"));
        if (mediaType == MediaType.UNKNOWN) {
            throw new IllegalArgumentException("mediaType must be MOVIES or SHOWS");
        }
        String qualityProfileId = body.getString("qualityProfileId", DEFAULT_QUALITY_PROFILE).trim().toLowerCase();
        if (!ALLOWED_QUALITY_PROFILES.contains(qualityProfileId)) {
            throw new IllegalArgumentException("qualityProfileId must be one of: any, 720p, 1080p");
        }
        List<Integer> seasons = new ArrayList<>();
        if (mediaType == MediaType.SHOWS) {
            JsonArray seasonArray = body.getJsonArray("season");
            if (seasonArray == null || seasonArray.isEmpty()) {
                throw new IllegalArgumentException("season is required for mediaType SHOWS");
            }
            Set<Integer> seasonSet = new HashSet<>();
            for (Object seasonObj : seasonArray) {
                Integer seasonNumber = parseSeasonNumber(seasonObj);
                if (seasonNumber < 1) {
                    throw new IllegalArgumentException("season values must be positive integers");
                }
                seasonSet.add(seasonNumber);
            }
            seasons = seasonSet.stream().sorted().toList();
        }
        return new ParsedCreateRequest(title.trim(), mediaType, qualityProfileId, seasons);
    }

    private Integer parseSeasonNumber(Object seasonObj) {
        if (seasonObj == null) {
            throw new IllegalArgumentException("season values cannot be null");
        }
        if (seasonObj instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.valueOf(String.valueOf(seasonObj).trim());
        } catch (Exception e) {
            throw new IllegalArgumentException("season values must be integers");
        }
    }

    private String normalizeQualityProfileId(String qualityRaw) {
        String normalized = qualityRaw == null ? DEFAULT_QUALITY_PROFILE : qualityRaw.trim().toLowerCase();
        if (!ALLOWED_QUALITY_PROFILES.contains(normalized)) {
            return DEFAULT_QUALITY_PROFILE;
        }
        return normalized;
    }

    private List<Integer> normalizeSeasonList(List<Integer> seasons) {
        if (seasons == null || seasons.isEmpty()) {
            return List.of();
        }
        Set<Integer> normalized = new HashSet<>();
        for (Integer season : seasons) {
            Integer parsed = parseSeasonNumber(season);
            if (parsed > 0) {
                normalized.add(parsed);
            }
        }
        return normalized.stream().sorted().toList();
    }

    private MediaType parseMediaType(String mediaTypeRaw) {
        if (mediaTypeRaw == null || mediaTypeRaw.trim().isEmpty()) {
            return MediaType.UNKNOWN;
        }
        String normalized = mediaTypeRaw.trim().toUpperCase();
        if ("MOVIE".equals(normalized)) {
            normalized = MediaType.MOVIES.name();
        } else if ("SHOW".equals(normalized) || "SERIES".equals(normalized)) {
            normalized = MediaType.SHOWS.name();
        }
        try {
            return MediaType.valueOf(normalized);
        } catch (Exception e) {
            return MediaType.UNKNOWN;
        }
    }

    private List<JsonObject> formatRequestRecords(List<JsonObject> records) {
        return records.stream()
                .map(this::sanitizeRequestRecord)
                .sorted(Comparator.comparing(this::extractCreatedAt, Comparator.reverseOrder()))
                .toList();
    }

    private JsonObject sanitizeRequestRecord(JsonObject source) {
        JsonObject sanitized = source.copy();
        sanitized.remove("_id");
        return sanitized;
    }

    private Instant extractCreatedAt(JsonObject request) {
        Object createdAt = request.getValue("createdAt");
        return extractInstantValue(createdAt);
    }

    private Instant extractDownloadedAt(JsonObject request) {
        Object downloadedAt = request.getValue("downloadedAt");
        Instant parsedDownloaded = extractInstantValue(downloadedAt);
        if (!Instant.EPOCH.equals(parsedDownloaded)) {
            return parsedDownloaded;
        }
        Object updatedAt = request.getValue("updatedAt");
        Instant parsedUpdated = extractInstantValue(updatedAt);
        if (!Instant.EPOCH.equals(parsedUpdated)) {
            return parsedUpdated;
        }
        return extractCreatedAt(request);
    }

    private Instant extractInstantValue(Object value) {
        if (value instanceof String stringValue) {
            try {
                return Instant.parse(stringValue);
            } catch (DateTimeParseException ignored) {
                return Instant.EPOCH;
            }
        }
        if (value instanceof JsonObject objectValue) {
            try {
                String date = objectValue.getString("$date");
                if (date != null) {
                    return Instant.parse(date);
                }
            } catch (Exception ignored) {
                return Instant.EPOCH;
            }
        }
        return Instant.EPOCH;
    }

    private record ParsedCreateRequest(
            String title,
            MediaType mediaType,
            String qualityProfileId,
            List<Integer> season
    ) {
    }
}
