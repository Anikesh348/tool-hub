package com.toolhub.services.user.login;

import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.ext.web.RoutingContext;

public class LoginFactory {
    public static Login createLogin(RoutingContext context, MongoDBClient mongoDBClient) {
        String type  = context.body().asJsonObject().getString("type");
        return switch (type.toLowerCase()) {
            case "google" -> new GoogleLogin(mongoDBClient, context);
            case "base" -> new BaseLogin(mongoDBClient, context);
            default -> throw new IllegalArgumentException("Unknown login type: " + type);
        };
    }
}
