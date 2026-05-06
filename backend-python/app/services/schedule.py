import asyncio
import logging
import os
from contextlib import suppress
from typing import Optional

from app.services.products import check_all_products
from app.utils.responses import success

logger = logging.getLogger("uvicorn.error")


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _interval_seconds() -> int:
    raw_value = os.getenv("PRICE_CHECK_INTERVAL_SECONDS", "1200").strip()
    try:
        interval = int(raw_value)
    except ValueError:
        logger.warning("Invalid PRICE_CHECK_INTERVAL_SECONDS=%r; using 1200", raw_value)
        return 1200
    return max(interval, 60)


def schedule_price_check():
    summary = check_all_products()
    return success({"message": "Price check scheduled successfully", **summary})


class PriceCheckScheduler:
    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._stop_event: Optional[asyncio.Event] = None

    def start(self) -> None:
        if not _env_bool("PRICE_CHECK_SCHEDULER_ENABLED", True):
            logger.info("Price check scheduler disabled")
            return
        if self._task and not self._task.done():
            return

        interval = _interval_seconds()
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run(interval))
        logger.info("Price check scheduler started. Interval: %s seconds", interval)

    async def stop(self) -> None:
        if self._stop_event:
            self._stop_event.set()
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
        self._task = None
        self._stop_event = None
        logger.info("Price check scheduler stopped")

    async def _run(self, interval: int) -> None:
        assert self._stop_event is not None
        while True:
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                return
            except asyncio.TimeoutError:
                await self._run_once()

    async def _run_once(self) -> None:
        logger.info("Starting periodic price check")
        started = asyncio.get_running_loop().time()
        try:
            summary = await asyncio.to_thread(check_all_products)
            duration_ms = round((asyncio.get_running_loop().time() - started) * 1000)
            logger.info("Periodic price check completed in %s ms: %s", duration_ms, summary)
        except Exception:
            logger.exception("Periodic price check failed")


price_check_scheduler = PriceCheckScheduler()
