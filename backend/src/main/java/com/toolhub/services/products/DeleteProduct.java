package com.toolhub.services.products;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.core.Handler;

public class DeleteProduct {
    MongoDBClient mongoDBClient;

    public DeleteProduct(MongoDBClient mongoDBClient, RoutingContext context) {
        this.mongoDBClient = mongoDBClient;
        this.deleteProduct(context);
    }

    private void deleteProduct(RoutingContext context) {
        JsonObject body = context.body().asJsonObject();
        String productId = body.getString("productId");
        String userId = context.get("userId");
        String targetPrice = body.getString("targetPrice");

        removeTargetPrice(productId, userId, targetPrice, context);
    }

    private void removeTargetPrice(String productId, String userId, String targetPrice, RoutingContext context) {
        JsonObject query = new JsonObject()
                .put("productId", productId)
                .put("userTargetPrices.userId", userId);

        JsonObject update = new JsonObject()
                .put("$pull", new JsonObject()
                        .put("userTargetPrices.$.targetPrices", targetPrice));

        mongoDBClient.updateRecord(query, update, "products")
                .onSuccess(res -> removeUserIfNoPrices(productId, userId, context))
                .onFailure(handleFailureOrProceed(() -> removeUserIfNoPrices(productId, userId, context), context));
    }

    private void removeUserIfNoPrices(String productId, String userId, RoutingContext context) {
        JsonObject query = new JsonObject()
                .put("productId", productId)
                .put("userTargetPrices", new JsonObject()
                        .put("$elemMatch", new JsonObject()
                                .put("userId", userId)
                                .put("targetPrices", new JsonObject().put("$size", 0))));

        JsonObject update = new JsonObject()
                .put("$pull", new JsonObject()
                        .put("userTargetPrices", new JsonObject().put("userId", userId)));

        mongoDBClient.updateRecord(query, update, "products")
                .onSuccess(res -> deleteProductIfNoUsers(productId, context))
                .onFailure(handleFailureOrProceed(() -> deleteProductIfNoUsers(productId, context), context));
    }

    private void deleteProductIfNoUsers(String productId, RoutingContext context) {
        JsonObject query = new JsonObject()
                .put("productId", productId)
                .put("userTargetPrices", new JsonObject().put("$size", 0));

        mongoDBClient.deleteRecord(query, "products")
                .onSuccess(res -> Utility.buildResponse(context, 200, Utility.createSuccessResponse("Target price removed")))
                .onFailure(handleFailureOrProceed(() ->
                        Utility.buildResponse(context, 200, Utility.createSuccessResponse("Target price removed")), context));
    }

    private Handler<Throwable> handleFailureOrProceed(Runnable onNoMatchFallback, RoutingContext context) {
        return err -> {
            if (err.getMessage() != null && err.getMessage().contains("No matching document")) {
                onNoMatchFallback.run();
            } else {
                respondWithError(context, err);
            }
        };
    }

    private void respondWithError(RoutingContext context, Throwable err) {
        Utility.buildResponse(context, 500, Utility.createErrorResponse("Database operation failed: " + err.getMessage()));
    }
}
