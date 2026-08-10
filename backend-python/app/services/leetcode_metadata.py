"""Fetch canonical problem metadata (title, difficulty, topics) from LeetCode's
public GraphQL API. Mirrors the query the old Java FetchLeetCodeMetaData service
used, ported to Python for the current FastAPI backend.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import requests

GRAPHQL_URL = "https://leetcode.com/graphql"

_QUERY = """
query getQuestionDetail($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    title
    difficulty
    acRate
    topicTags { name }
  }
}
"""

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def extract_slug(value: str) -> Optional[str]:
    """Pull a LeetCode problem slug out of a full URL or accept a bare slug."""
    if not value:
        return None
    candidate = value.strip()
    if "://" in candidate or candidate.startswith("leetcode.com"):
        path = urlsplit(candidate if "://" in candidate else f"//{candidate}").path
        parts = [part for part in path.split("/") if part]
        if "problems" in parts:
            idx = parts.index("problems")
            if idx + 1 < len(parts):
                candidate = parts[idx + 1]
            else:
                return None
        elif parts:
            candidate = parts[-1]
        else:
            return None
    candidate = candidate.strip().lower()
    return candidate if _SLUG_RE.match(candidate) else None


def fetch_question_metadata(url_or_slug: str, timeout: int = 8) -> Optional[Dict[str, Any]]:
    """Resolve a URL/slug against LeetCode. Returns None if it can't be resolved."""
    slug = extract_slug(url_or_slug)
    if not slug:
        return None
    try:
        response = requests.post(
            GRAPHQL_URL,
            json={"query": _QUERY, "variables": {"titleSlug": slug}},
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (compatible; ToolHubBot/1.0)",
                "Referer": f"https://leetcode.com/problems/{slug}/",
            },
            timeout=timeout,
        )
        response.raise_for_status()
        question = (response.json().get("data") or {}).get("question")
    except (requests.RequestException, ValueError):
        return None
    if not question or not question.get("title"):
        return None
    tags = [tag["name"] for tag in (question.get("topicTags") or []) if tag.get("name")]
    return {
        "slug": slug,
        "title": question.get("title"),
        "difficulty": question.get("difficulty") or "",
        "tags": tags,
        "acRate": question.get("acRate"),
        "url": f"https://leetcode.com/problems/{slug}/",
    }
