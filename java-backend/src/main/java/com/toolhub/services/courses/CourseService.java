package com.toolhub.services.courses;

import com.toolhub.Utils.Utility;
import com.toolhub.services.ai.AiGatewayClient;
import com.toolhub.services.mongo.MongoDBClient;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.mongo.UpdateOptions;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.client.WebClient;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;

public class CourseService {
  private static final String COURSES = "courses",
      MODULES = "course_modules",
      QUESTIONS = "course_questions",
      PROGRESS = "course_progress";
  private static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$");
  private static final Set<String> STOP =
      Set.of(
          "about", "after", "again", "also", "and", "are", "can", "could", "does", "explain", "for",
          "from", "have", "how", "into", "module", "more", "that", "the", "this", "what", "when",
          "where", "which", "with", "would", "you");
  private final MongoDBClient mongo;
  private final AiGatewayClient gateway;
  private final Vertx vertx;

  public CourseService(MongoDBClient mongo, WebClient client, Vertx vertx, Dotenv env) {
    this.mongo = mongo;
    this.gateway = new AiGatewayClient(client, env);
    this.vertx = vertx;
  }

  public void seed() {
    for (CourseSeed course : seeds()) {
      List<Future<?>> writes = new ArrayList<>();
      String now = now();
      for (ModuleSeed module : course.modules) {
        String resource = "seed/courses/" + course.id + "/" + module.file;
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(resource)) {
          if (in == null)
            throw new IllegalStateException(
                "Course seed is missing: " + course.id + "/" + module.file);
          String content = new String(in.readAllBytes(), StandardCharsets.UTF_8).trim();
          JsonObject row =
              new JsonObject()
                  .put("id", moduleId(course.id, module.slug))
                  .put("courseId", course.id)
                  .put("slug", module.slug)
                  .put("position", module.position)
                  .put("title", module.title)
                  .put("duration", module.duration)
                  .put("excerpt", module.excerpt)
                  .put("content", content)
                  .put("contentHash", sha256(content))
                  .put("readingMinutes", Math.max(1, (content.split("\\s+").length + 219) / 220))
                  .put("updatedAt", now);
          writes.add(
              mongo
                  .getMongoClient()
                  .updateCollectionWithOptions(
                      MODULES,
                      new JsonObject().put("id", row.getString("id")),
                      new JsonObject()
                          .put("$set", row)
                          .put("$setOnInsert", new JsonObject().put("createdAt", now)),
                      new UpdateOptions().setUpsert(true)));
        } catch (Exception e) {
          throw new IllegalStateException(e);
        }
      }
      JsonObject row =
          new JsonObject()
              .put("id", course.id)
              .put("title", course.title)
              .put("subtitle", course.subtitle)
              .put("description", course.description)
              .put("level", course.level)
              .put("estimatedHours", course.hours)
              .put("moduleCount", course.modules.size())
              .put("status", "published")
              .put("source", course.source)
              .put("updatedAt", now);
      writes.add(
          mongo
              .getMongoClient()
              .updateCollectionWithOptions(
                  COURSES,
                  new JsonObject().put("id", course.id),
                  new JsonObject()
                      .put("$set", row)
                      .put("$setOnInsert", new JsonObject().put("createdAt", now)),
                  new UpdateOptions().setUpsert(true)));
      Future.all((List) writes).onFailure(error -> {});
    }
  }

  public void listCourses(RoutingContext ctx) {
    mongo
        .queryRecords(new JsonObject().put("status", "published"), COURSES)
        .onSuccess(
            courses ->
                mongo
                    .queryRecords(
                        new JsonObject().put("ownerId", ctx.get("userId")).put("completed", true),
                        PROGRESS)
                    .onSuccess(
                        progress -> {
                          Map<String, Integer> counts = new HashMap<>();
                          progress.forEach(
                              p -> counts.merge(p.getString("courseId"), 1, Integer::sum));
                          courses.sort(Comparator.comparing(c -> c.getString("createdAt", "")));
                          JsonArray out = new JsonArray();
                          courses.forEach(
                              c ->
                                  out.add(
                                      clean(c)
                                          .put(
                                              "completedModuleCount",
                                              counts.getOrDefault(c.getString("id"), 0))));
                          ok(ctx, Utility.createSuccessResponse(out));
                        })
                    .onFailure(e -> fail(ctx, 500, e.getMessage())))
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void getCourse(RoutingContext ctx) {
    String courseId = ctx.pathParam("courseId");
    course(courseId)
        .onSuccess(
            course -> {
              if (course == null) {
                fail(ctx, 404, "Course not found");
                return;
              }
              Future.all(
                      mongo.queryRecords(new JsonObject().put("courseId", courseId), MODULES),
                      mongo.queryRecords(
                          new JsonObject()
                              .put("ownerId", ctx.get("userId"))
                              .put("courseId", courseId),
                          PROGRESS))
                  .onSuccess(
                      joined -> {
                        List<JsonObject> modules = joined.resultAt(0),
                            progress = joined.resultAt(1);
                        Map<String, JsonObject> byModule = new HashMap<>();
                        progress.forEach(p -> byModule.put(p.getString("moduleId"), p));
                        modules.sort(Comparator.comparingInt(m -> m.getInteger("position", 0)));
                        JsonArray items = new JsonArray();
                        int completed = 0;
                        for (JsonObject m : modules) {
                          JsonObject p = byModule.getOrDefault(m.getString("id"), new JsonObject());
                          boolean done = p.getBoolean("completed", false);
                          if (done) completed++;
                          items.add(
                              publicModule(m, false)
                                  .put("completed", done)
                                  .put(
                                      "readingProgress", number(p.getValue("readingProgress"), 0)));
                        }
                        ok(
                            ctx,
                            Utility.createSuccessResponse(
                                clean(course)
                                    .put("modules", items)
                                    .put("completedModuleCount", completed)));
                      })
                  .onFailure(e -> fail(ctx, 500, e.getMessage()));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void getModule(RoutingContext ctx) {
    findModule(ctx)
        .onSuccess(
            module -> {
              if (module == null) {
                fail(ctx, 404, "Course module not found");
                return;
              }
              Future.all(
                      mongo.queryRecords(
                          new JsonObject()
                              .put("ownerId", ctx.get("userId"))
                              .put("moduleId", module.getString("id")),
                          PROGRESS),
                      mongo.queryRecords(
                          new JsonObject()
                              .put("ownerId", ctx.get("userId"))
                              .put("moduleId", module.getString("id")),
                          QUESTIONS))
                  .onSuccess(
                      joined -> {
                        List<JsonObject> progress = joined.resultAt(0),
                            questions = joined.resultAt(1);
                        JsonObject p = progress.isEmpty() ? new JsonObject() : progress.getFirst();
                        questions.sort(
                            Comparator.comparing((JsonObject q) -> q.getString("createdAt", ""))
                                .reversed());
                        JsonArray qs = new JsonArray();
                        questions.forEach(q -> qs.add(publicQuestion(q)));
                        ok(
                            ctx,
                            Utility.createSuccessResponse(
                                publicModule(module, true)
                                    .put("completed", p.getBoolean("completed", false))
                                    .put(
                                        "readingProgress", number(p.getValue("readingProgress"), 0))
                                    .put("questions", qs)));
                      })
                  .onFailure(e -> fail(ctx, 500, e.getMessage()));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void updateProgress(RoutingContext ctx) {
    findModule(ctx)
        .onSuccess(
            module -> {
              if (module == null) {
                fail(ctx, 404, "Course module not found");
                return;
              }
              JsonObject body = ctx.body().asJsonObject();
              double reading =
                  number(body == null ? null : body.getValue("readingProgress"), Double.NaN);
              if (Double.isNaN(reading)) {
                fail(ctx, 400, "Invalid reading progress");
                return;
              }
              reading = Math.max(0, Math.min(1, reading));
              boolean completed = body.getBoolean("completed", false);
              if (completed) reading = 1;
              String now = now();
              JsonObject row =
                  new JsonObject()
                      .put("ownerId", ctx.get("userId"))
                      .put("courseId", ctx.pathParam("courseId"))
                      .put("moduleId", module.getString("id"))
                      .put("moduleSlug", ctx.pathParam("moduleSlug"))
                      .put("readingProgress", reading)
                      .put("completed", completed)
                      .put("updatedAt", now);
              double resultReading = reading;
              mongo
                  .getMongoClient()
                  .updateCollectionWithOptions(
                      PROGRESS,
                      new JsonObject()
                          .put("ownerId", ctx.get("userId"))
                          .put("moduleId", module.getString("id")),
                      new JsonObject()
                          .put("$set", row)
                          .put("$setOnInsert", new JsonObject().put("createdAt", now)),
                      new UpdateOptions().setUpsert(true))
                  .onSuccess(
                      v ->
                          ok(
                              ctx,
                              Utility.createSuccessResponse(
                                  new JsonObject()
                                      .put("moduleId", module.getString("id"))
                                      .put("readingProgress", resultReading)
                                      .put("completed", completed))))
                  .onFailure(e -> fail(ctx, 500, e.getMessage()));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void createQuestion(RoutingContext ctx) {
    String courseId = ctx.pathParam("courseId");
    Future.all(course(courseId), findModule(ctx))
        .onSuccess(
            joined -> {
              JsonObject course = joined.resultAt(0), module = joined.resultAt(1);
              if (course == null) {
                fail(ctx, 404, "Course not found");
                return;
              }
              if (module == null) {
                fail(ctx, 404, "Course module not found");
                return;
              }
              JsonObject body = ctx.body().asJsonObject();
              String selected = value(body, "selectedText"), question = value(body, "question");
              String before = value(body, "contextBefore"), after = value(body, "contextAfter");
              if (selected.length() > 4000) {
                fail(ctx, 400, "Selected text cannot exceed 4000 characters");
                return;
              }
              if (question.isEmpty() || question.length() > 2000) {
                fail(ctx, 400, "Question must contain 1 to 2000 characters");
                return;
              }
              if (before.length() + after.length() > 6000) {
                fail(ctx, 400, "Selection context is too large");
                return;
              }
              String now = now(), id = UUID.randomUUID().toString();
              JsonObject row =
                  new JsonObject()
                      .put("id", id)
                      .put("ownerId", ctx.get("userId"))
                      .put("courseId", courseId)
                      .put("courseTitle", course.getString("title"))
                      .put("moduleId", module.getString("id"))
                      .put("moduleSlug", ctx.pathParam("moduleSlug"))
                      .put("moduleTitle", module.getString("title"))
                      .put("moduleContentSnapshot", module.getString("content"))
                      .put("moduleContentHash", module.getString("contentHash", ""))
                      .put("selectedText", selected)
                      .put("question", question)
                      .put("contextBefore", before)
                      .put("contextAfter", after)
                      .put("answer", "")
                      .put("status", "pending")
                      .put("error", "")
                      .put("createdAt", now)
                      .put("updatedAt", now);
              mongo
                  .insertRecord(row, QUESTIONS)
                  .onSuccess(
                      v -> {
                        ctx.response().setStatusCode(202);
                        ok(ctx, Utility.createSuccessResponse(publicQuestion(row)));
                        completeQuestion(row);
                      })
                  .onFailure(e -> fail(ctx, 500, e.getMessage()));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  public void getQuestion(RoutingContext ctx) {
    mongo
        .queryRecords(
            new JsonObject()
                .put("id", ctx.pathParam("questionId"))
                .put("ownerId", ctx.get("userId")),
            QUESTIONS)
        .onSuccess(
            rows -> {
              if (rows.isEmpty()) fail(ctx, 404, "Course question not found");
              else ok(ctx, Utility.createSuccessResponse(publicQuestion(rows.getFirst())));
            })
        .onFailure(e -> fail(ctx, 500, e.getMessage()));
  }

  private void completeQuestion(JsonObject row) {
    String selected = clip(row.getString("selectedText", ""), 3500);
    String surrounding =
        clip(
            String.join(
                "\n\n",
                nonEmpty(row.getString("contextBefore", ""), row.getString("contextAfter", ""))),
            1800);
    int budget = Math.max(1200, 7000 - selected.length() - surrounding.length());
    JsonArray context =
        new JsonArray()
            .add(textContext("Course", row.getString("courseTitle")))
            .add(textContext("Module", row.getString("moduleTitle")))
            .add(
                textContext(
                    "Relevant module lesson context",
                    relevantContext(
                        row.getString("moduleContentSnapshot", ""),
                        row.getString("question"),
                        budget)));
    if (!selected.isEmpty()) context.add(textContext("Selected passage", selected));
    if (!surrounding.isEmpty()) context.add(textContext("Surrounding lesson context", surrounding));
    String prompt =
        "Use the supplied course module as the primary context. "
            + (!selected.isEmpty() ? "Give special attention to the selected passage. " : "")
            + "Answer this learner question in direct, beginner-friendly language: "
            + row.getString("question");
    JsonObject payload =
        new JsonObject()
            .put("input", prompt)
            .put("conversation", new JsonObject().put("providerConversationId", null))
            .put("context", context)
            .put("capabilityProfile", "knowledge-only")
            .put(
                "metadata",
                new JsonObject()
                    .put("application", "toolhub-courses")
                    .put("courseId", row.getString("courseId"))
                    .put("moduleId", row.getString("moduleId"))
                    .put("questionId", row.getString("id")));
    gateway
        .post("/v1/responses", payload, 330)
        .compose(
            response -> {
              String answer = response.getString("outputText", "").trim();
              if (answer.isEmpty())
                return Future.failedFuture("AI gateway returned an empty course explanation");
              JsonObject update =
                  new JsonObject()
                      .put("answer", answer)
                      .put("status", "completed")
                      .put("error", "")
                      .put("providerRequestId", response.getString("id", ""))
                      .put(
                          "providerConversationId",
                          response
                              .getJsonObject("conversation", new JsonObject())
                              .getString("providerConversationId", ""))
                      .put("updatedAt", now());
              return mongo.updateRecord(
                  new JsonObject().put("id", row.getString("id")),
                  new JsonObject().put("$set", update),
                  QUESTIONS);
            })
        .onFailure(
            e ->
                mongo.updateRecord(
                    new JsonObject().put("id", row.getString("id")),
                    new JsonObject()
                        .put(
                            "$set",
                            new JsonObject()
                                .put("status", "failed")
                                .put(
                                    "error",
                                    "The AI explanation could not be completed. Try again.")
                                .put("updatedAt", now())),
                    QUESTIONS));
  }

  private Future<JsonObject> course(String id) {
    return mongo
        .queryRecords(new JsonObject().put("id", id).put("status", "published"), COURSES)
        .map(rows -> rows.isEmpty() ? null : rows.getFirst());
  }

  private Future<JsonObject> findModule(RoutingContext ctx) {
    String slug = ctx.pathParam("moduleSlug");
    if (slug == null || !SLUG.matcher(slug).matches()) return Future.succeededFuture(null);
    return mongo
        .queryRecords(
            new JsonObject().put("courseId", ctx.pathParam("courseId")).put("slug", slug), MODULES)
        .map(rows -> rows.isEmpty() ? null : rows.getFirst());
  }

  private JsonObject publicModule(JsonObject d, boolean content) {
    JsonObject out =
        new JsonObject()
            .put("id", d.getString("id"))
            .put("courseId", d.getString("courseId"))
            .put("slug", d.getString("slug"))
            .put("position", d.getInteger("position"))
            .put("title", d.getString("title"))
            .put("duration", d.getString("duration"))
            .put("excerpt", d.getString("excerpt"))
            .put("readingMinutes", d.getInteger("readingMinutes", 1))
            .put("updatedAt", d.getString("updatedAt"));
    if (content) out.put("content", d.getString("content"));
    return out;
  }

  private JsonObject publicQuestion(JsonObject d) {
    return new JsonObject()
        .put("id", d.getString("id"))
        .put("courseId", d.getString("courseId"))
        .put("moduleId", d.getString("moduleId"))
        .put("moduleSlug", d.getString("moduleSlug"))
        .put("selectedText", d.getString("selectedText"))
        .put("question", d.getString("question"))
        .put("answer", d.getString("answer", ""))
        .put("status", d.getString("status", "pending"))
        .put("error", d.getString("error", ""))
        .put("createdAt", d.getString("createdAt"))
        .put("updatedAt", d.getString("updatedAt"));
  }

  private String relevantContext(String content, String question, int budget) {
    List<String> blocks =
        Arrays.stream(content.split("\\n\\s*\\n"))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .toList();
    Set<String> terms = new HashSet<>();
    for (String t : question.toLowerCase(Locale.ROOT).split("[^a-z0-9_-]+"))
      if (t.length() >= 3 && !STOP.contains(t)) terms.add(t);
    List<String> headings = blocks.stream().filter(s -> s.startsWith("#")).toList();
    List<String> ranked = new ArrayList<>(blocks);
    ranked.sort(
        Comparator.comparingInt(
                (String b) ->
                    terms.stream().mapToInt(t -> occurrences(b.toLowerCase(Locale.ROOT), t)).sum())
            .reversed());
    LinkedHashSet<String> candidates = new LinkedHashSet<>();
    candidates.add("Module outline:\n" + String.join("\n", headings));
    candidates.addAll(ranked);
    StringBuilder out = new StringBuilder();
    for (String c : candidates) {
      int remaining = budget - out.length();
      if (remaining <= 0) break;
      if (!out.isEmpty()) out.append("\n\n");
      out.append(c, 0, Math.min(c.length(), Math.max(0, remaining)));
    }
    return clip(out.toString(), budget);
  }

  private int occurrences(String text, String term) {
    int n = 0, p = 0;
    while ((p = text.indexOf(term, p)) >= 0) {
      n++;
      p += term.length();
    }
    return n;
  }

  private JsonObject textContext(String label, String text) {
    return new JsonObject().put("type", "text").put("label", label).put("text", text);
  }

  private JsonObject clean(JsonObject d) {
    JsonObject c = d.copy();
    c.remove("_id");
    return c;
  }

  private String value(JsonObject b, String k) {
    return Objects.toString(b == null ? null : b.getValue(k), "").trim();
  }

  private List<String> nonEmpty(String... parts) {
    return Arrays.stream(parts).filter(s -> s != null && !s.isEmpty()).toList();
  }

  private String clip(String s, int n) {
    s = Objects.toString(s, "");
    return s.substring(0, Math.min(n, s.length()));
  }

  private double number(Object v, double f) {
    try {
      return Double.parseDouble(Objects.toString(v));
    } catch (Exception e) {
      return f;
    }
  }

  private String moduleId(String c, String s) {
    return c + ":" + s;
  }

  private String now() {
    return Instant.now().toString();
  }

  private String sha256(String s) throws Exception {
    return java.util.HexFormat.of()
        .formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
  }

  private void ok(RoutingContext c, Object b) {
    c.response()
        .putHeader("Content-Type", "application/json")
        .end(io.vertx.core.json.Json.encode(b));
  }

  private void fail(RoutingContext c, int s, String m) {
    Utility.buildResponse(c, s, Utility.createErrorResponse(m));
  }

  private record ModuleSeed(
      String slug, int position, String title, String duration, String excerpt, String file) {}

  private record CourseSeed(
      String id,
      String title,
      String subtitle,
      String description,
      String level,
      String hours,
      String source,
      List<ModuleSeed> modules) {}

  private List<CourseSeed> seeds() {
    return List.of(
        new CourseSeed(
            "linux-homelab-foundations",
            "Linux Homelab Foundations — The Clear Guide",
            "Learn Linux as the operator of hp-codex, ubuntu-purva, pi-purva, and the services between them.",
            "A slow, visual, hands-on foundation covering how Linux works, shell reasoning, the directory tree, users, groups, permissions, Docker, and NFS identity.",
            "Foundation",
            "23–30 hours",
            "Linux-Homelab-Foundations-Clear-Guide.pdf",
            List.of(
                new ModuleSeed(
                    "how-linux-works",
                    1,
                    "How Linux works — a useful mental model",
                    "3–4 hours",
                    "Kernel versus user space, programs and processes, shells, identity, and your homelab boundaries.",
                    "01-how-linux-works.md"),
                new ModuleSeed(
                    "shell-commands-without-guesswork",
                    2,
                    "The shell — commands without guesswork",
                    "6–8 hours",
                    "Navigate, inspect, transform, quote, redirect, and compose commands safely.",
                    "02-shell-commands-without-guesswork.md"),
                new ModuleSeed(
                    "linux-directory-tree",
                    3,
                    "The Linux directory tree — where things belong",
                    "5–6 hours",
                    "Understand the single filesystem tree, important directories, links, mounts, and NFS-backed media paths.",
                    "03-linux-directory-tree.md"),
                new ModuleSeed(
                    "users-groups-permissions",
                    4,
                    "Users, groups and permissions",
                    "8–10 hours",
                    "Reason about UID/GID, mode bits, sudo, Docker ownership, NFS identity, ACLs, and diagnosis.",
                    "04-users-groups-permissions.md"),
                new ModuleSeed(
                    "foundation-review",
                    5,
                    "Foundation review and next steps",
                    "1–2 hours",
                    "Test the mental model, review essential commands, and prepare for services, networking, storage, and Docker.",
                    "05-foundation-review.md"))),
        new CourseSeed(
            "toolhub-codex-integration-architecture",
            "ToolHub–Codex Integration Architecture",
            "A complete HLD and LLD review of ToolHub's reusable private AI platform.",
            "Understand every layer from the ToolHub course and chat interfaces through MongoDB, the signed provider-neutral gateway, the private hp-codex executor, and the Codex CLI runtime.",
            "Intermediate",
            "8–10 hours",
            "Verified production implementation and deployment documentation",
            List.of(
                new ModuleSeed(
                    "capabilities-and-system-goals",
                    1,
                    "Capabilities, goals and non-goals",
                    "45–60 minutes",
                    "What the integration can do today, what each capability profile permits, and the deliberate boundaries.",
                    "01-capabilities-and-system-goals.md"),
                new ModuleSeed(
                    "high-level-architecture",
                    2,
                    "High-level architecture and ownership",
                    "60–75 minutes",
                    "Follow requests across the browser, ToolHub, gateway, executor, Codex CLI, and their persistence boundaries.",
                    "02-high-level-architecture.md"),
                new ModuleSeed(
                    "contract-and-request-security",
                    3,
                    "Provider-neutral contract and request security",
                    "75–90 minutes",
                    "REST schemas, HMAC signing, scopes, source restrictions, timestamps, nonces, and replay protection.",
                    "03-contract-and-request-security.md"),
                new ModuleSeed(
                    "codex-gateway-low-level-design",
                    4,
                    "Codex gateway — low-level design",
                    "75–90 minutes",
                    "Validation, prompt assembly, runtime snapshots, concurrency, audit records, errors, and executor adaptation.",
                    "04-codex-gateway-low-level-design.md"),
                new ModuleSeed(
                    "hp-codex-executor-wrapper",
                    5,
                    "hp-codex executor and Codex CLI wrapper",
                    "90–120 minutes",
                    "The private execution API, fixed CLI command, sanitized environment, profiles, event parsing, timeouts, and process isolation.",
                    "05-hp-codex-executor-wrapper.md"),
                new ModuleSeed(
                    "toolhub-application-integration",
                    6,
                    "ToolHub application integration",
                    "90–120 minutes",
                    "Admin authorization, chat persistence, background execution, course context retrieval, polling, and frontend behavior.",
                    "06-toolhub-application-integration.md"),
                new ModuleSeed(
                    "operations-reliability-and-review",
                    7,
                    "Operations, reliability and design review",
                    "75–90 minutes",
                    "Systemd hardening, private networking, health, failure modes, observability, rollback, trade-offs, and future providers.",
                    "07-operations-reliability-and-review.md"))));
  }
}
