package com.toolhub.services.products;

import com.toolhub.models.Product;
import com.toolhub.models.ProductInfo;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.scrape.ScrapperClient;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class UpdateProductInfo {
    private static final Logger log = LoggerFactory.getLogger(UpdateProductInfo.class);
    private final MongoDBClient mongoDBClient;
    private final ScrapperClient scrapperClient;

    public UpdateProductInfo(MongoDBClient mongoDBClient, WebClient client) {
        this.mongoDBClient = mongoDBClient;
        this.scrapperClient = new ScrapperClient(client);
    }

    public void updateProductInfo(Product product) {
        scrapperClient.getScrappedProductDetails(product)
                .compose(response -> {
                    ProductInfo productInfo = createProductInfo(product, response);
                    return checkAndSaveProductInfo(productInfo);
                })
                .onSuccess(v -> log.info("Successfully processed product {}", product.getProductId()))
                .onFailure(error -> log.error("Failed to process product {}: {}",
                        product.getProductId(), error.getMessage()));
    }

    private ProductInfo createProductInfo(Product product, JsonObject response) {
        JsonObject productInfoObj = response.getJsonObject("productInfo");
        return new ProductInfo(
                product.getProductId(),
                productInfoObj.getString("title", ""),
                productInfoObj.getString("image", "")
        );
    }

    private Future<Void> checkAndSaveProductInfo(ProductInfo productInfo) {
        JsonObject query = new JsonObject().put("productId", productInfo.getProductId());

        return mongoDBClient.queryRecords(query, "product-information")
                .compose(existing -> {
                    if (existing == null || existing.isEmpty()) {
                        return saveProductInfo(productInfo);
                    } else {
                        log.info("Product information already exists for {}", productInfo.getProductId());
                        return Future.succeededFuture();
                    }
                });
    }

    private Future<Void> saveProductInfo(ProductInfo productInfo) {
        return mongoDBClient.insertRecord(JsonObject.mapFrom(productInfo), "product-information")
                .onSuccess(res -> log.info("Inserted product information for {}", productInfo.getProductId()))
                .onFailure(error -> log.error("Failed to insert product {}: {}",
                        productInfo.getProductId(), error.getMessage()))
                .mapEmpty();
    }
}