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

from app.core.config import JWT_ISSUER, JWT_SECRET, MOVIEHUB_ACCESS_USERS_COLLECTION
from app.services.mongo import find_one
from app.utils.responses import error

async def moviehub_access_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    guarded = (
        path.startswith("/v2/moviehub/")
        and not path.startswith("/v2/moviehub/access")
        and path != "/v2/moviehub/reconcile-downloads"
    )
    if not guarded:
        return await call_next(request)
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse(status_code=401, content=error("Missing or invalid Authorization header"))
    try:
        payload = jwt.decode(auth.removeprefix("Bearer ").strip(), JWT_SECRET, algorithms=["HS256"], issuer=JWT_ISSUER)
    except Exception:
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
