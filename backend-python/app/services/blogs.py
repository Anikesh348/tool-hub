import hashlib
import json
import logging
import os
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import gridfs
from bson import ObjectId
from fastapi import HTTPException, Request
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core import config
from app.services.mongo import col as primary_col, db as primary_db
from app.utils.responses import jsonable, now_iso


BLOGS_COLLECTION = "blogposts"
BLOG_EVENTS_COLLECTION = "blogevents"
BLOG_REACTIONS_COLLECTION = "blogreactions"
BLOG_COMMENTS_COLLECTION = "blogcomments"
BLOG_TERM_SUMMARIES_COLLECTION = "blogtermsummaries"
BLOG_VERSIONS_COLLECTION = "blogversions"
BLOG_COLLECTIONS = {
    BLOGS_COLLECTION,
    BLOG_EVENTS_COLLECTION,
    BLOG_REACTIONS_COLLECTION,
    BLOG_COMMENTS_COLLECTION,
    BLOG_TERM_SUMMARIES_COLLECTION,
    BLOG_VERSIONS_COLLECTION,
}
BLOG_DB_NAME = os.getenv("BLOG_DB_NAME", "").strip()
BLOG_SEED_DIR = Path(__file__).resolve().parent.parent / "seed"
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TERM_PATTERN = re.compile(
    r"\[(?P<label>[^\]\n]{1,120})\]\(#term:(?P<term_id>[a-z0-9][a-z0-9-]{0,79})\)"
)
ALLOWED_STATUSES = {"DRAFT", "PUBLISHED"}
BLOG_VERSION_FIELDS = (
    "title",
    "excerpt",
    "content",
    "coverImage",
    "tags",
    "author",
    "series",
    "seriesPart",
)
ALLOWED_EVENTS = {"view", "engagement", "complete", "like", "unlike", "share"}
TERM_SUMMARY_PROMPT_VERSION = "v1"
TERM_SUMMARY_SEED_FILE = BLOG_SEED_DIR / "raspberry-pi-5-personal-cloud-terms.json"
BLOG_VERSION_SEEDS = {
    "raspberry-pi-5-personal-cloud": (
        {
            "key": "raspberry-pi-5-personal-cloud-v2",
            "name": "Engineering edit",
            "path": BLOG_SEED_DIR / "raspberry-pi-5-personal-cloud-v2.md",
        },
    ),
}
logger = logging.getLogger(__name__)


def db():
    primary = primary_db()
    if not BLOG_DB_NAME or BLOG_DB_NAME == primary.name:
        return primary
    return primary.client[BLOG_DB_NAME]


def col(name: str):
    if name in BLOG_COLLECTIONS:
        return db()[name]
    return primary_col(name)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    # MongoDB stores UTC but PyMongo returns naive datetimes unless the client
    # is configured as timezone-aware. Mark those values as UTC before
    # serializing so browsers do not mistake them for local wall-clock time.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:100]


def normalize_tags(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    tags: List[str] = []
    for item in value:
        tag = str(item).strip()
        if tag and tag.lower() not in {entry.lower() for entry in tags}:
            tags.append(tag[:40])
    return tags[:12]


def public_blog(document: Dict[str, Any], include_content: bool = False) -> Dict[str, Any]:
    item = jsonable(document)
    item["readingMinutes"] = max(1, (len(str(item.get("content") or "").split()) + 219) // 220)
    item["likeCount"] = max(0, int(item.get("likeCount") or 0))
    item["shareCount"] = max(0, int(item.get("shareCount") or 0))
    item.pop("_id", None)
    item.pop("authorEmail", None)
    item.pop("publishedVersionId", None)
    if not include_content:
        item.pop("content", None)
    return item


def ensure_blog_indexes_and_seed() -> None:
    blogs = col(BLOGS_COLLECTION)
    events = col(BLOG_EVENTS_COLLECTION)
    reactions = col(BLOG_REACTIONS_COLLECTION)
    comments = col(BLOG_COMMENTS_COLLECTION)
    term_summaries = col(BLOG_TERM_SUMMARIES_COLLECTION)
    versions = col(BLOG_VERSIONS_COLLECTION)
    blogs.create_index([("slug", ASCENDING)], unique=True)
    blogs.create_index([("status", ASCENDING), ("publishedAt", DESCENDING)])
    events.create_index([("slug", ASCENDING), ("createdAt", DESCENDING)])
    events.create_index([("visitorHash", ASCENDING), ("createdAt", DESCENDING)])
    reactions.create_index([("slug", ASCENDING), ("visitorHash", ASCENDING)], unique=True)
    comments.create_index([("slug", ASCENDING), ("createdAt", DESCENDING)])
    term_summaries.create_index([("slug", ASCENDING), ("termId", ASCENDING)], unique=True)
    versions.create_index([("slug", ASCENDING), ("versionId", ASCENDING)], unique=True)
    versions.create_index([("slug", ASCENDING), ("versionNumber", DESCENDING)])
    versions.create_index(
        [("slug", ASCENDING), ("seedKey", ASCENDING)],
        unique=True,
        partialFilterExpression={"seedKey": {"$type": "string"}},
    )

    article_path = BLOG_SEED_DIR / "raspberry-pi-5-personal-cloud.md"
    if not article_path.is_file():
        return
    slug = "raspberry-pi-5-personal-cloud"
    article_content = article_path.read_text(encoding="utf-8")
    excerpt = (
        "One YouTube video, a Raspberry Pi 5 and a 1 TB SSD turned a "
        "shared-folder experiment into 48 containers—and an AI agent that can build tools on demand."
    )
    existing = blogs.find_one({"slug": slug})
    if existing:
        changes: Dict[str, Any] = {}
        # The Markdown file bootstraps the first published version. Once an
        # article is version-managed, publishing from Blog Studio becomes the
        # source of truth and a container restart must not overwrite it.
        if not existing.get("publishedVersionId"):
            if existing.get("content") != article_content:
                changes["content"] = article_content
            if existing.get("excerpt") != excerpt:
                changes["excerpt"] = excerpt
        if changes:
            changes["updatedAt"] = utc_now()
            blogs.update_one({"slug": slug}, {"$set": changes})
    else:
        published_at = utc_now()
        blogs.insert_one(
            {
                "slug": slug,
                "title": "I Gave a Raspberry Pi 5 a 1 TB SSD. It Became My Personal Cloud",
                "series": "One Pi, One SSD, 48 Containers",
                "seriesPart": 1,
                "excerpt": excerpt,
                "content": article_content,
                "coverImage": "/blogs/raspberry-pi-5-personal-cloud/pi5-home-homelab-cover.png",
                "tags": ["Homelab", "Raspberry Pi", "Self-hosting", "Docker"],
                "author": "Anikesh Thakur",
                "authorEmail": "",
                "status": "PUBLISHED",
                "viewCount": 0,
                "likeCount": 0,
                "shareCount": 0,
                "createdAt": published_at,
                "updatedAt": published_at,
                "publishedAt": published_at,
            }
        )
    current = blogs.find_one({"slug": slug})
    if current:
        ensure_blog_version_baseline(current)
        ensure_seeded_blog_versions(current)
    seed_blog_term_summaries(slug)


def list_public_blogs() -> List[Dict[str, Any]]:
    documents = col(BLOGS_COLLECTION).find({"status": "PUBLISHED"}).sort(
        "publishedAt", DESCENDING
    )
    return [public_blog(document) for document in documents]


def get_public_blog(slug: str) -> Dict[str, Any]:
    document = col(BLOGS_COLLECTION).find_one(
        {"slug": slug, "status": "PUBLISHED"}
    )
    if not document:
        raise HTTPException(status_code=404, detail="Blog post not found")
    return public_blog(document, include_content=True)


def _term_annotation(content: str, term_id: str) -> Optional[re.Match[str]]:
    for match in TERM_PATTERN.finditer(content):
        if match.group("term_id") == term_id:
            return match
    return None


def _plain_markdown(value: str) -> str:
    value = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"[`*_>#|]", " ", value)
    value = re.sub(r"^\s*[-+\d.]+\s+", "", value, flags=re.MULTILINE)
    return re.sub(r"\s+", " ", value).strip()


def _term_context(content: str, annotation: re.Match[str]) -> str:
    for block in re.split(r"\n\s*\n", content):
        if annotation.group(0) in block:
            return _plain_markdown(block)[:1800]
    start = max(0, annotation.start() - 700)
    end = min(len(content), annotation.end() + 700)
    return _plain_markdown(content[start:end])[:1800]


def seed_blog_term_summaries(slug: str) -> Dict[str, Any]:
    post = col(BLOGS_COLLECTION).find_one({"slug": slug, "status": "PUBLISHED"})
    if not post:
        raise HTTPException(status_code=404, detail="Blog post not found")
    if not TERM_SUMMARY_SEED_FILE.is_file():
        raise HTTPException(status_code=503, detail="Term explanation seed is missing")

    try:
        seed = json.loads(TERM_SUMMARY_SEED_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Could not read term explanation seed: %s", exc)
        raise HTTPException(status_code=503, detail="Term explanation seed is invalid") from exc

    seeded_terms = seed.get("terms") if isinstance(seed, dict) else None
    if not isinstance(seeded_terms, dict):
        raise HTTPException(status_code=503, detail="Term explanation seed is invalid")

    content = str(post.get("content") or "")
    annotations = {
        match.group("term_id"): match
        for match in TERM_PATTERN.finditer(content)
    }
    summaries = col(BLOG_TERM_SUMMARIES_COLLECTION)
    now = utc_now()
    upserted = 0
    for term_id, annotation in annotations.items():
        summary = str(seeded_terms.get(term_id) or "").strip()
        if not summary:
            continue
        term = _plain_markdown(annotation.group("label"))
        context = _term_context(content, annotation)
        context_hash = hashlib.sha256(
            f"{TERM_SUMMARY_PROMPT_VERSION}|{post.get('title', '')}|{term}|{context}".encode("utf-8")
        ).hexdigest()
        summaries.update_one(
            {"slug": slug, "termId": term_id},
            {
                "$set": {
                    "term": term,
                    "summary": re.sub(r"\s+", " ", summary)[:900],
                    "contextHash": context_hash,
                    "promptVersion": TERM_SUMMARY_PROMPT_VERSION,
                    "source": "bundled-seed",
                    "updatedAt": now,
                },
                "$setOnInsert": {"createdAt": now},
            },
            upsert=True,
        )
        upserted += 1
    missing = sorted(set(annotations) - set(seeded_terms))
    return {"slug": slug, "annotated": len(annotations), "stored": upserted, "missing": missing}


def get_blog_term_summary(slug: str, body: Dict[str, Any]) -> Dict[str, Any]:
    term_id = str(body.get("termId") or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", term_id):
        raise HTTPException(status_code=400, detail="Invalid term")

    post = col(BLOGS_COLLECTION).find_one({"slug": slug, "status": "PUBLISHED"})
    if not post:
        raise HTTPException(status_code=404, detail="Blog post not found")
    content = str(post.get("content") or "")
    annotation = _term_annotation(content, term_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="Term is not annotated in this article")

    term = _plain_markdown(annotation.group("label"))
    context = _term_context(content, annotation)
    context_hash = hashlib.sha256(
        f"{TERM_SUMMARY_PROMPT_VERSION}|{post.get('title', '')}|{term}|{context}".encode("utf-8")
    ).hexdigest()
    summaries = col(BLOG_TERM_SUMMARIES_COLLECTION)
    cached = summaries.find_one(
        {"slug": slug, "termId": term_id, "contextHash": context_hash}
    )
    if cached:
        return {
            "termId": term_id,
            "term": str(cached.get("term") or term),
            "summary": str(cached.get("summary") or ""),
            "cached": True,
        }

    seed_blog_term_summaries(slug)
    cached = summaries.find_one(
        {"slug": slug, "termId": term_id, "contextHash": context_hash}
    )
    if not cached:
        raise HTTPException(status_code=404, detail="Explanation is not available for this term")
    return {
        "termId": term_id,
        "term": str(cached.get("term") or term),
        "summary": str(cached.get("summary") or ""),
        "cached": True,
    }


def prewarm_blog_term_summaries(slug: str) -> Dict[str, Any]:
    """Backward-compatible entrypoint for seeding every annotated summary."""
    return seed_blog_term_summaries(slug)


def list_admin_blogs() -> List[Dict[str, Any]]:
    documents = col(BLOGS_COLLECTION).find({}).sort("updatedAt", DESCENDING)
    return [public_blog(document, include_content=True) for document in documents]


def blog_version_snapshot(document: Dict[str, Any]) -> Dict[str, Any]:
    return {field: document.get(field) for field in BLOG_VERSION_FIELDS}


def public_blog_version(document: Dict[str, Any], current_version_id: str = "") -> Dict[str, Any]:
    snapshot = document.get("snapshot") if isinstance(document.get("snapshot"), dict) else {}
    item = {
        "versionId": str(document.get("versionId") or ""),
        "slug": str(document.get("slug") or ""),
        "name": str(document.get("name") or "Untitled version"),
        "versionNumber": max(1, int(document.get("versionNumber") or 1)),
        "status": str(document.get("status") or "DRAFT"),
        "isCurrent": str(document.get("versionId") or "") == current_version_id,
        "createdAt": document.get("createdAt"),
        "updatedAt": document.get("updatedAt"),
        "publishedAt": document.get("publishedAt"),
        **{field: snapshot.get(field) for field in BLOG_VERSION_FIELDS},
    }
    item["tags"] = normalize_tags(item.get("tags"))
    item["seriesPart"] = max(0, int(item.get("seriesPart") or 0))
    item["readingMinutes"] = max(1, (len(str(item.get("content") or "").split()) + 219) // 220)
    return jsonable(item)


def ensure_blog_version_baseline(post: Dict[str, Any]) -> Dict[str, Any]:
    slug = str(post.get("slug") or "")
    versions = col(BLOG_VERSIONS_COLLECTION)
    existing = versions.find_one({"slug": slug}, sort=[("versionNumber", DESCENDING)])
    if existing:
        if post.get("status") == "PUBLISHED" and not post.get("publishedVersionId"):
            published = versions.find_one(
                {"slug": slug, "status": "PUBLISHED"},
                sort=[("publishedAt", DESCENDING), ("versionNumber", DESCENDING)],
            )
            if published:
                col(BLOGS_COLLECTION).update_one(
                    {"slug": slug}, {"$set": {"publishedVersionId": published["versionId"]}}
                )
        return existing

    now = utc_now()
    status = "PUBLISHED" if post.get("status") == "PUBLISHED" else "DRAFT"
    version_id = str(uuid.uuid4())
    baseline = {
        "versionId": version_id,
        "slug": slug,
        "name": "Published version 1" if status == "PUBLISHED" else "Initial draft",
        "versionNumber": 1,
        "status": status,
        "snapshot": blog_version_snapshot(post),
        "createdBy": str(post.get("authorEmail") or ""),
        "updatedBy": str(post.get("authorEmail") or ""),
        "createdAt": post.get("createdAt") or now,
        "updatedAt": post.get("updatedAt") or now,
        "publishedAt": post.get("publishedAt") if status == "PUBLISHED" else None,
    }
    versions.insert_one(baseline)
    if status == "PUBLISHED":
        col(BLOGS_COLLECTION).update_one(
            {"slug": slug}, {"$set": {"publishedVersionId": version_id}}
        )
    return baseline


def ensure_seeded_blog_versions(post: Dict[str, Any]) -> None:
    """Register bundled article alternatives once without changing the live post."""
    slug = str(post.get("slug") or "")
    seeds = BLOG_VERSION_SEEDS.get(slug, ())
    if not seeds:
        return

    versions = col(BLOG_VERSIONS_COLLECTION)
    for seed in seeds:
        seed_path = seed["path"]
        if not seed_path.is_file():
            logger.warning("Article version seed is missing: %s", seed_path)
            continue
        try:
            content = seed_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            logger.warning("Could not read article version seed %s: %s", seed_path, exc)
            continue
        if not content:
            logger.warning("Article version seed is empty: %s", seed_path)
            continue

        existing = versions.find_one(
            {
                "slug": slug,
                "$or": [
                    {"seedKey": seed["key"]},
                    {"snapshot.content": content},
                ],
            }
        )
        if existing:
            existing_snapshot = (
                existing.get("snapshot")
                if isinstance(existing.get("snapshot"), dict)
                else {}
            )
            is_untouched_seed = (
                existing.get("seedKey") == seed["key"]
                and existing.get("status") == "DRAFT"
                and existing.get("updatedBy") == "bundled-seed"
            )
            if is_untouched_seed and existing_snapshot.get("content") != content:
                refreshed_snapshot = {**existing_snapshot, "content": content}
                versions.update_one(
                    {"slug": slug, "versionId": existing["versionId"]},
                    {
                        "$set": {
                            "snapshot": refreshed_snapshot,
                            "updatedAt": utc_now(),
                        }
                    },
                )
            continue

        latest = versions.find_one({"slug": slug}, sort=[("versionNumber", DESCENDING)])
        version_number = max(1, int((latest or {}).get("versionNumber") or 0) + 1)
        now = utc_now()
        snapshot = blog_version_snapshot(post)
        snapshot["content"] = content
        document = {
            "versionId": str(uuid.uuid4()),
            "slug": slug,
            "seedKey": seed["key"],
            "name": seed["name"],
            "versionNumber": version_number,
            "status": "DRAFT",
            "snapshot": snapshot,
            "createdBy": "bundled-seed",
            "updatedBy": "bundled-seed",
            "createdAt": now,
            "updatedAt": now,
            "publishedAt": None,
        }
        try:
            versions.insert_one(document)
        except DuplicateKeyError:
            # A second app worker may have inserted the same sparse-unique seed.
            if not versions.find_one({"slug": slug, "seedKey": seed["key"]}):
                raise


def list_blog_versions(slug: str) -> Dict[str, Any]:
    post = col(BLOGS_COLLECTION).find_one({"slug": slug})
    if not post:
        raise HTTPException(status_code=404, detail="Blog post not found")
    ensure_blog_version_baseline(post)
    post = col(BLOGS_COLLECTION).find_one({"slug": slug}) or post
    current_version_id = str(post.get("publishedVersionId") or "")
    versions = col(BLOG_VERSIONS_COLLECTION).find({"slug": slug}).sort("versionNumber", DESCENDING)
    return {
        "currentVersionId": current_version_id or None,
        "items": [public_blog_version(version, current_version_id) for version in versions],
    }


def _version_name(value: Any, fallback: str) -> str:
    name = re.sub(r"\s+", " ", str(value or "")).strip()
    return (name or fallback)[:100]


def _normalized_version_snapshot(
    body: Dict[str, Any],
    *,
    slug: str,
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    current = existing or {}
    supplied_slug = str(body.get("slug") or slug).strip()
    if supplied_slug != slug:
        raise HTTPException(status_code=400, detail="The article slug cannot change inside a version")
    title = str(body.get("title") if "title" in body else current.get("title") or "").strip()
    content = str(body.get("content") if "content" in body else current.get("content") or "").strip()
    if not title or not content:
        raise HTTPException(status_code=400, detail="Title and content are required")
    try:
        series_part = int(body.get("seriesPart") if "seriesPart" in body else current.get("seriesPart") or 0)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Series part must be a number") from exc
    return {
        "title": title[:180],
        "excerpt": str(body.get("excerpt") if "excerpt" in body else current.get("excerpt") or "").strip()[:500],
        "content": content,
        "coverImage": str(body.get("coverImage") if "coverImage" in body else current.get("coverImage") or "").strip()[:500],
        "tags": normalize_tags(body.get("tags", current.get("tags", []))),
        "author": str(body.get("author") if "author" in body else current.get("author") or "Anikesh Thakur").strip()[:120],
        "series": str(body.get("series") if "series" in body else current.get("series") or "").strip()[:120],
        "seriesPart": max(0, series_part),
    }


def create_blog_version(slug: str, body: Dict[str, Any], author_email: str) -> Dict[str, Any]:
    post = col(BLOGS_COLLECTION).find_one({"slug": slug})
    if not post:
        raise HTTPException(status_code=404, detail="Blog post not found")
    ensure_blog_version_baseline(post)
    versions = col(BLOG_VERSIONS_COLLECTION)
    source_version_id = str(body.get("sourceVersionId") or "").strip()
    source = versions.find_one({"slug": slug, "versionId": source_version_id}) if source_version_id else None
    source_snapshot = (
        source.get("snapshot")
        if source and isinstance(source.get("snapshot"), dict)
        else blog_version_snapshot(post)
    )
    latest = versions.find_one({"slug": slug}, sort=[("versionNumber", DESCENDING)])
    version_number = max(1, int((latest or {}).get("versionNumber") or 0) + 1)
    now = utc_now()
    document = {
        "versionId": str(uuid.uuid4()),
        "slug": slug,
        "name": _version_name(body.get("name"), f"Draft {version_number}"),
        "versionNumber": version_number,
        "status": "DRAFT",
        "snapshot": _normalized_version_snapshot(source_snapshot, slug=slug, existing=source_snapshot),
        "createdBy": author_email,
        "updatedBy": author_email,
        "createdAt": now,
        "updatedAt": now,
        "publishedAt": None,
    }
    versions.insert_one(document)
    current_version_id = str(post.get("publishedVersionId") or "")
    return public_blog_version(document, current_version_id)


def update_blog_version(
    slug: str,
    version_id: str,
    body: Dict[str, Any],
    author_email: str,
) -> Dict[str, Any]:
    post = col(BLOGS_COLLECTION).find_one({"slug": slug})
    if not post:
        raise HTTPException(status_code=404, detail="Blog post not found")
    versions = col(BLOG_VERSIONS_COLLECTION)
    version = versions.find_one({"slug": slug, "versionId": version_id})
    if not version:
        raise HTTPException(status_code=404, detail="Article version not found")
    if version.get("status") != "DRAFT":
        raise HTTPException(status_code=409, detail="Published versions are read-only; create a new draft to edit them")
    snapshot = version.get("snapshot") if isinstance(version.get("snapshot"), dict) else {}
    updated = versions.find_one_and_update(
        {"slug": slug, "versionId": version_id, "status": "DRAFT"},
        {
            "$set": {
                "name": _version_name(body.get("name"), str(version.get("name") or "Draft")),
                "snapshot": _normalized_version_snapshot(body, slug=slug, existing=snapshot),
                "updatedBy": author_email,
                "updatedAt": utc_now(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=409, detail="This draft changed while it was being saved")
    return public_blog_version(updated, str(post.get("publishedVersionId") or ""))


def publish_blog_version(slug: str, version_id: str, author_email: str) -> Dict[str, Any]:
    blogs = col(BLOGS_COLLECTION)
    post = blogs.find_one({"slug": slug})
    if not post:
        raise HTTPException(status_code=404, detail="Blog post not found")
    versions = col(BLOG_VERSIONS_COLLECTION)
    version = versions.find_one({"slug": slug, "versionId": version_id})
    if not version:
        raise HTTPException(status_code=404, detail="Article version not found")
    snapshot = version.get("snapshot") if isinstance(version.get("snapshot"), dict) else {}
    snapshot = _normalized_version_snapshot(snapshot, slug=slug, existing=snapshot)
    now = utc_now()
    published_at = post.get("publishedAt") or now
    blog_changes = {
        **snapshot,
        "status": "PUBLISHED",
        "authorEmail": author_email,
        "updatedAt": now,
        "publishedAt": published_at,
        "publishedVersionId": version_id,
    }
    updated_post = blogs.find_one_and_update(
        {"slug": slug}, {"$set": blog_changes}, return_document=ReturnDocument.AFTER
    )
    updated_version = versions.find_one_and_update(
        {"slug": slug, "versionId": version_id},
        {
            "$set": {
                "status": "PUBLISHED",
                "snapshot": snapshot,
                "updatedBy": author_email,
                "updatedAt": now,
                "publishedAt": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    try:
        seed_blog_term_summaries(slug)
    except HTTPException as exc:
        logger.warning("Article %s published but term summaries could not be refreshed: %s", slug, exc.detail)
    return {
        "post": public_blog(updated_post or {**post, **blog_changes}, include_content=True),
        "version": public_blog_version(updated_version or version, version_id),
    }


def normalize_blog_payload(
    body: Dict[str, Any],
    *,
    author_email: str,
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    title = str(body.get("title") or (existing or {}).get("title") or "").strip()
    content = str(body.get("content") or (existing or {}).get("content") or "").strip()
    slug = slugify(str(body.get("slug") or (existing or {}).get("slug") or title))
    if not title or not content:
        raise HTTPException(status_code=400, detail="Title and content are required")
    if not slug or not SLUG_PATTERN.fullmatch(slug):
        raise HTTPException(status_code=400, detail="Use a valid lowercase blog slug")

    status = str(body.get("status") or (existing or {}).get("status") or "DRAFT").upper()
    if status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid blog status")

    now = utc_now()
    published_at = (existing or {}).get("publishedAt")
    if status == "PUBLISHED" and not published_at:
        published_at = now
    return {
        "slug": slug,
        "title": title[:180],
        "series": str(body.get("series") or (existing or {}).get("series") or "").strip()[:120],
        "seriesPart": int(body.get("seriesPart") or (existing or {}).get("seriesPart") or 0),
        "excerpt": str(body.get("excerpt") or (existing or {}).get("excerpt") or "").strip()[:500],
        "content": content,
        "coverImage": str(body.get("coverImage") or (existing or {}).get("coverImage") or "").strip()[:500],
        "tags": normalize_tags(body.get("tags", (existing or {}).get("tags", []))),
        "author": str(body.get("author") or (existing or {}).get("author") or "Anikesh Thakur").strip()[:120],
        "authorEmail": author_email,
        "status": status,
        "viewCount": int((existing or {}).get("viewCount") or 0),
        "likeCount": max(0, int((existing or {}).get("likeCount") or 0)),
        "shareCount": max(0, int((existing or {}).get("shareCount") or 0)),
        "createdAt": (existing or {}).get("createdAt") or now,
        "updatedAt": now,
        "publishedAt": published_at,
        "publishedVersionId": (existing or {}).get("publishedVersionId"),
    }


def create_blog(body: Dict[str, Any], author_email: str) -> Dict[str, Any]:
    document = normalize_blog_payload(body, author_email=author_email)
    if col(BLOGS_COLLECTION).find_one({"slug": document["slug"]}):
        raise HTTPException(status_code=409, detail="A blog with this slug already exists")
    col(BLOGS_COLLECTION).insert_one(document)
    ensure_blog_version_baseline(document)
    return public_blog(document, include_content=True)


def update_blog(slug: str, body: Dict[str, Any], author_email: str) -> Dict[str, Any]:
    existing = col(BLOGS_COLLECTION).find_one({"slug": slug})
    if not existing:
        raise HTTPException(status_code=404, detail="Blog post not found")
    document = normalize_blog_payload(body, author_email=author_email, existing=existing)
    if document["slug"] != slug and col(BLOGS_COLLECTION).find_one({"slug": document["slug"]}):
        raise HTTPException(status_code=409, detail="A blog with this slug already exists")
    updated = col(BLOGS_COLLECTION).find_one_and_replace(
        {"slug": slug}, document, return_document=ReturnDocument.AFTER
    )
    ensure_blog_version_baseline(updated or document)
    return public_blog(updated or document, include_content=True)


def visitor_hash(visitor_id: str, request: Request) -> str:
    supplied = visitor_id.strip()[:160]
    fallback = f"{request.client.host if request.client else ''}|{request.headers.get('user-agent', '')}"
    salt = os.getenv("BLOG_ANALYTICS_SALT") or config.JWT_SECRET or "toolhub-blog"
    return hashlib.sha256(f"{salt}|{supplied or fallback}".encode("utf-8")).hexdigest()


def device_type(user_agent: str) -> str:
    lowered = user_agent.lower()
    if "ipad" in lowered or "tablet" in lowered:
        return "tablet"
    if any(value in lowered for value in ("mobile", "iphone", "android")):
        return "mobile"
    return "desktop"


def record_blog_event(slug: str, body: Dict[str, Any], request: Request) -> Dict[str, Any]:
    if not col(BLOGS_COLLECTION).find_one({"slug": slug, "status": "PUBLISHED"}):
        raise HTTPException(status_code=404, detail="Blog post not found")
    event_type = str(body.get("eventType") or "view").lower()
    if event_type not in ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail="Invalid analytics event")
    user_agent = request.headers.get("user-agent", "")[:500]
    referrer = str(body.get("referrer") or request.headers.get("referer") or "")[:500]
    seconds = max(0, min(int(body.get("seconds") or 0), 3600))
    event = {
        "slug": slug,
        "eventType": event_type,
        "visitorHash": visitor_hash(str(body.get("visitorId") or ""), request),
        "sessionId": hashlib.sha256(str(body.get("sessionId") or "").encode("utf-8")).hexdigest()[:24],
        "referrer": referrer,
        "device": device_type(user_agent),
        "userAgent": user_agent,
        "screenWidth": max(0, min(int(body.get("screenWidth") or 0), 10000)),
        "seconds": seconds,
        "channel": str(body.get("channel") or "").strip().lower()[:40],
        "createdAt": utc_now(),
    }
    col(BLOG_EVENTS_COLLECTION).insert_one(event)
    updated = None
    if event_type == "view":
        updated = col(BLOGS_COLLECTION).find_one_and_update(
            {"slug": slug}, {"$inc": {"viewCount": 1}}, return_document=ReturnDocument.AFTER
        )
    elif event_type == "share":
        updated = col(BLOGS_COLLECTION).find_one_and_update(
            {"slug": slug}, {"$inc": {"shareCount": 1}}, return_document=ReturnDocument.AFTER
        )
    return {
        "recorded": True,
        "viewCount": max(0, int((updated or {}).get("viewCount") or 0)),
        "shareCount": max(0, int((updated or {}).get("shareCount") or 0)),
    }


def blog_reaction(slug: str, body: Dict[str, Any], request: Request) -> Dict[str, Any]:
    post = col(BLOGS_COLLECTION).find_one({"slug": slug, "status": "PUBLISHED"})
    if not post:
        raise HTTPException(status_code=404, detail="Blog post not found")

    action = str(body.get("action") or "status").strip().lower()
    if action not in {"status", "like", "unlike"}:
        raise HTTPException(status_code=400, detail="Invalid reaction action")

    hashed_visitor = visitor_hash(str(body.get("visitorId") or ""), request)
    reaction_query = {"slug": slug, "visitorHash": hashed_visitor}
    reactions = col(BLOG_REACTIONS_COLLECTION)
    changed = False

    if action == "like":
        result = reactions.update_one(
            reaction_query,
            {"$setOnInsert": {**reaction_query, "createdAt": utc_now()}},
            upsert=True,
        )
        changed = result.upserted_id is not None
        if changed:
            post = col(BLOGS_COLLECTION).find_one_and_update(
                {"slug": slug}, {"$inc": {"likeCount": 1}}, return_document=ReturnDocument.AFTER
            ) or post
            record_blog_event(slug, {**body, "eventType": "like"}, request)
    elif action == "unlike":
        changed = reactions.delete_one(reaction_query).deleted_count > 0
        if changed:
            updated = col(BLOGS_COLLECTION).find_one_and_update(
                {"slug": slug, "likeCount": {"$gt": 0}},
                {"$inc": {"likeCount": -1}},
                return_document=ReturnDocument.AFTER,
            )
            post = updated or col(BLOGS_COLLECTION).find_one({"slug": slug}) or post
            record_blog_event(slug, {**body, "eventType": "unlike"}, request)

    liked = reactions.find_one(reaction_query) is not None
    return {
        "liked": liked,
        "changed": changed,
        "likeCount": max(0, int(post.get("likeCount") or 0)),
        "shareCount": max(0, int(post.get("shareCount") or 0)),
    }


def public_comment(
    document: Dict[str, Any],
    viewer: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    viewer = viewer or {}
    user_id = str(viewer.get("userId") or "")
    is_owner = bool(user_id and user_id == str(document.get("userId") or ""))
    is_admin = str(viewer.get("role") or "").upper() == "ADMIN"
    created_at = document.get("createdAt")
    return {
        "commentId": str(document.get("commentId") or ""),
        "slug": str(document.get("slug") or ""),
        "content": str(document.get("content") or ""),
        "authorName": str(document.get("authorName") or "ToolHub reader"),
        "authorProfilePicture": str(document.get("authorProfilePicture") or ""),
        "createdAt": iso(created_at) if isinstance(created_at, datetime) else jsonable(created_at),
        "canDelete": is_owner or is_admin,
    }


def list_blog_comments(
    slug: str,
    viewer: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    if not col(BLOGS_COLLECTION).find_one({"slug": slug, "status": "PUBLISHED"}):
        raise HTTPException(status_code=404, detail="Blog post not found")
    comments = col(BLOG_COMMENTS_COLLECTION).find({"slug": slug}).sort("createdAt", ASCENDING)
    return [public_comment(comment, viewer) for comment in comments]


def create_blog_comment(slug: str, body: Dict[str, Any], user: Dict[str, str]) -> Dict[str, Any]:
    if not col(BLOGS_COLLECTION).find_one({"slug": slug, "status": "PUBLISHED"}):
        raise HTTPException(status_code=404, detail="Blog post not found")
    content = str(body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    if len(content) > 1200:
        raise HTTPException(status_code=400, detail="Comments are limited to 1,200 characters")

    db_user = col("users").find_one({"userId": user.get("userId")}) or {}
    email = str(db_user.get("email") or user.get("email") or "")
    author_name = str(db_user.get("name") or db_user.get("userName") or email.split("@")[0] or "ToolHub reader")
    document = {
        "commentId": str(uuid.uuid4()),
        "slug": slug,
        "content": content,
        "userId": str(user.get("userId") or ""),
        "authorName": author_name[:100],
        "authorProfilePicture": str(db_user.get("profilePicture") or "")[:1000],
        "createdAt": utc_now(),
    }
    col(BLOG_COMMENTS_COLLECTION).insert_one(document)
    return public_comment(document, user)


def delete_blog_comment(slug: str, comment_id: str, user: Dict[str, str]) -> Dict[str, Any]:
    comments = col(BLOG_COMMENTS_COLLECTION)
    comment = comments.find_one({"slug": slug, "commentId": comment_id})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    user_id = str(user.get("userId") or "")
    is_owner = bool(user_id and user_id == str(comment.get("userId") or ""))
    is_admin = str(user.get("role") or "").upper() == "ADMIN"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="You can only delete your own comments")

    deleted = comments.delete_one({"slug": slug, "commentId": comment_id})
    if deleted.deleted_count != 1:
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"deleted": True, "commentId": comment_id}


def referrer_label(value: str) -> str:
    if not value:
        return "Direct"
    parsed = urlparse(value)
    return parsed.netloc or "Direct"


def blog_metrics(days: int = 30, slug: Optional[str] = None) -> Dict[str, Any]:
    days = max(1, min(days, 90))
    now = utc_now()
    start = now - timedelta(days=days - 1)
    query: Dict[str, Any] = {"createdAt": {"$gte": start}}
    if slug:
        query["slug"] = slug
    events = list(col(BLOG_EVENTS_COLLECTION).find(query).sort("createdAt", ASCENDING))
    posts = list(col(BLOGS_COLLECTION).find({}))

    views = [event for event in events if event.get("eventType") == "view"]
    engagement = [event for event in events if event.get("eventType") == "engagement"]
    completes = [event for event in events if event.get("eventType") == "complete"]
    likes = [event for event in events if event.get("eventType") == "like"]
    shares = [event for event in events if event.get("eventType") == "share"]
    comment_query: Dict[str, Any] = {"createdAt": {"$gte": start}}
    if slug:
        comment_query["slug"] = slug
    comments = list(col(BLOG_COMMENTS_COLLECTION).find(comment_query))
    unique_viewers = {event.get("visitorHash") for event in views if event.get("visitorHash")}
    unique_completes = {event.get("visitorHash") for event in completes if event.get("visitorHash")}

    def daily_count(event_list: List[Dict[str, Any]]) -> Counter:
        return Counter(
            event.get("createdAt").astimezone(timezone.utc).date().isoformat()
            for event in event_list
            if isinstance(event.get("createdAt"), datetime)
        )

    daily_views = daily_count(views)
    daily_likes = daily_count(likes)
    daily_shares = daily_count(shares)
    daily_comments = daily_count(comments)
    daily = []
    for offset in range(days):
        date = (start + timedelta(days=offset)).date().isoformat()
        daily.append(
            {
                "date": date,
                "views": daily_views[date],
                "likes": daily_likes[date],
                "shares": daily_shares[date],
                "comments": daily_comments[date],
            }
        )

    views_by_slug = Counter(str(event.get("slug") or "") for event in views)
    uniques_by_slug: Dict[str, set[str]] = defaultdict(set)
    for event in views:
        uniques_by_slug[str(event.get("slug") or "")].add(str(event.get("visitorHash") or ""))
    titles = {str(post.get("slug")): str(post.get("title")) for post in posts}
    post_likes = {str(post.get("slug")): max(0, int(post.get("likeCount") or 0)) for post in posts}
    shares_by_slug = Counter(str(event.get("slug") or "") for event in shares)
    comments_by_slug = Counter(str(comment.get("slug") or "") for comment in comments)
    top_posts = [
        {
            "slug": post_slug,
            "title": titles.get(post_slug, post_slug),
            "views": count,
            "uniqueVisitors": len(uniques_by_slug[post_slug]),
            "likes": post_likes.get(post_slug, 0),
            "shares": shares_by_slug.get(post_slug, 0),
            "comments": comments_by_slug.get(post_slug, 0),
        }
        for post_slug, count in views_by_slug.most_common()
    ]

    average_seconds = (
        sum(int(event.get("seconds") or 0) for event in engagement) / len(engagement)
        if engagement
        else 0
    )
    return {
        "rangeDays": days,
        "totalViews": len(views),
        "uniqueVisitors": len(unique_viewers),
        "viewsToday": daily[-1]["views"] if daily else 0,
        "totalLikes": col(BLOG_REACTIONS_COLLECTION).count_documents(
            {"slug": slug} if slug else {}
        ),
        "likesInRange": len(likes),
        "totalShares": len(shares),
        "totalComments": len(comments),
        "averageEngagedSeconds": round(average_seconds, 1),
        "completionRate": round((len(unique_completes) / len(unique_viewers) * 100), 1)
        if unique_viewers
        else 0,
        "daily": daily,
        "topPosts": top_posts,
        "referrers": [
            {"label": label, "views": count}
            for label, count in Counter(referrer_label(str(event.get("referrer") or "")) for event in views).most_common(8)
        ],
        "devices": [
            {"label": label, "views": count}
            for label, count in Counter(str(event.get("device") or "unknown") for event in views).most_common()
        ],
        "shareChannels": [
            {"label": label or "unknown", "shares": count}
            for label, count in Counter(str(event.get("channel") or "unknown") for event in shares).most_common()
        ],
    }


def save_blog_asset(data: bytes, filename: str, content_type: str) -> Dict[str, Any]:
    if not data or len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Images must be between 1 byte and 8 MB")
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported")
    clean_filename = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip("-") or "blog-image"
    file_id = gridfs.GridFS(db(), collection="blogassets").put(
        data,
        filename=clean_filename[:180],
        contentType=content_type[:120],
        uploadedAt=utc_now(),
    )
    return {
        "assetId": str(file_id),
        "url": f"/api/v2/blog-assets/{file_id}",
        "markdown": f"![{clean_filename}](/api/v2/blog-assets/{file_id})",
    }


def load_blog_asset(asset_id: str):
    try:
        return gridfs.GridFS(db(), collection="blogassets").get(ObjectId(asset_id))
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Blog image not found") from exc
