package com.toolhub.services.schedule;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.products.ProductChecker;
import com.toolhub.services.scrape.ScrapperClient;
import io.vertx.core.Vertx;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;

public class Schedule {
    public static void schedulePriceCheck(RoutingContext context,
                                          MongoDBClient mongoDBClient,
                                          Vertx vertx, WebClient client) {
        // This method will be used to schedule the price check tasks
        ScrapperClient scrapperClient = new ScrapperClient(client);
        ProductChecker productChecker = new ProductChecker(mongoDBClient, vertx, scrapperClient, client);
        productChecker.checkAllProducts();
        Utility.buildResponse(context, 200,
                Utility.createSuccessResponse("Price check scheduled successfully"));
    }
}
