# Python-to-Vert.x porting status

This manifest distinguishes API/feature parity from literal implementation
identity. The Vert.x backend is the maintained implementation; Python is the
reference used for this synchronization pass.

## Verification snapshot

- FastAPI declarations: **140**
- Vert.x registrations: **140**
- Missing Vert.x registrations: **0**
- Python seed files: **15**
- Matching Java classpath seed files: **15** (SHA-256 identical)
- Java verification: `spotlessApply clean test shadowJar` passes on Java 21
- Environment-dependent deployment checks live in the separate
  `integrationTest` task.

## Source map

| Python source | Vert.x source |
|---|---|
| `core/config.py` | `Utils/Constants.java` and service constructor configuration |
| `middlewares/auth.py` | `middlewares/AuthHandler.java`, `RoleHandler.java` |
| `middlewares/metrics.py` | `middlewares/RequestMetricsHandler.java` |
| `middlewares/moviehub_access.py` | `MovieHubAccessPortalService.java` |
| `routes/admin_remote_routes.py` | `AdminService.java` |
| `routes/admin_home_routes.py` | `AdminService.java` |
| `routes/admin_routes.py` | `AdminService.java` |
| `routes/admin_settings_routes.py` | `AdminService.java`, `BuzzWatchService.java` |
| `routes/ai_routes.py` | `ParityRoutes.java`, `AiChatService.java` |
| `routes/blog_routes.py` | `ParityRoutes.java`, `BlogService.java` |
| `routes/buzzwatch_routes.py` | `ParityRoutes.java`, `BuzzWatchService.java` |
| `routes/course_routes.py` | `ParityRoutes.java`, `CourseService.java` |
| `routes/flight_routes.py` | `ParityRoutes.java`, `FlightService.java` |
| `routes/health_routes.py` | `ToolHubBaseVerticle.java` |
| `routes/leetcode_routes.py` | `ToolHubBaseVerticle.java`, `services/leetcode/*` |
| `routes/moviehub_chat_routes.py` | `MovieHubAutomationRoute.java`, `ChatAutomation.java` |
| `routes/moviehub_routes.py` | `MovieHubAutomationRoute.java`, `services/moviehubautomation/*` |
| `routes/notification_routes.py` | `ParityRoutes.java`, `NotificationService.java` |
| `routes/product_routes.py` | `ToolHubBaseVerticle.java`, `services/products/*` |
| `routes/speedtest_routes.py` | `ParityRoutes.java`, `SpeedTestService.java` |
| `routes/user_routes.py` | `ToolHubBaseVerticle.java`, `UserManagement.java` |
| `routes/yt_download_routes.py` | `ToolHubBaseVerticle.java`, `YtDownloadProxyService.java` |
| `services/ai_chats.py` | `AiChatService.java` |
| `services/ai_gateway.py` | `AiGatewayClient.java` |
| `services/auth_client.py` | `auth/ToolHubAuthClient.java` |
| `services/blog_announcements.py` | `BlogAnnouncementService.java` |
| `services/blogs.py` | `BlogService.java` |
| `services/buzzwatch.py` | `BuzzWatchService.java` |
| `services/courses.py` | `CourseService.java` |
| `services/flights.py` | `FlightService.java` |
| `services/host_admin.py` | `HostAdminClient.java` |
| `services/leetcode.py` | `services/leetcode/*` |
| `services/mail.py` | `MailService.java` |
| `services/mongo.py` | `MongoDBClient.java`, `StartupIndexes.java` |
| `services/moviehub_automation.py` | `services/moviehubautomation/*` |
| `services/notifications.py` | `NotificationService.java` |
| `services/products.py` | `services/products/*` |
| `services/redis_cache.py` | `redis/RedisCache.java` |
| `services/schedule.py` | `ToolHubSchedulerVerticle.java` |
| `services/user.py` | `UserManagement.java`, `services/user/login/*` |
| `services/yt_download.py` | `YtDownloadProxyService.java` |
| `utils/http.py`, `utils/responses.py` | Vert.x `WebClient`, `Utils/Utility.java` |
| package `__init__.py` files | No runtime Java counterpart required |

## Deliberate implementation differences

These endpoints exist and are usable, but their internal storage/provider
implementation is not a literal line-for-line Python translation:

1. BuzzWatch uses a Vert.x-native TMDB discovery and Mongo cache pipeline. The
   Python service additionally contains Rotten Tomatoes CNAPI scraping, IMDb
   public-dataset ingestion, IMDb parental-guide GraphQL calls, and more
   extensive Redis stale-response/lock layers. Those upstream-specific
   algorithms are not represented one-for-one in Java.
2. Blog image bytes are stored as Base64 Mongo documents in Java; Python uses
   GridFS. The HTTP upload/read contract is preserved, but the storage format is
   different.
3. Java currently uses the primary configured Mongo database for blog
   collections. Python can redirect blogs to a separate `BLOG_DB_NAME`.
These differences are recorded so future changes can be made intentionally and
the Java backend is not described as more exact than the evidence supports.
