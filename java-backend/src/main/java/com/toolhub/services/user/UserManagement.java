package com.toolhub.services.user;

import static com.toolhub.Utils.Constants.*;
import static com.toolhub.Utils.Utility.*;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.toolhub.enums.user.Role;
import com.toolhub.models.AuthProvider;
import com.toolhub.models.User;
import com.toolhub.services.auth.ToolHubAuthClient;
import com.toolhub.services.jwt.AuthSessionService;
import com.toolhub.services.jwt.JWTProvider;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.user.login.LoginFactory;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class UserManagement {
  private static final Logger log = LoggerFactory.getLogger(UserManagement.class);
  private final MongoDBClient mongoClient;
  private final AuthSessionService authSessionService;
  private final ToolHubAuthClient sharedAuth;

  public UserManagement(MongoDBClient mongoClient) {
    this.mongoClient = mongoClient;
    this.authSessionService = new AuthSessionService(mongoClient);
    this.sharedAuth = null;
  }

  public UserManagement(MongoDBClient mongoClient, WebClient webClient, Dotenv env) {
    this.mongoClient = mongoClient;
    this.authSessionService = new AuthSessionService(mongoClient);
    this.sharedAuth = new ToolHubAuthClient(webClient, env);
  }

  public Future<List<JsonObject>> fetchUsersFromUserIds(List<String> userIds) {
    log.info("Fetching users for userIds: {}", userIds);
    JsonObject query =
        new JsonObject().put("userId", new JsonObject().put("$in", new JsonArray(userIds)));
    Promise<List<JsonObject>> promise = Promise.promise();

    mongoClient
        .queryRecords(query, "users")
        .onSuccess(
            res -> {
              if (!res.isEmpty()) {
                log.info("Users fetched successfully: {}", res);
                promise.complete(res);
              } else {
                log.warn("No users found for provided userIds: {}", userIds);
                promise.fail("no user found");
              }
            })
        .onFailure(
            fail -> {
              log.error("Failed to fetch users. Error: {}", fail.getMessage());
              promise.fail(fail.getMessage());
            });

    return promise.future();
  }

  public void handleLogin(RoutingContext context) {
    log.info("Handling login request");
    LoginFactory.createLogin(context, mongoClient, sharedAuth).handleLogin();
  }

  public void handleRefreshToken(RoutingContext context) {
    if (sharedAuth != null) {
      String refreshToken = sharedAuth.refreshCookie(context);
      if (refreshToken.isBlank()) {
        buildResponse(context, 401, createErrorResponse("Refresh session is required"));
        return;
      }
      sharedAuth
          .refreshSession(refreshToken)
          .onSuccess(
              tokens -> {
                sharedAuth.setSessionCookies(context, tokens);
                buildResponse(
                    context,
                    200,
                    new JsonObject()
                        .put("authenticated", true)
                        .put(
                            "session",
                            new JsonObject()
                                .put("accessExpiresIn", tokens.getValue("accessExpiresIn"))
                                .put("refreshExpiresIn", tokens.getValue("refreshExpiresIn"))));
              })
          .onFailure(error -> buildResponse(context, 401, createErrorResponse(error.getMessage())));
      return;
    }
    JsonObject requestBody = context.body().asJsonObject();
    if (requestBody == null) {
      buildResponse(context, 400, createErrorResponse("request body is required"));
      return;
    }

    String refreshToken = requestBody.getString("refreshToken", "").trim();
    if (refreshToken.isBlank()) {
      buildResponse(context, 400, createErrorResponse("refresh token is required"));
      return;
    }

    final DecodedJWT decodedRefreshToken;
    try {
      decodedRefreshToken = JWTProvider.verifyRefreshToken(refreshToken);
    } catch (Exception e) {
      buildResponse(context, 401, createErrorResponse("invalid refresh token"));
      return;
    }

    String userId = decodedRefreshToken.getClaim("userId").asString();
    if (userId == null || userId.isBlank()) {
      buildResponse(context, 401, createErrorResponse("invalid refresh token"));
      return;
    }

    authSessionService
        .isRefreshTokenValidInStore(userId, refreshToken)
        .onSuccess(
            valid -> {
              if (!valid) {
                buildResponse(context, 401, createErrorResponse("refresh token not recognized"));
                return;
              }

              mongoClient
                  .queryRecords(new JsonObject().put("userId", userId), "users")
                  .onSuccess(
                      users -> {
                        if (users == null || users.isEmpty()) {
                          buildResponse(context, 401, createErrorResponse("user does not exist"));
                          return;
                        }

                        JsonObject user = users.getFirst();
                        String role = user.getString("role", Role.USER.name());
                        String email = user.getString("email", "");

                        authSessionService
                            .issueTokens(userId, role, email)
                            .onSuccess(
                                tokens -> {
                                  buildResponse(context, 200, tokens);

                                  Instant now = Instant.now();
                                  JsonObject update = new JsonObject().put("updatedAt", now);
                                  JsonObject findUpdateQueryObj =
                                      new JsonObject().put("userId", userId);
                                  mongoClient.updateRecordAsync(
                                      findUpdateQueryObj, update, "users");
                                  mongoClient.updateRecordAsync(
                                      findUpdateQueryObj, update, "authprovider");
                                })
                            .onFailure(
                                err ->
                                    buildResponse(
                                        context,
                                        500,
                                        createErrorResponse("failed to refresh token")));
                      })
                  .onFailure(
                      err ->
                          buildResponse(
                              context, 500, createErrorResponse("failed to refresh token")));
            })
        .onFailure(
            err -> buildResponse(context, 500, createErrorResponse("failed to refresh token")));
  }

  public void handleSession(RoutingContext context) {
    String userId = context.get("userId");
    mongoClient
        .queryRecords(new JsonObject().put("userId", userId), "users")
        .onSuccess(
            users -> {
              if (users.isEmpty()) {
                buildResponse(context, 404, createErrorResponse("user does not exist"));
                return;
              }
              buildResponse(
                  context,
                  200,
                  new JsonObject()
                      .put("authenticated", true)
                      .put("user", extractRequiredUserInfo(users.getFirst())));
            })
        .onFailure(
            error -> buildResponse(context, 500, createErrorResponse("failed to load session")));
  }

  public void handleLogout(RoutingContext context) {
    if (sharedAuth != null) {
      String token = sharedAuth.refreshCookie(context);
      sharedAuth
          .revokeSession(token)
          .onComplete(
              ignored -> {
                sharedAuth.clearSessionCookies(context);
                buildResponse(context, 200, new JsonObject().put("authenticated", false));
              });
      return;
    }
    String userId = context.get("userId");
    JsonObject update =
        new JsonObject()
            .put(
                "$unset",
                new JsonObject().put("refreshTokenHash", "").put("refreshTokenExpiresAt", ""));
    mongoClient
        .updateRecord(new JsonObject().put("userId", userId), update, "authprovider")
        .onComplete(
            ignored -> {
              context
                  .response()
                  .putHeader(
                      "Set-Cookie",
                      "toolhub_access_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
              buildResponse(context, 200, new JsonObject().put("authenticated", false));
            });
  }

  public void handleRegister(RoutingContext context) {
    log.info("Handling registration request");
    try {
      JsonObject requestBody = context.body().asJsonObject();
      log.info("Registration payload received: {}", requestBody.encode());

      User user = castToClass(requestBody, User.class);
      String userId = UUID.randomUUID().toString();
      Instant now = Instant.now();
      user.setUserId(userId);
      user.setCreatedAt(now);
      user.setUpdatedAt(now);
      user.setRole(Role.USER);
      user.setProfilePicture(DEFAULT_PROFILE_PICTURE);

      String password = requestBody.getString("password");
      String hashedPassword = PasswordUtil.hashPassword(password);

      AuthProvider authProvider =
          new AuthProvider(
              userId, "base", user.getEmail(), user.getEmail(), now, now, hashedPassword);

      log.info("Checking if user already exists for email: {}", user.getEmail());
      Future<Boolean> checkForExistingUser = checkForUser(user.getEmail());

      checkForExistingUser
          .onSuccess(
              userExists -> {
                if (!userExists) {
                  log.info(
                      "No existing user found. Proceeding to register new user: {}",
                      user.getEmail());

                  mongoClient
                      .insertRecord(JsonObject.mapFrom(user), "users")
                      .onSuccess(
                          res -> {
                            log.info("User record inserted successfully for userId: {}", userId);

                            mongoClient
                                .insertRecord(JsonObject.mapFrom(authProvider), "authprovider")
                                .onSuccess(
                                    authRes -> {
                                      log.info(
                                          "AuthProvider inserted successfully for userId: {}",
                                          userId);
                                      buildResponse(
                                          context,
                                          200,
                                          createSuccessResponse("user is registered"));
                                    })
                                .onFailure(
                                    failure -> {
                                      log.error(
                                          "Failed to insert authProvider for userId: {}. Rolling back user insert.",
                                          userId);
                                      buildResponse(
                                          context,
                                          500,
                                          "failure in registering user, please retry");
                                      mongoClient.deleteRecordAsync(
                                          new JsonObject().put("userId", userId), "users");
                                    });
                          })
                      .onFailure(
                          fail -> {
                            log.error(
                                "Failed to insert user record for userId: {}. Error: {}",
                                userId,
                                fail.getMessage());
                            buildResponse(
                                context, 500, "failure in registering user, please retry");
                          });

                } else {
                  log.warn("User already exists for email: {}", user.getEmail());
                  buildResponse(
                      context, 400, createErrorResponse("user already exists, please login"));
                }
              })
          .onFailure(
              fail -> {
                log.error("Failed while checking for existing user. Error: {}", fail.getMessage());
                buildResponse(
                    context, 500, createErrorResponse("failure in registering user, please retry"));
              });

    } catch (Exception e) {
      log.error("Exception in handleRegister: {}", e.toString());
      buildResponse(context, 500, createErrorResponse(e.toString()));
    }
  }

  public Future<Boolean> checkForUser(String email) {
    log.info("Checking user existence by email: {}", email);
    Promise<Boolean> promise = Promise.promise();
    JsonObject queryEmail = new JsonObject().put("email", email);

    mongoClient
        .queryRecords(queryEmail, "users")
        .onSuccess(
            emailRes -> {
              boolean exists = !emailRes.isEmpty();
              log.info("User existence for {}: {}", email, exists);
              promise.complete(exists);
            })
        .onFailure(
            fail -> {
              log.error("Error querying for user email {}: {}", email, fail.getMessage());
              promise.fail(fail.getMessage());
            });

    return promise.future();
  }
}
