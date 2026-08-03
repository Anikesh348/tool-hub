from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import JSONResponse

from app.middlewares.auth import admin_user
from app.services.ai_chats import (
    begin_message,
    complete_message_safely,
    create_chat,
    get_chat,
    list_chats,
)
from app.services.ai_gateway import AIGatewayError, gateway_request
from app.utils.responses import success


router = APIRouter()


def _gateway_error(exc: AIGatewayError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": str(exc)}},
    )


@router.get("/v2/admin/ai/health")
def ai_health(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success(gateway_request("GET", "/readyz", timeout=5))
    except AIGatewayError as exc:
        return _gateway_error(exc)


@router.post("/v2/admin/ai/chats")
def create_ai_chat(body: Dict[str, Any], user: Dict[str, str] = Depends(admin_user)):
    return success(create_chat(user["userId"], body.get("title"), body.get("provider")))


@router.get("/v2/admin/ai/chats")
def list_ai_chats(user: Dict[str, str] = Depends(admin_user)):
    return success({"items": list_chats(user["userId"])})


@router.get("/v2/admin/ai/chats/{chat_id}")
def get_ai_chat(chat_id: str, user: Dict[str, str] = Depends(admin_user)):
    return success({"chat": get_chat(chat_id, user["userId"])})


@router.post("/v2/admin/ai/chats/{chat_id}/messages", status_code=202)
def send_ai_message(
    chat_id: str,
    body: Dict[str, Any],
    background_tasks: BackgroundTasks,
    user: Dict[str, str] = Depends(admin_user),
):
    chat, user_message, clean_content, context = begin_message(
        chat_id, user["userId"], body.get("content"), body.get("context")
    )
    background_tasks.add_task(
        complete_message_safely,
        chat_id,
        user["userId"],
        chat,
        user_message,
        clean_content,
        context,
    )
    return success({
        "accepted": True,
        "userMessage": user_message,
    })
