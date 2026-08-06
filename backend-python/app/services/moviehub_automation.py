import json
import os
import re
import time
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import bcrypt
import jwt
import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import MEDIA_REQUESTS_COLLECTION
from app.services.mail import send_brevo_email
from app.services.mongo import col, find_one, insert, update_one_or_404
from app.utils.http import api_headers, base_url
from app.utils.responses import now_iso

def parse_media_type(value: Optional[str]) -> str:
    raw = (value or "").upper()
    if raw in {"MOVIE", "MOVIES"}:
        return "MOVIES"
    if raw in {"SHOW", "SHOWS", "SERIES"}:
        return "SHOWS"
    return "UNKNOWN"


def get_poster(item: Dict[str, Any]) -> str:
    poster = item.get("remotePoster")
    if isinstance(poster, str) and poster.strip():
        return poster
    for image in item.get("images") or []:
        if not isinstance(image, dict):
            continue
        if str(image.get("coverType") or "").lower() == "poster":
            remote_url = image.get("remoteUrl")
            if isinstance(remote_url, str) and remote_url.strip():
                return remote_url
    return ""


def sorted_unique_positive_numbers(values: Iterable[Any]) -> List[int]:
    numbers = set()
    for value in values:
        try:
            number = int(value)
        except (TypeError, ValueError):
            continue
        if number > 0:
            numbers.add(number)
    return sorted(numbers)


def normalize_season_numbers(value: Any) -> List[int]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return sorted_unique_positive_numbers(value)
    return sorted_unique_positive_numbers([value])


def get_season_options(item: Dict[str, Any]) -> List[int]:
    return sorted_unique_positive_numbers(
        season.get("seasonNumber")
        for season in item.get("seasons") or []
        if isinstance(season, dict)
    )


def get_available_seasons(item: Dict[str, Any]) -> List[int]:
    available = []
    for season in item.get("seasons") or []:
        if not isinstance(season, dict):
            continue
        statistics = season.get("statistics") or {}
        if not isinstance(statistics, dict):
            statistics = {}
        try:
            file_count = int(statistics.get("episodeFileCount") or 0)
        except (TypeError, ValueError):
            file_count = 0
        if file_count > 0:
            available.append(season.get("seasonNumber"))
    return sorted_unique_positive_numbers(available)


def normalize_moviehub_lookup_item(item: Dict[str, Any], media_type: str) -> Dict[str, Any]:
    normalized = {
        "title": item.get("title"),
        "year": item.get("year"),
        "overview": item.get("overview"),
        "imdbId": item.get("imdbId"),
        "poster": get_poster(item),
        "mediaType": media_type,
    }
    if media_type == "MOVIES":
        normalized["tmdbId"] = item.get("tmdbId")
    else:
        normalized["tvdbId"] = item.get("tvdbId")
        normalized["seasonOptions"] = get_season_options(item)
    return normalized


def normalize_moviehub_lookup_results(items: Any, media_type: str) -> List[Dict[str, Any]]:
    if not isinstance(items, list):
        return []
    return [
        normalize_moviehub_lookup_item(item, media_type)
        for item in items
        if isinstance(item, dict)
    ]


def normalize_available_movie(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": item.get("title"),
        "year": item.get("year"),
        "overview": item.get("overview"),
        "poster": get_poster(item),
        "mediaType": "MOVIES",
        "hasFile": bool(item.get("hasFile", False)),
        "qualityProfileId": item.get("qualityProfileId"),
        "path": item.get("path"),
        "imdbId": item.get("imdbId"),
        "tmdbId": item.get("tmdbId"),
        "added": item.get("added"),
        "radarrId": item.get("id"),
    }


def normalize_available_show(item: Dict[str, Any]) -> Dict[str, Any]:
    statistics = item.get("statistics") or {}
    if not isinstance(statistics, dict):
        statistics = {}
    return {
        "title": item.get("title"),
        "year": item.get("year"),
        "overview": item.get("overview"),
        "poster": get_poster(item),
        "mediaType": "SHOWS",
        "qualityProfileId": item.get("qualityProfileId"),
        "path": item.get("path"),
        "imdbId": item.get("imdbId"),
        "tvdbId": item.get("tvdbId"),
        "added": item.get("added"),
        "sonarrId": item.get("id"),
        "episodeFileCount": statistics.get("episodeFileCount", 0),
        "episodeCount": statistics.get("episodeCount", 0),
        "totalEpisodeCount": statistics.get("totalEpisodeCount", 0),
        "percentOfEpisodes": statistics.get("percentOfEpisodes", 0.0),
        "availableSeasons": get_available_seasons(item),
    }


def normalize_available_media(items: Any, media_type: str) -> List[Dict[str, Any]]:
    if not isinstance(items, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if media_type == "MOVIES":
            if not bool(item.get("hasFile", False)):
                continue
            normalized.append(normalize_available_movie(item))
        else:
            statistics = item.get("statistics") or {}
            if not isinstance(statistics, dict):
                statistics = {}
            try:
                episode_file_count = int(statistics.get("episodeFileCount") or 0)
            except (TypeError, ValueError):
                episode_file_count = 0
            if episode_file_count <= 0:
                continue
            normalized.append(normalize_available_show(item))
    return sorted(normalized, key=lambda entry: str(entry.get("title") or "").lower())


QUALITY_PROFILE_MAP = {
    "any": 1,
    "720": 3,
    "720p": 3,
    "1080": 4,
    "1080p": 4,
    "4k": 5,
    "2160p": 5,
    "uhd": 5,
    "ultra-hd": 5,
}


def parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def normalize_quality_profile(value: Any) -> str:
    raw = str(value or "any").strip().lower()
    return raw if raw in {"any", "720p", "1080p", "4k"} else "any"


def quality_profile_id(value: Any) -> int:
    return QUALITY_PROFILE_MAP.get(str(value or "any").strip().lower(), 1)


def normalize_title_for_match(title: Any) -> str:
    normalized = str(title or "")
    normalized = re.sub(r"(?i)\[[^\]]*\]", " ", normalized)
    normalized = re.sub(r"(?i)\([^)]*\)", " ", normalized)
    normalized = re.sub(r"(?i)\bS\d{1,2}(E\d{1,2})?\b.*", " ", normalized)
    normalized = re.sub(r"(?i)\b\d{3,4}p\b.*", " ", normalized)
    normalized = normalized.lower()
    normalized = re.sub(r"[^a-z0-9]+", "", normalized)
    return normalized.strip()


def titles_likely_match(queue_title: str, request_title: str) -> bool:
    if not queue_title or not request_title:
        return False
    if len(request_title) <= 2:
        return queue_title == request_title or queue_title.startswith(request_title)
    return request_title in queue_title


def arr_get(method: str, url: str, api_key: str, **kwargs) -> requests.Response:
    return requests.request(method, url, headers=api_headers(api_key or ""), timeout=60, **kwargs)


def get_arr_json(method: str, url: str, api_key: str, **kwargs) -> Any:
    res = arr_get(method, url, api_key, **kwargs)
    if res.status_code < 200 or res.status_code >= 300:
        raise RuntimeError(res.text or f"{method} {url} failed with status {res.status_code}")
    if not res.text:
        return {}
    return res.json()


def wait_for_sonarr_series_ready(base: str, api_key: str, series_id: int, requested_seasons: List[int]) -> Dict[str, Any]:
    deadline = time.monotonic() + 30
    last_series: Dict[str, Any] = {}
    requested = set(sorted_unique_positive_numbers(requested_seasons))
    while time.monotonic() < deadline:
        series = get_arr_json("GET", f"{base}/series/{series_id}", api_key)
        if isinstance(series, dict):
            last_series = series
            seasons = [season for season in series.get("seasons") or [] if isinstance(season, dict)]
            available_seasons = {parse_int(season.get("seasonNumber")) for season in seasons}
            has_requested_seasons = not requested or requested.issubset(available_seasons)
            has_episode_metadata = any(
                (parse_int((season.get("statistics") or {}).get("episodeCount")) or 0) > 0
                for season in seasons
            )
            if seasons and has_requested_seasons and has_episode_metadata:
                return series
        time.sleep(1.5)
    if last_series:
        return last_series
    raise RuntimeError("Sonarr series was added but could not be fetched for search")


def delete_show_seasons(series_id: int, seasons: List[int], delete_files: bool) -> Dict[str, Any]:
    base = base_url("SONARR_API_URL")
    key = os.getenv("SONARR_API_KEY") or ""
    series = get_arr_json("GET", f"{base}/series/{series_id}", key)
    if not isinstance(series, dict):
        raise RuntimeError("Unable to fetch show from Sonarr")

    available_seasons = {
        parse_int(season.get("seasonNumber"))
        for season in series.get("seasons") or []
        if isinstance(season, dict)
    }
    missing = [season for season in seasons if season not in available_seasons]
    if missing:
        raise ValueError("season does not exist for this show: " + ", ".join(str(season) for season in missing))

    changed_monitoring = False
    for season in series.get("seasons") or []:
        if not isinstance(season, dict):
            continue
        if parse_int(season.get("seasonNumber")) in seasons and season.get("monitored") is not False:
            season["monitored"] = False
            changed_monitoring = True
    if changed_monitoring:
        get_arr_json("PUT", f"{base}/series/{series_id}", key, json=series)

    episode_file_ids_for_seasons: List[int] = []
    deleted_file_ids: List[int] = []
    for season in seasons:
        episodes = get_arr_json("GET", f"{base}/episode", key, params={"seriesId": series_id, "seasonNumber": season})
        if not isinstance(episodes, list):
            continue
        episode_file_ids = sorted_unique_positive_numbers(
            episode.get("episodeFileId")
            for episode in episodes
            if isinstance(episode, dict)
        )
        for episode_file_id in episode_file_ids:
            if episode_file_id in episode_file_ids_for_seasons:
                continue
            episode_file_ids_for_seasons.append(episode_file_id)
            if delete_files:
                get_arr_json("DELETE", f"{base}/episodefile/{episode_file_id}", key)
                deleted_file_ids.append(episode_file_id)

    return {
        "mediaType": "SHOWS",
        "id": series_id,
        "season": seasons,
        "deleteFiles": delete_files,
        "episodeFileIds": episode_file_ids_for_seasons,
        "deletedEpisodeFileIds": deleted_file_ids,
        "message": "Season deleted successfully" if len(seasons) == 1 else "Seasons deleted successfully",
    }


def fetch_arr_available(media_type: str) -> List[Dict[str, Any]]:
    base = base_url("RADARR_API_URL") if media_type == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if media_type == "MOVIES" else os.getenv("SONARR_API_KEY")
    path = "movie" if media_type == "MOVIES" else "series"
    data = get_arr_json("GET", f"{base}/{path}", key or "")
    return normalize_available_media(data, media_type)


def validate_availability_before_create(media_type: str, title: str, seasons: List[int]) -> Optional[str]:
    available = fetch_arr_available(media_type)
    if media_type == "MOVIES":
        for movie in available:
            if str(movie.get("title") or "").strip().lower() == title.strip().lower():
                return "Movie already available in library"
        return None
    matching = next((show for show in available if str(show.get("title") or "").strip().lower() == title.strip().lower()), None)
    if not matching:
        return None
    available_seasons = {int(season) for season in matching.get("availableSeasons") or [] if parse_int(season)}
    if available_seasons and seasons and all(season in available_seasons for season in seasons):
        return "Selected season(s) already available for this series: " + ", ".join(str(season) for season in sorted(seasons))
    return None


def select_lookup_result(items: Any, body: Dict[str, Any], media_type: str) -> Optional[Dict[str, Any]]:
    if not isinstance(items, list) or not items:
        return None
    id_key = "tmdbId" if media_type == "MOVIES" else "tvdbId"
    requested_id = parse_int(body.get(id_key))
    if requested_id is not None:
        return next((item for item in items if isinstance(item, dict) and parse_int(item.get(id_key)) == requested_id), None)
    imdb_id = str(body.get("imdbId") or "").strip()
    if imdb_id:
        return next((item for item in items if isinstance(item, dict) and str(item.get("imdbId") or "").lower() == imdb_id.lower()), None)
    return next((item for item in items if isinstance(item, dict)), None)


def lookup_arr_media(title: str, media_type: str, body: Dict[str, Any]) -> Dict[str, Any]:
    base = base_url("RADARR_API_URL") if media_type == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if media_type == "MOVIES" else os.getenv("SONARR_API_KEY")
    path = "movie/lookup" if media_type == "MOVIES" else "series/lookup"
    items = get_arr_json("GET", f"{base}/{path}", key or "", params={"term": title})
    selected = select_lookup_result(items, body, media_type)
    if not selected:
        raise RuntimeError("Unable to resolve the requested media from lookup results")
    return selected


def queue_media_download(request_record: Dict[str, Any]) -> None:
    media_type = parse_media_type(request_record.get("mediaType"))
    title = str(request_record.get("title") or "").strip()
    lookup = lookup_arr_media(title, media_type, request_record)
    quality = request_record.get("qualityProfileId") or "any"
    if media_type == "MOVIES":
        base = base_url("RADARR_API_URL")
        key = os.getenv("RADARR_API_KEY") or ""
        payload = {
            "title": lookup.get("title"),
            "qualityProfileId": quality_profile_id(quality),
            "rootFolderPath": "/data/uhdmovies" if str(quality).lower() in {"4k", "2160p", "uhd", "ultra-hd"} else "/data/movies",
            "monitored": True,
            "addOptions": {"searchForMovie": True},
            "tmdbId": lookup.get("tmdbId"),
            "minimumAvailability": "released",
        }
        get_arr_json("POST", f"{base}/movie", key, json=payload)
        return

    base = base_url("SONARR_API_URL")
    key = os.getenv("SONARR_API_KEY") or ""
    tvdb_id = lookup.get("tvdbId")
    series = get_arr_json("GET", f"{base}/series", key)
    existing = next((item for item in series if isinstance(item, dict) and item.get("tvdbId") == tvdb_id), None) if isinstance(series, list) else None
    series_id = existing.get("id") if existing else None
    requested_seasons = sorted_unique_positive_numbers(request_record.get("season") or [])
    if series_id is None:
        payload = {
            "title": lookup.get("title"),
            "qualityProfileId": quality_profile_id(quality),
            "rootFolderPath": "/tv",
            "monitored": True,
            "addOptions": {
                "monitor": "all",
                "searchForMissingEpisodes": False,
                "searchForCutoffUnmetEpisodes": False,
            },
            "tvdbId": tvdb_id,
            "seasonFolder": True,
        }
        added = get_arr_json("POST", f"{base}/series", key, json=payload)
        series_id = added.get("id") if isinstance(added, dict) else None
    if not series_id:
        raise RuntimeError("Unable to add this show")
    if series_id is not None:
        wait_for_sonarr_series_ready(base, key, int(series_id), requested_seasons)
    if requested_seasons:
        for season in requested_seasons:
            get_arr_json("POST", f"{base}/command", key, json={"name": "SeasonSearch", "seasonNumber": season, "seriesId": series_id})
    else:
        get_arr_json("POST", f"{base}/command", key, json={"name": "SeriesSearch", "seriesId": series_id})


def fetch_queue_records(media_type: str) -> List[Dict[str, Any]]:
    base = base_url("RADARR_API_URL") if media_type == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if media_type == "MOVIES" else os.getenv("SONARR_API_KEY")
    unknown_param = "includeUnknownMovieItems" if media_type == "MOVIES" else "includeUnknownSeriesItems"
    payload = get_arr_json("GET", f"{base}/queue", key or "", params={
        "page": 1,
        "pageSize": 250,
        "sortDirection": "ascending",
        "sortKey": "timeleft",
        unknown_param: "true",
    })
    return payload.get("records", []) if isinstance(payload, dict) and isinstance(payload.get("records"), list) else []


def calculate_progress(size: Optional[int], size_left: Optional[int]) -> float:
    if not size or size <= 0 or size_left is None:
        return 0.0
    downloaded = max(0, size - size_left)
    return min(100.0, max(0.0, downloaded / float(size) * 100.0))


def normalize_queue_records(records: List[Dict[str, Any]], media_type: str) -> List[Dict[str, Any]]:
    by_download_id: Dict[str, Dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        key = str(record.get("downloadId") or record.get("id") or "")
        size = parse_int(record.get("size")) or 0
        size_left = parse_int(record.get("sizeleft")) or 0
        normalized = by_download_id.setdefault(key, {
            "queueItemId": record.get("id"),
            "downloadId": record.get("downloadId"),
            "title": record.get("title") or "Unknown title",
            "mediaType": media_type,
            "status": record.get("status"),
            "trackedDownloadStatus": record.get("trackedDownloadStatus"),
            "trackedDownloadState": record.get("trackedDownloadState"),
            "protocol": record.get("protocol"),
            "downloadClient": record.get("downloadClient"),
            "indexer": record.get("indexer"),
            "timeleft": record.get("timeleft"),
            "added": record.get("added"),
            "estimatedCompletionTime": record.get("estimatedCompletionTime"),
            "size": size,
            "sizeleft": size_left,
            "progressPercent": calculate_progress(size, size_left),
        })
        if media_type == "SHOWS":
            normalized.setdefault("seasonNumbers", [])
            normalized.setdefault("episodeCount", 0)
            season_number = parse_int(record.get("seasonNumber"))
            if season_number and season_number > 0 and season_number not in normalized["seasonNumbers"]:
                normalized["seasonNumbers"].append(season_number)
            normalized["episodeCount"] += 1
    return list(by_download_id.values())


def combined_queue_records() -> List[Dict[str, Any]]:
    try:
        get_arr_json("POST", f"{base_url('RADARR_API_URL')}/command", os.getenv("RADARR_API_KEY") or "", json={"name": "RefreshMonitoredDownloads"})
    except Exception:
        pass
    try:
        get_arr_json("POST", f"{base_url('SONARR_API_URL')}/command", os.getenv("SONARR_API_KEY") or "", json={"name": "RefreshMonitoredDownloads"})
    except Exception:
        pass
    combined = normalize_queue_records(fetch_queue_records("MOVIES"), "MOVIES") + normalize_queue_records(fetch_queue_records("SHOWS"), "SHOWS")
    return sorted(combined, key=lambda item: str(item.get("added") or ""), reverse=True)


def queue_matches_request(queue_item: Dict[str, Any], request_record: Dict[str, Any]) -> bool:
    if parse_media_type(queue_item.get("mediaType")) != parse_media_type(request_record.get("mediaType")):
        return False
    queue_title = normalize_title_for_match(queue_item.get("title"))
    request_title = normalize_title_for_match(request_record.get("title"))
    if not titles_likely_match(queue_title, request_title):
        return False
    if parse_media_type(queue_item.get("mediaType")) == "SHOWS":
        request_seasons = set(sorted_unique_positive_numbers(request_record.get("season") or []))
        queue_seasons = set(sorted_unique_positive_numbers(queue_item.get("seasonNumbers") or []))
        if request_seasons and queue_seasons and not request_seasons.intersection(queue_seasons):
            return False
    return True


def download_handling_state(radarr_config: Optional[Dict[str, Any]], sonarr_config: Optional[Dict[str, Any]], status_known: bool) -> Dict[str, Any]:
    radarr_enabled = None if not radarr_config else radarr_config.get("enableCompletedDownloadHandling", radarr_config.get("EnableCompletedDownloadHandling"))
    sonarr_enabled = None if not sonarr_config else sonarr_config.get("enableCompletedDownloadHandling", sonarr_config.get("EnableCompletedDownloadHandling"))
    paused = (radarr_enabled is not None and not bool(radarr_enabled)) or (sonarr_enabled is not None and not bool(sonarr_enabled))
    partially_paused = radarr_enabled is not None and sonarr_enabled is not None and bool(radarr_enabled) != bool(sonarr_enabled)
    return {"statusKnown": status_known, "paused": paused, "partiallyPaused": partially_paused, "radarrEnabled": radarr_enabled, "sonarrEnabled": sonarr_enabled}


def fetch_download_handling_state() -> Dict[str, Any]:
    try:
        radarr = get_arr_json("GET", f"{base_url('RADARR_API_URL')}/config/downloadclient", os.getenv("RADARR_API_KEY") or "")
        sonarr = get_arr_json("GET", f"{base_url('SONARR_API_URL')}/config/downloadclient", os.getenv("SONARR_API_KEY") or "")
        return download_handling_state(radarr if isinstance(radarr, dict) else {}, sonarr if isinstance(sonarr, dict) else {}, True)
    except Exception:
        return download_handling_state(None, None, False)


def set_download_handling_enabled(enabled: bool) -> Dict[str, Any]:
    configs = []
    for env_base, env_key in [("RADARR_API_URL", "RADARR_API_KEY"), ("SONARR_API_URL", "SONARR_API_KEY")]:
        base = base_url(env_base)
        key = os.getenv(env_key) or ""
        config = get_arr_json("GET", f"{base}/config/downloadclient", key)
        if not isinstance(config, dict):
            raise RuntimeError("download client config response was empty")
        config["EnableCompletedDownloadHandling"] = enabled
        config["enableCompletedDownloadHandling"] = enabled
        config_id = config.get("id") or 1
        configs.append(get_arr_json("PUT", f"{base}/config/downloadclient/{config_id}", key, json=config))
    return download_handling_state(configs[0], configs[1], True)


def completed_download_record(record: Dict[str, Any], include_requester: bool) -> Dict[str, Any]:
    mapped = {
        "requestId": record.get("requestId"),
        "title": record.get("title") or "Unknown title",
        "mediaType": record.get("mediaType") or "UNKNOWN",
        "qualityProfileId": record.get("qualityProfileId") or "any",
        "season": record.get("season") or [],
        "status": record.get("status") or "DOWNLOADED",
        "createdAt": record.get("createdAt"),
        "approvedAt": record.get("approvedAt"),
        "downloadedAt": record.get("downloadedAt"),
        "detectedCompleted": bool(record.get("detectedCompleted", False)),
    }
    if include_requester:
        mapped["requestedBy"] = {"userId": record.get("userId"), "userName": record.get("userName"), "userEmail": record.get("userEmail")}
    return mapped


def media_type_label(media_type: str) -> str:
    if media_type == "SHOWS":
        return "Series"
    if media_type == "MOVIES":
        return "Movie"
    return "Media"


def quality_label(quality_profile: Any) -> str:
    value = str(quality_profile or "").strip().lower()
    return {"720p": "HD 720p", "1080p": "HD 1080p", "4k": "Ultra HD 4K"}.get(value, "Any")


def format_seasons(seasons: Iterable[Any]) -> str:
    values = sorted_unique_positive_numbers(seasons or [])
    if not values:
        return "All monitored seasons"
    return ", ".join(str(season) for season in values)


def resolve_poster_for_request(record: Dict[str, Any]) -> str:
    title = (record.get("title") or "").strip()
    media_type = parse_media_type(record.get("mediaType"))
    if not title or media_type == "UNKNOWN":
        return ""
    try:
        for option in lookup_options(title, media_type, 5):
            if normalize_title_for_match(option.get("title")) == normalize_title_for_match(title):
                return option.get("poster") or ""
        options = lookup_options(title, media_type, 1)
        return (options[0].get("poster") if options else "") or ""
    except Exception:
        return ""


def lookup_options(title: str, media_type: str, limit: int = 5) -> List[Dict[str, Any]]:
    base = base_url("RADARR_API_URL") if media_type == "MOVIES" else base_url("SONARR_API_URL")
    key = os.getenv("RADARR_API_KEY") if media_type == "MOVIES" else os.getenv("SONARR_API_KEY")
    path = "movie/lookup" if media_type == "MOVIES" else "series/lookup"
    data = get_arr_json("GET", f"{base}/{path}", key or "", params={"term": title})
    return normalize_moviehub_lookup_results(data, media_type)[:limit]


def build_media_status_email(record: Dict[str, Any], heading: str, lead_text: str, status_badge: str, poster_url: str = "") -> str:
    safe_heading = escape(heading)
    safe_lead = escape(lead_text)
    safe_badge = escape(status_badge)
    safe_title = escape(record.get("title") or "")
    safe_type = escape(media_type_label(parse_media_type(record.get("mediaType"))))
    safe_quality = escape(quality_label(record.get("qualityProfileId")))
    safe_poster = escape(poster_url or "")
    poster_block = ""
    if safe_poster:
        poster_block = f"""
                            <tr>
                              <td style="padding: 24px 24px 8px 24px; text-align: center;">
                                <img src="{safe_poster}" alt="{safe_title} poster" style="width: 180px; max-width: 100%; height: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.22);" />
                              </td>
                            </tr>
"""
    season_row = ""
    if parse_media_type(record.get("mediaType")) == "SHOWS":
        season_row = f"""
                            <tr>
                              <td style="padding: 0 24px 12px 24px; font-size: 14px; color: #c3c7e5;">
                                <strong style="color: #ffffff;">Seasons:</strong> {escape(format_seasons(record.get("season") or []))}
                              </td>
                            </tr>
"""
    return f"""
<html>
  <body style="margin:0; padding:0; background:#070d22; font-family: 'Segoe UI', Arial, sans-serif; color:#e8ecff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070d22; padding: 24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px; max-width:92%; border-radius:18px; overflow:hidden; border:1px solid #243050; background:linear-gradient(180deg, #0f1a3a 0%, #0a1126 100%);">
            <tr><td style="padding: 20px 24px 8px 24px;"><span style="display:inline-block; padding:6px 12px; border-radius:999px; background:linear-gradient(90deg, #3674ff, #8a38ff); font-size:12px; font-weight:700; letter-spacing:0.3px;">{safe_badge}</span></td></tr>
            <tr><td style="padding: 0 24px 6px 24px; font-size: 28px; line-height: 1.2; color: #ffffff; font-weight: 700;">{safe_heading}</td></tr>
            <tr><td style="padding: 0 24px 8px 24px; font-size: 15px; line-height: 1.55; color: #c3c7e5;">{safe_lead}</td></tr>
            {poster_block}
            <tr><td style="padding: 8px 24px 12px 24px; font-size: 14px; color: #c3c7e5;"><strong style="color: #ffffff;">Title:</strong> {safe_title}</td></tr>
            <tr><td style="padding: 0 24px 12px 24px; font-size: 14px; color: #c3c7e5;"><strong style="color: #ffffff;">Type:</strong> {safe_type}</td></tr>
            <tr><td style="padding: 0 24px 12px 24px; font-size: 14px; color: #c3c7e5;"><strong style="color: #ffffff;">Quality:</strong> {safe_quality}</td></tr>
            {season_row}
            <tr><td style="padding: 16px 24px 24px 24px; font-size: 12px; color: #9aa3c7;">Sent by ToolHub MovieHub Automation</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def send_media_downloaded_email_if_needed(record: Dict[str, Any]) -> bool:
    if record.get("downloadedNotificationSentAt"):
        return False
    email = (record.get("userEmail") or "").strip()
    if not email:
        return False
    poster = resolve_poster_for_request(record)
    html_body = build_media_status_email(
        record,
        "Download Completed",
        "Your requested media is now downloaded and available on your server.",
        "Downloaded",
        poster,
    )
    send_brevo_email(f"Download completed: {record.get('title')}", email, html_body)
    update_one_or_404(MEDIA_REQUESTS_COLLECTION, {"requestId": record.get("requestId")}, {"$set": {"downloadedNotificationSentAt": now_iso(), "updatedAt": now_iso()}})
    return True


def send_media_approval_email(record: Dict[str, Any]) -> bool:
    email = (record.get("userEmail") or "").strip()
    if not email:
        raise RuntimeError("recipient email is missing for approval notification")
    poster = resolve_poster_for_request(record)
    html_body = build_media_status_email(
        record,
        "Request Approved",
        "Your request was approved and has been queued for download.",
        "Approved",
        poster,
    )
    send_brevo_email(f"Request approved: {record.get('title')}", email, html_body)
    col(MEDIA_REQUESTS_COLLECTION).update_one({"requestId": record.get("requestId")}, {"$set": {"notificationSentAt": now_iso(), "updatedAt": now_iso()}})
    return True


def db_user_for(user_id: str) -> Dict[str, Any]:
    return find_one("users", {"userId": user_id}) or {}


def build_media_request_record(user_id: str, payload: Dict[str, Any], status: str) -> Dict[str, Any]:
    db_user = db_user_for(user_id)
    media_type = parse_media_type(payload.get("mediaType"))
    return {
        "requestId": str(uuid.uuid4()),
        "userId": user_id,
        "userEmail": db_user.get("email", ""),
        "userName": db_user.get("name", db_user.get("userName", "")),
        "title": str(payload.get("title") or "").strip(),
        "mediaType": media_type,
        "tmdbId": payload.get("tmdbId"),
        "tvdbId": payload.get("tvdbId"),
        "imdbId": payload.get("imdbId"),
        "qualityProfileId": normalize_quality_profile(payload.get("qualityProfileId") or payload.get("quality")),
        "season": sorted_unique_positive_numbers(payload.get("season") or []),
        "status": status,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }


def create_request_from_automation(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    record = build_media_request_record(user_id, payload, "PENDING")
    conflict = validate_availability_before_create(record["mediaType"], record["title"], record["season"])
    if conflict:
        raise RuntimeError(conflict)
    insert(MEDIA_REQUESTS_COLLECTION, record)
    return record


def create_approved_request_from_automation(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    record = build_media_request_record(user_id, payload, "APPROVED")
    conflict = validate_availability_before_create(record["mediaType"], record["title"], record["season"])
    if conflict:
        raise RuntimeError(conflict)
    queue_media_download(record)
    record["approvedBy"] = user_id
    record["approvedAt"] = now_iso()
    insert(MEDIA_REQUESTS_COLLECTION, record)
    try:
        send_media_approval_email(record)
        record["notification"] = "sent"
    except Exception:
        record["notification"] = "failed"
    return record
