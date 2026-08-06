import uuid
from typing import Any, Dict

import bcrypt
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse

from app.core.config import DEFAULT_PROFILE_PICTURE
from app.middlewares.auth import login_type, user_info
from app.services.auth_client import (
    clear_session_cookies,
    issue_session,
    refresh_cookie,
    refresh_session,
    revoke_session,
    set_session_cookies,
    verify_identity,
)
from app.services.mongo import col, find_one, insert
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


def upsert_external_user(
    user_id: str,
    identity: Dict[str, str],
) -> Dict[str, Any]:
    now = now_iso()
    user = find_one("users", {"userId": user_id})
    if not user:
        user = {
            "name": identity.get("name", ""),
            "email": identity["email"],
            "password": "",
            "userId": user_id,
            "createdAt": now,
            "updatedAt": now,
            "profilePicture": identity.get("profilePicture") or DEFAULT_PROFILE_PICTURE,
            "role": "USER",
        }
        insert("users", user)
        return user

    updates: Dict[str, Any] = {
        "email": identity["email"],
        "updatedAt": now,
    }
    if identity.get("name"):
        updates["name"] = identity["name"]
    if identity.get("profilePicture"):
        updates["profilePicture"] = identity["profilePicture"]
    elif not user.get("profilePicture"):
        updates["profilePicture"] = DEFAULT_PROFILE_PICTURE
    col("users").update_one({"userId": user_id}, {"$set": updates})
    user.update(updates)
    return user


def login_response_for_user(
    user: Dict[str, Any],
    request: Request,
    response: Response,
) -> Dict[str, Any]:
    tokens = issue_session(user)
    set_session_cookies(request, response, tokens)
    now = now_iso()
    col("users").update_one({"userId": user["userId"]}, {"$set": {"updatedAt": now}})
    col("authprovider").update_many(
        {"userId": user["userId"]},
        {
            "$set": {"updatedAt": now},
            "$unset": {"refreshTokenHash": "", "refreshTokenExpiresAt": ""},
        },
    )
    return {
        "authenticated": True,
        "user": user_info(user),
        "session": {
            "accessExpiresIn": tokens["accessExpiresIn"],
            "refreshExpiresIn": tokens["refreshExpiresIn"],
        },
    }


def login_user(body: Dict[str, Any], request: Request, response: Response):
    provider = login_type(body)
    if provider != "base":
        credential = (body.get("token") or body.get("credential") or "").strip()
        if not credential:
            return JSONResponse(
                status_code=400,
                content=error(f"{provider} credential is required"),
            )
        identity = verify_identity(provider, credential)
        email = identity["email"]
        subject = identity["subject"]
        auth = find_one(
            "authprovider",
            {"provider": provider, "providerUserId": subject},
        ) or find_one("authprovider", {"provider": provider, "email": email})
        if not auth:
            user_id = str(uuid.uuid4())
            now = now_iso()
            insert(
                "authprovider",
                {
                    "userId": user_id,
                    "provider": provider,
                    "providerUserId": subject,
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
            col("authprovider").update_one(
                {"userId": user_id, "provider": provider},
                {
                    "$set": {
                        "providerUserId": subject,
                        "email": email,
                        "updatedAt": now_iso(),
                    }
                },
            )
        user = upsert_external_user(user_id, identity)
        return login_response_for_user(user, request, response)

    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    if not email or not password:
        return JSONResponse(status_code=400, content=error("email/password is required"))
    auth = find_one("authprovider", {"providerUserId": email, "provider": "base"})
    if not auth:
        return JSONResponse(status_code=401, content=error("user does not exist"))
    user = find_one("users", {"userId": auth.get("userId", "")})
    if not user:
        return JSONResponse(status_code=401, content=error("user does not exist"))
    if not bcrypt.checkpw(password.encode(), (auth.get("hashedPassword") or "").encode()):
        return JSONResponse(
            status_code=401,
            content=error("invalid user/password combination"),
        )
    return login_response_for_user(user, request, response)


def refresh_user_session(request: Request, response: Response) -> Dict[str, Any]:
    token = refresh_cookie(request)
    if not token:
        raise HTTPException(status_code=401, detail="Refresh session is required")
    tokens = refresh_session(token)
    set_session_cookies(request, response, tokens)
    return {
        "authenticated": True,
        "session": {
            "accessExpiresIn": tokens["accessExpiresIn"],
            "refreshExpiresIn": tokens["refreshExpiresIn"],
        },
    }


def logout_user(request: Request, response: Response) -> Dict[str, Any]:
    revoke_session(refresh_cookie(request))
    clear_session_cookies(request, response)
    return {"authenticated": False}
