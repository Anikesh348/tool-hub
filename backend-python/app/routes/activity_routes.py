import asyncio
from typing import Dict

from fastapi import APIRouter, Depends, Query, Request

from app.middlewares.auth import admin_user, current_user
from app.services.activity import live_count, record_events, summary, touch_presence
from app.utils.responses import success

router = APIRouter(tags=["activity"])


@router.post("/v2/activity/events")
async def activity_events(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return success(await asyncio.to_thread(record_events, body, user))


@router.post("/v2/activity/heartbeat")
async def activity_heartbeat(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return success(await asyncio.to_thread(touch_presence, user, body.get("path", "")))


@router.get("/v2/activity/live-count")
async def activity_live_count(_: Dict[str, str] = Depends(admin_user)):
    return success(await asyncio.to_thread(live_count))


@router.get("/v2/activity/summary")
async def activity_summary(hours: int = Query(24, ge=1, le=2160), _: Dict[str, str] = Depends(admin_user)):
    return success(await asyncio.to_thread(summary, hours))
