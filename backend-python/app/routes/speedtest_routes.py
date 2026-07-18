import os
import threading
import time
import uuid
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.utils.responses import success

router = APIRouter()
SESSION_TTL_SECONDS = 300
# Timed tests use adaptive parallel samples. These caps bound one public
# session while leaving enough headroom to measure fast local connections.
DOWNLOAD_LIMIT_BYTES = 1024 * 1024 * 1024
UPLOAD_LIMIT_BYTES = 512 * 1024 * 1024
DOWNLOAD_CHUNK = os.urandom(256 * 1024)
sessions: Dict[str, Dict[str, Any]] = {}
last_session_by_client: Dict[str, float] = {}
session_lock = threading.Lock()


def cleanup_sessions(now: float) -> None:
    expired = [key for key, value in sessions.items() if value["expiresAt"] <= now]
    for key in expired:
        sessions.pop(key, None)


def client_identifier(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded_for:
        return forwarded_for
    return request.client.host if request.client else "anonymous"


def require_session(session_id: str, client_id: str) -> Dict[str, Any]:
    now = time.time()
    with session_lock:
        cleanup_sessions(now)
        session = sessions.get(session_id)
        if not session or session["clientId"] != client_id:
            raise HTTPException(status_code=404, detail="Speed test session was not found or has expired")
        return session


@router.post("/v2/speedtest/session")
def speedtest_session(request: Request):
    now = time.time()
    client_id = client_identifier(request)
    with session_lock:
        cleanup_sessions(now)
        if now - last_session_by_client.get(client_id, 0) < 10:
            raise HTTPException(status_code=429, detail="Wait a few seconds before starting another speed test")
        session_id = uuid.uuid4().hex
        sessions[session_id] = {
            "clientId": client_id,
            "expiresAt": now + SESSION_TTL_SECONDS,
            "downloadedBytes": 0,
            "uploadedBytes": 0,
        }
        last_session_by_client[client_id] = now
    return success({"sessionId": session_id, "expiresInSeconds": SESSION_TTL_SECONDS})


@router.get("/v2/speedtest/ping")
def speedtest_ping(
    request: Request,
    session: str = Query(min_length=16, max_length=64),
):
    require_session(session, client_identifier(request))
    return success({"serverTimeMs": round(time.time() * 1000)})


@router.get("/v2/speedtest/download")
def speedtest_download(
    request: Request,
    session: str = Query(min_length=16, max_length=64),
    bytes: int = Query(default=512 * 1024, ge=64 * 1024, le=32 * 1024 * 1024),
):
    state = require_session(session, client_identifier(request))
    with session_lock:
        if state["downloadedBytes"] + bytes > DOWNLOAD_LIMIT_BYTES:
            raise HTTPException(status_code=429, detail="Speed test download limit reached")
        state["downloadedBytes"] += bytes

    def stream():
        remaining = bytes
        while remaining:
            chunk = DOWNLOAD_CHUNK[: min(len(DOWNLOAD_CHUNK), remaining)]
            remaining -= len(chunk)
            yield chunk

    return StreamingResponse(
        stream(),
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Content-Length": str(bytes),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/v2/speedtest/upload")
async def speedtest_upload(
    request: Request,
    session: str = Query(min_length=16, max_length=64),
):
    state = require_session(session, client_identifier(request))
    declared = int(request.headers.get("content-length") or 0)
    if declared <= 0:
        raise HTTPException(status_code=411, detail="Content-Length is required")
    if declared > 32 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Upload sample is too large")
    with session_lock:
        if state["uploadedBytes"] + declared > UPLOAD_LIMIT_BYTES:
            raise HTTPException(status_code=429, detail="Speed test upload limit reached")
        state["uploadedBytes"] += declared
    received = 0
    try:
        async for chunk in request.stream():
            received += len(chunk)
            if received > declared:
                raise HTTPException(status_code=400, detail="Upload exceeded declared size")
    finally:
        if received != declared:
            with session_lock:
                state["uploadedBytes"] = max(0, state["uploadedBytes"] - declared + received)
    return success({"receivedBytes": received})
