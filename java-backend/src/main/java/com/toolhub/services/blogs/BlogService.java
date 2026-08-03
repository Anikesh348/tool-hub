package com.toolhub.services.blogs;

import com.toolhub.Utils.Utility;
import com.toolhub.services.mongo.MongoDBClient;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.buffer.Buffer;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.mongo.UpdateOptions;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.regex.*;

public class BlogService {
  private static final String POSTS = "blogposts",
      EVENTS = "blogevents",
      REACTIONS = "blogreactions",
      COMMENTS = "blogcomments",
      TERMS = "blogtermsummaries",
      VERSIONS = "blogversions",
      ASSETS = "blogassets";
  private static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$"),
      TERM = Pattern.compile("\\[([^]\\n]{1,120})]\\(#term:([a-z0-9][a-z0-9-]{0,79})\\)");
  private static final Set<String> STATUSES = Set.of("DRAFT", "PUBLISHED"),
      EVENT_TYPES = Set.of("view", "engagement", "complete", "like", "unlike", "share");
  private final MongoDBClient mongo;
  private final Dotenv env;
  private final BlogAnnouncementService announcements;

  public BlogService(MongoDBClient mongo, WebClient web, Dotenv env) {
    this.mongo = mongo;
    this.env = env;
    this.announcements = new BlogAnnouncementService(mongo, web, env);
  }

  public void seed() {
    try {
      String content = resource("seed/raspberry-pi-5-personal-cloud.md"),
          slug = "raspberry-pi-5-personal-cloud",
          now = now();
      mongo
          .queryRecords(new JsonObject().put("slug", slug), POSTS)
          .onSuccess(
              rows -> {
                JsonObject post;
                if (rows.isEmpty()) {
                  post =
                      new JsonObject()
                          .put("slug", slug)
                          .put(
                              "title",
                              "I Gave a Raspberry Pi 5 a 1 TB SSD. It Became My Personal Cloud")
                          .put("series", "One Pi, One SSD, 48 Containers")
                          .put("seriesPart", 1)
                          .put(
                              "excerpt",
                              "One YouTube video, a Raspberry Pi 5 and a 1 TB SSD turned a shared-folder experiment into 48 containers—and an AI agent that can build tools on demand.")
                          .put("content", content)
                          .put(
                              "coverImage",
                              "/blogs/raspberry-pi-5-personal-cloud/pi5-home-homelab-cover.png")
                          .put(
                              "tags",
                              new JsonArray(
                                  List.of("Homelab", "Raspberry Pi", "Self-hosting", "Docker")))
                          .put("author", "Anikesh Thakur")
                          .put("authorEmail", "")
                          .put("status", "PUBLISHED")
                          .put("viewCount", 0)
                          .put("likeCount", 0)
                          .put("shareCount", 0)
                          .put("createdAt", now)
                          .put("updatedAt", now)
                          .put("publishedAt", now);
                  mongo.insertRecord(post, POSTS);
                } else post = rows.getFirst();
                ensureBaseline(post);
                seedTerms(slug, content);
              });
    } catch (Exception ignored) {
    }
  }

  public void listPublic(RoutingContext c) {
    mongo
        .queryRecords(new JsonObject().put("status", "PUBLISHED"), POSTS)
        .onSuccess(
            rows -> {
              rows.sort(
                  Comparator.comparing((JsonObject r) -> r.getString("publishedAt", ""))
                      .reversed());
              JsonArray items = new JsonArray();
              rows.forEach(x -> items.add(publicPost(x, false)));
              ok(c, Utility.createSuccessResponse(new JsonObject().put("items", items)));
            })
        .onFailure(e -> fail(c, 500, e.getMessage()));
  }

  public void getPublic(RoutingContext c) {
    post(c.pathParam("slug"), true)
        .onSuccess(
            p -> {
              if (p == null) fail(c, 404, "Blog post not found");
              else ok(c, Utility.createSuccessResponse(publicPost(p, true)));
            })
        .onFailure(e -> fail(c, 500, e.getMessage()));
  }

  public void listAdmin(RoutingContext c) {
    mongo
        .queryRecords(new JsonObject(), POSTS)
        .onSuccess(
            rows -> {
              rows.sort(
                  Comparator.comparing((JsonObject r) -> r.getString("updatedAt", "")).reversed());
              JsonArray items = new JsonArray();
              rows.forEach(x -> items.add(publicPost(x, true)));
              ok(c, Utility.createSuccessResponse(new JsonObject().put("items", items)));
            });
  }

  public void createBlog(RoutingContext c) {
    JsonObject doc;
    try {
      doc = normalize(c.body().asJsonObject(), null, Objects.toString(c.get("userEmail"), ""));
    } catch (IllegalArgumentException e) {
      fail(c, 400, e.getMessage());
      return;
    }
    mongo
        .queryRecords(new JsonObject().put("slug", doc.getString("slug")), POSTS)
        .onSuccess(
            rows -> {
              if (!rows.isEmpty()) {
                fail(c, 409, "A blog with this slug already exists");
                return;
              }
              mongo
                  .insertRecord(doc, POSTS)
                  .onSuccess(
                      v -> {
                        ensureBaseline(doc);
                        ok(c, Utility.createSuccessResponse(publicPost(doc, true)));
                      })
                  .onFailure(e -> fail(c, 500, e.getMessage()));
            });
  }

  public void updateBlog(RoutingContext c) {
    mongo
        .queryRecords(new JsonObject().put("slug", c.pathParam("slug")), POSTS)
        .onSuccess(
            rows -> {
              if (rows.isEmpty()) {
                fail(c, 404, "Blog post not found");
                return;
              }
              JsonObject doc;
              try {
                doc =
                    normalize(
                        c.body().asJsonObject(),
                        rows.getFirst(),
                        Objects.toString(c.get("userEmail"), ""));
              } catch (IllegalArgumentException e) {
                fail(c, 400, e.getMessage());
                return;
              }
              mongo
                  .getMongoClient()
                  .replaceDocuments(POSTS, new JsonObject().put("slug", c.pathParam("slug")), doc)
                  .onSuccess(
                      v -> {
                        ensureBaseline(doc);
                        ok(c, Utility.createSuccessResponse(publicPost(doc, true)));
                      })
                  .onFailure(e -> fail(c, 500, e.getMessage()));
            });
  }

  public void termSummary(RoutingContext c) {
    String id = value(c.body().asJsonObject(), "termId").toLowerCase(Locale.ROOT);
    if (!Pattern.matches("[a-z0-9][a-z0-9-]{0,79}", id)) {
      fail(c, 400, "Invalid term");
      return;
    }
    post(c.pathParam("slug"), true)
        .onSuccess(
            p -> {
              if (p == null) {
                fail(c, 404, "Blog post not found");
                return;
              }
              Matcher m = TERM.matcher(p.getString("content", ""));
              String label = null;
              while (m.find())
                if (m.group(2).equals(id)) {
                  label = plain(m.group(1));
                  break;
                }
              if (label == null) {
                fail(c, 404, "Term is not annotated in this article");
                return;
              }
              String finalLabel = label;
              mongo
                  .queryRecords(
                      new JsonObject().put("slug", c.pathParam("slug")).put("termId", id), TERMS)
                  .onSuccess(
                      rows -> {
                        if (rows.isEmpty())
                          fail(c, 404, "Explanation is not available for this term");
                        else
                          ok(
                              c,
                              Utility.createSuccessResponse(
                                  new JsonObject()
                                      .put("termId", id)
                                      .put("term", rows.getFirst().getString("term", finalLabel))
                                      .put("summary", rows.getFirst().getString("summary", ""))
                                      .put("cached", true)));
                      });
            });
  }

  public void event(RoutingContext c) {
    post(c.pathParam("slug"), true)
        .onSuccess(
            p -> {
              if (p == null) {
                fail(c, 404, "Blog post not found");
                return;
              }
              JsonObject b = c.body().asJsonObject();
              String type = valueOr(b, "eventType", "view").toLowerCase(Locale.ROOT);
              if (!EVENT_TYPES.contains(type)) {
                fail(c, 400, "Invalid analytics event");
                return;
              }
              JsonObject event = eventDoc(c, b, type);
              mongo
                  .insertRecord(event, EVENTS)
                  .onSuccess(
                      v -> {
                        if (type.equals("view") || type.equals("share")) {
                          String field = type.equals("view") ? "viewCount" : "shareCount";
                          mongo
                              .getMongoClient()
                              .updateCollection(
                                  POSTS,
                                  new JsonObject().put("slug", c.pathParam("slug")),
                                  new JsonObject().put("$inc", new JsonObject().put(field, 1)))
                              .onSuccess(
                                  x ->
                                      post(c.pathParam("slug"), true)
                                          .onSuccess(
                                              updated ->
                                                  ok(
                                                      c,
                                                      Utility.createSuccessResponse(
                                                          new JsonObject()
                                                              .put("recorded", true)
                                                              .put(
                                                                  "viewCount",
                                                                  updated.getInteger(
                                                                      "viewCount", 0))
                                                              .put(
                                                                  "shareCount",
                                                                  updated.getInteger(
                                                                      "shareCount", 0))))));
                        } else
                          ok(
                              c,
                              Utility.createSuccessResponse(
                                  new JsonObject()
                                      .put("recorded", true)
                                      .put("viewCount", 0)
                                      .put("shareCount", 0)));
                      });
            });
  }

  public void reaction(RoutingContext c) {
    post(c.pathParam("slug"), true)
        .onSuccess(
            p -> {
              if (p == null) {
                fail(c, 404, "Blog post not found");
                return;
              }
              JsonObject b = c.body().asJsonObject();
              String action = valueOr(b, "action", "status").toLowerCase(Locale.ROOT);
              if (!Set.of("status", "like", "unlike").contains(action)) {
                fail(c, 400, "Invalid reaction action");
                return;
              }
              String visitor = visitor(c, value(b, "visitorId"));
              JsonObject q =
                  new JsonObject().put("slug", c.pathParam("slug")).put("visitorHash", visitor);
              mongo
                  .queryRecords(q, REACTIONS)
                  .onSuccess(
                      rows -> {
                        boolean existed = !rows.isEmpty();
                        Future<?> change = Future.succeededFuture();
                        boolean changed = false;
                        if (action.equals("like") && !existed) {
                          changed = true;
                          change =
                              mongo
                                  .insertRecord(q.copy().put("createdAt", now()), REACTIONS)
                                  .compose(
                                      v ->
                                          mongo
                                              .getMongoClient()
                                              .updateCollection(
                                                  POSTS,
                                                  new JsonObject().put("slug", c.pathParam("slug")),
                                                  new JsonObject()
                                                      .put(
                                                          "$inc",
                                                          new JsonObject().put("likeCount", 1))));
                        } else if (action.equals("unlike") && existed) {
                          changed = true;
                          change =
                              mongo
                                  .deleteRecord(q, REACTIONS)
                                  .compose(
                                      v ->
                                          mongo
                                              .getMongoClient()
                                              .updateCollection(
                                                  POSTS,
                                                  new JsonObject()
                                                      .put("slug", c.pathParam("slug"))
                                                      .put(
                                                          "likeCount",
                                                          new JsonObject().put("$gt", 0)),
                                                  new JsonObject()
                                                      .put(
                                                          "$inc",
                                                          new JsonObject().put("likeCount", -1))));
                        }
                        boolean finalChanged = changed;
                        change.onSuccess(
                            v ->
                                post(c.pathParam("slug"), true)
                                    .onSuccess(
                                        updated ->
                                            ok(
                                                c,
                                                Utility.createSuccessResponse(
                                                    new JsonObject()
                                                        .put(
                                                            "liked",
                                                            action.equals("like")
                                                                || (!action.equals("unlike")
                                                                    && existed))
                                                        .put("changed", finalChanged)
                                                        .put(
                                                            "likeCount",
                                                            updated.getInteger("likeCount", 0))
                                                        .put(
                                                            "shareCount",
                                                            updated.getInteger(
                                                                "shareCount", 0))))));
                      });
            });
  }

  public void comments(RoutingContext c) {
    post(c.pathParam("slug"), true)
        .onSuccess(
            p -> {
              if (p == null) {
                fail(c, 404, "Blog post not found");
                return;
              }
              mongo
                  .queryRecords(new JsonObject().put("slug", c.pathParam("slug")), COMMENTS)
                  .onSuccess(
                      rows -> {
                        rows.sort(Comparator.comparing(r -> r.getString("createdAt", "")));
                        JsonArray items = new JsonArray();
                        rows.forEach(x -> items.add(publicComment(x, c)));
                        ok(c, Utility.createSuccessResponse(new JsonObject().put("items", items)));
                      });
            });
  }

  public void createComment(RoutingContext c) {
    String content = value(c.body().asJsonObject(), "content");
    if (content.isEmpty()) {
      fail(c, 400, "Comment cannot be empty");
      return;
    }
    if (content.length() > 1200) {
      fail(c, 400, "Comments are limited to 1,200 characters");
      return;
    }
    post(c.pathParam("slug"), true)
        .onSuccess(
            p -> {
              if (p == null) {
                fail(c, 404, "Blog post not found");
                return;
              }
              mongo
                  .queryRecords(new JsonObject().put("userId", c.get("userId")), "users")
                  .onSuccess(
                      users -> {
                        JsonObject user = users.isEmpty() ? new JsonObject() : users.getFirst();
                        String email =
                            user.getString("email", Objects.toString(c.get("userEmail"), ""));
                        String name =
                            user.getString(
                                "name",
                                user.getString(
                                    "userName",
                                    email.contains("@")
                                        ? email.substring(0, email.indexOf('@'))
                                        : "ToolHub reader"));
                        JsonObject row =
                            new JsonObject()
                                .put("commentId", UUID.randomUUID().toString())
                                .put("slug", c.pathParam("slug"))
                                .put("content", content)
                                .put("userId", c.get("userId"))
                                .put("authorName", clip(name, 100))
                                .put(
                                    "authorProfilePicture",
                                    clip(user.getString("profilePicture", ""), 1000))
                                .put("createdAt", now());
                        mongo
                            .insertRecord(row, COMMENTS)
                            .onSuccess(
                                v -> ok(c, Utility.createSuccessResponse(publicComment(row, c))));
                      });
            });
  }

  public void deleteComment(RoutingContext c) {
    JsonObject q =
        new JsonObject()
            .put("slug", c.pathParam("slug"))
            .put("commentId", c.pathParam("commentId"));
    mongo
        .queryRecords(q, COMMENTS)
        .onSuccess(
            rows -> {
              if (rows.isEmpty()) {
                fail(c, 404, "Comment not found");
                return;
              }
              JsonObject row = rows.getFirst();
              boolean allowed =
                  Objects.equals(row.getString("userId"), Objects.toString(c.get("userId")))
                      || "ADMIN".equalsIgnoreCase(Objects.toString(c.get("role")));
              if (!allowed) {
                fail(c, 403, "You can only delete your own comments");
                return;
              }
              mongo
                  .deleteRecord(q, COMMENTS)
                  .onSuccess(
                      v ->
                          ok(
                              c,
                              Utility.createSuccessResponse(
                                  new JsonObject()
                                      .put("deleted", true)
                                      .put("commentId", c.pathParam("commentId")))));
            });
  }

  public void versions(RoutingContext c) {
    mongo
        .queryRecords(new JsonObject().put("slug", c.pathParam("slug")), POSTS)
        .onSuccess(
            posts -> {
              if (posts.isEmpty()) {
                fail(c, 404, "Blog post not found");
                return;
              }
              ensureBaseline(posts.getFirst());
              mongo
                  .queryRecords(new JsonObject().put("slug", c.pathParam("slug")), VERSIONS)
                  .onSuccess(
                      rows -> {
                        rows.sort(
                            Comparator.comparingInt(
                                    (JsonObject v) -> v.getInteger("versionNumber", 1))
                                .reversed());
                        String current = posts.getFirst().getString("publishedVersionId", "");
                        JsonArray items = new JsonArray();
                        rows.forEach(v -> items.add(publicVersion(v, current)));
                        ok(
                            c,
                            Utility.createSuccessResponse(
                                new JsonObject()
                                    .put("currentVersionId", current.isBlank() ? null : current)
                                    .put("items", items)));
                      });
            });
  }

  public void createVersion(RoutingContext c) {
    postAny(c.pathParam("slug"))
        .onSuccess(
            post -> {
              if (post == null) {
                fail(c, 404, "Blog post not found");
                return;
              }
              mongo
                  .queryRecords(new JsonObject().put("slug", c.pathParam("slug")), VERSIONS)
                  .onSuccess(
                      rows -> {
                        int number =
                            rows.stream()
                                    .mapToInt(v -> v.getInteger("versionNumber", 0))
                                    .max()
                                    .orElse(0)
                                + 1;
                        JsonObject snapshot = snapshot(c.body().asJsonObject(), post);
                        JsonObject row =
                            new JsonObject()
                                .put("versionId", UUID.randomUUID().toString())
                                .put("slug", c.pathParam("slug"))
                                .put(
                                    "name",
                                    clip(
                                        valueOr(
                                            c.body().asJsonObject(), "name", "Version " + number),
                                        100))
                                .put("versionNumber", number)
                                .put("status", "DRAFT")
                                .put("snapshot", snapshot)
                                .put("createdBy", c.get("userEmail"))
                                .put("updatedBy", c.get("userEmail"))
                                .put("createdAt", now())
                                .put("updatedAt", now())
                                .put("publishedAt", null);
                        mongo
                            .insertRecord(row, VERSIONS)
                            .onSuccess(
                                v ->
                                    ok(
                                        c,
                                        Utility.createSuccessResponse(
                                            publicVersion(
                                                row, post.getString("publishedVersionId", "")))));
                      });
            });
  }

  public void updateVersion(RoutingContext c) {
    JsonObject q = versionQuery(c);
    mongo
        .queryRecords(q, VERSIONS)
        .onSuccess(
            rows -> {
              if (rows.isEmpty()) {
                fail(c, 404, "Blog version not found");
                return;
              }
              JsonObject old = rows.getFirst(), body = c.body().asJsonObject();
              JsonObject set =
                  new JsonObject()
                      .put("name", clip(valueOr(body, "name", old.getString("name")), 100))
                      .put(
                          "snapshot",
                          snapshot(body, old.getJsonObject("snapshot", new JsonObject())))
                      .put("updatedBy", c.get("userEmail"))
                      .put("updatedAt", now());
              mongo
                  .updateRecord(q, new JsonObject().put("$set", set), VERSIONS)
                  .onSuccess(
                      v ->
                          ok(
                              c,
                              Utility.createSuccessResponse(
                                  publicVersion(old.copy().mergeIn(set), ""))));
            });
  }

  public void publishVersion(RoutingContext c) {
    JsonObject q = versionQuery(c);
    Future.all(postAny(c.pathParam("slug")), mongo.queryRecords(q, VERSIONS))
        .onSuccess(
            all -> {
              JsonObject post = all.resultAt(0);
              List<JsonObject> versions = all.resultAt(1);
              if (post == null) {
                fail(c, 404, "Blog post not found");
                return;
              }
              if (versions.isEmpty()) {
                fail(c, 404, "Blog version not found");
                return;
              }
              JsonObject v = versions.getFirst(), snap = v.getJsonObject("snapshot").copy();
              String timestamp = now();
              snap.put("slug", c.pathParam("slug"))
                  .put("status", "PUBLISHED")
                  .put("authorEmail", c.get("userEmail"))
                  .put("viewCount", post.getInteger("viewCount", 0))
                  .put("likeCount", post.getInteger("likeCount", 0))
                  .put("shareCount", post.getInteger("shareCount", 0))
                  .put("createdAt", post.getValue("createdAt"))
                  .put("updatedAt", timestamp)
                  .put("publishedAt", timestamp)
                  .put("publishedVersionId", v.getString("versionId"));
              mongo
                  .getMongoClient()
                  .replaceDocuments(POSTS, new JsonObject().put("slug", c.pathParam("slug")), snap)
                  .compose(
                      x ->
                          mongo.updateRecord(
                              q,
                              new JsonObject()
                                  .put(
                                      "$set",
                                      new JsonObject()
                                          .put("status", "PUBLISHED")
                                          .put("publishedAt", timestamp)
                                          .put("updatedAt", timestamp)),
                              VERSIONS))
                  .onSuccess(
                      x -> {
                        announcements
                            .announce(
                                snap,
                                v.getString("versionId"),
                                Objects.toString(c.get("userEmail"), ""))
                            .onFailure(error -> {});
                        ok(
                            c,
                            Utility.createSuccessResponse(
                                new JsonObject()
                                    .put("post", publicPost(snap, true))
                                    .put(
                                        "version",
                                        publicVersion(
                                            v.copy()
                                                .put("status", "PUBLISHED")
                                                .put("publishedAt", timestamp),
                                            v.getString("versionId")))
                                    .put("announcementQueued", true)));
                      });
            });
  }

  public void uploadAsset(RoutingContext c) {
    Buffer data = c.body().buffer();
    String type = Objects.toString(c.request().getHeader("content-type"), "");
    if (data.length() < 1 || data.length() > 8 * 1024 * 1024) {
      fail(c, 400, "Images must be between 1 byte and 8 MB");
      return;
    }
    if (!type.startsWith("image/")) {
      fail(c, 400, "Only image uploads are supported");
      return;
    }
    String id = UUID.randomUUID().toString().replace("-", "");
    String filename =
        Objects.toString(c.request().getHeader("X-Filename"), "blog-image")
            .replaceAll("[^A-Za-z0-9._-]+", "-");
    JsonObject row =
        new JsonObject()
            .put("assetId", id)
            .put("filename", clip(filename, 180))
            .put("contentType", clip(type, 120))
            .put("data", Base64.getEncoder().encodeToString(data.getBytes()))
            .put("uploadedAt", now());
    mongo
        .insertRecord(row, ASSETS)
        .onSuccess(
            v ->
                ok(
                    c,
                    Utility.createSuccessResponse(
                        new JsonObject()
                            .put("assetId", id)
                            .put("url", "/api/v2/blog-assets/" + id)
                            .put(
                                "markdown",
                                "![" + filename + "](/api/v2/blog-assets/" + id + ")"))));
  }

  public void asset(RoutingContext c) {
    mongo
        .queryRecords(new JsonObject().put("assetId", c.pathParam("assetId")), ASSETS)
        .onSuccess(
            rows -> {
              if (rows.isEmpty()) {
                fail(c, 404, "Blog image not found");
                return;
              }
              JsonObject a = rows.getFirst();
              c.response()
                  .putHeader("Content-Type", a.getString("contentType", "application/octet-stream"))
                  .putHeader("Cache-Control", "public, max-age=31536000, immutable")
                  .end(Buffer.buffer(Base64.getDecoder().decode(a.getString("data"))));
            });
  }

  public void metrics(RoutingContext c) {
    int days = intRange(c.request().getParam("days"), 30, 1, 90);
    String slug = c.request().getParam("slug");
    Instant start = Instant.now().minus(Duration.ofDays(days - 1));
    JsonObject q =
        new JsonObject().put("createdAt", new JsonObject().put("$gte", start.toString()));
    if (slug != null) q.put("slug", slug);
    Future.all(
            mongo.queryRecords(q, EVENTS),
            mongo.queryRecords(
                slug == null ? new JsonObject() : new JsonObject().put("slug", slug), COMMENTS),
            mongo.queryRecords(new JsonObject(), POSTS),
            mongo.queryRecords(
                slug == null ? new JsonObject() : new JsonObject().put("slug", slug), REACTIONS))
        .onSuccess(
            all -> {
              List<JsonObject> events = all.resultAt(0),
                  comments = all.resultAt(1),
                  posts = all.resultAt(2),
                  reactions = all.resultAt(3);
              List<JsonObject>
                  views =
                      events.stream().filter(e -> "view".equals(e.getString("eventType"))).toList(),
                  engagement =
                      events.stream()
                          .filter(e -> "engagement".equals(e.getString("eventType")))
                          .toList(),
                  shares =
                      events.stream()
                          .filter(e -> "share".equals(e.getString("eventType")))
                          .toList(),
                  likes =
                      events.stream().filter(e -> "like".equals(e.getString("eventType"))).toList(),
                  completes =
                      events.stream()
                          .filter(e -> "complete".equals(e.getString("eventType")))
                          .toList();
              Set<String> visitors = new HashSet<>(), done = new HashSet<>();
              views.forEach(e -> visitors.add(e.getString("visitorHash")));
              completes.forEach(e -> done.add(e.getString("visitorHash")));
              double avg =
                  engagement.stream().mapToInt(e -> e.getInteger("seconds", 0)).average().orElse(0);
              JsonObject out =
                  new JsonObject()
                      .put("rangeDays", days)
                      .put("totalViews", views.size())
                      .put("uniqueVisitors", visitors.size())
                      .put(
                          "viewsToday",
                          views.stream()
                              .filter(
                                  e ->
                                      e.getString("createdAt", "")
                                          .startsWith(LocalDate.now(ZoneOffset.UTC).toString()))
                              .count())
                      .put("totalLikes", reactions.size())
                      .put("likesInRange", likes.size())
                      .put("totalShares", shares.size())
                      .put("totalComments", comments.size())
                      .put("averageEngagedSeconds", Math.round(avg * 10) / 10.0)
                      .put(
                          "completionRate",
                          visitors.isEmpty()
                              ? 0
                              : Math.round(done.size() * 1000.0 / visitors.size()) / 10.0)
                      .put("daily", new JsonArray())
                      .put("topPosts", new JsonArray())
                      .put("referrers", new JsonArray())
                      .put("devices", new JsonArray())
                      .put("shareChannels", new JsonArray());
              ok(c, Utility.createSuccessResponse(out));
            });
  }

  private void ensureBaseline(JsonObject post) {
    mongo
        .queryRecords(new JsonObject().put("slug", post.getString("slug")), VERSIONS)
        .onSuccess(
            rows -> {
              if (!rows.isEmpty()) return;
              String id = UUID.randomUUID().toString(), status = post.getString("status", "DRAFT");
              JsonObject v =
                  new JsonObject()
                      .put("versionId", id)
                      .put("slug", post.getString("slug"))
                      .put(
                          "name",
                          status.equals("PUBLISHED") ? "Published version 1" : "Initial draft")
                      .put("versionNumber", 1)
                      .put("status", status)
                      .put("snapshot", snapshot(post, post))
                      .put("createdBy", post.getString("authorEmail", ""))
                      .put("updatedBy", post.getString("authorEmail", ""))
                      .put("createdAt", post.getValue("createdAt"))
                      .put("updatedAt", post.getValue("updatedAt"))
                      .put(
                          "publishedAt",
                          status.equals("PUBLISHED") ? post.getValue("publishedAt") : null);
              mongo.insertRecord(v, VERSIONS);
              if (status.equals("PUBLISHED"))
                mongo.updateRecord(
                    new JsonObject().put("slug", post.getString("slug")),
                    new JsonObject().put("$set", new JsonObject().put("publishedVersionId", id)),
                    POSTS);
            });
  }

  private void seedTerms(String slug, String content) {
    try {
      JsonObject seed = new JsonObject(resource("seed/raspberry-pi-5-personal-cloud-terms.json")),
          terms = seed.getJsonObject("terms", new JsonObject());
      Matcher m = TERM.matcher(content);
      while (m.find()) {
        String id = m.group(2), summary = terms.getString(id, "").trim();
        if (summary.isEmpty()) continue;
        JsonObject row =
            new JsonObject()
                .put("slug", slug)
                .put("termId", id)
                .put("term", plain(m.group(1)))
                .put("summary", clip(summary.replaceAll("\\s+", " "), 900))
                .put("source", "bundled-seed")
                .put("updatedAt", now());
        mongo
            .getMongoClient()
            .updateCollectionWithOptions(
                TERMS,
                new JsonObject().put("slug", slug).put("termId", id),
                new JsonObject()
                    .put("$set", row)
                    .put("$setOnInsert", new JsonObject().put("createdAt", now())),
                new UpdateOptions().setUpsert(true));
      }
    } catch (Exception ignored) {
    }
  }

  private JsonObject normalize(JsonObject b, JsonObject old, String email) {
    if (b == null) b = new JsonObject();
    String title = valueOr(b, "title", old == null ? "" : old.getString("title", ""));
    String slug = valueOr(b, "slug", old == null ? slugify(title) : old.getString("slug"));
    if (title.isBlank()) throw new IllegalArgumentException("Title is required");
    if (!SLUG.matcher(slug).matches()) throw new IllegalArgumentException("Invalid blog slug");
    String status =
        valueOr(b, "status", old == null ? "DRAFT" : old.getString("status", "DRAFT"))
            .toUpperCase(Locale.ROOT);
    if (!STATUSES.contains(status))
      throw new IllegalArgumentException("Status must be DRAFT or PUBLISHED");
    String now = now();
    return new JsonObject()
        .put("slug", slug)
        .put("title", clip(title, 180))
        .put(
            "excerpt",
            clip(valueOr(b, "excerpt", old == null ? "" : old.getString("excerpt", "")), 500))
        .put("content", valueOr(b, "content", old == null ? "" : old.getString("content", "")))
        .put(
            "coverImage",
            clip(
                valueOr(b, "coverImage", old == null ? "" : old.getString("coverImage", "")), 1000))
        .put(
            "tags",
            tags(
                b.containsKey("tags")
                    ? b.getValue("tags")
                    : old == null ? null : old.getValue("tags")))
        .put(
            "author",
            clip(valueOr(b, "author", old == null ? "" : old.getString("author", "")), 100))
        .put("authorEmail", email)
        .put(
            "series",
            clip(valueOr(b, "series", old == null ? "" : old.getString("series", "")), 140))
        .put(
            "seriesPart",
            Math.max(
                0,
                intValue(
                    b.getValue("seriesPart"), old == null ? 0 : old.getInteger("seriesPart", 0))))
        .put("status", status)
        .put("viewCount", old == null ? 0 : old.getInteger("viewCount", 0))
        .put("likeCount", old == null ? 0 : old.getInteger("likeCount", 0))
        .put("shareCount", old == null ? 0 : old.getInteger("shareCount", 0))
        .put("createdAt", old == null ? now : old.getValue("createdAt"))
        .put("updatedAt", now)
        .put(
            "publishedAt",
            status.equals("PUBLISHED")
                ? (old != null && old.getValue("publishedAt") != null
                    ? old.getValue("publishedAt")
                    : now)
                : null)
        .put("publishedVersionId", old == null ? null : old.getValue("publishedVersionId"));
  }

  private JsonObject snapshot(JsonObject b, JsonObject base) {
    JsonObject o = new JsonObject();
    for (String k : List.of("title", "excerpt", "content", "coverImage", "author", "series"))
      o.put(k, b != null && b.containsKey(k) ? b.getValue(k) : base.getValue(k));
    o.put(
            "tags",
            tags(b != null && b.containsKey("tags") ? b.getValue("tags") : base.getValue("tags")))
        .put(
            "seriesPart",
            Math.max(
                0,
                intValue(
                    b == null ? null : b.getValue("seriesPart"),
                    base.getInteger("seriesPart", 0))));
    return o;
  }

  private JsonObject publicPost(JsonObject p, boolean content) {
    JsonObject x = p.copy();
    x.remove("_id");
    x.remove("authorEmail");
    x.remove("publishedVersionId");
    x.put(
            "readingMinutes",
            Math.max(1, (p.getString("content", "").split("\\s+").length + 219) / 220))
        .put("likeCount", Math.max(0, p.getInteger("likeCount", 0)))
        .put("shareCount", Math.max(0, p.getInteger("shareCount", 0)));
    if (!content) x.remove("content");
    return x;
  }

  private JsonObject publicVersion(JsonObject v, String current) {
    JsonObject s = v.getJsonObject("snapshot", new JsonObject());
    return new JsonObject()
        .put("versionId", v.getString("versionId"))
        .put("slug", v.getString("slug"))
        .put("name", v.getString("name", "Untitled version"))
        .put("versionNumber", v.getInteger("versionNumber", 1))
        .put("status", v.getString("status", "DRAFT"))
        .put("isCurrent", v.getString("versionId", "").equals(current))
        .put("createdAt", v.getValue("createdAt"))
        .put("updatedAt", v.getValue("updatedAt"))
        .put("publishedAt", v.getValue("publishedAt"))
        .mergeIn(s)
        .put(
            "readingMinutes",
            Math.max(1, (s.getString("content", "").split("\\s+").length + 219) / 220));
  }

  private JsonObject publicComment(JsonObject d, RoutingContext c) {
    String uid = Objects.toString(c.get("userId"), "");
    return new JsonObject()
        .put("commentId", d.getString("commentId"))
        .put("slug", d.getString("slug"))
        .put("content", d.getString("content"))
        .put("authorName", d.getString("authorName", "ToolHub reader"))
        .put("authorProfilePicture", d.getString("authorProfilePicture", ""))
        .put("createdAt", d.getValue("createdAt"))
        .put(
            "canDelete",
            (!uid.isEmpty() && uid.equals(d.getString("userId")))
                || "ADMIN".equalsIgnoreCase(Objects.toString(c.get("role"))));
  }

  private JsonObject eventDoc(RoutingContext c, JsonObject b, String type) {
    String ua = clip(Objects.toString(c.request().getHeader("user-agent"), ""), 500),
        ref =
            clip(
                valueOr(b, "referrer", Objects.toString(c.request().getHeader("referer"), "")),
                500);
    String device =
        ua.toLowerCase().matches(".*(ipad|tablet).*")
            ? "tablet"
            : ua.toLowerCase().matches(".*(mobile|iphone|android).*") ? "mobile" : "desktop";
    return new JsonObject()
        .put("slug", c.pathParam("slug"))
        .put("eventType", type)
        .put("visitorHash", visitor(c, value(b, "visitorId")))
        .put("sessionId", clip(sha(value(b, "sessionId")), 24))
        .put("referrer", ref)
        .put("device", device)
        .put("userAgent", ua)
        .put("screenWidth", intRange(value(b, "screenWidth"), 0, 0, 10000))
        .put("seconds", intRange(value(b, "seconds"), 0, 0, 3600))
        .put("channel", clip(value(b, "channel").toLowerCase(Locale.ROOT), 40))
        .put("createdAt", now());
  }

  private Future<JsonObject> post(String slug, boolean published) {
    JsonObject q = new JsonObject().put("slug", slug);
    if (published) q.put("status", "PUBLISHED");
    return mongo.queryRecords(q, POSTS).map(r -> r.isEmpty() ? null : r.getFirst());
  }

  private Future<JsonObject> postAny(String s) {
    return post(s, false);
  }

  private JsonObject versionQuery(RoutingContext c) {
    return new JsonObject()
        .put("slug", c.pathParam("slug"))
        .put("versionId", c.pathParam("versionId"));
  }

  private String visitor(RoutingContext c, String supplied) {
    String fallback =
        (c.request().remoteAddress() == null ? "" : c.request().remoteAddress().host())
            + "|"
            + Objects.toString(c.request().getHeader("user-agent"), "");
    return sha(
        env.get("BLOG_ANALYTICS_SALT", env.get("JWT_SECRET", "toolhub-blog"))
            + "|"
            + (supplied.isBlank() ? fallback : clip(supplied, 160)));
  }

  private JsonArray tags(Object raw) {
    JsonArray out = new JsonArray();
    if (raw instanceof JsonArray a)
      for (Object v : a) {
        String s = clip(Objects.toString(v, "").trim(), 40);
        if (!s.isEmpty() && out.stream().noneMatch(x -> x.toString().equalsIgnoreCase(s)))
          out.add(s);
        if (out.size() >= 12) break;
      }
    return out;
  }

  private String resource(String p) throws Exception {
    try (InputStream in = getClass().getClassLoader().getResourceAsStream(p)) {
      if (in == null) throw new IllegalStateException(p);
      return new String(in.readAllBytes(), StandardCharsets.UTF_8).trim();
    }
  }

  private String plain(String v) {
    return v.replaceAll("!\\[([^]]*)]\\([^)]*\\)", "$1")
        .replaceAll("\\[([^]]+)]\\([^)]*\\)", "$1")
        .replaceAll("[`*_>#|]", " ")
        .replaceAll("\\s+", " ")
        .trim();
  }

  private String slugify(String s) {
    return clip(
        s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", ""), 100);
  }

  private String sha(String s) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      return "";
    }
  }

  private String value(JsonObject b, String k) {
    return Objects.toString(b == null ? null : b.getValue(k), "").trim();
  }

  private String valueOr(JsonObject b, String k, String f) {
    String v = value(b, k);
    return v.isEmpty() ? f : v;
  }

  private String clip(String s, int n) {
    s = Objects.toString(s, "");
    return s.substring(0, Math.min(n, s.length()));
  }

  private int intValue(Object v, int f) {
    try {
      return Integer.parseInt(Objects.toString(v));
    } catch (Exception e) {
      return f;
    }
  }

  private int intRange(String v, int f, int min, int max) {
    return Math.max(min, Math.min(max, intValue(v, f)));
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
