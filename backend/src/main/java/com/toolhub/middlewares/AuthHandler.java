package com.toolhub.middlewares;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.toolhub.Utils.Utility;
import com.toolhub.services.jwt.JWTProvider;
import io.vertx.core.Handler;
import io.vertx.ext.web.RoutingContext;

public class AuthHandler implements Handler<RoutingContext> {

    @Override
    public void handle(RoutingContext context) {
        String authHeader = context.request().getHeader("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer")) {
            Utility.buildResponse(context, 401, Utility.createErrorResponse("missing auth token"));
        } else {
            String token = authHeader.substring("Bearer ".length());
            try {
                DecodedJWT decodedJWT = JWTProvider.verifyToken(token);
                String userId = decodedJWT.getClaim("userId").asString();
                String role = decodedJWT.getClaim("role").asString();
                context.put("userId", userId);
                context.put("role", role);
                context.next();
            } catch (Exception e) {
                Utility.buildResponse(context, 401, Utility.createErrorResponse("invalid Token in headers"));
            }
        }

    }
}
