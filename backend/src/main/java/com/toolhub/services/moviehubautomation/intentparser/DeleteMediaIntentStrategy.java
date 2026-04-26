package com.toolhub.services.moviehubautomation.intentparser;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.models.moviehubautomation.ConversationContext;
import com.toolhub.models.moviehubautomation.IntentResponse;
import com.toolhub.models.moviehubautomation.LLMResponse;
import com.toolhub.services.moviehubautomation.llm.llimclient.AiClient;
import com.toolhub.services.moviehubautomation.llm.requestbuilder.OpenAiRequestBuilder;
import com.toolhub.services.moviehubautomation.portal.MovieHubRequestPortalService;
import io.vertx.core.CompositeFuture;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.util.Locale;

public class DeleteMediaIntentStrategy implements IntentStrategy {

    private final AiClient aiClient;
    private final MovieHubRequestPortalService movieHubRequestPortalService;

    public DeleteMediaIntentStrategy(AiClient aiClient, MovieHubRequestPortalService movieHubRequestPortalService) {
        this.aiClient = aiClient;
        this.movieHubRequestPortalService = movieHubRequestPortalService;
    }

    @Override
    public Intent getIntent() {
        return Intent.DELETE_MEDIA;
    }

    @Override
    public Future<IntentResponse> automate(ConversationContext context, String userInput) {
        Promise<IntentResponse> promise = Promise.promise();

        if (context.isAwaitingSelection()) {
            return handleSelection(context, userInput, promise);
        }

        JsonObject parseRequest = OpenAiRequestBuilder.buildPayload(context.getMediaState(), userInput, Intent.DELETE_MEDIA);
        aiClient.makeAiCall(parseRequest).onSuccess(llmResponse -> {
            LLMResponse.Query query = llmResponse.getQuery();
            String title = normalizeTitle(query == null ? null : query.getTitle());
            MediaType mediaType = query != null && query.getMediaType() != null
                    ? query.getMediaType()
                    : MediaType.UNKNOWN;

            IntentResponse response = new IntentResponse();
            if (title == null || title.isBlank()) {
                response.setMessage("Please share the exact movie or series title you want to delete.");
                promise.complete(response);
                return;
            }

            context.getMediaState().setTitle(title);
            if (!MediaType.UNKNOWN.equals(mediaType)) {
                context.getMediaState().setMediaType(mediaType);
            }

            if (MediaType.MOVIES.equals(mediaType) || MediaType.SHOWS.equals(mediaType)) {
                movieHubRequestPortalService.getAvailableMedia(mediaType)
                        .onSuccess(availableItems -> respondWithMatches(context, title, mediaType, availableItems, promise))
                        .onFailure(fail -> {
                            response.setMessage("Unable to check right now: " + fail.getMessage());
                            context.setCompleted(true);
                            promise.complete(response);
                        });
                return;
            }

            Future<JsonArray> movieFuture = movieHubRequestPortalService.getAvailableMedia(MediaType.MOVIES)
                    .recover(fail -> Future.succeededFuture(new JsonArray()));
            Future<JsonArray> showFuture = movieHubRequestPortalService.getAvailableMedia(MediaType.SHOWS)
                    .recover(fail -> Future.succeededFuture(new JsonArray()));

            CompositeFuture.all(movieFuture, showFuture).onSuccess(result -> {
                JsonArray movieResults = filterAvailableByTitle(result.resultAt(0), title);
                JsonArray showResults = filterAvailableByTitle(result.resultAt(1), title);
                JsonArray options = new JsonArray();
                options.addAll(buildOptions(movieResults, MediaType.MOVIES));
                options.addAll(buildOptions(showResults, MediaType.SHOWS));

                IntentResponse combinedResponse = new IntentResponse();
                if (options.isEmpty()) {
                    combinedResponse.setMessage("No matching movie or series was found for \"" + title + "\".");
                    context.setCompleted(true);
                    promise.complete(combinedResponse);
                    return;
                }

                context.setAwaitingSelection(true);
                context.setSelectionOptions(options);
                combinedResponse.setMessage(buildSelectionPrompt(title, options));
                combinedResponse.setOptions(buildUiOptions(options));
                promise.complete(combinedResponse);
            }).onFailure(fail -> {
                response.setMessage("Unable to check right now: " + fail.getMessage());
                context.setCompleted(true);
                promise.complete(response);
            });
        }).onFailure(fail -> {
            IntentResponse response = new IntentResponse();
            response.setMessage("Unable to parse delete request right now. Please try again.");
            promise.complete(response);
        });

        return promise.future();
    }

    private Future<IntentResponse> handleSelection(
            ConversationContext context,
            String userInput,
            Promise<IntentResponse> promise
    ) {
        IntentResponse response = new IntentResponse();
        JsonArray options = context.getSelectionOptions();
        if (options == null || options.isEmpty()) {
            context.setAwaitingSelection(false);
            response.setMessage("I do not have any delete candidates right now. Please share the title again.");
            promise.complete(response);
            return promise.future();
        }

        Integer selectedIndex = parseSelectionIndex(userInput, options.size());
        if (selectedIndex == null) {
            selectedIndex = findSelectionByValue(userInput, options);
        }
        if (selectedIndex == null) {
            response.setMessage(
                    "Please pick one item by number.\n\n" + buildSelectionPrompt(context.getMediaState().getTitle(), options)
            );
            response.setOptions(buildUiOptions(options));
            promise.complete(response);
            return promise.future();
        }

        JsonObject selected = options.getJsonObject(selectedIndex);
        Integer mediaId = selected.getInteger("mediaId");
        MediaType selectedMediaType = parseMediaType(selected.getString("mediaType"));
        String selectedTitle = selected.getString("title", context.getMediaState().getTitle());

        if (mediaId == null || mediaId < 1 || MediaType.UNKNOWN.equals(selectedMediaType)) {
            context.setAwaitingSelection(false);
            response.setMessage("I could not resolve that media item for deletion. Please try again.");
            promise.complete(response);
            return promise.future();
        }

        context.getMediaState().setTitle(selectedTitle);
        context.getMediaState().setMediaType(selectedMediaType);
        context.setAwaitingSelection(false);
        context.setSelectionOptions(new JsonArray());

        movieHubRequestPortalService.deleteAvailableMediaItem(selectedMediaType, mediaId, true, false)
                .onSuccess(deleteResult -> {
                    response.setMessage("Deleted \"" + selectedTitle + "\" from the server.");
                    context.setCompleted(true);
                    promise.complete(response);
                })
                .onFailure(fail -> {
                    response.setMessage("Failed to delete \"" + selectedTitle + "\": " + fail.getMessage());
                    context.setCompleted(true);
                    promise.complete(response);
                });
        return promise.future();
    }

    private void respondWithMatches(ConversationContext context,
                                    String title,
                                    MediaType mediaType,
                                    JsonArray availableItems,
                                    Promise<IntentResponse> promise) {
        JsonArray matches = filterAvailableByTitle(availableItems, title);
        IntentResponse response = new IntentResponse();
        if (matches.isEmpty()) {
            response.setMessage("No matching " + mediaTypeLabel(mediaType) + " was found for \"" + title + "\".");
            context.setCompleted(true);
            promise.complete(response);
            return;
        }

        JsonArray options = buildOptions(matches, mediaType);
        context.setAwaitingSelection(true);
        context.setSelectionOptions(options);
        response.setMessage(buildSelectionPrompt(title, options));
        response.setOptions(buildUiOptions(options));
        promise.complete(response);
    }

    private String buildSelectionPrompt(String title, JsonArray options) {
        StringBuilder builder = new StringBuilder();
        builder.append("I found matching items for \"").append(title).append("\".\n");
        builder.append("Pick one to delete:\n");
        for (int i = 0; i < options.size(); i++) {
            JsonObject option = options.getJsonObject(i);
            builder.append(i + 1).append(". ").append(option.getString("label", "Unknown")).append("\n");
        }
        return builder.toString().trim();
    }

    private JsonArray buildOptions(JsonArray results, MediaType mediaType) {
        JsonArray options = new JsonArray();
        if (results == null) {
            return options;
        }
        for (int i = 0; i < results.size(); i++) {
            JsonObject item = results.getJsonObject(i);
            Integer mediaId = mediaType == MediaType.MOVIES
                    ? item.getInteger("radarrId")
                    : item.getInteger("sonarrId");
            String label = formatTitle(item) + " [" + mediaType.name() + "]";
            options.add(new JsonObject()
                    .put("id", mediaType.name() + "_" + (i + 1))
                    .put("value", mediaType.name() + "_" + (i + 1))
                    .put("label", label)
                    .put("title", item.getString("title"))
                    .put("year", item.getInteger("year"))
                    .put("mediaType", mediaType.name())
                    .put("mediaId", mediaId));
        }
        return options;
    }

    private JsonArray buildUiOptions(JsonArray options) {
        JsonArray uiOptions = new JsonArray();
        for (int i = 0; i < options.size(); i++) {
            JsonObject option = options.getJsonObject(i);
            uiOptions.add(new JsonObject()
                    .put("id", option.getString("id"))
                    .put("value", option.getString("value"))
                    .put("label", option.getString("label"))
                    .put("title", option.getString("title"))
                    .put("year", option.getInteger("year")));
        }
        return uiOptions;
    }

    private Integer findSelectionByValue(String userInput, JsonArray options) {
        if (userInput == null || userInput.isBlank()) {
            return null;
        }
        String normalizedInput = normalizeText(userInput);
        for (int i = 0; i < options.size(); i++) {
            JsonObject option = options.getJsonObject(i);
            String optionId = normalizeText(option.getString("id"));
            String optionValue = normalizeText(option.getString("value"));
            String optionTitle = normalizeText(option.getString("title"));
            if (normalizedInput.equals(optionId)
                    || normalizedInput.equals(optionValue)
                    || (!optionTitle.isBlank() && normalizedInput.contains(optionTitle))) {
                return i;
            }
        }
        return null;
    }

    private Integer parseSelectionIndex(String userInput, int optionCount) {
        if (userInput == null) {
            return null;
        }
        String trimmed = userInput.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        try {
            int selected = Integer.parseInt(trimmed);
            if (selected >= 1 && selected <= optionCount) {
                return selected - 1;
            }
        } catch (NumberFormatException ignored) {
            // fall through to value matching
        }
        return null;
    }

    private JsonArray filterAvailableByTitle(JsonArray availableItems, String queryTitle) {
        JsonArray matches = new JsonArray();
        if (availableItems == null || queryTitle == null || queryTitle.isBlank()) {
            return matches;
        }
        String normalizedQuery = normalizeForMatch(queryTitle);
        for (Object item : availableItems) {
            if (!(item instanceof JsonObject mediaItem)) {
                continue;
            }
            String normalizedItemTitle = normalizeForMatch(mediaItem.getString("title"));
            if (normalizedItemTitle.isBlank()) {
                continue;
            }
            if (normalizedItemTitle.contains(normalizedQuery) || normalizedQuery.contains(normalizedItemTitle)) {
                matches.add(mediaItem);
            }
        }
        return matches;
    }

    private String normalizeTitle(String title) {
        if (title == null) {
            return null;
        }
        String cleaned = title.trim();
        return cleaned.isBlank() ? null : cleaned;
    }

    private String normalizeForMatch(String value) {
        if (value == null) {
            return "";
        }
        return value.toLowerCase(Locale.ROOT)
                .replaceAll("(?i)\\[[^\\]]*\\]", " ")
                .replaceAll("(?i)\\([^)]*\\)", " ")
                .replaceAll("[^a-z0-9]+", "")
                .trim();
    }

    private String normalizeText(String value) {
        if (value == null) {
            return "";
        }
        return value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "");
    }

    private String formatTitle(JsonObject item) {
        String title = item.getString("title", "Unknown");
        Integer year = item.getInteger("year");
        return year == null ? title : title + " (" + year + ")";
    }

    private String mediaTypeLabel(MediaType mediaType) {
        return MediaType.MOVIES.equals(mediaType) ? "movie" : "series";
    }

    private MediaType parseMediaType(String value) {
        if (value == null || value.isBlank()) {
            return MediaType.UNKNOWN;
        }
        try {
            return MediaType.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return MediaType.UNKNOWN;
        }
    }
}
