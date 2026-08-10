import asyncio
import json
import base64
import hashlib
import logging
import os
import re
import secrets
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import bcrypt
import jwt
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import MEDIA_REQUESTS_COLLECTION, MOVIEHUB_ACCESS_REQUESTS_COLLECTION, MOVIEHUB_ACCESS_USERS_COLLECTION
from app.middlewares.auth import admin_user, current_user
from app.services.mongo import col, find, find_one, insert, update_one_or_404, delete_one_or_404
from app.services.moviehub_automation import *
from app.services.mail import send_brevo_email
from app.services.notifications import emit_notification
from app.services.action_tokens import mint_action_token, verify_action_token
from app.utils.http import api_headers, base_url
from app.utils.responses import error, now_iso, success

router = APIRouter()
logger = logging.getLogger(__name__)

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
    api_base = public_api_base_url()
    approve_token = mint_action_token("moviehub-request-approve", record["requestId"])
    reject_token = mint_action_token("moviehub-request-reject", record["requestId"])
    emit_notification(
        audience="ADMIN",
        title="New MovieHub request",
        message=f"{record.get('userName') or record.get('userEmail') or 'A user'} requested {title}.",
        severity="INFO",
        category="media_request",
        source="moviehub",
        action_url="/moviehub/admin/approvals",
        metadata={
            "requestId": record["requestId"],
            "mediaType": mt,
            "title": title,
            "ntfyActions": [
                {"label": "Approve", "url": f"{api_base}/v2/moviehub/requests/{record['requestId']}/quick-approve?token={approve_token}"},
                {"label": "Reject", "url": f"{api_base}/v2/moviehub/requests/{record['requestId']}/quick-reject?token={reject_token}"},
            ],
        },
    )
    return JSONResponse(status_code=201, content=success({"message": "request created", "requestId": record["requestId"], "status": "PENDING"}))


def formatted_requests(query: Dict[str, Any]) -> List[Dict[str, Any]]:
    return sorted(find(MEDIA_REQUESTS_COLLECTION, query), key=lambda r: r.get("createdAt", ""), reverse=True)


@router.get("/v2/moviehub/requests")
def moviehub_my_requests(user: Dict[str, str] = Depends(current_user)):
    return success(formatted_requests({"userId": user["userId"]}))


@router.get("/v2/admin/moviehub/requests")
def moviehub_all_requests(_: Dict[str, str] = Depends(admin_user)):
    return success(formatted_requests({}))


def _approve_media_request(request_id: str, actor_id: str):
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
    update_one_or_404(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id}, {"$set": {"status": "APPROVED", "approvedBy": actor_id, "approvedAt": now, "updatedAt": now}})
    record["status"] = "APPROVED"
    record["approvedBy"] = actor_id
    record["approvedAt"] = now
    try:
        send_media_approval_email(record)
        notification = "sent"
    except Exception:
        notification = "failed"
    emit_notification(
        audience="USER",
        target_user_id=record.get("userId"),
        title="MovieHub request approved",
        message=f"{record.get('title')} was approved and queued for download.",
        severity="SUCCESS",
        category="media_request",
        source="moviehub",
        action_url="/moviehub/downloads",
        metadata={"requestId": request_id, "mediaType": record.get("mediaType")},
    )
    return success({"message": "Request approved and media queued for download", "requestId": request_id, "notification": notification})


def _reject_media_request(request_id: str, actor_id: str):
    record = find_one(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id})
    if not record:
        return JSONResponse(status_code=404, content=error("request not found"))
    if record.get("status") != "PENDING":
        return JSONResponse(status_code=400, content=error("only pending requests can be rejected"))
    now = now_iso()
    update_one_or_404(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id}, {"$set": {"status": "REJECTED", "rejectedBy": actor_id, "rejectedAt": now, "updatedAt": now}})
    emit_notification(
        audience="USER",
        target_user_id=record.get("userId"),
        title="MovieHub request rejected",
        message=f"{record.get('title')} was not approved.",
        severity="WARNING",
        category="media_request",
        source="moviehub",
        action_url="/moviehub/requests",
        metadata={"requestId": request_id, "mediaType": record.get("mediaType")},
    )
    return success({"message": "request rejected", "requestId": request_id, "status": "REJECTED"})


@router.post("/v2/admin/moviehub/requests/{request_id}/approve")
def moviehub_approve_request(request_id: str, user: Dict[str, str] = Depends(admin_user)):
    return _approve_media_request(request_id, user["userId"])


@router.post("/v2/admin/moviehub/requests/{request_id}/reject")
def moviehub_reject_request(request_id: str, user: Dict[str, str] = Depends(admin_user)):
    return _reject_media_request(request_id, user["userId"])


@router.post("/v2/moviehub/requests/{request_id}/quick-approve")
def moviehub_quick_approve_request(request_id: str, token: str = Query(...)):
    if not verify_action_token("moviehub-request-approve", request_id, token):
        raise HTTPException(status_code=401, detail="Invalid or expired action token")
    return _confirm_quick_action("approval", "media_request", _approve_media_request(request_id, "ntfy-action"))


@router.post("/v2/moviehub/requests/{request_id}/quick-reject")
def moviehub_quick_reject_request(request_id: str, token: str = Query(...)):
    if not verify_action_token("moviehub-request-reject", request_id, token):
        raise HTTPException(status_code=401, detail="Invalid or expired action token")
    return _confirm_quick_action("rejection", "media_request", _reject_media_request(request_id, "ntfy-action"))


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


def resolve_jellyfin_media_item(jellyfin: str, body: Dict[str, Any]) -> Dict[str, Any]:
    title = str(body.get("title") or "").strip()
    media_type = parse_media_type(body.get("mediaType"))
    if not title or media_type == "UNKNOWN":
        raise ValueError("title and mediaType are required")

    include_type = "Movie" if media_type == "MOVIES" else "Series"
    res = requests.get(
        f"{jellyfin}/Items",
        params={
            "Recursive": "true",
            "SearchTerm": title,
            "IncludeItemTypes": include_type,
            "Fields": "ProviderIds,ProductionYear",
            "Limit": 50,
        },
        headers=jellyfin_headers(),
        timeout=30,
    )
    if not res.ok:
        raise RuntimeError(f"failed to search Jellyfin library: {res.text[:300]}")
    candidates = res.json().get("Items") or []

    expected_ids = {
        "Imdb": str(body.get("imdbId") or "").strip().lower(),
        "Tmdb": str(body.get("tmdbId") or "").strip().lower(),
        "Tvdb": str(body.get("tvdbId") or "").strip().lower(),
    }

    def match_score(item: Dict[str, Any]) -> int:
        providers = item.get("ProviderIds") or {}
        score = 0
        for provider, expected in expected_ids.items():
            actual = str(providers.get(provider) or "").strip().lower()
            if expected and actual == expected:
                score += 20
        if str(item.get("Name") or "").strip().lower() == title.lower():
            score += 5
        if body.get("year") and str(item.get("ProductionYear") or "") == str(body.get("year")):
            score += 2
        return score

    matched = max(candidates, key=match_score, default=None)
    if not matched or match_score(matched) <= 0:
        raise LookupError(f"{title} was not found in the Jellyfin library")

    if media_type == "SHOWS":
        episodes_res = requests.get(
            f"{jellyfin}/Items",
            params={
                "ParentId": matched.get("Id"),
                "Recursive": "true",
                "IncludeItemTypes": "Episode",
                "IsMissing": "false",
                "SortBy": "ParentIndexNumber,IndexNumber",
                "SortOrder": "Ascending",
                "Limit": 1,
            },
            headers=jellyfin_headers(),
            timeout=30,
        )
        if not episodes_res.ok:
            raise RuntimeError(f"failed to resolve a playable episode: {episodes_res.text[:300]}")
        episodes = episodes_res.json().get("Items") or []
        if not episodes:
            raise LookupError(f"No playable episodes were found for {title}")
        return episodes[0]

    return matched


@router.post("/v2/moviehub/play")
async def moviehub_play(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return await asyncio.to_thread(_moviehub_play_sync, body, user)


def _moviehub_play_sync(body: Dict[str, Any], user: Dict[str, str]):
    username = str(body.get("username") or "").strip()
    if not username:
        return JSONResponse(status_code=400, content=error("MovieHub username is required"))

    if user.get("role") != "ADMIN":
        mapping = find_one(
            MOVIEHUB_ACCESS_USERS_COLLECTION,
            {
                "userId": user.get("userId"),
                "movieHubUserNameLower": username.lower(),
                "active": True,
            },
        )
        if not mapping:
            return JSONResponse(status_code=403, content=error("MovieHub access mapping was not found"))

    try:
        jellyfin = require_jellyfin_config()
        jellyfin_user = fetch_jellyfin_user_by_name(username)
        if not jellyfin_user or not jellyfin_user.get("Id"):
            raise LookupError("MovieHub user is not available in Jellyfin")

        item = resolve_jellyfin_media_item(jellyfin, body)
        sessions_res = requests.get(
            f"{jellyfin}/Sessions",
            params={"ControllableByUserId": jellyfin_user["Id"]},
            headers=jellyfin_headers(),
            timeout=30,
        )
        if not sessions_res.ok:
            raise RuntimeError(f"failed to find the active player: {sessions_res.text[:300]}")
        sessions = [
            session
            for session in sessions_res.json()
            if session.get("Id") and session.get("SupportsRemoteControl", True)
        ]
        if not sessions:
            raise LookupError("Open the Watch tab once to prepare the MovieHub player")

        session = max(
            sessions,
            key=lambda value: str(value.get("LastActivityDate") or ""),
        )
        play_res = requests.post(
            f"{jellyfin}/Sessions/{session['Id']}/Playing",
            params={
                "playCommand": "PlayNow",
                "itemIds": item["Id"],
                "startPositionTicks": 0,
            },
            headers=jellyfin_headers(),
            timeout=30,
        )
        if not play_res.ok:
            raise RuntimeError(f"Jellyfin could not start playback: {play_res.text[:300]}")
        return success({
            "message": "Playback started",
            "itemId": item.get("Id"),
            "title": item.get("Name") or body.get("title"),
        })
    except LookupError as exc:
        return JSONResponse(status_code=404, content=error(str(exc)))
    except Exception as exc:
        logger.exception("MovieHub playback failed")
        return JSONResponse(status_code=500, content=error(str(exc)))


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
                    emit_notification(
                        audience="USER",
                        target_user_id=record.get("userId"),
                        title="MovieHub download completed",
                        message=f"{record.get('title')} is now available in MovieHub.",
                        severity="SUCCESS",
                        category="media_download",
                        source="moviehub",
                        action_url="/moviehub/watch",
                        metadata={
                            "requestId": record.get("requestId"),
                            "mediaType": record.get("mediaType"),
                        },
                    )
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


def moviehub_crypto_key() -> bytes:
    secret = (os.getenv("MOVIEHUB_ACCESS_SECRET") or os.getenv("JWT_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("MOVIEHUB_ACCESS_SECRET is not configured")
    return hashlib.sha256(secret.encode("utf-8")).digest()


def encrypt_temp_password(password: str) -> str:
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(moviehub_crypto_key()).encrypt(nonce, password.encode("utf-8"), None)
    return f"{base64.b64encode(nonce).decode('ascii')}:{base64.b64encode(encrypted).decode('ascii')}"


def decrypt_temp_password(payload: str) -> str:
    if not payload or ":" not in payload:
        raise RuntimeError("temporary password is missing")
    nonce_text, encrypted_text = payload.split(":", 1)
    nonce = base64.b64decode(nonce_text)
    encrypted = base64.b64decode(encrypted_text)
    return AESGCM(moviehub_crypto_key()).decrypt(nonce, encrypted, None).decode("utf-8")


def generate_temp_password() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(12))


def jellyfin_headers() -> Dict[str, str]:
    api_key = os.getenv("JELLYFIN_API_KEY", "")
    return {
        "accept": "application/json",
        "Content-Type": "application/json",
        "authorization": (
            'MediaBrowser Client="ToolHub", Device="ToolHub", '
            f'DeviceId="toolhub-web", Version="10.11.5", Token="{api_key}"'
        ),
        "X-Emby-Token": api_key,
        "X-MediaBrowser-Token": api_key,
        "X-Api-Key": api_key,
    }


def require_jellyfin_config() -> str:
    jellyfin = base_url("JELLYFIN_BASE_URL")
    if not jellyfin or not os.getenv("JELLYFIN_API_KEY"):
        raise RuntimeError("JELLYFIN_BASE_URL/JELLYFIN_API_KEY is not configured")
    return jellyfin


def fetch_jellyfin_user_by_name(username: str) -> Optional[Dict[str, Any]]:
    jellyfin = require_jellyfin_config()
    res = requests.get(f"{jellyfin}/Users", headers=jellyfin_headers(), timeout=30)
    if res.status_code < 200 or res.status_code >= 300:
        raise RuntimeError(f"failed to fetch jellyfin users: {res.text[:300]}")
    for item in res.json() or []:
        if str(item.get("Name") or "").lower() == username.lower():
            return item
    return None


def update_jellyfin_user_password(user_id: str, password: str) -> None:
    jellyfin = require_jellyfin_config()
    res = requests.post(
        f"{jellyfin}/Users/{user_id}/Password",
        headers=jellyfin_headers(),
        json={"CurrentPw": "", "NewPw": password, "ResetPassword": False},
        timeout=30,
    )
    if res.status_code < 200 or res.status_code >= 300:
        raise RuntimeError(f"failed to update existing jellyfin user password: {res.text[:300]}")


def create_jellyfin_user(username: str, password: str) -> Dict[str, Any]:
    jellyfin = require_jellyfin_config()
    existing_user = fetch_jellyfin_user_by_name(username)
    if existing_user:
        user_id = existing_user.get("Id")
        if not user_id:
            raise RuntimeError("existing jellyfin user id is missing")
        update_jellyfin_user_password(user_id, password)
        return existing_user
    res = requests.post(
        f"{jellyfin}/Users/New",
        headers=jellyfin_headers(),
        json={"Name": username, "Password": password},
        timeout=30,
    )
    if 200 <= res.status_code < 300:
        body = res.json() if res.text else {}
        if body.get("Id"):
            return body
        existing = fetch_jellyfin_user_by_name(username)
        if existing:
            return existing
        raise RuntimeError("created jellyfin user but user id was not returned")
    response_text = res.text or ""
    if res.status_code in {400, 409} and any(token in response_text.lower() for token in ("already exists", "already in use", "duplicate")):
        existing = fetch_jellyfin_user_by_name(username)
        if existing:
            user_id = existing.get("Id")
            if not user_id:
                raise RuntimeError("existing jellyfin user id is missing")
            update_jellyfin_user_password(user_id, password)
            return existing
    logger.warning(
        "Jellyfin user create failed username=%s status=%s body=%s",
        username,
        res.status_code,
        response_text[:300],
    )
    raise RuntimeError(f"failed to create jellyfin user: {response_text[:300]}")


def delete_jellyfin_user(user_id: Optional[str], username: Optional[str] = None) -> None:
    jellyfin = require_jellyfin_config()
    resolved_user_id = (user_id or "").strip()
    if not resolved_user_id and username:
        existing_user = fetch_jellyfin_user_by_name(username)
        resolved_user_id = str((existing_user or {}).get("Id") or "").strip()
    if not resolved_user_id:
        return
    res = requests.delete(f"{jellyfin}/Users/{resolved_user_id}", headers=jellyfin_headers(), timeout=30)
    if res.status_code == 404:
        return
    if res.status_code < 200 or res.status_code >= 300:
        raise RuntimeError(f"failed to delete jellyfin user: {res.text[:300]}")


def normalized_library_name(folder: Dict[str, Any]) -> str:
    return re.sub(r"\s+", " ", str(folder.get("Name") or "").strip().lower())


def library_item_id(folder: Dict[str, Any]) -> Optional[str]:
    item_id = folder.get("ItemId") or folder.get("Id")
    return str(item_id).strip() if item_id else None


def resolve_jellyfin_allowed_library_ids(folders: List[Dict[str, Any]]) -> List[str]:
    movies_id: Optional[str] = None
    tv_shows_id: Optional[str] = None

    for folder in folders:
        item_id = library_item_id(folder)
        if not item_id:
            continue
        name = normalized_library_name(folder)
        if movies_id is None and name == "movies":
            movies_id = item_id
        if tv_shows_id is None and name in {"tv shows", "tvshows"}:
            tv_shows_id = item_id

    if not movies_id or not tv_shows_id:
        raise RuntimeError("failed to locate exact Movies/TV Shows libraries in Jellyfin")

    return [movies_id, tv_shows_id]


def enforce_jellyfin_limited_library_access(user_id: str) -> None:
    jellyfin = require_jellyfin_config()
    folders_res = requests.get(f"{jellyfin}/Library/VirtualFolders", headers=jellyfin_headers(), timeout=30)
    if folders_res.status_code < 200 or folders_res.status_code >= 300:
        raise RuntimeError(f"failed to fetch jellyfin libraries: {folders_res.text[:300]}")
    folders = folders_res.json() or []
    allowed = resolve_jellyfin_allowed_library_ids(folders)
    blocked = [
        library_item_id(folder)
        for folder in folders
        if library_item_id(folder) and library_item_id(folder) not in set(allowed)
    ]
    user_res = requests.get(f"{jellyfin}/Users/{user_id}", headers=jellyfin_headers(), timeout=30)
    if user_res.status_code < 200 or user_res.status_code >= 300:
        raise RuntimeError(f"failed to fetch jellyfin user policy: {user_res.text[:300]}")
    policy = (user_res.json() or {}).get("Policy") or {}
    policy.update({
        "EnableAllFolders": False,
        "EnabledFolders": allowed,
        "BlockedMediaFolders": blocked,
        "EnableLiveTvAccess": False,
        "EnableLiveTvManagement": False,
        "EnableAllChannels": False,
        "EnabledChannels": [],
    })
    policy_res = requests.post(f"{jellyfin}/Users/{user_id}/Policy", headers=jellyfin_headers(), json=policy, timeout=30)
    if policy_res.status_code < 200 or policy_res.status_code >= 300:
        raise RuntimeError(f"failed to update jellyfin user policy: {policy_res.text[:300]}")


def moviehub_portal_url() -> str:
    return (os.getenv("JELLYFIN_PUBLIC_URL") or os.getenv("JELLYFIN_BASE_URL") or "https://openmovies.hostingfrompurva.xyz").strip().rstrip("/")


def toolhub_moviehub_url() -> str:
    return (os.getenv("MOVIEHUB_PORTAL_URL") or "https://hostingfrompurva.xyz/moviehub").strip().rstrip("/")


def public_api_base_url() -> str:
    return (os.getenv("PUBLIC_API_BASE_URL") or "https://hostingfrompurva.xyz/api").strip().rstrip("/")


def _confirm_quick_action(action_label: str, category: str, result: Any) -> Any:
    """Push a follow-up ADMIN notification so a ntfy button tap always has visible
    feedback, since the ntfy iOS app doesn't reliably reflect the tap itself."""
    if isinstance(result, JSONResponse):
        try:
            detail = json.loads(bytes(result.body)).get("error", "action failed")
        except Exception:
            detail = "action failed"
        emit_notification(
            audience="ADMIN",
            title=f"MovieHub {action_label} failed",
            message=detail,
            severity="ERROR",
            category=category,
            source="moviehub-quick-action",
        )
        return result
    message = ((result or {}).get("response") or {}).get("message") or f"{action_label} completed."
    emit_notification(
        audience="ADMIN",
        title=f"MovieHub {action_label} confirmed",
        message=message,
        severity="SUCCESS",
        category=category,
        source="moviehub-quick-action",
    )
    return result


def build_moviehub_access_email(req: Dict[str, Any], password: str) -> str:
    name = escape(req.get("userName") or "there")
    username = escape(req.get("movieHubUserName") or "")
    safe_password = escape(password)
    jellyfin_url = escape(moviehub_portal_url())
    toolhub_url = escape(toolhub_moviehub_url())
    return f"""
    <html><body style="margin:0;padding:0;background:#edf2f7;font-family:Segoe UI,Arial,sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf2f7;padding:16px 8px;">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-radius:16px;overflow:hidden;border:1px solid #d9e2f1;background:#ffffff;">
            <tr><td style="padding:20px 20px 8px;"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#1d4ed8;font-size:12px;font-weight:700;color:#fff;">MovieHub Access Approved</span></td></tr>
            <tr><td style="padding:0 20px 8px;font-size:32px;line-height:1.25;color:#0f172a;font-weight:700;">Welcome to MovieHub, {name}</td></tr>
            <tr><td style="padding:0 20px 16px;font-size:17px;line-height:1.6;color:#334155;">Your access request has been approved. Use the credentials below to sign in to your Jellyfin media portal.</td></tr>
            <tr><td style="padding:0 20px 10px;font-size:18px;line-height:1.5;color:#334155;"><strong>MovieHub Username:</strong> {username}</td></tr>
            <tr><td style="padding:0 20px 10px;font-size:18px;line-height:1.5;color:#334155;"><strong>Temporary Password:</strong> {safe_password}</td></tr>
            <tr><td style="padding:0 20px 10px;font-size:16px;line-height:1.5;color:#334155;"><strong>Portal URL:</strong> <a href="{jellyfin_url}" style="color:#1d4ed8;">{jellyfin_url}</a></td></tr>
            <tr><td style="padding:0 20px 10px;font-size:16px;line-height:1.5;color:#334155;">For requests, status, and chat automation, visit <a href="{toolhub_url}" style="color:#1d4ed8;">{toolhub_url}</a>.</td></tr>
            <tr><td style="padding:8px 20px 20px;font-size:14px;line-height:1.5;color:#64748b;">For security, please reset your password after your first login.</td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """


def send_moviehub_credentials_email(req: Dict[str, Any], password: str) -> None:
    recipient = req.get("userEmail")
    if not recipient:
        raise RuntimeError("request email missing")
    send_brevo_email("MovieHub access approved", recipient, build_moviehub_access_email(req, password))


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
    if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"movieHubUserNameLower": username.lower(), "active": True}):
        return JSONResponse(status_code=409, content=error("moviehub username is already in use"))
    if find_one(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"movieHubUserNameLower": username.lower(), "status": "PENDING"}):
        return JSONResponse(status_code=409, content=error("moviehub username is already in use"))
    try:
        temporary_password = generate_temp_password()
        encrypted_password = encrypt_temp_password(temporary_password)
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(f"failed to secure temporary password: {exc}"))
    req_id = str(uuid.uuid4())
    record = {"requestId": req_id, "userId": user["userId"], "userEmail": email, "userName": db_user.get("name", db_user.get("userName", "")), "movieHubUserName": username, "movieHubUserNameLower": username.lower(), "encryptedPassword": encrypted_password, "status": "PENDING", "createdAt": now_iso(), "updatedAt": now_iso()}
    insert(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, record)
    api_base = public_api_base_url()
    approve_token = mint_action_token("moviehub-access-approve", req_id)
    reject_token = mint_action_token("moviehub-access-reject", req_id)
    emit_notification(
        audience="ADMIN",
        title="MovieHub access requested",
        message=f"{record.get('userName') or email or 'A user'} requested access as {username}.",
        severity="INFO",
        category="access",
        source="moviehub",
        action_url="/moviehub/admin/access",
        metadata={
            "requestId": req_id,
            "userId": user["userId"],
            "ntfyActions": [
                {"label": "Approve", "url": f"{api_base}/v2/moviehub/access/requests/{req_id}/quick-approve?token={approve_token}"},
                {"label": "Reject", "url": f"{api_base}/v2/moviehub/access/requests/{req_id}/quick-reject?token={reject_token}"},
            ],
        },
    )
    return JSONResponse(status_code=201, content=success({"message": "moviehub access request submitted", "requestId": req_id, "status": "PENDING", "movieHubUserName": username}))


@router.get("/v2/admin/moviehub/access/requests")
def moviehub_access_requests(status: Optional[str] = None, _: Dict[str, str] = Depends(admin_user)):
    query = {}
    if status:
        query["status"] = status.upper()
    return success(sorted(find(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, query), key=lambda r: r.get("createdAt", ""), reverse=True))


def _approve_moviehub_access(request_id: str, actor_id: str):
    req = find_one(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"requestId": request_id})
    if not req:
        return JSONResponse(status_code=404, content=error("request not found"))
    if req.get("status") != "PENDING":
        return JSONResponse(status_code=400, content=error("only pending moviehub access requests can be approved"))
    if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": req.get("userEmail"), "active": True}):
        return JSONResponse(status_code=409, content=error("user already has moviehub access"))
    if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"movieHubUserNameLower": req.get("movieHubUserNameLower"), "active": True}):
        return JSONResponse(status_code=409, content=error("moviehub username is already in use"))
    try:
        if req.get("encryptedPassword"):
            temporary_password = decrypt_temp_password(req.get("encryptedPassword"))
        else:
            temporary_password = generate_temp_password()
            encrypted_password = encrypt_temp_password(temporary_password)
            col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).update_one({"requestId": request_id}, {"$set": {"encryptedPassword": encrypted_password, "updatedAt": now_iso()}})
            req["encryptedPassword"] = encrypted_password
        jellyfin_user = create_jellyfin_user(req.get("movieHubUserName", ""), temporary_password)
        jellyfin_user_id = jellyfin_user.get("Id")
        if not jellyfin_user_id:
            raise RuntimeError("jellyfin user id is missing")
        enforce_jellyfin_limited_library_access(jellyfin_user_id)
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))
    try:
        send_moviehub_credentials_email(req, temporary_password)
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(f"failed to send credentials email: {exc}"))
    mapping_id = str(uuid.uuid4())
    now = now_iso()
    insert(MOVIEHUB_ACCESS_USERS_COLLECTION, {"mappingId": mapping_id, "requestId": request_id, "userId": req.get("userId"), "userEmail": req.get("userEmail"), "userName": req.get("userName"), "movieHubUserName": req.get("movieHubUserName"), "movieHubUserNameLower": req.get("movieHubUserNameLower"), "jellyfinUserId": jellyfin_user_id, "approvedBy": actor_id, "approvedAt": now, "passwordResetConfirmedAt": None, "active": True, "createdAt": now, "updatedAt": now})
    col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).update_one({"requestId": request_id}, {"$set": {"status": "APPROVED", "approvedBy": actor_id, "approvedAt": now, "jellyfinUserId": jellyfin_user_id, "credentialsSentAt": now, "updatedAt": now}})
    emit_notification(
        audience="USER",
        target_user_id=req.get("userId"),
        title="MovieHub access approved",
        message="Your MovieHub access was approved. Your sign-in details were sent by email.",
        severity="SUCCESS",
        category="access",
        source="moviehub",
        action_url="/moviehub",
        metadata={"requestId": request_id},
    )
    return success({"message": "moviehub access approved and jellyfin user created", "requestId": request_id, "movieHubUserName": req.get("movieHubUserName"), "notification": "sent"})


def _reject_moviehub_access(request_id: str, actor_id: str):
    req = find_one(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"requestId": request_id})
    if not req:
        return JSONResponse(status_code=404, content=error("request not found"))
    if req.get("status") != "PENDING":
        return JSONResponse(status_code=400, content=error("only pending moviehub access requests can be rejected"))
    update_one_or_404(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"requestId": request_id}, {"$set": {"status": "REJECTED", "rejectedBy": actor_id, "rejectedAt": now_iso(), "updatedAt": now_iso()}})
    emit_notification(
        audience="USER",
        target_user_id=req.get("userId"),
        title="MovieHub access request updated",
        message="Your MovieHub access request was not approved.",
        severity="WARNING",
        category="access",
        source="moviehub",
        action_url="/moviehub",
        metadata={"requestId": request_id},
    )
    return success({"message": "moviehub access request rejected", "requestId": request_id, "status": "REJECTED", "notification": "skipped"})


@router.post("/v2/admin/moviehub/access/requests/{request_id}/approve")
def moviehub_access_approve(request_id: str, user: Dict[str, str] = Depends(admin_user)):
    return _approve_moviehub_access(request_id, user["userId"])


@router.post("/v2/admin/moviehub/access/requests/{request_id}/reject")
def moviehub_access_reject(request_id: str, user: Dict[str, str] = Depends(admin_user)):
    return _reject_moviehub_access(request_id, user["userId"])


@router.post("/v2/moviehub/access/requests/{request_id}/quick-approve")
def moviehub_access_quick_approve(request_id: str, token: str = Query(...)):
    if not verify_action_token("moviehub-access-approve", request_id, token):
        raise HTTPException(status_code=401, detail="Invalid or expired action token")
    return _confirm_quick_action("access approval", "access", _approve_moviehub_access(request_id, "ntfy-action"))


@router.post("/v2/moviehub/access/requests/{request_id}/quick-reject")
def moviehub_access_quick_reject(request_id: str, token: str = Query(...)):
    if not verify_action_token("moviehub-access-reject", request_id, token):
        raise HTTPException(status_code=401, detail="Invalid or expired action token")
    return _confirm_quick_action("access rejection", "access", _reject_moviehub_access(request_id, "ntfy-action"))


@router.get("/v2/admin/moviehub/access/users")
def moviehub_access_users(_: Dict[str, str] = Depends(admin_user)):
    records = find(MOVIEHUB_ACCESS_USERS_COLLECTION, {"active": True})
    user_ids = [record.get("userId") for record in records if record.get("userId")]
    role_by_user_id = {
        user.get("userId"): str(user.get("role") or "USER").upper()
        for user in find("users", {"userId": {"$in": user_ids}})
        if user.get("userId")
    }
    tagged_records = []
    for record in records:
        role_tag = role_by_user_id.get(record.get("userId"), "USER")
        tagged = dict(record)
        tagged["roleTag"] = "ADMIN" if role_tag == "ADMIN" else "USER"
        tagged["isAdmin"] = tagged["roleTag"] == "ADMIN"
        tagged_records.append(tagged)
    return success(sorted(tagged_records, key=lambda r: r.get("createdAt", ""), reverse=True))


@router.delete("/v2/admin/moviehub/access/users/{mapping_id}")
def moviehub_access_user_delete(mapping_id: str, _: Dict[str, str] = Depends(admin_user)):
    mapping = find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"mappingId": mapping_id, "active": True})
    if not mapping:
        return JSONResponse(status_code=404, content=error("moviehub access user not found"))
    try:
        delete_jellyfin_user(mapping.get("jellyfinUserId"), mapping.get("movieHubUserName"))
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))
    delete_one_or_404(MOVIEHUB_ACCESS_USERS_COLLECTION, {"mappingId": mapping_id})
    return success({"message": "moviehub user deleted", "mappingId": mapping_id})


@router.post("/v2/moviehub/access/resend-password")
def moviehub_resend_password(user: Dict[str, str] = Depends(current_user)):
    db_user = find_one("users", {"userId": user["userId"]}) or {}
    email = db_user.get("email") or user.get("email", "")
    mapping = find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": email, "active": True})
    if not mapping:
        return JSONResponse(status_code=403, content=error("moviehub access is not approved for this user"))
    req = col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).find_one({"userEmail": email, "status": "APPROVED"}, sort=[("createdAt", -1)])
    if not req:
        return JSONResponse(status_code=404, content=error("no approved moviehub access request found"))
    try:
        temporary_password = decrypt_temp_password(req.get("encryptedPassword"))
        req = json.loads(json.dumps(req, default=str))
        req["movieHubUserName"] = mapping.get("movieHubUserName", req.get("movieHubUserName"))
        send_moviehub_credentials_email(req, temporary_password)
        now = now_iso()
        col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).update_one({"requestId": req.get("requestId")}, {"$set": {"credentialsSentAt": now, "updatedAt": now}})
        col(MOVIEHUB_ACCESS_USERS_COLLECTION).update_one({"mappingId": mapping.get("mappingId")}, {"$set": {"passwordResetConfirmedAt": None, "updatedAt": now}})
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(f"failed to resend temporary password: {exc}"))
    return success({"message": "temporary password resent to your email", "notification": "sent"})


@router.post("/v2/moviehub/access/confirm-password-reset")
def moviehub_confirm_password_reset(user: Dict[str, str] = Depends(current_user)):
    db_user = find_one("users", {"userId": user["userId"]}) or {}
    email = db_user.get("email") or user.get("email", "")
    col(MOVIEHUB_ACCESS_USERS_COLLECTION).update_one({"userEmail": email}, {"$set": {"passwordResetConfirmedAt": now_iso(), "updatedAt": now_iso()}})
    return success({"message": "password reset confirmed"})
