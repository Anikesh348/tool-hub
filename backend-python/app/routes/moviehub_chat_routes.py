import json
import os
import re
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import bcrypt
import jwt
import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import MEDIA_REQUESTS_COLLECTION, moviehub_conversations
from app.middlewares.auth import admin_user, current_user
from app.services.mongo import find
from app.services.moviehub_automation import *
from app.utils.http import base_url
from app.utils.responses import error, success

router = APIRouter()

def chat_success(payload: Dict[str, Any]) -> Dict[str, Any]:
    return success({key: value for key, value in payload.items() if value is not None})


def new_chat_context(conversation_id: str) -> Dict[str, Any]:
    return {
        "conversationId": conversation_id,
        "intent": "UNKNOWN",
        "completed": False,
        "awaitingSelection": False,
        "selectionOptions": [],
        "mediaState": {"title": "", "quality": "", "mediaType": "UNKNOWN", "season": []},
    }


def reset_chat_context(context: Dict[str, Any]) -> None:
    context["intent"] = "UNKNOWN"
    context["completed"] = False
    context["awaitingSelection"] = False
    context["selectionOptions"] = []
    context["mediaState"] = {"title": "", "quality": "", "mediaType": "UNKNOWN", "season": []}


def resolve_chat_intent(text: str) -> str:
    checks = [
        ("CHECK_DOWNLOAD_STATUS", r"(?i)\b(status|progress|time left|eta|how much time)\b"),
        ("LIST_DOWNLOADS", r"(?i)\b(what.*downloading|list downloads|show downloads)\b"),
        ("DELETE_MEDIA", r"(?i)\b(delete|remove|uninstall|erase)\b.+\b(movie|movies|show|series|tv|media|library)\b"),
        ("CHECK_MEDIA_EXISTS", r"(?i)(\bdoes\b.+\bexist\b|\b(is|check|find|search|lookup|look\s*up)\b.+\b(movie|movies|show|series|tv)\b)"),
        ("RAISE_REQUEST", r"(?i)\b(request|raise request|submit request|ask admin)\b"),
        ("DOWNLOAD_MEDIA", r"(?i)\b(download|add|get|grab)\b"),
    ]
    for intent, pattern in checks:
        if re.search(pattern, text or ""):
            return intent
    return "UNKNOWN"


def openai_json(prompt: str) -> Optional[Dict[str, Any]]:
    url = os.getenv("OPEN_AI_URL") or "https://api.openai.com/v1/chat/completions"
    key = os.getenv("OPEN_AI_API_KEY") or ""
    if not key:
        return None
    try:
        res = requests.post(
            url,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": "gpt-4o-mini",
                "temperature": 0,
                "max_tokens": 200,
                "messages": [
                    {"role": "system", "content": "You are a backend service. Respond with ONLY valid JSON."},
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=45,
        )
        if res.status_code < 200 or res.status_code >= 300:
            return None
        content = res.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        return json.loads(content)
    except Exception:
        return None


def infer_media_type(text: str) -> str:
    lowered = (text or "").lower()
    if re.search(r"\b(show|shows|series|tv)\b", lowered):
        return "SHOWS"
    if re.search(r"\b(movie|movies|film)\b", lowered):
        return "MOVIES"
    return "UNKNOWN"


def infer_quality(text: str) -> str:
    lowered = (text or "").lower()
    if re.search(r"\b(4k|2160p|uhd|ultra[- ]?hd)\b", lowered):
        return "4K"
    if re.search(r"\b(1080p|1080|hd)\b", lowered):
        return "1080p"
    if re.search(r"\b(720p|720)\b", lowered):
        return "720p"
    return ""


def infer_seasons(text: str) -> List[int]:
    seasons: List[int] = []
    for match in re.finditer(r"(?i)\b(?:season|s)\s*(\d{1,2})\b", text or ""):
        seasons.append(int(match.group(1)))
    if not seasons and re.fullmatch(r"\s*\d{1,2}\s*", text or ""):
        seasons.append(int(str(text).strip()))
    return sorted_unique_positive_numbers(seasons)


def cleanup_extracted_title(text: str) -> str:
    title = re.sub(r"(?i)\b(download|downloads|downloading|add|get|grab|request|raise|submit|ask admin|check|find|search|lookup|look up|delete|remove|exists?|status|progress|eta|time left|server|library|movie|movies|show|shows|series|tv|in|on|from|the|a|an|my|all|what|are|is|please|if|whether|of)\b", " ", text or "")
    title = re.sub(r"(?i)\b(720p|1080p|1080|720|4k|2160p|uhd|hd|season|s)\s*\d*\b", " ", title)
    title = re.sub(r"[^a-zA-Z0-9:'&. -]+", " ", title)
    title = re.sub(r"\s+", " ", title).strip(" -")
    return title


def parse_add_media_input(context: Dict[str, Any], user_input: str) -> Dict[str, Any]:
    state = dict(context.get("mediaState") or {})
    prompt = (
        "Extract updated media request state from the user input and current state. "
        "Return JSON: {\"payload\":{\"mediaType\":\"MOVIES|SHOWS\",\"title\":string,"
        "\"season\":number[],\"quality\":\"720p|1080p|4K\"},\"clarification\":string}. "
        "Ask only for the next missing field in clarification. "
        f"Current state: {json.dumps(state)}. User input: {user_input}"
    )
    parsed = openai_json(prompt) or {}
    payload = parsed.get("payload") if isinstance(parsed.get("payload"), dict) else {}
    media_type = parse_media_type(payload.get("mediaType")) if payload.get("mediaType") else infer_media_type(user_input)
    quality = payload.get("quality") or infer_quality(user_input)
    seasons = sorted_unique_positive_numbers(payload.get("season") or infer_seasons(user_input))
    title = str(payload.get("title") or "").strip() or cleanup_extracted_title(user_input)
    if media_type != "UNKNOWN":
        state["mediaType"] = media_type
    if title:
        state["title"] = title
    if quality:
        state["quality"] = quality
    if seasons:
        state["season"] = seasons
    context["mediaState"] = state
    if state.get("mediaType") in {None, "", "UNKNOWN"}:
        return {"clarification": "Should I fetch a movie or a show?"}
    if not state.get("title"):
        return {"clarification": "Which title should I use?"}
    if state.get("mediaType") == "SHOWS" and not state.get("season"):
        return {"clarification": "Which season should I use?"}
    if not state.get("quality"):
        return {"clarification": "Which quality should I use: 720p, 1080p, or 4K?"}
    return {"clarification": ""}


def parse_query_input(user_input: str, include_scope: bool = False) -> Dict[str, Any]:
    scope_line = ', "scope":"mine|all"' if include_scope else ""
    prompt = (
        "Extract media query fields from user input. "
        f"Return JSON: {{\"query\":{{\"title\":string,\"mediaType\":\"MOVIES|SHOWS|UNKNOWN\"{scope_line}}}}}. "
        f"User input: {user_input}"
    )
    parsed = openai_json(prompt) or {}
    query = parsed.get("query") if isinstance(parsed.get("query"), dict) else {}
    media_type = parse_media_type(query.get("mediaType") or infer_media_type(user_input))
    title = str(query.get("title") or "").strip() or cleanup_extracted_title(user_input)
    result = {"title": title, "mediaType": media_type}
    if include_scope:
        result["scope"] = "all" if re.search(r"(?i)\b(all|everyone|team|users)\b", user_input or "") or str(query.get("scope")).lower() == "all" else "mine"
    return result


def build_selection_prompt(options: List[Dict[str, Any]], media_type: str) -> str:
    lines = [f"I found these results ({media_type}):"]
    for index, option in enumerate(options, start=1):
        year = f" ({option.get('year')})" if option.get("year") else ""
        lines.append(f"{index}. {option.get('title', 'Unknown')}{year}")
    lines.append("")
    lines.append("Reply with the option number.")
    return "\n".join(lines)


def build_ui_options(options: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result = []
    for index, option in enumerate(options, start=1):
        year = f" ({option.get('year')})" if option.get("year") else ""
        result.append({"id": str(index), "value": str(index), "label": f"{option.get('title', 'Unknown')}{year}", "title": option.get("title"), "year": option.get("year")})
    return result


def parse_selection_index(user_input: str, options: List[Dict[str, Any]]) -> Optional[int]:
    match = re.search(r"\d+", user_input or "")
    if match:
        index = int(match.group(0)) - 1
        if 0 <= index < len(options):
            return index
    normalized_input = normalize_title_for_match(user_input)
    for index, option in enumerate(options):
        if normalized_input and normalized_input in normalize_title_for_match(option.get("title")):
            return index
    return None


def permission_notice(message: str, downgraded: bool) -> str:
    if not downgraded:
        return message
    return "Direct download is admin-only. I will raise a request instead.\n\n" + message


def handle_add_media_chat(context: Dict[str, Any], user_input: str, user: Dict[str, str], supported_intent: str) -> Dict[str, Any]:
    effective_intent = "RAISE_REQUEST" if supported_intent == "DOWNLOAD_MEDIA" and user.get("role", "").upper() != "ADMIN" else supported_intent
    downgraded = effective_intent != supported_intent
    if context.get("awaitingSelection"):
        options = context.get("selectionOptions") or []
        selected_index = parse_selection_index(user_input, options)
        if selected_index is None:
            return {"message": permission_notice("Please select one option by number.\n\n" + build_selection_prompt(options, context["mediaState"].get("mediaType", "UNKNOWN")), downgraded), "options": build_ui_options(options)}
        selected = options[selected_index]
        context["mediaState"]["title"] = selected.get("title")
        context["mediaState"]["tmdbId"] = selected.get("tmdbId")
        context["mediaState"]["tvdbId"] = selected.get("tvdbId")
        context["mediaState"]["imdbId"] = selected.get("imdbId")
        context["awaitingSelection"] = False
        context["selectionOptions"] = []
    else:
        parsed = parse_add_media_input(context, user_input)
        if parsed.get("clarification"):
            return {"message": permission_notice(parsed["clarification"], downgraded)}
        options = lookup_options(context["mediaState"]["title"], context["mediaState"]["mediaType"], 5)
        if not options:
            return {"message": permission_notice("I couldn't find matching results. Please try a more specific title.", downgraded)}
        context["awaitingSelection"] = True
        context["selectionOptions"] = options
        return {"message": permission_notice(build_selection_prompt(options, context["mediaState"]["mediaType"]), downgraded), "options": build_ui_options(options)}
    payload = context["mediaState"]
    if effective_intent == "DOWNLOAD_MEDIA":
        create_approved_request_from_automation(user["userId"], payload)
        context["completed"] = True
        return {"message": f"{payload.get('title')} queued for download"}
    create_request_from_automation(user["userId"], payload)
    context["completed"] = True
    return {"message": f"{payload.get('title')} request submitted for admin approval."}


def available_matches(title: str, media_type: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    media_types = [media_type] if media_type in {"MOVIES", "SHOWS"} else ["MOVIES", "SHOWS"]
    for mt in media_types:
        try:
            items.extend(fetch_arr_available(mt))
        except Exception:
            continue
    query = normalize_title_for_match(title)
    return [item for item in items if query and (query in normalize_title_for_match(item.get("title")) or normalize_title_for_match(item.get("title")) in query)]


def format_available_seasons(item: Dict[str, Any]) -> str:
    seasons = sorted_unique_positive_numbers(item.get("availableSeasons") or [])
    if not seasons:
        return "Available seasons: season details unavailable"
    return "Available seasons: " + ", ".join(f"Season {season}" for season in seasons)


def handle_exists_chat(context: Dict[str, Any], user_input: str) -> Dict[str, Any]:
    query = parse_query_input(user_input)
    title = query["title"]
    media_type = query["mediaType"]
    if not title:
        return {"message": "Please share the exact movie or series title you want me to check."}
    matches = available_matches(title, media_type)
    context["completed"] = True
    if not matches:
        suffix = " as a movie" if media_type == "MOVIES" else " as a series" if media_type == "SHOWS" else ""
        return {"message": f"No, \"{title}\" does not exist on the server{suffix}."}
    lines = [f"Yes, \"{title}\" exists on the server.", "Matches in server library:"]
    options = []
    for index, item in enumerate(matches, start=1):
        year = f" ({item.get('year')})" if item.get("year") else ""
        match_line = f"{index}. {item.get('title', 'Unknown')}{year}"
        if item.get("mediaType") == "SHOWS":
            match_line += f" - {format_available_seasons(item)}"
        lines.append(match_line)
        options.append({"id": f"{item.get('mediaType')}_{index}", "label": f"{item.get('title', 'Unknown')}{year} [{item.get('mediaType')}]", "value": item.get("title"), "title": item.get("title"), "year": item.get("year"), "mediaType": item.get("mediaType")})
    return {"message": "\n".join(lines), "options": options}


def handle_delete_chat(context: Dict[str, Any], user_input: str) -> Dict[str, Any]:
    if context.get("awaitingSelection"):
        options = context.get("selectionOptions") or []
        selected_index = parse_selection_index(user_input, options)
        if selected_index is None:
            return {"message": "Please select one option by number.\n\n" + build_selection_prompt(options, "library"), "options": build_ui_options(options)}
        selected = options[selected_index]
        mt = parse_media_type(selected.get("mediaType"))
        media_id = selected.get("radarrId") if mt == "MOVIES" else selected.get("sonarrId")
        base = base_url("RADARR_API_URL") if mt == "MOVIES" else base_url("SONARR_API_URL")
        key = os.getenv("RADARR_API_KEY") if mt == "MOVIES" else os.getenv("SONARR_API_KEY")
        path = "movie" if mt == "MOVIES" else "series"
        params = {"deleteFiles": True, "addImportExclusion" if mt == "MOVIES" else "addImportListExclusion": False}
        res = arr_get("DELETE", f"{base}/{path}/{media_id}", key or "", params=params)
        if res.status_code < 200 or res.status_code >= 300:
            context["completed"] = True
            return {"message": f"Failed to delete {selected.get('title')}: {res.text}"}
        context["completed"] = True
        return {"message": f"{selected.get('title')} deleted from the server library."}
    query = parse_query_input(user_input)
    title = query["title"]
    if not title:
        return {"message": "Please share the exact movie or series title you want to delete."}
    options = available_matches(title, query["mediaType"])
    if not options:
        context["completed"] = True
        return {"message": f"No matching movie or series was found for \"{title}\"."}
    context["awaitingSelection"] = True
    context["selectionOptions"] = options
    return {"message": build_selection_prompt(options, query["mediaType"]), "options": build_ui_options(options)}


def filter_downloads_for_chat(downloads: List[Dict[str, Any]], title: str, media_type: str) -> List[Dict[str, Any]]:
    result = []
    for item in downloads:
        if media_type != "UNKNOWN" and parse_media_type(item.get("mediaType")) != media_type:
            continue
        if title and not (normalize_title_for_match(title) in normalize_title_for_match(item.get("title")) or normalize_title_for_match(item.get("title")) in normalize_title_for_match(title)):
            continue
        result.append(item)
    return result


def build_download_summary(scope: str, title: str, media_type: str, active: List[Dict[str, Any]], completed: List[Dict[str, Any]]) -> str:
    lines = [f"Download status report", f"Scope: {scope}"]
    if title:
        lines.append(f"Title filter: {title}")
    if media_type != "UNKNOWN":
        lines.append(f"Media type filter: {media_type}")
    lines.append(f"Active downloads: {len(active)}")
    lines.append(f"Completed downloads: {len(completed)}")
    if not active and not completed:
        lines.append("No matching active or completed downloads found.")
        return "\n".join(lines)
    if active:
        lines.append("Active entries:")
        for index, item in enumerate(active[:15], start=1):
            progress = item.get("progressPercent")
            progress_text = f" | progress={float(progress):.1f}%" if isinstance(progress, (int, float)) else ""
            time_left = f" | timeLeft={item.get('timeleft')}" if item.get("timeleft") else ""
            lines.append(f"{index}) [{item.get('mediaType', 'UNKNOWN')}] {item.get('title', 'Unknown title')} | status={item.get('status', 'unknown')} | state={item.get('trackedDownloadState', 'unknown')}{progress_text}{time_left}")
    if completed:
        lines.append("Completed entries:")
        for index, item in enumerate(completed[:15], start=1):
            lines.append(f"{index}) [{item.get('mediaType', 'UNKNOWN')}] {item.get('title', 'Unknown title')} | status={item.get('status', 'downloaded')}")
    return "\n".join(lines)


def handle_status_chat(context: Dict[str, Any], user_input: str, user: Dict[str, str]) -> Dict[str, Any]:
    query = parse_query_input(user_input, include_scope=True)
    scope = "all" if user.get("role", "").upper() == "ADMIN" and query.get("scope") == "all" else "mine"
    include_all = scope == "all"
    active = combined_queue_records()
    if not include_all:
        user_requests = find(MEDIA_REQUESTS_COLLECTION, {"status": "APPROVED", "userId": user["userId"]})
        active = [item for item in active if any(queue_matches_request(item, request_record) for request_record in user_requests)]
    completed_query = {"status": "DOWNLOADED"} if include_all else {"status": "DOWNLOADED", "userId": user["userId"]}
    completed = [completed_download_record(record, include_all) for record in find(MEDIA_REQUESTS_COLLECTION, completed_query)]
    active = filter_downloads_for_chat(active, query["title"], query["mediaType"])
    completed = filter_downloads_for_chat(completed, query["title"], query["mediaType"])
    context["completed"] = True
    return {"message": build_download_summary(scope, query["title"], query["mediaType"], active, completed)}


async def moviehub_chat_response(request: Request, user: Dict[str, str], admin_route: bool = False):
    body = await request.json()
    conversation_id = body.get("conversationId")
    user_input = body.get("userInput")
    if not isinstance(conversation_id, str) or not conversation_id or not isinstance(user_input, str) or not user_input:
        return JSONResponse(status_code=500, content=error("invalid payload"))
    context = moviehub_conversations.setdefault(conversation_id, new_chat_context(conversation_id))
    if context.get("completed"):
        reset_chat_context(context)
    intent = context.get("intent") or "UNKNOWN"
    if intent == "UNKNOWN":
        intent = resolve_chat_intent(user_input)
        if intent == "UNKNOWN":
            parsed = openai_json(f"Classify this media assistant intent as DOWNLOAD_MEDIA, RAISE_REQUEST, CHECK_MEDIA_EXISTS, DELETE_MEDIA, CHECK_DOWNLOAD_STATUS, LIST_DOWNLOADS, or UNKNOWN. Return JSON {{\"intent\":string}}. Input: {user_input}") or {}
            intent = parsed.get("intent") if parsed.get("intent") in {"DOWNLOAD_MEDIA", "RAISE_REQUEST", "CHECK_MEDIA_EXISTS", "DELETE_MEDIA", "CHECK_DOWNLOAD_STATUS", "LIST_DOWNLOADS"} else "UNKNOWN"
        if intent == "UNKNOWN":
            return chat_success({"message": "I'm not sure I understood that. You can ask me to download or request a movie/TV show."})
        context["intent"] = intent
    try:
        if intent in {"DOWNLOAD_MEDIA", "RAISE_REQUEST"}:
            response = handle_add_media_chat(context, user_input, user, intent)
        elif intent == "CHECK_MEDIA_EXISTS":
            response = handle_exists_chat(context, user_input)
        elif intent == "DELETE_MEDIA":
            if not admin_route and user.get("role", "").upper() != "ADMIN":
                context["completed"] = True
                response = {"message": "Deleting media is admin-only."}
            else:
                response = handle_delete_chat(context, user_input)
        elif intent in {"CHECK_DOWNLOAD_STATUS", "LIST_DOWNLOADS"}:
            response = handle_status_chat(context, user_input, user)
        else:
            response = {"message": "I'm not sure I understood that. You can ask me to download or request a movie/TV show."}
        response["intent"] = intent
        response["conversationId"] = conversation_id
        return chat_success(response)
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))


@router.post("/v2/moviehub/chat/completions")
async def moviehub_chat(request: Request, user: Dict[str, str] = Depends(current_user)):
    return await moviehub_chat_response(request, user)


@router.post("/v2/admin/moviehub/chat/completions")
async def moviehub_chat_admin(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return await moviehub_chat_response(request, user, True)
