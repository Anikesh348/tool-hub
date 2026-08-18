import asyncio
import logging
import os
import time
from contextlib import suppress
from typing import Callable, List, Optional

from app.services.flights import check_all_flight_watches
from app.services.products import check_all_products
from app.utils.responses import success

logger = logging.getLogger("uvicorn.error")


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _interval_seconds(env_name: str, default: int, minimum: int = 60) -> int:
    raw_value = os.getenv(env_name, str(default)).strip()
    try:
        interval = int(raw_value)
    except ValueError:
        logger.warning("Invalid %s=%r; using %s", env_name, raw_value, default)
        return default
    return max(interval, minimum)


def _seconds_until_next_boundary(interval: int) -> float:
    now = time.time()
    next_run = ((int(now) // interval) + 1) * interval
    return max(0.0, next_run - now)


def _result_summary(result) -> str:
    if hasattr(result, "status_code"):
        return f"status_code={getattr(result, 'status_code', 'unknown')}"
    return str(result)


def schedule_price_check():
    summary = check_all_products()
    return success({"message": "Price check scheduled successfully", **summary})


class FixedIntervalJob:
    def __init__(self, name: str, interval: int, handler: Callable[[], object]) -> None:
        self.name = name
        self.interval = interval
        self.handler = handler
        self._task: Optional[asyncio.Task] = None
        self._stop_event: Optional[asyncio.Event] = None
        self._running = False

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run())
        logger.info("%s scheduler started. Interval: %s seconds", self.name, self.interval)

    async def stop(self) -> None:
        if self._stop_event:
            self._stop_event.set()
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
        self._task = None
        self._stop_event = None
        logger.info("%s scheduler stopped", self.name)

    async def _run(self) -> None:
        assert self._stop_event is not None
        while True:
            delay = _seconds_until_next_boundary(self.interval)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
                return
            except asyncio.TimeoutError:
                await self._run_once()

    async def _run_once(self) -> None:
        if self._running:
            logger.warning("%s scheduler skipped run because previous run is still active", self.name)
            return
        self._running = True
        started = asyncio.get_running_loop().time()
        logger.info("Starting scheduled job: %s", self.name)
        try:
            result = await asyncio.to_thread(self.handler)
            duration_ms = round((asyncio.get_running_loop().time() - started) * 1000)
            logger.info("Scheduled job completed: %s in %s ms: %s", self.name, duration_ms, _result_summary(result))
        except Exception:
            logger.exception("Scheduled job failed: %s", self.name)
        finally:
            self._running = False


class ToolHubScheduler:
    def __init__(self) -> None:
        self._jobs: List[FixedIntervalJob] = []

    def start(self) -> None:
        if not _env_bool("TOOLHUB_SCHEDULER_ENABLED", True):
            logger.info("ToolHub scheduler disabled")
            return
        if self._jobs:
            return

        from app.routes.moviehub_routes import moviehub_reconcile
        from app.services.activity import run_activity_rollup
        from app.services.buzzwatch import refresh_buzzwatch_items, warm_buzzwatch_year_cache
        from app.services.location import run_location_rollup
        from app.services.yt_download import check_downloads, start_download

        self._jobs = [
            FixedIntervalJob(
                "price-check",
                _interval_seconds("PRICE_CHECK_INTERVAL_SECONDS", 1200),
                check_all_products,
            ),
            FixedIntervalJob(
                "flight-price-check",
                _interval_seconds("FLIGHT_CHECK_INTERVAL_SECONDS", 60 * 60),
                check_all_flight_watches,
            ),
            FixedIntervalJob(
                "moviehub-reconcile-downloads",
                _interval_seconds("MOVIEHUB_RECONCILE_INTERVAL_SECONDS", 15 * 60),
                moviehub_reconcile,
            ),
            FixedIntervalJob(
                "buzzwatch-refresh",
                _interval_seconds("BUZZWATCH_REFRESH_INTERVAL_SECONDS", 6 * 60 * 60),
                refresh_buzzwatch_items,
            ),
            FixedIntervalJob(
                "buzzwatch-year-warm",
                _interval_seconds("BUZZWATCH_YEAR_WARM_INTERVAL_SECONDS", 24 * 60 * 60),
                warm_buzzwatch_year_cache,
            ),
            FixedIntervalJob(
                "yt-download-check",
                _interval_seconds("YT_DOWNLOAD_CHECK_INTERVAL_SECONDS", 5 * 60),
                check_downloads,
            ),
            FixedIntervalJob(
                "yt-download-start",
                _interval_seconds("YT_DOWNLOAD_START_INTERVAL_SECONDS", 60),
                start_download,
            ),
            FixedIntervalJob(
                "activity-rollup",
                _interval_seconds("ACTIVITY_ROLLUP_INTERVAL_SECONDS", 10 * 60),
                run_activity_rollup,
            ),
            FixedIntervalJob(
                "location-rollup",
                _interval_seconds("LOCATION_ROLLUP_INTERVAL_SECONDS", 5 * 60),
                run_location_rollup,
            ),
        ]
        for job in self._jobs:
            job.start()

    async def stop(self) -> None:
        jobs = self._jobs
        self._jobs = []
        await asyncio.gather(*(job.stop() for job in jobs), return_exceptions=True)


price_check_scheduler = ToolHubScheduler()
