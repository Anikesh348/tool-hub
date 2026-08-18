"""User-defined scheduled jobs created from the Scheduled Jobs AI bubble.

Deliberately kept separate from the fixed, host-level opsched/systemd jobs
(scheduler_jobs.py / scheduler_routes.py's VALID_SLUGS): those are things
deployed by hand onto ubuntu-purva as real systemd timer units. Jobs created
here never touch the host - they live in Mongo and run on an in-process
asyncio loop inside this backend, the same way schedule.py's price-check
scheduler already does. This keeps the AI-authored path's blast radius
contained to this container instead of teaching an AI chatbot to mint new
root-owned systemd units.

Two kinds of job:
  - "script": runs one of a small fixed allowlist of safe, parameterized
    actions (SCRIPT_ACTIONS below). No freeform code, ever.
  - "smart": stores a natural-language prompt and, on schedule, sends it to
    the operator gateway (operator_gateway.py) - the exact same mechanism
    opsched's github_pr_publish job already uses. This is real, unattended
    administrative capability, which is why job creation always requires an
    explicit user confirmation (see scheduler_ai.py) before a job lands here.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import requests
from croniter import croniter
from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING

from app.services.ai_gateway import AIGatewayError
from app.services.flights import check_all_flight_watches
from app.services.mongo import col
from app.services.operator_gateway import run_operator_prompt
from app.services.products import check_all_products
from app.services.scheduler_history import record_run
from app.utils.responses import jsonable, now_iso

logger = logging.getLogger("uvicorn.error")

JOBS = "scheduled_user_jobs"
IST = ZoneInfo("Asia/Kolkata")

MAX_NAME = 80
MAX_DESCRIPTION = 300
MAX_PROMPT = 4000
MAX_URL = 500
TICK_SECONDS = 60


def _http_ping(params: Dict[str, Any]) -> str:
    url = str(params.get("url") or "").strip()
    response = requests.get(url, timeout=20)
    response.raise_for_status()
    return f"{url} responded {response.status_code}"


def _price_check(_: Dict[str, Any]) -> str:
    summary = check_all_products()
    return f"checked {summary.get('checked', 0)}/{summary.get('total', 0)} tracked products"


def _flight_check(_: Dict[str, Any]) -> str:
    summary = check_all_flight_watches()
    return f"checked {summary.get('checked', 0)}/{summary.get('total', 0)} tracked flight watches"


# The complete allowlist of what a "script" job can do. Nothing outside this
# dict is ever reachable from an AI-authored job spec - see validate_job_spec.
SCRIPT_ACTIONS: Dict[str, Dict[str, Any]] = {
    "price_check": {
        "label": "Re-check tracked product prices",
        "params": [],
        "handler": _price_check,
    },
    "flight_check": {
        "label": "Re-check tracked flight-price watches",
        "params": [],
        "handler": _flight_check,
    },
    "http_ping": {
        "label": "Ping a URL and alert if it doesn't respond with success",
        "params": ["url"],
        "handler": _http_ping,
    },
}


def ensure_user_scheduler_indexes() -> None:
    jobs = col(JOBS)
    jobs.create_index([("id", ASCENDING)], unique=True)
    jobs.create_index([("ownerId", ASCENDING), ("updatedAt", DESCENDING)])


def _history_key(job_id: str) -> str:
    return f"user-{job_id[:8]}"


def _public_job(document: Dict[str, Any]) -> Dict[str, Any]:
    return jsonable({
        "id": document["id"],
        "name": document["name"],
        "description": document.get("description", ""),
        "kind": document["kind"],
        "cron": document["cron"],
        "humanReadable": document.get("humanReadable", ""),
        "scriptAction": document.get("scriptAction"),
        "scriptParams": document.get("scriptParams"),
        "prompt": document.get("prompt"),
        "enabled": document.get("enabled", True),
        "historyKey": _history_key(document["id"]),
        "lastRunAt": document.get("lastRunAt"),
        "lastRunStatus": document.get("lastRunStatus"),
        "createdAt": document["createdAt"],
        "updatedAt": document["updatedAt"],
    })


def validate_job_spec(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Normalizes and validates a proposed job spec. Raises ValueError with a
    human-readable message on anything invalid. Never trusts the AI's output
    blindly - this runs both when previewing a chat proposal and again (from
    scratch, against the client-submitted body) when actually creating the
    job, so a tampered or stale confirm request can't sneak past it either."""
    if not isinstance(payload, dict):
        raise ValueError("Job spec must be an object")

    name = str(payload.get("name") or "").strip()
    if not name or len(name) > MAX_NAME:
        raise ValueError(f"name must be 1 to {MAX_NAME} characters")

    description = str(payload.get("description") or "").strip()[:MAX_DESCRIPTION]

    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in {"script", "smart"}:
        raise ValueError("kind must be 'script' or 'smart'")

    schedule = payload.get("schedule")
    cron = ""
    human_readable = ""
    if isinstance(schedule, dict):
        cron = str(schedule.get("cron") or "").strip()
        human_readable = str(schedule.get("humanReadable") or "").strip()[:160]
    elif isinstance(payload.get("cron"), str):
        cron = str(payload.get("cron")).strip()
        human_readable = str(payload.get("humanReadable") or "").strip()[:160]
    if not cron:
        raise ValueError("A cron schedule is required")
    try:
        croniter(cron, datetime.now(IST))
    except (ValueError, KeyError) as exc:
        raise ValueError(f"'{cron}' is not a valid 5-field cron expression") from exc

    result: Dict[str, Any] = {
        "name": name,
        "description": description,
        "kind": kind,
        "cron": cron,
        "humanReadable": human_readable,
        "scriptAction": None,
        "scriptParams": None,
        "prompt": None,
    }

    if kind == "script":
        action = str(payload.get("scriptAction") or "").strip()
        if action not in SCRIPT_ACTIONS:
            allowed = ", ".join(sorted(SCRIPT_ACTIONS))
            raise ValueError(f"scriptAction must be one of: {allowed}")
        raw_params = payload.get("scriptParams")
        params = raw_params if isinstance(raw_params, dict) else {}
        required = SCRIPT_ACTIONS[action]["params"]
        clean_params: Dict[str, Any] = {}
        for field in required:
            value = str(params.get(field) or "").strip()
            if not value:
                raise ValueError(f"scriptParams.{field} is required for {action}")
            if field == "url":
                if len(value) > MAX_URL or not (value.startswith("http://") or value.startswith("https://")):
                    raise ValueError("scriptParams.url must be an http(s) URL")
            clean_params[field] = value
        result["scriptAction"] = action
        result["scriptParams"] = clean_params
    else:
        prompt = str(payload.get("prompt") or "").strip()
        if not prompt or len(prompt) > MAX_PROMPT:
            raise ValueError(f"prompt must be 1 to {MAX_PROMPT} characters")
        result["prompt"] = prompt

    return result


def create_job(
    owner_id: str,
    spec: Dict[str, Any],
    *,
    source_chat_id: Optional[str] = None,
    source_message_id: Optional[str] = None,
) -> Dict[str, Any]:
    clean = validate_job_spec(spec)
    now = now_iso()
    document = {
        "id": str(uuid.uuid4()),
        "ownerId": owner_id,
        **clean,
        "enabled": True,
        "lastRunAt": None,
        "lastRunStatus": None,
        "lastFiredMinute": None,
        "sourceChatId": source_chat_id,
        "sourceMessageId": source_message_id,
        "createdAt": now,
        "updatedAt": now,
    }
    col(JOBS).insert_one(document)
    return _public_job(document)


def list_jobs(owner_id: str) -> List[Dict[str, Any]]:
    records = col(JOBS).find({"ownerId": owner_id}).sort("createdAt", DESCENDING)
    return [_public_job(record) for record in records]


def _owned_job(owner_id: str, job_id: str) -> Dict[str, Any]:
    document = col(JOBS).find_one({"id": job_id, "ownerId": owner_id})
    if document is None:
        raise HTTPException(status_code=404, detail="Scheduled job not found")
    return document


def set_enabled(owner_id: str, job_id: str, enabled: bool) -> Dict[str, Any]:
    document = _owned_job(owner_id, job_id)
    col(JOBS).update_one(
        {"id": document["id"]}, {"$set": {"enabled": enabled, "updatedAt": now_iso()}}
    )
    document["enabled"] = enabled
    return _public_job(document)


def delete_job(owner_id: str, job_id: str) -> None:
    _owned_job(owner_id, job_id)
    col(JOBS).delete_one({"id": job_id, "ownerId": owner_id})


def _run_job_sync(document: Dict[str, Any]) -> tuple[str, str, Optional[str]]:
    """Runs one due job. Synchronous - always invoked via to_thread. Returns
    (status, summary, provider)."""
    kind = document["kind"]
    if kind == "script":
        action = SCRIPT_ACTIONS.get(document.get("scriptAction") or "")
        if action is None:
            return "failure", f"Unknown script action {document.get('scriptAction')!r}", None
        try:
            summary = action["handler"](document.get("scriptParams") or {})
            return "success", str(summary)[:2000], None
        except Exception as exc:  # noqa: BLE001 - report and keep the loop alive
            return "failure", f"{type(exc).__name__}: {exc}"[:2000], None

    prompt = document.get("prompt") or ""
    try:
        provider, output = run_operator_prompt(prompt, timeout=1800)
        return "success", output[:2000], provider
    except AIGatewayError as exc:
        return "failure", f"Operator request failed ({exc.code}): {exc}"[:2000], exc.provider or None


class UserJobScheduler:
    """Ticks every TICK_SECONDS, matches enabled jobs' cron expressions
    against the current IST minute (mirrors the IST convention the rest of
    this app already uses for schedules - see log_digest.py / formatIst.ts),
    and runs due jobs on a dedicated thread pool so a slow "smart" job
    (up to 30 minutes, same ceiling as opsched's operator jobs) never blocks
    the tick loop or steals threads from unrelated requests."""

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._stop_event: Optional[asyncio.Event] = None
        self._executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="user-scheduler")
        self._running_ids: set[str] = set()

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run())
        logger.info("User job scheduler started (interval=%ss)", TICK_SECONDS)

    async def stop(self) -> None:
        if self._stop_event:
            self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self._stop_event = None
        self._executor.shutdown(wait=False)
        logger.info("User job scheduler stopped")

    async def _run(self) -> None:
        assert self._stop_event is not None
        while True:
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=TICK_SECONDS)
                return
            except asyncio.TimeoutError:
                await self._tick()

    async def _tick(self) -> None:
        now = datetime.now(IST)
        minute_key = now.strftime("%Y-%m-%dT%H:%M")
        try:
            documents = list(col(JOBS).find({"enabled": True}))
        except Exception:
            logger.exception("User job scheduler could not list jobs")
            return
        for document in documents:
            job_id = document["id"]
            if job_id in self._running_ids:
                continue
            if document.get("lastFiredMinute") == minute_key:
                continue
            try:
                due = croniter.match(document["cron"], now)
            except (ValueError, KeyError):
                logger.warning("User job %s has an invalid cron %r; skipping", job_id, document.get("cron"))
                continue
            if not due:
                continue
            col(JOBS).update_one({"id": job_id}, {"$set": {"lastFiredMinute": minute_key}})
            asyncio.create_task(self._run_job(job_id))

    async def _run_job(self, job_id: str) -> None:
        self._running_ids.add(job_id)
        started_at = now_iso()
        try:
            document = col(JOBS).find_one({"id": job_id})
            if document is None or not document.get("enabled"):
                return
            loop = asyncio.get_running_loop()
            status, summary, provider = await loop.run_in_executor(
                self._executor, _run_job_sync, document
            )
            finished_at = now_iso()
            col(JOBS).update_one(
                {"id": job_id},
                {"$set": {
                    "lastRunAt": finished_at,
                    "lastRunStatus": status,
                    "updatedAt": finished_at,
                }},
            )
            try:
                record_run(
                    job=_history_key(job_id),
                    host="toolhub-backend",
                    started_at=started_at,
                    finished_at=finished_at,
                    status=status,
                    summary=summary,
                    provider=provider,
                )
            except ValueError:
                logger.exception("Could not record run history for user job %s", job_id)
            logger.info("User job %s completed: %s - %s", job_id, status, summary[:200])
        except Exception:
            logger.exception("User job %s failed unexpectedly", job_id)
        finally:
            self._running_ids.discard(job_id)


user_job_scheduler = UserJobScheduler()
