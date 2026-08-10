import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from pymongo import DESCENDING

from app.services.mongo import col
from app.services.redis_cache import cache_count_pattern, cache_set
from app.utils.responses import now_iso

logger = logging.getLogger("uvicorn.error")

ACTIVITY_EVENTS_COLLECTION = "activity_events"
ACTIVITY_SUMMARY_CACHE_COLLECTION = "activity_summary_cache"
MAX_EVENTS_PER_BATCH = 200
VALID_EVENT_TYPES = {"pageview", "click", "scroll"}
PRESENCE_TTL_SECONDS = 60
PRESENCE_KEY_PREFIX = "presence:user:"
# Fixed set of windows the dashboard offers (see RANGE_OPTIONS in
# ActivityDashboard.tsx) - these are the only ranges the rollup job
# precomputes and caches; anything else falls back to a live aggregation.
SUPPORTED_ROLLUP_RANGES = (24, 168, 720)


def _retention_days() -> int:
    try:
        return max(1, int(os.getenv("ACTIVITY_RETENTION_DAYS", "60")))
    except ValueError:
        return 60


def ensure_activity_indexes() -> None:
    try:
        collection = col(ACTIVITY_EVENTS_COLLECTION)
        collection.create_index("createdAt", expireAfterSeconds=_retention_days() * 86400)
        collection.create_index([("type", 1), ("createdAt", DESCENDING)])
        collection.create_index([("userId", 1), ("createdAt", DESCENDING)])
    except Exception:
        logger.exception("Unable to ensure activity indexes")


def _clean_event(raw: Dict[str, Any], user_id: str, session_id: str) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    event_type = str(raw.get("type") or "").strip().lower()
    if event_type not in VALID_EVENT_TYPES:
        return None
    path = str(raw.get("path") or "").strip()[:300]
    if not path:
        return None
    doc: Dict[str, Any] = {
        "userId": user_id,
        "sessionId": session_id[:120],
        "type": event_type,
        "path": path,
        "createdAt": datetime.now(timezone.utc),
    }
    if event_type == "click":
        doc["target"] = str(raw.get("target") or "").strip()[:200]
    if event_type == "scroll":
        try:
            depth = int(raw.get("scrollDepth") or 0)
        except (TypeError, ValueError):
            depth = 0
        doc["scrollDepth"] = max(0, min(100, depth))
    return doc


def record_events(body: Dict[str, Any], user: Dict[str, str]) -> Dict[str, Any]:
    session_id = str(body.get("sessionId") or "").strip()
    raw_events = body.get("events")
    if not session_id or not isinstance(raw_events, list):
        raise HTTPException(status_code=400, detail="sessionId and events are required")
    raw_events = raw_events[:MAX_EVENTS_PER_BATCH]

    user_id = user.get("userId", "")
    docs = [doc for doc in (_clean_event(raw, user_id, session_id) for raw in raw_events) if doc]
    if docs:
        col(ACTIVITY_EVENTS_COLLECTION).insert_many(docs, ordered=False)
    return {"accepted": len(docs)}


def touch_presence(user: Dict[str, str], path: str) -> Dict[str, Any]:
    user_id = user.get("userId", "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required")
    cache_set(
        f"{PRESENCE_KEY_PREFIX}{user_id}",
        {"path": str(path or "")[:300], "since": now_iso()},
        PRESENCE_TTL_SECONDS,
    )
    return {"ok": True}


def live_count() -> Dict[str, Any]:
    return {"liveUsers": cache_count_pattern(f"{PRESENCE_KEY_PREFIX}*")}


def _compute_summary(hours: int) -> Dict[str, Any]:
    hours = max(1, min(hours, 24 * 90))
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    collection = col(ACTIVITY_EVENTS_COLLECTION)
    match: Dict[str, Any] = {"createdAt": {"$gte": since}}

    total_events = collection.count_documents(match)
    unique_users = len(collection.distinct("userId", match))

    events_by_type = {
        row["_id"]: row["count"]
        for row in collection.aggregate(
            [
                {"$match": match},
                {"$group": {"_id": "$type", "count": {"$sum": 1}}},
            ]
        )
    }

    top_pages = list(
        collection.aggregate(
            [
                {"$match": {**match, "type": "pageview"}},
                {"$group": {"_id": "$path", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
                {"$limit": 20},
            ]
        )
    )
    top_clicks = list(
        collection.aggregate(
            [
                {"$match": {**match, "type": "click"}},
                {"$group": {"_id": {"path": "$path", "target": "$target"}, "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
                {"$limit": 20},
            ]
        )
    )
    scroll_depth = list(
        collection.aggregate(
            [
                {"$match": {**match, "type": "scroll"}},
                {"$group": {"_id": "$scrollDepth", "count": {"$sum": 1}}},
                {"$sort": {"_id": 1}},
            ]
        )
    )
    events_over_time = list(
        collection.aggregate(
            [
                {"$match": match},
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {
                                "format": "%Y-%m-%dT%H:00:00Z",
                                "date": "$createdAt",
                            }
                        },
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )

    return {
        "hours": hours,
        "totalEvents": total_events,
        "uniqueUsers": unique_users,
        "pageviews": events_by_type.get("pageview", 0),
        "clicks": events_by_type.get("click", 0),
        "topPages": [{"path": row["_id"], "count": row["count"]} for row in top_pages],
        "topClicks": [
            {"path": row["_id"]["path"], "target": row["_id"]["target"], "count": row["count"]}
            for row in top_clicks
        ],
        "scrollDepth": [{"depth": row["_id"], "count": row["count"]} for row in scroll_depth],
        "eventsOverTime": [{"bucket": row["_id"], "count": row["count"]} for row in events_over_time],
    }


def get_summary(hours: int) -> Dict[str, Any]:
    """Read path used by GET /v2/activity/summary.

    For the dashboard's fixed range options, this reads a cache document the
    activity-rollup scheduled job refreshes every ACTIVITY_ROLLUP_INTERVAL_SECONDS
    instead of re-aggregating raw events on every page load. Anything outside
    those ranges (or before the first rollup has run) falls back to a live
    aggregation so the endpoint never just returns nothing.
    """
    hours = max(1, min(hours, 24 * 90))
    if hours in SUPPORTED_ROLLUP_RANGES:
        cached = col(ACTIVITY_SUMMARY_CACHE_COLLECTION).find_one({"_id": f"range-{hours}"})
        if cached:
            cached.pop("_id", None)
            return cached
    return _compute_summary(hours)


def run_activity_rollup() -> Dict[str, Any]:
    """Scheduled job body - runs on the scheduler's own thread via
    asyncio.to_thread (see ToolHubScheduler/FixedIntervalJob in schedule.py),
    so this never blocks the event loop or any live request.
    """
    refreshed = []
    for hours in SUPPORTED_ROLLUP_RANGES:
        payload = _compute_summary(hours)
        payload["computedAt"] = now_iso()
        col(ACTIVITY_SUMMARY_CACHE_COLLECTION).replace_one(
            {"_id": f"range-{hours}"}, {**payload, "_id": f"range-{hours}"}, upsert=True
        )
        refreshed.append(hours)
    return {"rangesRefreshed": refreshed}
