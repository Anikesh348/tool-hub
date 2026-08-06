import hashlib
import logging
import os
import re
from html import escape
from typing import Any, Dict, Iterable, List
from urllib.parse import quote

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from app.services.mail import send_brevo_email
from app.services.mongo import col
from app.services.notifications import create_notification
from app.utils.responses import now_iso


logger = logging.getLogger(__name__)
BLOG_ANNOUNCEMENTS_COLLECTION = "blogpublicationannouncements"
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def ensure_blog_announcement_indexes() -> None:
    collection = col(BLOG_ANNOUNCEMENTS_COLLECTION)
    collection.create_index([("publishKey", ASCENDING)], unique=True)
    collection.create_index([("createdAt", ASCENDING)])


def _site_url() -> str:
    return (os.getenv("TOOLHUB_PUBLIC_URL") or "https://hostingfrompurva.xyz").strip().rstrip("/")


def _recipient_emails() -> List[str]:
    recipients = set()
    users: Iterable[Dict[str, Any]] = col("users").find(
        {"email": {"$type": "string", "$ne": ""}},
        {"email": 1},
    )
    for user in users:
        email = str(user.get("email") or "").strip().lower()
        if EMAIL_PATTERN.fullmatch(email):
            recipients.add(email)
    return sorted(recipients)


def _email_html(post: Dict[str, Any], article_url: str) -> str:
    title = escape(str(post.get("title") or "New ToolHub article"))
    excerpt = escape(str(post.get("excerpt") or "A new article is now available on ToolHub."))
    author = escape(str(post.get("author") or "ToolHub"))
    safe_url = escape(article_url, quote=True)
    return f"""
    <div style="margin:0;background:#070b14;padding:32px 16px;font-family:Arial,sans-serif;color:#e5e7eb">
      <div style="max-width:620px;margin:0 auto;background:#111827;border:1px solid #263248;border-radius:16px;overflow:hidden">
        <div style="padding:30px">
          <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a78bfa;font-weight:700">New on ToolHub</div>
          <h1 style="margin:12px 0 10px;font-size:28px;line-height:1.25;color:#ffffff">{title}</h1>
          <p style="margin:0 0 8px;color:#94a3b8;font-size:14px">By {author}</p>
          <p style="margin:20px 0;color:#cbd5e1;font-size:16px;line-height:1.65">{excerpt}</p>
          <a href="{safe_url}" style="display:inline-block;margin-top:8px;padding:12px 20px;border-radius:10px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700">Read the article</a>
        </div>
        <div style="padding:16px 30px;border-top:1px solid #263248;color:#64748b;font-size:12px">You received this because you have a registered ToolHub account.</div>
      </div>
    </div>
    """


def announce_blog_publication(
    post: Dict[str, Any],
    version_id: str,
    published_by: str = "",
) -> None:
    """Create one ToolHub alert and email each user once for a published version."""
    slug = str(post.get("slug") or "").strip()
    title = str(post.get("title") or "New ToolHub article").strip()
    if not slug or not version_id:
        logger.error("Blog announcement skipped because its publication identity is incomplete")
        return

    publish_key = f"{slug}:{version_id}"
    now = now_iso()
    announcement = {
        "publishKey": publish_key,
        "slug": slug,
        "versionId": version_id,
        "title": title,
        "status": "PROCESSING",
        "notificationId": None,
        "recipientCount": 0,
        "emailSentCount": 0,
        "emailFailureCount": 0,
        "publishedBy": published_by,
        "createdAt": now,
        "updatedAt": now,
    }
    try:
        col(BLOG_ANNOUNCEMENTS_COLLECTION).insert_one(announcement)
    except DuplicateKeyError:
        logger.info("Blog publication announcement already delivered for %s", publish_key)
        return

    article_path = f"/blogs/{quote(slug, safe='')}"
    article_url = f"{_site_url()}{article_path}"
    failures = 0
    sent = 0
    notification_id = None
    try:
        notification = create_notification(
            audience="USER",
            title="New blog published",
            message=f"{title} is now available on ToolHub.",
            severity="INFO",
            category="blog",
            source="blog",
            action_url=article_path,
            metadata={"slug": slug, "versionId": version_id},
            created_by=published_by or None,
        )
        notification_id = notification.get("notificationId")
    except Exception:
        failures += 1
        logger.exception("Unable to create ToolHub notification for blog publication %s", publish_key)

    recipients = _recipient_emails()
    html_body = _email_html(post, article_url)
    for recipient in recipients:
        try:
            # Send one message per recipient so registered users are never exposed to one another.
            send_brevo_email(f"New on ToolHub: {title}", recipient, html_body)
            sent += 1
        except Exception:
            failures += 1
            logger.exception("Unable to send one blog publication email for %s", publish_key)

    status = "COMPLETED" if failures == 0 else "PARTIAL"
    col(BLOG_ANNOUNCEMENTS_COLLECTION).update_one(
        {"publishKey": publish_key},
        {
            "$set": {
                "status": status,
                "notificationId": notification_id,
                "recipientCount": len(recipients),
                "emailSentCount": sent,
                "emailFailureCount": max(0, failures - (0 if notification_id else 1)),
                "notificationCreated": bool(notification_id),
                "updatedAt": now_iso(),
                "completedAt": now_iso(),
            }
        },
    )
    logger.info(
        "Blog publication announcement %s: status=%s recipients=%d sent=%d failures=%d",
        publish_key,
        status,
        len(recipients),
        sent,
        failures,
    )
