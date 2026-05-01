# ToolHub Python Backend

Python/FastAPI recreation of the existing ToolHub backend endpoints.

## Structure

- `app/main.py` bootstraps FastAPI, middleware, and route registration.
- `app/routes/` groups endpoint handlers by feature area.
- `app/middlewares/` contains auth and MovieHub access checks.
- `app/services/` contains Mongo, mail, and MovieHub automation services.
- `app/core/` and `app/utils/` contain shared configuration and response helpers.

## Run locally

```bash
cd backend-python
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

The app reads the same environment variable names as the Java backend, including
`DB_URL`, `JWT_SECRET`, Radarr/Sonarr/Jellyfin settings, and YouTube downloader
settings.
