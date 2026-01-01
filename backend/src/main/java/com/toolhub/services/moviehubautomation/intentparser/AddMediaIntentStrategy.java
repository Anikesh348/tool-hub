package com.toolhub.services.moviehubautomation.intentparser;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.models.moviehubautomation.*;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddMediaControllerFactory;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClient;
import com.toolhub.services.moviehubautomation.llm.requestbuilder.OpenAiRequestBuilder;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

public class AddMediaIntentStrategy implements IntentStrategy {

    private static final Logger log = LoggerFactory.getLogger(AddMediaIntentStrategy.class);

    private final AiClient aiClient;
    private final Map<String, ConversationContext> conversationContextMap;
    private final AddMediaControllerFactory addMediaControllerFactory;

    public AddMediaIntentStrategy(AiClient aiClient,
                                  Map<String, ConversationContext> conversationContextMap,
                                  AddMediaControllerFactory addMediaControllerFactory) {
        this.aiClient = aiClient;
        this.conversationContextMap = conversationContextMap;
        this.addMediaControllerFactory = addMediaControllerFactory;
        log.info("AddMediaIntentStrategy initialized");
    }

    @Override
    public Intent getIntent() {
        return Intent.ADD_MEDIA;
    }

    private void updateContext(LLMResponse llmResponse, String conversationId) {
        log.info("conversationContextMap: {}", conversationContextMap);
        ConversationContext context = conversationContextMap.get(conversationId);
        context.getMediaState().setMediaType(llmResponse.getPayload().getMediaType());
        context.getMediaState().setQuality(llmResponse.getPayload().getQuality());
        context.getMediaState().setTitle(llmResponse.getPayload().getTitle());
        context.getMediaState().setSeason(llmResponse.getPayload().getSeason());
        log.info("Updated context for conversationId={} with title={}, mediaType={}, quality={}, season {}",
                conversationId, llmResponse.getPayload().getTitle(),
                llmResponse.getPayload().getMediaType(), llmResponse.getPayload().getQuality(),
                llmResponse.getPayload().getSeason());
    }

    @Override
    public Future<IntentResponse> automate(ConversationContext context, String userInput) {
        Promise<IntentResponse> intentResponsePromise = Promise.promise();
        log.info("Processing ADD_MEDIA intent for conversationId={}, userInput={}",
                context.getConversationId(), userInput);

        MediaState mediaState = context.getMediaState();
        JsonObject request = OpenAiRequestBuilder.buildPayload(mediaState, userInput, context.getIntent());
        IntentResponse intentResponse = new IntentResponse();

        aiClient.makeAiCall(request).onSuccess(llmResponse -> {
            try {
                log.info("Received LLM response for conversationId={}", context.getConversationId());
                updateContext(llmResponse, context.getConversationId());

                if (llmResponse.getClarification().isEmpty()) {
                    log.info("No clarification needed, proceeding to add content for title={}", mediaState.getTitle());
                    JsonObject mediaStateJson = JsonObject.mapFrom(mediaState);
                    addMediaControllerFactory.getClient(context.getMediaState().getMediaType())
                            .addContent(LookUpDTO.fromJson(mediaStateJson))
                            .onComplete(addContentRes -> {
                                if (addContentRes.succeeded()) {
                                    log.info("Successfully queued {} for download", mediaState.getTitle());
                                    intentResponse.setMessage(mediaState.getTitle() + " queued for download");
                                } else {
                                    log.error("Failed to add content for title={}: {}",
                                            mediaState.getTitle(), addContentRes.cause().getMessage());
                                    intentResponse.setMessage(addContentRes.cause().getMessage());
                                }
                                context.setCompleted(true);
                                intentResponsePromise.complete(intentResponse);
                            });
                } else {

                    log.info("Clarification needed for conversationId={}: {}",
                            context.getConversationId(), llmResponse.getClarification());
                    intentResponse.setMessage(llmResponse.getClarification());
                    intentResponsePromise.complete(intentResponse);
                }
            } catch (Exception e) {
                String errorMsg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
                log.error("Exception while processing LLM response for conversationId={}: {}",
                        context.getConversationId(), errorMsg);
                intentResponsePromise.fail(errorMsg);
            }
        }).onFailure(fail -> {
            log.error("AI call failed for conversationId={}: {}", context.getConversationId(), fail.getMessage());
            intentResponsePromise.fail(fail.getMessage());
        });
        return intentResponsePromise.future();
    }
}
