package com.toolhub.services.products;

import com.toolhub.Utils.UrlRedirectUtil;
import com.toolhub.Utils.Utility;
import com.toolhub.models.Product;
import com.toolhub.models.ProductStatus;
import com.toolhub.models.UserTargetPrices;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

import static com.toolhub.Utils.Utility.*;

public class SaveProduct {
    private final static Logger log = LoggerFactory.getLogger(SaveProduct.class);
    MongoDBClient mongoDBClient;
    WebClient client;
    UpdateProductInfo updateProductInfo;
    Vertx vertx;

    public SaveProduct(MongoDBClient mongoDBClient, WebClient client, Vertx vertx) {
        this.mongoDBClient = mongoDBClient;
        this.client = client;
        this.vertx = vertx;
        this.updateProductInfo = new UpdateProductInfo(mongoDBClient, client);
    }

    public void saveProduct(RoutingContext context) {
        JsonObject request = context.body().asJsonObject();
        String productUrl = request.getString("productUrl");
        UrlRedirectUtil.finalUrl(vertx, productUrl).onSuccess(url -> {
            String targetPrice = request.getString("targetPrice");
            String userId = context.get("userId");
            Product product = new Product();
            String productId = generateProductId(url);
            product.setProductId(productId);
            product.setProductUrl(url);
            queryForProductId(productId, userId, targetPrice).onSuccess(productStatus -> {
                if (!productStatus.isProductExists()) {
                    UserTargetPrices userTargetPrice = new UserTargetPrices();
                    userTargetPrice.setUserId(userId);
                    userTargetPrice.setTargetPrices(new ArrayList<>(List.of(targetPrice)));
                    product.setUserTargetPrices(new ArrayList<>(List.of(userTargetPrice)));
                    updateProductInfo.updateProductInfo(product);
                    mongoDBClient.insertRecord(JsonObject.mapFrom(product),
                            "products").onSuccess(res -> {
                        buildResponse(context, 200, createSuccessResponse("product inserted"));
                    }).onFailure(fail ->
                            buildResponse(context, 500,
                                    createErrorResponse("error adding product, retry!!")));
                } else {
                    if (productStatus.isUserExists() && productStatus.isTargetPriceExists()) {
                        buildResponse(context, 400,
                                createErrorResponse("target price already added for this user"));
                        return;
                    }
                    JsonObject query = new JsonObject();
                    JsonObject update = new JsonObject();
                    if (productStatus.isUserExists() && !productStatus.isTargetPriceExists()) {
                        query.put("productId", productId)
                                .put("userTargetPrices.userId", userId);
                        update.put("$addToSet", new JsonObject()
                                .put("userTargetPrices.$.targetPrices", targetPrice));
                    } else if (!productStatus.isUserExists()) {
                        query.put("productId", productId);
                        JsonObject newUserEntry = new JsonObject()
                                .put("userId", userId)
                                .put("targetPrices", new JsonArray().add(targetPrice));
                        update.put("$push", new JsonObject()
                                .put("userTargetPrices", newUserEntry));
                    }
                    mongoDBClient.updateRecord(query, update, "products").onSuccess(res -> {
                        buildResponse(context, 200, createSuccessResponse("product inserted"));
                    }).onFailure(fail -> buildResponse(context, 500,
                            createErrorResponse("error adding product, retry!!")));
                }
            }).onFailure(fail ->
                    buildResponse(context, 500,
                            createErrorResponse("error adding product, retry!!"))
            );
        }).onFailure(fail -> {
            Utility.buildResponse(context, 500, Utility.createErrorResponse(fail.getMessage()));
        });
    }

    public Future<ProductStatus> queryForProductId(String productId, String userId, String targetPrice) {
        Promise<ProductStatus> promise = Promise.promise();
        ProductStatus productStatus = new ProductStatus();
        JsonObject query = new JsonObject().put("productId", productId);
        mongoDBClient.queryRecords(query, "products").onSuccess(res -> {
            if (!res.isEmpty()) {
                log.info("product already exists");
                productStatus.setProductExists(true);
                Product product = Utility.castToClass(res.getFirst(), Product.class);
                product.getUserTargetPrices().forEach(userTargetPrice -> {
                    if (userTargetPrice.getUserId().equals(userId)) {
                        productStatus.setUserExists(true);
                        if (userTargetPrice.getTargetPrices().contains(targetPrice)) {
                            productStatus.setTargetPriceExists(true);
                        }
                    }
                });
            }
            log.info("logging productStatus {}", JsonObject.mapFrom(productStatus));
            promise.complete(productStatus);
        }).onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }
}
