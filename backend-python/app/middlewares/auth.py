from typing import Any, Dict, Optional

import jwt
from fastapi import Depends, Header, HTTPException, Request

from app.core.config import JWT_ISSUER, JWT_SECRET
from app.services.auth_client import ACCESS_COOKIE


def request_user(
    request: Request,
    authorization: Optional[str] = None,
) -> Dict[str, str]:
    token = (request.cookies.get(ACCESS_COOKIE) or "").strip()
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication is required")
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            issuer=JWT_ISSUER,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    if payload.get("tokenType") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return {
        "userId": str(payload.get("sub") or payload.get("userId") or ""),
        "role": str(payload.get("role") or "USER"),
        "email": str(payload.get("email") or ""),
    }


def current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> Dict[str, str]:
    return request_user(request, authorization)


def admin_user(user: Dict[str, str] = Depends(current_user)) -> Dict[str, str]:
    if user.get("role", "").upper() != "ADMIN":
        raise HTTPException(status_code=403, detail="Forbidden: Insufficient permissions")
    return user


def user_info(user: Dict[str, Any]) -> Dict[str, Any]:
    clean = dict(user)
    clean.pop("_id", None)
    clean.pop("createdAt", None)
    clean.pop("updatedAt", None)
    clean.pop("password", None)
    return clean


def login_type(body: Dict[str, Any]) -> str:
    return (body.get("type") or body.get("provider") or "base").strip().lower()
