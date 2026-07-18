from typing import Dict, List

from fastapi import APIRouter, Depends, Query, Request

from app.middlewares.auth import admin_user
from app.services.leetcode import add_questions, delete_question, get_questions, update_question_notes, update_question_status

router = APIRouter()


@router.post("/v2/leetcode/add")
async def leetcode_add(request: Request, user: Dict[str, str] = Depends(admin_user)):
    body = await request.json()
    return add_questions(body.get("questionUrls") or [], user)


@router.get("/v2/leetcode/questions")
def leetcode_questions(tags: List[str] = Query(default=[]), operation: str = "union", user: Dict[str, str] = Depends(admin_user)):
    return get_questions(tags, operation, user)


@router.post("/v2/leetcode/update-status")
async def leetcode_update_status(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return update_question_status(await request.json(), user)


@router.post("/v2/leetcode/update-notes")
async def leetcode_update_notes(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return update_question_notes(await request.json(), user)


@router.post("/v2/leetcode/delete")
async def leetcode_delete(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return delete_question(await request.json(), user)
