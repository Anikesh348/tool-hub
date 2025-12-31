package com.toolhub.middlewares;

import com.toolhub.Utils.Utility;
import io.vertx.core.Handler;
import io.vertx.ext.web.RoutingContext;

import java.util.Set;

public class RoleHandler implements Handler<RoutingContext> {

    private final Set<String> allowedRoles;

    private RoleHandler(Set<String> allowedRoles) {
        this.allowedRoles = allowedRoles;
    }

    public static RoleHandler allow(String... roles) {
        return new RoleHandler(Set.of(roles));
    }

    @Override
    public void handle(RoutingContext context) {
        String role = context.get("role");

        if (role == null) {
            Utility.buildResponse(
                    context,
                    403,
                    Utility.createErrorResponse("role missing in token")
            );
            return;
        }

        if (!allowedRoles.contains(role)) {
            Utility.buildResponse(
                    context,
                    403,
                    Utility.createErrorResponse("access denied")
            );
            return;
        }

        context.next();
    }
}
