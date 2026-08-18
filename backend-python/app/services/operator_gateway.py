"""Client for the private codex-operator-gateway / claude-operator-gateway pair.

This is the SAME operator gateway pair `/opt/opsched/opsched/ai_client.py` uses
for scheduled ops jobs on the host (e.g. github_pr_publish) - reused here so
"smart" user-created scheduled jobs (see user_scheduler.py) get the identical
capability profile and HMAC contract, instead of a second bespoke path.

Unlike the ordinary chat gateway (ai_gateway.py's CODEX_PROVIDER/CLAUDE_PROVIDER,
used with capabilityProfile "read-only"/"knowledge-only"), a call through here
runs with capabilityProfile "operator" - the executor can take real, unattended
action against the homelab. Every call site must go through an explicit user
confirmation step before a job that uses this is ever created (see
scheduler_ai.py / user_scheduler.py) - this module does no gating itself.

Synchronous (uses `requests` under the hood via ai_gateway.gateway_request) -
callers MUST run it off the event loop, e.g. via asyncio.to_thread, exactly
like the rest of this codebase's scheduled-job handlers already do.
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

from app.services.ai_gateway import (
    CLAUDE_OPERATOR_PROVIDER,
    CODEX_OPERATOR_PROVIDER,
    AIGatewayError,
    gateway_request,
    provider_configured,
)
from app.services.ai_provider_router import is_usage_exhausted

logger = logging.getLogger("uvicorn.error")

# Mirrors ai_provider_router.py's current Claude-preferred, Codex-fallback
# ordering so a single ToolHub backend process is consistent about which
# provider it tries first, whether the call is chat or operator.
PREFERRED_OPERATOR_PROVIDER = CLAUDE_OPERATOR_PROVIDER
FALLBACK_OPERATOR_PROVIDER = CODEX_OPERATOR_PROVIDER


def operator_configured() -> bool:
    return provider_configured(PREFERRED_OPERATOR_PROVIDER) or provider_configured(
        FALLBACK_OPERATOR_PROVIDER
    )


def run_operator_prompt(prompt: str, *, timeout: int = 1800) -> Tuple[str, str]:
    """Runs an operator-profile prompt, Claude first, Codex on exhausted usage.

    Returns (provider, output_text). Raises AIGatewayError for any failure
    that isn't a usage-exhaustion fallback trigger, so a genuine outage stays
    visible instead of silently changing provider.
    """
    last_error: Optional[AIGatewayError] = None
    tried = False
    for provider in (PREFERRED_OPERATOR_PROVIDER, FALLBACK_OPERATOR_PROVIDER):
        if not provider_configured(provider):
            continue
        tried = True
        try:
            result = gateway_request(
                "POST",
                "/v1/responses",
                payload={"input": prompt, "capabilityProfile": "operator"},
                timeout=timeout,
                provider=provider,
            )
        except AIGatewayError as exc:
            if not is_usage_exhausted(exc):
                raise
            logger.warning("operator provider %s reported exhausted usage: %s", provider, exc)
            last_error = exc
            continue
        output_text = str(result.get("outputText") or "").strip()
        if not output_text:
            raise AIGatewayError(
                f"{provider} operator gateway returned no output", 503, "empty_response", provider
            )
        return provider, output_text
    if not tried:
        raise AIGatewayError(
            "No operator AI provider gateway is configured", 503, "gateway_not_configured"
        )
    raise last_error or AIGatewayError(
        "Every operator AI provider has exhausted its usage allowance",
        429,
        "provider_usage_exhausted",
    )
