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

public class MediaExistsIntentStrategy implements IntentStrategy {

    private final AiClient aiClient;
    private final MovieHubRequestPortalService movieHubRequestPortalService;

    public MediaExistsIntentStrategy(AiClient aiClient, MovieHubRequestPortalService movieHubRequestPortalService) {
        this.aiClient = aiClient;
        this.movieHubRequestPortalService = movieHubRequestPortalService;
    }

    @Override
    public Intent getIntent() {
        return Intent.CHECK_MEDIA_EXISTS;
    }

    @Override
    public Future<IntentResponse> automate(ConversationContext context, String userInput) {
        Promise<IntentResponse> promise = Promise.promise();
        JsonObject parseRequest = OpenAiRequestBuilder.buildPayload(context.getMediaState(), userInput, Intent.CHECK_MEDIA_EXISTS);
        aiClient.makeAiCall(parseRequest).onSuccess(llmResponse -> {
            LLMResponse.Query query = llmResponse.getQuery();
            String title = normalizeTitle(query == null ? null : query.getTitle());
            MediaType mediaType = query != null && query.getMediaType() != null
                    ? query.getMediaType()
                    : MediaType.UNKNOWN;

            IntentResponse response = new IntentResponse();
            if (title == null || title.isBlank()) {
                response.setMessage("Please share the exact movie or series title you want me to check.");
                promise.complete(response);
                return;
            }

            context.getMediaState().setTitle(title);
            if (!MediaType.UNKNOWN.equals(mediaType)) {
                context.getMediaState().setMediaType(mediaType);
            }

            if (MediaType.MOVIES.equals(mediaType) || MediaType.SHOWS.equals(mediaType)) {
                movieHubRequestPortalService.getAvailableMedia(mediaType)
                        .onSuccess(availableItems -> {
                            JsonArray matches = filterAvailableByTitle(availableItems, title);
                            response.setMessage(buildSingleTypeMessage(title, mediaType, matches));
                            response.setOptions(buildOptions(matches, mediaType));
                            context.setCompleted(true);
                            promise.complete(response);
                        })
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
                response.setMessage(buildCombinedMessage(title, movieResults, showResults));
                JsonArray options = new JsonArray();
                options.addAll(buildOptions(movieResults, MediaType.MOVIES));
                options.addAll(buildOptions(showResults, MediaType.SHOWS));
                response.setOptions(options);
                context.setCompleted(true);
                promise.complete(response);
            }).onFailure(fail -> {
                response.setMessage("Unable to check right now: " + fail.getMessage());
                context.setCompleted(true);
                promise.complete(response);
            });
        }).onFailure(fail -> {
            IntentResponse response = new IntentResponse();
            response.setMessage("Unable to parse lookup query right now. Please try again.");
            promise.complete(response);
        });

        return promise.future();
    }

    private String normalizeTitle(String title) {
        if (title == null) {
            return null;
        }
        String cleaned = title.trim();
        return cleaned.isBlank() ? null : cleaned;
    }

    private String buildSingleTypeMessage(String title, MediaType mediaType, JsonArray results) {
        String mediaLabel = MediaType.MOVIES.equals(mediaType) ? "movie" : "series";
        if (results == null || results.isEmpty()) {
            return "No, \"" + title + "\" does not exist on the server as a " + mediaLabel + ".";
        }
        StringBuilder builder = new StringBuilder();
        builder.append("Yes, \"").append(title).append("\" exists on the server as a ").append(mediaLabel).append(".\n");
        builder.append("Matches in server library:\n");
        for (int i = 0; i < results.size(); i++) {
            JsonObject item = results.getJsonObject(i);
            builder.append(i + 1).append(". ").append(formatTitle(item)).append("\n");
        }
        return builder.toString().trim();
    }

    private String buildCombinedMessage(String title, JsonArray movieResults, JsonArray showResults) {
        boolean hasMovies = movieResults != null && !movieResults.isEmpty();
        boolean hasShows = showResults != null && !showResults.isEmpty();
        if (!hasMovies && !hasShows) {
            return "No, \"" + title + "\" does not exist on the server.";
        }

        StringBuilder builder = new StringBuilder();
        builder.append("Yes, \"").append(title).append("\" exists on the server.\n");
        if (hasMovies) {
            builder.append("Movies in library:\n");
            for (int i = 0; i < movieResults.size(); i++) {
                builder.append(i + 1).append(". ").append(formatTitle(movieResults.getJsonObject(i))).append("\n");
            }
        }
        if (hasShows) {
            builder.append("Series in library:\n");
            for (int i = 0; i < showResults.size(); i++) {
                JsonObject show = showResults.getJsonObject(i);
                builder.append(i + 1).append(". ").append(formatTitle(show));
                JsonArray availableSeasons = show.getJsonArray("availableSeasons", new JsonArray());
                if (!availableSeasons.isEmpty()) {
                    builder.append(" | seasons=").append(availableSeasons.encode());
                }
                builder.append("\n");
            }
        }
        return builder.toString().trim();
    }

    private String formatTitle(JsonObject item) {
        String title = item.getString("title", "Unknown");
        Integer year = item.getInteger("year");
        return year == null ? title : title + " (" + year + ")";
    }

    private JsonArray buildOptions(JsonArray results, MediaType mediaType) {
        JsonArray options = new JsonArray();
        if (results == null) {
            return options;
        }
        for (int i = 0; i < results.size(); i++) {
            JsonObject item = results.getJsonObject(i);
            String label = formatTitle(item);
            String value = item.getString("title", label);
            options.add(new JsonObject()
                    .put("id", mediaType.name() + "_" + (i + 1))
                    .put("label", label + " [" + mediaType.name() + "]")
                    .put("value", value)
                    .put("title", item.getString("title"))
                    .put("year", item.getInteger("year"))
                    .put("mediaType", mediaType.name()));
        }
        return options;
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
}
