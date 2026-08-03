# ToolHub Vert.x backend

This directory is the Java 21 / Vert.x 4 port of `backend-python`.
It began from ToolHub's existing production Vert.x backend and preserves its
package layout, models, Gradle wrapper, Docker build, and existing tests. The
Python-only route families were then added under the same asynchronous Vert.x
handler/service architecture.

See `PORTING_STATUS.md` for the file-by-file source map, verification counts,
and explicitly recorded implementation-level differences.

## Build and test

```bash
./gradlew clean test shadowJar
```

If Java 21 is not installed locally, the Dockerfile or a Java 21 Gradle image
can build the project without installing a host JDK.

No `.env` file, secret, backup, IDE directory, or prior build output was copied
from the live ToolHub checkout. Runtime configuration continues to use the
same environment-variable names as the Python backend.

## Structure and parity map

| Python area | Vert.x counterpart |
|---|---|
| `core/config.py` | `Utils/Constants.java`, constructor configuration via `Dotenv` |
| `middlewares/auth.py` | `middlewares/AuthHandler.java`, `RoleHandler.java` |
| `middlewares/metrics.py` | `middlewares/RequestMetricsHandler.java` |
| `middlewares/moviehub_access.py` | `MovieHubAccessPortalService.handleAccessGuard` |
| `routes/*` | `ToolHubBaseVerticle`, `MovieHubAutomationRoute`, and `ParityRoutes` |
| `services/ai_chats.py`, `ai_gateway.py` | `services/ai/AiChatService.java`, `AiGatewayClient.java` |
| `services/auth_client.py`, `user.py` | `services/user/*`, `services/jwt/*` |
| `services/blogs.py`, `blog_announcements.py` | `services/blogs/BlogService.java` |
| `services/buzzwatch.py` | `services/buzzwatch/BuzzWatchService.java` |
| `services/courses.py` | `services/courses/CourseService.java` |
| `services/flights.py` | `services/flights/FlightService.java` |
| `services/host_admin.py` | `services/admin/HostAdminClient.java` |
| `services/leetcode.py` | `services/leetcode/*` |
| `services/mail.py`, `notifications.py` | `services/alerts/MailService.java`, `services/notifications/NotificationService.java` |
| `services/mongo.py` | `services/mongo/MongoDBClient.java` |
| `services/moviehub_automation.py` | `services/moviehubautomation/*` |
| `services/products.py` | `services/products/*`, `ProductSearchService.java` |
| `services/redis_cache.py` | `services/redis/RedisCache.java` and cached search/flight paths |
| `services/schedule.py` | `ToolHubSchedulerVerticle.java` (all seven aligned, non-overlapping jobs) |
| `services/yt_download.py` | `services/ytdownload/YtDownloadProxyService.java` |
| `utils/http.py`, `responses.py` | Vert.x `WebClient` plus `Utils/Utility.java` |
| `seed/**` | `src/main/resources/seed/**` (byte-for-byte copies) |

## Response and security compatibility

- Success payloads retain the `{"response": ...}` envelope where the Python
  route uses it; error payloads retain `{"error": ...}`.
- Access tokens may arrive through the Bearer header or the configured HTTP-only
  access cookie, matching Python behavior.
- Public blog, search, flight-provider, speed-test, notification-ingest, cron,
  and health boundaries remain explicit; admin handlers remain role-gated.
- AI gateway requests retain the provider-neutral HMAC canonical form, bounded
  context/message sizes, background completion, and Mongo-owned chat history.
- Seed assets are classpath resources and are upserted into Mongo on startup.

## Parity checks

Run the route audit from this directory:

```bash
python3 scripts/verify_route_parity.py
```

`test` runs isolated unit tests. `integrationTest` deploys the complete Vert.x
application and therefore requires the configured MongoDB and dependent ToolHub
services:

```bash
./gradlew test
./gradlew integrationTest
```
