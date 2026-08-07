import uuid
from typing import Any, Dict, List

from fastapi.responses import JSONResponse

from app.services.leetcode_metadata import fetch_question_metadata
from app.services.mongo import col, delete_one_or_404, find, update_one_or_404
from app.utils.responses import error, now_iso, success


def add_questions(urls: List[Any], user: Dict[str, str]):
    if not urls:
        return JSONResponse(status_code=400, content=error("No question URLs provided"))
    existing_urls = {
        doc["url"]
        for doc in col("leetcode").find({"userId": user["userId"]}, {"url": 1})
        if doc.get("url")
    }
    now = now_iso()
    docs = []
    unresolved: List[str] = []
    duplicates: List[str] = []
    for raw_url in urls:
        meta = fetch_question_metadata(str(raw_url))
        if not meta:
            unresolved.append(str(raw_url))
            continue
        if meta["url"] in existing_urls:
            duplicates.append(meta["url"])
            continue
        existing_urls.add(meta["url"])
        docs.append({
            "questionId": str(uuid.uuid4()),
            "url": meta["url"],
            "title": meta.get("title") or "",
            "difficulty": meta.get("difficulty") or "",
            "tags": meta.get("tags") or [],
            "acRate": meta.get("acRate"),
            "collectionLabel": None,
            "userId": user["userId"],
            "status": "unsolved",
            "createdAt": now,
            "updatedAt": now,
            "notes": "",
        })
    if docs:
        col("leetcode").insert_many(docs)
    parts = [f"Added {len(docs)} question(s)."]
    if duplicates:
        parts.append(f"Skipped {len(duplicates)} already tracked.")
    if unresolved:
        parts.append(f"Could not resolve {len(unresolved)} URL(s) on LeetCode.")
    return {
        "message": " ".join(parts),
        "added": len(docs),
        "duplicates": duplicates,
        "unresolved": unresolved,
    }


def get_questions(tags: List[str], operation: str, user: Dict[str, str], collection: str = ""):
    query: Dict[str, Any] = {"userId": user["userId"]}
    clean_tags = [tag for tag in tags if tag.strip()]
    if clean_tags:
        query["tags"] = {"$all" if operation.lower() in {"intersection", "interestion"} else "$in": clean_tags}
    clean_collection = (collection or "").strip()
    if clean_collection:
        query["collectionLabel"] = clean_collection
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
