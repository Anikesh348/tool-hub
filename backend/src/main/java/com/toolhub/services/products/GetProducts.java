package com.toolhub.services.products;

import com.toolhub.Utils.Utility;
import com.toolhub.models.Product;
import com.toolhub.models.ProductInfo;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

public class GetProducts {
    private static final Logger log = LoggerFactory.getLogger(GetProducts.class);
    private final MongoDBClient mongoDBClient;
    private final RoutingContext context;
    private final Map<String, Product> productMap;
    private final String userId;
    public GetProducts(MongoDBClient mongoDBClient, RoutingContext context) {
        this.mongoDBClient = mongoDBClient;
        this.context = context;
        this.userId = context.get("userId");
        this.productMap = new HashMap<>();
        this.fetchProducts();
    }

    private void fetchProducts() {
        JsonObject userQuery = new JsonObject().put("userTargetPrices",
                new JsonObject().put("$elemMatch",
                        new JsonObject().put("userId", userId)
                )
        );
        mongoDBClient.queryRecords(userQuery, "products")
                .onSuccess(this::handleProductList)
                .onFailure(this::handleError);
    }

    private void handleProductList(List<JsonObject> productList) {
        createProductMap(productList);
        List<String> productIds = extractProductIds(productList);
        fetchProductInformation(productIds);
    }

    private void createProductMap(List<JsonObject> productList) {
        productList.forEach(productObj -> {
            Product product = Utility.castToClass(productObj, Product.class);
            productMap.put(product.getProductId(), product);
        });
    }

    private List<String> extractProductIds(List<JsonObject> productList) {
        return productList.stream()
                .map(product -> product.getString("productId"))
                .distinct()
                .toList();
    }

    private void fetchProductInformation(List<String> productIds) {
        JsonObject query = new JsonObject()
                .put("productId", new JsonObject().put("$in", new JsonArray(productIds)));

        mongoDBClient.queryRecords(query, "product-information")
                .onSuccess(this::handleProductInformation)
                .onFailure(this::handleError);
    }

    private void handleProductInformation(List<JsonObject> response) {
        List<JsonObject> finalResponse = processFinalResponse(response);
        Utility.buildResponse(context, 200, finalResponse);
    }

    private void handleError(Throwable failure) {
        Utility.buildResponse(context, 500,
                Utility.createErrorResponse(failure.getMessage()));
    }


    private List<JsonObject> processFinalResponse(List<JsonObject> response) {
        List<JsonObject> finalResponse = new ArrayList<>();
        response.forEach(productInfoObj -> {
            try {
                ProductInfo productInfo = Utility.castToClass(productInfoObj, ProductInfo.class);
                Product product = productMap.get(productInfo.getProductId());
                product.getUserTargetPrices().forEach(userTargetPrice -> {
                    if (userTargetPrice.getUserId().equals(userId)) {
                        userTargetPrice.getTargetPrices().forEach(targetPrice ->
                                finalResponse.add(createProductEntry(product, targetPrice, productInfo)));
                    }
                });
            } catch (Exception e) {
                log.error(e.getMessage());
            }
        });

        return finalResponse;
    }

    private JsonObject createProductEntry(Product product, String targetPrice, ProductInfo productInfo) {
        return new JsonObject()
                .put("productId", product.getProductId())
                .put("productTitle", productInfo.getProductTitle())
                .put("productImageUrl", productInfo.getProductImageUrl())
                .put("productUrl", product.getProductUrl())
                .put("targetPrice", targetPrice);
    }
}