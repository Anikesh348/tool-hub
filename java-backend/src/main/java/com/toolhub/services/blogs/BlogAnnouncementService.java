package com.toolhub.services.blogs;

import com.toolhub.services.alerts.MailService;
import com.toolhub.services.mongo.MongoDBClient;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Idempotent notification and per-recipient email fan-out for a published blog version. */
final class BlogAnnouncementService {
  private static final Logger log = LoggerFactory.getLogger(BlogAnnouncementService.class);
  private static final String ANNOUNCEMENTS = "blogpublicationannouncements";
  private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
  private final MongoDBClient mongo;
  private final MailService mail;
  private final Dotenv env;

  BlogAnnouncementService(MongoDBClient mongo, WebClient web, Dotenv env) {
    this.mongo = mongo;
    this.mail = new MailService(web);
    this.env = env;
  }

  Future<Void> announce(JsonObject post, String versionId, String publishedBy) {
    String slug = post.getString("slug", "").trim(),
        title = post.getString("title", "New ToolHub article").trim();
    if (slug.isBlank() || versionId == null || versionId.isBlank())
      return Future.failedFuture("publication identity is incomplete");
    String key = slug + ":" + versionId, timestamp = Instant.now().toString();
    JsonObject row =
        new JsonObject()
            .put("publishKey", key)
            .put("slug", slug)
            .put("versionId", versionId)
            .put("title", title)
            .put("status", "PROCESSING")
            .put("notificationId", (String) null)
            .put("recipientCount", 0)
            .put("emailSentCount", 0)
            .put("emailFailureCount", 0)
            .put("publishedBy", publishedBy)
            .put("createdAt", timestamp)
            .put("updatedAt", timestamp);
    return mongo
        .insertRecord(row, ANNOUNCEMENTS)
        .compose(ignored -> deliver(post, key, publishedBy))
        .recover(
            error -> {
              if (String.valueOf(error.getMessage()).contains("E11000")) {
                log.info("Blog publication announcement already delivered for {}", key);
                return Future.succeededFuture();
              }
              return Future.failedFuture(error);
            });
  }

  private Future<Void> deliver(JsonObject post, String key, String publishedBy) {
    String slug = post.getString("slug"), title = post.getString("title", "New ToolHub article");
    String notificationId = UUID.randomUUID().toString().replace("-", "");
    JsonObject notification =
        new JsonObject()
            .put("notificationId", notificationId)
            .put("audience", "USER")
            .put("title", "New blog published")
            .put("message", title + " is now available on ToolHub.")
            .put("severity", "INFO")
            .put("category", "blog")
            .put("source", "blog")
            .put("actionUrl", "/blogs/" + slug)
            .put(
                "metadata",
                new JsonObject()
                    .put("slug", slug)
                    .put("versionId", post.getString("publishedVersionId")))
            .put("createdBy", publishedBy)
            .put("createdAt", Instant.now().toString());
    return mongo
        .insertRecord(notification, "notifications")
        .compose(
            ignored ->
                mongo.queryRecords(
                    new JsonObject()
                        .put("email", new JsonObject().put("$type", "string").put("$ne", "")),
                    "users"))
        .compose(
            users -> {
              List<String> recipients =
                  users.stream()
                      .map(user -> user.getString("email", "").trim().toLowerCase())
                      .filter(EMAIL.asMatchPredicate())
                      .distinct()
                      .sorted()
                      .toList();
              List<Future<?>> deliveries = new ArrayList<>();
              for (String recipient : recipients)
                deliveries.add(
                    mail.sendEmail("New on ToolHub: " + title, recipient, html(post))
                        .map(true)
                        .recover(error -> Future.succeededFuture(false)));
              return Future.all(deliveries)
                  .compose(
                      all -> {
                        int sent = 0;
                        for (int i = 0; i < deliveries.size(); i++)
                          if (Boolean.TRUE.equals(all.resultAt(i))) sent++;
                        int failures = recipients.size() - sent;
                        JsonObject status =
                            new JsonObject()
                                .put("status", failures == 0 ? "COMPLETED" : "PARTIAL")
                                .put("notificationId", notificationId)
                                .put("recipientCount", recipients.size())
                                .put("emailSentCount", sent)
                                .put("emailFailureCount", failures)
                                .put("notificationCreated", true)
                                .put("updatedAt", Instant.now().toString())
                                .put("completedAt", Instant.now().toString());
                        return mongo.updateRecord(
                            new JsonObject().put("publishKey", key),
                            new JsonObject().put("$set", status),
                            ANNOUNCEMENTS);
                      });
            });
  }

  private String html(JsonObject post) {
    String base =
        env.get("TOOLHUB_PUBLIC_URL", "https://hostingfrompurva.xyz").replaceAll("/+$", "");
    String url = base + "/blogs/" + post.getString("slug");
    return "<div style=\"font-family:Arial,sans-serif\"><p>New on ToolHub</p><h1>"
        + escape(post.getString("title", "New ToolHub article"))
        + "</h1><p>By "
        + escape(post.getString("author", "ToolHub"))
        + "</p><p>"
        + escape(post.getString("excerpt", "A new article is now available on ToolHub."))
        + "</p><p><a href=\""
        + escape(url)
        + "\">Read the article</a></p></div>";
  }

  private String escape(String value) {
    return value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;");
  }
}
