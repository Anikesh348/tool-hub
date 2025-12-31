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
                return mongoConfig;
            }).onSuccess(mongoConfig -> {
                mongoDBClient = new MongoDBClient(vertx, mongoConfig);
                mongoDBClient.pingConnection().onSuccess(res -> {
                    this.client = WebClient.create(vertx);
                    Router router = Router.router(vertx);
                    router.route().handler(
                            CorsHandler.create()
                                    .allowedMethod(HttpMethod.GET)
                                    .allowedMethod(HttpMethod.POST)
                                    .allowedMethod(HttpMethod.OPTIONS)
                                    .allowedHeader("Content-Type")
                                    .allowedHeader("Authorization")
                    );
                    router.route().handler(BodyHandler.create());
                    router.route("/api/protected/*")
                            .handler(new AuthHandler());
                    router.route("/api/protected/admin/*")
                            .handler(RoleHandler.allow(Role.ADMIN.name()));
                    new MovieHubAutomationRoute(client, dotenv).register(router, vertx);
                    UserManagement userManagement = new UserManagement(mongoDBClient);
                    SaveProduct saveProduct = new SaveProduct(mongoDBClient, client, vertx);
                    router.post("/api/login").handler(userManagement::handleLogin);
                    router.post("/api/register").handler(userManagement::handleRegister);
                    router.post("/api/protected/save-product").handler(saveProduct::saveProduct);
                    router.get("/api/schedule").handler(context
                            -> Schedule.schedulePriceCheck(context, mongoDBClient, vertx, client));
                    router.get("/api/protected/products")
                            .handler(context -> new GetProducts(mongoDBClient, context));
                    router.post("/api/protected/pricehistory")
                            .handler(context -> new GetPriceHistory(mongoDBClient, context));
                    router.post("/api/protected/delete")
                            .handler(context -> new DeleteProduct(mongoDBClient, context));
                    router.post("/api/protected/leetcode/add")
                            .handler(new AddQuestionController(mongoDBClient, client)::handle);
                    router.get("/api/protected/leetcode/questions").handler(new GetQuestions(mongoDBClient)::handle);
                    router.post("/api/protected/leetcode/update-status")
                    .handler(new UpdateQuestionStatus(mongoDBClient)::handle);
                    router.post("/api/protected/leetcode/update-notes")
                            .handler(new UpdateQuestionNotes(mongoDBClient)::handle);
                    router.post("/api/protected/leetcode/delete").handler(new DeleteQuestion(mongoDBClient)::handle);
                    
                    // Deploy PriceCheckSchedulerVerticle
                    vertx.deployVerticle(new PriceCheckSchedulerVerticle(mongoDBClient, client))
                            .onSuccess(deploymentId -> log.info("PriceCheckSchedulerVerticle deployed with ID: {}", deploymentId))
                            .onFailure(fail -> log.error("Failed to deploy PriceCheckSchedulerVerticle: {}", fail.getMessage()));
                    
                    vertx.createHttpServer()
                            .requestHandler(router)
                            .listen(8080)
                            .onSuccess(server -> {
                                log.info("Server started on port: {}", server.actualPort());
                                startFuture.complete();
                            }).onFailure(fail -> startFuture.fail(fail.getMessage()));
                }).onFailure(fail -> startFuture.fail(fail.getMessage()));
            }).onFailure(fail -> {
                log.error("failure in fetch mongo config {}", fail.getMessage());
                startFuture.fail(fail.getMessage());
            });
        } catch (Exception e) {
            log.error("Exception in starting the server {}", e.getMessage());
            startFuture.fail(e.getMessage());
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
