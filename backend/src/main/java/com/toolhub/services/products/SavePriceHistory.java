package com.toolhub.services.products;

import com.toolhub.Utils.Utility;
import com.toolhub.models.PriceHistory;
import com.toolhub.models.Product;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.json.JsonObject;

import java.time.Instant;


public class SavePriceHistory {
    private final MongoDBClient mongoDBClient;
    public SavePriceHistory(MongoDBClient mongoDBClient) {
        this.mongoDBClient = mongoDBClient;
    }

    public void savePrice(JsonObject futureResult) {
        Product product = Utility.castToClass(futureResult.getJsonObject("product"), Product.class);
        JsonObject productInfo = futureResult.getJsonObject("productInfo");
        String productPrice = productInfo.getString("price");
        String productTitle = productInfo.getString("title");
        PriceHistory priceHistory = new PriceHistory(product.getProductId(),
                productTitle, product.getProductUrl(), productPrice, Instant.now());
        mongoDBClient.insertRecord(JsonObject.mapFrom(priceHistory), "pricehistory");

    }
}
