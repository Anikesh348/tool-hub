package com.toolhub.routes;

import com.toolhub.enums.moviehubautomation.AiModel;
import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.models.moviehubautomation.ConversationContext;
import com.toolhub.services.moviehubautomation.ChatAutomation;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddMediaControllerFactory;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddMovieController;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddShowController;
import com.toolhub.services.moviehubautomation.intentparser.AddMediaIntentStrategy;
import com.toolhub.services.moviehubautomation.intentparser.DownloadStatusIntentStrategy;
import com.toolhub.services.moviehubautomation.intentparser.IntentStrategyFactory;
import com.toolhub.services.moviehubautomation.intentparser.MediaExistsIntentStrategy;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClient;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClientFactory;
import com.toolhub.services.moviehubautomation.llm.llimclient.OpenAiClient;
import com.toolhub.services.moviehubautomation.portal.MovieHubAccessPortalService;
import com.toolhub.services.moviehubautomation.portal.MovieHubRequestPortalService;
import com.toolhub.services.mongo.MongoDBClient;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Vertx;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.client.WebClient;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MovieHubAutomationRoute {

    private final WebClient webClient;
    private final Dotenv dotenv;
    private final MongoDBClient mongoDBClient;
    private final Map<String, ConversationContext> conversationContextMap;

    public MovieHubAutomationRoute(WebClient webClient,
                                   Dotenv dotenv,
                                   MongoDBClient mongoDBClient) {
        this.webClient = webClient;
        this.dotenv = dotenv;
        this.mongoDBClient = mongoDBClient;
        this.conversationContextMap = new HashMap<>();
    }

    public void register(Router protectedRouter, Router adminRouter, Vertx vertx) {
        String openAiUrl = dotenv.get("OPEN_AI_URL");
        String openAiApiKey = dotenv.get("OPEN_AI_API_KEY");
        String radarrBaseUrl = dotenv.get("RADARR_API_URL");
        String radarrApiKey = dotenv.get("RADARR_API_KEY");
        String sonarrBaseUrl = dotenv.get("SONARR_API_URL");
        String sonarrApiKey = dotenv.get("SONARR_API_KEY");
        String jellyfinBaseUrl = dotenv.get("JELLYFIN_BASE_URL");
        String jellyfinPublicUrl = dotenv.get("JELLYFIN_PUBLIC_URL");
        String jellyfinApiKey = dotenv.get("JELLYFIN_API_KEY");
        String movieHubPortalUrl = dotenv.get("MOVIEHUB_PORTAL_URL", "https://hostingfrompurava.xyz/moviehub");
        String movieHubAccessSecret = dotenv.get("MOVIEHUB_ACCESS_SECRET", dotenv.get("JWT_SECRET", ""));
        AiModel aiModel = AiModel.valueOf(dotenv.get("AI_MODEL"));
        AiClientFactory aiClientFactory = new AiClientFactory(
                List.of(new OpenAiClient(webClient, openAiUrl, openAiApiKey)));
        AiClient aiClient = aiClientFactory.getClient(aiModel);
        AddMediaControllerFactory addMediaControllerFactory = new AddMediaControllerFactory(List.of(
                new AddMovieController(webClient, radarrBaseUrl, radarrApiKey),
                new AddShowController(webClient, sonarrBaseUrl, sonarrApiKey, vertx)
        ));
        MovieHubRequestPortalService movieHubRequestPortalService = new MovieHubRequestPortalService(
                mongoDBClient,
                addMediaControllerFactory,
                webClient,
                radarrBaseUrl,
                radarrApiKey,
                sonarrBaseUrl,
                sonarrApiKey
        );
        MovieHubAccessPortalService movieHubAccessPortalService = new MovieHubAccessPortalService(
                mongoDBClient,
                webClient,
                jellyfinBaseUrl,
                jellyfinPublicUrl,
                jellyfinApiKey,
                movieHubPortalUrl,
                movieHubAccessSecret
        );
        IntentStrategyFactory intentStrategyFactory = new IntentStrategyFactory(
                List.of(new AddMediaIntentStrategy(
                        aiClient,
                        conversationContextMap,
                        addMediaControllerFactory,
                        movieHubRequestPortalService,
                        Intent.DOWNLOAD_MEDIA
                ), new AddMediaIntentStrategy(
                        aiClient,
                        conversationContextMap,
                        addMediaControllerFactory,
                        movieHubRequestPortalService,
                        Intent.RAISE_REQUEST
                ), new DownloadStatusIntentStrategy(
                        aiClient,
                        movieHubRequestPortalService,
                        Intent.CHECK_DOWNLOAD_STATUS
                ), new DownloadStatusIntentStrategy(
                        aiClient,
                        movieHubRequestPortalService,
                        Intent.LIST_DOWNLOADS
                ), new MediaExistsIntentStrategy(
                        aiClient,
                        movieHubRequestPortalService
                )));
//        adminRouter.post("/content")
//                .handler(context -> new AddMedia(addMediaControllerFactory).handle(context));
        protectedRouter.route("/moviehub/*")
                .handler(movieHubAccessPortalService::handleAccessGuard);
        protectedRouter.get("/moviehub/access/me")
                .handler(movieHubAccessPortalService::handleGetMyAccessStatus);
        protectedRouter.get("/moviehub/access/user")
                .handler(movieHubAccessPortalService::handleGetAccessUserMapping);
        protectedRouter.post("/moviehub/access/request")
                .handler(movieHubAccessPortalService::handleCreateAccessRequest);
        protectedRouter.post("/moviehub/access/resend-password")
                .handler(movieHubAccessPortalService::handleResendTemporaryPassword);
        protectedRouter.post("/moviehub/access/confirm-password-reset")
                .handler(movieHubAccessPortalService::handleConfirmPasswordReset);
        protectedRouter.get("/moviehub/search")
                .handler(movieHubRequestPortalService::handleSearch);
        protectedRouter.get("/moviehub/available")
                .handler(movieHubRequestPortalService::handleGetAvailableMedia);
        protectedRouter.get("/moviehub/downloads")
                .handler(movieHubRequestPortalService::handleGetDownloadQueue);
        protectedRouter.get("/moviehub/completedDownloads")
                .handler(movieHubRequestPortalService::handleGetCompletedDownloads);
        protectedRouter.get("/completedDownloads")
                .handler(movieHubRequestPortalService::handleGetCompletedDownloads);
        protectedRouter.get("/moviehub/reconcile-downloads")
                .handler(movieHubRequestPortalService::handleReconcileDownloadedRequests);
        protectedRouter.post("/moviehub/requests")
                .handler(movieHubRequestPortalService::handleCreateRequest);
        protectedRouter.get("/moviehub/requests")
                .handler(movieHubRequestPortalService::handleGetMyRequests);
        protectedRouter.post("/moviehub/requests/:requestId/delete")
                .handler(movieHubRequestPortalService::handleDeleteRequest);
        adminRouter.get("/moviehub/requests")
                .handler(movieHubRequestPortalService::handleGetAllRequests);
        adminRouter.post("/moviehub/requests/:requestId/approve")
                .handler(movieHubRequestPortalService::handleApproveRequest);
        adminRouter.get("/moviehub/access/requests")
                .handler(movieHubAccessPortalService::handleGetAccessRequests);
        adminRouter.post("/moviehub/access/requests/:requestId/approve")
                .handler(movieHubAccessPortalService::handleApproveAccessRequest);
        adminRouter.post("/moviehub/access/requests/:requestId/reject")
                .handler(movieHubAccessPortalService::handleRejectAccessRequest);
        adminRouter.get("/moviehub/access/users")
                .handler(movieHubAccessPortalService::handleGetAccessUsers);
        adminRouter.delete("/moviehub/access/users/:mappingId")
                .handler(movieHubAccessPortalService::handleDeleteAccessUser);
        protectedRouter.post("/moviehub/chat/completions")
                .handler(context -> new ChatAutomation(conversationContextMap,
                        aiClient, intentStrategyFactory).handle(context));
        adminRouter.post("/moviehub/chat/completions")
                .handler(context -> new ChatAutomation(conversationContextMap,
                        aiClient, intentStrategyFactory).handle(context));
    }
}
