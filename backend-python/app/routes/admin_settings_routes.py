from typing import Any, Dict

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.middlewares.auth import admin_user
from app.services.buzzwatch import refresh_buzzwatch_items
from app.services.host_admin import codex_host_admin_request, host_admin_request
from app.services.mongo import col
from app.services.redis_cache import cache_delete_pattern, cache_info
from app.utils.responses import error, jsonable, now_iso, success

router = APIRouter()
AUDIT_COLLECTION = "adminsettingsaudit"
SPEEDTEST_TARGETS = {"hp-purva", "ubuntu-purva", "homeassistant", "hp-codex", "pi-purva"}


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


@router.get("/v2/admin/settings/speedtest")
def admin_settings_speedtest_latest(_: Dict[str, str] = Depends(admin_user)):
    row = col(AUDIT_COLLECTION).find_one(
        {"action": "SERVER_FLEET_SPEEDTEST", "status": {"$in": ["COMPLETED", "PARTIAL"]}},
        sort=[("createdAt", -1)],
    )
    if not row:
        return success({"available": False})
    return success({"available": True, **jsonable(row.get("details") or {})})


@router.post("/v2/admin/settings/speedtest")
def admin_settings_speedtest(user: Dict[str, str] = Depends(admin_user)):
    return run_admin_speedtest(user)


@router.post("/v2/admin/settings/speedtest/{target_id}")
def admin_settings_node_speedtest(target_id: str, user: Dict[str, str] = Depends(admin_user)):
    if target_id not in SPEEDTEST_TARGETS:
        return JSONResponse(status_code=404, content=error("Unknown speed-test target"))
    return run_admin_speedtest(user, target_id)


def run_admin_speedtest(user: Dict[str, str], target_id: str | None = None):
    action = "SERVER_FLEET_SPEEDTEST" if target_id is None else "SERVER_NODE_SPEEDTEST"
    path = "/v1/fleet-speedtest" if target_id is None else f"/v1/speedtest/{target_id}"
    try:
        result = codex_host_admin_request("POST", path, timeout=300)
    except RuntimeError as exc:
        audit(user, action, "FAILED", {"targetId": target_id, "error": str(exc)})
        return JSONResponse(status_code=503, content=error(str(exc)))
    failed = sum(1 for item in result.get("results", []) if item.get("status") != "ok")
    status = "PARTIAL" if failed else "COMPLETED"
    audit(user, action, status, result)
    subject = "Fleet" if target_id is None else next((item.get("label") for item in result.get("results", [])), target_id)
    message = f"{subject} speed test completed" if not failed else f"{subject} speed test failed"
    return success({"message": message, **result})


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
