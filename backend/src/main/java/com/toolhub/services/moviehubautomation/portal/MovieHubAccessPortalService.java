package com.toolhub.services.moviehubautomation.portal;

import com.toolhub.Utils.Utility;
import com.toolhub.enums.moviehubautomation.MovieHubAccessStatus;
import com.toolhub.enums.user.Role;
import com.toolhub.models.moviehubautomation.MovieHubAccessRequest;
import com.toolhub.models.moviehubautomation.MovieHubAccessUser;
import com.toolhub.services.alerts.MailService;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.CompositeFuture;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.HashSet;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import static com.toolhub.Utils.Constants.MOVIEHUB_ACCESS_REQUESTS_COLLECTION;
import static com.toolhub.Utils.Constants.MOVIEHUB_ACCESS_USERS_COLLECTION;
import static com.toolhub.Utils.Constants.USER_COLLECTION;

public class MovieHubAccessPortalService {
    private static final Logger log = LoggerFactory.getLogger(MovieHubAccessPortalService.class);
    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[a-zA-Z0-9._-]{3,32}$");

    private final MongoDBClient mongoDBClient;
    private final WebClient webClient;
    private final String jellyfinBaseUrl;
    private final String jellyfinPublicUrl;
    private final String jellyfinApiKey;
    private final String movieHubPortalUrl;
    private final String cryptoSecret;

    public MovieHubAccessPortalService(MongoDBClient mongoDBClient,
                                       WebClient webClient,
                                       String jellyfinBaseUrl,
                                       String jellyfinPublicUrl,
                                       String jellyfinApiKey,
                                       String movieHubPortalUrl,
                                       String cryptoSecret) {
        this.mongoDBClient = mongoDBClient;
        this.webClient = webClient;
        this.jellyfinBaseUrl = trimTrailingSlash(jellyfinBaseUrl);
        this.jellyfinPublicUrl = trimTrailingSlash(
                jellyfinPublicUrl == null || jellyfinPublicUrl.isBlank() ? jellyfinBaseUrl : jellyfinPublicUrl
        );
        this.jellyfinApiKey = jellyfinApiKey;
        this.movieHubPortalUrl = trimTrailingSlash(
                movieHubPortalUrl == null || movieHubPortalUrl.isBlank()
                        ? "https://hostingfrompurava.xyz/moviehub"
                        : movieHubPortalUrl
        );
        this.cryptoSecret = cryptoSecret;
    }

    public void handleAccessGuard(RoutingContext context) {
        String path = context.normalizedPath();
        if (path.startsWith("/v2/moviehub/access")
                || "/v2/moviehub/reconcile-downloads".equals(path)) {
            context.next();
            return;
        }

        String role = context.get("role");
        if (Role.ADMIN.name().equalsIgnoreCase(role)) {
            context.next();
            return;
        }

        String userId = context.get("userId");
        if (userId == null || userId.isBlank()) {
            log.warn("MovieHub access guard failed: missing user context path={}", path);
            Utility.buildResponse(context, 401, Utility.createErrorResponse("missing user context"));
            return;
        }

        hasApprovedAccess(userId).onSuccess(hasAccess -> {
            if (Boolean.TRUE.equals(hasAccess)) {
                context.next();
                return;
            }
            log.warn("MovieHub access denied for userId={} path={}", userId, path);
            Utility.buildResponse(
                    context,
                    403,
                    Utility.createErrorResponse("moviehub access is not approved. Please request access first.")
            );
        }).onFailure(fail -> {
            log.error("Failed to validate moviehub access for userId={}", userId, fail);
            Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
        });
    }

    public void handleGetMyAccessStatus(RoutingContext context) {
        String userId = context.get("userId");
        String role = context.get("role");
        log.info("Fetching moviehub access status userId={} role={}", userId, role);
        if (Role.ADMIN.name().equalsIgnoreCase(role)) {
            Utility.buildResponse(context, 200, Utility.createSuccessResponse(new JsonObject()
                    .put("hasAccess", true)
                    .put("status", "ADMIN_BYPASS")
                    .put("isAdmin", true)));
            return;
        }
        getAccessStatus(userId).onSuccess(response -> Utility.buildResponse(
                context,
                200,
                Utility.createSuccessResponse(response)
        )).onFailure(fail -> {
            log.error("Failed to fetch moviehub access status for userId={}", userId, fail);
            Utility.buildResponse(context, 500, Utility.createErrorResponse(
                    resolveErrorMessage(fail, "failed to fetch moviehub access status")));
        });
    }

    public void handleGetAccessUserMapping(RoutingContext context) {
        String userId = context.get("userId");
        log.info("Fetching moviehub access-user mapping for userId={}", userId);
        fetchUserById(userId)
                .compose(user -> {
                    String email = user.getString("email", "").trim();
                    if (email.isBlank()) {
                        return Future.succeededFuture(new JsonObject()
                                .put("userId", userId)
                                .put("exists", false)
                                .put("email", "")
                                .put("movieHubUserName", "")
                                .put("status", "NOT_REQUESTED"));
                    }
                    return CompositeFuture.all(
                            fetchAccessUserByEmail(email),
                            fetchLatestRequestForEmail(email)
                    ).map(result -> {
                        JsonObject mapping = result.resultAt(0);
                        JsonObject latestRequest = result.resultAt(1);
                        if (mapping == null) {
                            String status = latestRequest == null
                                    ? "NOT_REQUESTED"
                                    : latestRequest.getString("status", "NOT_REQUESTED");
                            return new JsonObject()
                                    .put("userId", userId)
                                    .put("exists", false)
                                    .put("email", email)
                                    .put("movieHubUserName", latestRequest == null ? "" :
                                            latestRequest.getString("movieHubUserName", ""))
                                    .put("status", status)
                                    .put("showTemporaryPasswordNotice", false);
                        }
                        boolean showTemporaryPasswordNotice = mapping.getValue("passwordResetConfirmedAt") == null;
                        return new JsonObject()
                                .put("userId", userId)
                                .put("exists", true)
                                .put("email", mapping.getString("userEmail", email))
                                .put("movieHubUserName", mapping.getString("movieHubUserName", ""))
                                .put("status", MovieHubAccessStatus.APPROVED.name())
                                .put("showTemporaryPasswordNotice", showTemporaryPasswordNotice);
                    });
                })
                .onSuccess(response -> {
                    log.info("Fetched moviehub access-user mapping for userId={} exists={} status={}",
                            userId,
                            response.getBoolean("exists", false),
                            response.getString("status", "UNKNOWN"));
                    Utility.buildResponse(
                            context,
                            200,
                            Utility.createSuccessResponse(response)
                    );
                })
                .onFailure(fail -> {
                    String errorMessage = resolveErrorMessage(fail, "failed to fetch moviehub user mapping");
                    log.error("Failed to fetch moviehub user mapping for userId={}", userId, fail);
                    Utility.buildResponse(context, 500, Utility.createErrorResponse(errorMessage));
                });
    }

    public void handleCreateAccessRequest(RoutingContext context) {
        String userId = context.get("userId");
        try {
            JsonObject body = context.body().asJsonObject();
            if (body == null) {
                log.warn("Create moviehub access request failed: empty request body userId={}", userId);
                Utility.buildResponse(context, 400, Utility.createErrorResponse("request body is required"));
                return;
            }
            String rawUsername = body.getString("movieHubUserName", "");
            String normalizedUsername = rawUsername.trim();
            if (!isValidMovieHubUsername(normalizedUsername)) {
                log.warn("Create moviehub access request failed: invalid username format userId={} username={}",
                        userId, normalizedUsername);
                Utility.buildResponse(context, 400, Utility.createErrorResponse(
                        "movieHubUserName must be 3-32 chars using letters, numbers, dot, underscore, or hyphen"));
                return;
            }

            String normalizedLower = normalizedUsername.toLowerCase();
            log.info("Creating moviehub access request userId={} username={}", userId, normalizedUsername);
            fetchUserById(userId).compose(user -> {
                        String email = user.getString("email", "").trim();
                        return CompositeFuture.all(
                                fetchAccessUserByEmail(email),
                                fetchPendingAccessRequestForEmail(email),
                                isMovieHubUsernameTaken(normalizedLower, null, true)
                        ).map(result -> {
                            JsonObject existingAccess = result.resultAt(0);
                            JsonObject existingPendingRequest = result.resultAt(1);
                            Boolean usernameTaken = result.resultAt(2);
                            return new JsonObject()
                                    .put("existingAccess", existingAccess)
                                    .put("existingPendingRequest", existingPendingRequest)
                                    .put("usernameTaken", Boolean.TRUE.equals(usernameTaken))
                                    .put("email", email)
                                    .put("name", user.getString("name", user.getString("userName", "")));
                        });
                    }).onSuccess(result -> {
                        JsonObject existingAccess = result.getJsonObject("existingAccess");
                        JsonObject existingPendingRequest = result.getJsonObject("existingPendingRequest");
                        boolean usernameTaken = result.getBoolean("usernameTaken", false);

                        if (existingAccess != null) {
                            log.warn("Create moviehub access request conflict: access already approved userId={}", userId);
                            Utility.buildResponse(context, 409,
                                    Utility.createErrorResponse("moviehub access is already approved for this user"));
                            return;
                        }
                        if (existingPendingRequest != null) {
                            log.warn("Create moviehub access request conflict: pending request already exists userId={}", userId);
                            Utility.buildResponse(context, 409,
                                    Utility.createErrorResponse("moviehub access request is already pending approval"));
                            return;
                        }
                        if (usernameTaken) {
                            log.warn("Create moviehub access request conflict: username already in use userId={} username={}",
                                    userId, normalizedUsername);
                            Utility.buildResponse(context, 409,
                                    Utility.createErrorResponse("moviehub username is already in use"));
                            return;
                        }

                        String temporaryPassword = generateTemporaryPassword();
                        String encryptedPassword;
                        try {
                            encryptedPassword = encryptPassword(temporaryPassword);
                        } catch (Exception encryptionFail) {
                            log.error("Failed to encrypt moviehub request password userId={}", userId, encryptionFail);
                            Utility.buildResponse(context, 500, Utility.createErrorResponse("failed to secure password"));
                            return;
                        }

                        Instant now = Instant.now();
                        MovieHubAccessRequest accessRequest = new MovieHubAccessRequest();
                        accessRequest.setRequestId(UUID.randomUUID().toString());
                        accessRequest.setUserId(userId);
                        accessRequest.setUserEmail(result.getString("email"));
                        accessRequest.setUserName(result.getString("name"));
                        accessRequest.setMovieHubUserName(normalizedUsername);
                        accessRequest.setMovieHubUserNameLower(normalizedLower);
                        accessRequest.setEncryptedPassword(encryptedPassword);
                        accessRequest.setStatus(MovieHubAccessStatus.PENDING);
                        accessRequest.setCreatedAt(now);
                        accessRequest.setUpdatedAt(now);

                        mongoDBClient.insertRecord(
                                        JsonObject.mapFrom(accessRequest),
                                        MOVIEHUB_ACCESS_REQUESTS_COLLECTION
                                ).onSuccess(inserted -> {
                                    log.info("Created moviehub access request requestId={} userId={} username={}",
                                            accessRequest.getRequestId(), userId, normalizedUsername);
                                    Utility.buildResponse(
                                            context,
                                            201,
                                            Utility.createSuccessResponse(new JsonObject()
                                                    .put("message", "moviehub access request submitted")
                                                    .put("requestId", accessRequest.getRequestId())
                                                    .put("status", accessRequest.getStatus().name())
                                                    .put("movieHubUserName", accessRequest.getMovieHubUserName())
                                            )
                                    );
                                })
                                .onFailure(fail -> {
                                    String errorMessage = resolveErrorMessage(fail, "failed to create moviehub access request");
                                    log.error("Failed to create moviehub access request userId={} username={}",
                                            userId, normalizedUsername, fail);
                                    Utility.buildResponse(context, 500, Utility.createErrorResponse(errorMessage));
                                });
                    })
                    .onFailure(fail -> {
                        String errorMessage = resolveErrorMessage(fail, "failed to validate moviehub access request");
                        log.error("Failed to validate moviehub access request for userId={} username={}",
                                userId, normalizedUsername, fail);
                        Utility.buildResponse(context, 500, Utility.createErrorResponse(errorMessage));
                    });
        } catch (Exception exception) {
            log.error("Unexpected error while parsing moviehub access request userId={}", userId, exception);
            Utility.buildResponse(context, 400, Utility.createErrorResponse("invalid request payload"));
        }
    }

    public void handleGetAccessRequests(RoutingContext context) {
        String statusFilter = context.request().getParam("status");
        log.info("Fetching moviehub access requests statusFilter={}", statusFilter);
        JsonObject query = new JsonObject();
        if (statusFilter != null && !statusFilter.isBlank()) {
            try {
                MovieHubAccessStatus status = MovieHubAccessStatus.valueOf(statusFilter.trim().toUpperCase());
                query.put("status", status.name());
            } catch (Exception e) {
                log.warn("Invalid moviehub access request status filter={}", statusFilter);
                Utility.buildResponse(context, 400, Utility.createErrorResponse("invalid status filter"));
                return;
            }
        }
        mongoDBClient.queryRecords(query, MOVIEHUB_ACCESS_REQUESTS_COLLECTION)
                .onSuccess(records -> {
                    List<JsonObject> sorted = records.stream()
                            .map(this::sanitizeRecord)
                            .sorted(Comparator.comparing(this::extractCreatedAt, Comparator.reverseOrder()))
                            .toList();
                    log.info("Fetched moviehub access requests count={} statusFilter={}", sorted.size(), statusFilter);
                    Utility.buildResponse(context, 200, Utility.createSuccessResponse(sorted));
                })
                .onFailure(fail -> {
                    String errorMessage = resolveErrorMessage(fail, "failed to fetch moviehub access requests");
                    log.error("Failed to fetch moviehub access requests statusFilter={}", statusFilter, fail);
                    Utility.buildResponse(context, 500, Utility.createErrorResponse(errorMessage));
                });
    }

    public void handleApproveAccessRequest(RoutingContext context) {
        String requestId = context.pathParam("requestId");
        String adminUserId = context.get("userId");
        if (requestId == null || requestId.isBlank()) {
            log.warn("Approve moviehub access request failed: missing requestId adminUserId={}", adminUserId);
            Utility.buildResponse(context, 400, Utility.createErrorResponse("requestId is required"));
            return;
        }
        log.info("Approving moviehub access request requestId={} adminUserId={}", requestId, adminUserId);

        fetchAccessRequestById(requestId)
                .compose(request -> {
                    if (!MovieHubAccessStatus.PENDING.equals(request.getStatus())) {
                        return Future.failedFuture("only pending moviehub access requests can be approved");
                    }
                    return CompositeFuture.all(
                                    fetchAccessUserByEmail(request.getUserEmail()),
                                    isMovieHubUsernameTaken(request.getMovieHubUserNameLower(), request.getRequestId(), false)
                            )
                            .compose(result -> {
                                JsonObject existingAccess = result.resultAt(0);
                                Boolean usernameTaken = result.resultAt(1);
                                if (existingAccess != null) {
                                    return Future.failedFuture("user already has moviehub access");
                                }
                                if (Boolean.TRUE.equals(usernameTaken)) {
                                    return Future.failedFuture("moviehub username is already in use");
                                }
                                String decryptedPassword;
                                try {
                                    decryptedPassword = decryptPassword(request.getEncryptedPassword());
                                } catch (Exception decryptFail) {
                                    return Future.failedFuture("failed to decrypt requested password");
                                }
                                return createJellyfinUser(request.getMovieHubUserName(), decryptedPassword)
                                        .compose(jellyfinUser -> {
                                            String jellyfinUserId = jellyfinUser.getString("Id");
                                            if (jellyfinUserId == null || jellyfinUserId.isBlank()) {
                                                return Future.failedFuture("jellyfin user id is missing");
                                            }
                                            return enforceJellyfinLimitedLibraryAccess(jellyfinUserId)
                                                    .compose(v -> createAccessMapping(request, adminUserId, jellyfinUserId))
                                                    .compose(v -> markAccessRequestApproved(request, adminUserId, jellyfinUserId))
                                                    .compose(v -> sendMovieHubCredentialsEmail(request, decryptedPassword))
                                                    .compose(v -> markCredentialsSent(request.getRequestId()))
                                                    .map(new JsonObject()
                                                            .put("message", "moviehub access approved and jellyfin user created")
                                                            .put("requestId", request.getRequestId())
                                                            .put("movieHubUserName", request.getMovieHubUserName())
                                                            .put("notification", "sent"));
                                        });
                            });
                })
                .onSuccess(response -> {
                    log.info("Approved moviehub access request requestId={} adminUserId={} notification={}",
                            requestId, adminUserId, response.getString("notification", "unknown"));
                    Utility.buildResponse(context, 200, Utility.createSuccessResponse(response));
                })
                .onFailure(fail -> {
                    String message = resolveErrorMessage(fail, "failed to approve access request");
                    int statusCode = message.toLowerCase().contains("not found") ? 404 :
                            (message.toLowerCase().contains("pending")
                                    || message.toLowerCase().contains("already")
                                    || message.toLowerCase().contains("required")) ? 400 : 500;
                    log.error("Failed to approve moviehub access request requestId={}", requestId, fail);
                    Utility.buildResponse(context, statusCode, Utility.createErrorResponse(message));
                });
    }

    public void handleRejectAccessRequest(RoutingContext context) {
        String requestId = context.pathParam("requestId");
        String adminUserId = context.get("userId");
        if (requestId == null || requestId.isBlank()) {
            log.warn("Reject moviehub access request failed: missing requestId adminUserId={}", adminUserId);
            Utility.buildResponse(context, 400, Utility.createErrorResponse("requestId is required"));
            return;
        }
        log.info("Rejecting moviehub access request requestId={} adminUserId={}", requestId, adminUserId);

        fetchAccessRequestById(requestId)
                .compose(request -> {
                    if (!MovieHubAccessStatus.PENDING.equals(request.getStatus())) {
                        return Future.failedFuture("only pending moviehub access requests can be rejected");
                    }
                    JsonObject query = new JsonObject().put("requestId", requestId);
                    Instant now = Instant.now();
                    JsonObject update = new JsonObject().put("$set", new JsonObject()
                            .put("status", MovieHubAccessStatus.REJECTED.name())
                            .put("rejectedBy", adminUserId)
                            .put("rejectedAt", now)
                            .put("updatedAt", now));
                    return mongoDBClient.updateRecord(query, update, MOVIEHUB_ACCESS_REQUESTS_COLLECTION)
                            .compose(v -> sendMovieHubAccessRejectedEmail(request)
                                    .map(new JsonObject()
                                            .put("message", "moviehub access request rejected")
                                            .put("requestId", requestId)
                                            .put("status", MovieHubAccessStatus.REJECTED.name())
                                            .put("notification", "sent"))
                                    .recover(mailFail -> {
                                        log.error("Failed to send rejection email for moviehub access requestId={}",
                                                requestId, mailFail);
                                        return Future.succeededFuture(new JsonObject()
                                                .put("message", "moviehub access request rejected")
                                                .put("requestId", requestId)
                                                .put("status", MovieHubAccessStatus.REJECTED.name())
                                                .put("notification", "failed"));
                                    }));
                })
                .onSuccess(response -> {
                    log.info("Rejected moviehub access request requestId={} adminUserId={} notification={}",
                            requestId, adminUserId, response.getString("notification", "unknown"));
                    Utility.buildResponse(context, 200, Utility.createSuccessResponse(response));
                })
                .onFailure(fail -> {
                    String message = resolveErrorMessage(fail, "failed to reject access request");
                    int statusCode = message.toLowerCase().contains("not found") ? 404 :
                            (message.toLowerCase().contains("pending")
                                    || message.toLowerCase().contains("required")) ? 400 : 500;
                    log.error("Failed to reject moviehub access request requestId={}", requestId, fail);
                    Utility.buildResponse(context, statusCode, Utility.createErrorResponse(message));
                });
    }

    public void handleGetAccessUsers(RoutingContext context) {
        String adminUserId = context.get("userId");
        log.info("Fetching moviehub access users adminUserId={}", adminUserId);
        JsonObject query = new JsonObject().put("active", true);
        mongoDBClient.queryRecords(query, MOVIEHUB_ACCESS_USERS_COLLECTION)
                .compose(records -> {
                    List<JsonObject> sanitizedRecords = records.stream()
                            .map(this::sanitizeRecord)
                            .toList();
                    Set<String> userIds = sanitizedRecords.stream()
                            .map(record -> record.getString("userId", ""))
                            .filter(value -> !value.isBlank())
                            .collect(java.util.stream.Collectors.toSet());
                    return fetchUserRolesByUserIds(userIds)
                            .map(roleByUserId -> sanitizedRecords.stream()
                                    .map(record -> {
                                        String userId = record.getString("userId", "");
                                        String role = roleByUserId.getString(userId, Role.USER.name());
                                        return record.copy()
                                                .put("roleTag", role)
                                                .put("isAdmin", Role.ADMIN.name().equalsIgnoreCase(role));
                                    })
                                    .sorted(Comparator.comparing(this::extractCreatedAt, Comparator.reverseOrder()))
                                    .toList());
                })
                .onSuccess(users -> {
                    log.info("Fetched moviehub access users count={} adminUserId={}", users.size(), adminUserId);
                    Utility.buildResponse(context, 200, Utility.createSuccessResponse(users));
                })
                .onFailure(fail -> {
                    String message = resolveErrorMessage(fail, "failed to fetch moviehub users");
                    log.error("Failed to fetch moviehub access users adminUserId={}", adminUserId, fail);
                    Utility.buildResponse(context, 500, Utility.createErrorResponse(message));
                });
    }

    public void handleDeleteAccessUser(RoutingContext context) {
        String mappingId = context.pathParam("mappingId");
        String adminUserId = context.get("userId");
        if (mappingId == null || mappingId.isBlank()) {
            log.warn("Delete moviehub access user failed: missing mappingId adminUserId={}", adminUserId);
            Utility.buildResponse(context, 400, Utility.createErrorResponse("mappingId is required"));
            return;
        }
        log.info("Deleting moviehub access user mappingId={} adminUserId={}", mappingId, adminUserId);
        fetchAccessUserByMappingId(mappingId)
                .compose(accessUser -> {
                    String targetUserId = accessUser.getString("userId", "");
                    return fetchUserRoleByUserId(targetUserId).compose(role -> {
                        if (Role.ADMIN.name().equalsIgnoreCase(role)) {
                            return Future.failedFuture("admin users cannot be deleted");
                        }
                        String jellyfinUserId = accessUser.getString("jellyfinUserId", "");
                        return deleteJellyfinUser(jellyfinUserId)
                                .compose(v -> mongoDBClient.deleteRecord(
                                        new JsonObject().put("mappingId", mappingId),
                                        MOVIEHUB_ACCESS_USERS_COLLECTION
                                ))
                                .map(new JsonObject()
                                        .put("message", "moviehub user deleted")
                                        .put("mappingId", mappingId)
                                        .put("movieHubUserName", accessUser.getString("movieHubUserName", ""))
                                        .put("userEmail", accessUser.getString("userEmail", "")));
                    });
                })
                .onSuccess(response -> {
                    log.info("Deleted moviehub access user mappingId={} adminUserId={}", mappingId, adminUserId);
                    Utility.buildResponse(context, 200, Utility.createSuccessResponse(response));
                })
                .onFailure(fail -> {
                    String message = resolveErrorMessage(fail, "failed to delete moviehub user");
                    int statusCode = message.toLowerCase().contains("not found") ? 404 :
                            (message.toLowerCase().contains("admin users cannot be deleted")) ? 403 :
                            (message.toLowerCase().contains("required")
                                    || message.toLowerCase().contains("invalid")) ? 400 : 500;
                    log.error("Failed to delete moviehub access user mappingId={} adminUserId={}",
                            mappingId, adminUserId, fail);
                    Utility.buildResponse(context, statusCode, Utility.createErrorResponse(message));
                });
    }

    private Future<Void> enforceJellyfinLimitedLibraryAccess(String jellyfinUserId) {
        log.info("Enforcing Jellyfin limited library access userId={}", jellyfinUserId);
        return fetchJellyfinVirtualFolders()
                .compose(folders -> {
                    JsonArray allowedFolderIds = resolveAllowedFolderIds(folders);
                    if (allowedFolderIds.isEmpty()) {
                        log.warn("Jellyfin limited library access failed: Movies/TV Shows folders not found userId={}",
                                jellyfinUserId);
                        return Future.failedFuture("failed to locate Movies/TV Shows libraries in Jellyfin");
                    }
                    Set<String> allowedSet = new HashSet<>();
                    for (Object value : allowedFolderIds) {
                        if (value instanceof String id && !id.isBlank()) {
                            allowedSet.add(id);
                        }
                    }
                    JsonArray blockedFolderIds = new JsonArray();
                    for (Object folderObj : folders) {
                        if (folderObj instanceof JsonObject folder) {
                            String id = folder.getString("ItemId");
                            if (id == null || id.isBlank()) {
                                id = folder.getString("Id");
                            }
                            if (id != null && !id.isBlank() && !allowedSet.contains(id)) {
                                blockedFolderIds.add(id);
                            }
                        }
                    }
                    return fetchJellyfinUserPolicy(jellyfinUserId)
                            .compose(existingPolicy -> updateJellyfinUserPolicy(
                                    jellyfinUserId,
                                    existingPolicy,
                                    allowedFolderIds,
                                    blockedFolderIds
                            ));
                })
                .onSuccess(v -> log.info("Applied Jellyfin limited library access userId={}", jellyfinUserId))
                .onFailure(fail -> log.error("Failed to enforce Jellyfin limited library access userId={}",
                        jellyfinUserId, fail));
    }

    private Future<JsonArray> fetchJellyfinVirtualFolders() {
        if (jellyfinBaseUrl == null || jellyfinBaseUrl.isBlank()) {
            return Future.failedFuture("jellyfin base url is not configured");
        }
        if (jellyfinApiKey == null || jellyfinApiKey.isBlank()) {
            return Future.failedFuture("jellyfin api key is not configured");
        }
        Promise<JsonArray> promise = Promise.promise();
        webClient.getAbs(jellyfinBaseUrl + "/Library/VirtualFolders")
                .putHeader("accept", "application/json")
                .putHeader("authorization", buildJellyfinAuthorizationHeader())
                .putHeader("X-Emby-Token", jellyfinApiKey)
                .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
                .putHeader("X-Api-Key", jellyfinApiKey)
                .send()
                .onSuccess(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        String safeBody = truncateResponseBody(response.bodyAsString());
                        promise.fail("failed to fetch jellyfin libraries (status="
                                + response.statusCode() + ", body=" + safeBody + ")");
                        return;
                    }
                    JsonArray folders = response.bodyAsJsonArray();
                    int folderCount = folders == null ? 0 : folders.size();
                    log.info("Fetched Jellyfin virtual folders count={}", folderCount);
                    promise.complete(folders == null ? new JsonArray() : folders);
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private JsonArray resolveAllowedFolderIds(JsonArray folders) {
        String moviesId = null;
        String tvShowsId = null;
        for (Object folderObj : folders) {
            if (!(folderObj instanceof JsonObject folder)) {
                continue;
            }
            String name = folder.getString("Name", "");
            String normalizedName = name.trim().toLowerCase(Locale.ROOT);
            String itemId = folder.getString("ItemId");
            if (itemId == null || itemId.isBlank()) {
                itemId = folder.getString("Id");
            }
            if (itemId == null || itemId.isBlank()) {
                continue;
            }
            if (moviesId == null && "movies".equals(normalizedName)) {
                moviesId = itemId;
            }
            if (tvShowsId == null && ("tv shows".equals(normalizedName) || "tvshows".equals(normalizedName))) {
                tvShowsId = itemId;
            }
        }
        if (moviesId == null || tvShowsId == null) {
            log.warn("Jellyfin exact folder matching incomplete hasMovies={} hasTvShows={}", moviesId != null, tvShowsId != null);
            return new JsonArray();
        }
        JsonArray allowedFolderIds = new JsonArray()
                .add(moviesId)
                .add(tvShowsId);
        log.info("Resolved Jellyfin allowed folders for Movies/TV Shows count={}", allowedFolderIds.size());
        return allowedFolderIds;
    }

    private Future<JsonObject> fetchJellyfinUserPolicy(String jellyfinUserId) {
        if (jellyfinBaseUrl == null || jellyfinBaseUrl.isBlank()) {
            return Future.failedFuture("jellyfin base url is not configured");
        }
        if (jellyfinApiKey == null || jellyfinApiKey.isBlank()) {
            return Future.failedFuture("jellyfin api key is not configured");
        }
        Promise<JsonObject> promise = Promise.promise();
        webClient.getAbs(jellyfinBaseUrl + "/Users/" + jellyfinUserId)
                .putHeader("accept", "application/json")
                .putHeader("authorization", buildJellyfinAuthorizationHeader())
                .putHeader("X-Emby-Token", jellyfinApiKey)
                .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
                .putHeader("X-Api-Key", jellyfinApiKey)
                .send()
                .onSuccess(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        String safeBody = truncateResponseBody(response.bodyAsString());
                        promise.fail("failed to fetch jellyfin user policy (status="
                                + response.statusCode() + ", body=" + safeBody + ")");
                        return;
                    }
                    JsonObject user = response.bodyAsJsonObject();
                    JsonObject policy = user == null ? null : user.getJsonObject("Policy");
                    log.info("Fetched Jellyfin user policy userId={} hasPolicy={}", jellyfinUserId, policy != null);
                    promise.complete(policy == null ? new JsonObject() : policy);
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<Void> updateJellyfinUserPolicy(String jellyfinUserId,
                                                  JsonObject existingPolicy,
                                                  JsonArray enabledFolders,
                                                  JsonArray blockedFolders) {
        if (jellyfinBaseUrl == null || jellyfinBaseUrl.isBlank()) {
            return Future.failedFuture("jellyfin base url is not configured");
        }
        if (jellyfinApiKey == null || jellyfinApiKey.isBlank()) {
            return Future.failedFuture("jellyfin api key is not configured");
        }
        JsonObject policyPayload = existingPolicy == null ? new JsonObject() : existingPolicy.copy();
        policyPayload
                .put("EnableAllFolders", false)
                .put("EnabledFolders", enabledFolders)
                .put("BlockedMediaFolders", blockedFolders)
                // Disable Live TV surface for MovieHub users
                .put("EnableLiveTvAccess", false)
                .put("EnableLiveTvManagement", false)
                .put("EnableAllChannels", false)
                .put("EnabledChannels", new JsonArray());
        Promise<Void> promise = Promise.promise();
        webClient.postAbs(jellyfinBaseUrl + "/Users/" + jellyfinUserId + "/Policy")
                .putHeader("accept", "application/json")
                .putHeader("Content-Type", "application/json")
                .putHeader("authorization", buildJellyfinAuthorizationHeader())
                .putHeader("X-Emby-Token", jellyfinApiKey)
                .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
                .putHeader("X-Api-Key", jellyfinApiKey)
                .sendJsonObject(policyPayload)
                .onSuccess(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        String safeBody = truncateResponseBody(response.bodyAsString());
                        promise.fail("failed to update jellyfin user policy (status="
                                + response.statusCode() + ", body=" + safeBody + ")");
                        return;
                    }
                    log.info("Updated Jellyfin user policy userId={} enabledFolders={} blockedFolders={}",
                            jellyfinUserId, enabledFolders.size(), blockedFolders.size());
                    promise.complete();
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    public void handleResendTemporaryPassword(RoutingContext context) {
        String userId = context.get("userId");
        log.info("Resending moviehub temporary password userId={}", userId);
        fetchUserById(userId)
                .compose(user -> {
                    String email = user.getString("email", "").trim();
                    if (email.isBlank()) {
                        return Future.failedFuture("user email is missing");
                    }
                    return CompositeFuture.all(
                            fetchAccessUserByEmail(email),
                            fetchLatestApprovedAccessRequestForEmail(email)
                    ).compose(result -> {
                        JsonObject accessUser = result.resultAt(0);
                        MovieHubAccessRequest approvedRequest = result.resultAt(1);
                        if (accessUser == null) {
                            return Future.failedFuture("moviehub access is not approved for this user");
                        }
                        if (approvedRequest == null) {
                            return Future.failedFuture("no approved moviehub access request found");
                        }
                        String decryptedPassword;
                        try {
                            decryptedPassword = decryptPassword(approvedRequest.getEncryptedPassword());
                        } catch (Exception decryptFail) {
                            return Future.failedFuture("failed to decrypt temporary password");
                        }
                        approvedRequest.setMovieHubUserName(accessUser.getString(
                                "movieHubUserName",
                                approvedRequest.getMovieHubUserName()
                        ));
                        return sendMovieHubCredentialsEmail(approvedRequest, decryptedPassword)
                                .compose(v -> markCredentialsSent(approvedRequest.getRequestId()))
                                .compose(v -> clearPasswordResetConfirmationByEmail(email))
                                .map(new JsonObject()
                                        .put("message", "temporary password resent to your email")
                                        .put("movieHubUserName", approvedRequest.getMovieHubUserName())
                                        .put("userEmail", approvedRequest.getUserEmail()));
                    });
                })
                .onSuccess(response -> {
                    log.info("Resent moviehub temporary password userId={} username={}", userId,
                            response.getString("movieHubUserName", ""));
                    Utility.buildResponse(context, 200, Utility.createSuccessResponse(response));
                })
                .onFailure(fail -> {
                    String message = resolveErrorMessage(fail, "failed to resend temporary password");
                    int statusCode = message.toLowerCase().contains("approved")
                            || message.toLowerCase().contains("not found")
                            || message.toLowerCase().contains("missing")
                            ? 400 : 500;
                    log.error("Failed to resend moviehub temporary password userId={}", userId, fail);
                    Utility.buildResponse(context, statusCode, Utility.createErrorResponse(message));
                });
    }

    public void handleConfirmPasswordReset(RoutingContext context) {
        String userId = context.get("userId");
        log.info("Confirming moviehub password reset acknowledgement userId={}", userId);
        fetchUserById(userId)
                .compose(user -> {
                    String email = user.getString("email", "").trim();
                    if (email.isBlank()) {
                        return Future.failedFuture("user email is missing");
                    }
                    return fetchAccessUserByEmail(email)
                            .compose(accessUser -> {
                                if (accessUser == null) {
                                    return Future.failedFuture("moviehub access is not approved for this user");
                                }
                                String mappingId = accessUser.getString("mappingId", "");
                                if (mappingId.isBlank()) {
                                    return Future.failedFuture("moviehub access mapping is invalid");
                                }
                                return markPasswordResetConfirmed(mappingId)
                                        .map(new JsonObject()
                                                .put("message", "password reset marked as completed")
                                                .put("showTemporaryPasswordNotice", false));
                            });
                })
                .onSuccess(response -> {
                    log.info("Confirmed moviehub password reset acknowledgement userId={}", userId);
                    Utility.buildResponse(context, 200, Utility.createSuccessResponse(response));
                })
                .onFailure(fail -> {
                    String message = resolveErrorMessage(fail, "failed to mark password reset confirmation");
                    int statusCode = message.toLowerCase().contains("approved")
                            || message.toLowerCase().contains("missing")
                            || message.toLowerCase().contains("invalid")
                            ? 400 : 500;
                    log.error("Failed to confirm password reset userId={}", userId, fail);
                    Utility.buildResponse(context, statusCode, Utility.createErrorResponse(message));
                });
    }

    public Future<Boolean> hasApprovedAccess(String userId) {
        if (userId == null || userId.isBlank()) {
            return Future.succeededFuture(false);
        }
        return fetchUserById(userId)
                .compose(user -> fetchAccessUserByEmail(user.getString("email", "").trim()))
                .map(accessUser -> accessUser != null)
                .recover(fail -> Future.succeededFuture(false));
    }

    public Future<JsonObject> getAccessStatus(String userId) {
        return fetchUserById(userId).compose(user -> {
            String email = user.getString("email", "").trim();
            return CompositeFuture.all(
                    fetchAccessUserByEmail(email),
                    fetchLatestRequestForEmail(email)
            ).map(result -> {
            JsonObject approvedAccess = result.resultAt(0);
            JsonObject latestRequest = result.resultAt(1);
            if (approvedAccess != null) {
                boolean showTemporaryPasswordNotice = approvedAccess.getValue("passwordResetConfirmedAt") == null;
                return new JsonObject()
                        .put("hasAccess", true)
                        .put("status", MovieHubAccessStatus.APPROVED.name())
                        .put("exists", true)
                        .put("email", approvedAccess.getString("userEmail", email))
                        .put("movieHubUserName", approvedAccess.getString("movieHubUserName"))
                        .put("approvedAt", approvedAccess.getValue("approvedAt"))
                        .put("requestId", approvedAccess.getString("requestId"))
                        .put("showTemporaryPasswordNotice", showTemporaryPasswordNotice);
            }
            if (latestRequest != null) {
                return new JsonObject()
                        .put("hasAccess", false)
                        .put("exists", false)
                        .put("email", email)
                        .put("status", latestRequest.getString("status", MovieHubAccessStatus.PENDING.name()))
                        .put("movieHubUserName", latestRequest.getString("movieHubUserName"))
                        .put("requestId", latestRequest.getString("requestId"))
                        .put("requestedAt", latestRequest.getValue("createdAt"))
                        .put("showTemporaryPasswordNotice", false);
            }
            return new JsonObject()
                    .put("hasAccess", false)
                    .put("exists", false)
                    .put("email", email)
                    .put("status", "NOT_REQUESTED")
                    .put("showTemporaryPasswordNotice", false);
            });
        });
    }

    private Future<JsonObject> fetchAccessUserByEmail(String email) {
        if (email == null || email.isBlank()) {
            return Future.succeededFuture(null);
        }
        JsonObject query = new JsonObject()
                .put("userEmail", email)
                .put("active", true);
        Promise<JsonObject> promise = Promise.promise();
        mongoDBClient.queryRecords(query, MOVIEHUB_ACCESS_USERS_COLLECTION)
                .onSuccess(records -> promise.complete(records == null || records.isEmpty() ? null : sanitizeRecord(records.get(0))))
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<JsonObject> fetchAccessUserByMappingId(String mappingId) {
        Promise<JsonObject> promise = Promise.promise();
        mongoDBClient.queryRecords(
                        new JsonObject().put("mappingId", mappingId).put("active", true),
                        MOVIEHUB_ACCESS_USERS_COLLECTION
                )
                .onSuccess(records -> {
                    if (records == null || records.isEmpty()) {
                        promise.fail("moviehub access user not found");
                        return;
                    }
                    promise.complete(sanitizeRecord(records.get(0)));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<JsonObject> fetchUserRolesByUserIds(Set<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Future.succeededFuture(new JsonObject());
        }
        Promise<JsonObject> promise = Promise.promise();
        JsonArray userIdList = new JsonArray(userIds.stream().toList());
        JsonObject query = new JsonObject().put("userId", new JsonObject().put("$in", userIdList));
        mongoDBClient.queryRecords(query, USER_COLLECTION)
                .onSuccess(records -> {
                    JsonObject roleByUserId = new JsonObject();
                    for (JsonObject user : records) {
                        String userId = user.getString("userId", "");
                        if (userId.isBlank()) {
                            continue;
                        }
                        String role = user.getString("role", Role.USER.name());
                        roleByUserId.put(userId, role == null || role.isBlank() ? Role.USER.name() : role);
                    }
                    promise.complete(roleByUserId);
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<String> fetchUserRoleByUserId(String userId) {
        if (userId == null || userId.isBlank()) {
            return Future.succeededFuture(Role.USER.name());
        }
        Promise<String> promise = Promise.promise();
        mongoDBClient.queryRecords(new JsonObject().put("userId", userId), USER_COLLECTION)
                .onSuccess(records -> {
                    if (records == null || records.isEmpty()) {
                        promise.complete(Role.USER.name());
                        return;
                    }
                    String role = records.get(0).getString("role", Role.USER.name());
                    promise.complete(role == null || role.isBlank() ? Role.USER.name() : role);
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<JsonObject> fetchPendingAccessRequestForEmail(String email) {
        JsonObject query = new JsonObject()
                .put("userEmail", email)
                .put("status", MovieHubAccessStatus.PENDING.name());
        Promise<JsonObject> promise = Promise.promise();
        mongoDBClient.queryRecords(query, MOVIEHUB_ACCESS_REQUESTS_COLLECTION)
                .onSuccess(records -> {
                    if (records == null || records.isEmpty()) {
                        promise.complete(null);
                        return;
                    }
                    promise.complete(records.stream()
                            .map(this::sanitizeRecord)
                            .max(Comparator.comparing(this::extractCreatedAt))
                            .orElse(null));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<JsonObject> fetchLatestRequestForEmail(String email) {
        Promise<JsonObject> promise = Promise.promise();
        mongoDBClient.queryRecords(new JsonObject().put("userEmail", email), MOVIEHUB_ACCESS_REQUESTS_COLLECTION)
                .onSuccess(records -> {
                    if (records == null || records.isEmpty()) {
                        promise.complete(null);
                        return;
                    }
                    JsonObject latest = records.stream()
                            .map(this::sanitizeRecord)
                            .max(Comparator.comparing(this::extractCreatedAt))
                            .orElse(null);
                    promise.complete(latest);
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<MovieHubAccessRequest> fetchLatestApprovedAccessRequestForEmail(String email) {
        Promise<MovieHubAccessRequest> promise = Promise.promise();
        mongoDBClient.queryRecords(
                        new JsonObject()
                                .put("userEmail", email)
                                .put("status", MovieHubAccessStatus.APPROVED.name()),
                        MOVIEHUB_ACCESS_REQUESTS_COLLECTION
                )
                .onSuccess(records -> {
                    if (records == null || records.isEmpty()) {
                        promise.complete(null);
                        return;
                    }
                    JsonObject latest = records.stream()
                            .max(Comparator.comparing(this::extractCreatedAt))
                            .orElse(null);
                    if (latest == null) {
                        promise.complete(null);
                        return;
                    }
                    promise.complete(latest.mapTo(MovieHubAccessRequest.class));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<Boolean> isMovieHubUsernameTaken(String normalizedUsernameLower,
                                                    String excludeRequestId,
                                                    boolean includeJellyfinUsers) {
        Future<List<JsonObject>> activeUsersFuture = mongoDBClient.queryRecords(
                new JsonObject().put("movieHubUserNameLower", normalizedUsernameLower).put("active", true),
                MOVIEHUB_ACCESS_USERS_COLLECTION
        );
        JsonObject pendingQuery = new JsonObject()
                .put("movieHubUserNameLower", normalizedUsernameLower)
                .put("status", MovieHubAccessStatus.PENDING.name());
        if (excludeRequestId != null && !excludeRequestId.isBlank()) {
            pendingQuery.put("requestId", new JsonObject().put("$ne", excludeRequestId));
        }
        Future<List<JsonObject>> pendingRequestsFuture = mongoDBClient.queryRecords(
                pendingQuery,
                MOVIEHUB_ACCESS_REQUESTS_COLLECTION
        );
        Future<JsonObject> jellyfinUserFuture = includeJellyfinUsers
                ? fetchJellyfinUserByName(normalizedUsernameLower)
                : Future.succeededFuture(null);
        return CompositeFuture.all(activeUsersFuture, pendingRequestsFuture, jellyfinUserFuture)
                .map(result -> {
                    List<JsonObject> activeUsers = result.resultAt(0);
                    List<JsonObject> pendingRequests = result.resultAt(1);
                    JsonObject jellyfinUser = result.resultAt(2);
                    return (activeUsers != null && !activeUsers.isEmpty())
                            || (pendingRequests != null && !pendingRequests.isEmpty())
                            || jellyfinUser != null;
                });
    }

    private Future<JsonObject> fetchUserById(String userId) {
        Promise<JsonObject> promise = Promise.promise();
        mongoDBClient.queryRecords(new JsonObject().put("userId", userId), USER_COLLECTION)
                .onSuccess(users -> {
                    if (users == null || users.isEmpty()) {
                        promise.fail("requesting user not found");
                        return;
                    }
                    promise.complete(users.get(0));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<MovieHubAccessRequest> fetchAccessRequestById(String requestId) {
        Promise<MovieHubAccessRequest> promise = Promise.promise();
        mongoDBClient.queryRecords(new JsonObject().put("requestId", requestId), MOVIEHUB_ACCESS_REQUESTS_COLLECTION)
                .onSuccess(records -> {
                    if (records == null || records.isEmpty()) {
                        promise.fail("moviehub access request not found");
                        return;
                    }
                    promise.complete(records.get(0).mapTo(MovieHubAccessRequest.class));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<Void> createAccessMapping(MovieHubAccessRequest request, String adminUserId, String jellyfinUserId) {
        Instant now = Instant.now();
        MovieHubAccessUser accessUser = new MovieHubAccessUser();
        accessUser.setMappingId(UUID.randomUUID().toString());
        accessUser.setRequestId(request.getRequestId());
        accessUser.setUserId(request.getUserId());
        accessUser.setUserEmail(request.getUserEmail());
        accessUser.setUserName(request.getUserName());
        accessUser.setMovieHubUserName(request.getMovieHubUserName());
        accessUser.setMovieHubUserNameLower(request.getMovieHubUserNameLower());
        accessUser.setJellyfinUserId(jellyfinUserId);
        accessUser.setApprovedBy(adminUserId);
        accessUser.setApprovedAt(now);
        accessUser.setPasswordResetConfirmedAt(null);
        accessUser.setCreatedAt(now);
        accessUser.setUpdatedAt(now);
        accessUser.setActive(true);
        return mongoDBClient.insertRecord(
                JsonObject.mapFrom(accessUser),
                MOVIEHUB_ACCESS_USERS_COLLECTION
        );
    }

    private Future<Void> markAccessRequestApproved(MovieHubAccessRequest request, String adminUserId, String jellyfinUserId) {
        JsonObject query = new JsonObject().put("requestId", request.getRequestId());
        Instant now = Instant.now();
        JsonObject update = new JsonObject().put("$set", new JsonObject()
                .put("status", MovieHubAccessStatus.APPROVED.name())
                .put("approvedBy", adminUserId)
                .put("approvedAt", now)
                .put("jellyfinUserId", jellyfinUserId)
                .put("updatedAt", now));
        return mongoDBClient.updateRecord(query, update, MOVIEHUB_ACCESS_REQUESTS_COLLECTION);
    }

    private Future<Void> markCredentialsSent(String requestId) {
        JsonObject query = new JsonObject().put("requestId", requestId);
        Instant now = Instant.now();
        JsonObject update = new JsonObject().put("$set", new JsonObject()
                .put("credentialsSentAt", now)
                .put("updatedAt", now));
        return mongoDBClient.updateRecord(query, update, MOVIEHUB_ACCESS_REQUESTS_COLLECTION);
    }

    private Future<Void> markPasswordResetConfirmed(String mappingId) {
        JsonObject query = new JsonObject().put("mappingId", mappingId);
        Instant now = Instant.now();
        JsonObject update = new JsonObject().put("$set", new JsonObject()
                .put("passwordResetConfirmedAt", now)
                .put("updatedAt", now));
        return mongoDBClient.updateRecord(query, update, MOVIEHUB_ACCESS_USERS_COLLECTION);
    }

    private Future<Void> clearPasswordResetConfirmationByEmail(String email) {
        JsonObject query = new JsonObject()
                .put("userEmail", email)
                .put("active", true);
        Instant now = Instant.now();
        JsonObject update = new JsonObject().put("$set", new JsonObject()
                .put("passwordResetConfirmedAt", null)
                .put("updatedAt", now));
        return mongoDBClient.updateRecord(query, update, MOVIEHUB_ACCESS_USERS_COLLECTION);
    }

    private Future<JsonObject> createJellyfinUser(String username, String password) {
        if (jellyfinBaseUrl == null || jellyfinBaseUrl.isBlank()) {
            return Future.failedFuture("jellyfin base url is not configured");
        }
        if (jellyfinApiKey == null || jellyfinApiKey.isBlank()) {
            return Future.failedFuture("jellyfin api key is not configured");
        }
        log.info("Creating Jellyfin user username={}", username);

        Promise<JsonObject> promise = Promise.promise();
        JsonObject payload = new JsonObject()
                .put("Name", username)
                .put("Password", password);
        webClient.postAbs(jellyfinBaseUrl + "/Users/New")
                .putHeader("accept", "application/json")
                .putHeader("Content-Type", "application/json")
                .putHeader("authorization", buildJellyfinAuthorizationHeader())
                .putHeader("X-Emby-Token", jellyfinApiKey)
                .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
                .putHeader("X-Api-Key", jellyfinApiKey)
                .sendJsonObject(payload)
                .onSuccess(createResponse -> {
                    if (createResponse.statusCode() < 200 || createResponse.statusCode() >= 300) {
                        String responseBody = createResponse.bodyAsString();
                        if (isJellyfinUserAlreadyExists(createResponse.statusCode(), responseBody)) {
                            log.info("Jellyfin user already exists username={}. Reusing existing user.", username);
                            fetchJellyfinUserByName(username)
                                    .onSuccess(existingUser -> {
                                        if (existingUser == null) {
                                            promise.fail("jellyfin reported existing user but user lookup failed");
                                            return;
                                        }
                                        log.info("Resolved existing Jellyfin user username={} userId={}",
                                                username, existingUser.getString("Id", ""));
                                        promise.complete(existingUser);
                                    })
                                    .onFailure(fail -> promise.fail(fail.getMessage()));
                            return;
                        }
                        String safeBody = truncateResponseBody(responseBody);
                        promise.fail("failed to create jellyfin user (status="
                                + createResponse.statusCode() + ", body=" + safeBody + ")");
                        return;
                    }
                    JsonObject createdUser = createResponse.bodyAsJsonObject();
                    if (createdUser != null && !createdUser.getString("Id", "").isBlank()) {
                        log.info("Created Jellyfin user username={} userId={}", username, createdUser.getString("Id"));
                        promise.complete(createdUser);
                        return;
                    }

                    // fallback: if API omits the user body, resolve via user list by username
                    fetchJellyfinUserByName(username)
                            .onSuccess(existingUser -> {
                                if (existingUser == null) {
                                    promise.fail("created jellyfin user but user id not found");
                                    return;
                                }
                                log.info("Resolved Jellyfin user via fallback username={} userId={}",
                                        username, existingUser.getString("Id", ""));
                                promise.complete(existingUser);
                            })
                            .onFailure(fail -> promise.fail(fail.getMessage()));
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<JsonObject> fetchJellyfinUserByName(String username) {
        if (jellyfinBaseUrl == null || jellyfinBaseUrl.isBlank()) {
            return Future.failedFuture("jellyfin base url is not configured");
        }
        if (jellyfinApiKey == null || jellyfinApiKey.isBlank()) {
            return Future.failedFuture("jellyfin api key is not configured");
        }
        Promise<JsonObject> promise = Promise.promise();
        webClient.getAbs(jellyfinBaseUrl + "/Users")
                .putHeader("accept", "application/json")
                .putHeader("authorization", buildJellyfinAuthorizationHeader())
                .putHeader("X-Emby-Token", jellyfinApiKey)
                .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
                .putHeader("X-Api-Key", jellyfinApiKey)
                .send()
                .onSuccess(usersResponse -> {
                    if (usersResponse.statusCode() < 200 || usersResponse.statusCode() >= 300) {
                        String safeBody = truncateResponseBody(usersResponse.bodyAsString());
                        promise.fail("failed to fetch jellyfin users (status="
                                + usersResponse.statusCode() + ", body=" + safeBody + ")");
                        return;
                    }
                    JsonArray users = usersResponse.bodyAsJsonArray();
                    if (users != null) {
                        for (Object userObj : users) {
                            if (userObj instanceof JsonObject userJson) {
                                if (username.equalsIgnoreCase(userJson.getString("Name", ""))) {
                                    log.info("Found Jellyfin user by username={} userId={}",
                                            username, userJson.getString("Id", ""));
                                    promise.complete(userJson);
                                    return;
                                }
                            }
                        }
                    }
                    log.info("No Jellyfin user found by username={}", username);
                    promise.complete(null);
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<Void> deleteJellyfinUser(String jellyfinUserId) {
        if (jellyfinUserId == null || jellyfinUserId.isBlank()) {
            return Future.succeededFuture();
        }
        if (jellyfinBaseUrl == null || jellyfinBaseUrl.isBlank()) {
            return Future.failedFuture("jellyfin base url is not configured");
        }
        if (jellyfinApiKey == null || jellyfinApiKey.isBlank()) {
            return Future.failedFuture("jellyfin api key is not configured");
        }

        Promise<Void> promise = Promise.promise();
        webClient.deleteAbs(jellyfinBaseUrl + "/Users/" + jellyfinUserId)
                .putHeader("accept", "*/*")
                .putHeader("authorization", buildJellyfinAuthorizationHeader())
                .putHeader("X-Emby-Token", jellyfinApiKey)
                .putHeader("X-MediaBrowser-Token", jellyfinApiKey)
                .putHeader("X-Api-Key", jellyfinApiKey)
                .send()
                .onSuccess(response -> {
                    if (response.statusCode() == 404) {
                        log.warn("Jellyfin user already missing userId={}", jellyfinUserId);
                        promise.complete();
                        return;
                    }
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        String safeBody = truncateResponseBody(response.bodyAsString());
                        promise.fail("failed to delete jellyfin user (status="
                                + response.statusCode() + ", body=" + safeBody + ")");
                        return;
                    }
                    log.info("Deleted Jellyfin user userId={}", jellyfinUserId);
                    promise.complete();
                })
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    private Future<Void> sendMovieHubCredentialsEmail(MovieHubAccessRequest request, String userPassword) {
        if (request.getUserEmail() == null || request.getUserEmail().isBlank()) {
            return Future.failedFuture("request email missing");
        }
        log.info("Sending MovieHub approval credentials email requestId={} email={}",
                request.getRequestId(), request.getUserEmail());
        String subject = "MovieHub access approved";
        String htmlBody = buildMovieHubAccessEmail(request, userPassword);
        return new MailService(webClient).sendEmail(subject, request.getUserEmail(), htmlBody)
                .onSuccess(v -> log.info("Sent MovieHub approval credentials email requestId={}",
                        request.getRequestId()))
                .onFailure(fail -> log.error("Failed to send MovieHub approval credentials email requestId={}",
                        request.getRequestId(), fail));
    }

    private Future<Void> sendMovieHubAccessRejectedEmail(MovieHubAccessRequest request) {
        if (request.getUserEmail() == null || request.getUserEmail().isBlank()) {
            return Future.failedFuture("request email missing");
        }
        log.info("Sending MovieHub rejection email requestId={} email={}",
                request.getRequestId(), request.getUserEmail());
        String subject = "MovieHub access request update";
        String htmlBody = buildMovieHubAccessRejectedEmail(request);
        return new MailService(webClient).sendEmail(subject, request.getUserEmail(), htmlBody)
                .onSuccess(v -> log.info("Sent MovieHub rejection email requestId={}", request.getRequestId()))
                .onFailure(fail -> log.error("Failed to send MovieHub rejection email requestId={}",
                        request.getRequestId(), fail));
    }

    private String buildMovieHubAccessEmail(MovieHubAccessRequest request, String password) {
        String safeName = escapeHtml(request.getUserName() == null || request.getUserName().isBlank()
                ? "there" : request.getUserName());
        String safeUserName = escapeHtml(request.getMovieHubUserName());
        String safePassword = escapeHtml(password);
        String safeHost = escapeHtml(jellyfinPublicUrl);
        String safeMovieHubPortal = escapeHtml(movieHubPortalUrl);
        return """
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
                    <meta name="color-scheme" content="light only"/>
                    <meta name="supported-color-schemes" content="light only"/>
                  </head>
                  <body style="margin:0; padding:0; background-color:#edf2f7; font-family:'Segoe UI', Arial, sans-serif; -webkit-text-size-adjust:100%%; -ms-text-size-adjust:100%%;">
                    <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background-color:#edf2f7; padding:16px 8px;">
                      <tr>
                        <td align="center">
                          <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="width:100%%; max-width:640px; border-radius:16px; overflow:hidden; border:1px solid #d9e2f1; background-color:#ffffff;">
                            <tr>
                              <td style="padding:20px 20px 8px 20px;">
                                <span style="display:inline-block; padding:6px 12px; border-radius:999px; background:linear-gradient(90deg, #1d4ed8, #7c3aed); font-size:12px; font-weight:700; color:#ffffff !important;">
                                  MovieHub Access Approved
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 8px 20px; font-size:34px; line-height:1.25; color:#0f172a !important; font-weight:700;">
                                Welcome to MovieHub, %s
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 16px 20px; font-size:17px; line-height:1.6; color:#334155 !important;">
                                Your access request has been approved. Use the credentials below to sign in to your Jellyfin media portal.
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 14px 20px;">
                                <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px;">
                                  <tr>
                                    <td style="padding:12px 14px; font-size:14px; line-height:1.6; color:#334155 !important;">
                                      <strong style="display:block; color:#0f172a !important; margin-bottom:6px;">You can now:</strong>
                                      • Log in and watch all available movies and series on the platform.<br/>
                                      • Raise requests for your favourite movies and series.<br/>
                                      • Use the AI-powered chat assistant to search, check availability, and track requests/downloads.
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 10px 20px; font-size:18px; line-height:1.5; color:#334155 !important;">
                                <strong style="color:#0f172a !important;">MovieHub Username:</strong> %s
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 10px 20px; font-size:18px; line-height:1.5; color:#334155 !important;">
                                <strong style="color:#0f172a !important;">Temporary Password:</strong> %s
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 10px 20px; font-size:18px; line-height:1.5; color:#334155 !important;">
                                <strong style="color:#0f172a !important;">Portal URL:</strong>
                                <a href="%s" style="color:#1d4ed8 !important; text-decoration:underline; word-break:break-all;">%s</a>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 10px 20px; font-size:16px; line-height:1.55; color:#334155 !important;">
                                To request new movie/series downloads, track request status, and use the AI chat assistant, visit:
                                <a href="%s" style="color:#1d4ed8 !important; text-decoration:underline; word-break:break-all;">%s</a>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:8px 20px 20px 20px; font-size:14px; line-height:1.5; color:#64748b !important;">
                                For security, please reset your password after your first login.
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 20px 20px; font-size:14px; line-height:1.5; color:#64748b !important;">
                                If text looks dim, open this email in light mode for best readability.
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </body>
                </html>
                """.formatted(
                safeName,
                safeUserName,
                safePassword,
                safeHost,
                safeHost,
                safeMovieHubPortal,
                safeMovieHubPortal
        );

    }

    private String buildMovieHubAccessRejectedEmail(MovieHubAccessRequest request) {
        String safeName = escapeHtml(request.getUserName() == null || request.getUserName().isBlank()
                ? "there" : request.getUserName());
        String safeUserName = escapeHtml(request.getMovieHubUserName() == null ? "" : request.getMovieHubUserName());
        return """
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
                    <meta name="color-scheme" content="light only"/>
                    <meta name="supported-color-schemes" content="light only"/>
                  </head>
                  <body style="margin:0; padding:0; background-color:#edf2f7; font-family:'Segoe UI', Arial, sans-serif; -webkit-text-size-adjust:100%%; -ms-text-size-adjust:100%%;">
                    <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background-color:#edf2f7; padding:16px 8px;">
                      <tr>
                        <td align="center">
                          <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="width:100%%; max-width:640px; border-radius:16px; overflow:hidden; border:1px solid #d9e2f1; background-color:#ffffff;">
                            <tr>
                              <td style="padding:20px 20px 8px 20px;">
                                <span style="display:inline-block; padding:6px 12px; border-radius:999px; background:#dc2626; font-size:12px; font-weight:700; color:#ffffff !important;">
                                  MovieHub Access Request
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 8px 20px; font-size:30px; line-height:1.25; color:#0f172a !important; font-weight:700;">
                                Hi %s
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 16px 20px; font-size:17px; line-height:1.6; color:#334155 !important;">
                                Your MovieHub access request for username <strong style="color:#0f172a !important;">%s</strong> was not approved at this time.
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0 20px 20px 20px; font-size:15px; line-height:1.6; color:#475569 !important;">
                                You can submit a new access request from ToolHub with a different username.
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </body>
                </html>
                """.formatted(safeName, safeUserName);
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

    private boolean isValidMovieHubUsername(String username) {
        return username != null && USERNAME_PATTERN.matcher(username).matches();
    }

    private String buildJellyfinAuthorizationHeader() {
        return "MediaBrowser Client=\"ToolHub\", Device=\"ToolHub\", DeviceId=\"toolhub-web\", Version=\"10.11.5\", Token=\""
                + jellyfinApiKey + "\"";
    }

    private boolean isJellyfinUserAlreadyExists(int statusCode, String responseBody) {
        if (statusCode != 400 && statusCode != 409) {
            return false;
        }
        if (responseBody == null || responseBody.isBlank()) {
            return false;
        }
        String normalized = responseBody.toLowerCase(Locale.ROOT);
        return normalized.contains("already exists")
                || normalized.contains("already in use")
                || normalized.contains("duplicate");
    }

    private String truncateResponseBody(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) {
            return "<empty>";
        }
        int maxLength = 300;
        if (responseBody.length() <= maxLength) {
            return responseBody;
        }
        return responseBody.substring(0, maxLength) + "...";
    }

    private String resolveErrorMessage(Throwable fail, String fallback) {
        if (fail == null) {
            return fallback;
        }
        String message = fail.getMessage();
        if (message == null || message.isBlank()) {
            return fallback;
        }
        return message;
    }

    private String generateTemporaryPassword() {
        final String charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        final int length = 12;
        SecureRandom random = new SecureRandom();
        StringBuilder password = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            int index = random.nextInt(charset.length());
            password.append(charset.charAt(index));
        }
        return password.toString();
    }

    private String encryptPassword(String plainTextPassword) throws GeneralSecurityException {
        if (cryptoSecret == null || cryptoSecret.isBlank()) {
            throw new GeneralSecurityException("missing encryption secret");
        }
        byte[] key = MessageDigest.getInstance("SHA-256")
                .digest(cryptoSecret.getBytes(StandardCharsets.UTF_8));
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] encrypted = cipher.doFinal(plainTextPassword.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(iv) + ":" + Base64.getEncoder().encodeToString(encrypted);
    }

    private String decryptPassword(String encryptedPayload) throws GeneralSecurityException {
        if (cryptoSecret == null || cryptoSecret.isBlank()) {
            throw new GeneralSecurityException("missing encryption secret");
        }
        if (encryptedPayload == null || encryptedPayload.isBlank() || !encryptedPayload.contains(":")) {
            throw new GeneralSecurityException("invalid encrypted payload");
        }
        String[] parts = encryptedPayload.split(":", 2);
        byte[] iv = Base64.getDecoder().decode(parts[0]);
        byte[] cipherBytes = Base64.getDecoder().decode(parts[1]);
        byte[] key = MessageDigest.getInstance("SHA-256")
                .digest(cryptoSecret.getBytes(StandardCharsets.UTF_8));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] decrypted = cipher.doFinal(cipherBytes);
        return new String(decrypted, StandardCharsets.UTF_8);
    }

    private JsonObject sanitizeRecord(JsonObject source) {
        JsonObject copy = source.copy();
        copy.remove("_id");
        copy.remove("encryptedPassword");
        return copy;
    }

    private Instant extractCreatedAt(JsonObject source) {
        Object createdAt = source.getValue("createdAt");
        if (createdAt instanceof String value) {
            try {
                return Instant.parse(value);
            } catch (DateTimeParseException ignored) {
                return Instant.EPOCH;
            }
        }
        return Instant.EPOCH;
    }

    private String trimTrailingSlash(String value) {
        if (value == null) {
            return null;
        }
        if (value.endsWith("/")) {
            return value.substring(0, value.length() - 1);
        }
        return value;
    }
}
