package com.toolhub.services.user.login;

import com.toolhub.enums.user.Role;
import com.toolhub.models.AuthProvider;
import com.toolhub.models.User;
import com.toolhub.services.jwt.AuthSessionService;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.UUID;

import static com.toolhub.Utils.Constants.DEFAULT_PROFILE_PICTURE;
import static com.toolhub.Utils.Utility.*;

public class GoogleLogin implements Login {
    private static final Logger log = LoggerFactory.getLogger(GoogleLogin.class);

    private final MongoDBClient mongoDBClient;
    private final RoutingContext routingContext;
    private final AuthSessionService authSessionService;
    private final GoogleTokenValidator googleTokenValidator;

    public GoogleLogin(MongoDBClient client, RoutingContext context) {
        this.mongoDBClient = client;
        this.routingContext = context;
        this.authSessionService = new AuthSessionService(client);
        GoogleTokenValidator tokenValidator;
        try {
            tokenValidator = new GoogleTokenValidator();
        } catch (Exception e) {
            log.error("Google login is misconfigured: {}", e.getMessage());
            tokenValidator = null;
        }
        this.googleTokenValidator = tokenValidator;
    }

    private void fetchUser(RoutingContext context, String userId) {
        log.info("Fetching user with userId: {}", userId);
        JsonObject userQuery = new JsonObject().put("userId", userId);

        mongoDBClient.queryRecords(userQuery, "users").onSuccess(userRes -> {
            if (userRes == null || userRes.isEmpty()) {
                log.warn("No user found in users collection for userId: {}", userId);
                buildResponse(context, 404, createErrorResponse("user not found"));
                return;
            }

            JsonObject user = userRes.get(0);
            String userRole = user.getString("role", Role.USER.name());
            String email = user.getString("email", "");

            authSessionService.issueTokens(userId, userRole, email).onSuccess(tokens -> {
                JsonObject response = tokens.copy().put("user", extractRequiredUserInfo(user));
                buildResponse(context, 200, response);

                Instant now = Instant.now();
                JsonObject update = new JsonObject().put("updatedAt", now);
                JsonObject findUpdateQueryObj = new JsonObject().put("userId", userId);
                mongoDBClient.updateRecordAsync(findUpdateQueryObj, update, "users");
                mongoDBClient.updateRecordAsync(findUpdateQueryObj, update, "authprovider");
                log.info("Updated 'updatedAt' field for userId: {} in users and authprovider collections", userId);
            }).onFailure(tokenFail -> {
                log.error("Failed to issue login tokens for userId: {}. Error: {}", userId, tokenFail.getMessage());
                buildResponse(context, 500, createErrorResponse("failed to login"));
            });

        }).onFailure(userFail -> {
            log.error("Failed to fetch user for userId: {}. Error: {}", userId, userFail.getMessage());
            buildResponse(context, 500, createErrorResponse("failed to login"));
        });
    }

    private Future<Void> upsertGoogleUser(String userId, String email, String name, String profilePicture) {
        Promise<Void> promise = Promise.promise();
        Instant now = Instant.now();
        String normalizedName = name == null ? "" : name.trim();
        String normalizedProfilePicture = profilePicture == null ? "" : profilePicture.trim();

        JsonObject query = new JsonObject().put("userId", userId);
        mongoDBClient.queryRecords(query, "users").onSuccess(existingUsers -> {
            if (existingUsers == null || existingUsers.isEmpty()) {
                String pictureToPersist = normalizedProfilePicture.isBlank()
                        ? DEFAULT_PROFILE_PICTURE
                        : normalizedProfilePicture;

                User user = new User("", email, normalizedName, userId, now, now, pictureToPersist);
                mongoDBClient.insertRecord(JsonObject.mapFrom(user), "users")
                        .onSuccess(insertRes -> promise.complete())
                        .onFailure(promise::fail);
                return;
            }

            JsonObject existingUser = existingUsers.getFirst();
            JsonObject setObject = new JsonObject()
                    .put("email", email)
                    .put("updatedAt", now);

            if (!normalizedName.isBlank()) {
                setObject.put("name", normalizedName);
            }

            // Keep existing image if Google did not include picture claim in this token.
            if (!normalizedProfilePicture.isBlank()) {
                setObject.put("profilePicture", normalizedProfilePicture);
            } else if (existingUser.getString("profilePicture", "").isBlank()) {
                setObject.put("profilePicture", DEFAULT_PROFILE_PICTURE);
            }

            JsonObject update = new JsonObject().put("$set", setObject);
            mongoDBClient.updateRecord(query, update, "users")
                    .onSuccess(updateRes -> promise.complete())
                    .onFailure(promise::fail);
        }).onFailure(promise::fail);

        return promise.future();
    }

    @Override
    public void handleLogin() {
        JsonObject requestBody = routingContext.body().asJsonObject();
        if (requestBody == null) {
            buildResponse(routingContext, 400, createErrorResponse("request body is required"));
            return;
        }

        String googleToken = requestBody.getString("token", "").trim();
        if (googleToken.isBlank()) {
            buildResponse(routingContext, 400, createErrorResponse("google token is required"));
            return;
        }
        if (googleTokenValidator == null) {
            buildResponse(routingContext, 500, createErrorResponse("google login is not configured"));
            return;
        }

        final GoogleTokenValidator.GoogleUserClaims claims;
        try {
            claims = googleTokenValidator.validate(googleToken);
        } catch (Exception e) {
            log.error("Google token validation failed: {}", e.getMessage());
            buildResponse(routingContext, 401, createErrorResponse("Invalid Google token"));
            return;
        }

        String email = claims.email();
        String name = claims.name();
        String profilePicture = claims.profilePicture();

        JsonObject query = new JsonObject().put("email", email);
        mongoDBClient.queryRecords(query, "authprovider").onSuccess(res -> {
            if (res.isEmpty()) {
                String userId = UUID.randomUUID().toString();
                Instant now = Instant.now();

                AuthProvider authProvider = new AuthProvider(userId, "google", email, email, now, now, "");

                mongoDBClient.insertRecord(JsonObject.mapFrom(authProvider), "authprovider").onSuccess(authRes ->
                        upsertGoogleUser(userId, email, name, profilePicture)
                                .onSuccess(done -> fetchUser(routingContext, userId))
                                .onFailure(fail -> {
                                    log.error("Failed to upsert user for userId: {}. Error: {}", userId, fail.getMessage());
                                    buildResponse(routingContext, 500, createErrorResponse("Failed to create user"));

                                    JsonObject deleteQuery = new JsonObject().put("userId", userId);
                                    mongoDBClient.deleteRecordAsync(deleteQuery, "authprovider");
                                })
                ).onFailure(fail -> {
                    log.error("Failed to insert authProvider for userId: {}. Error: {}", userId, fail.getMessage());
                    buildResponse(routingContext, 500, createErrorResponse("Failed to create auth provider"));
                });

                return;
            }

            String userId = res.get(0).getString("userId", "");
            if (userId.isBlank()) {
                log.error("authprovider record missing userId for email: {}", email);
                buildResponse(routingContext, 500, createErrorResponse("Invalid auth provider record"));
                return;
            }

            upsertGoogleUser(userId, email, name, profilePicture).onSuccess(done ->
                    fetchUser(routingContext, userId)
            ).onFailure(userFail -> {
                log.error("Failed to upsert user for userId: {}. Error: {}", userId, userFail.getMessage());
                buildResponse(routingContext, 500, createErrorResponse("Failed to update user profile"));
            });

        }).onFailure(err -> {
            log.error("Failed to query authprovider for email: {}. Error: {}", email, err.getMessage());
            buildResponse(routingContext, 500, createErrorResponse("Internal error"));
        });
    }
}
