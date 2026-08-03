package com.toolhub.services.products;

import com.toolhub.Utils.Utility;
import com.toolhub.services.redis.RedisCache;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

public class ProductSearchService {
  private static final Set<String> PLATFORMS =
      Set.of(
          "amazon",
          "flipkart",
          "myntra",
          "nykaa",
          "ajio",
          "tatacliq",
          "croma",
          "meesho",
          "shopsy",
          "snapdeal",
          "firstcry",
          "bigbasket",
          "reliancedigital",
          "vijaysales",
          "jiomart");
  private final WebClient client;
  private final Dotenv env;
  private final RedisCache cache;

  public ProductSearchService(WebClient client, Vertx vertx, Dotenv env) {
    this.client = client;
    this.env = env;
    this.cache = new RedisCache(vertx);
  }

  public void search(RoutingContext ctx) {
    String query = Objects.toString(ctx.request().getParam("query"), "").trim();
    String platform =
        Objects.toString(ctx.request().getParam("platform"), "").trim().toLowerCase(Locale.ROOT);
    if (query.isBlank()) {
      Utility.buildResponse(ctx, 400, Utility.createErrorResponse("query is required"));
      return;
    }
    if (!PLATFORMS.contains(platform)) {
      Utility.buildResponse(
          ctx,
          400,
          Utility.createErrorResponse(
              "platform must be one of: "
                  + String.join(", ", PLATFORMS.stream().sorted().toList())));
      return;
    }
    String cacheKey =
        "toolhub:v1:product-search:"
            + platform
            + ":"
            + RedisCache.token(query.toLowerCase(Locale.ROOT));
    cache
        .get(cacheKey)
        .onSuccess(
            cached -> {
              if (cached != null) {
                Utility.buildResponse(ctx, 200, cached);
                return;
              }
              client
                  .getAbs(searchUrl())
                  .timeout(45_000)
                  .addQueryParam("query", query)
                  .addQueryParam("platform", platform)
                  .send()
                  .onSuccess(
                      res -> {
                        JsonObject body;
                        try {
                          body = res.bodyAsJsonObject();
                        } catch (Exception e) {
                          body =
                              new JsonObject().put("error", "Product search returned invalid JSON");
                        }
                        if (res.statusCode() >= 200 && res.statusCode() < 300)
                          cache.set(cacheKey, body, intEnv("PRODUCT_SEARCH_CACHE_SECONDS", 300));
                        ctx.response()
                            .setStatusCode(res.statusCode())
                            .putHeader("Content-Type", "application/json")
                            .end(body.encode());
                      })
                  .onFailure(
                      e ->
                          Utility.buildResponse(
                              ctx, 502, Utility.createErrorResponse(e.getMessage())));
            });
  }

  private String searchUrl() {
    String configured = env.get("SCRAPPER_SEARCH_URL", "").trim();
    if (!configured.isBlank()) return configured;
    String scraper = env.get("SCRAPPER_URL", "").trim();
    if (scraper.endsWith("/scrape/product"))
      return scraper.substring(0, scraper.length() - "/scrape/product".length()) + "/v2/search";
    if (!scraper.isBlank()) return scraper.replaceAll("/+$", "") + "/v2/search";
    return "http://scraper-beautifulsoup:8001/v2/search";
  }

  private int intEnv(String key, int fallback) {
    try {
      return Integer.parseInt(env.get(key, Integer.toString(fallback)));
    } catch (Exception ignored) {
      return fallback;
    }
  }
}
