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

from app.core.config import ACCESS_TOKEN_TTL_MINUTES, DEFAULT_PROFILE_PICTURE, JWT_ISSUER, JWT_SECRET, REFRESH_TOKEN_TTL_DAYS
from app.services.mongo import col, find, find_one, insert
from app.utils.responses import jsonable, now_iso

def make_token(user_id: str, role: str, email: str, token_type: str, ttl: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": now + ttl,
        "userId": user_id,
        "role": role,
        "email": email or "",
        "tokenType": token_type,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def issue_tokens(user_id: str, role: str, email: str) -> Dict[str, str]:
    access = make_token(user_id, role, email, "access", timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES))
    refresh = make_token(user_id, role, email, "refresh", timedelta(days=REFRESH_TOKEN_TTL_DAYS))
    refresh_hash = bcrypt.hashpw(refresh.encode(), bcrypt.gensalt()).decode()
    col("authprovider").find_one_and_update(
        {"userId": user_id},
        {"$set": {"refreshTokenHash": refresh_hash, "refreshTokenExpiresAt": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_TTL_DAYS), "updatedAt": now_iso()}},
    )
    return {"token": access, "accessToken": access, "refreshToken": refresh}


def current_user(authorization: Optional[str] = Header(None)) -> Dict[str, str]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], issuer=JWT_ISSUER)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    if payload.get("tokenType") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return {
        "userId": payload.get("userId", ""),
        "role": payload.get("role", "USER"),
        "email": payload.get("email", ""),
    }


def admin_user(user: Dict[str, str] = Depends(current_user)) -> Dict[str, str]:
    if user.get("role", "").upper() != "ADMIN":
        raise HTTPException(status_code=403, detail="Forbidden: Insufficient permissions")
    return user


def user_info(user: Dict[str, Any]) -> Dict[str, Any]:
    clean = dict(user)
    clean.pop("_id", None)
    clean.pop("createdAt", None)
    clean.pop("updatedAt", None)
    return jsonable(clean)


def login_type(body: Dict[str, Any]) -> str:
    return (body.get("type") or body.get("provider") or "base").strip().lower()


def validate_google_token(google_token: str) -> Dict[str, str]:
    google_client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    if not google_client_id:
        raise HTTPException(status_code=500, detail="google login is not configured")
    try:
        response = requests.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": google_token},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=401, detail="Invalid Google token") from exc
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    claims = response.json()
    if claims.get("aud") != google_client_id:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    if claims.get("iss") not in {"https://accounts.google.com", "accounts.google.com"}:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    if str(claims.get("email_verified", "")).lower() != "true":
        raise HTTPException(status_code=401, detail="google email is not verified")
    email = (claims.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=401, detail="google token missing email")
    return {
        "email": email,
        "name": (claims.get("name") or "").strip(),
        "profilePicture": (claims.get("picture") or "").strip(),
        "subject": (claims.get("sub") or "").strip(),
    }


def upsert_google_user(user_id: str, email: str, name: str, profile_picture: str) -> Dict[str, Any]:
    now = now_iso()
    user = find_one("users", {"userId": user_id})
    if not user:
        user = {
            "name": name,
            "email": email,
            "password": "",
            "userId": user_id,
            "createdAt": now,
            "updatedAt": now,
            "profilePicture": profile_picture or DEFAULT_PROFILE_PICTURE,
            "role": "USER",
        }
        insert("users", user)
        return user

    updates: Dict[str, Any] = {"email": email, "updatedAt": now}
    if name:
        updates["name"] = name
    if profile_picture:
        updates["profilePicture"] = profile_picture
    elif not user.get("profilePicture"):
        updates["profilePicture"] = DEFAULT_PROFILE_PICTURE
    col("users").update_one({"userId": user_id}, {"$set": updates})
    user.update(updates)
    return user


def login_response_for_user(user: Dict[str, Any]) -> Dict[str, Any]:
    tokens = issue_tokens(user["userId"], user.get("role", "USER"), user.get("email", ""))
    tokens["user"] = user_info(user)
    update = {"$set": {"updatedAt": now_iso()}}
    col("users").update_one({"userId": user["userId"]}, update)
    col("authprovider").update_one({"userId": user["userId"]}, update)
    return tokens
