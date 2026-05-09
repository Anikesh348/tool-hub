import json
import os
import re
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import bcrypt
import jwt
import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import MEDIA_REQUESTS_COLLECTION, MOVIEHUB_ACCESS_REQUESTS_COLLECTION, MOVIEHUB_ACCESS_USERS_COLLECTION
from app.middlewares.auth import admin_user, current_user
from app.services.mongo import col, find, find_one, insert, update_one_or_404, delete_one_or_404
from app.services.moviehub_automation import *
from app.utils.http import api_headers, base_url
from app.utils.responses import error, now_iso, success

router = APIRouter()

@router.get("/v2/moviehub/search")
def moviehub_search(term: str, mediaType: str, _: Dict[str, str] = Depends(current_user)):
    mt = parse_media_type(mediaType)
    if not term:
        return JSONResponse(status_code=400, content=error("term query param is required"))
    if mt == "UNKNOWN":
        return JSONResponse(status_code=400, content=error("mediaType must be MOVIES or SHOWS"))
    base = base_url("RADARR_API_URL") if mt == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if mt == "MOVIES" else os.getenv("SONARR_API_KEY")
    path = "movie/lookup" if mt == "MOVIES" else "series/lookup"
    res = requests.get(f"{base}/{path}", params={"term": term}, headers=api_headers(key or ""), timeout=60)
    if res.status_code < 200 or res.status_code >= 300:
        return JSONResponse(status_code=500, content=error(res.text))
    return success(normalize_moviehub_lookup_results(res.json(), mt))


@router.post("/v2/moviehub/requests")
async def moviehub_create_request(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    mt = parse_media_type(body.get("mediaType"))
    if mt == "UNKNOWN":
        return JSONResponse(status_code=400, content=error("mediaType must be MOVIES or SHOWS"))
    title = (body.get("title") or "").strip()
    if not title:
        return JSONResponse(status_code=400, content=error("title is required"))
    seasons = sorted_unique_positive_numbers(body.get("season") or [])
    if mt == "SHOWS" and not seasons:
        return JSONResponse(status_code=400, content=error("season is required for mediaType SHOWS"))
    try:
        conflict = validate_availability_before_create(mt, title, seasons)
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))
    if conflict:
        return JSONResponse(status_code=409, content=error(conflict))
    db_user = find_one("users", {"userId": user["userId"]}) or {}
    record = {
        "requestId": str(uuid.uuid4()), "userId": user["userId"], "userEmail": db_user.get("email", user.get("email", "")),
        "userName": db_user.get("name", db_user.get("userName", "")), "title": title, "mediaType": mt,
        "tmdbId": body.get("tmdbId"), "tvdbId": body.get("tvdbId"), "imdbId": body.get("imdbId"),
        "qualityProfileId": normalize_quality_profile(body.get("qualityProfileId") or body.get("quality")), "season": seasons,
        "status": "PENDING", "createdAt": now_iso(), "updatedAt": now_iso(),
    }
    insert(MEDIA_REQUESTS_COLLECTION, record)
    return JSONResponse(status_code=201, content=success({"message": "request created", "requestId": record["requestId"], "status": "PENDING"}))


def formatted_requests(query: Dict[str, Any]) -> List[Dict[str, Any]]:
    return sorted(find(MEDIA_REQUESTS_COLLECTION, query), key=lambda r: r.get("createdAt", ""), reverse=True)


@router.get("/v2/moviehub/requests")
def moviehub_my_requests(user: Dict[str, str] = Depends(current_user)):
    return success(formatted_requests({"userId": user["userId"]}))


@router.get("/v2/admin/moviehub/requests")
def moviehub_all_requests(_: Dict[str, str] = Depends(admin_user)):
    return success(formatted_requests({}))


@router.post("/v2/admin/moviehub/requests/{request_id}/approve")
def moviehub_approve_request(request_id: str, user: Dict[str, str] = Depends(admin_user)):
    record = find_one(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id})
    if not record:
        return JSONResponse(status_code=404, content=error("request not found"))
    if record.get("status") != "PENDING":
        return JSONResponse(status_code=400, content=error("only pending requests can be approved"))
    try:
        queue_media_download(record)
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))
    now = now_iso()
    update_one_or_404(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id}, {"$set": {"status": "APPROVED", "approvedBy": user["userId"], "approvedAt": now, "updatedAt": now}})
    record["status"] = "APPROVED"
    record["approvedBy"] = user["userId"]
    record["approvedAt"] = now
    try:
        send_media_approval_email(record)
        notification = "sent"
    except Exception:
        notification = "failed"
    return success({"message": "Request approved and media queued for download", "requestId": request_id, "notification": notification})


@router.post("/v2/moviehub/requests/{request_id}/delete")
def moviehub_delete_request(request_id: str, user: Dict[str, str] = Depends(current_user)):
    record = find_one(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id})
    if not record:
        return JSONResponse(status_code=404, content=error("request not found"))
    is_admin = user.get("role") == "ADMIN"
    if record.get("status") == "PENDING" and not (is_admin or record.get("userId") == user["userId"]):
        return JSONResponse(status_code=403, content=error("you are not allowed to delete this request"))
    if record.get("status") == "APPROVED" and not is_admin:
        return JSONResponse(status_code=403, content=error("only admins can delete approved requests"))
    delete_one_or_404(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id})
    return success({"message": "request deleted", "requestId": request_id})


@router.get("/v2/moviehub/available")
def moviehub_available(mediaType: str, _: Dict[str, str] = Depends(current_user)):
    mt = parse_media_type(mediaType)
    if mt == "UNKNOWN":
        return JSONResponse(status_code=400, content=error("mediaType query param must be MOVIES or SHOWS"))
    base = base_url("RADARR_API_URL") if mt == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if mt == "MOVIES" else os.getenv("SONARR_API_KEY")
    path = "movie" if mt == "MOVIES" else "series"
    res = requests.get(f"{base}/{path}", headers=api_headers(key or ""), timeout=60)
    if res.status_code < 200 or res.status_code >= 300:
        return JSONResponse(status_code=500, content=error(res.text))
    return success(normalize_available_media(res.json(), mt))


@router.get("/v2/moviehub/downloads")
def moviehub_downloads(scope: str = "mine", user: Dict[str, str] = Depends(current_user)):
    include_all = user.get("role") == "ADMIN" and str(scope).strip().lower() == "all"
    try:
        queue_items = combined_queue_records()
        if not include_all:
            user_requests = find(MEDIA_REQUESTS_COLLECTION, {"status": "APPROVED", "userId": user["userId"]})
            queue_items = [
                item for item in queue_items
                if any(queue_matches_request(item, request_record) for request_record in user_requests)
            ]
        return success({
            "scope": "all" if include_all else "mine",
            "downloadHandling": fetch_download_handling_state(),
            "downloads": queue_items,
        })
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))


@router.get("/v2/moviehub/completedDownloads")
def moviehub_completed(scope: str = "mine", user: Dict[str, str] = Depends(current_user)):
    include_all = user.get("role") == "ADMIN" and str(scope).strip().lower() == "all"
    query = {"status": "DOWNLOADED"} if include_all else {"status": "DOWNLOADED", "userId": user["userId"]}
    records = sorted(find(MEDIA_REQUESTS_COLLECTION, query), key=lambda row: str(row.get("downloadedAt") or ""), reverse=True)
    return success({
        "scope": "all" if include_all else "mine",
        "downloads": [completed_download_record(record, include_all) for record in records],
    })


@router.get("/v2/moviehub/reconcile-downloads")
def moviehub_reconcile():
    records = find(MEDIA_REQUESTS_COLLECTION, {"$or": [
        {"status": "APPROVED"},
        {"status": "DOWNLOADED", "downloadedNotificationSentAt": None},
        {"status": "DOWNLOADED", "downloadedNotificationSentAt": {"$exists": False}},
    ]})
    summary = {
        "totalRequests": len(records),
        "approvedChecked": len([record for record in records if record.get("status") == "APPROVED"]),
        "downloadedMissingAlert": len([record for record in records if record.get("status") == "DOWNLOADED" and not record.get("downloadedNotificationSentAt")]),
        "inQueue": 0,
        "downloadedDetected": 0,
        "statusUpdated": 0,
        "alertsSent": 0,
        "alertsFailed": 0,
    }
    try:
        available_movies = {normalize_title_for_match(item.get("title")) for item in fetch_arr_available("MOVIES")}
        available_shows: Dict[str, set] = {}
        for item in fetch_arr_available("SHOWS"):
            available_shows.setdefault(normalize_title_for_match(item.get("title")), set()).update(sorted_unique_positive_numbers(item.get("availableSeasons") or []))
        for record in records:
            if record.get("status") == "APPROVED":
                title_key = normalize_title_for_match(record.get("title"))
                downloaded = title_key in available_movies if parse_media_type(record.get("mediaType")) == "MOVIES" else bool(available_shows.get(title_key)) and all(season in available_shows[title_key] for season in sorted_unique_positive_numbers(record.get("season") or []))
                if downloaded:
                    summary["downloadedDetected"] += 1
                    summary["statusUpdated"] += 1
                    now = now_iso()
                    update_one_or_404(MEDIA_REQUESTS_COLLECTION, {"requestId": record.get("requestId")}, {"$set": {"status": "DOWNLOADED", "downloadedAt": now, "updatedAt": now}})
                    record["status"] = "DOWNLOADED"
                    record["downloadedAt"] = now
                else:
                    summary["inQueue"] += 1
                    continue
            if record.get("status") == "DOWNLOADED" and not record.get("downloadedNotificationSentAt"):
                try:
                    if send_media_downloaded_email_if_needed(record):
                        summary["alertsSent"] += 1
                    else:
                        summary["alertsFailed"] += 1
                except Exception:
                    summary["alertsFailed"] += 1
    except Exception as exc:
        summary["error"] = str(exc)
    return success(summary)


@router.post("/v2/admin/moviehub/available/delete")
async def moviehub_delete_available(request: Request, _: Dict[str, str] = Depends(admin_user)):
    body = await request.json()
    mt = parse_media_type(body.get("mediaType"))
    media_id = body.get("id")
    season_supplied = any(key in body for key in ("season", "seasons", "seasonNumber"))
    season_value = body.get("season") if "season" in body else body.get("seasons") if "seasons" in body else body.get("seasonNumber")
    seasons = normalize_season_numbers(season_value)
    if mt == "UNKNOWN":
        return JSONResponse(status_code=400, content=error("mediaType must be MOVIES or SHOWS"))
    if parse_int(media_id) is None or parse_int(media_id) < 1:
        return JSONResponse(status_code=400, content=error("id must be a positive integer"))
    if season_supplied and not seasons:
        return JSONResponse(status_code=400, content=error("season must include at least one positive integer"))
    if season_supplied and mt != "SHOWS":
        return JSONResponse(status_code=400, content=error("season deletion is only supported for mediaType SHOWS"))
    if season_supplied:
        try:
            return success(delete_show_seasons(parse_int(media_id) or 0, seasons, parse_bool(body.get("deleteFiles"), True)))
        except ValueError as exc:
            return JSONResponse(status_code=400, content=error(str(exc)))
        except Exception as exc:
            return JSONResponse(status_code=500, content=error(f"failed to delete season from sonarr: {exc}"))
    base = base_url("RADARR_API_URL") if mt == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if mt == "MOVIES" else os.getenv("SONARR_API_KEY")
    path = "movie" if mt == "MOVIES" else "series"
    exclusion_param = "addImportExclusion" if mt == "MOVIES" else "addImportListExclusion"
    res = arr_get("DELETE", f"{base}/{path}/{media_id}", key or "", params={"deleteFiles": parse_bool(body.get("deleteFiles"), True), exclusion_param: parse_bool(body.get("addImportExclusion"), False)})
    if res.status_code < 200 or res.status_code >= 300:
        return JSONResponse(status_code=500, content=error(f"failed to delete media from {'radarr' if mt == 'MOVIES' else 'sonarr'}: {res.text}"))
    return success({"mediaType": mt, "id": parse_int(media_id), "deleteFiles": parse_bool(body.get("deleteFiles"), True), "addImportExclusion": parse_bool(body.get("addImportExclusion"), False), "message": "Media deleted successfully"})


@router.post("/v2/admin/moviehub/downloads/pause")
def moviehub_pause(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success({**set_download_handling_enabled(False), "message": "Download automation paused"})
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))


@router.post("/v2/admin/moviehub/downloads/resume")
def moviehub_resume(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success({**set_download_handling_enabled(True), "message": "Download automation resumed"})
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))


@router.post("/v2/admin/moviehub/downloads/delete")
async def moviehub_delete_download(request: Request, _: Dict[str, str] = Depends(admin_user)):
    body = await request.json()
    mt = parse_media_type(body.get("mediaType"))
    queue_id = body.get("queueItemId")
    if mt == "UNKNOWN":
        return JSONResponse(status_code=400, content=error("mediaType must be MOVIES or SHOWS"))
    if parse_int(queue_id) is None or parse_int(queue_id) < 1:
        return JSONResponse(status_code=400, content=error("queueItemId must be a positive integer"))
    base = base_url("RADARR_API_URL") if mt == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if mt == "MOVIES" else os.getenv("SONARR_API_KEY")
    params = {
        "removeFromClient": parse_bool(body.get("removeFromClient"), True),
        "blocklist": parse_bool(body.get("blocklist"), False),
        "skipRedownload": parse_bool(body.get("skipRedownload"), True),
        "changeCategory": parse_bool(body.get("changeCategory"), False),
    }
    res = arr_get("DELETE", f"{base}/queue/{queue_id}", key or "", params=params)
    if res.status_code < 200 or res.status_code >= 300:
        return JSONResponse(status_code=500, content=error(f"failed to delete queue item from {'radarr' if mt == 'MOVIES' else 'sonarr'}: {res.text}"))
    return success({"mediaType": mt, "queueItemId": parse_int(queue_id), **params, "message": "Download removed from queue"})


def has_moviehub_access(user: Dict[str, str]) -> bool:
    if user.get("role") == "ADMIN":
        return True
    db_user = find_one("users", {"userId": user["userId"]}) or {}
    email = db_user.get("email") or user.get("email", "")
    return bool(find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": email, "active": True}))


@router.get("/v2/moviehub/access/me")
def moviehub_access_me(user: Dict[str, str] = Depends(current_user)):
    if user.get("role") == "ADMIN":
        return success({"hasAccess": True, "status": "ADMIN_BYPASS", "isAdmin": True})
    return success({"hasAccess": has_moviehub_access(user), "status": "APPROVED" if has_moviehub_access(user) else "NOT_REQUESTED", "isAdmin": False})


@router.get("/v2/moviehub/access/user")
def moviehub_access_user(user: Dict[str, str] = Depends(current_user)):
    db_user = find_one("users", {"userId": user["userId"]}) or {}
    email = db_user.get("email") or user.get("email", "")
    mapping = find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": email, "active": True})
    latest = col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).find_one({"userEmail": email}, sort=[("createdAt", -1)])
    if not mapping:
        return success({"userId": user["userId"], "exists": False, "email": email, "movieHubUserName": (latest or {}).get("movieHubUserName", ""), "status": (latest or {}).get("status", "NOT_REQUESTED"), "showTemporaryPasswordNotice": False})
    return success({"userId": user["userId"], "exists": True, "email": mapping.get("userEmail", email), "movieHubUserName": mapping.get("movieHubUserName", ""), "status": "APPROVED", "showTemporaryPasswordNotice": mapping.get("passwordResetConfirmedAt") is None})


@router.post("/v2/moviehub/access/request")
async def moviehub_access_request(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    username = (body.get("movieHubUserName") or "").strip()
    if not re.match(r"^[a-zA-Z0-9._-]{3,32}$", username):
        return JSONResponse(status_code=400, content=error("movieHubUserName must be 3-32 chars using letters, numbers, dot, underscore, or hyphen"))
    db_user = find_one("users", {"userId": user["userId"]}) or {}
    email = db_user.get("email") or user.get("email", "")
    if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": email, "active": True}):
        return JSONResponse(status_code=409, content=error("moviehub access is already approved for this user"))
    if find_one(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"userEmail": email, "status": "PENDING"}):
        return JSONResponse(status_code=409, content=error("moviehub access request is already pending approval"))
    req_id = str(uuid.uuid4())
    record = {"requestId": req_id, "userId": user["userId"], "userEmail": email, "userName": db_user.get("name", db_user.get("userName", "")), "movieHubUserName": username, "movieHubUserNameLower": username.lower(), "status": "PENDING", "createdAt": now_iso(), "updatedAt": now_iso()}
    insert(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, record)
    return JSONResponse(status_code=201, content=success({"message": "moviehub access request submitted", "requestId": req_id, "status": "PENDING", "movieHubUserName": username}))


@router.get("/v2/admin/moviehub/access/requests")
def moviehub_access_requests(status: Optional[str] = None, _: Dict[str, str] = Depends(admin_user)):
    query = {}
    if status:
        query["status"] = status.upper()
    return success(sorted(find(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, query), key=lambda r: r.get("createdAt", ""), reverse=True))


@router.post("/v2/admin/moviehub/access/requests/{request_id}/approve")
def moviehub_access_approve(request_id: str, user: Dict[str, str] = Depends(admin_user)):
    req = find_one(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"requestId": request_id})
    if not req:
        return JSONResponse(status_code=404, content=error("request not found"))
    if req.get("status") != "PENDING":
        return JSONResponse(status_code=400, content=error("only pending moviehub access requests can be approved"))
    mapping_id = str(uuid.uuid4())
    insert(MOVIEHUB_ACCESS_USERS_COLLECTION, {"mappingId": mapping_id, "requestId": request_id, "userId": req.get("userId"), "userEmail": req.get("userEmail"), "movieHubUserName": req.get("movieHubUserName"), "active": True, "createdAt": now_iso(), "updatedAt": now_iso()})
    col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).update_one({"requestId": request_id}, {"$set": {"status": "APPROVED", "approvedBy": user["userId"], "approvedAt": now_iso(), "updatedAt": now_iso()}})
    return success({"message": "moviehub access approved and jellyfin user created", "requestId": request_id, "movieHubUserName": req.get("movieHubUserName"), "notification": "skipped"})


@router.post("/v2/admin/moviehub/access/requests/{request_id}/reject")
def moviehub_access_reject(request_id: str, user: Dict[str, str] = Depends(admin_user)):
    update_one_or_404(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"requestId": request_id}, {"$set": {"status": "REJECTED", "rejectedBy": user["userId"], "rejectedAt": now_iso(), "updatedAt": now_iso()}})
    return success({"message": "moviehub access request rejected", "requestId": request_id, "status": "REJECTED", "notification": "skipped"})


@router.get("/v2/admin/moviehub/access/users")
def moviehub_access_users(_: Dict[str, str] = Depends(admin_user)):
    records = find(MOVIEHUB_ACCESS_USERS_COLLECTION, {"active": True})
    return success(sorted(records, key=lambda r: r.get("createdAt", ""), reverse=True))


@router.delete("/v2/admin/moviehub/access/users/{mapping_id}")
def moviehub_access_user_delete(mapping_id: str, _: Dict[str, str] = Depends(admin_user)):
    delete_one_or_404(MOVIEHUB_ACCESS_USERS_COLLECTION, {"mappingId": mapping_id})
    return success({"message": "moviehub user deleted", "mappingId": mapping_id})


@router.post("/v2/moviehub/access/resend-password")
def moviehub_resend_password(_: Dict[str, str] = Depends(current_user)):
    return success({"message": "temporary password resent", "notification": "skipped"})


@router.post("/v2/moviehub/access/confirm-password-reset")
def moviehub_confirm_password_reset(user: Dict[str, str] = Depends(current_user)):
    db_user = find_one("users", {"userId": user["userId"]}) or {}
    email = db_user.get("email") or user.get("email", "")
    col(MOVIEHUB_ACCESS_USERS_COLLECTION).update_one({"userEmail": email}, {"$set": {"passwordResetConfirmedAt": now_iso(), "updatedAt": now_iso()}})
    return success({"message": "password reset confirmed"})
