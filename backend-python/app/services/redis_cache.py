import hashlib
import json
import logging
import os
from typing import Any, Optional

from redis import Redis

logger = logging.getLogger("uvicorn.error")

_client: Optional[Redis] = None


def _redis() -> Redis:
    global _client
    if _client is None:
        _client = Redis.from_url(
            os.getenv("REDIS_URL", "redis://redis:6379/0"),
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=2,
            health_check_interval=30,
        )
    return _client


def cache_token(value: Any) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:24]


def cache_get(key: str) -> Optional[Any]:
    try:
        raw = _redis().get(key)
        return json.loads(raw) if raw is not None else None
    except Exception as exc:
        logger.warning("Redis cache read failed for %s: %s", key, exc)
        return None


def cache_set(key: str, value: Any, ttl_seconds: int) -> None:
    try:
        _redis().setex(key, max(1, ttl_seconds), json.dumps(value, default=str, separators=(",", ":")))
    except Exception as exc:
        logger.warning("Redis cache write failed for %s: %s", key, exc)


def cache_add(key: str, value: Any, ttl_seconds: int) -> bool:
    """Set a key only when it does not exist; useful for cross-worker locks."""
    try:
        return bool(
            _redis().set(
                key,
                json.dumps(value, default=str, separators=(",", ":")),
                ex=max(1, ttl_seconds),
                nx=True,
            )
        )
    except Exception as exc:
        logger.warning("Redis cache add failed for %s: %s", key, exc)
        return False


def cache_delete(key: str) -> bool:
    try:
        return bool(_redis().delete(key))
    except Exception as exc:
        logger.warning("Redis cache delete failed for %s: %s", key, exc)
        return False


def cache_ttl(key: str) -> int:
    """Remaining lifetime in seconds; 0 when the key is missing or has no expiry."""
    try:
        remaining = int(_redis().ttl(key))
        return remaining if remaining > 0 else 0
    except Exception as exc:
        logger.warning("Redis cache ttl read failed for %s: %s", key, exc)
        return 0


def cache_delete_pattern(pattern: str) -> int:
    deleted = 0
    try:
        client = _redis()
        batch = []
        for key in client.scan_iter(match=pattern, count=200):
            batch.append(key)
            if len(batch) >= 200:
                client.delete(*batch)
                deleted += len(batch)
                batch = []
        if batch:
            client.delete(*batch)
            deleted += len(batch)
    except Exception as exc:
        logger.warning("Redis cache invalidation failed for %s: %s", pattern, exc)
    return deleted


def cache_ping() -> bool:
    try:
        return bool(_redis().ping())
    except Exception:
        return False


def cache_info() -> dict:
    try:
        client = _redis()
        info = client.info("memory")
        return {
            "status": "up",
            "keys": int(client.dbsize()),
            "usedMemoryBytes": int(info.get("used_memory") or 0),
            "maxMemoryBytes": int(info.get("maxmemory") or 0),
        }
    except Exception:
        return {"status": "down", "keys": 0, "usedMemoryBytes": 0, "maxMemoryBytes": 0}
