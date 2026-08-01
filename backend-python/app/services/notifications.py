import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING

from app.services.mongo import col, find_one
from app.utils.responses import now_iso


logger = logging.getLogger(__name__)
NOTIFICATIONS_COLLECTION = "notifications"
VALID_AUDIENCES = {"ADMIN", "USER"}
VALID_SEVERITIES = {"INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"}


def ensure_notification_indexes() -> None:
    """Create indexes without making application startup depend on migration work."""
    try:
        collection = col(NOTIFICATIONS_COLLECTION)
        collection.create_index([("createdAt", DESCENDING)])
        collection.create_index(
            [("audience", ASCENDING), ("targetUserId", ASCENDING), ("createdAt", DESCENDING)]
        )
        collection.create_index([("notificationId", ASCENDING)], unique=True)
    except Exception:
        logger.exception("Unable to ensure notification indexes")


def _viewer_id(user: Dict[str, str]) -> str:
    return str(user.get("userId") or user.get("email") or "")


def visibility_query(user: Dict[str, str]) -> Dict[str, Any]:
    viewer_id = _viewer_id(user)
    user_visibility: List[Dict[str, Any]] = [
        {"audience": "USER", "targetUserId": viewer_id},
        {"audience": "USER", "targetUserId": None},
        {"audience": "USER", "targetUserId": {"$exists": False}},
    ]
    if str(user.get("role") or "").upper() == "ADMIN":
        user_visibility.append({"audience": "ADMIN"})
    return {"$or": user_visibility}


def create_notification(
    *,
    audience: str,
    title: str,
    message: str,
    severity: str = "INFO",
    category: str = "general",
    source: str = "toolhub",
    target_user_id: Optional[str] = None,
    action_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    audience = str(audience or "").upper()
    severity = str(severity or "INFO").upper()
    if audience not in VALID_AUDIENCES:
        raise ValueError("audience must be ADMIN or USER")
    if severity not in VALID_SEVERITIES:
        raise ValueError("severity must be INFO, SUCCESS, WARNING, ERROR, or CRITICAL")
    if audience == "ADMIN":
        target_user_id = None

    record: Dict[str, Any] = {
        "notificationId": str(uuid.uuid4()),
        "audience": audience,
        "targetUserId": str(target_user_id) if target_user_id else None,
        "title": str(title).strip()[:140],
        "message": str(message).strip()[:2000],
        "severity": severity,
        "category": str(category or "general").strip().lower()[:60],
        "source": str(source or "toolhub").strip().lower()[:60],
        "actionUrl": str(action_url).strip()[:500] if action_url else None,
        "metadata": metadata if isinstance(metadata, dict) else {},
        "readBy": [],
        "createdBy": created_by,
        "createdAt": now_iso(),
    }
    if not record["title"] or not record["message"]:
        raise ValueError("title and message are required")
    col(NOTIFICATIONS_COLLECTION).insert_one(record)
    record.pop("_id", None)
    return record


def emit_notification(**kwargs: Any) -> Optional[Dict[str, Any]]:
    """Publish a best-effort application event without breaking its source workflow."""
    try:
        return create_notification(**kwargs)
    except Exception:
        logger.exception("Unable to publish ToolHub notification")
        return None


def resolve_user_id(email: str) -> Optional[str]:
    normalized = str(email or "").strip().lower()
    if not normalized:
        return None
    user = find_one("users", {"email": normalized}) or find_one("users", {"emailLower": normalized})
    return str(user.get("userId")) if user and user.get("userId") else None


def list_notifications(user: Dict[str, str], limit: int = 80) -> Dict[str, Any]:
    viewer_id = _viewer_id(user)
    query = visibility_query(user)
    collection = col(NOTIFICATIONS_COLLECTION)
    records = list(collection.find(query).sort("createdAt", DESCENDING).limit(max(1, min(limit, 200))))
    notifications = []
    for record in records:
        record.pop("_id", None)
        record["read"] = viewer_id in (record.get("readBy") or [])
        record.pop("readBy", None)
        notifications.append(record)
    unread_count = collection.count_documents({"$and": [query, {"readBy": {"$ne": viewer_id}}]})
    return {"notifications": notifications, "unreadCount": unread_count}


def mark_notification_read(user: Dict[str, str], notification_id: str) -> None:
    viewer_id = _viewer_id(user)
    query = {"$and": [visibility_query(user), {"notificationId": notification_id}]}
    result = col(NOTIFICATIONS_COLLECTION).update_one(query, {"$addToSet": {"readBy": viewer_id}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Notification not found")


def mark_all_notifications_read(user: Dict[str, str]) -> int:
    viewer_id = _viewer_id(user)
    result = col(NOTIFICATIONS_COLLECTION).update_many(
        visibility_query(user), {"$addToSet": {"readBy": viewer_id}}
    )
    return result.modified_count


def delete_notification(notification_id: str) -> None:
    result = col(NOTIFICATIONS_COLLECTION).delete_one({"notificationId": notification_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Notification not found")
