package com.toolhub.services.moviehubautomation;

import com.toolhub.Utils.*;
import com.toolhub.models.moviehubautomation.ConversationContext;
import com.toolhub.models.moviehubautomation.UserChatInput;
import com.toolhub.services.moviehubautomation.intentparser.IntentStrategyFactory;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClient;
import com.toolhub.services.moviehubautomation.orchestartor.AutomationOrchestrator;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;

import java.util.Map;

import static com.toolhub.Utils.Utility.*;

public class ChatAutomation {
    private final Map<String, ConversationContext> conversationContextMap;
    private final AiClient aiClient;
    private final IntentStrategyFactory intentStrategyFactory;


    public ChatAutomation(Map<String, ConversationContext> conversationContextMap,
                          AiClient aiClient, IntentStrategyFactory intentStrategyFactory) {
        this.conversationContextMap = conversationContextMap;
        this.aiClient = aiClient;
        this.intentStrategyFactory = intentStrategyFactory;
    }

    public void handle(RoutingContext context) {
        try {
            UserChatInput userChatInput = UserChatInput.fromJson(context.body().asJsonObject());
            String conversationId = userChatInput.getConversationId();
            String userInput = userChatInput.getUserInput();
            ConversationContext conversationContext;
            if (conversationContextMap.containsKey(conversationId)) {
                 conversationContext = conversationContextMap.get(conversationId);
            } else {
                conversationContext = new ConversationContext(conversationId);
                conversationContextMap.put(conversationId, conversationContext);
            }
            AutomationOrchestrator
                    .get(aiClient, intentStrategyFactory)
                    .orchestrate(userInput, conversationContext).onSuccess(res -> {
                        buildResponse(context, 200, createSuccessResponse(res));
                    }).onFailure(fail -> {
                        buildResponse(context, 500, createErrorResponse(fail.getMessage()));
                    });
        } catch (Exception e) {
            buildResponse(context, 500, createErrorResponse(e.getCause().getMessage()));
        }
    }
}
