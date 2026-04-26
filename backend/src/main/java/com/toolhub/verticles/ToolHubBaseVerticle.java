package com.toolhub.verticles;

import com.toolhub.enums.user.Role;
import com.toolhub.middlewares.AuthHandler;
import com.toolhub.middlewares.RoleHandler;
import com.toolhub.routes.MovieHubAutomationRoute;
import com.toolhub.services.leetcode.*;
import com.toolhub.services.products.DeleteProduct;
import com.toolhub.services.products.GetPriceHistory;
import com.toolhub.services.products.GetProducts;
import com.toolhub.services.products.SaveProduct;
import com.toolhub.services.ytdownload.YtDownloadProxyService;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.schedule.Schedule;
import com.toolhub.services.user.UserManagement;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.AbstractVerticle;
import io.vertx.core.Promise;
import io.vertx.core.http.HttpMethod;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.client.WebClient;
import io.vertx.ext.web.handler.BodyHandler;
import io.vertx.ext.web.handler.CorsHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.InputStream;


public class ToolHubBaseVerticle extends AbstractVerticle {
    private static final Logger log = LoggerFactory.getLogger(ToolHubBaseVerticle.class);
    private MongoDBClient mongoDBClient;
    private WebClient client;
    private Dotenv dotenv;

    @Override
    public void start(Promise<Void> startFuture) {
        try {
            vertx.executeBlocking(() -> {
                JsonObject mongoConfig = loadMongoConfig();
                this.dotenv = Dotenv.configure().ignoreIfMissing().load();
                String mongoDbUrl = dotenv.get("DB_URL");
                mongoConfig.put("connection_string", mongoDbUrl);
                log.info("mongoConfig {}", mongoConfig);
                MongoDBClient mongoClient = new MongoDBClient(vertx, mongoConfig);
                mongoClient.pingConnection().toCompletionStage().toCompletableFuture().join();
                return mongoClient;
            }).onSuccess(mongoClient -> {
                this.mongoDBClient = mongoClient;
                this.client = WebClient.create(vertx);
                Router router = Router.router(vertx);
                router.route().handler(
                        CorsHandler.create()
                                .allowedMethod(HttpMethod.GET)
                                .allowedMethod(HttpMethod.POST)
                                .allowedMethod(HttpMethod.PUT)
                                .allowedMethod(HttpMethod.PATCH)
                                .allowedMethod(HttpMethod.DELETE)
                                .allowedMethod(HttpMethod.OPTIONS)
                                .allowedHeader("Content-Type")
                                .allowedHeader("Authorization")
                                .allowedHeader("Accept")
                                .allowedHeader("X-Requested-With")
                );
                router.route().handler(BodyHandler.create());

                router.get("/health").handler(ctx -> {
                    log.debug("Health check requested");
                    mongoDBClient.pingConnection()
                            .onSuccess(res -> {
                                log.debug("Health check OK: mongo up");
                                ctx.response()
                                        .putHeader("Content-Type", "application/json")
                                        .setStatusCode(200)
                                        .end(new JsonObject()
                                                .put("status", "ok")
                                                .put("mongo", "up")
                                                .encode());
                            })
                            .onFailure(err -> {
                                log.warn("Health check degraded: mongo down", err);
                                ctx.response()
                                        .putHeader("Content-Type", "application/json")
                                        .setStatusCode(503)
                                        .end(new JsonObject()
                                                .put("status", "degraded")
                                                .put("mongo", "down")
                                                .put("error", err.getMessage())
                                                .encode());
                            });
                });

                Router protectedRouter = Router.router(vertx);
                protectedRouter.route().handler(new AuthHandler());
                router.route("/v2/*").subRouter(protectedRouter);

                Router adminRouter = Router.router(vertx);
                adminRouter.route().handler(RoleHandler.allow(Role.ADMIN.name()));
                protectedRouter.route("/admin/*").subRouter(adminRouter);

                new MovieHubAutomationRoute(
                        client,
                        dotenv,
                        mongoDBClient
                ).register(protectedRouter, adminRouter, vertx);

                UserManagement userManagement = new UserManagement(mongoDBClient);
                SaveProduct saveProduct = new SaveProduct(mongoDBClient, client, vertx);
                YtDownloadProxyService ytDownloadProxyService = new YtDownloadProxyService(client, vertx, mongoDBClient, dotenv);

                router.post("/v2/login").handler(userManagement::handleLogin);
                router.post("/v2/token/refresh").handler(userManagement::handleRefreshToken);
                router.post("/v2/register").handler(userManagement::handleRegister);
                protectedRouter.post("/save-product").handler(saveProduct::saveProduct);

                router.get("/v2/schedule")
                        .handler(ctx -> Schedule.schedulePriceCheck(ctx, mongoDBClient, vertx, client));

                protectedRouter.get("/products")
                        .handler(ctx -> new GetProducts(mongoDBClient, ctx));
                protectedRouter.post("/pricehistory")
                        .handler(ctx -> new GetPriceHistory(mongoDBClient, ctx));
                protectedRouter.post("/delete")
                        .handler(ctx -> new DeleteProduct(mongoDBClient, ctx));

                protectedRouter.post("/leetcode/add")
                        .handler(new AddQuestionController(mongoDBClient, client)::handle);
                protectedRouter.get("/leetcode/questions")
                        .handler(new GetQuestions(mongoDBClient)::handle);
                protectedRouter.post("/leetcode/update-status")
                        .handler(new UpdateQuestionStatus(mongoDBClient)::handle);
                protectedRouter.post("/leetcode/update-notes")
                        .handler(new UpdateQuestionNotes(mongoDBClient)::handle);
                protectedRouter.post("/leetcode/delete")
                        .handler(new DeleteQuestion(mongoDBClient)::handle);

                protectedRouter.post("/yt/formats")
                        .handler(ytDownloadProxyService::handleFormats);

                //CRON ROUTES        
                protectedRouter.post("/yt/download/cronStart")
                        .handler(ytDownloadProxyService::handleCronStart);
                protectedRouter.get("/yt/download/cronStart")
                        .handler(ytDownloadProxyService::handleCronStart);
                protectedRouter.post("/yt/download/check")
                        .handler(ytDownloadProxyService::handleCheckAndUpdate);
                protectedRouter.get("/yt/download/check")
                        .handler(ytDownloadProxyService::handleCheckAndUpdate);
                        
                protectedRouter.get("/yt/download/status/stream/:videoId")
                        .handler(ytDownloadProxyService::handleStatusStream);
                adminRouter.post("/yt/download/start")
                        .handler(ytDownloadProxyService::handleStart);
                adminRouter.post("/yt/download/add")
                        .handler(ytDownloadProxyService::handleAdd);
                adminRouter.get("/yt/download/requests")
                        .handler(ytDownloadProxyService::handleListRequests);
                adminRouter.delete("/yt/download/requests/:requestId")
                        .handler(ytDownloadProxyService::handleDeleteRequest);
                adminRouter.get("/yt/download/status/:videoId")
                        .handler(ytDownloadProxyService::handleStatus);
                adminRouter.get("/yt/download/status/stream/:videoId")
                        .handler(ytDownloadProxyService::handleStatusStream);
                adminRouter.get("/yt/library/items")
                        .handler(ytDownloadProxyService::handleListLibraryItems);
                adminRouter.delete("/yt/library/items/:itemId")
                        .handler(ytDownloadProxyService::handleDeleteLibraryItem);

                vertx.deployVerticle(new PriceCheckSchedulerVerticle(mongoDBClient, client))
                        .onSuccess(id ->
                                log.info("PriceCheckSchedulerVerticle deployed with ID: {}", id))
                        .onFailure(err ->
                                log.error("Failed to deploy PriceCheckSchedulerVerticle", err));

                vertx.createHttpServer()
                        .requestHandler(router)
                        .listen(8080)
                        .onSuccess(server -> {
                            log.info("Server started on port: {}", server.actualPort());
                            startFuture.complete();
                        })
                        .onFailure(startFuture::fail);

            }).onFailure(err -> {
                log.error("Startup failed", err);
                startFuture.fail(err);
            });

        } catch (Exception e) {
            log.error("Exception in starting the server", e);
            startFuture.fail(e);
        }
    }



    private JsonObject loadMongoConfig() throws Exception {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("mongo-config.json")) {
            if (is == null) {
                throw new RuntimeException("mongo-config.json not found in resources");
            }
            // Read stream and parse JSON
            return new JsonObject(new String(is.readAllBytes()));
        }
    }

    @Override
    public void stop(Promise<Void> stopPromise) {
        if (mongoDBClient.getMongoClient() != null) {
            mongoDBClient.getMongoClient().close();
        }
        if (client != null) {
            client.close();
        }
        stopPromise.complete();
    }

}
