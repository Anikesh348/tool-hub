package com.toolhub.services.user.login;

import static com.toolhub.Utils.Constants.DEFAULT_PROFILE_PICTURE;
import static com.toolhub.Utils.Utility.*;

import com.toolhub.enums.user.Role;
import com.toolhub.models.AuthProvider;
import com.toolhub.models.User;
import com.toolhub.services.auth.ToolHubAuthClient;
import com.toolhub.services.jwt.AuthSessionService;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class GoogleLogin implements Login {
  private static final Logger log = LoggerFactory.getLogger(GoogleLogin.class);

  private final MongoDBClient mongoDBClient;
  private final RoutingContext routingContext;
  private final AuthSessionService authSessionService;
  private final GoogleTokenValidator googleTokenValidator;
  private final ToolHubAuthClient sharedAuth;

  public GoogleLogin(MongoDBClient client, RoutingContext context) {
    this(client, context, null);
  }

  public GoogleLogin(MongoDBClient client, RoutingContext context, ToolHubAuthClient sharedAuth) {
    this.mongoDBClient = client;
    this.routingContext = context;
    this.authSessionService = new AuthSessionService(client);
    this.sharedAuth = sharedAuth;
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

    mongoDBClient
        .queryRecords(userQuery, "users")
        .onSuccess(
            userRes -> {
              if (userRes == null || userRes.isEmpty()) {
                log.warn("No user found in users collection for userId: {}", userId);
                buildResponse(context, 404, createErrorResponse("user not found"));
                return;
              }

              JsonObject user = userRes.get(0);
              String userRole = user.getString("role", Role.USER.name());
              String email = user.getString("email", "");

              (sharedAuth == null
                      ? authSessionService.issueTokens(userId, userRole, email)
                      : sharedAuth.issueSession(user))
                  .onSuccess(
                      tokens -> {
                        if (sharedAuth != null) sharedAuth.setSessionCookies(context, tokens);
                        JsonObject response =
                            new JsonObject()
                                .put("authenticated", true)
                                .put("user", extractRequiredUserInfo(user))
                                .put(
                                    "session",
                                    new JsonObject()
                                        .put("accessExpiresIn", tokens.getValue("accessExpiresIn"))
                                        .put(
                                            "refreshExpiresIn",
                                            tokens.getValue("refreshExpiresIn")));
                        if (sharedAuth == null) response.mergeIn(tokens);
                        buildResponse(context, 200, response);

                        Instant now = Instant.now();
                        JsonObject update = new JsonObject().put("updatedAt", now);
                        JsonObject findUpdateQueryObj = new JsonObject().put("userId", userId);
                        mongoDBClient.updateRecordAsync(findUpdateQueryObj, update, "users");
                        mongoDBClient.updateRecordAsync(findUpdateQueryObj, update, "authprovider");
                        log.info(
                            "Updated 'updatedAt' field for userId: {} in users and authprovider collections",
                            userId);
                      })
                  .onFailure(
                      tokenFail -> {
                        log.error(
                            "Failed to issue login tokens for userId: {}. Error: {}",
                            userId,
                            tokenFail.getMessage());
                        buildResponse(context, 500, createErrorResponse("failed to login"));
                      });
            })
        .onFailure(
            userFail -> {
              log.error(
                  "Failed to fetch user for userId: {}. Error: {}", userId, userFail.getMessage());
              buildResponse(context, 500, createErrorResponse("failed to login"));
            });
  }

  private Future<Void> upsertGoogleUser(
      String userId, String email, String name, String profilePicture) {
    Promise<Void> promise = Promise.promise();
    Instant now = Instant.now();
    String normalizedName = name == null ? "" : name.trim();
    String normalizedProfilePicture = profilePicture == null ? "" : profilePicture.trim();

    JsonObject query = new JsonObject().put("userId", userId);
    mongoDBClient
        .queryRecords(query, "users")
        .onSuccess(
            existingUsers -> {
              if (existingUsers == null || existingUsers.isEmpty()) {
                String pictureToPersist =
                    normalizedProfilePicture.isBlank()
                        ? DEFAULT_PROFILE_PICTURE
                        : normalizedProfilePicture;

                User user = new User("", email, normalizedName, userId, now, now, pictureToPersist);
                mongoDBClient
                    .insertRecord(JsonObject.mapFrom(user), "users")
                    .onSuccess(insertRes -> promise.complete())
                    .onFailure(promise::fail);
                return;
              }

              JsonObject existingUser = existingUsers.getFirst();
              JsonObject setObject = new JsonObject().put("email", email).put("updatedAt", now);

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
              mongoDBClient
                  .updateRecord(query, update, "users")
                  .onSuccess(updateRes -> promise.complete())
                  .onFailure(promise::fail);
            })
        .onFailure(promise::fail);

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
    if (sharedAuth != null) {
      sharedAuth
          .verifyIdentity("google", googleToken)
          .onSuccess(identity -> handleVerifiedIdentity(identity))
          .onFailure(
              error -> buildResponse(routingContext, 401, createErrorResponse(error.getMessage())));
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
    mongoDBClient
        .queryRecords(query, "authprovider")
        .onSuccess(
            res -> {
              if (res.isEmpty()) {
                String userId = UUID.randomUUID().toString();
                Instant now = Instant.now();

                AuthProvider authProvider =
                    new AuthProvider(userId, "google", email, email, now, now, "");

                mongoDBClient
                    .insertRecord(JsonObject.mapFrom(authProvider), "authprovider")
                    .onSuccess(
                        authRes ->
                            upsertGoogleUser(userId, email, name, profilePicture)
                                .onSuccess(done -> fetchUser(routingContext, userId))
                                .onFailure(
                                    fail -> {
                                      log.error(
                                          "Failed to upsert user for userId: {}. Error: {}",
                                          userId,
                                          fail.getMessage());
                                      buildResponse(
                                          routingContext,
                                          500,
                                          createErrorResponse("Failed to create user"));

                                      JsonObject deleteQuery =
                                          new JsonObject().put("userId", userId);
                                      mongoDBClient.deleteRecordAsync(deleteQuery, "authprovider");
                                    }))
                    .onFailure(
                        fail -> {
                          log.error(
                              "Failed to insert authProvider for userId: {}. Error: {}",
                              userId,
                              fail.getMessage());
                          buildResponse(
                              routingContext,
                              500,
                              createErrorResponse("Failed to create auth provider"));
                        });

                return;
              }

              String userId = res.get(0).getString("userId", "");
              if (userId.isBlank()) {
                log.error("authprovider record missing userId for email: {}", email);
                buildResponse(
                    routingContext, 500, createErrorResponse("Invalid auth provider record"));
                return;
              }

              upsertGoogleUser(userId, email, name, profilePicture)
                  .onSuccess(done -> fetchUser(routingContext, userId))
                  .onFailure(
                      userFail -> {
                        log.error(
                            "Failed to upsert user for userId: {}. Error: {}",
                            userId,
                            userFail.getMessage());
                        buildResponse(
                            routingContext,
                            500,
                            createErrorResponse("Failed to update user profile"));
                      });
            })
        .onFailure(
            err -> {
              log.error(
                  "Failed to query authprovider for email: {}. Error: {}", email, err.getMessage());
              buildResponse(routingContext, 500, createErrorResponse("Internal error"));
            });
  }

  private void handleVerifiedIdentity(JsonObject identity) {
    String email = identity.getString("email", "").trim();
    String subject = identity.getString("subject", "").trim();
    if (email.isBlank() || subject.isBlank()) {
      buildResponse(routingContext, 401, createErrorResponse("Invalid google credential"));
      return;
    }
    JsonObject providerQuery =
        new JsonObject().put("provider", "google").put("providerUserId", subject);
    mongoDBClient
        .queryRecords(providerQuery, "authprovider")
        .compose(
            records -> {
              if (!records.isEmpty()) return Future.succeededFuture(records);
              return mongoDBClient.queryRecords(
                  new JsonObject().put("provider", "google").put("email", email), "authprovider");
            })
        .onSuccess(
            records -> {
              String userId =
                  records.isEmpty()
                      ? UUID.randomUUID().toString()
                      : records.getFirst().getString("userId", "");
              if (userId.isBlank()) {
                buildResponse(
                    routingContext, 500, createErrorResponse("Invalid auth provider record"));
                return;
              }
              Future<Void> providerWrite;
              if (records.isEmpty()) {
                JsonObject provider =
                    JsonObject.mapFrom(
                        new AuthProvider(
                            userId, "google", subject, email, Instant.now(), Instant.now(), ""));
                providerWrite = mongoDBClient.insertRecord(provider, "authprovider");
              } else {
                providerWrite =
                    mongoDBClient.updateRecord(
                        new JsonObject().put("userId", userId).put("provider", "google"),
                        new JsonObject()
                            .put(
                                "$set",
                                new JsonObject()
                                    .put("providerUserId", subject)
                                    .put("email", email)
                                    .put("updatedAt", Instant.now())),
                        "authprovider");
              }
              providerWrite
                  .compose(
                      ignored ->
                          upsertGoogleUser(
                              userId,
                              email,
                              identity.getString("name", ""),
                              identity.getString("profilePicture", "")))
                  .onSuccess(ignored -> fetchUser(routingContext, userId))
                  .onFailure(
                      error ->
                          buildResponse(
                              routingContext, 500, createErrorResponse("Failed to login")));
            })
        .onFailure(
            error ->
                buildResponse(
                    routingContext,
                    503,
                    createErrorResponse("Authentication service is unavailable")));
  }
}
