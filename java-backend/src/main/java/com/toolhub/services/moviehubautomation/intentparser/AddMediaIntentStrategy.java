package com.toolhub.services.moviehubautomation.intentparser;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.enums.user.Role;
import com.toolhub.models.moviehubautomation.*;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClient;
import com.toolhub.services.moviehubautomation.llm.requestbuilder.OpenAiRequestBuilder;
import com.toolhub.services.moviehubautomation.mediacontrollers.AddMediaControllerFactory;
import com.toolhub.services.moviehubautomation.portal.MovieHubRequestPortalService;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AddMediaIntentStrategy implements IntentStrategy {

  private static final Logger log = LoggerFactory.getLogger(AddMediaIntentStrategy.class);

  private final AiClient aiClient;
  private final Map<String, ConversationContext> conversationContextMap;
  private final AddMediaControllerFactory addMediaControllerFactory;
  private final MovieHubRequestPortalService movieHubRequestPortalService;
  private final Intent supportedIntent;

  public AddMediaIntentStrategy(
      AiClient aiClient,
      Map<String, ConversationContext> conversationContextMap,
      AddMediaControllerFactory addMediaControllerFactory,
      MovieHubRequestPortalService movieHubRequestPortalService,
      Intent supportedIntent) {
    this.aiClient = aiClient;
    this.conversationContextMap = conversationContextMap;
    this.addMediaControllerFactory = addMediaControllerFactory;
    this.movieHubRequestPortalService = movieHubRequestPortalService;
    this.supportedIntent = supportedIntent;
    log.info("AddMediaIntentStrategy initialized for intent={}", supportedIntent);
  }

  @Override
  public Intent getIntent() {
    return supportedIntent;
  }

  private void updateContext(LLMResponse llmResponse, String conversationId) {
    log.info("conversationContextMap: {}", conversationContextMap);
    ConversationContext context = conversationContextMap.get(conversationId);
    context.getMediaState().setMediaType(llmResponse.getPayload().getMediaType());
    context.getMediaState().setQuality(llmResponse.getPayload().getQuality());
    context.getMediaState().setTitle(llmResponse.getPayload().getTitle());
    context.getMediaState().setSeason(llmResponse.getPayload().getSeason());
    log.info(
        "Updated context for conversationId={} with title={}, mediaType={}, quality={}, season {}",
        conversationId,
        llmResponse.getPayload().getTitle(),
        llmResponse.getPayload().getMediaType(),
        llmResponse.getPayload().getQuality(),
        llmResponse.getPayload().getSeason());
  }

  @Override
  public Future<IntentResponse> automate(ConversationContext context, String userInput) {
    Promise<IntentResponse> intentResponsePromise = Promise.promise();
    Intent effectiveIntent = resolveEffectiveIntent(context);
    boolean downgradedToRequest = !supportedIntent.equals(effectiveIntent);
    log.info(
        "Processing intent={} (effectiveIntent={}) for conversationId={}, userInput={}",
        supportedIntent,
        effectiveIntent,
        context.getConversationId(),
        userInput);

    if (context.isAwaitingSelection()) {
      handleSelection(
          context, userInput, intentResponsePromise, effectiveIntent, downgradedToRequest);
      return intentResponsePromise.future();
    }

    MediaState mediaState = context.getMediaState();
    JsonObject request =
        OpenAiRequestBuilder.buildPayload(mediaState, userInput, context.getIntent());
    IntentResponse intentResponse = new IntentResponse();

    aiClient
        .makeAiCall(request)
        .onSuccess(
            llmResponse -> {
              try {
                log.info(
                    "Received LLM response for conversationId={}", context.getConversationId());
                updateContext(llmResponse, context.getConversationId());

                if (llmResponse.getClarification().isEmpty()) {
                  if (mediaState.getMediaType() == null
                      || MediaType.UNKNOWN.equals(mediaState.getMediaType())) {
                    intentResponse.setMessage(
                        withPermissionNotice(
                            "Should I fetch a movie or a show?", downgradedToRequest));
                    intentResponsePromise.complete(intentResponse);
                    return;
                  }
                  movieHubRequestPortalService
                      .getTopLookupOptions(mediaState.getTitle(), mediaState.getMediaType(), 5)
                      .onSuccess(
                          options -> {
                            if (options == null || options.isEmpty()) {
                              intentResponse.setMessage(
                                  withPermissionNotice(
                                      "I couldn't find matching results. Please try a more specific title.",
                                      downgradedToRequest));
                              intentResponsePromise.complete(intentResponse);
                              return;
                            }
                            context.setSelectionOptions(options);
                            context.setAwaitingSelection(true);
                            intentResponse.setMessage(
                                withPermissionNotice(
                                    buildSelectionPrompt(options, mediaState.getMediaType()),
                                    downgradedToRequest));
                            intentResponse.setOptions(buildUiOptions(options));
                            intentResponsePromise.complete(intentResponse);
                          })
                      .onFailure(
                          fail -> {
                            log.error(
                                "Lookup options fetch failed for title={}",
                                mediaState.getTitle(),
                                fail);
                            intentResponse.setMessage(
                                withPermissionNotice(
                                    "Unable to fetch results right now. Please try again.",
                                    downgradedToRequest));
                            intentResponsePromise.complete(intentResponse);
                          });
                } else {

                  log.info(
                      "Clarification needed for conversationId={}: {}",
                      context.getConversationId(),
                      llmResponse.getClarification());
                  intentResponse.setMessage(
                      withPermissionNotice(llmResponse.getClarification(), downgradedToRequest));
                  intentResponsePromise.complete(intentResponse);
                }
              } catch (Exception e) {
                String errorMsg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
                log.error(
                    "Exception while processing LLM response for conversationId={}: {}",
                    context.getConversationId(),
                    errorMsg);
                intentResponsePromise.fail(errorMsg);
              }
            })
        .onFailure(
            fail -> {
              log.error(
                  "AI call failed for conversationId={}: {}",
                  context.getConversationId(),
                  fail.getMessage());
              intentResponsePromise.fail(fail.getMessage());
            });
    return intentResponsePromise.future();
  }

  private void handleSelection(
      ConversationContext context,
      String userInput,
      Promise<IntentResponse> intentResponsePromise,
      Intent effectiveIntent,
      boolean downgradedToRequest) {
    IntentResponse intentResponse = new IntentResponse();
    JsonArray options = context.getSelectionOptions();
    if (options == null || options.isEmpty()) {
      context.setAwaitingSelection(false);
      intentResponse.setMessage(
          withPermissionNotice(
              "I don't have options to select from. Please share the title again.",
              downgradedToRequest));
      intentResponsePromise.complete(intentResponse);
      return;
    }

    Integer selectedIndex = parseSelectionIndex(userInput, options.size());
    if (selectedIndex == null) {
      selectedIndex = parseSelectionByTitle(userInput, options);
    }

    if (selectedIndex == null) {
      intentResponse.setMessage(
          withPermissionNotice(
              "Please select one option by number.\n\n"
                  + buildSelectionPrompt(options, context.getMediaState().getMediaType()),
              downgradedToRequest));
      intentResponse.setOptions(buildUiOptions(options));
      intentResponsePromise.complete(intentResponse);
      return;
    }

    JsonObject selected = options.getJsonObject(selectedIndex);
    String selectedTitle = selected.getString("title");
    context.getMediaState().setTitle(selectedTitle);
    context.setAwaitingSelection(false);
    context.setSelectionOptions(new JsonArray());
    finalizeAction(context, intentResponsePromise, effectiveIntent);
  }

  private void finalizeAction(
      ConversationContext context,
      Promise<IntentResponse> intentResponsePromise,
      Intent effectiveIntent) {
    IntentResponse intentResponse = new IntentResponse();
    MediaState mediaState = context.getMediaState();
    LookUpDTO lookUpDTO = buildLookUpDTO(mediaState);

    if (Intent.DOWNLOAD_MEDIA.equals(effectiveIntent)) {
      addMediaControllerFactory
          .getClient(mediaState.getMediaType())
          .addContent(lookUpDTO)
          .onComplete(
              addContentRes -> {
                if (addContentRes.succeeded()) {
                  log.info(
                      "Successfully queued {} for download. Creating tracking request for admin userId={}",
                      mediaState.getTitle(),
                      context.getUserId());
                  movieHubRequestPortalService
                      .createApprovedRequestFromAutomation(context.getUserId(), lookUpDTO)
                      .onSuccess(
                          trackingRes -> {
                            intentResponse.setMessage(
                                mediaState.getTitle() + " queued for download");
                            context.setCompleted(true);
                            intentResponsePromise.complete(intentResponse);
                          })
                      .onFailure(
                          trackingFail -> {
                            log.error(
                                "Media queued but failed to create tracking request for title={} userId={}",
                                mediaState.getTitle(),
                                context.getUserId(),
                                trackingFail);
                            intentResponse.setMessage(
                                mediaState.getTitle()
                                    + " queued for download, but tracking for completion alerts failed.");
                            context.setCompleted(true);
                            intentResponsePromise.complete(intentResponse);
                          });
                } else {
                  log.error(
                      "Failed to add content for title={}: {}",
                      mediaState.getTitle(),
                      addContentRes.cause().getMessage());
                  intentResponse.setMessage(addContentRes.cause().getMessage());
                  context.setCompleted(true);
                  intentResponsePromise.complete(intentResponse);
                }
              });
      return;
    }

    movieHubRequestPortalService
        .createRequestFromAutomation(context.getUserId(), lookUpDTO)
        .onSuccess(
            res -> {
              intentResponse.setMessage(
                  mediaState.getTitle() + " request submitted for admin approval.");
              context.setCompleted(true);
              intentResponsePromise.complete(intentResponse);
            })
        .onFailure(
            fail -> {
              intentResponse.setMessage(fail.getMessage());
              context.setCompleted(true);
              intentResponsePromise.complete(intentResponse);
            });
  }

  private Intent resolveEffectiveIntent(ConversationContext context) {
    if (Intent.DOWNLOAD_MEDIA.equals(supportedIntent) && !isAdmin(context)) {
      context.setIntent(Intent.RAISE_REQUEST);
      return Intent.RAISE_REQUEST;
    }
    return supportedIntent;
  }

  private LookUpDTO buildLookUpDTO(MediaState mediaState) {
    LookUpDTO lookUpDTO = new LookUpDTO();
    lookUpDTO.setTitle(mediaState.getTitle());
    lookUpDTO.setMediaType(mediaState.getMediaType());
    lookUpDTO.setQuality(mediaState.getQuality());
    lookUpDTO.setSeason(mediaState.getSeason());
    return lookUpDTO;
  }

  private boolean isAdmin(ConversationContext context) {
    return Role.ADMIN.name().equalsIgnoreCase(context.getUserRole());
  }

  private String buildSelectionPrompt(JsonArray options, Object mediaType) {
    StringBuilder builder = new StringBuilder();
    builder.append("I found these results");
    if (mediaType != null) {
      builder.append(" (").append(mediaType).append(")");
    }
    builder.append(":\n");
    for (int i = 0; i < options.size(); i++) {
      JsonObject option = options.getJsonObject(i);
      String title = option.getString("title", "Unknown");
      Integer year = option.getInteger("year");
      builder.append(i + 1).append(". ").append(title);
      if (year != null) {
        builder.append(" (").append(year).append(")");
      }
      builder.append("\n");
    }
    builder.append("\nReply with the option number.");
    return builder.toString();
  }

  private JsonArray buildUiOptions(JsonArray options) {
    JsonArray uiOptions = new JsonArray();
    for (int i = 0; i < options.size(); i++) {
      JsonObject option = options.getJsonObject(i);
      uiOptions.add(
          new JsonObject()
              .put("id", String.valueOf(i + 1))
              .put("value", String.valueOf(i + 1))
              .put("label", formatOptionLabel(option))
              .put("title", option.getString("title"))
              .put("year", option.getInteger("year")));
    }
    return uiOptions;
  }

  private String formatOptionLabel(JsonObject option) {
    String title = option.getString("title", "Unknown");
    Integer year = option.getInteger("year");
    return year == null ? title : title + " (" + year + ")";
  }

  private Integer parseSelectionIndex(String userInput, int optionCount) {
    if (userInput == null) {
      return null;
    }
    Matcher matcher = Pattern.compile("(\\d+)").matcher(userInput.trim());
    if (!matcher.find()) {
      return null;
    }
    int oneBased = Integer.parseInt(matcher.group(1));
    if (oneBased < 1 || oneBased > optionCount) {
      return null;
    }
    return oneBased - 1;
  }

  private Integer parseSelectionByTitle(String userInput, JsonArray options) {
    if (userInput == null || userInput.isBlank()) {
      return null;
    }
    String normalizedInput = normalizeText(userInput);
    for (int i = 0; i < options.size(); i++) {
      JsonObject option = options.getJsonObject(i);
      String normalizedTitle = normalizeText(option.getString("title", ""));
      if (!normalizedTitle.isBlank() && normalizedTitle.contains(normalizedInput)) {
        return i;
      }
    }
    return null;
  }

  private String normalizeText(String value) {
    if (value == null) {
      return "";
    }
    return value.toLowerCase().replaceAll("[^a-z0-9]+", "");
  }

  private String withPermissionNotice(String message, boolean downgradedToRequest) {
    if (!downgradedToRequest) {
      return message;
    }
    return "Direct download is admin-only. I will raise a request instead.\n\n" + message;
  }
}
