import os
import uuid
from html import escape
from typing import Any, Dict, Optional

import requests
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import YT_DOWNLOADS_COLLECTION
from app.services.mail import send_brevo_email
from app.services.mongo import col, delete_one_or_404, find, find_one, insert
from app.utils.http import base_url, proxy_json
from app.utils.responses import error, now_iso, success


def get_formats(body: Dict[str, Any]):
    if not body.get("url"):
        return JSONResponse(status_code=400, content=error("url is required"))
    yt_base = base_url("YT_DOWNLOAD_API_BASE_URL")
    if not yt_base:
        return JSONResponse(status_code=500, content=error("YT_DOWNLOAD_API_BASE_URL is not configured"))
    return proxy_json("POST", f"{yt_base}/api/formats", json=body, headers={"Content-Type": "application/json"})


def add_download(body: Dict[str, Any], user: Dict[str, str]):
    video_id = (body.get("videoId") or "").strip()
    if not video_id:
        return JSONResponse(status_code=400, content=error("videoId is required"))
    is_song = bool(body.get("isSong", body.get("is_song", False)))
    download_path = (os.getenv("YT_DOWNLOAD_SONGS_PATH") if is_song else body.get("download_path") or os.getenv("YT_DOWNLOAD_SERVER_PATH") or "").strip()
    if not download_path:
        return JSONResponse(status_code=400, content=error("download_path is required"))
    fmt = body.get("format") or {}
    if not (fmt.get("quality") or "").strip():
        return JSONResponse(status_code=400, content=error("format.quality is required"))
    existing = find_one(YT_DOWNLOADS_COLLECTION, {"videoId": video_id})
    if existing and existing.get("status") != "FAILED":
        return JSONResponse(
            status_code=409,
            content=error(f"download request already exists for this videoId (status: {existing.get('status', 'UNKNOWN')})"),
        )
    request_id = existing.get("requestId") if existing else str(uuid.uuid4())
    record = {
        "requestId": request_id,
        "videoId": video_id,
        "url": body.get("url", ""),
        "title": body.get("title", ""),
        "filename": body.get("filename", ""),
        "download_path": download_path,
        "isSong": is_song,
        "format": {"quality": fmt.get("quality"), "ext": fmt.get("ext", "mp4")},
        "status": "REQUESTED",
        "downloadAlertSent": False,
        "userId": user["userId"],
        "userEmail": user.get("email", body.get("userEmail", "")),
        "updatedAt": now_iso(),
    }
    if existing:
        col(YT_DOWNLOADS_COLLECTION).update_one({"requestId": request_id}, {"$set": record})
        msg = "failed download request re-queued"
    else:
        record["createdAt"] = now_iso()
        insert(YT_DOWNLOADS_COLLECTION, record)
        msg = "download request added"
    return success({"message": msg, "requestId": request_id, "status": "REQUESTED", "videoId": video_id})


def start_download():
    yt_base = base_url("YT_DOWNLOAD_API_BASE_URL")
    if not yt_base:
        return JSONResponse(status_code=500, content=error("YT_DOWNLOAD_API_BASE_URL is not configured"))
    running = requests.get(f"{yt_base}/api/download/running", timeout=20).json()
    if running.get("running"):
        return success({"started": False, "message": "your request will be downloaded"})
    next_req = col(YT_DOWNLOADS_COLLECTION).find_one({"status": "REQUESTED"}, sort=[("createdAt", 1)])
    if not next_req:
        return success({"started": False, "message": "no pending download request", "queued": 0})
    payload = {
        "videoId": next_req.get("videoId"),
        "download_path": next_req.get("download_path"),
        "progress_updates": False,
        "format": next_req.get("format", {}),
    }
    if next_req.get("filename"):
        payload["filename"] = next_req["filename"]
    res = requests.post(f"{yt_base}/api/download", json=payload, timeout=60)
    if res.status_code < 200 or res.status_code >= 300:
        return JSONResponse(status_code=500, content=error("failed to start download"))
    col(YT_DOWNLOADS_COLLECTION).update_one(
        {"requestId": next_req["requestId"]},
        {"$set": {"status": "DOWNLOADING", "startedAt": now_iso(), "updatedAt": now_iso(), "lastStartResponse": res.json() if res.text else {}}},
    )
    return success({"started": True, "message": "download started", "requestId": next_req["requestId"], "videoId": next_req.get("videoId"), "status": "DOWNLOADING"})


def check_downloads():
    yt_base = base_url("YT_DOWNLOAD_API_BASE_URL")
    if not yt_base:
        return JSONResponse(status_code=500, content=error("YT_DOWNLOAD_API_BASE_URL is not configured"))
    summary = {"total": 0, "checked": 0, "downloaded": 0, "failed": 0, "emailSent": 0, "movieHubRefreshTriggered": 0, "stillDownloading": 0}
    records = find(YT_DOWNLOADS_COLLECTION, {"status": "DOWNLOADING"})
    summary["total"] = len(records)
    for record in records:
        summary["checked"] += 1
        status = requests.get(f"{yt_base}/api/download/status/{record.get('videoId')}", timeout=30).json()
        if status.get("status", "").lower() == "downloaded" and status.get("phase", "").lower() == "completed":
            summary["downloaded"] += 1
            title = (status.get("title") or record.get("title") or record.get("videoId") or "Unknown Video").strip()
            email_sent = False
            refresh_triggered = False
            if (record.get("userEmail") or "").strip():
                try:
                    email_sent = send_yt_downloaded_email(record.get("userEmail", ""), title)
                except Exception:
                    email_sent = False
            try:
                refresh_triggered = trigger_yt_jellyfin_refresh()
            except Exception:
                refresh_triggered = False
            if email_sent:
                summary["emailSent"] += 1
            if refresh_triggered:
                summary["movieHubRefreshTriggered"] += 1
            update = {
                "status": "DOWNLOADED",
                "title": title,
                "downloadedAt": now_iso(),
                "updatedAt": now_iso(),
                "lastStatusPayload": status,
                "downloadAlertSent": email_sent,
                "movieHubRefreshTriggered": refresh_triggered,
            }
            if email_sent:
                update["downloadAlertSentAt"] = now_iso()
            if refresh_triggered:
                update["movieHubRefreshTriggeredAt"] = now_iso()
            col(YT_DOWNLOADS_COLLECTION).update_one({"requestId": record["requestId"]}, {"$set": update})
        elif status.get("error") or status.get("event") == "ERROR" or status.get("status", "").upper() in {"FAILED", "ERROR", "CANCELLED"}:
            summary["failed"] += 1
            col(YT_DOWNLOADS_COLLECTION).update_one(
                {"requestId": record["requestId"]},
                {"$set": {"status": "FAILED", "error": status.get("error") or status.get("message") or "download failed", "updatedAt": now_iso(), "lastStatusPayload": status}},
            )
        else:
            summary["stillDownloading"] += 1
    return success(summary)


def list_requests():
    records = sorted(find(YT_DOWNLOADS_COLLECTION, {}), key=lambda r: r.get("createdAt", ""), reverse=True)
    return success({"requests": records})


def delete_request(request_id: str):
    record = find_one(YT_DOWNLOADS_COLLECTION, {"requestId": request_id})
    if not record:
        return JSONResponse(status_code=404, content=error("download request not found"))
    if record.get("status") == "DOWNLOADING":
        return JSONResponse(status_code=409, content=error("DOWNLOADING requests cannot be deleted (current status: DOWNLOADING)"))
    delete_one_or_404(YT_DOWNLOADS_COLLECTION, {"requestId": request_id})
    return success({"message": "download request deleted", "requestId": request_id})


def get_status(video_id: str):
    yt_base = base_url("YT_DOWNLOAD_API_BASE_URL")
    if not yt_base:
        return JSONResponse(status_code=500, content=error("YT_DOWNLOAD_API_BASE_URL is not configured"))
    return proxy_json("GET", f"{yt_base}/api/download/status/{video_id}")


def stream_status(video_id: str):
    yt_base = base_url("YT_DOWNLOAD_API_BASE_URL")
    if not yt_base:
        return JSONResponse(status_code=500, content=error("YT_DOWNLOAD_API_BASE_URL is not configured"))
    upstream = requests.get(f"{yt_base}/api/download/status/stream/{video_id}", stream=True, timeout=300)
    return StreamingResponse(upstream.iter_content(chunk_size=None), status_code=upstream.status_code, media_type=upstream.headers.get("Content-Type", "text/event-stream"))


def jellyfin_headers() -> Dict[str, str]:
    key = os.getenv("JELLYFIN_API_KEY", "")
    return {
        "accept": "application/json",
        "authorization": f'MediaBrowser Client="ToolHub", Device="ToolHub", DeviceId="toolhub-web", Version="10.11.6", Token="{key}"',
        "X-Emby-Token": key,
        "X-MediaBrowser-Token": key,
        "X-Api-Key": key,
    }


def trigger_yt_jellyfin_refresh() -> bool:
    jellyfin = base_url("JELLYFIN_BASE_URL")
    item_id = (os.getenv("YT_JELLYFIN_ID") or "").strip()
    if not jellyfin or not os.getenv("JELLYFIN_API_KEY") or not item_id:
        raise RuntimeError("JELLYFIN_BASE_URL/JELLYFIN_API_KEY/YT_JELLYFIN_ID is not configured")
    endpoint = (
        f"{jellyfin}/Items/{item_id}/Refresh"
        "?Recursive=true&ImageRefreshMode=Default&MetadataRefreshMode=Default"
        "&ReplaceAllImages=false&RegenerateTrickplay=false&ReplaceAllMetadata=false"
    )
    res = requests.post(endpoint, headers=jellyfin_headers(), timeout=30)
    if res.status_code < 200 or res.status_code >= 300:
        raise RuntimeError(f"moviehub refresh failed with status {res.status_code}")
    return True


def build_yt_downloaded_email(title: str) -> str:
    safe_title = escape(title or "Unknown Video")
    return f"""
<html>
  <body style="font-family: Arial, sans-serif; line-height:1.6; color:#1f2937;">
    <h3 style="margin-bottom: 8px;">Download Completed</h3>
    <p>Your requested YouTube download is complete.</p>
    <p><strong>Title:</strong> {safe_title}</p>
  </body>
</html>
"""


def send_yt_downloaded_email(user_email: str, title: str) -> bool:
    send_brevo_email(f"YouTube download completed: {title}", user_email, build_yt_downloaded_email(title))
    return True


def list_library_items(start_index: int = 0, limit: int = 100, parent_id: Optional[str] = None):
    jellyfin = base_url("JELLYFIN_BASE_URL")
    parent = parent_id or os.getenv("YT_JELLYFIN_ID", "")
    if not jellyfin or not os.getenv("JELLYFIN_API_KEY"):
        return JSONResponse(status_code=500, content=error("JELLYFIN_BASE_URL/JELLYFIN_API_KEY is not configured"))
    res = requests.get(
        f"{jellyfin}/Items",
        params={"ParentId": parent, "StartIndex": start_index, "Limit": limit, "Fields": "Path,SortName,ChildCount,MediaSourceCount", "SortBy": "SortName", "SortOrder": "Ascending"},
        headers=jellyfin_headers(),
        timeout=60,
    )
    if res.status_code < 200 or res.status_code >= 300:
        return JSONResponse(status_code=502, content=error("failed to list yt library items"))
    payload = res.json()
    items = payload.get("Items", [])
    return success({"items": items, "totalRecordCount": payload.get("TotalRecordCount", len(items)), "startIndex": payload.get("StartIndex", start_index), "limit": limit, "parentId": parent})


def delete_library_item(item_id: str):
    jellyfin = base_url("JELLYFIN_BASE_URL")
    res = requests.delete(f"{jellyfin}/Items/{item_id}", headers=jellyfin_headers(), timeout=60)
    if res.status_code < 200 or res.status_code >= 300:
        return JSONResponse(status_code=502, content=error("failed to delete yt library item"))
    return success({"message": "yt library item deleted", "itemId": item_id})
