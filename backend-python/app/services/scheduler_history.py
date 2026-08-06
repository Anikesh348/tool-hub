import logging
from typing import Any, Dict, List, Optional

from pymongo import DESCENDING

from app.services.mongo import col
from app.utils.responses import now_iso

logger = logging.getLogger(__name__)
SCHEDULED_JOB_RUNS_COLLECTION = "scheduled_job_runs"
VALID_STATUSES = {"success", "warning", "failure"}


def ensure_scheduler_history_indexes() -> None:
    try:
        collection = col(SCHEDULED_JOB_RUNS_COLLECTION)
        collection.create_index([("startedAt", DESCENDING)])
        collection.create_index([("job", 1), ("startedAt", DESCENDING)])
    except Exception:
        logger.exception("Unable to ensure scheduler history indexes")


def record_run(
    *,
    job: str,
    host: str,
    started_at: str,
    finished_at: str,
    status: str,
    summary: str,
    provider: Optional[str] = None,
) -> Dict[str, Any]:
    status = str(status or "").strip().lower()
    if status not in VALID_STATUSES:
        raise ValueError("status must be success, warning, or failure")
    job = str(job or "").strip()[:80]
    if not job:
        raise ValueError("job is required")

    record: Dict[str, Any] = {
        "job": job,
        "host": str(host or "").strip()[:120],
        "startedAt": str(started_at or "").strip(),
        "finishedAt": str(finished_at or "").strip(),
        "status": status,
        "summary": str(summary or "").strip()[:2000],
        "provider": str(provider).strip()[:40] if provider else None,
        "recordedAt": now_iso(),
    }
    col(SCHEDULED_JOB_RUNS_COLLECTION).insert_one(record)
    record.pop("_id", None)
    return record


def list_runs(*, job: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    query: Dict[str, Any] = {}
    if job:
        query["job"] = job
    collection = col(SCHEDULED_JOB_RUNS_COLLECTION)
    records = list(collection.find(query).sort("startedAt", DESCENDING).limit(max(1, min(limit, 500))))
    for record in records:
        record.pop("_id", None)
    return records
