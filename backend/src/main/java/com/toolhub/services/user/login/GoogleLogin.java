package com.toolhub.services.user.login;

import com.auth0.jwt.JWT;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.toolhub.models.AuthProvider;
import com.toolhub.models.User;
import com.toolhub.services.jwt.JWTProvider;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.UUID;

import static com.toolhub.Utils.Utility.*;

public class GoogleLogin implements Login {
    private static final Logger log = LoggerFactory.getLogger(GoogleLogin.class);
    MongoDBClient mongoDBClient;
    RoutingContext routingContext;

    public GoogleLogin(MongoDBClient client, RoutingContext context) {
        this.mongoDBClient = client;
        this.routingContext = context;
    }

    private void fetchUser(RoutingContext routingContext, String userId) {
        log.info("Fetching user with userId: {}", userId);
        JsonObject userQuery = new JsonObject().put("userId", userId);

        mongoDBClient.queryRecords(userQuery, "users").onSuccess(userRes -> {
            log.info("User fetched successfully from users collection for userId: {}", userId);

            JsonObject user = userRes.getFirst();
            String userRole = user.getString("role");
            String jwtToken = JWTProvider.generateToken(userId, userRole);
            JsonObject response = new JsonObject().put("token", jwtToken);
            response.put("user", extractRequiredUserInfo(userRes.getFirst()));

            log.info("JWT token generated for userId: {}", userId);
            buildResponse(routingContext, 200, response);

            Instant now = Instant.now();
            JsonObject update = new JsonObject().put("updatedAt", now);
            JsonObject findUpdateQueryObj = new JsonObject().put("userId", userId);

            mongoDBClient.updateRecordAsync(findUpdateQueryObj, update, "users");
            mongoDBClient.updateRecordAsync(findUpdateQueryObj, update, "authprovider");
            log.info("Updated 'updatedAt' field for userId: {} in users and authprovider collections", userId);

        }).onFailure(userFail -> {
            log.error("Failed to fetch user for userId: {}. Error: {}", userId, userFail.getMessage());
            buildResponse(routingContext, 500, createErrorResponse("failed to login"));
        });
    }

    @Override
    public void handleLogin() {
        JsonObject requestBody = routingContext.body().asJsonObject();
        String googleToken = requestBody.getString("token");
        log.info("Received Google login token");

        try {
            DecodedJWT jwt = JWT.decode(googleToken);
            log.info("Decoded Google JWT token");

            String email = jwt.getClaim("email").asString();
            String name = jwt.getClaim("name").asString();
            String profilePicture = jwt.getClaim("picture").asString();

            log.info("Extracted user details from token - Email: {}, Name: {}", email, name);

            JsonObject query = new JsonObject().put("email", email);
            mongoDBClient.queryRecords(query, "authprovider").onSuccess(res -> {
                log.info("Queried authprovider collection with email: {}", email);

                if (res.isEmpty()) {
                    log.info("User not found in authprovider, proceeding to register");

                    String userId = UUID.randomUUID().toString();
                    Instant now = Instant.now();

                    AuthProvider authProvider = new AuthProvider(userId,
                            "google", email, email, now, now, "");

                    User user = new User("", email, name, userId, now, now, profilePicture);

                    mongoDBClient.insertRecord(JsonObject.mapFrom(user), "users").onSuccess(userRes -> {
                        log.info("Inserted new user into users collection: {}", userId);

                        mongoDBClient.insertRecord(JsonObject.mapFrom(authProvider), "authprovider").onSuccess(authRes -> {
                            log.info("Inserted new authProvider for userId: {}", userId);
                            fetchUser(routingContext, userId);

                        }).onFailure(fail -> {
                            log.error("Failed to insert authProvider for userId: {}. Error: {}", userId, fail.getMessage());
                            buildResponse(routingContext, 500,
                                    createErrorResponse("Failed to create auth provider"));

                            JsonObject deleteQuery = new JsonObject().put("userId", userId);
                            mongoDBClient.deleteRecordAsync(deleteQuery, "users");
                            log.info("Rolled back user insert for userId: {}", userId);
                        });

                    }).onFailure(fail -> {
                        log.error("Failed to insert user record. Error: {}", fail.getMessage());
                        buildResponse(routingContext, 500,
                                createErrorResponse("Failed to create user"));
                    });

                } else {
                    log.info("User already exists in authprovider: {}", email);
                    String userId = res.get(0).getString("userId");
                    fetchUser(routingContext, userId);
                }

            }).onFailure(err -> {
                log.error("Failed to query authprovider for email: {}. Error: {}", email, err.getMessage());
                buildResponse(routingContext, 500, createErrorResponse("Internal error"));
            });

        } catch (Exception e) {
            log.error("Exception while decoding Google token: {}", e.getMessage());
            buildResponse(routingContext, 400, createErrorResponse("Invalid Google token"));
        }
    }
}