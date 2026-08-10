"""Backs the "Create New Question Set" wizard's structured Configure -> Preview
-> Generate flow - a second, form-driven way to reach the same AI-curated
question-list feature the free-text LeetCode AI chat bubble already offers
(see `leetcode_ai.py`). Reuses that module's system prompt, tracked-questions
context, JSON-payload parsing, and LeetCode slug resolution so both paths stay
consistent, but keeps its own job collection and executor submission so a
wizard run can never interact with a chat's `runStatus`.

Unlike the chat bubble (which resolves and inserts questions in one shot),
this flow is genuinely two-phase: `begin_generation` only resolves candidates
into a job document for the user to review, and nothing is written to the
`leetcode` collection until `confirm_generation` is called. This matches the
wizard's "Preview" step actually showing something real rather than a
UI-only formality.

Follows the same begin/complete-in-background + poll pattern as
`leetcode_ai.py` for the same reason: a real generation call can take
several-to-tens of seconds, and holding one HTTP request open that long
across the full public path (browser -> edge proxy -> WireGuard -> nginx ->
backend) is fragile - see the Caddy-edge-timeout incident documented in
`leetcode_ai.py`'s module docstring history.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List

from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING

from app.services.ai_gateway import AIGatewayError
from app.services.ai_provider_router import routed_gateway_request
from app.services.leetcode import upsert_question_set
from app.services.leetcode_ai import (
    _EXECUTOR,
    SYSTEM_PROMPT,
    _extract_collection_payload,
    _insert_resolved,
    _resolve_candidates,
    _tracked_questions_context,
)
from app.services.mongo import col
from app.utils.responses import jsonable, now_iso

JOBS = "leetcode_set_jobs"
MAX_QUESTIONS = 20

logger = logging.getLogger("uvicorn.error")


def ensure_leetcode_set_wizard_indexes() -> None:
    jobs = col(JOBS)
    jobs.create_index([("id", ASCENDING)], unique=True)
    jobs.create_index([("ownerId", ASCENDING), ("createdAt", DESCENDING)])
    # A container restart mid-generation would otherwise leave a job "running" forever.
    jobs.update_many(
        {"status": "running"},
        {"$set": {"status": "failed", "error": "Interrupted by a server restart. Try again."}},
    )


def _compose_prompt(request: Dict[str, Any]) -> str:
    topic = str(request.get("topic") or "").strip()[:120]
    difficulty = str(request.get("difficulty") or "Mixed").strip()
    count = max(1, min(int(request.get("count") or 10), MAX_QUESTIONS))
    parts = [
        f'Generate {count} {difficulty.lower()} LeetCode questions about "{topic}".'
        if topic
        else f"Generate {count} {difficulty.lower()} LeetCode questions."
    ]
    if request.get("interviewOnly"):
        parts.append("Prioritize problems commonly asked in real technical interviews.")
    if request.get("excludePremium"):
        parts.append("Exclude LeetCode premium/subscriber-only problems.")
    if request.get("includeCompanyTags"):
        parts.append("Prefer problems with well-known company tags.")
    custom_prompt = str(request.get("customPrompt") or "").strip()
    if custom_prompt:
        parts.append(custom_prompt[:400])
    return " ".join(parts)


def _public_job(document: Dict[str, Any]) -> Dict[str, Any]:
    return jsonable({
        "id": document["id"],
        "status": document["status"],
        "label": document.get("label"),
        "proposed": document.get("proposed") or [],
        "skippedExisting": document.get("skippedExisting") or [],
        "unresolvedCount": document.get("unresolvedCount", 0),
        "error": document.get("error"),
        "createdAt": document["createdAt"],
        "updatedAt": document["updatedAt"],
    })


def _run_job(job_id: str, owner_id: str, request: Dict[str, Any]) -> None:
    prompt = _compose_prompt(request)
    context = [{"type": "text", "label": "Instructions", "text": SYSTEM_PROMPT}]
    tracked_summary = _tracked_questions_context(owner_id)
    if tracked_summary:
        context.append({
            "type": "text",
            "label": "Already in the user's tracker (never propose these again)",
            "text": tracked_summary,
        })
    try:
        _, response = routed_gateway_request(
            "POST",
            "/v1/responses",
            payload_for_provider=lambda target: {
                "input": prompt,
                "conversation": {"providerConversationId": None},
                "context": context,
                "capabilityProfile": "knowledge-only",
                "metadata": {"application": "toolhub-leetcode-set-wizard", "jobId": job_id},
            },
            timeout=90,
        )
    except AIGatewayError:
        logger.exception("Question-set generation failed for job %s", job_id)
        col(JOBS).update_one({"id": job_id}, {"$set": {
            "status": "failed",
            "error": "The assistant could not complete this request. Try again.",
            "updatedAt": now_iso(),
        }})
        return

    text = str(response.get("outputText") or "").strip()
    payload = _extract_collection_payload(text) if text else None
    if not payload:
        col(JOBS).update_one({"id": job_id}, {"$set": {
            "status": "failed",
            "error": "The assistant didn't return a question list. Try a more specific topic.",
            "updatedAt": now_iso(),
        }})
        return

    resolution = _resolve_candidates(payload, owner_id)
    has_results = bool(resolution["resolved"] or resolution["skippedExisting"])
    col(JOBS).update_one({"id": job_id}, {"$set": {
        "status": "ready" if has_results else "failed",
        "label": resolution["label"],
        "proposed": resolution["resolved"],
        "skippedExisting": resolution["skippedExisting"],
        "unresolvedCount": resolution["unresolvedCount"],
        "error": None if has_results else "No matching LeetCode problems could be resolved. Try a broader topic.",
        "updatedAt": now_iso(),
    }})


def begin_generation(owner_id: str, request: Dict[str, Any]) -> Dict[str, Any]:
    if not str(request.get("topic") or "").strip():
        raise HTTPException(status_code=400, detail="A topic is required")
    now = now_iso()
    document = {
        "id": str(uuid.uuid4()),
        "ownerId": owner_id,
        "status": "running",
        "request": request,
        "label": None,
        "proposed": [],
        "skippedExisting": [],
        "unresolvedCount": 0,
        "error": None,
        "createdAt": now,
        "updatedAt": now,
    }
    col(JOBS).insert_one(document)
    _EXECUTOR.submit(_run_job, document["id"], owner_id, request)
    return _public_job(document)


def get_generation(job_id: str, owner_id: str) -> Dict[str, Any]:
    document = col(JOBS).find_one({"id": job_id, "ownerId": owner_id})
    if document is None:
        raise HTTPException(status_code=404, detail="Generation job not found")
    return _public_job(document)


def confirm_generation(job_id: str, owner_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    document = col(JOBS).find_one({"id": job_id, "ownerId": owner_id})
    if document is None:
        raise HTTPException(status_code=404, detail="Generation job not found")
    if document["status"] != "ready":
        raise HTTPException(status_code=409, detail="This generation isn't ready to confirm yet")
    label = str(body.get("label") or document.get("label") or "AI Suggested Questions").strip()[:120]
    exclude_urls = set(body.get("excludeUrls") or [])
    resolved: List[Dict[str, Any]] = [
        item for item in (document.get("proposed") or []) if item["url"] not in exclude_urls
    ]
    inserted = _insert_resolved(label, resolved, owner_id)
    if inserted:
        upsert_question_set(label, owner_id, description=str(body.get("description") or "").strip()[:500])
    col(JOBS).update_one({"id": job_id}, {"$set": {"status": "confirmed", "updatedAt": now_iso()}})
    return {"label": label, "count": len(inserted)}
