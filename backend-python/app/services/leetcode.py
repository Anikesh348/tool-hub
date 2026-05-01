import uuid
from typing import Any, Dict, List

from fastapi.responses import JSONResponse

from app.services.mongo import col, delete_one_or_404, find, update_one_or_404
from app.utils.responses import error, now_iso, success


def add_questions(urls: List[Any], user: Dict[str, str]):
    if not urls:
        return JSONResponse(status_code=400, content=error("No question URLs provided"))
    now = now_iso()
    docs = [
        {
            "questionId": str(uuid.uuid4()),
            "questionUrl": str(url),
            "title": "",
            "userId": user["userId"],
            "status": False,
            "createdAt": now,
            "updatedAt": now,
            "notes": "",
        }
        for url in urls
    ]
    col("leetcode").insert_many(docs)
    return {"message": "questions will be inserted"}


def get_questions(tags: List[str], operation: str, user: Dict[str, str]):
    query: Dict[str, Any] = {"userId": user["userId"]}
    clean_tags = [tag for tag in tags if tag.strip()]
    if clean_tags:
        query["tags"] = {"$all" if operation.lower() in {"intersection", "interestion"} else "$in": clean_tags}
    return find("leetcode", query)


def update_question_status(body: Dict[str, Any], user: Dict[str, str]):
    if not body.get("questionId") or body.get("status") is None:
        return JSONResponse(status_code=400, content=error("Missing questionId or status"))
    update_one_or_404(
        "leetcode",
        {"questionId": body["questionId"], "userId": user["userId"]},
        {"$set": {"status": body["status"], "updatedAt": now_iso()}},
    )
    return success("Status updated")


def update_question_notes(body: Dict[str, Any], user: Dict[str, str]):
    if not body.get("questionId") or body.get("notes") is None:
        return JSONResponse(status_code=400, content=error("Missing questionId or notes"))
    update_one_or_404(
        "leetcode",
        {"questionId": body["questionId"], "userId": user["userId"]},
        {"$set": {"notes": body["notes"], "updatedAt": now_iso()}},
    )
    return success("Notes updated")


def delete_question(body: Dict[str, Any], user: Dict[str, str]):
    if not body.get("questionId"):
        return JSONResponse(status_code=400, content=error("Missing questionId"))
    delete_one_or_404("leetcode", {"questionId": body["questionId"], "userId": user["userId"]})
    return success("Question deleted")
