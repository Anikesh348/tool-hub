import uuid
from typing import Any, Dict

import bcrypt
import jwt
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.core.config import DEFAULT_PROFILE_PICTURE, JWT_ISSUER, JWT_SECRET
from app.middlewares.auth import issue_tokens, login_response_for_user, login_type, upsert_google_user, validate_google_token
from app.services.mongo import find, find_one, insert
from app.utils.responses import error, now_iso, success


def register_user(body: Dict[str, Any]):
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    if not email or not password:
        return JSONResponse(status_code=400, content=error("email/password is required"))
    if find_one("users", {"email": email}):
        return JSONResponse(status_code=400, content=error("user already exists, please login"))
    user_id = str(uuid.uuid4())
    now = now_iso()
    user = {
        **{k: v for k, v in body.items() if k != "password"},
        "userId": user_id,
        "email": email,
        "createdAt": now,
        "updatedAt": now,
        "role": "USER",
        "profilePicture": DEFAULT_PROFILE_PICTURE,
    }
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    insert("users", user)
    insert(
        "authprovider",
        {
            "userId": user_id,
            "provider": "base",
            "providerUserId": email,
            "email": email,
            "createdAt": now,
            "updatedAt": now,
            "hashedPassword": hashed,
        },
    )
    return success("user is registered")


def login_user(body: Dict[str, Any]):
    provider = login_type(body)
    if provider == "google":
        google_token = (body.get("token") or "").strip()
        if not google_token:
            return JSONResponse(status_code=400, content=error("google token is required"))
        claims = validate_google_token(google_token)
        email = claims["email"]
        auth = find_one("authprovider", {"email": email})
        if not auth:
            user_id = str(uuid.uuid4())
            now = now_iso()
            insert(
                "authprovider",
                {
                    "userId": user_id,
                    "provider": "google",
                    "providerUserId": email,
                    "email": email,
                    "createdAt": now,
                    "updatedAt": now,
                    "hashedPassword": "",
                },
            )
        else:
            user_id = (auth.get("userId") or "").strip()
            if not user_id:
                raise HTTPException(status_code=500, detail="Invalid auth provider record")
        user = upsert_google_user(user_id, email, claims["name"], claims["profilePicture"])
        return login_response_for_user(user)
    if provider != "base":
        raise HTTPException(status_code=400, detail=f"Unknown login type: {provider}")
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    if not email or not password:
        return JSONResponse(status_code=400, content=success("userName/password is empty"))
    auth = find_one("authprovider", {"providerUserId": email, "provider": "base"})
    if not auth:
        return JSONResponse(status_code=401, content="user doesnt exist")
    user = find_one("users", {"userId": auth.get("userId", "")})
    if not user:
        return JSONResponse(status_code=401, content="user doesnt exist")
    if not bcrypt.checkpw(password.encode(), (auth.get("hashedPassword") or "").encode()):
        return JSONResponse(status_code=401, content=error("invalid user/password combination"))
    return login_response_for_user(user)


def refresh_user_token(body: Dict[str, Any]):
    refresh = (body.get("refreshToken") or "").strip()
    if not refresh:
        return JSONResponse(status_code=400, content=error("refresh token is required"))
    try:
        payload = jwt.decode(refresh, JWT_SECRET, algorithms=["HS256"], issuer=JWT_ISSUER)
    except Exception:
        return JSONResponse(status_code=401, content=error("invalid refresh token"))
    if payload.get("tokenType") != "refresh":
        return JSONResponse(status_code=401, content=error("invalid refresh token"))
    user_id = payload.get("userId", "")
    auths = find("authprovider", {"userId": user_id})
    valid = any(a.get("refreshTokenHash") and bcrypt.checkpw(refresh.encode(), a["refreshTokenHash"].encode()) for a in auths)
    if not valid:
        return JSONResponse(status_code=401, content=error("refresh token not recognized"))
    user = find_one("users", {"userId": user_id})
    if not user:
        return JSONResponse(status_code=401, content=error("user does not exist"))
    return issue_tokens(user_id, user.get("role", "USER"), user.get("email", ""))
