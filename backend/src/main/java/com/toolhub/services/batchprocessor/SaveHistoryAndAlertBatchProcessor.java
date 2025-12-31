package com.toolhub.services.batchprocessor;

import com.toolhub.models.Product;
import com.toolhub.services.alerts.AlertsValidator;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.products.SavePriceHistory;
import com.toolhub.services.scrape.ScrapperClient;
import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

public class SaveHistoryAndAlertBatchProcessor implements BatchProcessor<Product> {
    private static final Logger log = LoggerFactory.getLogger(SaveHistoryAndAlertBatchProcessor.class);
    MongoDBClient mongoDBClient;
    SavePriceHistory savePriceHistory;
    AlertsValidator alertsValidator;
    ScrapperClient scrapperClient;
    WebClient client;
    public SaveHistoryAndAlertBatchProcessor(MongoDBClient mongoDBClient, Vertx vertx,
                                             ScrapperClient scrapperClient, WebClient client) {
        this.mongoDBClient = mongoDBClient;
        this.savePriceHistory = new SavePriceHistory(mongoDBClient);
        this.scrapperClient = scrapperClient;
        this.client = client;
        this.alertsValidator = new AlertsValidator(mongoDBClient, vertx, client);
    }
    @Override
    public void handleBatch(int start, List<Product> products) {
       if (start >= products.size()) return;
       log.info("calling in batches with start: {}", start);
       List<Product> subListProducts = products.subList(start,
               Math.min(start + LIMIT, products.size()));
       List<Future<JsonObject>> productQueryFutures = new ArrayList<>();
       subListProducts.forEach(product -> {
           productQueryFutures.add(scrapperClient.getScrappedProductDetails(product));
       });
       Future.join(productQueryFutures).onComplete(res -> {
           log.info("extracted all prices");
           productQueryFutures.forEach(future -> {
               if (future.succeeded()) {
                   JsonObject futureResult = future.result();
                   savePriceHistory.savePrice(futureResult);
                   alertsValidator.checkForAlertsAndSend(futureResult);
               }
           });
           handleBatch(start + LIMIT, products);
       });

    }
}
