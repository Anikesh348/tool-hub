from typing import Any, Dict

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.middlewares.auth import admin_user
from app.services.buzzwatch import refresh_buzzwatch_items
from app.services.host_admin import host_admin_request
from app.services.mongo import col
from app.services.redis_cache import cache_delete_pattern, cache_info
from app.utils.responses import error, jsonable, now_iso, success

router = APIRouter()
AUDIT_COLLECTION = "adminsettingsaudit"


def audit(user: Dict[str, str], action: str, status: str, details: Dict[str, Any] | None = None) -> None:
    col(AUDIT_COLLECTION).insert_one(
        {
            "userId": user.get("userId"),
            "email": user.get("email"),
            "action": action,
            "status": status,
            "details": details or {},
            "createdAt": now_iso(),
        }
    )


def confirmation_error(expected: str) -> JSONResponse:
    return JSONResponse(status_code=400, content=error(f'Type "{expected}" to confirm this action'))


@router.get("/v2/admin/settings/status")
def admin_settings_status(_: Dict[str, str] = Depends(admin_user)):
    try:
        host = {"available": True, **host_admin_request("GET", "/v1/status")}
    except RuntimeError:
        host = {"available": False}
    return success({"host": host, "redis": cache_info()})


@router.get("/v2/admin/settings/audit")
def admin_settings_audit(_: Dict[str, str] = Depends(admin_user)):
    rows = col(AUDIT_COLLECTION).find({}).sort("createdAt", -1).limit(20)
    return success({"items": [jsonable(row) for row in rows]})


@router.post("/v2/admin/settings/cache/clear")
def admin_settings_cache_clear(user: Dict[str, str] = Depends(admin_user)):
    deleted = cache_delete_pattern("buzzwatch:*")
    result = {"message": "BuzzWatch cache cleared", "deletedKeys": deleted}
    audit(user, "BUZZWATCH_CACHE_CLEAR", "COMPLETED", result)
    return success(result)


@router.post("/v2/admin/settings/buzzwatch/refresh")
def admin_settings_buzzwatch_refresh(user: Dict[str, str] = Depends(admin_user)):
    result = refresh_buzzwatch_items()
    audit(user, "BUZZWATCH_REFRESH", "COMPLETED", {"updated": result.get("updated", 0)})
    return success({"message": "BuzzWatch catalog refreshed", **result})


@router.post("/v2/admin/settings/speedtest")
def admin_settings_speedtest(user: Dict[str, str] = Depends(admin_user)):
    try:
        result = host_admin_request("POST", "/v1/speedtest", timeout=180)
    except RuntimeError as exc:
        audit(user, "SERVER_SPEEDTEST", "FAILED", {"error": str(exc)})
        return JSONResponse(status_code=503, content=error(str(exc)))
    audit(
        user,
        "SERVER_SPEEDTEST",
        "COMPLETED",
        {
            "downloadMbps": result.get("downloadMbps"),
            "uploadMbps": result.get("uploadMbps"),
            "pingMs": result.get("pingMs"),
        },
    )
    return success({"message": "Server speed test completed", **result})


@router.post("/v2/admin/settings/restart-toolhub")
async def admin_settings_restart_toolhub(request: Request, user: Dict[str, str] = Depends(admin_user)):
    body = await request.json()
    if body.get("confirmation") != "RESTART TOOLHUB":
        return confirmation_error("RESTART TOOLHUB")
    try:
        result = host_admin_request("POST", "/v1/restart-toolhub")
    except RuntimeError as exc:
        audit(user, "TOOLHUB_RESTART", "FAILED", {"error": str(exc)})
        return JSONResponse(status_code=503, content=error(str(exc)))
    audit(user, "TOOLHUB_RESTART", "ACCEPTED")
    return success({"message": "ToolHub restart scheduled", **result})


@router.post("/v2/admin/settings/reboot")
async def admin_settings_reboot(request: Request, user: Dict[str, str] = Depends(admin_user)):
    body = await request.json()
    if body.get("confirmation") != "RESTART PI":
        return confirmation_error("RESTART PI")
    try:
        result = host_admin_request("POST", "/v1/reboot")
    except RuntimeError as exc:
        audit(user, "PI_REBOOT", "FAILED", {"error": str(exc)})
        return JSONResponse(status_code=503, content=error(str(exc)))
    audit(user, "PI_REBOOT", "ACCEPTED")
    return success({"message": "Raspberry Pi restart scheduled", **result})
