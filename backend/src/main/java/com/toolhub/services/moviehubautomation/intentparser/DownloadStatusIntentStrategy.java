package com.toolhub.services.moviehubautomation.intentparser;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.enums.user.Role;
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

public class DownloadStatusIntentStrategy implements IntentStrategy {

    private static final int MAX_ITEMS_IN_SUMMARY = 15;

    private final AiClient aiClient;
    private final MovieHubRequestPortalService movieHubRequestPortalService;
    private final Intent supportedIntent;

    public DownloadStatusIntentStrategy(
            AiClient aiClient,
            MovieHubRequestPortalService movieHubRequestPortalService,
            Intent supportedIntent
    ) {
        this.aiClient = aiClient;
        this.movieHubRequestPortalService = movieHubRequestPortalService;
        this.supportedIntent = supportedIntent;
    }

    @Override
    public Intent getIntent() {
        return supportedIntent;
    }

    @Override
    public Future<IntentResponse> automate(ConversationContext context, String userInput) {
        Promise<IntentResponse> promise = Promise.promise();
        JsonObject parseRequest = OpenAiRequestBuilder.buildPayload(context.getMediaState(), userInput, supportedIntent);
        aiClient.makeAiCall(parseRequest).onSuccess(llmResponse -> {
            LLMResponse.Query query = llmResponse.getQuery();
            String titleFilter = normalizeTitleFilter(query == null ? null : query.getTitle());
            MediaType mediaTypeFilter = query != null && query.getMediaType() != null
                    ? query.getMediaType()
                    : MediaType.UNKNOWN;
            String scope = resolveScope(context, query == null ? null : query.getScope());

            Future<JsonObject> activeDownloadsFuture =
                    movieHubRequestPortalService.getDownloadQueue(context.getUserId(), context.getUserRole(), scope);
            Future<JsonObject> completedDownloadsFuture =
                    movieHubRequestPortalService.getCompletedDownloads(context.getUserId(), context.getUserRole(), scope);

            CompositeFuture.all(activeDownloadsFuture, completedDownloadsFuture)
                    .onSuccess(result -> {
                        JsonObject activePayload = result.resultAt(0);
                        JsonObject completedPayload = result.resultAt(1);
                        JsonArray activeDownloads = activePayload.getJsonArray("downloads", new JsonArray());
                        JsonArray completedDownloads = completedPayload.getJsonArray("downloads", new JsonArray());
                        JsonArray filteredActive = filterDownloads(activeDownloads, titleFilter, mediaTypeFilter);
                        JsonArray filteredCompleted = filterDownloads(completedDownloads, titleFilter, mediaTypeFilter);

                        IntentResponse response = new IntentResponse();
                        response.setMessage(buildQueueSummary(
                                activePayload.getString("scope", "mine"),
                                titleFilter,
                                mediaTypeFilter,
                                filteredActive,
                                filteredCompleted
                        ));

                        if (titleFilter != null && !titleFilter.isBlank()) {
                            context.getMediaState().setTitle(titleFilter);
                        }
                        if (!MediaType.UNKNOWN.equals(mediaTypeFilter)) {
                            context.getMediaState().setMediaType(mediaTypeFilter);
                        }
                        context.setCompleted(true);
                        promise.complete(response);
                    }).onFailure(fail -> {
                        IntentResponse response = new IntentResponse();
                        response.setMessage("Failed to fetch download status: " + fail.getMessage());
                        promise.complete(response);
                    });
        }).onFailure(fail -> {
            IntentResponse response = new IntentResponse();
            response.setMessage("Unable to parse status query right now. Please try again.");
            promise.complete(response);
        });

        return promise.future();
    }

    private String resolveScope(ConversationContext context, String requestedScope) {
        if (!Role.ADMIN.name().equalsIgnoreCase(context.getUserRole())) {
            return "mine";
        }
        if (requestedScope == null || requestedScope.isBlank()) {
            return "mine";
        }
        String normalized = requestedScope.toLowerCase(Locale.ROOT).trim();
        if ("all".equals(normalized)) {
            return "all";
        }
        return "mine";
    }

    private String normalizeTitleFilter(String rawTitle) {
        if (rawTitle == null || rawTitle.isBlank()) {
            return null;
        }
        String cleaned = rawTitle.trim();
        if (cleaned.isBlank()) {
            return null;
        }
        return cleaned;
    }

    private JsonArray filterDownloads(JsonArray downloads, String titleFilter, MediaType mediaTypeFilter) {
        JsonArray filtered = new JsonArray();
        for (Object item : downloads) {
            if (!(item instanceof JsonObject download)) {
                continue;
            }
            if (!matchesMediaType(download, mediaTypeFilter)) {
                continue;
            }
            if (!matchesTitle(download, titleFilter)) {
                continue;
            }
            filtered.add(download);
        }
        return filtered;
    }

    private boolean matchesMediaType(JsonObject download, MediaType mediaTypeFilter) {
        if (mediaTypeFilter == null || MediaType.UNKNOWN.equals(mediaTypeFilter)) {
            return true;
        }
        String rawMediaType = download.getString("mediaType");
        if (rawMediaType == null) {
            return false;
        }
        return mediaTypeFilter.name().equalsIgnoreCase(rawMediaType);
    }

    private boolean matchesTitle(JsonObject download, String titleFilter) {
        if (titleFilter == null || titleFilter.isBlank()) {
            return true;
        }
        String queueTitle = normalizeTitle(download.getString("title"));
        String filterTitle = normalizeTitle(titleFilter);
        if (queueTitle.isBlank() || filterTitle.isBlank()) {
            return false;
        }
        return queueTitle.contains(filterTitle) || filterTitle.contains(queueTitle);
    }

    private String normalizeTitle(String title) {
        if (title == null) {
            return "";
        }
        String normalized = title;
        normalized = normalized.replaceAll("(?i)\\[[^\\]]*\\]", " ");
        normalized = normalized.replaceAll("(?i)\\([^)]*\\)", " ");
        normalized = normalized.replaceAll("(?i)\\bS\\d{1,2}(E\\d{1,2})?\\b.*", " ");
        normalized = normalized.replaceAll("(?i)\\b\\d{3,4}p\\b.*", " ");
        normalized = normalized.toLowerCase(Locale.ROOT);
        normalized = normalized.replaceAll("[^a-z0-9]+", "");
        return normalized.trim();
    }

    private String buildQueueSummary(
            String scope,
            String titleFilter,
            MediaType mediaTypeFilter,
            JsonArray activeDownloads,
            JsonArray completedDownloads
    ) {
        StringBuilder builder = new StringBuilder();
        builder.append("Download status report\n");
        builder.append("Scope: ").append(scope).append("\n");
        if (titleFilter != null && !titleFilter.isBlank()) {
            builder.append("Title filter: ").append(titleFilter).append("\n");
        }
        if (mediaTypeFilter != null && !MediaType.UNKNOWN.equals(mediaTypeFilter)) {
            builder.append("Media type filter: ").append(mediaTypeFilter).append("\n");
        }
        builder.append("Active downloads: ").append(activeDownloads.size()).append("\n");
        builder.append("Completed downloads: ").append(completedDownloads.size()).append("\n");

        if (activeDownloads.isEmpty() && completedDownloads.isEmpty()) {
            builder.append("No matching active or completed downloads found.");
            return builder.toString();
        }

        if (!activeDownloads.isEmpty()) {
            builder.append("Active entries:\n");
            int activeLimit = Math.min(activeDownloads.size(), MAX_ITEMS_IN_SUMMARY);
            for (int i = 0; i < activeLimit; i++) {
                JsonObject download = activeDownloads.getJsonObject(i);
                builder.append(i + 1)
                        .append(") [")
                        .append(download.getString("mediaType", "UNKNOWN"))
                        .append("] ")
                        .append(download.getString("title", "Unknown title"))
                        .append(" | status=")
                        .append(download.getString("status", "unknown"))
                        .append(" | state=")
                        .append(download.getString("trackedDownloadState", "unknown"));

                Object progress = download.getValue("progressPercent");
                if (progress instanceof Number number) {
                    builder.append(" | progress=").append(String.format(Locale.ROOT, "%.1f%%", number.doubleValue()));
                }
                String timeLeft = download.getString("timeleft");
                if (timeLeft != null && !timeLeft.isBlank()) {
                    builder.append(" | timeLeft=").append(timeLeft);
                }
                JsonArray seasonNumbers = download.getJsonArray("seasonNumbers", new JsonArray());
                if (!seasonNumbers.isEmpty()) {
                    builder.append(" | seasons=").append(seasonNumbers.encode());
                }
                builder.append("\n");
            }
            if (activeDownloads.size() > activeLimit) {
                builder.append("Additional active entries not shown: ")
                        .append(activeDownloads.size() - activeLimit)
                        .append("\n");
            }
        }

        if (!completedDownloads.isEmpty()) {
            builder.append("Completed entries:\n");
            int completedLimit = Math.min(completedDownloads.size(), MAX_ITEMS_IN_SUMMARY);
            for (int i = 0; i < completedLimit; i++) {
                JsonObject completed = completedDownloads.getJsonObject(i);
                builder.append(i + 1)
                        .append(") [")
                        .append(completed.getString("mediaType", "UNKNOWN"))
                        .append("] ")
                        .append(completed.getString("title", "Unknown title"))
                        .append(" | status=")
                        .append(completed.getString("status", "downloaded"));

                Object downloadedAt = completed.getValue("downloadedAt");
                if (downloadedAt != null) {
                    builder.append(" | downloadedAt=").append(downloadedAt);
                }
                JsonArray seasons = completed.getJsonArray("season", new JsonArray());
                if (!seasons.isEmpty()) {
                    builder.append(" | seasons=").append(seasons.encode());
                }
                builder.append("\n");
            }
            if (completedDownloads.size() > completedLimit) {
                builder.append("Additional completed entries not shown: ")
                        .append(completedDownloads.size() - completedLimit);
            }
        }
        return builder.toString();
    }
}
