# ToolHub

ToolHub is a multi-tool web app that combines product price tracking, LeetCode question management, and a private media portal workflow under one codebase.

The repository currently contains:

- A React + Vite frontend in `frontend/`
- A Java 21 + Vert.x backend in `backend/`
- Multiple scraper implementations in `scraper-v2/`, `scraper-beautifulsoup/`, and `scrapper/`

## What It Does

### 1. Price Tracker

- Save product URLs with a target price
- View tracked products in a dashboard
- Inspect historical price changes
- Trigger scheduled price checks from the backend
- Search products from the UI when a compatible scraper/search service is available

### 2. LeetCode Manager

- Add questions by URL
- Fetch and filter stored questions
- Update solving status
- Store notes per question
- Delete questions you no longer want to track

### 3. MovieHub

- Search for movies and shows
- Create media requests
- Review your own requests
- View available media
- Inspect active and completed downloads
- Gate access through a request/approval flow
- Manage access requests and users as an admin
- Open the external streaming portal after access is granted

### 4. CinePilot / MovieHub Chat

- AI-assisted chat for MovieHub actions
- Supports request-oriented flows such as:
  - downloading media
  - raising access/request actions
  - checking download status
  - checking whether media already exists

### 5. YouTube Download Proxy

- Fetch downloadable format options for a URL
- Queue downloads
- Track status, including SSE status streaming
- Browse and remove library items from the linked media library
- Admin-only controls for starting and managing downloads

## Repository Layout

```text
tool-hub/
├── backend/                  # Java 21 Vert.x API server
├── frontend/                 # React + Vite + TypeScript UI
├── scraper-v2/               # FastAPI + Playwright scraper/search service
├── scraper-beautifulsoup/    # FastAPI scraper for direct product scraping
├── scrapper/                 # Legacy Flask + Selenium scraper
├── scripts/                  # Utility scripts
└── docker-compose.yml
```

## Architecture

### Frontend

- React 18
- Vite
- TypeScript
- Tailwind CSS
- React Router

Main routes:

- `/` landing page
- `/pricetracker`
- `/pricetracker/dashboard`
- `/leetcode`
- `/moviehub/*`
- `/moviehub/yt`
- `/login`
- `/register`

### Backend

- Java 21
- Vert.x
- MongoDB via `vertx-mongo-client`
- JWT access + refresh tokens
- Optional Google login
- SendGrid/mail integration
- OpenAI-backed MovieHub chat integration
- Radarr / Sonarr / Jellyfin integrations

Backend base URL prefix:

- Public endpoints: `/v2/...`
- Protected endpoints: `/v2/...` with bearer auth
- Admin endpoints: `/v2/admin/...`

Health endpoint:

- `GET /health`

### Scrapers

There are multiple scraper services in this repo:

- `scraper-v2/`
  - FastAPI + Playwright
  - Supports `/search`
  - Supports `/scrape/product`
  - This is the service shape the frontend search flow expects

- `scraper-beautifulsoup/`
  - FastAPI + requests/BeautifulSoup
  - Supports `/scrape/product`
  - This is the scraper currently wired into `docker-compose.yml`

- `scrapper/`
  - Legacy Flask + Selenium implementation
  - Kept in the repo, but appears to be older code

## Auth Model

ToolHub currently uses:

- Access tokens for authenticated API requests
- Refresh tokens issued and stored server-side
- Base email/password login
- Optional Google login when Google client configuration is present

Frontend auth calls:

- `POST /v2/register`
- `POST /v2/login`
- `POST /v2/token/refresh`

## Key Backend Endpoints

This section reflects the routes registered in `backend/src/main/java/com/toolhub/verticles/ToolHubBaseVerticle.java`.

### Auth

- `POST /v2/register`
- `POST /v2/login`
- `POST /v2/token/refresh`

### Price Tracker

- `POST /v2/save-product`
- `GET /v2/products`
- `POST /v2/pricehistory`
- `POST /v2/delete`
- `GET /v2/schedule`

### LeetCode

- `POST /v2/leetcode/add`
- `GET /v2/leetcode/questions`
- `POST /v2/leetcode/update-status`
- `POST /v2/leetcode/update-notes`
- `POST /v2/leetcode/delete`

### MovieHub

- `GET /v2/moviehub/access/me`
- `GET /v2/moviehub/access/user`
- `POST /v2/moviehub/access/request`
- `POST /v2/moviehub/access/resend-password`
- `POST /v2/moviehub/access/confirm-password-reset`
- `GET /v2/moviehub/search`
- `GET /v2/moviehub/available`
- `GET /v2/moviehub/downloads`
- `GET /v2/moviehub/completedDownloads`
- `GET /v2/moviehub/reconcile-downloads`
- `POST /v2/moviehub/requests`
- `GET /v2/moviehub/requests`
- `POST /v2/moviehub/requests/:requestId/delete`
- `POST /v2/moviehub/chat/completions`

### MovieHub Admin

- `GET /v2/admin/moviehub/requests`
- `POST /v2/admin/moviehub/requests/:requestId/approve`
- `GET /v2/admin/moviehub/access/requests`
- `POST /v2/admin/moviehub/access/requests/:requestId/approve`
- `POST /v2/admin/moviehub/access/requests/:requestId/reject`
- `GET /v2/admin/moviehub/access/users`
- `DELETE /v2/admin/moviehub/access/users/:mappingId`
- `POST /v2/admin/moviehub/chat/completions`

### YouTube Download Proxy

- `POST /v2/yt/formats`
- `POST /v2/yt/download/cronStart`
- `GET /v2/yt/download/cronStart`
- `POST /v2/yt/download/check`
- `GET /v2/yt/download/check`
- `GET /v2/yt/download/status/stream/:videoId`

Admin-only:

- `POST /v2/admin/yt/download/start`
- `POST /v2/admin/yt/download/add`
- `GET /v2/admin/yt/download/requests`
- `DELETE /v2/admin/yt/download/requests/:requestId`
- `GET /v2/admin/yt/download/status/:videoId`
- `GET /v2/admin/yt/download/status/stream/:videoId`
- `GET /v2/admin/yt/library/items`
- `DELETE /v2/admin/yt/library/items/:itemId`

## Environment Variables

Do not commit real secrets. The backend Dockerfile copies either `.env.dev` or `.env.prod` into the image based on `ENVIRONMENT`.

### Backend

The current backend env files include these keys:

```bash
ENVIRONMENT=
JWT_SECRET=
DB_URL=
SENDGRID_API_KEY=
MAIL_API_KEY=
SCRAPPER_URL=
SENDER_EMAIL=
SCRAPPER_TAB_URL=
RADARR_API_URL=
SONARR_API_URL=
RADARR_API_KEY=
SONARR_API_KEY=
OPEN_AI_URL=
OPEN_AI_API_KEY=
AI_MODEL=
MOVIEHUB_ACCESS_SECRET=
JELLYFIN_BASE_URL=
JELLYFIN_PUBLIC_URL=
JELLYFIN_API_KEY=
JELLYFIN_LAUNCHER_URL=
YT_DOWNLOAD_API_BASE_URL=
YT_DOWNLOAD_SERVER_PATH=
YT_DOWNLOAD_SONGS_PATH=
YT_JELLYFIN_ID=
GOOGLE_CLIENT_ID=
REFRESH_TOKEN_TTL_DAYS=
```

### Frontend

```bash
VITE_BASE_BACKEND_URL=
VITE_BASE_SCRAPPER_URL=
VITE_GOOGLE_CLIENT_ID=
VITE_BASE_SCRAPPER_TAB_URL=
```

## Local Development

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Typical local URL:

- `http://localhost:5173`

### Backend

```bash
cd backend
./gradlew run
```

Backend listens on:

- `http://localhost:8080`

### Scraper V2

Use this if you want the frontend product search flow to work as implemented.

```bash
cd scraper-v2
pip install -r requirements.txt
python app.py
```

Default URL:

- `http://localhost:8000`

### BeautifulSoup Scraper

```bash
cd scraper-beautifulsoup
pip install -r requirements.txt
uvicorn scrape:app --host 0.0.0.0 --port 8001 --reload
```

Default URL:

- `http://localhost:8001`

### Legacy Scrapper

```bash
cd scrapper
pip install -r requirements.txt
python app.py
```

## Docker Compose

Current `docker-compose.yml` starts:

- `frontend`
- `backend`
- `scraper-beautifulsoup`

Run it with:

```bash
docker compose up --build
```

Current port mappings:

- frontend: `3000:3000`
- backend: `8080:8080`
- scraper-beautifulsoup: `8001:8001`

Important note:

- The frontend search experience expects a scraper service exposing `/search`
- `docker-compose.yml` currently starts `scraper-beautifulsoup`, which does not expose `/search`
- If you want product search from the UI, point `VITE_BASE_SCRAPPER_URL` at a compatible service such as `scraper-v2`

## Notes on Current State

- `backend/src/main/java/com/toolhub/routes/ProtectedRoute.java` is currently empty and does not represent the real route registration
- The live backend routes are defined in `ToolHubBaseVerticle`
- The repo includes generated/build artifacts and local IDE files
- The app has evolved beyond the original README; MovieHub and YouTube-related flows are now a major part of the project

## Build / Verification Commands

Frontend:

```bash
cd frontend
npm run build
```

Backend:

```bash
cd backend
./gradlew build
```

If you are validating containerized flows, also verify the env files used by the Dockerfiles match the services you intend to run.
