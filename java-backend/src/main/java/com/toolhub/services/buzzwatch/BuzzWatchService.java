package com.toolhub.services.buzzwatch;

import com.toolhub.Utils.Utility;
import com.toolhub.enums.moviehubautomation.MediaType;
import com.toolhub.models.moviehubautomation.LookUpDTO;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.moviehubautomation.portal.MovieHubRequestPortalService;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.mongo.UpdateOptions;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import java.time.*;
import java.util.*;

public class BuzzWatchService {
  private static final String ITEMS = "buzzwatchitems",
      META = "buzzwatchmeta",
      PREFS = "buzzwatchpreferences",
      ACCESS = "moviehubusers";
  private static final String TMDB = "https://api.themoviedb.org/3",
      IMAGE = "https://image.tmdb.org/t/p/w500";
  private final MongoDBClient mongo;
  private final WebClient web;
  private final Dotenv env;
  private final MovieHubRequestPortalService movieHub;
  private final JsonArray genres = genresList();
  private final Set<String> genreKeys = new HashSet<>();

  public BuzzWatchService(
      MongoDBClient mongo, WebClient web, Dotenv env, MovieHubRequestPortalService movieHub) {
    this.mongo = mongo;
    this.web = web;
    this.env = env;
    this.movieHub = movieHub;
    for (Object x : genres) genreKeys.add(((JsonObject) x).getString("key"));
  }

  public void genres(RoutingContext c) {
    ok(c, Utility.createSuccessResponse(new JsonObject().put("genres", genres)));
  }

  public void preference(RoutingContext c) {
    preferenceFor(Objects.toString(c.get("userId")))
        .onSuccess(v -> ok(c, Utility.createSuccessResponse(v)))
        .onFailure(e -> fail(c, 500, e.getMessage()));
  }

  public void savePreference(RoutingContext c) {
    JsonArray raw =
        c.body().asJsonObject() == null
            ? new JsonArray()
            : c.body().asJsonObject().getJsonArray("genreKeys", new JsonArray());
    JsonArray valid = new JsonArray();
    for (Object v : raw) {
      String key = Objects.toString(v, "").trim().toLowerCase(Locale.ROOT);
      if (genreKeys.contains(key) && !valid.contains(key)) valid.add(key);
    }
    if (valid.isEmpty()) {
      fail(c, 400, "Choose at least one genre");
      return;
    }
    String uid = Objects.toString(c.get("userId")), now = now();
    mongo
        .queryRecords(new JsonObject().put("userId", uid), PREFS)
        .onSuccess(
            rows -> {
              String created = rows.isEmpty() ? now : rows.getFirst().getString("createdAt", now);
              JsonObject row =
                  new JsonObject()
                      .put("userId", uid)
                      .put("genreKeys", valid)
                      .put("updatedAt", now)
                      .put("createdAt", created);
              mongo
                  .getMongoClient()
                  .replaceDocumentsWithOptions(
                      PREFS,
                      new JsonObject().put("userId", uid),
                      row,
                      new UpdateOptions().setUpsert(true))
                  .onSuccess(
                      v ->
                          ok(
                              c,
                              Utility.createSuccessResponse(
                                  new JsonObject()
                                      .put("exists", true)
                                      .put("genreKeys", valid)
                                      .put("genres", genres)
                                      .put("createdAt", created)
                                      .put("updatedAt", now))))
                  .onFailure(e -> fail(c, 500, e.getMessage()));
            });
  }

  public void items(RoutingContext c) {
    String mode = "year".equals(c.request().getParam("mode")) ? "year" : "recent",
        year = Objects.toString(c.request().getParam("year"), "all"),
        mediaRaw = Objects.toString(c.request().getParam("mediaType"), "all");
    String media = Set.of("movie", "series").contains(mediaRaw) ? mediaRaw : "all";
    int limit = intRange(c.request().getParam("limit"), 120, 1, 240);
    String uid = Objects.toString(c.get("userId"));
    preferenceFor(uid)
        .onSuccess(
            pref -> {
              JsonObject q = new JsonObject();
              if (mode.equals("year") && !year.equals("all")) q.put("year", year);
              else
                q.put("catalogScope", "latest-streaming")
                    .put(
                        "releaseDate",
                        new JsonObject()
                            .put(
                                "$gte",
                                LocalDate.now(ZoneOffset.UTC).minusDays(windowDays()).toString()));
              if (!media.equals("all")) q.put("mediaType", media);
              mongo
                  .queryRecords(q, ITEMS)
                  .onSuccess(
                      rows -> {
                        List<String> selected =
                            pref.getJsonArray("genreKeys", new JsonArray()).stream()
                                .map(Object::toString)
                                .toList();
                        List<JsonObject> filtered =
                            rows.stream()
                                .filter(x -> matches(x, selected))
                                .map(x -> withMatch(x, selected))
                                .sorted(
                                    Comparator.comparingDouble(
                                            (JsonObject x) ->
                                                number(
                                                    x.getValue("recommendationScore"),
                                                    x.getDouble("matchScore", 0d)))
                                        .thenComparingDouble(
                                            x -> number(x.getValue("buzzScore"), 0))
                                        .reversed())
                                .toList();
                        int cap =
                            mode.equals("year")
                                ? intEnv("BUZZWATCH_YEAR_RESULT_TARGET", 30)
                                : Math.min(limit, 80);
                        JsonArray
                            shown =
                                new JsonArray(filtered.subList(0, Math.min(cap, filtered.size()))),
                            recent =
                                new JsonArray(filtered.subList(0, Math.min(24, filtered.size())));
                        mongo
                            .queryRecords(
                                new JsonObject()
                                    .put(
                                        "key",
                                        mode.equals("year") && !year.equals("all")
                                            ? "buzzwatch-year-" + year
                                            : "buzzwatch-refresh"),
                                META)
                            .onSuccess(
                                metas -> {
                                  JsonObject meta =
                                      metas.isEmpty() ? new JsonObject() : metas.getFirst();
                                  JsonObject result =
                                      new JsonObject()
                                          .put("genres", genres)
                                          .put("preference", pref)
                                          .put("mode", mode)
                                          .put("year", mode.equals("year") ? year : null)
                                          .put("mediaType", media)
                                          .put("items", shown)
                                          .put("recent", recent)
                                          .put(
                                              "insights",
                                              mode.equals("recent")
                                                  ? insights(filtered, meta)
                                                  : null)
                                          .put("years", years())
                                          .put(
                                              "stats",
                                              new JsonObject()
                                                  .put("totalMatches", filtered.size())
                                                  .put("shown", shown.size())
                                                  .put("recent", recent.size())
                                                  .put(
                                                      "rated",
                                                      filtered.stream()
                                                          .filter(
                                                              x ->
                                                                  x.getValue("rtScore") != null
                                                                      || x.getValue("tmdbRating")
                                                                          != null
                                                                      || x.getValue("imdbRating")
                                                                          != null)
                                                          .count())
                                                  .put(
                                                      "withRottenTomatoes",
                                                      filtered.stream()
                                                          .filter(
                                                              x -> x.getValue("rtScore") != null)
                                                          .count())
                                                  .put("providers", 0)
                                                  .put(
                                                      "averageBuzz",
                                                      filtered.stream()
                                                          .mapToDouble(
                                                              x ->
                                                                  number(
                                                                      x.getValue("buzzScore"), 0))
                                                          .average()
                                                          .orElse(0)))
                                          .put("lastUpdatedAt", meta.getValue("lastUpdatedAt"))
                                          .put(
                                              "ratingProvider",
                                              mode.equals("year")
                                                  ? (configured()
                                                      ? "TMDB + IMDb hybrid"
                                                      : "IMDb public datasets")
                                                  : meta.getString(
                                                      "ratingProvider", "Not refreshed yet"))
                                          .put(
                                              "cache",
                                              new JsonObject()
                                                  .put("hit", false)
                                                  .put("responseHit", false)
                                                  .put("layer", "mongo")
                                                  .put(
                                                      "ttlHours",
                                                      intEnv("BUZZWATCH_YEAR_CACHE_TTL_HOURS", 720))
                                                  .put(
                                                      "scope",
                                                      mode.equals("year")
                                                          ? "year:" + year
                                                          : "recent")
                                                  .put("servingStale", false)
                                                  .put("refreshQueued", false));
                                  ok(c, Utility.createSuccessResponse(result));
                                });
                      });
            });
  }

  public void people(RoutingContext c) {
    String query = Objects.toString(c.request().getParam("query"), "").trim();
    if (query.length() < 2) {
      fail(c, 400, "Enter at least two characters to search for an actor");
      return;
    }
    tmdb("/search/person", Map.of("query", query, "include_adult", "false"))
        .onSuccess(
            body -> {
              JsonArray out = new JsonArray();
              for (Object v : body.getJsonArray("results", new JsonArray())) {
                if (out.size() >= 8) break;
                JsonObject p = (JsonObject) v;
                out.add(
                    new JsonObject()
                        .put("personId", p.getValue("id"))
                        .put("name", p.getString("name"))
                        .put("profileUrl", image(p.getString("profile_path")))
                        .put("knownForDepartment", p.getString("known_for_department"))
                        .put("popularity", p.getValue("popularity"))
                        .put(
                            "knownFor",
                            p.getJsonArray("known_for", new JsonArray()).stream()
                                .filter(JsonObject.class::isInstance)
                                .map(JsonObject.class::cast)
                                .map(x -> x.getString("title", x.getString("name", "")))
                                .filter(x -> !x.isBlank())
                                .limit(3)
                                .toList()));
              }
              ok(
                  c,
                  Utility.createSuccessResponse(
                      new JsonObject().put("query", query).put("results", out)));
            })
        .onFailure(e -> fail(c, 503, e.getMessage()));
  }

  public void credits(RoutingContext c) {
    int person;
    try {
      person = Integer.parseInt(c.pathParam("personId"));
    } catch (Exception e) {
      fail(c, 400, "Invalid person id");
      return;
    }
    String media = Objects.toString(c.request().getParam("mediaType"), "all");
    tmdb("/person/" + person + "/combined_credits", Map.of())
        .onSuccess(
            body -> {
              JsonArray rows = new JsonArray();
              for (Object v : body.getJsonArray("cast", new JsonArray())) {
                if (!(v instanceof JsonObject x)) continue;
                String type = "movie".equals(x.getString("media_type")) ? "movie" : "series";
                if (!media.equals("all") && !media.equals(type)) continue;
                rows.add(normalizeTmdb(x, type, "person-credit"));
              }
              List<JsonObject> sorted =
                  rows.stream()
                      .filter(JsonObject.class::isInstance)
                      .map(JsonObject.class::cast)
                      .sorted(
                          Comparator.comparingDouble(
                                  (JsonObject x) -> number(x.getValue("popularity"), 0))
                              .reversed())
                      .limit(120)
                      .toList();
              preferenceFor(Objects.toString(c.get("userId")))
                  .onSuccess(
                      pref -> {
                        List<String> selected =
                            pref.getJsonArray("genreKeys", new JsonArray()).stream()
                                .map(Object::toString)
                                .toList();
                        JsonArray items =
                            new JsonArray(
                                sorted.stream().map(x -> withMatch(x, selected)).toList());
                        ok(
                            c,
                            Utility.createSuccessResponse(
                                new JsonObject()
                                    .put("personId", person)
                                    .put("mediaType", media)
                                    .put("items", items)));
                      });
            })
        .onFailure(e -> fail(c, 503, e.getMessage()));
  }

  public void details(RoutingContext c) {
    String id = c.pathParam("itemId");
    if (id == null) id = c.request().getParam("itemId");
    String itemId = id;
    mongo
        .queryRecords(new JsonObject().put("itemId", itemId), ITEMS)
        .onSuccess(
            rows -> {
              if (rows.isEmpty()) {
                fail(c, 404, "BuzzWatch title was not found");
                return;
              }
              JsonObject item = rows.getFirst(),
                  cache = item.getJsonObject("detailCache", new JsonObject()),
                  cached = cache.getJsonObject("value");
              if (cached != null) {
                ok(
                    c,
                    Utility.createSuccessResponse(
                        cached
                            .copy()
                            .put(
                                "cache",
                                new JsonObject()
                                    .put("hit", true)
                                    .put("layer", "mongo")
                                    .put("ttlHours", 24))));
                return;
              }
              resolveTmdbId(item)
                  .onSuccess(
                      tmdbId -> {
                        if (tmdbId == null) {
                          fail(c, 404, "Details are not available for this title");
                          return;
                        }
                        String type = "movie".equals(item.getString("mediaType")) ? "movie" : "tv";
                        tmdb(
                                "/" + type + "/" + tmdbId,
                                Map.of(
                                    "append_to_response",
                                    "credits,external_ids,content_ratings,release_dates"))
                            .onSuccess(
                                d -> {
                                  JsonArray cast = new JsonArray();
                                  for (Object v :
                                      d.getJsonObject("credits", new JsonObject())
                                          .getJsonArray("cast", new JsonArray())) {
                                    if (cast.size() >= 12) break;
                                    JsonObject p = (JsonObject) v;
                                    if (p.getString("name") != null)
                                      cast.add(
                                          new JsonObject()
                                              .put("personId", p.getValue("id"))
                                              .put("name", p.getString("name"))
                                              .put("character", p.getString("character", ""))
                                              .put(
                                                  "profileUrl",
                                                  image(p.getString("profile_path"))));
                                  }
                                  JsonArray creators = new JsonArray();
                                  for (Object v :
                                      d.getJsonObject("credits", new JsonObject())
                                          .getJsonArray("crew", new JsonArray())) {
                                    JsonObject p = (JsonObject) v;
                                    if (Set.of("Director", "Creator").contains(p.getString("job"))
                                        && p.getString("name") != null
                                        && !creators.contains(p.getString("name"))
                                        && creators.size() < 4) creators.add(p.getString("name"));
                                  }
                                  Object runtime = d.getValue("runtime");
                                  if (runtime == null
                                      && !d.getJsonArray("episode_run_time", new JsonArray())
                                          .isEmpty())
                                    runtime = d.getJsonArray("episode_run_time").getValue(0);
                                  JsonObject value =
                                      new JsonObject()
                                          .put("itemId", itemId)
                                          .put("tmdbId", tmdbId)
                                          .put(
                                              "imdbId",
                                              d.getJsonObject("external_ids", new JsonObject())
                                                  .getString("imdb_id", item.getString("imdbId")))
                                          .put(
                                              "title",
                                              d.getString(
                                                  "title",
                                                  d.getString("name", item.getString("title"))))
                                          .put("mediaType", item.getString("mediaType"))
                                          .put("tagline", d.getString("tagline", ""))
                                          .put(
                                              "overview",
                                              d.getString(
                                                  "overview", item.getString("overview", "")))
                                          .put(
                                              "posterUrl",
                                              d.getString("poster_path") != null
                                                  ? image(d.getString("poster_path"))
                                                  : item.getValue("posterUrl"))
                                          .put(
                                              "backdropUrl",
                                              d.getString("backdrop_path") != null
                                                  ? image(d.getString("backdrop_path"))
                                                  : item.getValue("backdropUrl"))
                                          .put(
                                              "releaseDate",
                                              d.getString(
                                                  "release_date",
                                                  d.getString(
                                                      "first_air_date",
                                                      item.getString("releaseDate"))))
                                          .put(
                                              "genres",
                                              d.getJsonArray("genres", new JsonArray()).stream()
                                                  .filter(JsonObject.class::isInstance)
                                                  .map(JsonObject.class::cast)
                                                  .map(x -> x.getString("name"))
                                                  .toList())
                                          .put(
                                              "rating",
                                              round(number(d.getValue("vote_average"), 0), 1))
                                          .put("voteCount", d.getInteger("vote_count", 0))
                                          .put("runtimeMinutes", runtime)
                                          .put("status", d.getValue("status"))
                                          .put("certification", certification(d, type))
                                          .put("numberOfSeasons", d.getValue("number_of_seasons"))
                                          .put("creators", creators)
                                          .put("cast", cast)
                                          .put("parentsGuide", new JsonObject())
                                          .put(
                                              "parentsGuideSource",
                                              "IMDb community parental guide");
                                  mongo.updateRecord(
                                      new JsonObject().put("itemId", itemId),
                                      new JsonObject()
                                          .put(
                                              "$set",
                                              new JsonObject()
                                                  .put("tmdbId", tmdbId)
                                                  .put(
                                                      "detailCache",
                                                      new JsonObject()
                                                          .put("fetchedAt", now())
                                                          .put("value", value))),
                                      ITEMS);
                                  ok(
                                      c,
                                      Utility.createSuccessResponse(
                                          value
                                              .copy()
                                              .put(
                                                  "cache",
                                                  new JsonObject()
                                                      .put("hit", false)
                                                      .put("layer", "upstream")
                                                      .put("ttlHours", 24))));
                                })
                            .onFailure(e -> fail(c, 503, e.getMessage()));
                      });
            });
  }

  public void requestTitle(RoutingContext c) {
    String id = value(c.body().asJsonObject(), "itemId");
    hasAccess(c)
        .onSuccess(
            access -> {
              if (!access) {
                fail(
                    c,
                    403,
                    "Connect your MovieHub account before requesting titles from BuzzWatch");
                return;
              }
              mongo
                  .queryRecords(new JsonObject().put("itemId", id), ITEMS)
                  .onSuccess(
                      rows -> {
                        if (rows.isEmpty()) {
                          fail(c, 400, "BuzzWatch title was not found");
                          return;
                        }
                        JsonObject item = rows.getFirst();
                        String title = item.getString("title", "").trim();
                        if (title.isEmpty()) {
                          fail(c, 400, "BuzzWatch title is missing a title");
                          return;
                        }
                        LookUpDTO dto = new LookUpDTO();
                        dto.setTitle(title);
                        dto.setMediaType(
                            "movie".equals(item.getString("mediaType"))
                                ? MediaType.MOVIES
                                : MediaType.SHOWS);
                        dto.setTmdbId(item.getInteger("tmdbId"));
                        dto.setImdbId(item.getString("imdbId"));
                        dto.setQuality("any");
                        if (dto.getMediaType() == MediaType.SHOWS)
                          dto.setSeason(
                              List.of(Math.max(1, item.getInteger("latestSeasonNumber", 1))));
                        boolean admin = "ADMIN".equalsIgnoreCase(Objects.toString(c.get("role")));
                        Future<JsonObject> created =
                            admin
                                ? movieHub.createApprovedRequestFromAutomation(
                                    Objects.toString(c.get("userId")), dto)
                                : movieHub.createRequestFromAutomation(
                                    Objects.toString(c.get("userId")), dto);
                        created
                            .onSuccess(
                                record ->
                                    ok(
                                        c,
                                        Utility.createSuccessResponse(
                                            new JsonObject()
                                                .put(
                                                    "message",
                                                    admin
                                                        ? "Request approved and queued for download"
                                                        : "Request submitted for approval")
                                                .put("requestId", record.getValue("requestId"))
                                                .put("status", record.getValue("status"))
                                                .put("title", record.getValue("title"))
                                                .put("mediaType", record.getValue("mediaType"))
                                                .put(
                                                    "season",
                                                    record.getJsonArray("season", new JsonArray()))
                                                .put("autoApproved", admin)
                                                .put(
                                                    "notification",
                                                    record.getValue("notification")))))
                            .onFailure(e -> fail(c, 409, e.getMessage()));
                      });
            });
  }

  public void refresh(RoutingContext c) {
    refreshCatalog()
        .onSuccess(r -> ok(c, Utility.createSuccessResponse(r)))
        .onFailure(e -> fail(c, 503, e.getMessage()));
  }

  public void refreshFromSettings(RoutingContext c) {
    refreshCatalog()
        .onSuccess(
            r ->
                ok(
                    c,
                    Utility.createSuccessResponse(
                        new JsonObject().put("message", "BuzzWatch catalog refreshed").mergeIn(r))))
        .onFailure(e -> fail(c, 503, e.getMessage()));
  }

  public Future<JsonObject> refreshCatalog() {
    if (!configured()) return Future.failedFuture("TMDB is not configured");
    String start = LocalDate.now(ZoneOffset.UTC).minusDays(windowDays()).toString(),
        end = LocalDate.now(ZoneOffset.UTC).plusDays(7).toString();
    Future<JsonObject>
        movies =
            tmdb(
                "/discover/movie",
                Map.of(
                    "primary_release_date.gte",
                    start,
                    "primary_release_date.lte",
                    end,
                    "sort_by",
                    "popularity.desc",
                    "include_adult",
                    "false",
                    "watch_region",
                    region())),
        shows =
            tmdb(
                "/discover/tv",
                Map.of(
                    "first_air_date.gte",
                    start,
                    "first_air_date.lte",
                    end,
                    "sort_by",
                    "popularity.desc",
                    "watch_region",
                    region()));
    return Future.all(movies, shows)
        .compose(
            all -> {
              List<JsonObject> normalized = new ArrayList<>();
              for (Object v :
                  ((JsonObject) all.resultAt(0)).getJsonArray("results", new JsonArray()))
                normalized.add(normalizeTmdb((JsonObject) v, "movie", "TMDB latest streaming"));
              for (Object v :
                  ((JsonObject) all.resultAt(1)).getJsonArray("results", new JsonArray()))
                normalized.add(normalizeTmdb((JsonObject) v, "series", "TMDB latest streaming"));
              List<Future<?>> writes = new ArrayList<>();
              for (JsonObject row : normalized)
                writes.add(
                    mongo
                        .getMongoClient()
                        .replaceDocumentsWithOptions(
                            ITEMS,
                            new JsonObject().put("itemId", row.getString("itemId")),
                            row,
                            new UpdateOptions().setUpsert(true)));
              String now = now();
              JsonObject meta =
                  new JsonObject()
                      .put("key", "buzzwatch-refresh")
                      .put("lastUpdatedAt", now)
                      .put("updated", normalized.size())
                      .put(
                          "movieCount",
                          normalized.stream()
                              .filter(x -> "movie".equals(x.getString("mediaType")))
                              .count())
                      .put(
                          "seriesCount",
                          normalized.stream()
                              .filter(x -> "series".equals(x.getString("mediaType")))
                              .count())
                      .put("ratingProvider", "TMDB")
                      .put("windowDays", windowDays())
                      .put("windowStart", start)
                      .put("windowEnd", end)
                      .put("watchRegion", region());
              writes.add(
                  mongo
                      .getMongoClient()
                      .replaceDocumentsWithOptions(
                          META,
                          new JsonObject().put("key", "buzzwatch-refresh"),
                          meta,
                          new UpdateOptions().setUpsert(true)));
              return Future.all((List) writes)
                  .map(
                      new JsonObject()
                          .put("updated", normalized.size())
                          .put("movieCount", meta.getValue("movieCount"))
                          .put("seriesCount", meta.getValue("seriesCount"))
                          .put("lastUpdatedAt", now));
            });
  }

  public Future<JsonObject> warmYearCache() {
    int current = Year.now(ZoneOffset.UTC).getValue(),
        count = Math.max(1, intEnv("BUZZWATCH_YEAR_WARM_COUNT", 3));
    List<Future<?>> refreshes = new ArrayList<>();
    for (int i = 0; i < count; i++) refreshes.add(refreshYear(current - i));
    return Future.all(refreshes)
        .map(new JsonObject().put("yearsWarmed", count).put("completedAt", now()));
  }

  private Future<JsonObject> refreshYear(int year) {
    String first = year + "-01-01", last = year + "-12-31";
    Future<JsonObject>
        movies =
            tmdb(
                "/discover/movie",
                Map.of(
                    "primary_release_date.gte",
                    first,
                    "primary_release_date.lte",
                    last,
                    "sort_by",
                    "vote_average.desc",
                    "vote_count.gte",
                    "20",
                    "include_adult",
                    "false")),
        shows =
            tmdb(
                "/discover/tv",
                Map.of(
                    "first_air_date.gte",
                    first,
                    "first_air_date.lte",
                    last,
                    "sort_by",
                    "vote_average.desc",
                    "vote_count.gte",
                    "20"));
    return Future.all(movies, shows)
        .compose(
            all -> {
              List<JsonObject> rows = new ArrayList<>();
              for (Object v :
                  ((JsonObject) all.resultAt(0)).getJsonArray("results", new JsonArray()))
                rows.add(
                    normalizeTmdb((JsonObject) v, "movie", "TMDB year catalog")
                        .put("catalogScope", "year"));
              for (Object v :
                  ((JsonObject) all.resultAt(1)).getJsonArray("results", new JsonArray()))
                rows.add(
                    normalizeTmdb((JsonObject) v, "series", "TMDB year catalog")
                        .put("catalogScope", "year"));
              List<Future<?>> writes = new ArrayList<>();
              for (JsonObject row : rows)
                writes.add(
                    mongo
                        .getMongoClient()
                        .replaceDocumentsWithOptions(
                            ITEMS,
                            new JsonObject().put("itemId", row.getString("itemId")),
                            row,
                            new UpdateOptions().setUpsert(true)));
              JsonObject meta =
                  new JsonObject()
                      .put("key", "buzzwatch-year-" + year)
                      .put("year", year)
                      .put("lastUpdatedAt", now())
                      .put("updated", rows.size())
                      .put("ratingProvider", "TMDB");
              writes.add(
                  mongo
                      .getMongoClient()
                      .replaceDocumentsWithOptions(
                          META,
                          new JsonObject().put("key", meta.getString("key")),
                          meta,
                          new UpdateOptions().setUpsert(true)));
              return Future.all((List) writes).map(meta);
            });
  }

  private JsonObject normalizeTmdb(JsonObject x, String type, String source) {
    String date = x.getString("release_date", x.getString("first_air_date")),
        title = x.getString("title", x.getString("name", "Untitled"));
    List<JsonObject> maps =
        genres.stream().filter(JsonObject.class::isInstance).map(JsonObject.class::cast).toList();
    JsonArray names = new JsonArray(), keys = new JsonArray();
    for (Object id : x.getJsonArray("genre_ids", new JsonArray()))
      for (JsonObject g : maps)
        if (g.getJsonArray(type.equals("movie") ? "movieIds" : "tvIds", new JsonArray())
            .contains(id)) {
          if (!names.contains(g.getString("name"))) names.add(g.getString("name"));
          if (!keys.contains(g.getString("key"))) keys.add(g.getString("key"));
        }
    double rating = number(x.getValue("vote_average"), 0),
        pop = number(x.getValue("popularity"), 0);
    long votes = x.getLong("vote_count", 0L);
    double buzz =
        Math.min(100, rating * 8 + Math.log10(Math.max(1, votes)) * 10 + Math.log1p(pop) * 3);
    return new JsonObject()
        .put("itemId", "tmdb:" + type + ":" + x.getValue("id"))
        .put("tmdbId", x.getValue("id"))
        .put("title", title)
        .put("mediaType", type)
        .put("overview", x.getString("overview", ""))
        .put("posterUrl", image(x.getString("poster_path")))
        .put("backdropUrl", image(x.getString("backdrop_path")))
        .put("releaseDate", date)
        .put(
            "releasePeriod",
            date == null ? "unknown" : date.substring(0, Math.min(7, date.length())))
        .put("year", date == null ? null : date.substring(0, Math.min(4, date.length())))
        .put("genres", names)
        .put("genreKeys", keys)
        .put("tmdbRating", round(rating, 1))
        .put("tmdbVoteCount", votes)
        .put("popularity", pop)
        .put("buzzScore", round(buzz, 2))
        .put("source", source)
        .put("sourceVersion", 1)
        .put("catalogScope", "latest-streaming")
        .put(
            "externalUrl",
            "https://www.themoviedb.org/"
                + (type.equals("movie") ? "movie" : "tv")
                + "/"
                + x.getValue("id"))
        .put("updatedAt", now());
  }

  private Future<Integer> resolveTmdbId(JsonObject item) {
    if (item.getValue("tmdbId") instanceof Number n) return Future.succeededFuture(n.intValue());
    String type = "movie".equals(item.getString("mediaType")) ? "movie" : "tv";
    return tmdb(
            "/search/" + type,
            Map.of("query", item.getString("title", ""), "include_adult", "false"))
        .map(
            body -> {
              JsonArray r = body.getJsonArray("results", new JsonArray());
              return r.isEmpty() ? null : r.getJsonObject(0).getInteger("id");
            });
  }

  private Future<Boolean> hasAccess(RoutingContext c) {
    if ("ADMIN".equalsIgnoreCase(Objects.toString(c.get("role"))))
      return Future.succeededFuture(true);
    String email = Objects.toString(c.get("userEmail"), "");
    return mongo
        .queryRecords(new JsonObject().put("userEmail", email).put("active", true), ACCESS)
        .map(rows -> !rows.isEmpty());
  }

  private Future<JsonObject> preferenceFor(String uid) {
    return mongo
        .queryRecords(new JsonObject().put("userId", uid), PREFS)
        .map(
            rows ->
                rows.isEmpty()
                    ? new JsonObject()
                        .put("exists", false)
                        .put("genreKeys", new JsonArray())
                        .put("genres", genres)
                    : new JsonObject()
                        .put("exists", true)
                        .put(
                            "genreKeys", rows.getFirst().getJsonArray("genreKeys", new JsonArray()))
                        .put("genres", genres)
                        .put("createdAt", rows.getFirst().getValue("createdAt"))
                        .put("updatedAt", rows.getFirst().getValue("updatedAt")));
  }

  private boolean matches(JsonObject item, List<String> selected) {
    if (selected.isEmpty()) return true;
    JsonArray keys = item.getJsonArray("genreKeys", new JsonArray());
    return selected.stream().anyMatch(keys::contains);
  }

  private JsonObject withMatch(JsonObject item, List<String> selected) {
    JsonObject x = item.copy();
    JsonArray matched =
        new JsonArray(
            selected.stream()
                .filter(item.getJsonArray("genreKeys", new JsonArray())::contains)
                .sorted()
                .toList());
    double genreScore =
        selected.isEmpty()
            ? 55
            : item.getJsonArray("genreKeys", new JsonArray()).isEmpty()
                ? 18
                : Math.min(
                    72,
                    Math.round(
                        matched.size()
                            * 72.0
                            / Math.max(
                                1,
                                Math.min(selected.size(), item.getJsonArray("genreKeys").size()))));
    double rating =
        item.getValue("rtScore") != null
            ? number(item.getValue("rtScore"), 0)
            : item.getValue("tmdbRating") != null
                ? number(item.getValue("tmdbRating"), 0) * 10
                : number(item.getValue("imdbRating"), 0) * 10;
    double score =
        Math.max(
            1,
            Math.min(
                100,
                genreScore
                    + Math.min(18, Math.round(rating / 100 * 18))
                    + Math.min(10, Math.round(number(item.getValue("buzzScore"), 0) / 16))));
    x.put("matchedGenreKeys", matched).put("matchScore", score);
    if ("latest-streaming".equals(item.getString("catalogScope"))) {
      double rec =
          Math.round(Math.min(100, number(item.getValue("buzzScore"), 0)) * .72 + score * .28);
      x.put("recommendationScore", rec)
          .put(
              "recommendationLabel",
              rec >= 85
                  ? "Must watch"
                  : rec >= 72 ? "Strong pick" : rec >= 58 ? "Worth a look" : "Niche pick");
    }
    return x;
  }

  private JsonObject insights(List<JsonObject> items, JsonObject meta) {
    return new JsonObject()
        .put("windowDays", meta.getInteger("windowDays", windowDays()))
        .put("windowStart", meta.getValue("windowStart"))
        .put("windowEnd", meta.getValue("windowEnd"))
        .put("watchRegion", meta.getString("watchRegion", region()))
        .put("totalTitles", items.size())
        .put(
            "movieCount",
            items.stream().filter(x -> "movie".equals(x.getString("mediaType"))).count())
        .put(
            "seriesCount",
            items.stream().filter(x -> "series".equals(x.getString("mediaType"))).count())
        .put(
            "averageBuzz",
            Math.round(
                items.stream()
                    .mapToDouble(x -> number(x.getValue("buzzScore"), 0))
                    .average()
                    .orElse(0)))
        .put(
            "highConfidenceTitles",
            items.stream().filter(x -> "high".equals(x.getString("buzzConfidence"))).count())
        .put("providerCounts", new JsonArray())
        .put("topGenres", new JsonArray())
        .put(
            "methodology",
            "Buzz combines Bayesian viewer quality, rating confidence, popularity momentum, freshness, and streaming availability. Scores are capped at 100.")
        .put("availabilitySource", "JustWatch via TMDB");
  }

  private Future<JsonObject> tmdb(String path, Map<String, String> params) {
    if (!configured()) return Future.failedFuture("TMDB is not configured");
    var req = web.getAbs(TMDB + path).timeout(30_000).putHeader("Accept", "application/json");
    String bearer = env.get("TMDB_BEARER_TOKEN", "").trim();
    if (!bearer.isEmpty()) req.putHeader("Authorization", "Bearer " + bearer);
    else req.addQueryParam("api_key", env.get("TMDB_API_KEY", ""));
    for (var e : params.entrySet()) req.addQueryParam(e.getKey(), e.getValue());
    return req.send()
        .compose(
            r ->
                r.statusCode() >= 200 && r.statusCode() < 300
                    ? Future.succeededFuture(r.bodyAsJsonObject())
                    : Future.failedFuture("TMDB request failed with status " + r.statusCode()));
  }

  private String certification(JsonObject d, String type) {
    JsonArray rows =
        d.getJsonObject(
                type.equals("movie") ? "release_dates" : "content_ratings", new JsonObject())
            .getJsonArray("results", new JsonArray());
    for (Object v : rows) {
      JsonObject country = (JsonObject) v;
      if (type.equals("movie"))
        for (Object x : country.getJsonArray("release_dates", new JsonArray())) {
          String cert = ((JsonObject) x).getString("certification", "");
          if (!cert.isBlank()) return cert;
        }
      else {
        String cert = country.getString("rating", "");
        if (!cert.isBlank()) return cert;
      }
    }
    return null;
  }

  private JsonArray years() {
    JsonArray out = new JsonArray();
    for (int y = Year.now(ZoneOffset.UTC).getValue();
        y >= intEnv("BUZZWATCH_YEAR_START", 1980);
        y--)
      out.add(
          new JsonObject()
              .put("value", Integer.toString(y))
              .put("label", Integer.toString(y))
              .put("count", 0));
    return out;
  }

  private JsonArray genresList() {
    return new JsonArray(
        List.of(
            g("action", "Action", List.of(28), List.of(10759)),
            g("adventure", "Adventure", List.of(12), List.of(10759)),
            g("animation", "Animation", List.of(16), List.of(16)),
            g("comedy", "Comedy", List.of(35), List.of(35)),
            g("crime", "Crime", List.of(80), List.of(80)),
            g("documentary", "Documentary", List.of(99), List.of(99)),
            g("drama", "Drama", List.of(18), List.of(18)),
            g("family", "Family", List.of(10751), List.of(10751)),
            g("fantasy", "Fantasy", List.of(14), List.of(10765)),
            g("history", "History", List.of(36), List.of()),
            g("horror", "Horror", List.of(27), List.of()),
            g("music", "Music", List.of(10402), List.of()),
            g("mystery", "Mystery", List.of(9648), List.of(9648)),
            g("romance", "Romance", List.of(10749), List.of()),
            g("sci-fi", "Sci-Fi", List.of(878), List.of(10765)),
            g("thriller", "Thriller", List.of(53), List.of()),
            g("war", "War", List.of(10752), List.of(10768)),
            g("western", "Western", List.of(37), List.of(37)),
            g("kids", "Kids", List.of(), List.of(10762)),
            g("reality", "Reality", List.of(), List.of(10764)),
            g("talk", "Talk", List.of(), List.of(10767)),
            g("steamy", "Steamy", List.of(), List.of())));
  }

  private JsonObject g(String k, String n, List<Integer> m, List<Integer> t) {
    return new JsonObject()
        .put("key", k)
        .put("name", n)
        .put("movieIds", new JsonArray(m))
        .put("tvIds", new JsonArray(t));
  }

  private boolean configured() {
    return !env.get("TMDB_API_KEY", "").trim().isEmpty()
        || !env.get("TMDB_BEARER_TOKEN", "").trim().isEmpty();
  }

  private int windowDays() {
    return intEnv("BUZZWATCH_LATEST_WINDOW_DAYS", 30);
  }

  private String region() {
    String r = env.get("BUZZWATCH_WATCH_REGION", "IN").trim().toUpperCase(Locale.ROOT);
    return r.isEmpty() ? "IN" : r;
  }

  private int intEnv(String k, int f) {
    try {
      return Integer.parseInt(env.get(k, Integer.toString(f)));
    } catch (Exception e) {
      return f;
    }
  }

  private int intRange(String v, int f, int min, int max) {
    try {
      return Math.max(min, Math.min(max, Integer.parseInt(v)));
    } catch (Exception e) {
      return f;
    }
  }

  private double number(Object v, double f) {
    try {
      return Double.parseDouble(Objects.toString(v));
    } catch (Exception e) {
      return f;
    }
  }

  private double round(double v, int n) {
    double p = Math.pow(10, n);
    return Math.round(v * p) / p;
  }

  private String image(String p) {
    return p == null || p.isBlank() ? null : IMAGE + p;
  }

  private String value(JsonObject b, String k) {
    return Objects.toString(b == null ? null : b.getValue(k), "").trim();
  }

  private String now() {
    return Instant.now().toString();
  }

  private void ok(RoutingContext c, Object b) {
    c.response()
        .putHeader("Content-Type", "application/json")
        .end(io.vertx.core.json.Json.encode(b));
  }

  private void fail(RoutingContext c, int s, String m) {
    Utility.buildResponse(c, s, Utility.createErrorResponse(m));
  }
}
