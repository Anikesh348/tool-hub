package com.toolhub.routes;

import com.toolhub.middlewares.AuthHandler;
import com.toolhub.middlewares.RoleHandler;
import com.toolhub.services.admin.AdminService;
import com.toolhub.services.ai.AiChatService;
import com.toolhub.services.blogs.BlogService;
import com.toolhub.services.buzzwatch.BuzzWatchService;
import com.toolhub.services.courses.CourseService;
import com.toolhub.services.flights.FlightService;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.moviehubautomation.portal.MovieHubRequestPortalService;
import com.toolhub.services.notifications.NotificationService;
import com.toolhub.services.products.ProductSearchService;
import com.toolhub.services.speedtest.SpeedTestService;
import com.toolhub.services.user.UserManagement;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Vertx;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.client.WebClient;

/** Registers the Python-backend routes that were absent from the original Vert.x backend. */
public final class ParityRoutes {
  private ParityRoutes() {}

  public record Services(FlightService flights, BuzzWatchService buzzWatch) {}

  public static Services register(
      Router router,
      Router protectedRouter,
      Router adminRouter,
      Vertx vertx,
      WebClient webClient,
      MongoDBClient mongo,
      Dotenv env,
      MovieHubRequestPortalService movieHubRequests) {
    var speedTest = new SpeedTestService(vertx);
    protectedRouter.post("/speedtest/session").handler(speedTest::createSession);
    protectedRouter.get("/speedtest/ping").handler(speedTest::ping);
    protectedRouter.get("/speedtest/download").handler(speedTest::download);
    protectedRouter.post("/speedtest/upload").handler(speedTest::upload);

    var notifications = new NotificationService(mongo, env);
    protectedRouter.get("/notifications").handler(notifications::list);
    protectedRouter
        .post("/notifications")
        .handler(RoleHandler.allow("ADMIN"))
        .handler(notifications::publish);
    protectedRouter.post("/notifications/events").handler(notifications::ingest);
    protectedRouter.post("/notifications/read-all").handler(notifications::markAllRead);
    protectedRouter.post("/notifications/:notificationId/read").handler(notifications::markRead);
    protectedRouter
        .delete("/notifications/:notificationId")
        .handler(RoleHandler.allow("ADMIN"))
        .handler(notifications::delete);

    var users = new UserManagement(mongo, webClient, env);
    protectedRouter.get("/session").handler(users::handleSession);
    protectedRouter.post("/logout").handler(users::handleLogout);

    var flights = new FlightService(mongo, webClient, vertx, env);
    protectedRouter.get("/flights/provider-status").handler(flights::providerStatus);
    protectedRouter.get("/flights/places").handler(flights::places);
    protectedRouter.get("/flights/watches").handler(flights::listWatches);
    protectedRouter.post("/flights/watches").handler(flights::createWatch);
    protectedRouter.get("/flights/watches/:watchId").handler(flights::getWatch);
    protectedRouter.delete("/flights/watches/:watchId").handler(flights::deleteWatch);
    protectedRouter.post("/flights/watches/:watchId/check").handler(flights::checkWatch);
    protectedRouter.get("/flights/watches/:watchId/history").handler(flights::history);

    var ai = new AiChatService(mongo, webClient, vertx, env);
    adminRouter.get("/ai/health").handler(ai::health);
    adminRouter.post("/ai/chats").handler(ai::createChat);
    adminRouter.get("/ai/chats").handler(ai::listChats);
    adminRouter.get("/ai/chats/:chatId").handler(ai::getChat);
    adminRouter.post("/ai/chats/:chatId/messages").handler(ai::sendMessage);

    var courses = new CourseService(mongo, webClient, vertx, env);
    courses.seed();
    adminRouter.get("/courses").handler(courses::listCourses);
    adminRouter.get("/courses/questions/:questionId").handler(courses::getQuestion);
    adminRouter.get("/courses/:courseId").handler(courses::getCourse);
    adminRouter.get("/courses/:courseId/modules/:moduleSlug").handler(courses::getModule);
    adminRouter
        .patch("/courses/:courseId/modules/:moduleSlug/progress")
        .handler(courses::updateProgress);
    adminRouter
        .post("/courses/:courseId/modules/:moduleSlug/questions")
        .handler(courses::createQuestion);

    var productSearch = new ProductSearchService(webClient, vertx, env);
    router.get("/search").handler(productSearch::search);
    protectedRouter.get("/search").handler(productSearch::search);

    var administration = new AdminService(mongo, webClient, vertx, env);
    administration.register(adminRouter);

    var blogs = new BlogService(mongo, webClient, env);
    blogs.seed();
    protectedRouter.get("/blogs").handler(blogs::listPublic);
    protectedRouter.get("/blogs/:slug").handler(blogs::getPublic);
    protectedRouter.post("/blogs/:slug/term-summary").handler(blogs::termSummary);
    protectedRouter.post("/blogs/:slug/events").handler(blogs::event);
    protectedRouter.post("/blogs/:slug/reaction").handler(blogs::reaction);
    protectedRouter
        .get("/blogs/:slug/comments")
        .handler(AuthHandler.optional())
        .handler(blogs::comments);
    protectedRouter
        .post("/blogs/:slug/comments")
        .handler(AuthHandler.required())
        .handler(blogs::createComment);
    protectedRouter
        .delete("/blogs/:slug/comments/:commentId")
        .handler(AuthHandler.required())
        .handler(blogs::deleteComment);
    protectedRouter.get("/blog-assets/:assetId").handler(blogs::asset);
    adminRouter.get("/blogs").handler(blogs::listAdmin);
    adminRouter.post("/blogs").handler(blogs::createBlog);
    adminRouter.put("/blogs/:slug").handler(blogs::updateBlog);
    adminRouter.get("/blogs/:slug/versions").handler(blogs::versions);
    adminRouter.post("/blogs/:slug/versions").handler(blogs::createVersion);
    adminRouter.put("/blogs/:slug/versions/:versionId").handler(blogs::updateVersion);
    adminRouter.post("/blogs/:slug/versions/:versionId/publish").handler(blogs::publishVersion);
    adminRouter.post("/blog-assets").handler(blogs::uploadAsset);
    adminRouter.get("/blog-metrics").handler(blogs::metrics);

    var buzzWatch = new BuzzWatchService(mongo, webClient, env, movieHubRequests);
    protectedRouter.get("/buzzwatch/genres").handler(buzzWatch::genres);
    protectedRouter.get("/buzzwatch/preference").handler(buzzWatch::preference);
    protectedRouter.put("/buzzwatch/preference").handler(buzzWatch::savePreference);
    protectedRouter.get("/buzzwatch/items").handler(buzzWatch::items);
    protectedRouter.get("/buzzwatch/items/:itemId/details").handler(buzzWatch::details);
    protectedRouter.get("/buzzwatch/details").handler(buzzWatch::details);
    protectedRouter.get("/buzzwatch/people").handler(buzzWatch::people);
    protectedRouter.get("/buzzwatch/people/:personId/credits").handler(buzzWatch::credits);
    protectedRouter.post("/buzzwatch/request").handler(buzzWatch::requestTitle);
    adminRouter.post("/buzzwatch/refresh").handler(buzzWatch::refresh);
    adminRouter.post("/settings/buzzwatch/refresh").handler(buzzWatch::refreshFromSettings);
    return new Services(flights, buzzWatch);
  }
}
