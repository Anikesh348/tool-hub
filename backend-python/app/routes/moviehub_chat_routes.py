import json
import os
import re
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import MEDIA_REQUESTS_COLLECTION, MOVIEHUB_ACCESS_REQUESTS_COLLECTION, MOVIEHUB_ACCESS_USERS_COLLECTION, YT_DOWNLOADS_COLLECTION, moviehub_conversations
from app.middlewares.auth import admin_user, current_user
from app.routes.moviehub_routes import (
    create_jellyfin_user,
    decrypt_temp_password,
    delete_jellyfin_user,
    encrypt_temp_password,
    enforce_jellyfin_limited_library_access,
    generate_temp_password,
    send_moviehub_credentials_email,
)
from app.services.ai_gateway import AIGatewayError
from app.services.ai_provider_router import routed_gateway_request
from app.services.mongo import col, delete_one_or_404, find, find_one, insert, update_one_or_404
from app.services.moviehub_automation import *
from app.services import yt_download as yt_service
from app.utils.http import base_url
from app.utils.responses import error, now_iso, success

router = APIRouter()

CHAT_INTENTS = {
    "DOWNLOAD_MEDIA",
    "RAISE_REQUEST",
    "CHECK_MEDIA_EXISTS",
    "SEARCH_MEDIA",
    "LIST_AVAILABLE",
    "DELETE_MEDIA",
    "CHECK_DOWNLOAD_STATUS",
    "LIST_DOWNLOADS",
    "LIST_REQUESTS",
    "APPROVE_REQUEST",
    "DELETE_REQUEST",
    "PAUSE_DOWNLOADS",
    "RESUME_DOWNLOADS",
    "DELETE_DOWNLOAD",
    "ACCESS_REQUEST",
    "ACCESS_LIST_REQUESTS",
    "ACCESS_APPROVE_REQUEST",
    "ACCESS_REJECT_REQUEST",
    "ACCESS_LIST_USERS",
    "ACCESS_DELETE_USER",
    "ACCESS_RESEND_PASSWORD",
    "ACCESS_CONFIRM_PASSWORD",
    "YT_ADD_DOWNLOAD",
    "YT_GET_FORMATS",
    "YT_START_DOWNLOAD",
    "YT_LIST_REQUESTS",
    "YT_STATUS",
    "YT_DELETE_REQUEST",
    "YT_LIST_LIBRARY",
    "YT_DELETE_LIBRARY_ITEM",
}

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
        ("YT_ADD_DOWNLOAD", r"(?i)\b(youtube|yt)\b.*\b(download|add|queue)\b"),
        ("YT_GET_FORMATS", r"(?i)\b(youtube|yt)\b.*\b(format|formats|quality|qualities)\b"),
        ("YT_START_DOWNLOAD", r"(?i)\b(youtube|yt)\b.*\b(start|run|process)\b"),
        ("YT_DELETE_LIBRARY_ITEM", r"(?i)\b(youtube|yt)\b.*\b(delete|remove)\b.*\b(library|item|video)\b"),
        ("YT_DELETE_REQUEST", r"(?i)\b(youtube|yt)\b.*\b(delete|remove|cancel)\b.*\b(request|queue)\b"),
        ("YT_LIST_LIBRARY", r"(?i)\b(youtube|yt)\b.*\b(library|items|files|videos)\b"),
        ("YT_LIST_REQUESTS", r"(?i)\b(youtube|yt)\b.*\b(requests|queue|downloads)\b"),
        ("YT_STATUS", r"(?i)\b(youtube|yt)\b.*\b(status|progress)\b"),
        ("ACCESS_CONFIRM_PASSWORD", r"(?i)\b(confirm|done)\b.*\b(password|temporary password|reset)\b"),
        ("ACCESS_RESEND_PASSWORD", r"(?i)\b(resend|send)\b.*\b(password|temporary password)\b"),
        ("ACCESS_DELETE_USER", r"(?i)\b(delete|remove)\b.*\b(moviehub user|access user|jellyfin user)\b"),
        ("ACCESS_APPROVE_REQUEST", r"(?i)\bapprove\b.*\b(access|moviehub access|jellyfin)\b"),
        ("ACCESS_REJECT_REQUEST", r"(?i)\b(reject|deny)\b.*\b(access|moviehub access|jellyfin)\b"),
        ("ACCESS_LIST_USERS", r"(?i)\b(list|show)\b.*\b(access users|moviehub users|jellyfin users)\b"),
        ("ACCESS_LIST_REQUESTS", r"(?i)\b(list|show)\b.*\b(access requests|moviehub access requests|jellyfin requests)\b"),
        ("ACCESS_REQUEST", r"(?i)\b(request|ask for|need)\b.*\b(access|moviehub access|jellyfin)\b"),
        ("APPROVE_REQUEST", r"(?i)\bapprove\b.*\b(media request|request)\b"),
        ("DELETE_REQUEST", r"(?i)\b(delete|remove|cancel)\b.*\b(media request|request)\b"),
        ("LIST_REQUESTS", r"(?i)\b(list|show|my|all)\b.*\b(media requests|movie requests|requests)\b"),
        ("PAUSE_DOWNLOADS", r"(?i)\b(pause|stop|disable)\b.*\b(download|downloads|automation)\b"),
        ("RESUME_DOWNLOADS", r"(?i)\b(resume|start|enable)\b.*\b(download|downloads|automation)\b"),
        ("DELETE_DOWNLOAD", r"(?i)\b(delete|remove|cancel)\b.*\b(download|queue item|queue)\b"),
        ("LIST_DOWNLOADS", r"(?i)\b(what.*downloading|what.*downloads?|currently downloading|downloading now|active downloads?|list downloads|show downloads|download queue)\b"),
        ("CHECK_DOWNLOAD_STATUS", r"(?i)\b(downloaded|download status|status|progress|time left|eta|how much time|finished|complete)\b"),
        ("DELETE_MEDIA", r"(?i)\b(delete|remove|uninstall|erase)\b.+\b(movie|movies|show|series|tv|media|library)\b"),
        ("LIST_AVAILABLE", r"(?i)\b(list|show)\b.*\b(available|library)\b.*\b(movie|movies|show|shows|series|tv)\b"),
        ("SEARCH_MEDIA", r"(?i)\b(search|lookup|look\s*up|find)\b.+\b(movie|movies|show|series|tv)\b"),
        ("CHECK_MEDIA_EXISTS", r"(?i)(\bdoes\b.+\bexist\b|\b(is|check|find|search|lookup|look\s*up)\b.+\b(movie|movies|show|series|tv)\b)"),
        ("RAISE_REQUEST", r"(?i)\b(request|raise request|submit request|ask admin)\b"),
        ("DOWNLOAD_MEDIA", r"(?i)\b(download|add|get|grab)\b"),
    ]
    for intent, pattern in checks:
        if re.search(pattern, text or ""):
            return intent
    return "UNKNOWN"


def gateway_completion(prompt: str, instructions: str, action: str) -> Optional[str]:
    """Single-shot text completion via the private Codex/Claude gateway (see ai_provider_router)."""
    try:
        _, response = routed_gateway_request(
            "POST",
            "/v1/responses",
            payload={
                "input": prompt,
                "conversation": {"providerConversationId": None},
                "context": [{"type": "text", "label": "Instructions", "text": instructions}],
                "capabilityProfile": "knowledge-only",
                "metadata": {"application": "toolhub-moviehub", "action": action},
            },
            timeout=45,
        )
    except AIGatewayError:
        return None
    except Exception:
        return None
    content = str(response.get("outputText") or "").strip()
    return content or None


def openai_json(prompt: str) -> Optional[Dict[str, Any]]:
    content = gateway_completion(
        prompt,
        "You are a backend service. Respond with ONLY valid JSON.",
        "chat-intent-json",
    )
    if not content:
        return None
    try:
        return json.loads(content)
    except Exception:
        return None


def openai_text(prompt: str, max_tokens: int = 220) -> Optional[str]:
    return gateway_completion(
        prompt,
        "You summarize MovieHub download status for end users. "
        "Use only the supplied facts. Do not invent titles, progress, ETA, or completion state.",
        "download-status-summary",
    )


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
    title = re.sub(r"(?i)\b(download|downloads|downloaded|downloading|add|get|grab|request|raise|submit|ask admin|check|find|search|lookup|look up|delete|remove|exists?|status|progress|eta|time left|server|library|queue|movie|movies|show|shows|series|tv|in|on|from|the|a|an|my|all|what|are|is|has|have|was|were|this|that|these|those|now|currently|active|please|if|whether|of|finished|complete|completed)\b", " ", text or "")
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


def is_generic_download_title(title: str) -> bool:
    normalized = normalize_title_for_match(title)
    if not normalized:
        return True
    generic_titles = {
        "download",
        "downloads",
        "downloading",
        "downloadingnow",
        "currentlydownloading",
        "activedownload",
        "activedownloads",
        "downloadqueue",
        "queue",
        "now",
        "this",
        "that",
        "thisshow",
        "thatshow",
        "thismovie",
        "thatmovie",
    }
    return normalized in generic_titles


def looks_like_queue_wide_download_question(user_input: str) -> bool:
    text = user_input or ""
    if re.search(r"(?i)\b(is|has|have|was|were)\b.+\b(downloaded|finished|complete|completed)\b", text):
        return False
    return bool(re.search(
        r"(?i)(^\s*(what|which)\b.*\b(download(ing|s)?|queue)\b|\b(currently downloading|downloading now|active downloads?|download queue|list downloads|show downloads)\b)",
        text,
    ))


def explicit_download_media_type(user_input: str, current_media_type: str) -> str:
    text = user_input or ""
    if re.search(r"(?i)\b(movie|movies|film)\b", text):
        return "MOVIES"
    if re.search(r"(?i)\b(shows|series|tv)\b", text):
        return "SHOWS"
    if re.search(r"(?i)^\s*show\s+(active|all|current|currently|downloads?|download queue)\b", text):
        return "UNKNOWN"
    return current_media_type


def parse_download_query_input(user_input: str, intent: str) -> Dict[str, Any]:
    prompt = (
        "Classify this MovieHub download-status prompt before extracting a title. "
        "Return JSON: {\"query\":{\"action\":\"ACTIVE_QUEUE|DOWNLOADED_CHECK|STATUS_REPORT\","
        "\"title\":string,\"mediaType\":\"MOVIES|SHOWS|UNKNOWN\",\"scope\":\"mine|all\"}}. "
        "Use ACTIVE_QUEUE for queue-wide questions like 'what is downloading now'. "
        "Only set title when the user explicitly names a movie or show; never use phrases like "
        "'downloading now', 'active downloads', 'download queue', 'this show', or 'this movie' as a title. "
        f"User input: {user_input}"
    )
    parsed = openai_json(prompt) or {}
    llm_query = parsed.get("query") if isinstance(parsed.get("query"), dict) else {}
    fallback = parse_query_input(user_input, include_scope=True)

    query = {
        "title": str(llm_query.get("title") or fallback.get("title") or "").strip(),
        "mediaType": parse_media_type(llm_query.get("mediaType")) if llm_query.get("mediaType") else fallback.get("mediaType", "UNKNOWN"),
        "scope": "all" if str(llm_query.get("scope") or fallback.get("scope")).lower() == "all" else "mine",
        "action": str(llm_query.get("action") or "").upper(),
    }
    if query["mediaType"] == "UNKNOWN":
        query["mediaType"] = fallback.get("mediaType", "UNKNOWN")
    if not query["action"]:
        if looks_like_queue_wide_download_question(user_input) or intent == "LIST_DOWNLOADS":
            query["action"] = "ACTIVE_QUEUE"
        elif is_downloaded_question(user_input):
            query["action"] = "DOWNLOADED_CHECK"
        else:
            query["action"] = "STATUS_REPORT"

    if query["action"] == "ACTIVE_QUEUE" and (looks_like_queue_wide_download_question(user_input) or is_generic_download_title(query["title"])):
        query["title"] = ""
        query["mediaType"] = explicit_download_media_type(user_input, query["mediaType"])
    elif is_generic_download_title(query["title"]):
        query["title"] = ""
    return query


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


def handle_search_chat(context: Dict[str, Any], user_input: str) -> Dict[str, Any]:
    query = parse_query_input(user_input)
    if query["mediaType"] == "UNKNOWN":
        return {"message": "Should I search movies or shows?"}
    if not query["title"]:
        return {"message": "Which title should I search for?"}
    options = lookup_options(query["title"], query["mediaType"], 10)
    context["completed"] = True
    if not options:
        return {"message": f"No {query['mediaType'].lower()} results found for \"{query['title']}\"."}
    return {"message": build_selection_prompt(options, query["mediaType"]), "options": build_ui_options(options)}


def handle_available_list_chat(context: Dict[str, Any], user_input: str) -> Dict[str, Any]:
    media_type = infer_media_type(user_input)
    if media_type == "UNKNOWN":
        return {"message": "Should I list available movies or shows?"}
    items = fetch_arr_available(media_type)
    context["completed"] = True
    if not items:
        return {"message": f"No available {media_type.lower()} found."}
    lines = [f"Available {media_type.lower()}: {len(items)}"]
    for index, item in enumerate(items[:20], start=1):
        year = f" ({item.get('year')})" if item.get("year") else ""
        seasons = f" | {format_available_seasons(item)}" if media_type == "SHOWS" else ""
        lines.append(f"{index}. {item.get('title', 'Unknown')}{year}{seasons}")
    return {"message": "\n".join(lines)}


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


def download_item_facts(item: Dict[str, Any]) -> Dict[str, Any]:
    facts = {
        "title": item.get("title") or "Unknown title",
        "mediaType": parse_media_type(item.get("mediaType")),
        "status": item.get("status"),
        "state": item.get("trackedDownloadState"),
        "progressPercent": item.get("progressPercent"),
        "timeLeft": item.get("timeleft"),
        "downloadedAt": item.get("downloadedAt"),
        "year": item.get("year"),
    }
    if facts["mediaType"] == "SHOWS":
        facts["seasons"] = sorted_unique_positive_numbers(item.get("seasonNumbers") or item.get("season") or [])
    return {key: value for key, value in facts.items() if value not in (None, "", [], "UNKNOWN")}


def summarize_download_response(user_input: str, query: Dict[str, Any], scope: str, active: List[Dict[str, Any]], completed: List[Dict[str, Any]], fallback: str) -> str:
    facts = {
        "userQuestion": user_input,
        "scope": scope,
        "query": query,
        "authoritativeAnswer": fallback,
        "activeCount": len(active),
        "completedCount": len(completed),
        "activeDownloads": [download_item_facts(item) for item in active[:15]],
        "completedDownloads": [download_item_facts(item) for item in completed[:15]],
    }
    prompt = (
        "Summarize these MovieHub download facts as a concise chat answer. "
        "Treat authoritativeAnswer as the source of truth for yes/no downloaded checks. "
        "Answer the user's question directly. Mention warnings or stalled/problem states when present. "
        "If nothing matches, say that plainly. Keep it under 4 short sentences and avoid raw table/list syntax.\n\n"
        f"Facts JSON:\n{json.dumps(facts, default=str)}"
    )
    return openai_text(prompt) or fallback


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


def build_active_downloads_summary(scope: str, active: List[Dict[str, Any]], title: str, media_type: str) -> str:
    if not active:
        return "Nothing is actively downloading right now." if not title else f"No active downloads found for \"{title}\"."
    lines = [f"Active downloads: {len(active)}", f"Scope: {scope}"]
    if title:
        lines.append(f"Title filter: {title}")
    if media_type != "UNKNOWN":
        lines.append(f"Media type filter: {media_type}")
    for index, item in enumerate(active[:15], start=1):
        progress = item.get("progressPercent")
        progress_text = f" | progress={float(progress):.1f}%" if isinstance(progress, (int, float)) else ""
        time_left = f" | timeLeft={item.get('timeleft')}" if item.get("timeleft") else ""
        seasons = ""
        if parse_media_type(item.get("mediaType")) == "SHOWS":
            season_numbers = sorted_unique_positive_numbers(item.get("seasonNumbers") or [])
            seasons = f" | seasons={format_seasons(season_numbers)}" if season_numbers else ""
        lines.append(f"{index}. [{item.get('mediaType', 'UNKNOWN')}] {item.get('title', 'Unknown title')}{seasons} | status={item.get('status', 'unknown')} | state={item.get('trackedDownloadState', 'unknown')}{progress_text}{time_left}")
    return "\n".join(lines)


def is_active_download_question(user_input: str, intent: str) -> bool:
    return intent == "LIST_DOWNLOADS" or bool(re.search(r"(?i)\b(what.*downloading|currently downloading|downloading now|active downloads?|download queue)\b", user_input or ""))


def is_downloaded_question(user_input: str) -> bool:
    return bool(re.search(r"(?i)\b(downloaded|finished|complete|completed)\b", user_input or ""))


def build_downloaded_answer(title: str, media_type: str, seasons: List[int], active: List[Dict[str, Any]], completed: List[Dict[str, Any]]) -> str:
    if not title:
        return "Please share the exact movie or series title you want me to check."
    live_matches = available_matches(title, media_type)
    if not live_matches:
        if active:
            return f"No, \"{title}\" is not downloaded yet. It is currently downloading."
        if completed:
            return f"I found a completed request for \"{title}\", but the live library check did not find it downloaded right now."
        suffix = " as a movie" if media_type == "MOVIES" else " as a series" if media_type == "SHOWS" else ""
        return f"No, \"{title}\" is not downloaded{suffix}."

    lines = []
    for item in live_matches[:5]:
        item_type = parse_media_type(item.get("mediaType"))
        item_title = item.get("title") or title
        year = f" ({item.get('year')})" if item.get("year") else ""
        if item_type == "MOVIES":
            lines.append(f"Yes, \"{item_title}\"{year} is downloaded.")
            continue
        available_seasons = sorted_unique_positive_numbers(item.get("availableSeasons") or [])
        if seasons:
            missing = [season for season in seasons if season not in available_seasons]
            if not missing:
                lines.append(f"Yes, \"{item_title}\"{year} has the requested season(s) downloaded: {format_seasons(seasons)}.")
            elif len(missing) == len(seasons):
                lines.append(f"No, \"{item_title}\"{year} does not have the requested season(s) downloaded. {format_available_seasons(item)}.")
            else:
                present = [season for season in seasons if season in available_seasons]
                lines.append(f"Partially downloaded: \"{item_title}\"{year} has season(s) {format_seasons(present)}, missing {format_seasons(missing)}.")
        elif available_seasons:
            lines.append(f"Yes, \"{item_title}\"{year} has downloaded episodes. {format_available_seasons(item)}.")
        else:
            lines.append(f"Yes, \"{item_title}\"{year} has downloaded episodes, but season details are unavailable.")
    return "\n".join(lines)


def handle_status_chat(context: Dict[str, Any], user_input: str, user: Dict[str, str], intent: str) -> Dict[str, Any]:
    query = parse_download_query_input(user_input, intent)
    if not query["title"]:
        prior_title = str((context.get("mediaState") or {}).get("title") or "").strip()
        if prior_title and query.get("action") != "ACTIVE_QUEUE":
            query["title"] = prior_title
    scope = "all" if user.get("role", "").upper() == "ADMIN" else "mine"
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
    if query.get("action") == "ACTIVE_QUEUE" or is_active_download_question(user_input, intent):
        fallback = build_active_downloads_summary(scope, active, query["title"], query["mediaType"])
        return {"message": summarize_download_response(user_input, query, scope, active, completed, fallback)}
    if query.get("action") == "DOWNLOADED_CHECK" or is_downloaded_question(user_input):
        fallback = build_downloaded_answer(query["title"], query["mediaType"], infer_seasons(user_input), active, completed)
        return {"message": summarize_download_response(user_input, query, scope, active, completed, fallback)}
    fallback = build_download_summary(scope, query["title"], query["mediaType"], active, completed)
    return {"message": summarize_download_response(user_input, query, scope, active, completed, fallback)}


def is_admin(user: Dict[str, str]) -> bool:
    return user.get("role", "").upper() == "ADMIN"


def require_admin_chat(user: Dict[str, str], context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if is_admin(user):
        return None
    context["completed"] = True
    return {"message": "That MovieHub action is admin-only."}


def first_uuid_or_token(text: str) -> str:
    match = re.search(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", text or "", re.I)
    if match:
        return match.group(0)
    match = re.search(r"(?i)\b(?:id|request|mapping|item|video)\s*[:#-]?\s*([A-Za-z0-9._-]{6,})\b", text or "")
    return match.group(1) if match else ""


def first_number(text: str) -> Optional[int]:
    match = re.search(r"\b\d+\b", text or "")
    return int(match.group(0)) if match else None


def format_media_requests(records: List[Dict[str, Any]], include_user: bool) -> str:
    if not records:
        return "No media requests found."
    lines = [f"Media requests: {len(records)}"]
    for index, record in enumerate(records[:15], start=1):
        seasons = ""
        if parse_media_type(record.get("mediaType")) == "SHOWS":
            seasons = f" | seasons={format_seasons(record.get('season') or [])}"
        requester = f" | user={record.get('userEmail') or record.get('userName') or record.get('userId')}" if include_user else ""
        lines.append(f"{index}. {record.get('title', 'Unknown title')} [{record.get('mediaType', 'UNKNOWN')}] | status={record.get('status', 'UNKNOWN')}{seasons}{requester} | id={record.get('requestId')}")
    return "\n".join(lines)


def handle_request_admin_chat(context: Dict[str, Any], user_input: str, user: Dict[str, str], intent: str) -> Dict[str, Any]:
    if intent == "LIST_REQUESTS":
        include_all = is_admin(user) and re.search(r"(?i)\b(all|everyone|users|admin)\b", user_input or "")
        query = {} if include_all else {"userId": user["userId"]}
        context["completed"] = True
        records = sorted(find(MEDIA_REQUESTS_COLLECTION, query), key=lambda r: r.get("createdAt", ""), reverse=True)
        return {"message": format_media_requests(records, include_all)}
    if intent == "APPROVE_REQUEST":
        denied = require_admin_chat(user, context)
        if denied:
            return denied
        request_id = first_uuid_or_token(user_input)
        if not request_id:
            return {"message": "Please provide the media request id to approve."}
        record = find_one(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id})
        if not record:
            context["completed"] = True
            return {"message": "Media request not found."}
        if record.get("status") != "PENDING":
            context["completed"] = True
            return {"message": "Only pending media requests can be approved."}
        queue_media_download(record)
        now = now_iso()
        update_one_or_404(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id}, {"$set": {"status": "APPROVED", "approvedBy": user["userId"], "approvedAt": now, "updatedAt": now}})
        context["completed"] = True
        return {"message": f"{record.get('title', 'Request')} approved and queued for download."}
    request_id = first_uuid_or_token(user_input)
    if not request_id:
        return {"message": "Please provide the media request id to delete."}
    record = find_one(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id})
    if not record:
        context["completed"] = True
        return {"message": "Media request not found."}
    if record.get("status") == "APPROVED" and not is_admin(user):
        context["completed"] = True
        return {"message": "Only admins can delete approved requests."}
    if record.get("status") == "PENDING" and not (is_admin(user) or record.get("userId") == user["userId"]):
        context["completed"] = True
        return {"message": "You are not allowed to delete this request."}
    delete_one_or_404(MEDIA_REQUESTS_COLLECTION, {"requestId": request_id})
    context["completed"] = True
    return {"message": f"Deleted media request for {record.get('title', request_id)}."}


def handle_download_admin_chat(context: Dict[str, Any], user_input: str, user: Dict[str, str], intent: str) -> Dict[str, Any]:
    denied = require_admin_chat(user, context)
    if denied:
        return denied
    if intent == "PAUSE_DOWNLOADS":
        context["completed"] = True
        return {"message": set_download_handling_enabled(False).get("message", "Download automation paused")}
    if intent == "RESUME_DOWNLOADS":
        context["completed"] = True
        return {"message": set_download_handling_enabled(True).get("message", "Download automation resumed")}
    queue_id = first_number(user_input)
    mt = infer_media_type(user_input)
    if mt == "UNKNOWN":
        return {"message": "Please provide whether the queued download is a movie or show."}
    if not queue_id:
        return {"message": "Please provide the queue item id to delete."}
    base = base_url("RADARR_API_URL") if mt == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if mt == "MOVIES" else os.getenv("SONARR_API_KEY")
    res = arr_get("DELETE", f"{base}/queue/{queue_id}", key or "", params={"removeFromClient": True, "blocklist": False, "skipRedownload": True, "changeCategory": False})
    context["completed"] = True
    if res.status_code < 200 or res.status_code >= 300:
        return {"message": f"Failed to delete queue item {queue_id}: {res.text}"}
    return {"message": f"Download queue item {queue_id} removed."}


def handle_access_chat(context: Dict[str, Any], user_input: str, user: Dict[str, str], intent: str) -> Dict[str, Any]:
    if intent == "ACCESS_REQUEST":
        username_match = re.search(r"(?i)\b(?:username|user|as)\s+([a-zA-Z0-9._-]{3,32})\b", user_input or "")
        username = username_match.group(1) if username_match else ""
        if not username:
            return {"message": "Which MovieHub username should I request? Use letters, numbers, dot, underscore, or hyphen."}
        db_user = find_one("users", {"userId": user["userId"]}) or {}
        email = db_user.get("email") or user.get("email", "")
        if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": email, "active": True}):
            context["completed"] = True
            return {"message": "MovieHub access is already approved for this user."}
        if find_one(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"userEmail": email, "status": "PENDING"}):
            context["completed"] = True
            return {"message": "A MovieHub access request is already pending approval."}
        if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"movieHubUserNameLower": username.lower(), "active": True}) or find_one(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"movieHubUserNameLower": username.lower(), "status": "PENDING"}):
            context["completed"] = True
            return {"message": "That MovieHub username is already in use."}
        try:
            encrypted_password = encrypt_temp_password(generate_temp_password())
        except Exception as exc:
            context["completed"] = True
            return {"message": f"Failed to secure temporary password: {exc}"}
        request_id = str(uuid.uuid4())
        insert(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"requestId": request_id, "userId": user["userId"], "userEmail": email, "userName": db_user.get("name", db_user.get("userName", "")), "movieHubUserName": username, "movieHubUserNameLower": username.lower(), "encryptedPassword": encrypted_password, "status": "PENDING", "createdAt": now_iso(), "updatedAt": now_iso()})
        context["completed"] = True
        return {"message": f"MovieHub access request submitted for {username}. Request id: {request_id}"}
    if intent in {"ACCESS_RESEND_PASSWORD", "ACCESS_CONFIRM_PASSWORD"}:
        db_user = find_one("users", {"userId": user["userId"]}) or {}
        email = db_user.get("email") or user.get("email", "")
        if intent == "ACCESS_CONFIRM_PASSWORD":
            col(MOVIEHUB_ACCESS_USERS_COLLECTION).update_one({"userEmail": email}, {"$set": {"passwordResetConfirmedAt": now_iso(), "updatedAt": now_iso()}})
            context["completed"] = True
            return {"message": "Password reset confirmed."}
        mapping = find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": email, "active": True})
        if not mapping:
            context["completed"] = True
            return {"message": "MovieHub access is not approved for this user."}
        req = col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).find_one({"userEmail": email, "status": "APPROVED"}, sort=[("createdAt", -1)])
        if not req:
            context["completed"] = True
            return {"message": "No approved MovieHub access request found."}
        try:
            password = decrypt_temp_password(req.get("encryptedPassword"))
            req = json.loads(json.dumps(req, default=str))
            req["movieHubUserName"] = mapping.get("movieHubUserName", req.get("movieHubUserName"))
            send_moviehub_credentials_email(req, password)
            now = now_iso()
            col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).update_one({"requestId": req.get("requestId")}, {"$set": {"credentialsSentAt": now, "updatedAt": now}})
            col(MOVIEHUB_ACCESS_USERS_COLLECTION).update_one({"mappingId": mapping.get("mappingId")}, {"$set": {"passwordResetConfirmedAt": None, "updatedAt": now}})
        except Exception as exc:
            context["completed"] = True
            return {"message": f"Failed to resend temporary password: {exc}"}
        context["completed"] = True
        return {"message": "Temporary password resent to your email."}
    denied = require_admin_chat(user, context)
    if denied:
        return denied
    if intent == "ACCESS_LIST_REQUESTS":
        records = sorted(find(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"status": "PENDING"}), key=lambda r: r.get("createdAt", ""), reverse=True)
        context["completed"] = True
        return {"message": "No pending access requests found." if not records else "\n".join(["Pending access requests:"] + [f"{i}. {r.get('movieHubUserName')} | {r.get('userEmail')} | id={r.get('requestId')}" for i, r in enumerate(records[:15], 1)])}
    if intent == "ACCESS_LIST_USERS":
        records = find(MOVIEHUB_ACCESS_USERS_COLLECTION, {"active": True})
        user_ids = [record.get("userId") for record in records if record.get("userId")]
        role_by_user_id = {
            account.get("userId"): str(account.get("role") or "USER").upper()
            for account in find("users", {"userId": {"$in": user_ids}})
            if account.get("userId")
        }
        records = sorted(records, key=lambda r: r.get("createdAt", ""), reverse=True)
        context["completed"] = True
        return {"message": "No active MovieHub users found." if not records else "\n".join(["Active MovieHub users:"] + [f"{i}. {r.get('movieHubUserName')} | {r.get('userEmail')} | role={'ADMIN' if role_by_user_id.get(r.get('userId')) == 'ADMIN' else 'USER'} | id={r.get('mappingId')}" for i, r in enumerate(records[:15], 1)])}
    target_id = first_uuid_or_token(user_input)
    if not target_id:
        return {"message": "Please provide the request or mapping id."}
    if intent == "ACCESS_APPROVE_REQUEST":
        req = find_one(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"requestId": target_id})
        if not req:
            context["completed"] = True
            return {"message": "Access request not found."}
        if req.get("status") != "PENDING":
            context["completed"] = True
            return {"message": "Only pending MovieHub access requests can be approved."}
        if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": req.get("userEmail"), "active": True}):
            context["completed"] = True
            return {"message": "User already has MovieHub access."}
        if find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"movieHubUserNameLower": req.get("movieHubUserNameLower"), "active": True}):
            context["completed"] = True
            return {"message": "That MovieHub username is already in use."}
        try:
            if req.get("encryptedPassword"):
                password = decrypt_temp_password(req.get("encryptedPassword"))
            else:
                password = generate_temp_password()
                encrypted_password = encrypt_temp_password(password)
                col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).update_one({"requestId": target_id}, {"$set": {"encryptedPassword": encrypted_password, "updatedAt": now_iso()}})
                req["encryptedPassword"] = encrypted_password
            jellyfin_user = create_jellyfin_user(req.get("movieHubUserName", ""), password)
            jellyfin_user_id = jellyfin_user.get("Id")
            if not jellyfin_user_id:
                raise RuntimeError("jellyfin user id is missing")
            enforce_jellyfin_limited_library_access(jellyfin_user_id)
            send_moviehub_credentials_email(req, password)
        except Exception as exc:
            context["completed"] = True
            return {"message": f"Failed to approve MovieHub access: {exc}"}
        mapping_id = str(uuid.uuid4())
        now = now_iso()
        insert(MOVIEHUB_ACCESS_USERS_COLLECTION, {"mappingId": mapping_id, "requestId": target_id, "userId": req.get("userId"), "userEmail": req.get("userEmail"), "userName": req.get("userName"), "movieHubUserName": req.get("movieHubUserName"), "movieHubUserNameLower": req.get("movieHubUserNameLower"), "jellyfinUserId": jellyfin_user_id, "approvedBy": user["userId"], "approvedAt": now, "passwordResetConfirmedAt": None, "active": True, "createdAt": now, "updatedAt": now})
        col(MOVIEHUB_ACCESS_REQUESTS_COLLECTION).update_one({"requestId": target_id}, {"$set": {"status": "APPROVED", "approvedBy": user["userId"], "approvedAt": now, "jellyfinUserId": jellyfin_user_id, "credentialsSentAt": now, "updatedAt": now}})
        context["completed"] = True
        return {"message": f"MovieHub access approved for {req.get('movieHubUserName')} and credentials were emailed."}
    if intent == "ACCESS_REJECT_REQUEST":
        update_one_or_404(MOVIEHUB_ACCESS_REQUESTS_COLLECTION, {"requestId": target_id}, {"$set": {"status": "REJECTED", "rejectedBy": user["userId"], "rejectedAt": now_iso(), "updatedAt": now_iso()}})
        context["completed"] = True
        return {"message": "MovieHub access request rejected."}
    mapping = find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"mappingId": target_id, "active": True})
    if not mapping:
        context["completed"] = True
        return {"message": "MovieHub user not found."}
    try:
        delete_jellyfin_user(mapping.get("jellyfinUserId"), mapping.get("movieHubUserName"))
    except Exception as exc:
        context["completed"] = True
        return {"message": f"Failed to delete Jellyfin user: {exc}"}
    delete_one_or_404(MOVIEHUB_ACCESS_USERS_COLLECTION, {"mappingId": target_id})
    context["completed"] = True
    return {"message": "MovieHub user deleted."}


def json_response_message(result: Any, fallback: str) -> str:
    payload = result
    if isinstance(result, JSONResponse):
        try:
            payload = json.loads(result.body.decode("utf-8"))
        except Exception:
            return fallback
    response = payload.get("response") if isinstance(payload, dict) else payload
    if isinstance(response, dict):
        return response.get("message") or json.dumps(response, default=str)
    return str(response or fallback)


def yt_video_id_from_text(text: str) -> str:
    url_match = re.search(r"https?://\S+", text or "")
    if url_match:
        video_id_match = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{6,})", url_match.group(0))
        if video_id_match:
            return video_id_match.group(1)
    video_match = re.search(r"(?i)\b(?:videoId|video|id)\s*[:#-]?\s*([A-Za-z0-9_-]{6,})\b", text or "")
    if video_match:
        return video_match.group(1)
    loose = re.search(r"\b[A-Za-z0-9_-]{11}\b", text or "")
    return loose.group(0) if loose else ""


def handle_yt_chat(context: Dict[str, Any], user_input: str, user: Dict[str, str], intent: str) -> Dict[str, Any]:
    denied = require_admin_chat(user, context)
    if denied:
        return denied
    if intent == "YT_LIST_REQUESTS":
        records = sorted(find(YT_DOWNLOADS_COLLECTION, {}), key=lambda r: r.get("createdAt", ""), reverse=True)
        context["completed"] = True
        return {"message": "No YouTube requests found." if not records else "\n".join(["YouTube download requests:"] + [f"{i}. {r.get('title') or r.get('videoId')} | status={r.get('status')} | id={r.get('requestId')} | videoId={r.get('videoId')}" for i, r in enumerate(records[:15], 1)])}
    if intent == "YT_START_DOWNLOAD":
        context["completed"] = True
        return {"message": json_response_message(yt_service.start_download(), "YouTube download start requested.")}
    if intent == "YT_GET_FORMATS":
        url_match = re.search(r"https?://\S+", user_input or "")
        if not url_match:
            return {"message": "Please provide the YouTube URL to list formats."}
        result = yt_service.get_formats({"url": url_match.group(0)})
        payload = json.loads(result.body.decode("utf-8")) if isinstance(result, JSONResponse) else result
        response = payload.get("response", payload) if isinstance(payload, dict) else {}
        formats = response.get("formats") if isinstance(response, dict) else []
        context["completed"] = True
        if not formats:
            return {"message": json_response_message(result, "No YouTube formats found.")}
        return {"message": "\n".join(["YouTube formats:"] + [f"{i}. {fmt.get('label') or fmt.get('quality')} | ext={fmt.get('ext', 'mp4')}" for i, fmt in enumerate(formats[:15], 1)])}
    if intent == "YT_STATUS":
        video_id = yt_video_id_from_text(user_input)
        if not video_id:
            return {"message": "Please provide the YouTube video id to check."}
        context["completed"] = True
        return {"message": json_response_message(yt_service.get_status(video_id), "YouTube status checked.")}
    if intent == "YT_DELETE_REQUEST":
        request_id = first_uuid_or_token(user_input)
        if not request_id:
            return {"message": "Please provide the YouTube request id to delete."}
        context["completed"] = True
        return {"message": json_response_message(yt_service.delete_request(request_id), "YouTube request deleted.")}
    if intent == "YT_LIST_LIBRARY":
        result = yt_service.list_library_items(0, 15, None)
        payload = json.loads(result.body.decode("utf-8")) if isinstance(result, JSONResponse) else result
        response = payload.get("response", {}) if isinstance(payload, dict) else {}
        items = response.get("items") or []
        context["completed"] = True
        return {"message": "No YouTube library items found." if not items else "\n".join(["YouTube library items:"] + [f"{i}. {item.get('Name')} | id={item.get('Id')}" for i, item in enumerate(items[:15], 1)])}
    if intent == "YT_DELETE_LIBRARY_ITEM":
        item_id = first_uuid_or_token(user_input)
        if not item_id:
            return {"message": "Please provide the YouTube library item id to delete."}
        context["completed"] = True
        return {"message": json_response_message(yt_service.delete_library_item(item_id), "YouTube library item deleted.")}
    url_match = re.search(r"https?://\S+", user_input or "")
    video_id = yt_video_id_from_text(user_input)
    quality = infer_quality(user_input) or "1080p"
    if not video_id:
        return {"message": "Please provide a YouTube URL or video id to queue."}
    result = yt_service.add_download({"videoId": video_id, "url": url_match.group(0) if url_match else "", "format": {"quality": quality, "ext": "mp4"}}, user)
    context["completed"] = True
    return {"message": json_response_message(result, "YouTube download queued.")}


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
            parsed = openai_json(f"Classify this MovieHub assistant intent as one of {sorted(CHAT_INTENTS)} or UNKNOWN. Return JSON {{\"intent\":string}}. Input: {user_input}") or {}
            intent = parsed.get("intent") if parsed.get("intent") in CHAT_INTENTS else "UNKNOWN"
        if intent == "UNKNOWN":
            return chat_success({"message": "I'm not sure I understood that. You can ask me to download or request a movie/TV show."})
        context["intent"] = intent
    try:
        if intent in {"DOWNLOAD_MEDIA", "RAISE_REQUEST"}:
            response = handle_add_media_chat(context, user_input, user, intent)
        elif intent == "SEARCH_MEDIA":
            response = handle_search_chat(context, user_input)
        elif intent == "LIST_AVAILABLE":
            response = handle_available_list_chat(context, user_input)
        elif intent == "CHECK_MEDIA_EXISTS":
            response = handle_exists_chat(context, user_input)
        elif intent == "DELETE_MEDIA":
            if not admin_route and user.get("role", "").upper() != "ADMIN":
                context["completed"] = True
                response = {"message": "Deleting media is admin-only."}
            else:
                response = handle_delete_chat(context, user_input)
        elif intent in {"CHECK_DOWNLOAD_STATUS", "LIST_DOWNLOADS"}:
            response = handle_status_chat(context, user_input, user, intent)
        elif intent in {"LIST_REQUESTS", "APPROVE_REQUEST", "DELETE_REQUEST"}:
            response = handle_request_admin_chat(context, user_input, user, intent)
        elif intent in {"PAUSE_DOWNLOADS", "RESUME_DOWNLOADS", "DELETE_DOWNLOAD"}:
            response = handle_download_admin_chat(context, user_input, user, intent)
        elif intent in {"ACCESS_REQUEST", "ACCESS_LIST_REQUESTS", "ACCESS_APPROVE_REQUEST", "ACCESS_REJECT_REQUEST", "ACCESS_LIST_USERS", "ACCESS_DELETE_USER", "ACCESS_RESEND_PASSWORD", "ACCESS_CONFIRM_PASSWORD"}:
            response = handle_access_chat(context, user_input, user, intent)
        elif intent in {"YT_ADD_DOWNLOAD", "YT_GET_FORMATS", "YT_START_DOWNLOAD", "YT_LIST_REQUESTS", "YT_STATUS", "YT_DELETE_REQUEST", "YT_LIST_LIBRARY", "YT_DELETE_LIBRARY_ITEM"}:
            response = handle_yt_chat(context, user_input, user, intent)
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
