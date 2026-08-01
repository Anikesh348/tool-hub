# ToolHub

ToolHub is a self-hosted portal for personal productivity, media, monitoring, publishing, and homelab administration. It combines public pages, authenticated user tools, and tightly restricted admin controls behind a React frontend and a FastAPI backend.

## What ToolHub includes

### Public and authenticated tools

- **Price Tracker** — product search, saved products, price history, scheduled checks, and alerts
- **LeetCode Manager** — questions, completion state, notes, and progress tracking
- **Flight Tracker** — airport/place lookup, saved watches, manual checks, and history
- **BuzzWatch** — movie and TV discovery, preferences, people/credits, and media requests
- **MovieHub** — search, request, availability, playback, download status, and access requests
- **Speed Test** — browser-to-server latency, download, and upload measurements
- **Blogs** — public Markdown articles, term summaries, reactions, comments, and versioned publishing
- **Global notifications** — user notifications and authenticated event ingestion
- **YouTube downloads** — format discovery, download requests, progress streaming, and library management

### Administration

Admin-only routes and screens provide:

- Blog editing, versioning, publishing, assets, and analytics
- Daily Ubuntu and Home Assistant log digests
- System metrics, API route analytics, and uptime monitoring
- Fleet speed tests and operational status/audit views
- Home Assistant safeguard controls and Raspberry Pi remote actions
- MovieHub approvals, access management, download controls, and media deletion
- Embedded Beszel, Netdata, Gatus, file-management, Docker, AI, and media-console tools
- ToolHub cache clearing, refresh actions, service restart, and narrowly scoped host controls

The frontend also supports responsive navigation, light/dark themes, Google sign-in, installable PWA metadata, and service-worker caching.

## Architecture

| Component | Technology | Purpose |
|---|---|---|
| `frontend/` | React, TypeScript, Vite, Tailwind CSS, Nginx | Web UI, static blog entry pages, API proxying, and authenticated admin-tool proxying |
| `backend-python/` | Python 3.12, FastAPI, Uvicorn | Active API, authorization, tools, schedulers, blogs, notifications, media workflows, and Prometheus metrics |
| `toolhub-auth` | Shared Google auth service | Login/session lifecycle and token validation; built from the sibling `google-auth-common` checkout |
| `redis` | Redis 7 | Caching and transient BuzzWatch state |
| MongoDB | External service | Users, products, blogs, notifications, requests, and other persistent application data |
| `scraper-beautifulsoup/` | Python, FastAPI, Beautiful Soup | Product search and scraping |
| `docker-compose.yml` | Docker Compose | Main service orchestration and health dependencies |

The older `backend/`, `scraper-v2/`, and `scrapper/` directories are retained for historical or compatibility work. The main Compose stack uses `backend-python/` and `scraper-beautifulsoup/`.

## Repository layout

```text
tool-hub/
├── backend-python/          # Active FastAPI application
│   └── app/
│       ├── middlewares/     # Auth, metrics, and MovieHub access gates
│       ├── routes/          # HTTP route modules
│       ├── services/        # Domain and integration logic
│       └── seed/            # Seeded blog content
├── frontend/                # React application and Nginx proxy configuration
├── scraper-beautifulsoup/   # Active product scraper
├── dev-content/             # Draft/source blog content
├── docker-compose.yml       # Main stack
└── docker-compose.dev.yml   # Isolated preview stack for prebuilt dev images
```

## API overview

The OpenAPI document at `/openapi.json` is the authoritative endpoint reference. Major route groups include:

| Prefix | Purpose |
|---|---|
| `/v2/register`, `/v2/login`, `/v2/session` | Registration and session lifecycle |
| `/v2/products`, `/v2/save-product`, `/v2/pricehistory` | Product tracking |
| `/v2/leetcode` | LeetCode questions, status, and notes |
| `/v2/flights` | Flight providers, places, watches, and history |
| `/v2/buzzwatch` | Discovery, preferences, details, and requests |
| `/v2/moviehub` | Media search, requests, playback, downloads, chat, and access |
| `/v2/speedtest` | Speed-test sessions and transfer probes |
| `/v2/blogs` | Public articles, comments, reactions, and analytics events |
| `/v2/notifications` | Notification reads, events, and dismissal |
| `/v2/yt` | YouTube format and download workflows |
| `/v2/admin` | Admin-only controls, analytics, approvals, settings, and embedded-tool authorization |
| `/health` | Container health check |
| `/metrics` | Prometheus metrics; protect this route in deployed environments |

Authentication and authorization requirements vary by route. Do not treat a route merely being reachable through the backend as permission to expose it publicly; `/v2/admin/*`, host controls, media administration, and metrics require the intended authenticated proxy and secret boundaries.

## Production notes

- The backend health check is `/health`; the frontend waits for a healthy backend.
- Redis persistence uses an append-only named volume.
- Prometheus metrics are available at `/metrics` and are expected to sit behind the deployment's metrics-token boundary.
- Admin embeds rely on Nginx authorization subrequests and private upstream services.
- Blog seed/index setup, notification indexes, and the price-check scheduler run during FastAPI startup.
- `docker-compose.dev.yml` expects prebuilt dev images plus the existing production network and is not a standalone first-run environment.
