from __future__ import annotations

import uuid
import logging
from typing import Any, Dict

from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING, ReturnDocument

from app.services.ai_gateway import SUPPORTED_PROVIDERS, AIGatewayError
from app.services.ai_provider_router import PREFERRED_PROVIDER, routed_gateway_request
from app.services.mongo import col
from app.utils.responses import jsonable, now_iso


CHATS = "ai_chats"
MESSAGES = "ai_messages"
MAX_TITLE = 120
MAX_MESSAGE = 16000
MAX_CONTEXT = 8000
logger = logging.getLogger(__name__)


def _conversation_ids(chat: Dict[str, Any]) -> Dict[str, str]:
    """Provider-scoped conversation ids, upgrading chats stored before failover."""
    stored = chat.get("providerConversationIds")
    if isinstance(stored, dict):
        return {
            provider: str(stored.get(provider) or "")
            for provider in SUPPORTED_PROVIDERS
            if stored.get(provider)
        }
    legacy = str(chat.get("providerConversationId") or "").strip()
    if not legacy:
        return {}
    provider = str(chat.get("provider") or PREFERRED_PROVIDER).strip().lower()
    if provider not in SUPPORTED_PROVIDERS:
        provider = PREFERRED_PROVIDER
    return {provider: legacy}


def ensure_ai_indexes() -> None:
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
        "provider": document.get("provider", "codex"),
        "status": document.get("status", "active"),
        "runStatus": document.get("runStatus", "idle"),
        "providerConversationIdPresent": bool(_conversation_ids(document)),
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
                "provider": item.get("provider"),
                "createdAt": item["createdAt"],
            }
            for item in records
        ]
    return jsonable(result)


def _owned_chat(chat_id: str, owner_id: str) -> Dict[str, Any]:
    document = col(CHATS).find_one({"id": chat_id, "ownerId": owner_id, "status": "active"})
    if document is None:
        raise HTTPException(status_code=404, detail="AI chat not found")
    return document


def create_chat(owner_id: str, title: Any = None, provider: Any = None) -> Dict[str, Any]:
    clean_title = str(title or "New chat").strip()
    clean_provider = str(provider or PREFERRED_PROVIDER).strip().lower()
    if not clean_title or len(clean_title) > MAX_TITLE:
        raise HTTPException(status_code=400, detail="Chat title must contain 1 to 120 characters")
    if clean_provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported AI provider")
    now = now_iso()
    document = {
        "id": str(uuid.uuid4()),
        "ownerId": owner_id,
        "title": clean_title,
        # Routing is decided per request by the provider router; this records
        # which provider most recently answered in this chat.
        "provider": clean_provider,
        "status": "active",
        "runStatus": "idle",
        "providerConversationId": None,
        "providerConversationIds": {},
        "createdAt": now,
        "updatedAt": now,
    }
    col(CHATS).insert_one(document)
    return _public_chat(document)


def list_chats(owner_id: str, limit: int = 50) -> list[Dict[str, Any]]:
    records = col(CHATS).find({"ownerId": owner_id, "status": "active"}).sort(
        "updatedAt", DESCENDING
    ).limit(max(1, min(limit, 100)))
    return [_public_chat(record) for record in records]


def get_chat(chat_id: str, owner_id: str) -> Dict[str, Any]:
    return _public_chat(_owned_chat(chat_id, owner_id), include_messages=True)


def _validate_context(raw: Any) -> list[Dict[str, str]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="Context must be an array")
    result: list[Dict[str, str]] = []
    size = 0
    for item in raw:
        if not isinstance(item, dict) or item.get("type") != "text":
            raise HTTPException(status_code=400, detail="Unsupported context item")
        text = str(item.get("text") or "").strip()
        size += len(text)
        if size > MAX_CONTEXT:
            raise HTTPException(status_code=400, detail="Context is too large")
        if text:
            result.append({
                "type": "text",
                "label": str(item.get("label") or "Context").strip()[:120],
                "text": text,
            })
    return result


def begin_message(
    chat_id: str,
    owner_id: str,
    content: Any,
    raw_context: Any = None,
) -> tuple[Dict[str, Any], Dict[str, Any], str, list[Dict[str, str]]]:
    clean_content = str(content or "").strip()
    if not clean_content or len(clean_content) > MAX_MESSAGE:
        raise HTTPException(status_code=400, detail="Message must contain 1 to 16000 characters")
    context = _validate_context(raw_context)
    now = now_iso()
    chat = col(CHATS).find_one_and_update(
        {"id": chat_id, "ownerId": owner_id, "status": "active", "runStatus": "idle"},
        {"$set": {"runStatus": "running", "updatedAt": now}},
        return_document=ReturnDocument.AFTER,
    )
    if chat is None:
        existing = col(CHATS).find_one({"id": chat_id, "ownerId": owner_id, "status": "active"})
        if existing is None:
            raise HTTPException(status_code=404, detail="AI chat not found")
        raise HTTPException(status_code=409, detail="This chat is already processing a message")
    user_message = {
        "id": str(uuid.uuid4()),
        "chatId": chat_id,
        "role": "user",
        "content": clean_content,
        "context": context,
        "status": "pending",
        "createdAt": now,
    }
    col(MESSAGES).insert_one(user_message)
    return chat, user_message, clean_content, context


def complete_message(
    chat_id: str,
    owner_id: str,
    chat: Dict[str, Any],
    user_message: Dict[str, Any],
    clean_content: str,
    context: list[Dict[str, str]],
) -> Dict[str, Any]:
    conversation_ids = _conversation_ids(chat)
    try:
        provider, response = routed_gateway_request(
            "POST",
            "/v1/responses",
            payload_for_provider=lambda target: {
                "input": clean_content,
                # Conversation ids are provider-specific, so a chat that fails
                # over starts a fresh thread on the new provider instead of
                # replaying an identifier it cannot resolve.
                "conversation": {
                    "providerConversationId": conversation_ids.get(target) or None
                },
                "context": context,
                "capabilityProfile": "read-only",
                "metadata": {"application": "toolhub", "chatId": chat_id},
            },
            timeout=330,
        )
        assistant_text = str(response.get("outputText") or "").strip()
        provider_conversation_id = str(
            (response.get("conversation") or {}).get("providerConversationId") or ""
        ).strip()
        if not assistant_text or not provider_conversation_id:
            raise AIGatewayError("AI gateway returned an incomplete response")
        completed_at = now_iso()
        assistant_message = {
            "id": str(uuid.uuid4()),
            "chatId": chat_id,
            "role": "assistant",
            "content": assistant_text,
            "status": "completed",
            "provider": provider,
            "providerRequestId": str(response.get("id") or ""),
            "createdAt": completed_at,
        }
        col(MESSAGES).insert_one(assistant_message)
        col(MESSAGES).update_one(
            {"id": user_message["id"]}, {"$set": {"status": "completed"}}
        )
        conversation_ids[provider] = provider_conversation_id
        updates: Dict[str, Any] = {
            "provider": provider,
            "providerConversationId": provider_conversation_id,
            "providerConversationIds": conversation_ids,
            "runStatus": "idle",
            "updatedAt": completed_at,
        }
        if chat.get("title") == "New chat":
            updates["title"] = clean_content[:60] + ("..." if len(clean_content) > 60 else "")
        col(CHATS).update_one({"id": chat_id, "ownerId": owner_id}, {"$set": updates})
        user_message["status"] = "completed"
        return {
            "requestId": response.get("id"),
            "provider": provider,
            "userMessage": jsonable(user_message),
            "assistantMessage": jsonable(assistant_message),
        }
    except Exception:
        failed_at = now_iso()
        col(MESSAGES).update_one(
            {"id": user_message["id"]}, {"$set": {"status": "failed"}}
        )
        col(CHATS).update_one(
            {"id": chat_id, "ownerId": owner_id},
            {"$set": {"runStatus": "idle", "updatedAt": failed_at}},
        )
        raise


def complete_message_safely(
    chat_id: str,
    owner_id: str,
    chat: Dict[str, Any],
    user_message: Dict[str, Any],
    clean_content: str,
    context: list[Dict[str, str]],
) -> None:
    try:
        complete_message(chat_id, owner_id, chat, user_message, clean_content, context)
    except Exception:
        logger.exception("Background AI message failed for chat %s", chat_id)


def send_message(
    chat_id: str,
    owner_id: str,
    content: Any,
    raw_context: Any = None,
) -> Dict[str, Any]:
    chat, user_message, clean_content, context = begin_message(
        chat_id, owner_id, content, raw_context
    )
    return complete_message(
        chat_id, owner_id, chat, user_message, clean_content, context
    )
