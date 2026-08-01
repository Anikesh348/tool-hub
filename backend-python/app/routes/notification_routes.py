import hmac
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.middlewares.auth import admin_user, current_user
from app.services.notifications import (
    VALID_AUDIENCES,
    VALID_SEVERITIES,
    create_notification,
    delete_notification,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    resolve_user_id,
)
from app.utils.responses import error, success


router = APIRouter(prefix="/v2/notifications", tags=["notifications"])


def _text(body: Dict[str, Any], key: str, maximum: int) -> str:
    return str(body.get(key) or "").strip()[:maximum]


def _notification_from_body(
    body: Dict[str, Any], *, created_by: Optional[str] = None
) -> Dict[str, Any]:
    audience = _text(body, "audience", 20).upper()
    severity = _text(body, "severity", 20).upper() or "INFO"
    if audience not in VALID_AUDIENCES:
        raise ValueError("audience must be ADMIN or USER")
    if severity not in VALID_SEVERITIES:
        raise ValueError("invalid notification severity")

    target_user_id = _text(body, "targetUserId", 100) or None
    target_email = _text(body, "targetEmail", 320)
    if target_email and not target_user_id:
        target_user_id = resolve_user_id(target_email)
        if not target_user_id:
            raise ValueError("target user email was not found")

    return create_notification(
        audience=audience,
        title=_text(body, "title", 140),
        message=_text(body, "message", 2000),
        severity=severity,
        category=_text(body, "category", 60) or "general",
        source=_text(body, "source", 60) or "toolhub",
        target_user_id=target_user_id,
        action_url=_text(body, "actionUrl", 500) or None,
        metadata=body.get("metadata") if isinstance(body.get("metadata"), dict) else {},
        created_by=created_by,
    )


@router.get("")
def notification_feed(
    limit: int = Query(80, ge=1, le=200),
    user: Dict[str, str] = Depends(current_user),
):
    return success(list_notifications(user, limit))


@router.post("")
async def publish_notification(
    request: Request, user: Dict[str, str] = Depends(admin_user)
):
    try:
        record = _notification_from_body(await request.json(), created_by=user.get("userId"))
        return JSONResponse(status_code=201, content=success(record))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))


@router.post("/events")
async def ingest_notification_event(
    request: Request,
    x_toolhub_alert_key: Optional[str] = Header(None, alias="X-ToolHub-Alert-Key"),
):
    expected = os.getenv("TOOLHUB_ALERT_INGEST_KEY", "").strip()
    supplied = (x_toolhub_alert_key or "").strip()
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=401, detail="Invalid alert ingest key")
    try:
        record = _notification_from_body(await request.json(), created_by="external-ingest")
        return JSONResponse(status_code=201, content=success(record))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))


@router.post("/read-all")
def read_all_notifications(user: Dict[str, str] = Depends(current_user)):
    return success({"updated": mark_all_notifications_read(user)})


@router.post("/{notification_id}/read")
def read_notification(
    notification_id: str, user: Dict[str, str] = Depends(current_user)
):
    mark_notification_read(user, notification_id)
    return success({"notificationId": notification_id, "read": True})


@router.delete("/{notification_id}")
def remove_notification(
    notification_id: str, _: Dict[str, str] = Depends(admin_user)
):
    delete_notification(notification_id)
    return success({"notificationId": notification_id, "deleted": True})
