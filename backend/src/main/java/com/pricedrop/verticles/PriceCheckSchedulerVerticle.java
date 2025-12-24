package com.pricedrop.verticles;

import com.pricedrop.services.mongo.MongoDBClient;
import com.pricedrop.services.products.ProductChecker;
import com.pricedrop.services.scrape.ScrapperClient;
import io.vertx.core.AbstractVerticle;
import io.vertx.core.Promise;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class PriceCheckSchedulerVerticle extends AbstractVerticle {
    private static final Logger log = LoggerFactory.getLogger(PriceCheckSchedulerVerticle.class);
    private MongoDBClient mongoDBClient;
    private WebClient client;
    private ScrapperClient scrapperClient;
    private ProductChecker productChecker;

    public PriceCheckSchedulerVerticle(MongoDBClient mongoDBClient, WebClient client) {
        this.mongoDBClient = mongoDBClient;
        this.client = client;
    }

    @Override
    public void start(Promise<Void> startFuture) {
        try {
            // Initialize dependencies
            this.scrapperClient = new ScrapperClient(client);
            this.productChecker = new ProductChecker(mongoDBClient, vertx, scrapperClient, client);

            long interval = 1 * 60 * 60 * 1000; // will run every 1 hour
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
            
            // Call price check periodically
            vertx.setPeriodic(interval, id -> {
                long startTime = System.currentTimeMillis();
                String readableTimestamp = LocalDateTime.now().format(formatter);
                log.info("Starting periodic price check at: {}", readableTimestamp);
                try {
                    productChecker.checkAllProducts();
                    long duration = System.currentTimeMillis() - startTime;
                    log.info("Periodic price check completed successfully. Duration: {} ms", duration);
                } catch (Exception e) {
                    log.error("Error during periodic price check: {}", e.getMessage(), e);
                }
            });

            log.info("PriceCheckSchedulerVerticle started successfully. Interval: {} ms", interval);
            startFuture.complete();
        } catch (Exception e) {
            log.error("Error starting PriceCheckSchedulerVerticle: {}", e.getMessage());
            startFuture.fail(e);
        }
    }

    @Override
    public void stop(Promise<Void> stopPromise) {
        log.info("Stopping PriceCheckSchedulerVerticle");
        stopPromise.complete();
    }
}
