import hmac
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.middlewares.auth import admin_user
from app.services.scheduler_history import list_runs, record_run
from app.services.scheduler_jobs import list_jobs, set_enabled, set_schedule
from app.utils.responses import error, success

router = APIRouter(tags=["scheduler"])


@router.post("/v2/scheduler/runs")
async def ingest_scheduler_run(
    request: Request,
    x_toolhub_scheduler_key: Optional[str] = Header(None, alias="X-ToolHub-Scheduler-Key"),
):
    """Trusted local ingest from the opsched scheduler on this host.

    Mirrors the existing /v2/notifications/events shared-key convention.
    """
    expected = os.getenv("TOOLHUB_SCHEDULER_INGEST_KEY", "").strip()
    supplied = (x_toolhub_scheduler_key or "").strip()
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=401, detail="Invalid scheduler ingest key")
    body: Dict[str, Any] = await request.json()
    try:
        record = record_run(
            job=body.get("job"),
            host=body.get("host"),
            started_at=body.get("startedAt"),
            finished_at=body.get("finishedAt"),
            status=body.get("status"),
            summary=body.get("summary"),
            provider=body.get("provider"),
        )
        return JSONResponse(status_code=201, content=success(record))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))


@router.get("/v2/admin/scheduler/runs")
def scheduler_runs(
    job: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    _: Dict[str, str] = Depends(admin_user),
):
    return success({"runs": list_runs(job=job, limit=limit)})


@router.get("/v2/admin/scheduler/jobs")
def scheduler_jobs(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success(list_jobs())
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/scheduler/jobs/{slug}/schedule")
async def scheduler_job_schedule(
    slug: str, request: Request, _: Dict[str, str] = Depends(admin_user)
):
    body = await request.json()
    try:
        return success(set_schedule(slug, body.get("schedule")))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/scheduler/jobs/{slug}/enable")
def scheduler_job_enable(slug: str, _: Dict[str, str] = Depends(admin_user)):
    try:
        return success(set_enabled(slug, True))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/scheduler/jobs/{slug}/disable")
def scheduler_job_disable(slug: str, _: Dict[str, str] = Depends(admin_user)):
    try:
        return success(set_enabled(slug, False))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))
