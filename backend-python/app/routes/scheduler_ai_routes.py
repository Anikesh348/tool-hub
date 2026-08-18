from typing import Any, Dict

from fastapi import APIRouter, Depends

from app.middlewares.auth import admin_user
from app.services.scheduler_ai import create_chat, get_chat, list_chats, send_message
from app.utils.responses import success

router = APIRouter()


@router.post("/v2/admin/scheduler-ai/chats")
def scheduler_ai_create_chat(body: Dict[str, Any], user: Dict[str, str] = Depends(admin_user)):
    return success(create_chat(user["userId"], body.get("title")))


@router.get("/v2/admin/scheduler-ai/chats")
def scheduler_ai_list_chats(user: Dict[str, str] = Depends(admin_user)):
    return success({"items": list_chats(user["userId"])})


@router.get("/v2/admin/scheduler-ai/chats/{chat_id}")
def scheduler_ai_get_chat(chat_id: str, user: Dict[str, str] = Depends(admin_user)):
    return success({"chat": get_chat(chat_id, user["userId"])})


@router.post("/v2/admin/scheduler-ai/chats/{chat_id}/messages", status_code=202)
def scheduler_ai_send_message(
    chat_id: str,
    body: Dict[str, Any],
    user: Dict[str, str] = Depends(admin_user),
):
    return success(send_message(chat_id, user["userId"], body.get("content")))
