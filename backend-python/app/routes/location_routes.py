import asyncio
import hmac
import os
from typing import Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from app.middlewares.auth import admin_user
from app.services.location import (
    create_place,
    get_current_status,
    get_route,
    get_summary,
    get_timeline,
    list_places,
    record_zone_transition,
    rename_place,
)
from app.utils.responses import success

router = APIRouter(prefix="/v2/location", tags=["location"])


@router.post("/events")
async def location_events(
    request: Request,
    x_toolhub_alert_key: Optional[str] = Header(None, alias="X-ToolHub-Alert-Key"),
):
    expected = os.getenv("TOOLHUB_ALERT_INGEST_KEY", "").strip()
    supplied = (x_toolhub_alert_key or "").strip()
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=401, detail="Invalid location ingest key")
    body = await request.json()
    return success(await asyncio.to_thread(record_zone_transition, body))


@router.get("/summary")
async def location_summary(
    range: str = Query("today"),
    date: Optional[str] = Query(None),
    _: Dict[str, str] = Depends(admin_user),
):
    return success(await asyncio.to_thread(get_summary, range, date))


@router.get("/current")
async def location_current(_: Dict[str, str] = Depends(admin_user)):
    return success(await asyncio.to_thread(get_current_status))


@router.get("/timeline")
async def location_timeline(
    days: int = Query(7, ge=1, le=90), _: Dict[str, str] = Depends(admin_user)
):
    return success(await asyncio.to_thread(get_timeline, days))


@router.get("/route")
async def location_route(
    range: str = Query("today"),
    date: Optional[str] = Query(None),
    _: Dict[str, str] = Depends(admin_user),
):
    return success(await asyncio.to_thread(get_route, range, date))


@router.get("/places")
async def location_places(_: Dict[str, str] = Depends(admin_user)):
    return success(await asyncio.to_thread(list_places))


@router.post("/places")
async def location_create_place(request: Request, _: Dict[str, str] = Depends(admin_user)):
    body = await request.json()
    return success(
        await asyncio.to_thread(create_place, body.get("label"), body.get("latitude"), body.get("longitude"))
    )


@router.patch("/places/{place_id}")
async def location_rename_place(
    place_id: str, request: Request, _: Dict[str, str] = Depends(admin_user)
):
    body = await request.json()
    return success(await asyncio.to_thread(rename_place, place_id, body.get("label")))
