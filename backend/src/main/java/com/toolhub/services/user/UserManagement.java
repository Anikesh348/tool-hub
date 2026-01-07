package com.toolhub.services.user;

import com.toolhub.enums.user.Role;
import com.toolhub.models.AuthProvider;
import com.toolhub.models.User;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.user.login.LoginFactory;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static com.toolhub.Utils.Constants.*;
import static com.toolhub.Utils.Utility.*;

public class UserManagement {
    private static final Logger log = LoggerFactory.getLogger(UserManagement.class);
    private final MongoDBClient mongoClient;

    public UserManagement(MongoDBClient mongoClient) {
        this.mongoClient = mongoClient;
    }

    public Future<List<JsonObject>> fetchUsersFromUserIds(List<String> userIds) {
        log.info("Fetching users for userIds: {}", userIds);
        JsonObject query = new JsonObject().put("userId", new JsonObject().put("$in", new JsonArray(userIds)));
        Promise<List<JsonObject>> promise = Promise.promise();

        mongoClient.queryRecords(query, "users").onSuccess(res -> {
            if (!res.isEmpty()) {
                log.info("Users fetched successfully: {}", res);
                promise.complete(res);
            } else {
                log.warn("No users found for provided userIds: {}", userIds);
                promise.fail("no user found");
            }
        }).onFailure(fail -> {
            log.error("Failed to fetch users. Error: {}", fail.getMessage());
            promise.fail(fail.getMessage());
        });

        return promise.future();
    }

    public void handleLogin(RoutingContext context) {
        log.info("Handling login request");
        LoginFactory.createLogin(context, mongoClient).handleLogin();
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

            AuthProvider authProvider = new AuthProvider(userId, "base", user.getEmail(), user.getEmail(), now, now, hashedPassword);

            log.info("Checking if user already exists for email: {}", user.getEmail());
            Future<Boolean> checkForExistingUser = checkForUser(user.getEmail());

            checkForExistingUser.onSuccess(userExists -> {
                if (!userExists) {
                    log.info("No existing user found. Proceeding to register new user: {}", user.getEmail());

                    mongoClient.insertRecord(JsonObject.mapFrom(user), "users").onSuccess(res -> {
                        log.info("User record inserted successfully for userId: {}", userId);

                        mongoClient.insertRecord(JsonObject.mapFrom(authProvider), "authprovider").onSuccess(authRes -> {
                            log.info("AuthProvider inserted successfully for userId: {}", userId);
                            buildResponse(context, 200, createSuccessResponse("user is registered"));
                        }).onFailure(failure -> {
                            log.error("Failed to insert authProvider for userId: {}. Rolling back user insert.", userId);
                            buildResponse(context, 500, "failure in registering user, please retry");
                            mongoClient.deleteRecordAsync(new JsonObject().put("userId", userId), "users");
                        });

                    }).onFailure(fail -> {
                        log.error("Failed to insert user record for userId: {}. Error: {}", userId, fail.getMessage());
                        buildResponse(context, 500, "failure in registering user, please retry");
                    });

                } else {
                    log.warn("User already exists for email: {}", user.getEmail());
                    buildResponse(context, 400, createErrorResponse("user already exists, please login"));
                }
            }).onFailure(fail -> {
                log.error("Failed while checking for existing user. Error: {}", fail.getMessage());
                buildResponse(context, 500, createErrorResponse("failure in registering user, please retry"));
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

        mongoClient.queryRecords(queryEmail, "users").onSuccess(emailRes -> {
            boolean exists = !emailRes.isEmpty();
            log.info("User existence for {}: {}", email, exists);
            promise.complete(exists);
        }).onFailure(fail -> {
            log.error("Error querying for user email {}: {}", email, fail.getMessage());
            promise.fail(fail.getMessage());
        });

        return promise.future();
    }
}
