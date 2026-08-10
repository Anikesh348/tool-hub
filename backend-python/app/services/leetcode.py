import uuid
from typing import Any, Dict, List

from fastapi.responses import JSONResponse

from app.services.leetcode_metadata import fetch_question_metadata
from app.services.mongo import col, delete_one_or_404, find, update_one_or_404
from app.utils.responses import error, jsonable, now_iso, success


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
            "bookmarked": False,
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


def delete_collection(body: Dict[str, Any], user: Dict[str, str]):
    collection_label = (body.get("collectionLabel") or "").strip()
    if not collection_label:
        return JSONResponse(status_code=400, content=error("Missing collectionLabel"))
    result = col("leetcode").delete_many({"collectionLabel": collection_label, "userId": user["userId"]})
    col("leetcode_question_sets").delete_one({"userId": user["userId"], "label": collection_label})
    if result.deleted_count == 0:
        return JSONResponse(status_code=404, content=error("No questions found in that collection"))
    return success(f"Deleted {result.deleted_count} question(s) from the collection")


def toggle_bookmark(body: Dict[str, Any], user: Dict[str, str]):
    if not body.get("questionId"):
        return JSONResponse(status_code=400, content=error("Missing questionId"))
    doc = col("leetcode").find_one({"questionId": body["questionId"], "userId": user["userId"]})
    if doc is None:
        return JSONResponse(status_code=404, content=error("Question not found"))
    new_value = not bool(doc.get("bookmarked"))
    col("leetcode").update_one(
        {"questionId": body["questionId"], "userId": user["userId"]},
        {"$set": {"bookmarked": new_value, "updatedAt": now_iso()}},
    )
    return success({"questionId": body["questionId"], "bookmarked": new_value})


# --- AI Question Sets -------------------------------------------------
# A "set" is just the group of `leetcode` documents sharing a collectionLabel
# (created either manually or by the AI generator/wizard). This collection
# only stores presentation metadata (pin, description) that doesn't belong on
# every individual question row - `collectionLabel` on `leetcode` documents
# remains the source of truth for *membership* in a set.

def upsert_question_set(label: str, user_id: str, description: str = "") -> None:
    if col("leetcode_question_sets").find_one({"userId": user_id, "label": label}):
        return
    now = now_iso()
    col("leetcode_question_sets").insert_one({
        "setId": str(uuid.uuid4()),
        "userId": user_id,
        "label": label,
        "description": description,
        "pinned": False,
        "createdAt": now,
        "updatedAt": now,
    })


def _set_stats(label: str, user_id: str) -> Dict[str, int]:
    total = 0
    solved = 0
    for doc in col("leetcode").find({"userId": user_id, "collectionLabel": label}, {"status": 1}):
        total += 1
        if doc.get("status") == "solved":
            solved += 1
    return {"questionCount": total, "solvedCount": solved}


def list_sets(user: Dict[str, str]) -> List[Dict[str, Any]]:
    labels = [label for label in col("leetcode").distinct("collectionLabel", {"userId": user["userId"]}) if label]
    metadata = {
        doc["label"]: doc
        for doc in col("leetcode_question_sets").find({"userId": user["userId"], "label": {"$in": labels}})
    }
    results = []
    for label in labels:
        meta = metadata.get(label, {})
        results.append({
            "label": label,
            "description": meta.get("description", ""),
            "pinned": bool(meta.get("pinned", False)),
            "createdAt": meta.get("createdAt"),
            "updatedAt": meta.get("updatedAt"),
            **_set_stats(label, user["userId"]),
        })
    results.sort(key=lambda item: (not item["pinned"], item["label"].lower()))
    return jsonable(results)


def update_set(label: str, body: Dict[str, Any], user: Dict[str, str]):
    if not col("leetcode").find_one({"userId": user["userId"], "collectionLabel": label}, {"_id": 1}):
        return JSONResponse(status_code=404, content=error("Set not found"))
    upsert_question_set(label, user["userId"])
    if "description" in body:
        col("leetcode_question_sets").update_one(
            {"userId": user["userId"], "label": label},
            {"$set": {"description": str(body.get("description") or "")[:500], "updatedAt": now_iso()}},
        )
    new_label = str(body.get("name") or "").strip()[:120]
    if new_label and new_label != label:
        col("leetcode").update_many(
            {"userId": user["userId"], "collectionLabel": label},
            {"$set": {"collectionLabel": new_label, "updatedAt": now_iso()}},
        )
        col("leetcode_question_sets").update_one(
            {"userId": user["userId"], "label": label},
            {"$set": {"label": new_label, "updatedAt": now_iso()}},
        )
        label = new_label
    return success({"label": label})


def toggle_set_pin(label: str, user: Dict[str, str]):
    if not col("leetcode").find_one({"userId": user["userId"], "collectionLabel": label}, {"_id": 1}):
        return JSONResponse(status_code=404, content=error("Set not found"))
    upsert_question_set(label, user["userId"])
    current = col("leetcode_question_sets").find_one({"userId": user["userId"], "label": label})
    new_value = not bool((current or {}).get("pinned"))
    col("leetcode_question_sets").update_one(
        {"userId": user["userId"], "label": label},
        {"$set": {"pinned": new_value, "updatedAt": now_iso()}},
    )
    return success({"label": label, "pinned": new_value})


def duplicate_set(label: str, user: Dict[str, str]):
    originals = list(col("leetcode").find({"userId": user["userId"], "collectionLabel": label}))
    if not originals:
        return JSONResponse(status_code=404, content=error("Set not found"))
    existing_labels = set(col("leetcode").distinct("collectionLabel", {"userId": user["userId"]}))
    base_name = f"{label} (copy)"
    new_label = base_name
    suffix = 2
    while new_label in existing_labels:
        new_label = f"{base_name} {suffix}"
        suffix += 1
    now = now_iso()
    docs = [{
        "questionId": str(uuid.uuid4()),
        "url": original["url"],
        "title": original.get("title", ""),
        "difficulty": original.get("difficulty", ""),
        "tags": original.get("tags", []),
        "acRate": original.get("acRate"),
        "collectionLabel": new_label,
        "userId": user["userId"],
        "status": "unsolved",
        "bookmarked": False,
        "createdAt": now,
        "updatedAt": now,
        "notes": "",
    } for original in originals]
    col("leetcode").insert_many(docs)
    upsert_question_set(new_label, user["userId"], description=f'Duplicated from "{label}"')
    return success({"label": new_label, "count": len(docs)})
