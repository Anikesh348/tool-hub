package com.toolhub.services.moviehubautomation.orchestartor;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.models.moviehubautomation.*;
import com.toolhub.services.moviehubautomation.intentparser.IntentStrategyFactory;
import com.toolhub.services.moviehubautomation.intentparser.RegexIntentResolver;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClient;
import com.toolhub.services.moviehubautomation.llm.requestbuilder.OpenAiRequestBuilder;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AutomationOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(AutomationOrchestrator.class);

    private final AiClient aiClient;
    private final IntentStrategyFactory intentStrategyFactory;

    public static AutomationOrchestrator get(AiClient aiClient, IntentStrategyFactory intentStrategyFactory) {
        return new AutomationOrchestrator(aiClient, intentStrategyFactory);
    }

    private AutomationOrchestrator(AiClient aiClient, IntentStrategyFactory intentStrategyFactory) {
        this.aiClient = aiClient;
        this.intentStrategyFactory = intentStrategyFactory;
        log.info("AutomationOrchestrator initialized");
    }

    private void intentStrategicFlow(ConversationContext context,
                                     String userInput,
                                     Promise<String> chatResponsePromise,
                                     Intent intent) {
        log.info("Executing intent strategy flow for intent={}, conversationId={}",
                intent, context.getConversationId());
        try {
            intentStrategyFactory.getStrategy(intent)
                    .automate(context, userInput)
                    .onSuccess(res -> {
                        log.info("Intent strategy completed successfully for conversationId={}",
                                context.getConversationId());
                        chatResponsePromise.complete(res.getMessage());
                    })
                    .onFailure(fail -> {
                        String errorMsg = fail.getMessage() != null ? fail.getMessage() : "Unknown error in intent strategy";
                        log.error("Intent strategy failed for conversationId={}: {}",
                                context.getConversationId(), errorMsg);
                        chatResponsePromise.fail(errorMsg);
                    });
        } catch (IllegalStateException e) {
            log.error("No strategy registered for intent={}: {}", intent, e.getMessage());
            chatResponsePromise.fail("Unsupported operation: " + intent);
        } catch (Exception e) {
            String errorMsg = e.getMessage() != null ? e.getMessage() : "Unexpected error in intent strategy flow";
            log.error("Unexpected error in intent strategy flow for conversationId={}: {}",
                    context.getConversationId(), errorMsg);
            chatResponsePromise.fail(errorMsg);
        }
    }

    public Future<String> orchestrate(String userInput, ConversationContext context) {
        Promise<String> chatResponsePromise = Promise.promise();

        if (userInput == null || userInput.isBlank()) {
            chatResponsePromise.fail("User input cannot be empty");
            return chatResponsePromise.future();
        }

        if (context == null) {
            chatResponsePromise.fail("Conversation context is required");
            return chatResponsePromise.future();
        }

        log.info("Orchestrating request for conversationId={}, userInput={}",
                context.getConversationId(), userInput);

        if (context.isCompleted()) {
            context.reset();
        }

        Intent intent = context.getIntent();

        if (Intent.UNKNOWN.equals(intent)) {
            Intent regexIntent = RegexIntentResolver.resolve(userInput);
            if (!Intent.UNKNOWN.equals(regexIntent)) {
                log.info("Regex resolved intent={} for conversationId={}",
                        regexIntent, context.getConversationId());
                context.setIntent(regexIntent);
                intentStrategicFlow(context, userInput, chatResponsePromise, regexIntent);
                return chatResponsePromise.future();
            }
        }

        if (Intent.UNKNOWN.equals(context.getIntent())) {
            log.info("Falling back to LLM intent classification for conversationId={}",
                    context.getConversationId());

            JsonObject intentRequest = OpenAiRequestBuilder.buildPayload(context.getMediaState(),
                    userInput, Intent.UNKNOWN);

            aiClient.makeAiCall(intentRequest)
                    .onSuccess(llmResponse -> {
                        Intent classifiedIntent = llmResponse.getIntent();

                        if (classifiedIntent == null || Intent.UNKNOWN.equals(classifiedIntent)) {
                            chatResponsePromise.fail(
                                    "I'm not sure I understood that. You can ask me to download movies or shows."
                            );
                            return;
                        }

                        context.setIntent(classifiedIntent);
                        intentStrategicFlow(context, userInput, chatResponsePromise, classifiedIntent);
                    })
                    .onFailure(err -> {
                        log.error("AI intent classification failed: {}", err.getMessage());
                        chatResponsePromise.fail(
                                "Sorry, I'm having trouble understanding your request right now."
                        );
                    });

            return chatResponsePromise.future();
        }

        intentStrategicFlow(context, userInput, chatResponsePromise, context.getIntent());
        return chatResponsePromise.future();
    }

}
