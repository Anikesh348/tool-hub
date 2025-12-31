package com.toolhub.services.products;

import com.toolhub.models.Product;
import com.toolhub.services.batchprocessor.BatchProcessor;
import com.toolhub.services.batchprocessor.SaveHistoryAndAlertBatchProcessor;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.scrape.ScrapperClient;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

import static com.toolhub.Utils.Utility.*;

public class ProductChecker {
    private static final Logger log = LoggerFactory.getLogger(ProductChecker.class);
    MongoDBClient mongoDBClient;
    ScrapperClient scrapperClient;
    Vertx vertx;
    WebClient client;
    public ProductChecker(MongoDBClient mongoDBClient, Vertx vertx,  ScrapperClient scrapperClient, WebClient client) {
        this.mongoDBClient = mongoDBClient;
        this.scrapperClient = scrapperClient;
        this.vertx = vertx;
        this.client = client;
    }
    public void checkAllProducts() {
        mongoDBClient.queryRecords(new JsonObject(), "products")
                .onSuccess(productList -> {
                    List<Product> products = productList.stream().map(productJson
                            -> castToClass(productJson, Product.class)).toList();
                    BatchProcessor<Product> batchProcessor = new SaveHistoryAndAlertBatchProcessor(mongoDBClient,
                            vertx, scrapperClient, client);
                    batchProcessor.handleBatch(0, products);
                })
                .onFailure(fail -> log.error("Failed to fetch products from DB: {}", fail.getMessage()));
    }

    private Throwable unwrapCause(Throwable throwable) {
        while (throwable.getCause() != null) {
            throwable = throwable.getCause();
        }
        return throwable;
    }

}
