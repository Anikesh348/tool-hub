package com.toolhub.services.user.login;

import static com.toolhub.Utils.Constants.PASSWORD;
import static com.toolhub.Utils.Utility.*;

import com.toolhub.services.auth.ToolHubAuthClient;
import com.toolhub.services.jwt.AuthSessionService;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.user.PasswordUtil;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import java.time.Instant;

public class BaseLogin implements Login {
  private final MongoDBClient mongoDBClient;
  private final RoutingContext context;
  private final AuthSessionService authSessionService;
  private final ToolHubAuthClient sharedAuth;

  public BaseLogin(MongoDBClient client, RoutingContext context) {
    this.mongoDBClient = client;
    this.context = context;
    this.authSessionService = new AuthSessionService(client);
    this.sharedAuth = null;
  }

  public BaseLogin(MongoDBClient client, RoutingContext context, ToolHubAuthClient sharedAuth) {
    this.mongoDBClient = client;
    this.context = context;
    this.authSessionService = new AuthSessionService(client);
    this.sharedAuth = sharedAuth;
  }

  @Override
  public void handleLogin() {
    JsonObject requestBody = context.body().asJsonObject();
    String email = requestBody.getString("email", "").trim();
    String password = requestBody.getString(PASSWORD, "");
    if (email.isEmpty() || password.isEmpty()) {
      buildResponse(context, 400, createSuccessResponse("userName/password is empty"));
      return;
    }

    JsonObject query = new JsonObject().put("providerUserId", email).put("provider", "base");
    mongoDBClient
        .queryRecords(query, "authprovider")
        .onSuccess(
            authRes -> {
              if (authRes.isEmpty()) {
                buildResponse(context, 401, "user doesnt exist");
                return;
              }

              JsonObject authProvider = authRes.get(0);
              String userId = authProvider.getString("userId", "");
              String hashedPassword = authProvider.getString("hashedPassword", "");
              mongoDBClient
                  .queryRecords(new JsonObject().put("userId", userId), "users")
                  .onSuccess(
                      res -> {
                        if (res.isEmpty()) {
                          buildResponse(context, 401, "user doesnt exist");
                          return;
                        }

                        JsonObject user = res.getFirst();
                        if (!PasswordUtil.checkPassword(password, hashedPassword)) {
                          buildResponse(
                              context,
                              401,
                              createErrorResponse("invalid user/password combination"));
                          return;
                        }

                        (sharedAuth == null
                                ? authSessionService.issueTokens(
                                    userId, user.getString("role"), user.getString("email", ""))
                                : sharedAuth.issueSession(user))
                            .onSuccess(
                                tokens -> {
                                  if (sharedAuth != null) {
                                    sharedAuth.setSessionCookies(context, tokens);
                                  }
                                  JsonObject response =
                                      new JsonObject()
                                          .put("authenticated", true)
                                          .put("user", extractRequiredUserInfo(user))
                                          .put(
                                              "session",
                                              new JsonObject()
                                                  .put(
                                                      "accessExpiresIn",
                                                      tokens.getValue("accessExpiresIn"))
                                                  .put(
                                                      "refreshExpiresIn",
                                                      tokens.getValue("refreshExpiresIn")));
                                  if (sharedAuth == null) response.mergeIn(tokens);
                                  buildResponse(context, 200, response);

                                  Instant now = Instant.now();
                                  JsonObject update = new JsonObject().put("updatedAt", now);
                                  JsonObject findUpdateQueryObj =
                                      new JsonObject().put("userId", userId);
                                  mongoDBClient.updateRecordAsync(
                                      findUpdateQueryObj, update, "users");
                                  mongoDBClient.updateRecordAsync(
                                      findUpdateQueryObj, update, "authprovider");
                                })
                            .onFailure(
                                issueFail ->
                                    buildResponse(
                                        context,
                                        500,
                                        createErrorResponse("failed to issue login tokens")));
                      })
                  .onFailure(
                      userTableFailure -> buildResponse(context, 500, "login failure, retry"));
            })
        .onFailure(fail -> buildResponse(context, 500, "login failure, retry"));
  }
}
