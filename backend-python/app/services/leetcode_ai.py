"""AI assistant backing the LeetCode tracker's floating chat bubble.

Kept isolated from the general-purpose `ai_chats` module (its own Mongo
collections, its own request/response cycle) so this feature can't regress the
existing admin AI Assistant. Conversations persist per chat via a
provider-scoped conversation id, the same pattern `ai_chats` uses.

Follows the same begin/complete-in-background + poll pattern as `ai_chats.py`
and the course "ask AI" flow (`courses.py`): the POST that starts a message
inserts the pending user message and returns almost immediately, and a
background task fills in the assistant reply. A real reply can take anywhere
from a few seconds to ~45s, and holding a single HTTP request open for that
whole span across the full public path (browser -> edge proxy -> WireGuard ->
nginx -> backend) is fragile - any hop's idle/read timeout can kill it. Short
polls avoid depending on any of those timeouts being generous enough.
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
from app.services.leetcode_metadata import extract_slug, fetch_question_metadata
from app.services.mongo import col
from app.utils.responses import jsonable, now_iso

CHATS = "leetcode_ai_chats"
MESSAGES = "leetcode_ai_messages"
MAX_MESSAGE = 4000
MAX_QUESTIONS_PER_COLLECTION = 10
# The gateway itself rejects overly large combined context (ai_chats.py's own
# client-side cap for the same gateway is 8000 chars total) - keep real
# margin under that alongside SYSTEM_PROMPT (~1.5k chars).
MAX_TRACKED_CONTEXT_CHARS = 5500

logger = logging.getLogger("uvicorn.error")

# The background reply never shares Starlette's default thread pool with
# anything else (e.g. /v2/token/refresh), so a slow AI call can't starve
# unrelated requests regardless of how this executor is invoked.
_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="leetcode-ai")

SYSTEM_PROMPT = """You are an embedded LeetCode coaching assistant inside a personal \
coding-practice tracker app.

- Answer coding questions normally: explain approaches, complexity, and give solutions \
in idiomatic code using markdown formatting.
- If, and only if, the user is asking you to recommend, generate, or curate a LIST of \
LeetCode problems (for example "generate 5 medium graph questions likely asked at \
Google" or "give me easy string problems for beginners"), respond with ONLY a single \
fenced code block tagged json, containing exactly this shape and nothing else \
(no prose before or after it):

{"collectionTitle": "<short human title, e.g. 'Medium Google Graph Questions'>", \
"questions": [{"slug": "<real leetcode problem slug, e.g. 'course-schedule'>", \
"reason": "<one line why it fits>"}]}

  Only include real, existing LeetCode problem slugs you are confident exist. Provide \
exactly the number of questions requested, or 5 if unspecified.
- If you are given an "Already in the user's tracker" context block, treat it as the \
authoritative list of problems the user already has - NEVER include any slug from that \
list in your proposed questions, even if it would otherwise be your top pick. It's fine \
to return fewer than the requested count if you can't find enough genuinely new matches; \
never pad the list by repeating an already-tracked problem.
- For every other message, answer in plain markdown prose. Never use the JSON format \
for anything other than a requested list of problems.
"""

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def ensure_leetcode_ai_indexes() -> None:
    chats = col(CHATS)
    messages = col(MESSAGES)
    chats.create_index([("id", ASCENDING)], unique=True)
    chats.create_index([("ownerId", ASCENDING), ("updatedAt", DESCENDING)])
    messages.create_index([("id", ASCENDING)], unique=True)
    messages.create_index([("chatId", ASCENDING), ("createdAt", ASCENDING), ("id", ASCENDING)])
    # A container restart mid-reply would otherwise leave a chat stuck "running" forever.
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
                "addedCollection": item.get("addedCollection"),
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


def _tracked_questions_context(owner_id: str) -> str:
    """Compact 'slug (title)' listing of everything already in the user's
    tracker. Without this, the model has no way to know what's already
    tracked and keeps proposing the same well-known problems for a given
    topic, which then get silently filtered out as duplicates - the result
    was almost every "generate N questions" request resolving to zero adds."""
    lines: List[str] = []
    total_chars = 0
    for doc in col("leetcode").find({"userId": owner_id}, {"url": 1, "title": 1}):
        slug = extract_slug(str(doc.get("url") or ""))
        if not slug:
            continue
        line = f"- {slug} ({doc.get('title') or slug})"
        total_chars += len(line) + 1
        if total_chars > MAX_TRACKED_CONTEXT_CHARS:
            lines.append("- ...(list truncated)")
            break
        lines.append(line)
    return "\n".join(lines)


def _extract_collection_payload(text: str) -> Optional[Dict[str, Any]]:
    candidate = text.strip()
    match = _JSON_BLOCK_RE.search(candidate)
    if match:
        candidate = match.group(1)
    if not candidate.startswith("{"):
        return None
    try:
        data = json.loads(candidate)
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
        return None
    return data


def _resolve_candidates(payload: Dict[str, Any], owner_id: str) -> Dict[str, Any]:
    """Resolves proposed slugs against LeetCode's real GraphQL API and the
    user's current tracker, WITHOUT writing anything to Mongo. Shared by the
    chat bubble (which inserts immediately after this) and the "Create New
    Question Set" wizard (which lets the user review this before inserting -
    see `leetcode_set_wizard.py`)."""
    collection_title = str(payload.get("collectionTitle") or "AI Suggested Questions").strip()[:120]
    existing_urls = {
        doc["url"]
        for doc in col("leetcode").find({"userId": owner_id}, {"url": 1})
        if doc.get("url")
    }
    resolved: List[Dict[str, Any]] = []
    skipped_existing: List[str] = []
    unresolved_count = 0
    for candidate in payload["questions"][:MAX_QUESTIONS_PER_COLLECTION]:
        slug = candidate.get("slug") if isinstance(candidate, dict) else None
        if not slug:
            continue
        meta = fetch_question_metadata(str(slug))
        if not meta:
            unresolved_count += 1
            continue
        if meta["url"] in existing_urls:
            skipped_existing.append(meta.get("title") or str(slug))
            continue
        existing_urls.add(meta["url"])
        resolved.append({
            "url": meta["url"],
            "title": meta.get("title") or "",
            "difficulty": meta.get("difficulty") or "",
            "tags": meta.get("tags") or [],
            "acRate": meta.get("acRate"),
            "reason": (candidate.get("reason") if isinstance(candidate, dict) else "") or "",
        })
    return {
        "label": collection_title,
        "resolved": resolved,
        "skippedExisting": skipped_existing,
        "unresolvedCount": unresolved_count,
    }


def _insert_resolved(label: str, resolved: List[Dict[str, Any]], owner_id: str) -> List[Dict[str, Any]]:
    now = now_iso()
    docs = [{
        "questionId": str(uuid.uuid4()),
        "url": item["url"],
        "title": item["title"],
        "difficulty": item["difficulty"],
        "tags": item["tags"],
        "acRate": item.get("acRate"),
        "collectionLabel": label,
        "userId": owner_id,
        "status": "unsolved",
        "bookmarked": False,
        "createdAt": now,
        "updatedAt": now,
        "notes": "",
    } for item in resolved]
    if docs:
        col("leetcode").insert_many(docs)
    return docs


def _resolve_collection(payload: Dict[str, Any], owner_id: str) -> Dict[str, Any]:
    resolution = _resolve_candidates(payload, owner_id)
    docs = _insert_resolved(resolution["label"], resolution["resolved"], owner_id)
    return {
        "label": resolution["label"],
        "count": len(docs),
        "questions": jsonable(docs),
    }


def begin_message(chat_id: str, owner_id: str, content: Any) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Validates and records the user's message, then flips the chat to
    "running" - fast, Mongo-only work so the HTTP request that kicks off a
    reply returns almost instantly instead of waiting on the AI gateway."""
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
    context = [{"type": "text", "label": "Instructions", "text": SYSTEM_PROMPT}]
    tracked_summary = _tracked_questions_context(owner_id)
    if tracked_summary:
        context.append({
            "type": "text",
            "label": "Already in the user's tracker (never propose these again)",
            "text": tracked_summary,
        })
    try:
        provider, response = routed_gateway_request(
            "POST",
            "/v1/responses",
            payload_for_provider=lambda target: {
                "input": clean_content,
                "conversation": {"providerConversationId": conversation_ids.get(target) or None},
                "context": context,
                "capabilityProfile": "knowledge-only",
                "metadata": {"application": "toolhub-leetcode", "chatId": chat_id},
            },
            timeout=90,
        )
    except AIGatewayError:
        logger.exception("Leetcode AI gateway call failed for chat %s", chat_id)
        failed_at = now_iso()
        col(MESSAGES).insert_one({
            "id": str(uuid.uuid4()),
            "chatId": chat_id,
            "role": "assistant",
            "content": "The assistant could not complete this request. Please try again.",
            "status": "failed",
            "addedCollection": None,
            "createdAt": failed_at,
        })
        col(CHATS).update_one({"id": chat_id}, {"$set": {"runStatus": "idle", "updatedAt": failed_at}})
        return

    assistant_text = str(response.get("outputText") or "").strip()
    provider_conversation_id = str(
        (response.get("conversation") or {}).get("providerConversationId") or ""
    ).strip()
    added_collection: Optional[Dict[str, Any]] = None

    collection_payload = _extract_collection_payload(assistant_text) if assistant_text else None
    if collection_payload:
        added_collection = _resolve_collection(collection_payload, owner_id)
        if added_collection["count"]:
            lines = [f"Added **{added_collection['count']}** question(s) to **{added_collection['label']}**:", ""]
            for question in added_collection["questions"]:
                lines.append(f"- [{question['title']}]({question['url']}) — {question['difficulty']}")
            assistant_text = "\n".join(lines)
        else:
            assistant_text = (
                f"I couldn't add anything new to **{added_collection['label']}** — the problems I "
                "found are either already in your tracker or couldn't be verified on LeetCode."
            )

    completed_at = now_iso()
    col(MESSAGES).insert_one({
        "id": str(uuid.uuid4()),
        "chatId": chat_id,
        "role": "assistant",
        "content": assistant_text or "I couldn't generate a response. Please try again.",
        "status": "completed",
        "addedCollection": added_collection,
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
        logger.exception("Background leetcode AI reply failed for chat %s", chat_id)
        failed_at = now_iso()
        col(CHATS).update_one({"id": chat_id}, {"$set": {"runStatus": "idle", "updatedAt": failed_at}})


def send_message(chat_id: str, owner_id: str, content: Any) -> Dict[str, Any]:
    """Kicks off a reply in the background and returns immediately - the
    caller polls get_chat() for the assistant message."""
    chat, user_message = begin_message(chat_id, owner_id, content)
    _EXECUTOR.submit(complete_message_safely, chat_id, owner_id, chat, user_message["content"])
    return {"accepted": True, "userMessage": jsonable(user_message)}
