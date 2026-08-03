package com.toolhub.services.user.login;

import com.toolhub.services.auth.ToolHubAuthClient;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.ext.web.RoutingContext;

public class LoginFactory {
  public static Login createLogin(RoutingContext context, MongoDBClient mongoDBClient) {
    return createLogin(context, mongoDBClient, null);
  }

  public static Login createLogin(
      RoutingContext context, MongoDBClient mongoDBClient, ToolHubAuthClient sharedAuth) {
    String type =
        context
            .body()
            .asJsonObject()
            .getString("type", context.body().asJsonObject().getString("provider", "base"));
    return switch (type.toLowerCase()) {
      case "google" ->
          sharedAuth == null
              ? new GoogleLogin(mongoDBClient, context)
              : new GoogleLogin(mongoDBClient, context, sharedAuth);
      case "base" ->
          sharedAuth == null
              ? new BaseLogin(mongoDBClient, context)
              : new BaseLogin(mongoDBClient, context, sharedAuth);
      default -> throw new IllegalArgumentException("Unknown login type: " + type);
    };
  }
}
