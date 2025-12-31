package com.toolhub.services.user.login;

import com.toolhub.services.jwt.JWTProvider;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.user.PasswordUtil;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import java.time.Instant;

import static com.toolhub.Utils.Constants.PASSWORD;
import static com.toolhub.Utils.Utility.*;

public class BaseLogin implements Login {
    MongoDBClient mongoDBClient;
    RoutingContext context;
    public BaseLogin(MongoDBClient client, RoutingContext context) {
        this.mongoDBClient = client;
        this.context = context;
    }

    @Override
    public void handleLogin() {
        JsonObject requestBody = context.body().asJsonObject();
        String email = requestBody.getString("email", "");
        String password = requestBody.getString(PASSWORD, "");
        if (email.isEmpty() || password.isEmpty()) {
            buildResponse(context, 400, createSuccessResponse("userName/password is empty"));
        } else {
            JsonObject query = new JsonObject().put("providerUserId", email).put("provider", "base");
            mongoDBClient.queryRecords(query, "authprovider").onSuccess(authRes -> {
                if (authRes.isEmpty()) {
                    buildResponse(context, 401, "user doesnt exist");
                } else {
                    JsonObject authProvider = authRes.get(0);
                    String userId = authProvider.getString("userId");
                    String hashedPassword = authProvider.getString("hashedPassword");
                    mongoDBClient.queryRecords(new JsonObject().put("userId", userId), "users").onSuccess(res -> {
                        if (res.isEmpty()) {
                            buildResponse(context, 401, "user doesnt exist");
                        } else {
                            JsonObject user = res.getFirst();
                            if (PasswordUtil.checkPassword(password, hashedPassword)) {
                                String jwtToken = JWTProvider.generateToken(userId, user.getString("role"));
                                JsonObject response = new JsonObject().put("token", jwtToken);
                                response.put("user", extractRequiredUserInfo(user));
                                buildResponse(context, 200, response);
                                Instant now = Instant.now();
                                JsonObject update = new JsonObject().put("updatedAt", now);
                                JsonObject findUpdateQueryObj = new JsonObject().put("userId", userId);
                                mongoDBClient.updateRecordAsync(findUpdateQueryObj, update, "users");
                                mongoDBClient.updateRecordAsync(findUpdateQueryObj, update, "authprovider");
                            } else buildResponse(context, 401, createErrorResponse("invalid user/password combination"));
                        }
                    }).onFailure(userTableFailure -> {
                        buildResponse(context, 500, "login failure, retry");
                    });
                }
            }).onFailure(fail -> {
                buildResponse(context, 500, "login failure, retry");
            });
        }
    }
}
