import json
import os
import re
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import bcrypt
import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import MOVIEHUB_ACCESS_USERS_COLLECTION
from app.middlewares.auth import request_user
from app.services.mongo import find_one
from app.utils.responses import error

async def moviehub_access_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    is_quick_action = path.startswith("/v2/moviehub/requests/") and path.endswith(("/quick-approve", "/quick-reject"))
    guarded = (
        path.startswith("/v2/moviehub/")
        and not path.startswith("/v2/moviehub/access")
        and path != "/v2/moviehub/reconcile-downloads"
        and not is_quick_action
    )
    if not guarded:
        return await call_next(request)
    try:
        payload = request_user(request, request.headers.get("Authorization"))
    except HTTPException:
        return JSONResponse(status_code=401, content=error("Invalid token"))
    if payload.get("role", "").upper() == "ADMIN":
        return await call_next(request)
    user_id = payload.get("userId", "")
    db_user = find_one("users", {"userId": user_id}) or {}
    email = db_user.get("email") or payload.get("email", "")
    if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": email, "active": True}):
        return await call_next(request)
    return JSONResponse(
        status_code=403,
        content=error("moviehub access is not approved. Please request access first."),
    )
