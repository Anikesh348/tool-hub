package com.toolhub.Utils;

import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

public class UrlRedirectUtil {
    private static final Logger log = LoggerFactory.getLogger(UrlRedirectUtil.class);

    public static Future<String> finalUrl(Vertx vertx, String inputUrl) {
        Promise<String> promise = Promise.promise();
        vertx.executeBlocking(() -> resolveUrl(inputUrl))
                .onSuccess(res -> promise.complete(res.result()))
                .onFailure(fail -> promise.fail(fail.getMessage()));
        return promise.future();
    }

    public static Future<String> resolveUrl(String url) {
        Promise<String> promise = Promise.promise();
        OkHttpClient client = new OkHttpClient.Builder()
                .followRedirects(true)
                .build();

        Request request = new Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0")
                .build();

        try (Response response = client.newCall(request).execute()) {
            String actualUrl = response.request().url().toString();
            promise.complete(actualUrl);
        } catch (Exception e) {
           log.error("error in getting final url {}", e.getMessage());
           promise.fail(e.getMessage());
        }
        return promise.future();
    }

    public static String resolveFinalUrl(String inputUrl) throws IOException {
        long totalStart = System.currentTimeMillis();

        log.info("[RedirectResolver] Starting resolution for: {}", inputUrl);

        HttpURLConnection conn = (HttpURLConnection) new URL(inputUrl).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("User-Agent", "Mozilla/5.0");

        String location = conn.getHeaderField("Location");
        int status = conn.getResponseCode();

        int redirectCount = 0;
        long lastRedirectTime = System.currentTimeMillis();

        while (isRedirect(status)) {
            redirectCount++;
            long now = System.currentTimeMillis();
            log.info("[RedirectResolver] Redirect {} took {} ms", redirectCount, (now - lastRedirectTime));
            lastRedirectTime = now;

            if (location == null) {
                log.info("[RedirectResolver] Location header is null. Breaking.");
                break;
            }

            log.info("[RedirectResolver] Following redirect to: {}", location);
            conn = (HttpURLConnection) new URL(location).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0");
            location = conn.getHeaderField("Location");
            status = conn.getResponseCode();
        }

        long totalTime = System.currentTimeMillis() - totalStart;
        log.info("[RedirectResolver] Final URL: {}", conn.getURL().toString());
        log.info("[RedirectResolver] Total time taken: {} ms", totalTime);

        return conn.getURL().toString();
    }

    private static boolean isRedirect(int status) {
        return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
    }
}