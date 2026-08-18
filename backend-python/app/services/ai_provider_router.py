"""Provider routing for the private AI gateways.

Claude is the preferred provider. When Claude reports that its usage allowance is
finished the router switches the whole application over to Codex and remembers
that decision in Redis under a TTL (one day by default). The pin expires on its
own, and it is cleared early when Codex runs out too, so the next request goes
back to trying Claude first.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Dict, Optional, Tuple

from app.services.ai_gateway import (
    CLAUDE_PROVIDER,
    CODEX_PROVIDER,
    SUPPORTED_PROVIDERS,
    AIGatewayError,
    gateway_request,
    provider_configured,
)
from app.services.redis_cache import cache_add, cache_delete, cache_get, cache_ttl


logger = logging.getLogger("uvicorn.error")

PREFERRED_PROVIDER = CLAUDE_PROVIDER
FALLBACK_PROVIDER = CODEX_PROVIDER
ACTIVE_PROVIDER_KEY = "ai:active-provider"
DEFAULT_ACTIVE_TTL_SECONDS = 86400

# Provider error codes that mean "this account's allowance is finished".
USAGE_EXHAUSTED_CODES = frozenset({
    "provider_usage_exhausted",
    "provider_quota_exhausted",
    "usage_limit_reached",
    "quota_exceeded",
    "insufficient_quota",
    "rate_limit_exceeded",
})

# Concurrency back-pressure. A single gateway only runs one turn at a time, so
# these must never be mistaken for an exhausted allowance.
BUSY_CODES = frozenset({"gateway_busy", "executor_busy"})

USAGE_EXHAUSTED_MARKERS = (
    "usage limit",
    "usage cap",
    "quota",
    "out of credit",
    "insufficient credit",
    "credit balance",
    "plan limit",
    "weekly limit",
    "monthly limit",
    "hour limit",
)


def active_ttl_seconds() -> int:
    try:
        value = int(os.getenv("AI_PROVIDER_ACTIVE_TTL_SECONDS", str(DEFAULT_ACTIVE_TTL_SECONDS)))
    except ValueError:
        return DEFAULT_ACTIVE_TTL_SECONDS
    return value if value > 0 else DEFAULT_ACTIVE_TTL_SECONDS


def is_usage_exhausted(exc: AIGatewayError) -> bool:
    code = str(getattr(exc, "code", "") or "").strip().lower()
    if code in BUSY_CODES:
        return False
    if code in USAGE_EXHAUSTED_CODES:
        return True
    message = str(exc).lower()
    return any(marker in message for marker in USAGE_EXHAUSTED_MARKERS)


def active_provider() -> str:
    """The provider the application is currently pinned to."""
    value = cache_get(ACTIVE_PROVIDER_KEY)
    if isinstance(value, str) and value in SUPPORTED_PROVIDERS:
        return value
    return PREFERRED_PROVIDER


def pin_provider(provider: str) -> None:
    """Pin the fallback provider for the TTL window, without extending an existing pin."""
    if provider == PREFERRED_PROVIDER:
        release_provider()
        return
    if cache_add(ACTIVE_PROVIDER_KEY, provider, active_ttl_seconds()):
        logger.warning(
            "AI routing switched to %s for %s seconds", provider, active_ttl_seconds()
        )


def release_provider() -> None:
    """Drop any pin so the preferred provider is tried first again."""
    if cache_delete(ACTIVE_PROVIDER_KEY):
        logger.warning("AI routing released back to %s", PREFERRED_PROVIDER)


def attempt_order() -> list[str]:
    """Configured providers to try, in order, starting from the active one."""
    order = [active_provider()]
    for provider in (PREFERRED_PROVIDER, FALLBACK_PROVIDER):
        if provider not in order:
            order.append(provider)
    return [provider for provider in order if provider_configured(provider)]


def provider_state() -> Dict[str, Any]:
    pinned_for = cache_ttl(ACTIVE_PROVIDER_KEY)
    return {
        "active": active_provider(),
        "preferred": PREFERRED_PROVIDER,
        "fallback": FALLBACK_PROVIDER,
        "pinnedForSeconds": pinned_for if pinned_for and pinned_for > 0 else 0,
        "configured": {
            provider: provider_configured(provider) for provider in SUPPORTED_PROVIDERS
        },
    }


def routed_gateway_request(
    method: str,
    path: str,
    *,
    payload: Optional[Dict[str, Any]] = None,
    payload_for_provider: Optional[Callable[[str], Dict[str, Any]]] = None,
    timeout: int = 15,
) -> Tuple[str, Dict[str, Any]]:
    """Send a gateway request, falling back when a provider's usage is finished.

    Returns the provider that answered together with its response. Only an
    exhausted allowance triggers a fallback; every other failure is raised as-is
    so genuine outages stay visible instead of silently changing provider.
    """
    order = attempt_order()
    if not order:
        raise AIGatewayError(
            "No AI provider gateway is configured", 503, "gateway_not_configured"
        )
    exhausted: list[str] = []
    last_error: Optional[AIGatewayError] = None
    for provider in order:
        body = payload_for_provider(provider) if payload_for_provider else payload
        try:
            result = gateway_request(
                method, path, payload=body, timeout=timeout, provider=provider
            )
        except AIGatewayError as exc:
            if not is_usage_exhausted(exc):
                raise
            last_error = exc
            exhausted.append(provider)
            logger.warning("AI provider %s reported exhausted usage: %s", provider, exc)
            continue
        pin_provider(provider)
        return provider, result
    # Everything is exhausted: clear the pin so the next attempt starts at the
    # preferred provider again rather than waiting out the TTL on a dead one.
    release_provider()
    raise last_error or AIGatewayError(
        "Every AI provider has exhausted its usage allowance",
        429,
        "provider_usage_exhausted",
        exhausted[-1] if exhausted else PREFERRED_PROVIDER,
    )
