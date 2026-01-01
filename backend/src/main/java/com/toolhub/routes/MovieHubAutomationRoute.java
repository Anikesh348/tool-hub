package com.toolhub.routes;

import com.toolhub.enums.moviehubautomation.AiModel;
import com.toolhub.models.moviehubautomation.ConversationContext;
import com.toolhub.services.moviehubautomation.AddMedia;
import com.toolhub.services.moviehubautomation.ChatAutomation;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddMediaControllerFactory;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddMovieController;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddShowController;
import com.toolhub.services.moviehubautomation.intentparser.AddMediaIntentStrategy;
import com.toolhub.services.moviehubautomation.intentparser.IntentStrategyFactory;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClient;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClientFactory;
import com.toolhub.services.moviehubautomation.llm.llimclient.OpenAiClient;
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
    private final Map<String, ConversationContext> conversationContextMap;

    public MovieHubAutomationRoute(WebClient webClient, Dotenv dotenv) {
        this.webClient = webClient;
        this.dotenv = dotenv;
        this.conversationContextMap = new HashMap<>();
    }

    public void register(Router mainRouter, Vertx vertx) {
        Router subRoute = Router.router(vertx);
        String openAiUrl = dotenv.get("OPEN_AI_URL");
        String openAiApiKey = dotenv.get("OPEN_AI_API_KEY");
        String radarrBaseUrl = dotenv.get("RADARR_API_URL");
        String radarrApiKey = dotenv.get("RADARR_API_KEY");
        String sonarrBaseUrl = dotenv.get("SONARR_API_URL");
        String sonarrApiKey = dotenv.get("SONARR_API_KEY");
        AiModel aiModel = AiModel.valueOf(dotenv.get("AI_MODEL"));
        AiClientFactory aiClientFactory = new AiClientFactory(
                List.of(new OpenAiClient(webClient, openAiUrl, openAiApiKey)));
        AiClient aiClient = aiClientFactory.getClient(aiModel);
        AddMediaControllerFactory addMediaControllerFactory = new AddMediaControllerFactory(List.of(
                new AddMovieController(webClient, radarrBaseUrl, radarrApiKey),
                new AddShowController(webClient, sonarrBaseUrl, sonarrApiKey, vertx)
        ));
        IntentStrategyFactory intentStrategyFactory = new IntentStrategyFactory(
                List.of(new AddMediaIntentStrategy(aiClient, conversationContextMap, addMediaControllerFactory)));
        subRoute.post("/content")
                .handler(context -> new AddMedia(addMediaControllerFactory).handle(context));
        subRoute.post("/chat/completions")
                .handler(context -> new ChatAutomation(conversationContextMap,
                        aiClient, intentStrategyFactory).handle(context));
        mainRouter.route("/api/protected/admin/tools/moviehub/*").subRouter(subRoute);
    }
}
