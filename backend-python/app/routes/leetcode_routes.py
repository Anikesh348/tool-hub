import asyncio
from typing import Dict, List

from fastapi import APIRouter, Depends, Query, Request

from app.middlewares.auth import admin_user
from app.services.leetcode import (
    add_questions,
    delete_collection,
    delete_question,
    duplicate_set,
    get_questions,
    list_sets,
    toggle_bookmark,
    toggle_set_pin,
    update_question_notes,
    update_question_status,
    update_set,
)

router = APIRouter()


@router.post("/v2/leetcode/add")
async def leetcode_add(request: Request, user: Dict[str, str] = Depends(admin_user)):
    body = await request.json()
    return await asyncio.to_thread(add_questions, body.get("questionUrls") or [], user)


@router.get("/v2/leetcode/questions")
def leetcode_questions(
    tags: List[str] = Query(default=[]),
    operation: str = "union",
    collection: str = "",
    user: Dict[str, str] = Depends(admin_user),
):
    return get_questions(tags, operation, user, collection)


@router.post("/v2/leetcode/update-status")
async def leetcode_update_status(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return update_question_status(await request.json(), user)


@router.post("/v2/leetcode/update-notes")
async def leetcode_update_notes(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return update_question_notes(await request.json(), user)


@router.post("/v2/leetcode/delete")
async def leetcode_delete(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return delete_question(await request.json(), user)


@router.post("/v2/leetcode/delete-collection")
async def leetcode_delete_collection(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return delete_collection(await request.json(), user)


@router.post("/v2/leetcode/toggle-bookmark")
async def leetcode_toggle_bookmark(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return toggle_bookmark(await request.json(), user)


@router.get("/v2/leetcode/sets")
def leetcode_list_sets(user: Dict[str, str] = Depends(admin_user)):
    return {"items": list_sets(user)}


@router.patch("/v2/leetcode/sets/{label}")
async def leetcode_update_set(label: str, request: Request, user: Dict[str, str] = Depends(admin_user)):
    return update_set(label, await request.json(), user)


@router.post("/v2/leetcode/sets/{label}/pin")
def leetcode_toggle_set_pin(label: str, user: Dict[str, str] = Depends(admin_user)):
    return toggle_set_pin(label, user)


@router.post("/v2/leetcode/sets/{label}/duplicate")
def leetcode_duplicate_set(label: str, user: Dict[str, str] = Depends(admin_user)):
    return duplicate_set(label, user)
