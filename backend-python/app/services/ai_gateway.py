from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import requests


CODEX_PROVIDER = "codex"
CLAUDE_PROVIDER = "claude"
DEFAULT_PROVIDER = CODEX_PROVIDER
SUPPORTED_PROVIDERS = (CODEX_PROVIDER, CLAUDE_PROVIDER)


class AIGatewayError(RuntimeError):
    def __init__(
        self,
        message: str,
        status_code: int = 503,
        code: str = "gateway_unavailable",
        provider: str = DEFAULT_PROVIDER,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.provider = provider


@dataclass(frozen=True)
class GatewayEndpoint:
    provider: str
    url: str
    client_id: str
    secret_file: Path


def _endpoint(provider: str) -> GatewayEndpoint:
    if provider == CODEX_PROVIDER:
        return GatewayEndpoint(
            provider=CODEX_PROVIDER,
            url=os.getenv("AI_CODEX_GATEWAY_URL", "").strip().rstrip("/"),
            client_id=os.getenv("AI_GATEWAY_CLIENT_ID", "").strip(),
            secret_file=Path(
                os.getenv("AI_GATEWAY_SECRET_FILE", "/run/secrets/ai_gateway_client_secret")
            ),
        )
    if provider == CLAUDE_PROVIDER:
        return GatewayEndpoint(
            provider=CLAUDE_PROVIDER,
            url=os.getenv("AI_CLAUDE_GATEWAY_URL", "").strip().rstrip("/"),
            client_id=os.getenv(
                "AI_CLAUDE_GATEWAY_CLIENT_ID", os.getenv("AI_GATEWAY_CLIENT_ID", "")
            ).strip(),
            secret_file=Path(
                os.getenv(
                    "AI_CLAUDE_GATEWAY_SECRET_FILE",
                    "/run/secrets/ai_claude_gateway_client_secret",
                )
            ),
        )
    raise AIGatewayError("Unsupported AI provider", 400, "unsupported_provider", provider)


def provider_configured(provider: str) -> bool:
    """True when the provider has a URL, a client id, and a usable secret on disk."""
    try:
        endpoint = _endpoint(provider)
    except AIGatewayError:
        return False
    if not endpoint.url or not endpoint.client_id:
        return False
    try:
        return len(endpoint.secret_file.read_text(encoding="utf-8").strip()) >= 32
    except OSError:
        return False


def _secret(endpoint: GatewayEndpoint) -> str:
    try:
        value = endpoint.secret_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise AIGatewayError(
            "AI gateway authentication is not configured",
            503,
            "gateway_not_configured",
            endpoint.provider,
        ) from exc
    if len(value) < 32 or not endpoint.client_id:
        raise AIGatewayError(
            "AI gateway authentication is not configured",
            503,
            "gateway_not_configured",
            endpoint.provider,
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
    provider: str = DEFAULT_PROVIDER,
) -> Dict[str, Any]:
    endpoint = _endpoint(provider)
    if not endpoint.url:
        raise AIGatewayError(
            "AI gateway is not configured", 503, "gateway_not_configured", provider
        )
    body = b"" if payload is None else json.dumps(
        payload, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex
    parsed = urlsplit(f"{endpoint.url}{path}")
    signed_path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    headers = {
        "Accept": "application/json",
        "X-AI-Client-Id": endpoint.client_id,
        "X-AI-Timestamp": timestamp,
        "X-AI-Nonce": nonce,
        "X-AI-Signature": _signature(
            _secret(endpoint), method, signed_path, endpoint.client_id, timestamp, nonce, body
        ),
        "X-Request-Id": str(uuid.uuid4()),
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    try:
        response = requests.request(
            method,
            f"{endpoint.url}{path}",
            data=body if payload is not None else None,
            headers=headers,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise AIGatewayError(
            "AI gateway is unavailable", 503, "gateway_unavailable", provider
        ) from exc
    try:
        result = response.json()
    except ValueError as exc:
        raise AIGatewayError(
            "AI gateway returned an invalid response", 503, "gateway_error", provider
        ) from exc
    if response.status_code >= 400:
        error = result.get("error") if isinstance(result, dict) else {}
        message = str(error.get("message") or "AI gateway request failed")
        code = str(error.get("code") or "gateway_error")
        safe_status = response.status_code if response.status_code in {
            400, 404, 409, 413, 429, 503
        } else 503
        raise AIGatewayError(message, safe_status, code, provider)
    if not isinstance(result, dict):
        raise AIGatewayError(
            "AI gateway returned an invalid response", 503, "gateway_error", provider
        )
    return result
