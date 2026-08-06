import hmac
import os
import time
from pathlib import Path

from fastapi import Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest


REQUESTS = Counter(
    "toolhub_http_requests_total",
    "Total Tool Hub HTTP requests",
    ("method", "route", "status_code"),
)
REQUEST_DURATION = Histogram(
    "toolhub_http_request_duration_seconds",
    "Tool Hub HTTP request duration in seconds",
    ("method", "route"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
IN_PROGRESS = Gauge(
    "toolhub_http_requests_in_progress",
    "Tool Hub HTTP requests currently in progress",
    ("method",),
)
METRICS_TOKEN_PATH = Path(
    os.getenv("METRICS_TOKEN_PATH", "/run/secrets/toolhub_metrics_token")
)
IGNORED_METRIC_PATHS = {
    "/metrics",
    "/health",
}


async def metrics_middleware(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path in IGNORED_METRIC_PATHS:
        return await call_next(request)

    method = request.method
    status_code = 500
    started_at = time.perf_counter()
    IN_PROGRESS.labels(method=method).inc()
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        duration = time.perf_counter() - started_at
        route = request.scope.get("route")
        route_template = getattr(route, "path", None) or "unmatched"
        REQUESTS.labels(
            method=method,
            route=route_template,
            status_code=str(status_code),
        ).inc()
        REQUEST_DURATION.labels(method=method, route=route_template).observe(duration)
        IN_PROGRESS.labels(method=method).dec()


async def metrics_response(request: Request) -> Response:
    expected_token = (
        METRICS_TOKEN_PATH.read_text(encoding="utf-8").strip()
        if METRICS_TOKEN_PATH.is_file()
        else ""
    )
    supplied_token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not expected_token or not hmac.compare_digest(supplied_token, expected_token):
        return Response(status_code=404)
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
