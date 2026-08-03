from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import requests


GATEWAY_URL = os.getenv("AI_CODEX_GATEWAY_URL", "").strip().rstrip("/")
CLIENT_ID = os.getenv("AI_GATEWAY_CLIENT_ID", "").strip()
SECRET_FILE = Path(os.getenv("AI_GATEWAY_SECRET_FILE", "/run/secrets/ai_gateway_client_secret"))


class AIGatewayError(RuntimeError):
    def __init__(self, message: str, status_code: int = 503, code: str = "gateway_unavailable"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def _secret() -> str:
    try:
        value = SECRET_FILE.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise AIGatewayError(
            "AI gateway authentication is not configured", 503, "gateway_not_configured"
        ) from exc
    if len(value) < 32 or not CLIENT_ID:
        raise AIGatewayError(
            "AI gateway authentication is not configured", 503, "gateway_not_configured"
        )
    return value


def _signature(
    secret: str,
    method: str,
    path: str,
    client_id: str,
    timestamp: str,
    nonce: str,
    body: bytes,
) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = "\n".join(
        (method.upper(), path, client_id, timestamp, nonce, body_hash)
    ).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def gateway_request(
    method: str,
    path: str,
    *,
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 15,
) -> Dict[str, Any]:
    if not GATEWAY_URL:
        raise AIGatewayError("AI gateway is not configured", 503, "gateway_not_configured")
    body = b"" if payload is None else json.dumps(
        payload, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex
    parsed = urlsplit(f"{GATEWAY_URL}{path}")
    signed_path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    headers = {
        "Accept": "application/json",
        "X-AI-Client-Id": CLIENT_ID,
        "X-AI-Timestamp": timestamp,
        "X-AI-Nonce": nonce,
        "X-AI-Signature": _signature(
            _secret(), method, signed_path, CLIENT_ID, timestamp, nonce, body
        ),
        "X-Request-Id": str(uuid.uuid4()),
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    try:
        response = requests.request(
            method,
            f"{GATEWAY_URL}{path}",
            data=body if payload is not None else None,
            headers=headers,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise AIGatewayError("AI gateway is unavailable") from exc
    try:
        result = response.json()
    except ValueError as exc:
        raise AIGatewayError("AI gateway returned an invalid response") from exc
    if response.status_code >= 400:
        error = result.get("error") if isinstance(result, dict) else {}
        message = str(error.get("message") or "AI gateway request failed")
        code = str(error.get("code") or "gateway_error")
        safe_status = response.status_code if response.status_code in {
            400, 404, 409, 413, 429, 503
        } else 503
        raise AIGatewayError(message, safe_status, code)
    if not isinstance(result, dict):
        raise AIGatewayError("AI gateway returned an invalid response")
    return result
