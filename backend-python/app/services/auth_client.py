import os
from typing import Any, Dict

import requests
from fastapi import HTTPException, Request, Response

AUTH_URL = (
    os.getenv("TOOLHUB_AUTH_URL")
    or os.getenv("GOOGLE_AUTH_URL")
    or ""
).strip().rstrip("/")
AUTH_SECRET = (
    os.getenv("TOOLHUB_AUTH_INTERNAL_SECRET")
    or os.getenv("GOOGLE_AUTH_INTERNAL_SECRET")
    or ""
).strip()
AUTH_APPLICATION = os.getenv("TOOLHUB_AUTH_APPLICATION", "toolhub").strip()
ACCESS_COOKIE = os.getenv("AUTH_ACCESS_COOKIE", "toolhub_access_token").strip()
REFRESH_COOKIE = os.getenv("AUTH_REFRESH_COOKIE", "toolhub_refresh_token").strip()
COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}


def auth_request(method: str, path: str, **kwargs: Any) -> requests.Response:
    if not AUTH_URL or not AUTH_SECRET:
        raise HTTPException(status_code=500, detail="ToolHub Auth is not configured")
    try:
        response = requests.request(
            method,
            f"{AUTH_URL}{path}",
            headers={"X-Internal-Auth": AUTH_SECRET},
            timeout=15,
            **kwargs,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail="Authentication service is unavailable") from exc
    return response


def response_json_or_error(response: requests.Response, fallback: str) -> Dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=body.get("detail") or fallback,
        )
    return body


def verify_identity(provider: str, credential: str) -> Dict[str, str]:
    response = auth_request(
        "POST",
        f"/v1/providers/{provider}/verify",
        json={"credential": credential},
    )
    return response_json_or_error(response, f"Invalid {provider} credential")


def issue_session(user: Dict[str, Any]) -> Dict[str, Any]:
    response = auth_request(
        "POST",
        "/v1/sessions",
        json={
            "subject": user["userId"],
            "role": user.get("role", "USER"),
            "email": user.get("email", ""),
            "application": AUTH_APPLICATION,
        },
    )
    return response_json_or_error(response, "Unable to create session")


def refresh_session(refresh_token: str) -> Dict[str, Any]:
    response = auth_request(
        "POST",
        "/v1/sessions/refresh",
        json={"refreshToken": refresh_token},
    )
    return response_json_or_error(response, "Invalid refresh session")


def revoke_session(refresh_token: str) -> None:
    if not refresh_token:
        return
    try:
        auth_request(
            "POST",
            "/v1/sessions/revoke",
            json={"refreshToken": refresh_token},
        )
    except HTTPException:
        # Logout still clears browser credentials when the auth service is down.
        pass


def cookie_is_secure(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    return COOKIE_SECURE or forwarded_proto.split(",", 1)[0].strip() == "https"


def set_session_cookies(
    request: Request,
    response: Response,
    tokens: Dict[str, Any],
) -> None:
    secure = cookie_is_secure(request)
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=tokens["accessToken"],
        max_age=int(tokens["accessExpiresIn"]),
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=tokens["refreshToken"],
        max_age=int(tokens["refreshExpiresIn"]),
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api/",
    )


def clear_session_cookies(request: Request, response: Response) -> None:
    secure = cookie_is_secure(request)
    response.delete_cookie(
        ACCESS_COOKIE,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.delete_cookie(
        REFRESH_COOKIE,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api/",
    )


def refresh_cookie(request: Request) -> str:
    return (request.cookies.get(REFRESH_COOKIE) or "").strip()
