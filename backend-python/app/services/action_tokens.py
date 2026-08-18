import hashlib
import hmac
import time

from app.core.config import JWT_SECRET

DEFAULT_TTL_SECONDS = 7 * 24 * 3600


def mint_action_token(scope: str, resource_id: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    expires_at = int(time.time()) + ttl_seconds
    signature = _sign(scope, resource_id, expires_at)
    return f"{expires_at}.{signature}"


def verify_action_token(scope: str, resource_id: str, token: str) -> bool:
    try:
        expires_at_text, signature = (token or "").split(".", 1)
        expires_at = int(expires_at_text)
    except (ValueError, AttributeError):
        return False
    if time.time() > expires_at:
        return False
    return hmac.compare_digest(_sign(scope, resource_id, expires_at), signature)


def _sign(scope: str, resource_id: str, expires_at: int) -> str:
    payload = f"{scope}:{resource_id}:{expires_at}".encode()
    return hmac.new(JWT_SECRET.encode(), payload, hashlib.sha256).hexdigest()
