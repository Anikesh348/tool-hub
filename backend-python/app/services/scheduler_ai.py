"""AI assistant backing the Scheduled Jobs page's floating chat bubble.

Kept isolated from the general-purpose `ai_chats` module and from
`leetcode_ai`, same reasoning as leetcode_ai.py: its own Mongo collections,
its own request/response cycle, so this feature can't regress anything else.

Unlike leetcode_ai.py (which auto-inserts a proposed question set), a job
proposal here is NEVER created automatically. The chat turn itself always
runs with capabilityProfile "read-only" - it can only draft a job spec, never
act on it. Creating the real job is a separate, explicit confirm step (see
user_scheduler.create_job / scheduler_routes.py), because a "smart" job's
prompt gets real unattended operator-level access every time it later fires.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING, ReturnDocument

from app.services.ai_gateway import AIGatewayError
from app.services.ai_provider_router import routed_gateway_request
from app.services.mongo import col
from app.services.user_scheduler import SCRIPT_ACTIONS, validate_job_spec
from app.utils.responses import jsonable, now_iso

CHATS = "scheduler_ai_chats"
MESSAGES = "scheduler_ai_messages"
MAX_MESSAGE = 4000

logger = logging.getLogger("uvicorn.error")

_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="scheduler-ai")

_JOB_BLOCK_RE = re.compile(r"```schedule-job\s*(\{.*?\})\s*```", re.DOTALL)


def _script_actions_doc() -> str:
    lines = []
    for slug, action in SCRIPT_ACTIONS.items():
        params = ", ".join(action["params"]) or "none"
        lines.append(f'- "{slug}": {action["label"]} (params: {params})')
    return "\n".join(lines)


def _system_prompt() -> str:
    return f"""You are the ToolHub Scheduled Jobs assistant, embedded in a floating chat \
bubble on the Scheduled Jobs admin page of a personal homelab automation platform.

Your job: help the user turn a plain-language automation request into ONE proposed \
scheduled job. You never create the job yourself - you only draft a proposal, which the \
user must explicitly confirm in the UI before it is created.

There are two kinds of job:
- "script": runs one fixed, pre-built, safe action on a schedule. The complete list of \
available actions, and their exact required params, is:
{_script_actions_doc()}
  Never invent a scriptAction that isn't in this list.
- "smart": stores a natural-language instruction that is sent, on schedule, to an AI \
operator with real administrative access to this homelab's servers (it can run \
commands, restart services, edit files, etc., unattended). Only propose "smart" when no \
"script" action fits. Because it runs unattended and the user will not be present to \
clarify anything, the prompt text you write must be precise, self-contained, and state \
exactly what to check/do and what "success" vs "failure" looks like.

If the request is ambiguous (unclear timing, unclear target, unclear what "smart" job \
should actually do), ask a short clarifying question in plain markdown prose - do NOT \
guess and do NOT emit a proposal yet.

Once you have enough detail to propose a concrete job, respond with ONLY a single fenced \
code block tagged `schedule-job`, containing exactly this JSON shape and nothing else (no \
prose before or after it):

```schedule-job
{{"name": "<short name, e.g. 'Nightly price check'>",
"description": "<one line, what this does and why>",
"kind": "script" or "smart",
"schedule": {{"cron": "<5-field cron expression, interpreted in Asia/Kolkata (IST)>", \
"humanReadable": "<e.g. 'Every day at 07:00 IST'>"}},
"scriptAction": "<one of the action slugs above - only when kind is 'script'>",
"scriptParams": {{"<param>": "<value>"}},
"prompt": "<the exact operator instructions - only when kind is 'smart'>"}}
```

Omit scriptAction/scriptParams entirely when kind is "smart", and omit prompt entirely \
when kind is "script". Never use this JSON format for anything other than a job \
proposal - every other message is plain markdown prose.
"""


def ensure_scheduler_ai_indexes() -> None:
    chats = col(CHATS)
    messages = col(MESSAGES)
    chats.create_index([("id", ASCENDING)], unique=True)
    chats.create_index([("ownerId", ASCENDING), ("updatedAt", DESCENDING)])
    messages.create_index([("id", ASCENDING)], unique=True)
    messages.create_index([("chatId", ASCENDING), ("createdAt", ASCENDING), ("id", ASCENDING)])
    chats.update_many({"runStatus": "running"}, {"$set": {"runStatus": "idle"}})


def _public_chat(document: Dict[str, Any], include_messages: bool = False) -> Dict[str, Any]:
    result = {
        "id": document["id"],
        "title": document["title"],
        "runStatus": document.get("runStatus", "idle"),
        "createdAt": document["createdAt"],
        "updatedAt": document["updatedAt"],
    }
    if include_messages:
        records = col(MESSAGES).find({"chatId": document["id"]}).sort(
            [("createdAt", ASCENDING), ("id", ASCENDING)]
        )
        result["messages"] = [
            {
                "id": item["id"],
                "role": item["role"],
                "content": item["content"],
                "status": item.get("status", "completed"),
                "proposedJob": item.get("proposedJob"),
                "createdAt": item["createdAt"],
            }
            for item in records
        ]
    return jsonable(result)


def _owned_chat(chat_id: str, owner_id: str) -> Dict[str, Any]:
    document = col(CHATS).find_one({"id": chat_id, "ownerId": owner_id})
    if document is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    return document


def create_chat(owner_id: str, title: Any = None) -> Dict[str, Any]:
    now = now_iso()
    document = {
        "id": str(uuid.uuid4()),
        "ownerId": owner_id,
        "title": str(title or "New chat").strip()[:120] or "New chat",
        "runStatus": "idle",
        "providerConversationIds": {},
        "createdAt": now,
        "updatedAt": now,
    }
    col(CHATS).insert_one(document)
    return _public_chat(document)


def list_chats(owner_id: str, limit: int = 30) -> List[Dict[str, Any]]:
    records = col(CHATS).find({"ownerId": owner_id}).sort("updatedAt", DESCENDING).limit(
        max(1, min(limit, 100))
    )
    return [_public_chat(record) for record in records]


def get_chat(chat_id: str, owner_id: str) -> Dict[str, Any]:
    return _public_chat(_owned_chat(chat_id, owner_id), include_messages=True)


def _extract_job_payload(text: str) -> Optional[Dict[str, Any]]:
    match = _JOB_BLOCK_RE.search(text)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def begin_message(chat_id: str, owner_id: str, content: Any) -> tuple[Dict[str, Any], Dict[str, Any]]:
    clean_content = str(content or "").strip()
    if not clean_content or len(clean_content) > MAX_MESSAGE:
        raise HTTPException(status_code=400, detail=f"Message must contain 1 to {MAX_MESSAGE} characters")
    now = now_iso()
    chat = col(CHATS).find_one_and_update(
        {"id": chat_id, "ownerId": owner_id, "runStatus": "idle"},
        {"$set": {"runStatus": "running", "updatedAt": now}},
        return_document=ReturnDocument.AFTER,
    )
    if chat is None:
        existing = col(CHATS).find_one({"id": chat_id, "ownerId": owner_id})
        if existing is None:
            raise HTTPException(status_code=404, detail="Chat not found")
        raise HTTPException(status_code=409, detail="This chat is already processing a message")
    user_message = {
        "id": str(uuid.uuid4()),
        "chatId": chat_id,
        "role": "user",
        "content": clean_content,
        "status": "completed",
        "createdAt": now,
    }
    col(MESSAGES).insert_one(user_message)
    return chat, user_message


def complete_message(chat_id: str, owner_id: str, chat: Dict[str, Any], clean_content: str) -> None:
    conversation_ids: Dict[str, str] = dict(chat.get("providerConversationIds") or {})
    context = [{"type": "text", "label": "Instructions", "text": _system_prompt()}]
    try:
        provider, response = routed_gateway_request(
            "POST",
            "/v1/responses",
            payload_for_provider=lambda target: {
                "input": clean_content,
                "conversation": {"providerConversationId": conversation_ids.get(target) or None},
                "context": context,
                "capabilityProfile": "read-only",
                "metadata": {"application": "toolhub-scheduler", "chatId": chat_id},
            },
            timeout=90,
        )
    except AIGatewayError:
        logger.exception("Scheduler AI gateway call failed for chat %s", chat_id)
        failed_at = now_iso()
        col(MESSAGES).insert_one({
            "id": str(uuid.uuid4()),
            "chatId": chat_id,
            "role": "assistant",
            "content": "The assistant could not complete this request. Please try again.",
            "status": "failed",
            "proposedJob": None,
            "createdAt": failed_at,
        })
        col(CHATS).update_one({"id": chat_id}, {"$set": {"runStatus": "idle", "updatedAt": failed_at}})
        return

    assistant_text = str(response.get("outputText") or "").strip()
    provider_conversation_id = str(
        (response.get("conversation") or {}).get("providerConversationId") or ""
    ).strip()
    proposed_job: Optional[Dict[str, Any]] = None

    job_payload = _extract_job_payload(assistant_text) if assistant_text else None
    if job_payload:
        try:
            validated = validate_job_spec(job_payload)
        except ValueError as exc:
            assistant_text = (
                f"I couldn't quite pin that down: {exc}. Could you clarify the schedule "
                "and exactly what should run?"
            )
        else:
            proposed_job = {**validated, "status": "pending"}
            lines = [
                f"Here's a job I can set up: **{validated['name']}**",
                "",
                validated["description"] or "",
                f"- Schedule: {validated['humanReadable'] or validated['cron']} (`{validated['cron']}`)",
            ]
            if validated["kind"] == "script":
                lines.append(f"- Action: {SCRIPT_ACTIONS[validated['scriptAction']]['label']}")
                if validated["scriptParams"]:
                    lines.append(f"- Params: {validated['scriptParams']}")
            else:
                lines.append("- Kind: smart (runs via the AI operator gateway with real admin access)")
                lines.append(f"- Instructions: {validated['prompt']}")
            lines += ["", "Confirm below to create it."]
            assistant_text = "\n".join(line for line in lines if line is not None)

    completed_at = now_iso()
    col(MESSAGES).insert_one({
        "id": str(uuid.uuid4()),
        "chatId": chat_id,
        "role": "assistant",
        "content": assistant_text or "I couldn't generate a response. Please try again.",
        "status": "completed",
        "proposedJob": proposed_job,
        "createdAt": completed_at,
    })

    if provider_conversation_id:
        conversation_ids[provider] = provider_conversation_id
    updates: Dict[str, Any] = {
        "providerConversationIds": conversation_ids,
        "runStatus": "idle",
        "updatedAt": completed_at,
    }
    if chat.get("title") == "New chat":
        updates["title"] = clean_content[:60] + ("..." if len(clean_content) > 60 else "")
    col(CHATS).update_one({"id": chat_id, "ownerId": owner_id}, {"$set": updates})


def complete_message_safely(chat_id: str, owner_id: str, chat: Dict[str, Any], clean_content: str) -> None:
    try:
        complete_message(chat_id, owner_id, chat, clean_content)
    except Exception:
        logger.exception("Background scheduler AI reply failed for chat %s", chat_id)
        failed_at = now_iso()
        col(CHATS).update_one({"id": chat_id}, {"$set": {"runStatus": "idle", "updatedAt": failed_at}})


def send_message(chat_id: str, owner_id: str, content: Any) -> Dict[str, Any]:
    chat, user_message = begin_message(chat_id, owner_id, content)
    _EXECUTOR.submit(complete_message_safely, chat_id, owner_id, chat, user_message["content"])
    return {"accepted": True, "userMessage": jsonable(user_message)}


def mark_message_confirmed(chat_id: str, owner_id: str, message_id: str, job_id: str) -> None:
    """Best-effort: called after a proposal is confirmed so re-opening the
    chat doesn't show a stale 'Confirm' button for an already-created job."""
    _owned_chat(chat_id, owner_id)
    col(MESSAGES).update_one(
        {"id": message_id, "chatId": chat_id},
        {"$set": {"proposedJob.status": "confirmed", "proposedJob.jobId": job_id}},
    )
