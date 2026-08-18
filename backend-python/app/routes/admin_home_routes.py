import json
import os
from typing import Dict
from urllib import error as urlerror
from urllib import request as urlrequest

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.middlewares.auth import admin_user
from app.routes.admin_settings_routes import audit
from app.services.mongo import col
from app.utils.responses import error, success

router = APIRouter()


def small_lights_guard(state: str) -> Dict[str, bool]:
    if state not in {"status", "on", "off"}:
        raise ValueError("Invalid Small Lights safeguard state")
    url = os.getenv("HOME_ASSISTANT_SMALL_LIGHTS_GUARD_WEBHOOK_URL", "").strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        raise RuntimeError("Small Lights safeguard control is not configured")
    payload = json.dumps({"state": state}).encode("utf-8")
    request = urlrequest.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlrequest.urlopen(request, timeout=8) as response:
            if response.status >= 400:
                raise RuntimeError("Home Assistant rejected the safeguard request")
    except (urlerror.URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError("Home Assistant Small Lights safeguard is unavailable") from exc
    return {"enabled": state == "on"}


def big_lights_guard(state: str) -> Dict[str, bool]:
    if state not in {"status", "on", "off"}:
        raise ValueError("Invalid Big Lights safeguard state")
    url = os.getenv("HOME_ASSISTANT_BIG_LIGHTS_GUARD_WEBHOOK_URL", "").strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        raise RuntimeError("Big Lights safeguard control is not configured")
    payload = json.dumps({"state": state}).encode("utf-8")
    request = urlrequest.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlrequest.urlopen(request, timeout=8) as response:
            if response.status >= 400:
                raise RuntimeError("Home Assistant rejected the safeguard request")
    except (urlerror.URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError("Home Assistant Big Lights safeguard is unavailable") from exc
    return {"enabled": state == "on"}


@router.get("/v2/admin/home/small-lights-guard")
def get_small_lights_guard(_: Dict[str, str] = Depends(admin_user)):
    try:
        row = col("homeguardstate").find_one({"key": "small_lights_guard"}) or {}
        return success({"enabled": bool(row.get("enabled", False))})
    except (RuntimeError, ValueError) as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/home/small-lights-guard/{state}")
def set_small_lights_guard(state: str, user: Dict[str, str] = Depends(admin_user)):
    try:
        result = small_lights_guard(state)
    except (RuntimeError, ValueError) as exc:
        audit(user, "SMALL_LIGHTS_GUARD", "FAILED", {"requestedState": state, "error": str(exc)})
        return JSONResponse(status_code=503, content=error(str(exc)))
    col("homeguardstate").update_one({"key": "small_lights_guard"}, {"$set": {"enabled": result["enabled"]}}, upsert=True)
    audit(user, "SMALL_LIGHTS_GUARD", "COMPLETED", {"requestedState": state, **result})
    return success(result)


@router.get("/v2/admin/home/big-lights-guard")
def get_big_lights_guard(_: Dict[str, str] = Depends(admin_user)):
    try:
        row = col("homeguardstate").find_one({"key": "big_lights_guard"}) or {}
        return success({"enabled": bool(row.get("enabled", False))})
    except (RuntimeError, ValueError) as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/home/big-lights-guard/{state}")
def set_big_lights_guard(state: str, user: Dict[str, str] = Depends(admin_user)):
    try:
        result = big_lights_guard(state)
    except (RuntimeError, ValueError) as exc:
        audit(user, "BIG_LIGHTS_GUARD", "FAILED", {"requestedState": state, "error": str(exc)})
        return JSONResponse(status_code=503, content=error(str(exc)))
    col("homeguardstate").update_one({"key": "big_lights_guard"}, {"$set": {"enabled": result["enabled"]}}, upsert=True)
    audit(user, "BIG_LIGHTS_GUARD", "COMPLETED", {"requestedState": state, **result})
    return success(result)
