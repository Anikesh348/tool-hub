package com.toolhub.services.moviehubautomation.orchestartor;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.models.moviehubautomation.ConversationContext;
import com.toolhub.models.moviehubautomation.IntentResponse;
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

    private final IntentStrategyFactory strategyFactory;
    private final AiClient aiClient;

    public static AutomationOrchestrator get(AiClient aiClient, IntentStrategyFactory intentStrategyFactory) {
        return new AutomationOrchestrator(intentStrategyFactory, aiClient);
    }
    private AutomationOrchestrator(
            IntentStrategyFactory strategyFactory,
            AiClient aiClient
    ) {
        this.strategyFactory = strategyFactory;
        this.aiClient = aiClient;
    }

    public Future<IntentResponse> orchestrate(String userInput, ConversationContext context) {

        Promise<IntentResponse> chatResponsePromise = Promise.promise();

        if (userInput == null || userInput.isBlank()) {
            IntentResponse response = new IntentResponse();
            response.setMessage("Input cannot be empty");
            chatResponsePromise.complete(response);
            return chatResponsePromise.future();
        }

        if (context == null) {
            IntentResponse response = new IntentResponse();
            response.setMessage("Conversation context missing");
            chatResponsePromise.complete(response);
            return chatResponsePromise.future();
        }

        log.info("Orchestrating conversationId={}, input={}",
                context.getConversationId(), userInput);

        // Reset context if previous flow finished
        if (context.isCompleted()) {
            context.reset();
        }

        // Resolve intent (regex first)
        Intent intent = context.getIntent();

        if (Intent.UNKNOWN.equals(intent)) {
            Intent regexIntent = RegexIntentResolver.resolve(userInput);

            if (!Intent.UNKNOWN.equals(regexIntent)) {
                log.info("Regex resolved intent={} for conversationId={}",
                        regexIntent, context.getConversationId());

                context.setIntent(regexIntent);
                executeIntent(context, userInput, chatResponsePromise);
                return chatResponsePromise.future();
            }
        }

        // LLM fallback for intent
        if (Intent.UNKNOWN.equals(context.getIntent())) {

            JsonObject intentRequest =
                    OpenAiRequestBuilder.buildPayload(context.getMediaState(), userInput, Intent.UNKNOWN);

            aiClient.makeAiCall(intentRequest)
                    .onSuccess(llmResponse -> {
                        Intent classifiedIntent = llmResponse.getIntent();

                        if (classifiedIntent == null || Intent.UNKNOWN.equals(classifiedIntent)) {
                            IntentResponse response = new IntentResponse();
                            response.setMessage("I’m not sure I understood that. You can ask me to download or request a movie/TV show.");
                            chatResponsePromise.complete(response);
                            return;
                        }

                        context.setIntent(classifiedIntent);
                        executeIntent(context, userInput, chatResponsePromise);
                    })
                    .onFailure(err -> {
                        log.error("Intent classification failed", err);
                        IntentResponse response = new IntentResponse();
                        response.setMessage("Sorry, I’m having trouble understanding that right now.");
                        chatResponsePromise.complete(response);
                    });

            return chatResponsePromise.future();
        }

        // Intent already known
        executeIntent(context, userInput, chatResponsePromise);
        return chatResponsePromise.future();
    }


    private void executeIntent(
            ConversationContext context,
            String userInput,
            Promise<IntentResponse> chatResponsePromise
    ) {
        strategyFactory
                .getStrategy(context.getIntent())
                .automate(context, userInput)
                .onSuccess(intentResponse -> {
                    summarizeIfNeeded(context, intentResponse, chatResponsePromise);
                })
                .onFailure(err -> {
                    log.error("Intent execution failed", err);
                    IntentResponse response = new IntentResponse();
                    response.setMessage("Something went wrong while processing your request.");
                    chatResponsePromise.complete(response);
                });
    }


    private void summarizeIfNeeded(
            ConversationContext context,
            IntentResponse backendResponse,
            Promise<IntentResponse> chatResponsePromise
    ) {
        if (!context.isCompleted()) {
            chatResponsePromise.complete(backendResponse);
            return;
        }

        JsonObject summaryRequest =
                OpenAiRequestBuilder.buildPayload(
                        context.getMediaState(),
                        backendResponse.getMessage(),
                        Intent.SUMMARIZE
                );

        aiClient.makeAiCall(summaryRequest)
                .onSuccess(summaryResponse -> {
                    IntentResponse summarized = new IntentResponse();
                    summarized.setMessage(summaryResponse.getSummary());
                    chatResponsePromise.complete(summarized);
                })
                .onFailure(err -> {
                    log.error("Summary generation failed, falling back", err);
                    chatResponsePromise.complete(backendResponse);
                });
    }
}
