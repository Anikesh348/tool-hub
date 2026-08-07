# ToolHub

ToolHub is a comprehensive microservice-based web application that provides multiple productivity and tracking tools. Currently featuring price tracking and LeetCode problem management, with a modern, extensible architecture that supports adding new features easily.

## Features

### Authentication & User Management

- User registration and authentication with JWT tokens
- Secure password hashing and validation

### Price Drop Tracker

- Track products from multiple e-commerce platforms
- Set target prices and receive alerts when prices drop
- Automated price checks (hourly scheduling)
- Email notifications via SendGrid
- Price history visualization with charts
- Multi-platform scraping support (Amazon, Flipkart, etc.)

### LeetCode Problem Manager

- Add and track LeetCode problems
- Manage problem status (solved/unsolved)
- Organize by difficulty level and tags
- Add personal notes and comments to problems
- Filter and search problems efficiently
- Track your learning progress

### Additional Features

- Dark/Light theme toggle
- Responsive modern UI
- Real-time notifications
- Batch processing for scheduled tasks

## Architecture

- **Frontend**: React 18 + Vite + Tailwind CSS with TypeScript. Modern, responsive UI for all tools. Located in the `frontend/` folder.
- **Backend**: Java 21 application built with [Vert.x](https://vertx.io/). Handles REST APIs, authentication, product/question management, scheduling, email alerts, and batch processing. Located in the `backend/` folder.
- **Scraper Services**:
  - `scraper-v2/`: Python Flask service for scraping Amazon, Flipkart, etc. Modular platform support.
  - `scrapper/`: Legacy Python Flask service for scraping Amazon (uses Selenium).
- **Docker Compose**: Orchestrates all services for local development.

## Prerequisites

- Docker and Docker Compose
- Node.js (for frontend development)
- Java 21 (for backend development)
- Python 3.8+ (for scraper services)
- MongoDB instance
- SendGrid API key

## Configuration

Create an `.env` file inside the `backend` directory with:

```bash
DB_URL=<mongodb-connection-string>
JWT_SECRET=<jwt-secret>
SENDGRID_API_KEY=<sendgrid-api-key>
```

## Running the Application

Build and run all services with Docker Compose:

```bash
docker compose up --build
```

- Backend: `http://localhost:8080`
- Frontend: `http://localhost:5173`
- Scraper-v2: `http://localhost:8120`
- Scrapper: `http://localhost:8110`

## Frontend Usage

### Landing Page

1. Open `http://localhost:5173` in your browser.

### Price Tracker

2. Register or log in.
3. Navigate to "Price Tracker" or click the price tracker card on the dashboard.
4. Add product URLs and set target prices.
5. View tracked products and price history with charts.
6. Receive email alerts when prices drop to your target.

### LeetCode Manager

2. Register or log in.
3. Navigate to "LeetCode" or click the LeetCode card on the dashboard.
4. Add LeetCode problem URLs with difficulty and tags.
5. Filter problems by difficulty, status, or tags.
6. Add notes to problems for your personal learning.
7. Mark problems as solved/unsolved to track progress.

## API Endpoints (Backend)

### Authentication

- `POST /api/register` – Register a new user. Requires `userName`, `email`, and `password`.
- `POST /api/login` – Authenticate and receive a JWT token.

### Price Tracking

- `POST /api/protected/save-product` – Save a product URL with a target price. Requires Authorization header with bearer token.

Example payload:

```json
{
  "productUrl": "https://www.amazon.com/example",
  "targetPrice": "500"
}
```

- `GET /api/protected/get-products` – Retrieve all tracked products for the authenticated user.
- `DELETE /api/protected/delete-product/{productId}` – Remove a product from tracking.
- `GET /api/protected/price-history/{productId}` – Get price history for a specific product.

### LeetCode Problem Management

- `POST /api/protected/add-question` – Add a new LeetCode problem. Requires `questionTitle`, `difficulty`, `tags`, and `url`.

Example payload:

```json
{
  "questionTitle": "Two Sum",
  "difficulty": "Easy",
  "tags": ["Array", "Hash Table"],
  "url": "https://leetcode.com/problems/two-sum/"
}
```

- `GET /api/protected/get-questions` – Retrieve all tracked problems for the authenticated user.
- `PUT /api/protected/update-question/{questionId}` – Update problem status or notes.
- `DELETE /api/protected/delete-question/{questionId}` – Remove a problem from tracking.
- `GET /api/protected/get-questions/filter` – Filter problems by difficulty, solved status, or tags.

## Scraper Services

### Scraper-v2

- `POST /scrape` – Expects `{ "urls": ["<product-url>"] }`. Returns price and title for each URL.
- Supports Amazon, Flipkart, and more (see `platforms/` folder).

### Scrapper (Legacy)

- `POST /scrape` – Expects `{ "urls": ["<amazon-url>"] }`. Returns price and title.

## Application Logic

### Price Tracking

- Scheduler queries all tracked products every hour.
- Stores price history and sends email alerts when price is within 10% of target price.
- Product is removed from tracking after alert is sent.

### LeetCode Problem Management

- Problems are stored with metadata (title, difficulty, tags, status).
- Users can update problem status and add personal notes.
- Efficient filtering by difficulty level and tag combinations.
- Search functionality for quick problem lookup.

## Development

Start each service individually for development:

### Frontend Development

```bash
cd frontend && npm install && npm run dev
```

### Backend Development

```bash
cd backend && ./gradlew run
```

### Scraper Services Development

```bash
# Scraper-v2 (recommended)
cd scraper-v2 && pip install -r requirements.txt && python app.py

# Legacy Scrapper
cd scrapper && pip install -r requirements.txt && python app.py
```

## Notes

- No production database credentials are included. Supply valid environment variables and run MongoDB separately or use a managed service.
- For production deployment, review and update `fly.toml` and Dockerfiles as needed.
- The project is designed to be extensible. New tools/features can be added by:
  - Creating new components in the frontend
  - Adding new service modules in the backend
  - Registering new API routes in the main Vert.x application
  - Following the existing batch processor pattern for scheduled tasks

---

Contributions and issues are welcome!
