from __future__ import annotations

import hashlib
import logging
import re
import uuid
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING

from app.services.ai_gateway import gateway_request
from app.services.mongo import col
from app.utils.responses import jsonable, now_iso


COURSES = "courses"
MODULES = "course_modules"
QUESTIONS = "course_questions"
PROGRESS = "course_progress"
SEED_ROOT = Path(__file__).resolve().parent.parent / "seed" / "courses"
MAX_SELECTION = 4000
MAX_SURROUNDING_CONTEXT = 6000
MAX_QUESTION = 2000
AI_CONTEXT_BUDGET = 7000
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
logger = logging.getLogger(__name__)

CONTEXT_STOP_WORDS = {
    "about", "after", "again", "also", "and", "are", "can", "could", "does",
    "explain", "for", "from", "have", "how", "into", "module", "more", "that",
    "the", "this", "what", "when", "where", "which", "with", "would", "you",
}

LINUX_MODULE_SEEDS = (
    {
        "slug": "how-linux-works",
        "position": 1,
        "title": "How Linux works — a useful mental model",
        "duration": "3–4 hours",
        "excerpt": "Kernel versus user space, programs and processes, shells, identity, and your homelab boundaries.",
        "file": "01-how-linux-works.md",
    },
    {
        "slug": "shell-commands-without-guesswork",
        "position": 2,
        "title": "The shell — commands without guesswork",
        "duration": "6–8 hours",
        "excerpt": "Navigate, inspect, transform, quote, redirect, and compose commands safely.",
        "file": "02-shell-commands-without-guesswork.md",
    },
    {
        "slug": "linux-directory-tree",
        "position": 3,
        "title": "The Linux directory tree — where things belong",
        "duration": "5–6 hours",
        "excerpt": "Understand the single filesystem tree, important directories, links, mounts, and NFS-backed media paths.",
        "file": "03-linux-directory-tree.md",
    },
    {
        "slug": "users-groups-permissions",
        "position": 4,
        "title": "Users, groups and permissions",
        "duration": "8–10 hours",
        "excerpt": "Reason about UID/GID, mode bits, sudo, Docker ownership, NFS identity, ACLs, and diagnosis.",
        "file": "04-users-groups-permissions.md",
    },
    {
        "slug": "foundation-review",
        "position": 5,
        "title": "Foundation review and next steps",
        "duration": "1–2 hours",
        "excerpt": "Test the mental model, review essential commands, and prepare for services, networking, storage, and Docker.",
        "file": "05-foundation-review.md",
    },
)

INTEGRATION_MODULE_SEEDS = (
    {
        "slug": "capabilities-and-system-goals",
        "position": 1,
        "title": "Capabilities, goals and non-goals",
        "duration": "45–60 minutes",
        "excerpt": "What the integration can do today, what each capability profile permits, and the deliberate boundaries.",
        "file": "01-capabilities-and-system-goals.md",
    },
    {
        "slug": "high-level-architecture",
        "position": 2,
        "title": "High-level architecture and ownership",
        "duration": "60–75 minutes",
        "excerpt": "Follow requests across the browser, ToolHub, gateway, executor, Codex CLI, and their persistence boundaries.",
        "file": "02-high-level-architecture.md",
    },
    {
        "slug": "contract-and-request-security",
        "position": 3,
        "title": "Provider-neutral contract and request security",
        "duration": "75–90 minutes",
        "excerpt": "REST schemas, HMAC signing, scopes, source restrictions, timestamps, nonces, and replay protection.",
        "file": "03-contract-and-request-security.md",
    },
    {
        "slug": "codex-gateway-low-level-design",
        "position": 4,
        "title": "Codex gateway — low-level design",
        "duration": "75–90 minutes",
        "excerpt": "Validation, prompt assembly, runtime snapshots, concurrency, audit records, errors, and executor adaptation.",
        "file": "04-codex-gateway-low-level-design.md",
    },
    {
        "slug": "hp-codex-executor-wrapper",
        "position": 5,
        "title": "hp-codex executor and Codex CLI wrapper",
        "duration": "90–120 minutes",
        "excerpt": "The private execution API, fixed CLI command, sanitized environment, profiles, event parsing, timeouts, and process isolation.",
        "file": "05-hp-codex-executor-wrapper.md",
    },
    {
        "slug": "toolhub-application-integration",
        "position": 6,
        "title": "ToolHub application integration",
        "duration": "90–120 minutes",
        "excerpt": "Admin authorization, chat persistence, background execution, course context retrieval, polling, and frontend behavior.",
        "file": "06-toolhub-application-integration.md",
    },
    {
        "slug": "operations-reliability-and-review",
        "position": 7,
        "title": "Operations, reliability and design review",
        "duration": "75–90 minutes",
        "excerpt": "Systemd hardening, private networking, health, failure modes, observability, rollback, trade-offs, and future providers.",
        "file": "07-operations-reliability-and-review.md",
    },
)

COURSE_SEEDS = (
    {
        "id": "linux-homelab-foundations",
        "title": "Linux Homelab Foundations — The Clear Guide",
        "subtitle": "Learn Linux as the operator of hp-codex, ubuntu-purva, pi-purva, and the services between them.",
        "description": "A slow, visual, hands-on foundation covering how Linux works, shell reasoning, the directory tree, users, groups, permissions, Docker, and NFS identity.",
        "level": "Foundation",
        "estimatedHours": "23–30 hours",
        "source": "Linux-Homelab-Foundations-Clear-Guide.pdf",
        "modules": LINUX_MODULE_SEEDS,
    },
    {
        "id": "toolhub-codex-integration-architecture",
        "title": "ToolHub–Codex Integration Architecture",
        "subtitle": "A complete HLD and LLD review of ToolHub's reusable private AI platform.",
        "description": "Understand every layer from the ToolHub course and chat interfaces through MongoDB, the signed provider-neutral gateway, the private hp-codex executor, and the Codex CLI runtime.",
        "level": "Intermediate",
        "estimatedHours": "8–10 hours",
        "source": "Verified production implementation and deployment documentation",
        "modules": INTEGRATION_MODULE_SEEDS,
    },
)


def _module_id(course_id: str, slug: str) -> str:
    return f"{course_id}:{slug}"


def _relevant_module_context(content: str, question: str, budget: int) -> str:
    """Return an outline plus question-relevant lesson blocks within the gateway limit."""
    if budget <= 0:
        return ""
    blocks = [block.strip() for block in re.split(r"\n\s*\n", content) if block.strip()]
    terms = {
        term for term in re.findall(r"[a-z0-9_-]{3,}", question.lower())
        if term not in CONTEXT_STOP_WORDS
    }
    headings = [block for block in blocks if block.startswith("#")]
    ranked = sorted(
        enumerate(blocks),
        key=lambda item: (
            sum(item[1].lower().count(term) for term in terms),
            1 if item[1].startswith("#") else 0,
            -item[0],
        ),
        reverse=True,
    )
    candidates = ["Module outline:\n" + "\n".join(headings)]
    candidates.extend(block for _, block in ranked)
    chosen: list[str] = []
    used: set[str] = set()
    remaining = budget
    for candidate in candidates:
        if candidate in used or remaining <= 0:
            continue
        used.add(candidate)
        piece = candidate[:remaining]
        if piece:
            chosen.append(piece)
            remaining -= len(piece) + 2
    return "\n\n".join(chosen)[:budget]


def _public_module(document: Dict[str, Any], include_content: bool = False) -> Dict[str, Any]:
    result = {
        "id": document["id"],
        "courseId": document["courseId"],
        "slug": document["slug"],
        "position": document["position"],
        "title": document["title"],
        "duration": document["duration"],
        "excerpt": document["excerpt"],
        "readingMinutes": document.get("readingMinutes", 1),
        "updatedAt": document["updatedAt"],
    }
    if include_content:
        result["content"] = document["content"]
    return jsonable(result)


def _public_question(document: Dict[str, Any]) -> Dict[str, Any]:
    return jsonable({
        "id": document["id"],
        "courseId": document["courseId"],
        "moduleId": document["moduleId"],
        "moduleSlug": document["moduleSlug"],
        "selectedText": document["selectedText"],
        "question": document["question"],
        "answer": document.get("answer", ""),
        "status": document.get("status", "pending"),
        "error": document.get("error", ""),
        "createdAt": document["createdAt"],
        "updatedAt": document["updatedAt"],
    })


def ensure_course_indexes_and_seed() -> None:
    courses = col(COURSES)
    modules = col(MODULES)
    questions = col(QUESTIONS)
    progress = col(PROGRESS)
    courses.create_index([("id", ASCENDING)], unique=True)
    modules.create_index([("id", ASCENDING)], unique=True)
    modules.create_index([("courseId", ASCENDING), ("position", ASCENDING)], unique=True)
    questions.create_index([("id", ASCENDING)], unique=True)
    questions.create_index([("ownerId", ASCENDING), ("moduleId", ASCENDING), ("createdAt", DESCENDING)])
    progress.create_index([("ownerId", ASCENDING), ("moduleId", ASCENDING)], unique=True)

    now = now_iso()
    for course_seed in COURSE_SEEDS:
        course_id = course_seed["id"]
        seeded = []
        for item in course_seed["modules"]:
            path = SEED_ROOT / course_id / item["file"]
            if not path.is_file():
                raise RuntimeError(f"Course seed is missing: {course_id}/{item['file']}")
            content = path.read_text(encoding="utf-8").strip()
            content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
            module = {
                "id": _module_id(course_id, item["slug"]),
                "courseId": course_id,
                "slug": item["slug"],
                "position": item["position"],
                "title": item["title"],
                "duration": item["duration"],
                "excerpt": item["excerpt"],
                "content": content,
                "contentHash": content_hash,
                "readingMinutes": max(1, (len(content.split()) + 219) // 220),
                "updatedAt": now,
            }
            modules.update_one(
                {"id": module["id"]},
                {"$set": module, "$setOnInsert": {"createdAt": now}},
                upsert=True,
            )
            seeded.append(module)

        courses.update_one(
            {"id": course_id},
            {
                "$set": {
                    "id": course_id,
                    "title": course_seed["title"],
                    "subtitle": course_seed["subtitle"],
                    "description": course_seed["description"],
                    "level": course_seed["level"],
                    "estimatedHours": course_seed["estimatedHours"],
                    "moduleCount": len(seeded),
                    "status": "published",
                    "source": course_seed["source"],
                    "updatedAt": now,
                },
                "$setOnInsert": {"createdAt": now},
            },
            upsert=True,
        )


def _course(course_id: str) -> Dict[str, Any]:
    document = col(COURSES).find_one({"id": course_id, "status": "published"})
    if not document:
        raise HTTPException(status_code=404, detail="Course not found")
    return document


def _module(course_id: str, module_slug: str) -> Dict[str, Any]:
    if not SLUG_PATTERN.fullmatch(module_slug):
        raise HTTPException(status_code=404, detail="Course module not found")
    document = col(MODULES).find_one({"courseId": course_id, "slug": module_slug})
    if not document:
        raise HTTPException(status_code=404, detail="Course module not found")
    return document


def list_courses(owner_id: str) -> list[Dict[str, Any]]:
    result = []
    for course in col(COURSES).find({"status": "published"}).sort("createdAt", ASCENDING):
        completed = col(PROGRESS).count_documents({
            "ownerId": owner_id,
            "courseId": course["id"],
            "completed": True,
        })
        item = jsonable(course)
        item.pop("_id", None)
        item["completedModuleCount"] = completed
        result.append(item)
    return result


def get_course(course_id: str, owner_id: str) -> Dict[str, Any]:
    course = jsonable(_course(course_id))
    course.pop("_id", None)
    progress_by_module = {
        item["moduleId"]: item
        for item in col(PROGRESS).find({"ownerId": owner_id, "courseId": course_id})
    }
    modules = []
    for module in col(MODULES).find({"courseId": course_id}).sort("position", ASCENDING):
        item = _public_module(module)
        progress = progress_by_module.get(module["id"], {})
        item["completed"] = bool(progress.get("completed"))
        item["readingProgress"] = float(progress.get("readingProgress") or 0)
        modules.append(item)
    course["modules"] = modules
    course["completedModuleCount"] = sum(1 for module in modules if module["completed"])
    return course


def get_course_module(course_id: str, module_slug: str, owner_id: str) -> Dict[str, Any]:
    _course(course_id)
    module = _module(course_id, module_slug)
    progress = col(PROGRESS).find_one({"ownerId": owner_id, "moduleId": module["id"]}) or {}
    result = _public_module(module, include_content=True)
    result["completed"] = bool(progress.get("completed"))
    result["readingProgress"] = float(progress.get("readingProgress") or 0)
    result["questions"] = [
        _public_question(item)
        for item in col(QUESTIONS).find({"ownerId": owner_id, "moduleId": module["id"]}).sort("createdAt", DESCENDING)
    ]
    return result


def update_progress(course_id: str, module_slug: str, owner_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    _course(course_id)
    module = _module(course_id, module_slug)
    try:
        reading_progress = float(body.get("readingProgress", 0))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid reading progress") from exc
    reading_progress = max(0.0, min(1.0, reading_progress))
    completed = bool(body.get("completed"))
    now = now_iso()
    col(PROGRESS).update_one(
        {"ownerId": owner_id, "moduleId": module["id"]},
        {
            "$set": {
                "ownerId": owner_id,
                "courseId": course_id,
                "moduleId": module["id"],
                "moduleSlug": module_slug,
                "readingProgress": 1.0 if completed else reading_progress,
                "completed": completed,
                "updatedAt": now,
            },
            "$setOnInsert": {"createdAt": now},
        },
        upsert=True,
    )
    return {"moduleId": module["id"], "readingProgress": 1.0 if completed else reading_progress, "completed": completed}


def create_course_question(course_id: str, module_slug: str, owner_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    course = _course(course_id)
    module = _module(course_id, module_slug)
    selected_text = str(body.get("selectedText") or "").strip()
    question = str(body.get("question") or "").strip()
    context_before = str(body.get("contextBefore") or "").strip()
    context_after = str(body.get("contextAfter") or "").strip()
    if len(selected_text) > MAX_SELECTION:
        raise HTTPException(status_code=400, detail="Selected text cannot exceed 4000 characters")
    if not question or len(question) > MAX_QUESTION:
        raise HTTPException(status_code=400, detail="Question must contain 1 to 2000 characters")
    if len(context_before) + len(context_after) > MAX_SURROUNDING_CONTEXT:
        raise HTTPException(status_code=400, detail="Selection context is too large")
    now = now_iso()
    document = {
        "id": str(uuid.uuid4()),
        "ownerId": owner_id,
        "courseId": course_id,
        "courseTitle": course["title"],
        "moduleId": module["id"],
        "moduleSlug": module_slug,
        "moduleTitle": module["title"],
        "moduleContentSnapshot": module["content"],
        "moduleContentHash": module.get("contentHash", ""),
        "selectedText": selected_text,
        "question": question,
        "contextBefore": context_before,
        "contextAfter": context_after,
        "answer": "",
        "status": "pending",
        "error": "",
        "createdAt": now,
        "updatedAt": now,
    }
    col(QUESTIONS).insert_one(document)
    return _public_question(document)


def complete_course_question_safely(question_id: str) -> None:
    document = col(QUESTIONS).find_one({"id": question_id, "status": "pending"})
    if not document:
        return
    try:
        selected = str(document.get("selectedText") or "")[:3500]
        surrounding = "\n\n".join(
            part for part in (document.get("contextBefore", ""), document.get("contextAfter", "")) if part
        )[:1800]
        module_budget = AI_CONTEXT_BUDGET - len(selected) - len(surrounding)
        module_context = _relevant_module_context(
            str(document.get("moduleContentSnapshot") or ""),
            document["question"],
            max(1200, module_budget),
        )
        context = [
            {"type": "text", "label": "Course", "text": document["courseTitle"]},
            {"type": "text", "label": "Module", "text": document["moduleTitle"]},
            {
                "type": "text",
                "label": "Relevant module lesson context",
                "text": module_context,
            },
        ]
        if selected:
            context.append({"type": "text", "label": "Selected passage", "text": selected})
        if surrounding:
            context.append({"type": "text", "label": "Surrounding lesson context", "text": surrounding})
        response = gateway_request(
            "POST",
            "/v1/responses",
            payload={
                "input": (
                    "Use the supplied course module as the primary context. "
                    + ("Give special attention to the selected passage. " if document.get("selectedText") else "")
                    + "Answer this learner question in direct, beginner-friendly language: "
                    + document["question"]
                ),
                "conversation": {"providerConversationId": None},
                "context": context,
                "capabilityProfile": "knowledge-only",
                "metadata": {
                    "application": "toolhub-courses",
                    "courseId": document["courseId"],
                    "moduleId": document["moduleId"],
                    "questionId": question_id,
                },
            },
            timeout=330,
        )
        answer = str(response.get("outputText") or "").strip()
        if not answer:
            raise RuntimeError("AI gateway returned an empty course explanation")
        col(QUESTIONS).update_one(
            {"id": question_id},
            {"$set": {
                "answer": answer,
                "status": "completed",
                "error": "",
                "providerRequestId": str(response.get("id") or ""),
                "providerConversationId": str((response.get("conversation") or {}).get("providerConversationId") or ""),
                "updatedAt": now_iso(),
            }},
        )
    except Exception as exc:
        logger.exception("Course explanation failed for question %s", question_id)
        col(QUESTIONS).update_one(
            {"id": question_id},
            {"$set": {
                "status": "failed",
                "error": "The AI explanation could not be completed. Try again.",
                "updatedAt": now_iso(),
            }},
        )


def get_course_question(question_id: str, owner_id: str) -> Dict[str, Any]:
    document = col(QUESTIONS).find_one({"id": question_id, "ownerId": owner_id})
    if not document:
        raise HTTPException(status_code=404, detail="Course question not found")
    return _public_question(document)
