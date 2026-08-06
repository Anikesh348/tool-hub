from typing import Any, Dict

from fastapi import APIRouter, BackgroundTasks, Depends

from app.middlewares.auth import admin_user
from app.services.courses import (
    complete_course_question_safely,
    create_course_question,
    get_course,
    get_course_module,
    get_course_question,
    list_courses,
    update_progress,
)
from app.utils.responses import success


router = APIRouter()


@router.get("/v2/admin/courses")
def admin_courses(user: Dict[str, str] = Depends(admin_user)):
    return success({"items": list_courses(user["userId"])})


@router.get("/v2/admin/courses/{course_id}")
def admin_course(course_id: str, user: Dict[str, str] = Depends(admin_user)):
    return success({"course": get_course(course_id, user["userId"])})


@router.get("/v2/admin/courses/{course_id}/modules/{module_slug}")
def admin_course_module(
    course_id: str,
    module_slug: str,
    user: Dict[str, str] = Depends(admin_user),
):
    return success({"module": get_course_module(course_id, module_slug, user["userId"])})


@router.patch("/v2/admin/courses/{course_id}/modules/{module_slug}/progress")
def admin_course_progress(
    course_id: str,
    module_slug: str,
    body: Dict[str, Any],
    user: Dict[str, str] = Depends(admin_user),
):
    return success(update_progress(course_id, module_slug, user["userId"], body))


@router.post(
    "/v2/admin/courses/{course_id}/modules/{module_slug}/questions",
    status_code=202,
)
def admin_course_question_create(
    course_id: str,
    module_slug: str,
    body: Dict[str, Any],
    background_tasks: BackgroundTasks,
    user: Dict[str, str] = Depends(admin_user),
):
    question = create_course_question(course_id, module_slug, user["userId"], body)
    background_tasks.add_task(complete_course_question_safely, question["id"])
    return success({"accepted": True, "question": question})


@router.get("/v2/admin/courses/questions/{question_id}")
def admin_course_question(question_id: str, user: Dict[str, str] = Depends(admin_user)):
    return success({"question": get_course_question(question_id, user["userId"])})
