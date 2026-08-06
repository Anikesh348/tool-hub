import gzip
import logging
import math
import os
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests
from pymongo import ReplaceOne, UpdateOne

from app.core.config import (
    BUZZWATCH_ITEMS_COLLECTION,
    BUZZWATCH_META_COLLECTION,
    BUZZWATCH_PREFERENCES_COLLECTION,
    MOVIEHUB_ACCESS_USERS_COLLECTION,
)
from app.services.mongo import col, find_one
from app.services.moviehub_automation import create_approved_request_from_automation, create_request_from_automation
from app.utils.responses import jsonable, now_iso
from app.services.redis_cache import cache_add, cache_delete, cache_delete_pattern, cache_get, cache_set, cache_token

logger = logging.getLogger("uvicorn.error")

TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
TMDB_API_BASE = "https://api.themoviedb.org/3"
OMDB_API_BASE = "https://www.omdbapi.com/"
ROTTEN_TOMATOES_BASE = "https://www.rottentomatoes.com"
MIN_RT_SCORE = int(os.getenv("BUZZWATCH_MIN_RT_SCORE", "70"))
MIN_TMDB_SCORE = float(os.getenv("BUZZWATCH_MIN_TMDB_SCORE", "7.0"))
MAX_CANDIDATES = int(os.getenv("BUZZWATCH_MAX_CANDIDATES", "90"))
RECENT_DAYS = int(os.getenv("BUZZWATCH_RECENT_DAYS", "120"))
LATEST_WINDOW_DAYS = int(os.getenv("BUZZWATCH_LATEST_WINDOW_DAYS", "30"))
WATCH_REGION = os.getenv("BUZZWATCH_WATCH_REGION", "IN").strip().upper() or "IN"
LATEST_PER_PROVIDER_LIMIT = int(os.getenv("BUZZWATCH_LATEST_PER_PROVIDER_LIMIT", "12"))
LATEST_REFRESH_WORKERS = int(os.getenv("BUZZWATCH_LATEST_WORKERS", "12"))
LATEST_CATALOG_SCOPE = "latest-streaming"
LATEST_SOURCE_VERSION = 1
YEAR_RESULT_TARGET = int(os.getenv("BUZZWATCH_YEAR_RESULT_TARGET", "30"))
RT_CNAPI_PAGES = int(os.getenv("BUZZWATCH_RT_CNAPI_PAGES", "4"))
RT_CNAPI_GENRE_PAGES = int(os.getenv("BUZZWATCH_RT_CNAPI_GENRE_PAGES", "2"))
RT_YEAR_ENRICH_SCAN_LIMIT = int(os.getenv("BUZZWATCH_RT_YEAR_ENRICH_SCAN_LIMIT", "160"))
RT_DETAIL_TIMEOUT = int(os.getenv("BUZZWATCH_RT_DETAIL_TIMEOUT", "12"))
RT_DETAIL_WORKERS = int(os.getenv("BUZZWATCH_RT_DETAIL_WORKERS", "12"))
STATIC_YEAR_START = int(os.getenv("BUZZWATCH_YEAR_START", "1980"))
IMDB_DATASET_BASE = "https://datasets.imdbws.com"
IMDB_SUGGESTION_BASE = "https://v2.sg.media-imdb.com/suggestion/x"
IMDB_DATA_DIR = os.getenv("BUZZWATCH_DATA_DIR", "/data/buzzwatch")
IMDB_DATA_MAX_AGE_HOURS = int(os.getenv("BUZZWATCH_IMDB_CACHE_HOURS", "24"))
IMDB_YEAR_TARGET_PER_TYPE = int(os.getenv("BUZZWATCH_IMDB_YEAR_TARGET_PER_TYPE", "60"))
IMDB_POSTER_WORKERS = int(os.getenv("BUZZWATCH_IMDB_POSTER_WORKERS", "12"))
IMDB_SOURCE = "IMDb public datasets"
IMDB_SOURCE_VERSION = 4
HYBRID_SOURCE = "TMDB + IMDb hybrid"
HYBRID_SOURCE_VERSION = 3
TMDB_YEAR_TARGET_PER_TYPE = int(os.getenv("BUZZWATCH_TMDB_YEAR_TARGET_PER_TYPE", "60"))
TMDB_DISCOVER_PAGES = int(os.getenv("BUZZWATCH_TMDB_DISCOVER_PAGES", "5"))
YEAR_CACHE_TTL_HOURS = int(os.getenv("BUZZWATCH_YEAR_CACHE_TTL_HOURS", "720"))
PERSON_CREDITS_CACHE_TTL_HOURS = int(os.getenv("BUZZWATCH_PERSON_CACHE_TTL_HOURS", "24"))
TITLE_DETAILS_CACHE_TTL_HOURS = int(os.getenv("BUZZWATCH_DETAILS_CACHE_TTL_HOURS", "24"))
RESPONSE_CACHE_VERSION = "v3"
PREFERENCE_CACHE_SECONDS = int(os.getenv("BUZZWATCH_PREFERENCE_CACHE_SECONDS", "3600"))
RECENT_RESPONSE_CACHE_SECONDS = int(os.getenv("BUZZWATCH_RECENT_CACHE_SECONDS", "900"))
YEAR_RESPONSE_CACHE_SECONDS = int(os.getenv("BUZZWATCH_YEAR_RESPONSE_CACHE_SECONDS", "604800"))
YEAR_STALE_RESPONSE_CACHE_SECONDS = int(os.getenv("BUZZWATCH_YEAR_STALE_RESPONSE_CACHE_SECONDS", "120"))
YEAR_REFRESH_LOCK_SECONDS = int(os.getenv("BUZZWATCH_YEAR_REFRESH_LOCK_SECONDS", "900"))
YEAR_WARM_COUNT = int(os.getenv("BUZZWATCH_YEAR_WARM_COUNT", "6"))
PEOPLE_SEARCH_CACHE_SECONDS = int(os.getenv("BUZZWATCH_PEOPLE_CACHE_SECONDS", "86400"))
IMDB_PARENTAL_WORKERS = int(os.getenv("BUZZWATCH_IMDB_PARENTAL_WORKERS", "12"))
IMDB_PARENTAL_GRAPHQL = "https://api.graphql.imdb.com/"
IMDB_TITLE_TYPES = {
    "movie": "movie",
    "tvMovie": "movie",
    "tvSeries": "series",
    "tvMiniSeries": "series",
}

# Ordered by broad consumer relevance. Only providers available in WATCH_REGION
# are used, so results never advertise a service that cannot stream locally.
MAJOR_STREAMING_PROVIDER_NAMES = [
    "Netflix",
    "Amazon Prime Video",
    "HBO Max",
    "Max",
    "JioHotstar",
    "Apple TV",
    "Zee5",
    "Sony Liv",
    "Discovery+",
    "Crunchyroll",
    "Lionsgate Play",
    "MUBI",
    "Sun Nxt",
    "Hoichoi",
    "Amazon MX Player",
]

GENRES: List[Dict[str, Any]] = [
    {"key": "action", "name": "Action", "movieIds": [28], "tvIds": [10759]},
    {"key": "adventure", "name": "Adventure", "movieIds": [12], "tvIds": [10759]},
    {"key": "animation", "name": "Animation", "movieIds": [16], "tvIds": [16]},
    {"key": "comedy", "name": "Comedy", "movieIds": [35], "tvIds": [35]},
    {"key": "crime", "name": "Crime", "movieIds": [80], "tvIds": [80]},
    {"key": "documentary", "name": "Documentary", "movieIds": [99], "tvIds": [99]},
    {"key": "drama", "name": "Drama", "movieIds": [18], "tvIds": [18]},
    {"key": "family", "name": "Family", "movieIds": [10751], "tvIds": [10751]},
    {"key": "fantasy", "name": "Fantasy", "movieIds": [14], "tvIds": [10765]},
    {"key": "history", "name": "History", "movieIds": [36], "tvIds": []},
    {"key": "horror", "name": "Horror", "movieIds": [27], "tvIds": []},
    {"key": "music", "name": "Music", "movieIds": [10402], "tvIds": []},
    {"key": "mystery", "name": "Mystery", "movieIds": [9648], "tvIds": [9648]},
    {"key": "romance", "name": "Romance", "movieIds": [10749], "tvIds": []},
    {"key": "sci-fi", "name": "Sci-Fi", "movieIds": [878], "tvIds": [10765]},
    {"key": "thriller", "name": "Thriller", "movieIds": [53], "tvIds": []},
    {"key": "war", "name": "War", "movieIds": [10752], "tvIds": [10768]},
    {"key": "western", "name": "Western", "movieIds": [37], "tvIds": [37]},
    {"key": "kids", "name": "Kids", "movieIds": [], "tvIds": [10762]},
    {"key": "reality", "name": "Reality", "movieIds": [], "tvIds": [10764]},
    {"key": "talk", "name": "Talk", "movieIds": [], "tvIds": [10767]},
    {"key": "steamy", "name": "Steamy", "movieIds": [], "tvIds": []},
]

MOVIE_GENRE_BY_ID = {
    genre_id: genre["name"]
    for genre in GENRES
    for genre_id in genre.get("movieIds", [])
}
TV_GENRE_BY_ID = {
    genre_id: genre["name"]
    for genre in GENRES
    for genre_id in genre.get("tvIds", [])
}
GENRE_KEY_BY_NAME = {genre["name"].lower(): genre["key"] for genre in GENRES}
ALL_GENRE_KEYS = [genre["key"] for genre in GENRES]
CATALOG_GENRES = [genre for genre in GENRES if genre["key"] != "steamy"]
CATALOG_GENRE_KEYS = [genre["key"] for genre in CATALOG_GENRES]
RT_GENRE_ALIASES = {
    "action": ["action"],
    "action & adventure": ["action", "adventure"],
    "adventure": ["adventure"],
    "animation": ["animation"],
    "anime": ["animation"],
    "comedy": ["comedy"],
    "crime": ["crime"],
    "documentary": ["documentary"],
    "drama": ["drama"],
    "entertainment": ["drama"],
    "family": ["family"],
    "kids & family": ["kids", "family"],
    "fantasy": ["fantasy"],
    "history": ["history"],
    "horror": ["horror"],
    "music": ["music"],
    "musical": ["music"],
    "mystery": ["mystery"],
    "romance": ["romance"],
    "sci-fi": ["sci-fi"],
    "science fiction": ["sci-fi"],
    "science fiction & fantasy": ["sci-fi", "fantasy"],
    "sports": ["documentary"],
    "stand-up": ["comedy"],
    "thriller": ["thriller"],
    "war": ["war"],
    "western": ["western"],
    "reality": ["reality"],
    "talk show": ["talk"],
}
RT_BROWSE_GENRE_SLUGS = {
    "action": "action",
    "adventure": "adventure",
    "animation": "animation",
    "comedy": "comedy",
    "crime": "crime",
    "documentary": "documentary",
    "drama": "drama",
    "fantasy": "fantasy",
    "history": "history",
    "horror": "horror",
    "music": "music",
    "romance": "romance",
    "sci-fi": "sci_fi",
    "war": "war",
    "western": "western",
    "reality": "reality",
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _tmdb_headers() -> Dict[str, str]:
    bearer = os.getenv("TMDB_BEARER_TOKEN", "").strip()
    if bearer:
        return {"Authorization": f"Bearer {bearer}"}
    return {}


def _tmdb_params(params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    merged = dict(params or {})
    api_key = os.getenv("TMDB_API_KEY", "").strip()
    if api_key and "Authorization" not in _tmdb_headers():
        merged["api_key"] = api_key
    return merged


def _tmdb_configured() -> bool:
    return bool(os.getenv("TMDB_API_KEY", "").strip() or os.getenv("TMDB_BEARER_TOKEN", "").strip())


def _tmdb_get(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    response = requests.get(
        f"{TMDB_API_BASE}{path}",
        params=_tmdb_params(params),
        headers=_tmdb_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def search_buzzwatch_people(query: str, limit: int = 8) -> Dict[str, Any]:
    term = str(query or "").strip()
    if len(term) < 2:
        raise ValueError("Enter at least two characters to search for an actor")
    cache_key = f"buzzwatch:{RESPONSE_CACHE_VERSION}:people:{cache_token(term.lower())}:{limit}"
    cached = cache_get(cache_key)
    if cached is not None:
        cached["cache"] = {"hit": True, "layer": "redis", "ttlSeconds": PEOPLE_SEARCH_CACHE_SECONDS}
        return cached
    if not _tmdb_configured():
        raise RuntimeError("TMDB is not configured")

    payload = _tmdb_get("/search/person", {"query": term, "include_adult": "false", "page": 1})
    people = []
    for person in payload.get("results") or []:
        known_for = person.get("known_for") or []
        if person.get("known_for_department") != "Acting" and not any(
            item.get("media_type") in {"movie", "tv"} for item in known_for
        ):
            continue
        people.append(
            {
                "personId": int(person["id"]),
                "name": person.get("name") or "Unknown",
                "profileUrl": f"{TMDB_IMAGE_BASE}{person.get('profile_path')}" if person.get("profile_path") else None,
                "knownFor": [
                    item.get("title") or item.get("name")
                    for item in known_for
                    if item.get("title") or item.get("name")
                ][:3],
                "popularity": float(person.get("popularity") or 0),
            }
        )
        if len(people) >= max(1, min(limit, 12)):
            break
    result = {
        "query": term,
        "people": people,
        "source": "TMDB",
        "cache": {"hit": False, "layer": "upstream", "ttlSeconds": PEOPLE_SEARCH_CACHE_SECONDS},
    }
    cache_set(cache_key, result, PEOPLE_SEARCH_CACHE_SECONDS)
    return result


def _normalize_person_credit(person_id: int, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    tmdb_media_type = raw.get("media_type")
    if tmdb_media_type not in {"movie", "tv"} or raw.get("adult") is True:
        return None
    tmdb_id = raw.get("id")
    title = raw.get("title") or raw.get("name")
    if not tmdb_id or not title:
        return None

    media_type = "movie" if tmdb_media_type == "movie" else "series"
    release_date = raw.get("release_date") or raw.get("first_air_date") or ""
    genres = _genre_names(tmdb_media_type, raw.get("genre_ids") or [])
    genre_keys = [GENRE_KEY_BY_NAME[name.lower()] for name in genres if name.lower() in GENRE_KEY_BY_NAME]
    vote_average = float(raw.get("vote_average") or 0)
    vote_count = int(raw.get("vote_count") or 0)
    popularity = float(raw.get("popularity") or 0)
    characters = list(
        dict.fromkeys(
            character.strip()
            for character in [str(raw.get("character") or "")]
            if character.strip()
        )
    )
    return {
        "itemId": f"tmdb-credit:{media_type}:{tmdb_id}",
        "tmdbId": int(tmdb_id),
        "title": title,
        "mediaType": media_type,
        "overview": raw.get("overview") or "",
        "posterUrl": f"{TMDB_IMAGE_BASE}{raw.get('poster_path')}" if raw.get("poster_path") else None,
        "backdropUrl": f"{TMDB_IMAGE_BASE}{raw.get('backdrop_path')}" if raw.get("backdrop_path") else None,
        "releaseDate": release_date or None,
        "releasePeriod": release_date[:7] if release_date else "unknown",
        "year": release_date[:4] if release_date else None,
        "genres": genres,
        "genreKeys": genre_keys,
        "creditCharacters": characters,
        "tmdbRating": round(vote_average, 1),
        "tmdbVoteCount": vote_count,
        "popularity": popularity,
        "buzzScore": round((vote_average * 8) + (math.log10(max(1, vote_count)) * 10) + math.log1p(popularity) * 3, 2),
        "source": "TMDB person credits",
        "externalUrl": f"https://www.themoviedb.org/{'movie' if media_type == 'movie' else 'tv'}/{tmdb_id}",
        "creditPersonIds": [person_id],
        "updatedAt": now_iso(),
    }


def _person_cache_is_fresh(person_id: int) -> bool:
    meta = col(BUZZWATCH_META_COLLECTION).find_one({"key": f"buzzwatch-person-{person_id}"}) or {}
    refreshed = meta.get("lastUpdatedAt")
    if isinstance(refreshed, str):
        try:
            refreshed = datetime.fromisoformat(refreshed.replace("Z", "+00:00"))
        except ValueError:
            refreshed = None
    return bool(refreshed and refreshed >= _utc_now() - timedelta(hours=PERSON_CREDITS_CACHE_TTL_HOURS))


def list_buzzwatch_person_credits(
    user_id: str,
    person_id: int,
    media_type: str = "all",
) -> Dict[str, Any]:
    media_type = media_type if media_type in {"movie", "series"} else "all"
    user_token = cache_token(user_id)
    response_key = f"buzzwatch:{RESPONSE_CACHE_VERSION}:credits:{user_token}:{person_id}:{media_type}"
    cached_response = cache_get(response_key)
    if cached_response is not None:
        cached_response["cache"] = {"hit": True, "layer": "redis", "ttlHours": PERSON_CREDITS_CACHE_TTL_HOURS}
        return cached_response
    if not _tmdb_configured():
        raise RuntimeError("TMDB is not configured")
    cache_hit = _person_cache_is_fresh(person_id)
    person_name = ""

    if not cache_hit:
        payload = _tmdb_get(f"/person/{person_id}", {"append_to_response": "combined_credits"})
        person_name = str(payload.get("name") or "")
        credits_by_key: Dict[Tuple[str, int], Dict[str, Any]] = {}
        for raw in ((payload.get("combined_credits") or {}).get("cast") or []):
            normalized = _normalize_person_credit(person_id, raw)
            if not normalized:
                continue
            key = (normalized["mediaType"], normalized["tmdbId"])
            existing = credits_by_key.get(key)
            if existing:
                existing["creditCharacters"] = list(
                    dict.fromkeys((existing.get("creditCharacters") or []) + (normalized.get("creditCharacters") or []))
                )
            else:
                credits_by_key[key] = normalized

        operations = [
            UpdateOne(
                {"itemId": item["itemId"]},
                {
                    "$set": {key: value for key, value in item.items() if key != "creditPersonIds"},
                    "$addToSet": {"creditPersonIds": person_id},
                },
                upsert=True,
            )
            for item in credits_by_key.values()
        ]
        if operations:
            col(BUZZWATCH_ITEMS_COLLECTION).bulk_write(operations, ordered=False)
        col(BUZZWATCH_META_COLLECTION).update_one(
            {"key": f"buzzwatch-person-{person_id}"},
            {"$set": {"personId": person_id, "personName": person_name, "lastUpdatedAt": now_iso()}},
            upsert=True,
        )

    meta = col(BUZZWATCH_META_COLLECTION).find_one({"key": f"buzzwatch-person-{person_id}"}) or {}
    person_name = person_name or str(meta.get("personName") or "")
    query: Dict[str, Any] = {"creditPersonIds": person_id}
    if media_type != "all":
        query["mediaType"] = media_type
    preference = get_buzzwatch_preference(user_id)
    selected_genres = _valid_genre_keys(preference.get("genreKeys") or [])
    items = [
        _with_match_metadata(jsonable(item), selected_genres)
        for item in col(BUZZWATCH_ITEMS_COLLECTION).find(query)
    ]
    items.sort(
        key=lambda item: (
            item.get("releaseDate") or "0000-00-00",
            item.get("title") or "",
        ),
        reverse=True,
    )
    result = {
        "personId": person_id,
        "personName": person_name,
        "mediaType": media_type,
        "items": items,
        "total": len(items),
        "source": "TMDB",
        "cache": {"hit": cache_hit, "layer": "mongo" if cache_hit else "upstream", "ttlHours": PERSON_CREDITS_CACHE_TTL_HOURS},
    }
    cache_set(response_key, result, PERSON_CREDITS_CACHE_TTL_HOURS * 3600)
    return result


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _date_text_to_iso(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    clean = " ".join(unescape(value).split())
    clean = re.sub(r"^(Streaming|Opening|In Theaters|Premieres|Latest Episode:)\s+", "", clean, flags=re.I)
    for fmt in ("%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(clean, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    for fmt in ("%b %d", "%B %d"):
        try:
            parsed = datetime.strptime(clean, fmt)
            return parsed.replace(year=_utc_now().year).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def _genre_names(media_type: str, ids: Iterable[int]) -> List[str]:
    genre_ids = {int(genre_id) for genre_id in ids}
    id_field = "movieIds" if media_type == "movie" else "tvIds"
    return [
        genre["name"]
        for genre in GENRES
        if genre_ids.intersection(genre.get(id_field) or [])
    ]


def _genre_keys_from_rt(values: Iterable[str]) -> Tuple[List[str], List[str]]:
    keys: List[str] = []
    names: List[str] = []
    for raw in values:
        normalized = unescape(raw).strip().lower()
        aliases = RT_GENRE_ALIASES.get(normalized)
        if aliases is None:
            aliases = [GENRE_KEY_BY_NAME[normalized]] if normalized in GENRE_KEY_BY_NAME else []
        for key in aliases:
            if key not in keys:
                keys.append(key)
                genre = next((item for item in GENRES if item["key"] == key), None)
                if genre:
                    names.append(genre["name"])
    return keys, names


def _genre_metadata_from_keys(keys: Iterable[str]) -> Tuple[List[str], List[str]]:
    valid_keys: List[str] = []
    names: List[str] = []
    for key in keys:
        genre = next((item for item in GENRES if item["key"] == key), None)
        if genre and key not in valid_keys:
            valid_keys.append(key)
            names.append(genre["name"])
    return valid_keys, names


def _merge_record(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(existing)
    for field in ("genreKeys", "genres"):
        values: List[str] = []
        for value in list(existing.get(field) or []) + list(incoming.get(field) or []):
            if value not in values:
                values.append(value)
        merged[field] = values

    if (incoming.get("rtScore") or 0) > (merged.get("rtScore") or 0):
        merged["rtScore"] = incoming.get("rtScore")
    if (incoming.get("buzzScore") or 0) > (merged.get("buzzScore") or 0):
        merged["buzzScore"] = incoming.get("buzzScore")
        merged["popularity"] = incoming.get("popularity")
        merged["source"] = incoming.get("source") or merged.get("source")
    for field in ("releaseDate", "releasePeriod", "year", "posterUrl", "backdropUrl", "externalUrl"):
        if not merged.get(field) and incoming.get(field):
            merged[field] = incoming.get(field)
    merged["updatedAt"] = incoming.get("updatedAt") or now_iso()
    return merged


def _rating_from_omdb(imdb_id: Optional[str]) -> Tuple[Optional[int], Optional[float]]:
    omdb_key = os.getenv("OMDB_API_KEY", "").strip()
    if not omdb_key or not imdb_id:
        return None, None
    try:
        response = requests.get(
            OMDB_API_BASE,
            params={"apikey": omdb_key, "i": imdb_id, "tomatoes": "true"},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        logger.exception("Failed to fetch OMDb rating for %s", imdb_id)
        return None, None

    rt_score = None
    for rating in payload.get("Ratings", []):
        if rating.get("Source") == "Rotten Tomatoes":
            match = re.match(r"(\d+)%", str(rating.get("Value", "")))
            if match:
                rt_score = int(match.group(1))
            break

    imdb_rating = None
    try:
        imdb_rating = float(payload.get("imdbRating")) if payload.get("imdbRating") != "N/A" else None
    except (TypeError, ValueError):
        imdb_rating = None
    return rt_score, imdb_rating


def _external_ids(media_type: str, tmdb_id: int) -> Dict[str, Any]:
    details_path = f"/movie/{tmdb_id}" if media_type == "movie" else f"/tv/{tmdb_id}"
    payload = _tmdb_get(details_path, {"append_to_response": "external_ids"})
    return payload.get("external_ids") or {}


def _normalize_item(raw: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
    media_type = raw.get("media_type")
    if media_type not in {"movie", "tv"}:
        return None

    tmdb_id = raw.get("id")
    title = raw.get("title") or raw.get("name")
    release_date = raw.get("release_date") or raw.get("first_air_date")
    if not tmdb_id or not title:
        return None

    genre_names = _genre_names(media_type, raw.get("genre_ids") or [])
    genre_keys = [GENRE_KEY_BY_NAME[name.lower()] for name in genre_names if name.lower() in GENRE_KEY_BY_NAME]
    release_dt = _parse_date(release_date)
    popularity = float(raw.get("popularity") or 0)
    vote_average = float(raw.get("vote_average") or 0)
    vote_count = int(raw.get("vote_count") or 0)

    imdb_id = None
    try:
        imdb_id = _external_ids(media_type, int(tmdb_id)).get("imdb_id")
    except Exception:
        logger.exception("Failed to fetch external ids for TMDB %s %s", media_type, tmdb_id)

    nudity_advisory = _imdb_nudity_advisory(imdb_id)
    genre_keys, genre_names = _with_steamy_genre(genre_keys, genre_names, nudity_advisory)
    rt_score, imdb_rating = _rating_from_omdb(imdb_id)
    if rt_score is not None and rt_score < MIN_RT_SCORE:
        return None
    if rt_score is None and vote_average < MIN_TMDB_SCORE:
        return None

    rating_score = rt_score if rt_score is not None else round(vote_average * 10)
    recency_bonus = 12 if release_dt and release_dt >= _utc_now() - timedelta(days=90) else 0
    buzz_score = round((popularity * 0.55) + (vote_count ** 0.5 * 2.2) + (rating_score * 0.7) + recency_bonus, 2)

    return {
        "itemId": f"{media_type}:{tmdb_id}",
        "tmdbId": tmdb_id,
        "imdbId": imdb_id,
        "title": title,
        "mediaType": "movie" if media_type == "movie" else "series",
        "overview": raw.get("overview") or "",
        "posterUrl": f"{TMDB_IMAGE_BASE}{raw.get('poster_path')}" if raw.get("poster_path") else None,
        "backdropUrl": f"{TMDB_IMAGE_BASE}{raw.get('backdrop_path')}" if raw.get("backdrop_path") else None,
        "releaseDate": release_date,
        "releasePeriod": release_date[:7] if release_date else "unknown",
        "year": release_date[:4] if release_date else None,
        "genres": genre_names,
        "genreKeys": genre_keys,
        "nudityAdvisory": nudity_advisory,
        "tmdbRating": round(vote_average, 1),
        "tmdbVoteCount": vote_count,
        "rtScore": rt_score,
        "imdbRating": imdb_rating,
        "popularity": popularity,
        "buzzScore": buzz_score,
        "source": source,
        "updatedAt": now_iso(),
    }


def _candidate_sources(year: Optional[str] = None) -> List[Tuple[str, str, Dict[str, Any]]]:
    today = _utc_now().date()
    recent_start = today - timedelta(days=75)
    if year and year != "all":
        movie_start = f"{year}-01-01"
        movie_end = f"{year}-12-31"
        return [
            (
                "/discover/movie",
                f"{year} popular movies",
                {
                    "page": page,
                    "sort_by": "vote_average.desc",
                    "vote_count.gte": 120,
                    "primary_release_date.gte": movie_start,
                    "primary_release_date.lte": movie_end,
                },
            )
            for page in range(1, 4)
        ] + [
            (
                "/discover/tv",
                f"{year} popular series",
                {
                    "page": page,
                    "sort_by": "vote_average.desc",
                    "vote_count.gte": 80,
                    "first_air_date.gte": movie_start,
                    "first_air_date.lte": movie_end,
                },
            )
            for page in range(1, 4)
        ]
    return [
        ("/trending/all/week", "Trending this week", {"page": page})
        for page in range(1, 4)
    ] + [
        (
            "/discover/movie",
            "Recent movie buzz",
            {
                "page": page,
                "sort_by": "popularity.desc",
                "vote_count.gte": 80,
                "primary_release_date.gte": recent_start.isoformat(),
                "primary_release_date.lte": today.isoformat(),
            },
        )
        for page in range(1, 3)
    ] + [
        (
            "/discover/tv",
            "Recent series buzz",
            {
                "page": page,
                "sort_by": "popularity.desc",
                "vote_count.gte": 60,
                "first_air_date.gte": recent_start.isoformat(),
                "first_air_date.lte": today.isoformat(),
            },
        )
        for page in range(1, 3)
    ]


def _rt_get(path: str) -> str:
    response = requests.get(
        f"{ROTTEN_TOMATOES_BASE}{path}",
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "Mozilla/5.0 ToolHub BuzzWatch/1.0",
        },
        timeout=RT_DETAIL_TIMEOUT,
    )
    response.raise_for_status()
    return response.text


def _rt_json(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    response = requests.get(
        f"{ROTTEN_TOMATOES_BASE}{path}",
        params=params or {},
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 ToolHub BuzzWatch/1.0",
        },
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


def _extract(pattern: str, value: str, flags: int = re.S) -> Optional[str]:
    match = re.search(pattern, value, flags)
    return unescape(match.group(1)).strip() if match else None


def _rt_detail_metadata(path: str) -> Dict[str, Any]:
    try:
        html = _rt_get(path)
    except Exception as exc:
        logger.warning("Failed to fetch Rotten Tomatoes detail page %s: %s", path, exc)
        return {
            "genreKeys": CATALOG_GENRE_KEYS,
            "genres": [genre["name"] for genre in CATALOG_GENRES],
            "releaseDate": None,
        }

    raw_genres: List[str] = []
    json_genre = _extract(r'"genre"\s*:\s*(\[[^\]]+\]|"[^"]+")', html)
    if json_genre:
        raw_genres.extend(re.findall(r'"([^"]+)"', json_genre) or [json_genre.strip('"')])
    title_genre = _extract(r'"titleGenre"\s*:\s*"([^"]+)"', html)
    if title_genre:
        raw_genres.extend(part.strip() for part in title_genre.split(","))

    release_date = None
    release_match = re.search(r'"releaseDate"\s*:\s*"([^"]+)"', html)
    if release_match:
        release_date = _date_text_to_iso(release_match.group(1))
    if not release_date:
        start_match = re.search(r'"startDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"', html)
        if start_match:
            release_date = start_match.group(1)

    keys, names = _genre_keys_from_rt(raw_genres)
    if not keys:
        keys = CATALOG_GENRE_KEYS
        names = [genre["name"] for genre in CATALOG_GENRES]
    return {"genreKeys": keys, "genres": names, "releaseDate": release_date}


def _rt_detail_genres(path: str) -> Tuple[List[str], List[str]]:
    metadata = _rt_detail_metadata(path)
    return metadata["genreKeys"], metadata["genres"]


def _normalize_rt_tile(tile: str, media_type: str, source: str) -> Optional[Dict[str, Any]]:
    href = _extract(r'href="([^"]+)"\s+slot="meta-data"', tile)
    title = _extract(r'data-qa="discovery-media-list-item-title">\s*([^<]+)', tile)
    poster = _extract(r'<rt-img[^>]+src="([^"]+)"', tile)
    critics_score = _extract(r'slot="criticsScore"[^>]*>\s*(\d+)%', tile)
    audience_score = _extract(r'slot="audienceScore"[^>]*>\s*(\d+)%', tile)
    date_text = _extract(r'data-qa="discovery-media-list-item-start-date">\s*([^<]+)', tile)
    if not href or not title or not critics_score:
        return None

    rt_score = int(critics_score)
    if rt_score < MIN_RT_SCORE:
        return None

    release_date = _date_text_to_iso(date_text)
    genre_keys, genre_names = _rt_detail_genres(href)
    audience = int(audience_score) if audience_score else None
    buzz_score = round((rt_score * 1.1) + ((audience or 0) * 0.35), 2)
    item_id = f"rt:{media_type}:{href.strip('/')}"

    return {
        "itemId": item_id,
        "tmdbId": 0,
        "imdbId": None,
        "title": title,
        "mediaType": media_type,
        "overview": "Popular on Rotten Tomatoes.",
        "posterUrl": poster,
        "backdropUrl": poster,
        "releaseDate": release_date,
        "releasePeriod": release_date[:7] if release_date else "unknown",
        "year": release_date[:4] if release_date else None,
        "genres": genre_names,
        "genreKeys": genre_keys,
        "tmdbRating": None,
        "tmdbVoteCount": None,
        "rtScore": rt_score,
        "imdbRating": None,
        "popularity": buzz_score,
        "buzzScore": buzz_score,
        "source": source,
        "externalUrl": f"{ROTTEN_TOMATOES_BASE}{href}",
        "updatedAt": now_iso(),
    }


def _normalize_rt_api_item(
    item: Dict[str, Any],
    media_type: str,
    source: str,
    genre_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    href = item.get("mediaUrl")
    title = item.get("title")
    critics_score = (item.get("criticsScore") or {}).get("score")
    audience_score = (item.get("audienceScore") or {}).get("score")
    if not href or not title or not critics_score:
        return None

    try:
        rt_score = int(critics_score)
    except (TypeError, ValueError):
        return None
    if rt_score < MIN_RT_SCORE:
        return None

    release_date = _date_text_to_iso(item.get("releaseDateText"))
    genre_keys, genre_names = _genre_metadata_from_keys([genre_key] if genre_key else [])
    try:
        audience = int(audience_score) if audience_score is not None else None
    except (TypeError, ValueError):
        audience = None
    buzz_score = round((rt_score * 1.1) + ((audience or 0) * 0.35), 2)
    item_id = f"rt:{media_type}:{href.strip('/')}"

    return {
        "itemId": item_id,
        "tmdbId": 0,
        "imdbId": None,
        "title": unescape(str(title)),
        "mediaType": media_type,
        "overview": "Popular on Rotten Tomatoes.",
        "posterUrl": item.get("posterUri"),
        "backdropUrl": item.get("posterUri"),
        "releaseDate": release_date,
        "releasePeriod": release_date[:7] if release_date else "unknown",
        "year": release_date[:4] if release_date else None,
        "genres": genre_names,
        "genreKeys": genre_keys,
        "tmdbRating": None,
        "tmdbVoteCount": None,
        "rtScore": rt_score,
        "imdbRating": None,
        "popularity": buzz_score,
        "buzzScore": buzz_score,
        "source": source,
        "externalUrl": f"{ROTTEN_TOMATOES_BASE}{href}",
        "rtPath": href,
        "detailEnriched": False,
        "updatedAt": now_iso(),
    }


def _rt_cnapi_records(
    path_filter: str,
    media_type: str,
    source: str,
    pages: int,
    genre_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    after = None
    for _ in range(max(1, pages)):
        params = {"after": after} if after else None
        payload = _rt_json(f"/cnapi/browse/{path_filter}", params=params)
        for item in ((payload.get("grid") or {}).get("list") or []):
            record = _normalize_rt_api_item(item, media_type, source, genre_key)
            if record:
                records.append(record)
        page_info = payload.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
        if not after:
            break
        time.sleep(0.05)
    return records


def refresh_buzzwatch_items_from_rotten_tomatoes() -> Dict[str, Any]:
    sources: List[Tuple[str, str, str, int, Optional[str]]] = [
        ("movies_at_home/sort:popular", "movie", "RT popular streaming movies", RT_CNAPI_PAGES, None),
        ("movies_at_home/critics:fresh~sort:popular", "movie", "RT fresh streaming movies", RT_CNAPI_PAGES, None),
        (
            "movies_at_home/critics:certified_fresh~sort:popular",
            "movie",
            "RT certified streaming movies",
            RT_CNAPI_PAGES,
            None,
        ),
        ("movies_in_theaters/sort:popular", "movie", "RT popular theater movies", RT_CNAPI_PAGES, None),
        ("tv_series_browse/sort:popular", "series", "RT popular series", RT_CNAPI_PAGES, None),
        ("tv_series_browse/critics:fresh~sort:popular", "series", "RT fresh series", RT_CNAPI_PAGES, None),
    ]
    for genre_key, slug in RT_BROWSE_GENRE_SLUGS.items():
        genre_name = next((genre["name"] for genre in GENRES if genre["key"] == genre_key), genre_key)
        sources.extend(
            [
                (
                    f"movies_at_home/genres:{slug}~sort:popular",
                    "movie",
                    f"RT {genre_name} movies",
                    RT_CNAPI_GENRE_PAGES,
                    genre_key,
                ),
                (
                    f"tv_series_browse/genres:{slug}~sort:popular",
                    "series",
                    f"RT {genre_name} series",
                    RT_CNAPI_GENRE_PAGES,
                    genre_key,
                ),
            ]
        )
    records: Dict[str, Dict[str, Any]] = {}
    for path_filter, media_type, source, pages, genre_key in sources:
        try:
            source_records = _rt_cnapi_records(path_filter, media_type, source, pages, genre_key)
        except Exception:
            logger.exception("Failed to fetch Rotten Tomatoes browse feed %s", path_filter)
            continue
        for record in source_records:
            existing = records.get(record["itemId"])
            records[record["itemId"]] = _merge_record(existing, record) if existing else record

    normalized = sorted(records.values(), key=lambda item: item.get("buzzScore") or 0, reverse=True)
    if normalized:
        operations = [
            ReplaceOne({"itemId": record["itemId"]}, record, upsert=True)
            for record in normalized
        ]
        col(BUZZWATCH_ITEMS_COLLECTION).bulk_write(operations, ordered=False)

    meta = {
        "key": "buzzwatch-refresh",
        "lastUpdatedAt": now_iso(),
        "updated": len(normalized),
        "candidateCount": len(records),
        "ratingProvider": "Rotten Tomatoes public browse",
        "sourceCount": len(sources),
    }
    col(BUZZWATCH_META_COLLECTION).replace_one({"key": meta["key"]}, meta, upsert=True)
    cache_delete_pattern(f"buzzwatch:{RESPONSE_CACHE_VERSION}:items:*")
    return meta


def _refresh_buzzwatch_items_legacy() -> Dict[str, Any]:
    if not _tmdb_configured():
        logger.info("BuzzWatch using Rotten Tomatoes fallback because TMDB is not configured")
        return refresh_buzzwatch_items_from_rotten_tomatoes()

    candidates: Dict[str, Tuple[Dict[str, Any], str]] = {}
    try:
        for path, source, params in _candidate_sources():
            payload = _tmdb_get(path, params)
            for item in payload.get("results", []):
                media_type = item.get("media_type")
                if path.startswith("/discover/movie"):
                    media_type = "movie"
                elif path.startswith("/discover/tv"):
                    media_type = "tv"
                if media_type not in {"movie", "tv"}:
                    continue
                item["media_type"] = media_type
                key = f"{media_type}:{item.get('id')}"
                if key not in candidates:
                    candidates[key] = (item, source)
    except Exception:
        logger.exception("TMDB BuzzWatch refresh failed; falling back to Rotten Tomatoes browse pages")
        return refresh_buzzwatch_items_from_rotten_tomatoes()

    ranked = sorted(
        candidates.values(),
        key=lambda pair: (float(pair[0].get("popularity") or 0), int(pair[0].get("vote_count") or 0)),
        reverse=True,
    )[:MAX_CANDIDATES]

    normalized: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, IMDB_PARENTAL_WORKERS)) as executor:
        futures = [executor.submit(_normalize_item, item, source) for item, source in ranked]
        for future in as_completed(futures):
            record = future.result()
            if record:
                normalized.append(record)

    if normalized:
        operations = [
            ReplaceOne({"itemId": record["itemId"]}, record, upsert=True)
            for record in normalized
        ]
        col(BUZZWATCH_ITEMS_COLLECTION).bulk_write(operations, ordered=False)

    meta = {
        "key": "buzzwatch-refresh",
        "lastUpdatedAt": now_iso(),
        "updated": len(normalized),
        "candidateCount": len(candidates),
        "ratingProvider": "OMDb Rotten Tomatoes" if os.getenv("OMDB_API_KEY", "").strip() else "TMDB fallback",
    }
    col(BUZZWATCH_META_COLLECTION).replace_one({"key": meta["key"]}, meta, upsert=True)
    cache_delete_pattern(f"buzzwatch:{RESPONSE_CACHE_VERSION}:items:*")
    return meta


def _major_streaming_providers(media_type: str) -> List[Dict[str, Any]]:
    payload = _tmdb_get(f"/watch/providers/{media_type}", {"watch_region": WATCH_REGION})
    available = {
        str(provider.get("provider_name") or "").strip().lower(): provider
        for provider in payload.get("results") or []
    }
    selected: List[Dict[str, Any]] = []
    seen_ids = set()
    for preferred_name in MAJOR_STREAMING_PROVIDER_NAMES:
        provider = available.get(preferred_name.lower())
        provider_id = int((provider or {}).get("provider_id") or 0)
        if not provider_id or provider_id in seen_ids:
            continue
        seen_ids.add(provider_id)
        selected.append(
            {
                "providerId": provider_id,
                "name": provider.get("provider_name") or preferred_name,
                "logoUrl": (
                    f"{TMDB_IMAGE_BASE}{provider.get('logo_path')}"
                    if provider.get("logo_path")
                    else None
                ),
                "displayPriority": int(
                    provider.get("display_priority")
                    if provider.get("display_priority") is not None
                    else 999
                ),
            }
        )
    return selected


def _collect_latest_streaming_candidates() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], str, str]:
    today = _utc_now().date()
    window_start = today - timedelta(days=LATEST_WINDOW_DAYS)
    candidates: Dict[str, Dict[str, Any]] = {}
    tracked: Dict[int, Dict[str, Any]] = {}

    for tmdb_media_type in ("movie", "tv"):
        providers = _major_streaming_providers(tmdb_media_type)
        for provider in providers:
            tracked[provider["providerId"]] = provider
            params: Dict[str, Any] = {
                "page": 1,
                "sort_by": "popularity.desc",
                "include_adult": "false",
                "watch_region": WATCH_REGION,
                "with_watch_providers": provider["providerId"],
                "with_watch_monetization_types": "flatrate",
            }
            if tmdb_media_type == "movie":
                params.update(
                    {
                        "primary_release_date.gte": window_start.isoformat(),
                        "primary_release_date.lte": today.isoformat(),
                    }
                )
            else:
                params.update(
                    {
                        "air_date.gte": window_start.isoformat(),
                        "air_date.lte": today.isoformat(),
                        "with_type": "0|2|3|4",
                    }
                )
            try:
                payload = _tmdb_get(f"/discover/{tmdb_media_type}", params)
            except Exception:
                logger.exception(
                    "BuzzWatch provider discovery failed for %s on %s",
                    provider["name"],
                    tmdb_media_type,
                )
                continue
            results = (payload.get("results") or [])[:max(1, LATEST_PER_PROVIDER_LIMIT)]
            for raw in results:
                tmdb_id = int(raw.get("id") or 0)
                if not tmdb_id:
                    continue
                key = f"{tmdb_media_type}:{tmdb_id}"
                candidate = candidates.setdefault(
                    key,
                    {"raw": raw, "mediaType": tmdb_media_type, "providers": {}},
                )
                if float(raw.get("popularity") or 0) > float(candidate["raw"].get("popularity") or 0):
                    candidate["raw"] = raw
                candidate["providers"][provider["providerId"]] = provider

    tracked_rows = sorted(tracked.values(), key=lambda item: item.get("displayPriority", 999))
    return list(candidates.values()), tracked_rows, window_start.isoformat(), today.isoformat()


def _normalize_latest_streaming_item(
    candidate: Dict[str, Any],
    window_start: str,
    window_end: str,
) -> Optional[Dict[str, Any]]:
    raw = dict(candidate.get("raw") or {})
    tmdb_media_type = candidate.get("mediaType")
    tmdb_id = int(raw.get("id") or 0)
    title = raw.get("title") or raw.get("name")
    if tmdb_media_type not in {"movie", "tv"} or not tmdb_id or not title:
        return None
    if not raw.get("poster_path") and not raw.get("backdrop_path"):
        return None

    first_release_date = raw.get("release_date") or raw.get("first_air_date") or ""
    release_date = first_release_date
    latest_season_number = None
    release_context = "New streaming movie"
    genres = _genre_names(tmdb_media_type, raw.get("genre_ids") or [])

    if tmdb_media_type == "tv":
        details = _tmdb_get(f"/tv/{tmdb_id}")
        latest_episode = details.get("last_episode_to_air") or {}
        release_date = latest_episode.get("air_date") or details.get("last_air_date") or first_release_date
        latest_season_number = latest_episode.get("season_number")
        release_context = "New series" if first_release_date >= window_start else "New episode or season"
        if details.get("genres"):
            genres = _genre_names(
                "tv",
                [genre.get("id") for genre in details.get("genres") or [] if genre.get("id")],
            )
        raw["overview"] = details.get("overview") or raw.get("overview")
        raw["poster_path"] = details.get("poster_path") or raw.get("poster_path")
        raw["backdrop_path"] = details.get("backdrop_path") or raw.get("backdrop_path")
        raw["vote_average"] = details.get("vote_average") or raw.get("vote_average")
        raw["vote_count"] = details.get("vote_count") or raw.get("vote_count")

    if not release_date or release_date < window_start or release_date > window_end:
        return None

    genre_keys = [
        GENRE_KEY_BY_NAME[name.lower()]
        for name in genres
        if name.lower() in GENRE_KEY_BY_NAME
    ]
    providers = sorted(
        (candidate.get("providers") or {}).values(),
        key=lambda item: item.get("displayPriority", 999),
    )
    vote_average = float(raw.get("vote_average") or 0)
    vote_count = int(raw.get("vote_count") or 0)
    popularity = float(raw.get("popularity") or 0)
    media_type = "movie" if tmdb_media_type == "movie" else "series"
    return {
        "itemId": f"streaming:{media_type}:{tmdb_id}",
        "tmdbId": tmdb_id,
        "title": title,
        "mediaType": media_type,
        "overview": raw.get("overview") or "",
        "posterUrl": f"{TMDB_IMAGE_BASE}{raw.get('poster_path')}" if raw.get("poster_path") else None,
        "backdropUrl": f"{TMDB_IMAGE_BASE}{raw.get('backdrop_path')}" if raw.get("backdrop_path") else None,
        "releaseDate": release_date,
        "originalReleaseDate": first_release_date or None,
        "releasePeriod": release_date[:7],
        "releaseContext": release_context,
        "year": release_date[:4],
        "genres": genres,
        "genreKeys": list(dict.fromkeys(genre_keys)),
        "tmdbRating": round(vote_average, 1),
        "tmdbVoteCount": vote_count,
        "popularity": popularity,
        "providers": providers,
        "watchRegion": WATCH_REGION,
        "availabilitySource": "JustWatch via TMDB",
        "externalUrl": f"https://www.themoviedb.org/{tmdb_media_type}/{tmdb_id}",
        "latestSeasonNumber": latest_season_number,
        "catalogScope": LATEST_CATALOG_SCOPE,
        "source": "TMDB streaming discovery",
        "sourceVersion": LATEST_SOURCE_VERSION,
        "updatedAt": now_iso(),
    }


def _apply_latest_buzz_scores(records: List[Dict[str, Any]]) -> None:
    popularity_values = sorted(float(record.get("popularity") or 0) for record in records)
    total = max(1, len(popularity_values))
    now = _utc_now()
    for record in records:
        rating = float(record.get("tmdbRating") or 0)
        votes = int(record.get("tmdbVoteCount") or 0)
        popularity = float(record.get("popularity") or 0)
        lower_count = sum(1 for value in popularity_values if value <= popularity)
        popularity_percentile = lower_count / total
        bayesian_rating = ((rating * votes) + (6.5 * 80)) / (votes + 80) if rating > 0 else 0
        quality = round(max(0, min(45, (bayesian_rating / 10) * 45)))
        audience = round(max(0, min(20, (math.log10(votes + 1) / 4) * 20)))
        momentum = round(popularity_percentile * 20)
        release_dt = _parse_date(record.get("releaseDate")) or now
        age_days = max(0, min(LATEST_WINDOW_DAYS, (now - release_dt).days))
        freshness = round((1 - (age_days / max(1, LATEST_WINDOW_DAYS))) * 10)
        availability = round(min(1, len(record.get("providers") or []) / 3) * 5)
        buzz_score = max(0, min(100, quality + audience + momentum + freshness + availability))
        confidence = "high" if votes >= 500 else "medium" if votes >= 50 else "early"
        reasons: List[str] = []
        if rating >= 8 and votes >= 25:
            reasons.append(f"Strong {rating:.1f}/10 viewer rating")
        elif votes >= 100:
            reasons.append(f"Backed by {votes:,} viewer ratings")
        if popularity_percentile >= 0.85:
            reasons.append("Among the fastest-moving new streaming titles")
        if age_days <= 7:
            reasons.append("Released or aired this week")
        provider_names = [provider.get("name") for provider in record.get("providers") or [] if provider.get("name")]
        if provider_names:
            reasons.append(f"Streaming on {' + '.join(provider_names[:2])}")
        record.update(
            {
                "buzzScore": buzz_score,
                "buzzConfidence": confidence,
                "buzzBreakdown": {
                    "quality": quality,
                    "audience": audience,
                    "momentum": momentum,
                    "freshness": freshness,
                    "availability": availability,
                },
                "buzzReasons": reasons[:3],
                "daysSinceRelease": age_days,
            }
        )


def refresh_buzzwatch_items() -> Dict[str, Any]:
    if not _tmdb_configured():
        logger.info("BuzzWatch using Rotten Tomatoes fallback because TMDB is not configured")
        return refresh_buzzwatch_items_from_rotten_tomatoes()

    candidates, tracked_providers, window_start, window_end = _collect_latest_streaming_candidates()
    normalized: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, LATEST_REFRESH_WORKERS)) as executor:
        futures = [
            executor.submit(_normalize_latest_streaming_item, candidate, window_start, window_end)
            for candidate in candidates
        ]
        for future in as_completed(futures):
            try:
                record = future.result()
            except Exception:
                logger.exception("Failed to normalize a latest streaming candidate")
                continue
            if record:
                normalized.append(record)

    if not normalized:
        raise RuntimeError("No current streaming titles were returned; the previous BuzzWatch catalogue was kept")

    _apply_latest_buzz_scores(normalized)
    normalized.sort(key=lambda item: (item.get("buzzScore") or 0, item.get("releaseDate") or ""), reverse=True)
    item_ids = [record["itemId"] for record in normalized]
    operations = [ReplaceOne({"itemId": record["itemId"]}, record, upsert=True) for record in normalized]
    items_collection = col(BUZZWATCH_ITEMS_COLLECTION)
    items_collection.bulk_write(operations, ordered=False)
    items_collection.delete_many(
        {"catalogScope": LATEST_CATALOG_SCOPE, "itemId": {"$nin": item_ids}}
    )

    provider_counts = [
        {
            "providerId": provider["providerId"],
            "name": provider["name"],
            "logoUrl": provider.get("logoUrl"),
            "count": sum(
                1
                for record in normalized
                if provider["providerId"] in {
                    item.get("providerId") for item in record.get("providers") or []
                }
            ),
        }
        for provider in tracked_providers
    ]
    meta = {
        "key": "buzzwatch-refresh",
        "lastUpdatedAt": now_iso(),
        "updated": len(normalized),
        "candidateCount": len(candidates),
        "ratingProvider": "TMDB + JustWatch streaming availability",
        "sourceVersion": LATEST_SOURCE_VERSION,
        "watchRegion": WATCH_REGION,
        "windowDays": LATEST_WINDOW_DAYS,
        "windowStart": window_start,
        "windowEnd": window_end,
        "trackedProviders": provider_counts,
    }
    col(BUZZWATCH_META_COLLECTION).replace_one({"key": meta["key"]}, meta, upsert=True)
    cache_delete_pattern(f"buzzwatch:{RESPONSE_CACHE_VERSION}:items:*")
    return meta


def enrich_buzzwatch_year(year: str) -> Dict[str, Any]:
    if not _tmdb_configured() or not re.fullmatch(r"\d{4}", str(year or "")):
        return {"updated": 0, "skipped": True}

    candidates: Dict[str, Tuple[Dict[str, Any], str]] = {}
    for path, source, params in _candidate_sources(year):
        payload = _tmdb_get(path, params)
        for item in payload.get("results", []):
            media_type = "movie" if path.startswith("/discover/movie") else "tv"
            item["media_type"] = media_type
            key = f"{media_type}:{item.get('id')}"
            candidates[key] = (item, source)

    normalized: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, IMDB_PARENTAL_WORKERS)) as executor:
        futures = [executor.submit(_normalize_item, item, source) for item, source in candidates.values()]
        for future in as_completed(futures):
            record = future.result()
            if record:
                normalized.append(record)

    if normalized:
        col(BUZZWATCH_ITEMS_COLLECTION).bulk_write(
            [ReplaceOne({"itemId": record["itemId"]}, record, upsert=True) for record in normalized],
            ordered=False,
        )
    return {"updated": len(normalized), "candidateCount": len(candidates), "year": year}


def _imdb_dataset_path(filename: str) -> str:
    os.makedirs(IMDB_DATA_DIR, exist_ok=True)
    return os.path.join(IMDB_DATA_DIR, filename)


def _ensure_imdb_dataset(filename: str) -> str:
    path = _imdb_dataset_path(filename)
    max_age = timedelta(hours=IMDB_DATA_MAX_AGE_HOURS).total_seconds()
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < max_age:
        return path

    temp_path = f"{path}.part"
    logger.info("Downloading IMDb dataset %s", filename)
    response = requests.get(
        f"{IMDB_DATASET_BASE}/{filename}",
        headers={"User-Agent": "ToolHub BuzzWatch/1.0"},
        stream=True,
        timeout=(20, 120),
    )
    response.raise_for_status()
    with open(temp_path, "wb") as output:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                output.write(chunk)
    os.replace(temp_path, path)
    return path


def _imdb_genres(raw_genres: str) -> Tuple[List[str], List[str]]:
    values = [] if not raw_genres or raw_genres == "\\N" else raw_genres.split(",")
    keys, names = _genre_keys_from_rt(values)
    if not keys and "Biography" in values:
        keys, names = ["documentary"], ["Documentary"]
    return keys, names


def _imdb_year_candidates(year: str) -> Dict[str, Dict[str, Any]]:
    basics_path = _ensure_imdb_dataset("title.basics.tsv.gz")
    candidates: Dict[str, Dict[str, Any]] = {}
    with gzip.open(basics_path, "rt", encoding="utf-8", errors="replace") as source:
        next(source, None)
        for line in source:
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 9:
                continue
            tconst, title_type, primary_title, _, is_adult, start_year, _, _, raw_genres = fields[:9]
            media_type = IMDB_TITLE_TYPES.get(title_type)
            if media_type is None or start_year != year or is_adult == "1":
                continue
            genre_keys, genre_names = _imdb_genres(raw_genres)
            if not genre_keys:
                continue
            candidates[tconst] = {
                "imdbId": tconst,
                "title": primary_title,
                "mediaType": media_type,
                "year": year,
                "genreKeys": genre_keys,
                "genres": genre_names,
            }
    return candidates


def _attach_imdb_ratings(candidates: Dict[str, Dict[str, Any]]) -> None:
    ratings_path = _ensure_imdb_dataset("title.ratings.tsv.gz")
    with gzip.open(ratings_path, "rt", encoding="utf-8", errors="replace") as source:
        next(source, None)
        for line in source:
            tconst, average_rating, num_votes = line.rstrip("\n").split("\t")[:3]
            candidate = candidates.get(tconst)
            if candidate is None:
                continue
            candidate["imdbRating"] = float(average_rating)
            candidate["imdbVoteCount"] = int(num_votes)


def _imdb_rank_score(item: Dict[str, Any]) -> float:
    rating = float(item.get("imdbRating") or 0)
    votes = int(item.get("imdbVoteCount") or 0)
    return round((rating * 8) + (math.log10(max(1, votes)) * 10), 2)


def _imdb_suggestion(imdb_id: str) -> Dict[str, Any]:
    try:
        response = requests.get(
            f"{IMDB_SUGGESTION_BASE}/{imdb_id}.json",
            headers={"User-Agent": "ToolHub BuzzWatch/1.0"},
            timeout=15,
        )
        response.raise_for_status()
        rows = response.json().get("d") or []
        return next((row for row in rows if row.get("id") == imdb_id), rows[0] if rows else {})
    except Exception as exc:
        logger.warning("Failed to enrich IMDb title %s: %s", imdb_id, exc)
        return {}


def _imdb_parents_guide(imdb_id: Optional[str]) -> List[Dict[str, Any]]:
    if not imdb_id:
        return []
    query = """
    query BuzzWatchParentsGuide($id: ID!) {
      title(id: $id) {
        parentsGuide {
          categories {
            category { id text }
            severity { voteType text votedFor }
            severityBreakdown { voteType votedFor }
            totalSeverityVotes
          }
        }
      }
    }
    """
    try:
        response = requests.post(
            IMDB_PARENTAL_GRAPHQL,
            json={"query": query, "variables": {"id": imdb_id}},
            headers={
                "Content-Type": "application/json",
                "Origin": "https://www.imdb.com",
                "User-Agent": "ToolHub BuzzWatch/1.0",
            },
            timeout=20,
        )
        response.raise_for_status()
        categories = (((response.json().get("data") or {}).get("title") or {}).get("parentsGuide") or {}).get("categories") or []
        normalized = []
        for category in categories:
            category_meta = category.get("category") or {}
            severity_meta = category.get("severity") or {}
            normalized.append(
                {
                    "category": category_meta.get("text") or str(category_meta.get("id") or "").title(),
                    "categoryId": str(category_meta.get("id") or "").upper(),
                    "severity": str(severity_meta.get("voteType") or "UNKNOWN").upper(),
                    "severityLabel": severity_meta.get("text") or "Not rated",
                    "totalVotes": int(category.get("totalSeverityVotes") or 0),
                    "breakdown": {
                        str(row.get("voteType") or "").upper(): int(row.get("votedFor") or 0)
                        for row in category.get("severityBreakdown") or []
                    },
                }
            )
        return normalized
    except Exception as exc:
        logger.warning("Failed to fetch IMDb parental guide for %s: %s", imdb_id, exc)
        return []


def _imdb_nudity_advisory(imdb_id: Optional[str]) -> Dict[str, Any]:
    categories = _imdb_parents_guide(imdb_id)
    try:
        nudity = next(
            (
                category
                for category in categories
                if category.get("categoryId") == "NUDITY"
                or "nudity" in str(category.get("category") or "").lower()
            ),
            {},
        )
        severity = str(nudity.get("severity") or "UNKNOWN").upper()
        total_votes = int(nudity.get("totalVotes") or 0)
        breakdown = nudity.get("breakdown") or {}
        severe_votes = breakdown.get("SEVERE", 0)
        score = round((severe_votes / total_votes) * 100) if total_votes else 0
        return {
            "severity": severity,
            "totalVotes": total_votes,
            "severeVotes": severe_votes,
            "score": score,
            "isSteamy": severity == "SEVERE" and total_votes >= 10 and score >= 55,
        }
    except Exception:
        return {"severity": "UNKNOWN", "totalVotes": 0, "severeVotes": 0, "score": 0, "isSteamy": False}


def _with_steamy_genre(
    genre_keys: Iterable[str],
    genres: Iterable[str],
    advisory: Dict[str, Any],
) -> Tuple[List[str], List[str]]:
    keys = list(dict.fromkeys(genre_keys))
    names = list(dict.fromkeys(genres))
    if advisory.get("isSteamy"):
        if "steamy" not in keys:
            keys.append("steamy")
        if "Steamy" not in names:
            names.append("Steamy")
    return keys, names


def _normalize_imdb_year_item(
    item: Dict[str, Any],
    suggestion: Dict[str, Any],
    advisory: Dict[str, Any],
) -> Dict[str, Any]:
    imdb_id = item["imdbId"]
    image = suggestion.get("i") or {}
    rating = float(item.get("imdbRating") or 0)
    votes = int(item.get("imdbVoteCount") or 0)
    buzz_score = _imdb_rank_score(item)
    genre_keys, genres = _with_steamy_genre(item["genreKeys"], item["genres"], advisory)
    return {
        "itemId": f"imdb:{item['mediaType']}:{imdb_id}",
        "tmdbId": 0,
        "imdbId": imdb_id,
        "title": item["title"],
        "mediaType": item["mediaType"],
        "overview": f"Highly rated {item['mediaType']} from {item['year']} with {votes:,} IMDb votes.",
        "posterUrl": image.get("imageUrl"),
        "backdropUrl": image.get("imageUrl"),
        "releaseDate": None,
        "releasePeriod": f"{item['year']}-01",
        "year": item["year"],
        "genres": genres,
        "genreKeys": genre_keys,
        "nudityAdvisory": advisory,
        "tmdbRating": None,
        "tmdbVoteCount": None,
        "rtScore": None,
        "imdbRating": round(rating, 1),
        "imdbVoteCount": votes,
        "popularity": buzz_score,
        "buzzScore": buzz_score,
        "source": IMDB_SOURCE,
        "sourceVersion": IMDB_SOURCE_VERSION,
        "externalUrl": f"https://www.imdb.com/title/{imdb_id}/",
        "updatedAt": now_iso(),
    }


def enrich_buzzwatch_year_from_imdb(year: str) -> Dict[str, Any]:
    if not re.fullmatch(r"\d{4}", str(year or "")):
        return {"updated": 0, "skipped": True}

    candidates = _imdb_year_candidates(year)
    _attach_imdb_ratings(candidates)
    ranked_by_type: Dict[str, List[Dict[str, Any]]] = {"movie": [], "series": []}
    for item in candidates.values():
        rating = float(item.get("imdbRating") or 0)
        votes = int(item.get("imdbVoteCount") or 0)
        current_year = _utc_now().year
        is_recent_year = int(year) >= current_year - 1
        min_votes = (750 if is_recent_year else 10000) if item["mediaType"] == "movie" else (250 if is_recent_year else 2000)
        if rating >= 6.5 and votes >= min_votes:
            ranked_by_type[item["mediaType"]].append(item)

    selected: List[Dict[str, Any]] = []
    for media_type, rows in ranked_by_type.items():
        rows.sort(key=lambda item: (_imdb_rank_score(item), item.get("imdbVoteCount") or 0), reverse=True)
        selected.extend(rows[:IMDB_YEAR_TARGET_PER_TYPE])

    suggestions: Dict[str, Dict[str, Any]] = {}
    advisories: Dict[str, Dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=max(1, IMDB_POSTER_WORKERS)) as executor:
        suggestion_futures = {executor.submit(_imdb_suggestion, item["imdbId"]): item["imdbId"] for item in selected}
        advisory_futures = {executor.submit(_imdb_nudity_advisory, item["imdbId"]): item["imdbId"] for item in selected}
        for future in as_completed(suggestion_futures):
            suggestions[suggestion_futures[future]] = future.result()
        for future in as_completed(advisory_futures):
            advisories[advisory_futures[future]] = future.result()

    normalized = [
        _normalize_imdb_year_item(
            item,
            suggestions.get(item["imdbId"], {}),
            advisories.get(item["imdbId"], {}),
        )
        for item in selected
    ]
    if normalized:
        col(BUZZWATCH_ITEMS_COLLECTION).delete_many(
            {
                "year": year,
                "source": IMDB_SOURCE,
                "sourceVersion": {"$ne": IMDB_SOURCE_VERSION},
            }
        )
        col(BUZZWATCH_ITEMS_COLLECTION).bulk_write(
            [ReplaceOne({"itemId": record["itemId"]}, record, upsert=True) for record in normalized],
            ordered=False,
        )
    meta = {
        "key": f"buzzwatch-year-{year}",
        "year": year,
        "lastUpdatedAt": now_iso(),
        "updated": len(normalized),
        "movieCount": len([item for item in normalized if item["mediaType"] == "movie"]),
        "seriesCount": len([item for item in normalized if item["mediaType"] == "series"]),
        "ratingProvider": IMDB_SOURCE,
        "sourceVersion": IMDB_SOURCE_VERSION,
    }
    col(BUZZWATCH_META_COLLECTION).replace_one({"key": meta["key"]}, meta, upsert=True)
    return meta


def _tmdb_year_candidates(year: str) -> Dict[str, Dict[str, Any]]:
    candidates: Dict[str, Dict[str, Any]] = {}
    date_start = f"{year}-01-01"
    date_end = f"{year}-12-31"
    for media_type in ("movie", "tv"):
        path = f"/discover/{media_type}"
        start_key = "primary_release_date.gte" if media_type == "movie" else "first_air_date.gte"
        end_key = "primary_release_date.lte" if media_type == "movie" else "first_air_date.lte"
        for sort_by, pages in (("popularity.desc", TMDB_DISCOVER_PAGES), ("vote_average.desc", 3)):
            for page in range(1, pages + 1):
                payload = _tmdb_get(
                    path,
                    {
                        "page": page,
                        "sort_by": sort_by,
                        "include_adult": "false",
                        "vote_count.gte": 100 if media_type == "movie" else 50,
                        start_key: date_start,
                        end_key: date_end,
                    },
                )
                for raw in payload.get("results") or []:
                    if not raw.get("id"):
                        continue
                    raw["media_type"] = media_type
                    candidates[f"{media_type}:{raw['id']}"] = raw
    return candidates


def _tmdb_year_rank_score(item: Dict[str, Any]) -> float:
    rating = float(item.get("vote_average") or 0)
    votes = int(item.get("vote_count") or 0)
    popularity = float(item.get("popularity") or 0)
    return round((rating * 8) + (math.log10(max(1, votes)) * 10) + (math.log1p(popularity) * 3), 2)


def _diverse_tmdb_selection(rows: List[Dict[str, Any]], target: int) -> List[Dict[str, Any]]:
    ranked = sorted(rows, key=_tmdb_year_rank_score, reverse=True)
    selected: List[Dict[str, Any]] = []
    selected_ids = set()
    language_counts: Dict[str, int] = {}
    for item in ranked:
        language = str(item.get("original_language") or "unknown").lower()
        cap = max(8, round(target * (0.7 if language == "en" else 0.15)))
        if language_counts.get(language, 0) >= cap:
            continue
        selected.append(item)
        selected_ids.add(item.get("id"))
        language_counts[language] = language_counts.get(language, 0) + 1
        if len(selected) >= target:
            return selected
    for item in ranked:
        if item.get("id") in selected_ids:
            continue
        selected.append(item)
        if len(selected) >= target:
            break
    return selected


def _tmdb_external_metadata(item: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return _external_ids(item["media_type"], int(item["id"]))
    except Exception as exc:
        logger.warning("Failed to fetch TMDB external ids for %s:%s: %s", item.get("media_type"), item.get("id"), exc)
        return {}


def _normalize_hybrid_year_item(item: Dict[str, Any]) -> Dict[str, Any]:
    media_type = item["media_type"]
    output_type = "movie" if media_type == "movie" else "series"
    title = item.get("title") or item.get("name") or "Untitled"
    release_date = item.get("release_date") or item.get("first_air_date")
    tmdb_rating = float(item.get("vote_average") or 0)
    tmdb_votes = int(item.get("vote_count") or 0)
    imdb_rating = item.get("imdbRating")
    imdb_votes = int(item.get("imdbVoteCount") or 0)
    effective_rating = float(imdb_rating if imdb_rating is not None else tmdb_rating)
    effective_votes = imdb_votes or tmdb_votes
    popularity = float(item.get("popularity") or 0)
    buzz_score = round(
        (effective_rating * 8)
        + (math.log10(max(1, effective_votes)) * 10)
        + (math.log1p(popularity) * 3),
        2,
    )
    genres = _genre_names(media_type, item.get("genre_ids") or [])
    genre_keys = [GENRE_KEY_BY_NAME[name.lower()] for name in genres if name.lower() in GENRE_KEY_BY_NAME]
    advisory = item.get("nudityAdvisory") or {}
    genre_keys, genres = _with_steamy_genre(genre_keys, genres, advisory)
    return {
        "itemId": f"tmdb:{output_type}:{item['id']}",
        "tmdbId": item["id"],
        "imdbId": item.get("imdbId"),
        "tvdbId": item.get("tvdbId"),
        "title": title,
        "mediaType": output_type,
        "overview": item.get("overview") or f"Highly rated {output_type} from {str(release_date or '')[:4]}.",
        "posterUrl": f"{TMDB_IMAGE_BASE}{item.get('poster_path')}" if item.get("poster_path") else None,
        "backdropUrl": f"{TMDB_IMAGE_BASE}{item.get('backdrop_path')}" if item.get("backdrop_path") else None,
        "releaseDate": release_date,
        "releasePeriod": release_date[:7] if release_date else "unknown",
        "year": release_date[:4] if release_date else None,
        "genres": genres,
        "genreKeys": genre_keys,
        "nudityAdvisory": advisory,
        "originalLanguage": item.get("original_language"),
        "tmdbRating": round(tmdb_rating, 1),
        "tmdbVoteCount": tmdb_votes,
        "rtScore": None,
        "imdbRating": round(float(imdb_rating), 1) if imdb_rating is not None else None,
        "imdbVoteCount": imdb_votes or None,
        "popularity": popularity,
        "buzzScore": buzz_score,
        "source": HYBRID_SOURCE,
        "sourceVersion": HYBRID_SOURCE_VERSION,
        "externalUrl": f"https://www.themoviedb.org/{'movie' if media_type == 'movie' else 'tv'}/{item['id']}",
        "updatedAt": now_iso(),
    }


def enrich_buzzwatch_year_from_tmdb(year: str) -> Dict[str, Any]:
    if not _tmdb_configured() or not re.fullmatch(r"\d{4}", str(year or "")):
        return {"updated": 0, "skipped": True}
    candidates = _tmdb_year_candidates(year)
    selected: List[Dict[str, Any]] = []
    for media_type in ("movie", "tv"):
        eligible = [
            item
            for item in candidates.values()
            if item.get("media_type") == media_type
            and float(item.get("vote_average") or 0) >= 6.5
            and int(item.get("vote_count") or 0) >= (300 if media_type == "movie" else 150)
        ]
        selected.extend(_diverse_tmdb_selection(eligible, TMDB_YEAR_TARGET_PER_TYPE))

    with ThreadPoolExecutor(max_workers=max(1, IMDB_POSTER_WORKERS)) as executor:
        futures = {executor.submit(_tmdb_external_metadata, item): f"{item['media_type']}:{item['id']}" for item in selected}
        external_by_key = {futures[future]: future.result() for future in as_completed(futures)}
    imdb_candidates: Dict[str, Dict[str, Any]] = {}
    for item in selected:
        external = external_by_key.get(f"{item['media_type']}:{item['id']}", {})
        item["imdbId"] = external.get("imdb_id")
        item["tvdbId"] = external.get("tvdb_id")
        if item.get("imdbId"):
            imdb_candidates[item["imdbId"]] = item
    _attach_imdb_ratings(imdb_candidates)
    with ThreadPoolExecutor(max_workers=max(1, IMDB_PARENTAL_WORKERS)) as executor:
        futures = {
            executor.submit(_imdb_nudity_advisory, item.get("imdbId")): item
            for item in selected
            if item.get("imdbId")
        }
        for future in as_completed(futures):
            futures[future]["nudityAdvisory"] = future.result()

    normalized = [_normalize_hybrid_year_item(item) for item in selected]
    if normalized:
        col(BUZZWATCH_ITEMS_COLLECTION).delete_many({"year": year, "source": HYBRID_SOURCE})
        col(BUZZWATCH_ITEMS_COLLECTION).bulk_write(
            [ReplaceOne({"itemId": record["itemId"]}, record, upsert=True) for record in normalized],
            ordered=False,
        )
    meta = {
        "key": f"buzzwatch-year-{year}",
        "year": year,
        "lastUpdatedAt": now_iso(),
        "updated": len(normalized),
        "movieCount": len([item for item in normalized if item["mediaType"] == "movie"]),
        "seriesCount": len([item for item in normalized if item["mediaType"] == "series"]),
        "ratingProvider": HYBRID_SOURCE,
        "sourceVersion": HYBRID_SOURCE_VERSION,
    }
    col(BUZZWATCH_META_COLLECTION).replace_one({"key": meta["key"]}, meta, upsert=True)
    return meta


def enrich_buzzwatch_year_from_rotten_tomatoes(year: str, selected_genres: List[str]) -> Dict[str, Any]:
    if not re.fullmatch(r"\d{4}", str(year or "")):
        return {"updated": 0, "skipped": True}

    existing_target = col(BUZZWATCH_ITEMS_COLLECTION).count_documents({"year": year})
    if existing_target >= YEAR_RESULT_TARGET:
        return {"updated": 0, "candidateCount": existing_target, "year": year}

    docs = list(
        col(BUZZWATCH_ITEMS_COLLECTION)
        .find(
            {
                "itemId": {"$regex": "^rt:"},
                "$or": [{"detailEnriched": {"$ne": True}}, {"year": {"$ne": year}}],
            }
        )
        .sort([("buzzScore", -1), ("rtScore", -1)])
        .limit(RT_YEAR_ENRICH_SCAN_LIMIT)
    )

    def detail_update(doc: Dict[str, Any]) -> Tuple[Any, Dict[str, Any]]:
        path = doc.get("rtPath") or ("/" + str(doc.get("itemId", "")).split(":", 2)[-1])
        if not path.startswith("/"):
            path = f"/{path}"
        metadata = _rt_detail_metadata(path)
        release_date = metadata.get("releaseDate") or doc.get("releaseDate")
        genre_keys = list(doc.get("genreKeys") or [])
        genre_names = list(doc.get("genres") or [])
        detail_keys = metadata.get("genreKeys") or []
        detail_names = metadata.get("genres") or []
        if detail_keys and detail_keys != CATALOG_GENRE_KEYS:
            genre_keys, genre_names = _genre_metadata_from_keys(list(genre_keys) + list(detail_keys))
        elif not genre_keys:
            genre_keys, genre_names = _genre_metadata_from_keys(
                [key for key in (selected_genres or CATALOG_GENRE_KEYS) if key != "steamy"]
            )

        item_year = release_date[:4] if release_date else doc.get("year")
        update = {
            "releaseDate": release_date,
            "releasePeriod": release_date[:7] if release_date else doc.get("releasePeriod") or "unknown",
            "year": item_year,
            "genreKeys": genre_keys,
            "genres": genre_names or detail_names,
            "detailEnriched": True,
            "updatedAt": now_iso(),
        }
        return doc["_id"], update

    updates: List[Tuple[Any, Dict[str, Any]]] = []
    matched_target = existing_target
    with ThreadPoolExecutor(max_workers=max(1, RT_DETAIL_WORKERS)) as executor:
        futures = [executor.submit(detail_update, doc) for doc in docs]
        for future in as_completed(futures):
            try:
                doc_id, update = future.result()
            except Exception:
                logger.exception("Failed to enrich Rotten Tomatoes detail metadata")
                continue
            updates.append((doc_id, update))
            source_doc = next((doc for doc in docs if doc["_id"] == doc_id), {})
            enriched_doc = dict(source_doc)
            enriched_doc.update(update)
            if update.get("year") == year and _matches_genres(enriched_doc, selected_genres):
                matched_target += 1

    for doc_id, update in updates:
        col(BUZZWATCH_ITEMS_COLLECTION).update_one({"_id": doc_id}, {"$set": update})

    if matched_target < YEAR_RESULT_TARGET:
        logger.info("BuzzWatch year %s enriched to %s matches after scanning %s RT titles", year, matched_target, len(docs))
    return {"updated": len(updates), "candidateCount": len(docs), "year": year}


def _matches_genres(item: Dict[str, Any], selected: List[str]) -> bool:
    if not selected:
        return True
    item_genres = set(item.get("genreKeys") or [])
    return bool(item_genres.intersection(selected))


def _valid_genre_keys(values: Iterable[str]) -> List[str]:
    available = {genre["key"] for genre in GENRES}
    valid: List[str] = []
    for value in values:
        key = str(value or "").strip().lower()
        if key in available and key not in valid:
            valid.append(key)
    return valid


def static_year_options() -> List[Dict[str, Any]]:
    current_year = _utc_now().year
    return [
        {"value": str(year), "label": str(year), "count": 0}
        for year in range(current_year, STATIC_YEAR_START - 1, -1)
    ]


def _year_cache_is_fresh(
    year: str,
    source: str,
    source_version: int,
    requested_types: List[str],
) -> bool:
    meta = col(BUZZWATCH_META_COLLECTION).find_one({"key": f"buzzwatch-year-{year}"}) or {}
    if meta.get("ratingProvider") != source or int(meta.get("sourceVersion") or 0) != source_version:
        return False
    try:
        updated_at = datetime.fromisoformat(str(meta.get("lastUpdatedAt") or "").replace("Z", "+00:00"))
    except ValueError:
        return False
    if updated_at < _utc_now() - timedelta(hours=YEAR_CACHE_TTL_HOURS):
        return False
    count_by_type = {
        "movie": int(meta.get("movieCount") or 0),
        "series": int(meta.get("seriesCount") or 0),
    }
    return all(count_by_type.get(media_type, 0) >= YEAR_RESULT_TARGET for media_type in requested_types)


def _year_refresh_lock_key(year: str) -> str:
    return f"buzzwatch:{RESPONSE_CACHE_VERSION}:refresh-lock:year:{year}"


def _refresh_year_cache(year: str) -> Dict[str, Any]:
    """Refresh one catalogue year and invalidate every user's derived response."""
    lock_key = _year_refresh_lock_key(year)
    try:
        result = (
            enrich_buzzwatch_year_from_tmdb(year)
            if _tmdb_configured()
            else enrich_buzzwatch_year_from_imdb(year)
        )
        cache_delete_pattern(f"buzzwatch:{RESPONSE_CACHE_VERSION}:items:*:year:{year}:*")
        return result
    finally:
        cache_delete(lock_key)


def _schedule_year_refresh(year: str) -> bool:
    """Queue one daemon refresh across all API workers without delaying the request."""
    lock_key = _year_refresh_lock_key(year)
    if not cache_add(lock_key, {"startedAt": now_iso()}, YEAR_REFRESH_LOCK_SECONDS):
        return False

    def run() -> None:
        try:
            _refresh_year_cache(year)
        except Exception:
            logger.exception("BuzzWatch background refresh failed for year %s", year)

    threading.Thread(target=run, name=f"buzzwatch-year-{year}", daemon=True).start()
    return True


def warm_buzzwatch_year_cache() -> Dict[str, Any]:
    """Refresh stale recent years off the request path; intended for the scheduler."""
    current_year = _utc_now().year
    refreshed: List[str] = []
    skipped: List[str] = []
    for numeric_year in range(current_year, current_year - max(1, YEAR_WARM_COUNT), -1):
        year = str(numeric_year)
        source = HYBRID_SOURCE if _tmdb_configured() else IMDB_SOURCE
        source_version = HYBRID_SOURCE_VERSION if _tmdb_configured() else IMDB_SOURCE_VERSION
        if _year_cache_is_fresh(year, source, source_version, ["movie", "series"]):
            skipped.append(year)
            continue
        lock_key = _year_refresh_lock_key(year)
        if not cache_add(lock_key, {"startedAt": now_iso(), "source": "scheduler"}, YEAR_REFRESH_LOCK_SECONDS):
            skipped.append(year)
            continue
        _refresh_year_cache(year)
        refreshed.append(year)
    return {"refreshedYears": refreshed, "skippedYears": skipped}


def get_buzzwatch_preference(user_id: str) -> Dict[str, Any]:
    cache_key = f"buzzwatch:{RESPONSE_CACHE_VERSION}:preference:{cache_token(user_id)}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    preference = col(BUZZWATCH_PREFERENCES_COLLECTION).find_one({"userId": user_id})
    if not preference:
        result = {
            "exists": False,
            "genreKeys": [],
            "genres": GENRES,
        }
    else:
        result = {
            "exists": True,
            "genreKeys": preference.get("genreKeys") or [],
            "genres": GENRES,
            "createdAt": preference.get("createdAt"),
            "updatedAt": preference.get("updatedAt"),
        }
    cache_set(cache_key, result, PREFERENCE_CACHE_SECONDS)
    return result


def get_buzzwatch_genres() -> Dict[str, Any]:
    cache_key = f"buzzwatch:{RESPONSE_CACHE_VERSION}:genres"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    result = {"genres": GENRES}
    cache_set(cache_key, result, PEOPLE_SEARCH_CACHE_SECONDS)
    return result


def save_buzzwatch_preference(user_id: str, genre_keys: Iterable[str]) -> Dict[str, Any]:
    valid = _valid_genre_keys(genre_keys)
    if not valid:
        raise ValueError("Choose at least one genre")
    existing = col(BUZZWATCH_PREFERENCES_COLLECTION).find_one({"userId": user_id})
    now = now_iso()
    record = {
        "userId": user_id,
        "genreKeys": valid,
        "updatedAt": now,
        "createdAt": existing.get("createdAt") if existing else now,
    }
    col(BUZZWATCH_PREFERENCES_COLLECTION).replace_one({"userId": user_id}, record, upsert=True)
    user_token = cache_token(user_id)
    preference = {
        "exists": True,
        "genreKeys": valid,
        "genres": GENRES,
        "createdAt": record["createdAt"],
        "updatedAt": record["updatedAt"],
    }
    cache_set(f"buzzwatch:{RESPONSE_CACHE_VERSION}:preference:{user_token}", preference, PREFERENCE_CACHE_SECONDS)
    cache_delete_pattern(f"buzzwatch:{RESPONSE_CACHE_VERSION}:items:{user_token}:*")
    cache_delete_pattern(f"buzzwatch:{RESPONSE_CACHE_VERSION}:credits:{user_token}:*")
    return preference


def _match_score(item: Dict[str, Any], selected_genres: List[str]) -> int:
    selected = set(selected_genres)
    item_genres = set(item.get("genreKeys") or [])
    if selected and item_genres:
        overlap = len(selected.intersection(item_genres))
        genre_score = min(72, round((overlap / max(1, min(len(selected), len(item_genres)))) * 72))
    elif selected:
        genre_score = 18
    else:
        genre_score = 55

    rating_value = item.get("rtScore")
    if rating_value is None and item.get("tmdbRating") is not None:
        rating_value = float(item.get("tmdbRating") or 0) * 10
    if rating_value is None and item.get("imdbRating") is not None:
        rating_value = float(item.get("imdbRating") or 0) * 10
    rating_score = min(18, round((float(rating_value or 0) / 100) * 18))

    imdb_votes = int(item.get("imdbVoteCount") or 0)
    if imdb_votes > 0:
        buzz_score = min(10, round((math.log10(imdb_votes) / 6) * 10))
    else:
        buzz_value = float(item.get("buzzScore") or item.get("popularity") or 0)
        buzz_score = min(10, round(buzz_value / 16))
    return max(1, min(100, genre_score + rating_score + buzz_score))


def _with_match_metadata(item: Dict[str, Any], selected_genres: List[str]) -> Dict[str, Any]:
    enriched = dict(item)
    matched = sorted(set(item.get("genreKeys") or []).intersection(selected_genres))
    enriched["matchedGenreKeys"] = matched
    enriched["matchScore"] = _match_score(item, selected_genres)
    buzz_score = max(0, min(100, round(float(item.get("buzzScore") or 0))))
    if item.get("catalogScope") == LATEST_CATALOG_SCOPE:
        enriched["recommendationScore"] = round((buzz_score * 0.72) + (enriched["matchScore"] * 0.28))
        reasons = list(item.get("buzzReasons") or [])
        matched_names = [
            genre["name"]
            for genre in GENRES
            if genre["key"] in matched
        ]
        if matched_names:
            reasons.insert(0, f"Matches your {' + '.join(matched_names[:2])} taste")
        enriched["recommendationReasons"] = list(dict.fromkeys(reasons))[:3]
        score = enriched["recommendationScore"]
        enriched["recommendationLabel"] = (
            "Must watch" if score >= 85 else
            "Strong pick" if score >= 72 else
            "Worth a look" if score >= 58 else
            "Niche pick"
        )
    return enriched


def _latest_catalog_insights(items: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    provider_counts = Counter(
        provider.get("name")
        for item in items
        for provider in item.get("providers") or []
        if provider.get("name")
    )
    provider_logos = {
        provider.get("name"): provider.get("logoUrl")
        for item in items
        for provider in item.get("providers") or []
        if provider.get("name")
    }
    genre_counts = Counter(
        genre
        for item in items
        for genre in item.get("genres") or []
        if genre
    )
    scores = [float(item.get("buzzScore") or 0) for item in items]
    return {
        "windowDays": int(meta.get("windowDays") or LATEST_WINDOW_DAYS),
        "windowStart": meta.get("windowStart"),
        "windowEnd": meta.get("windowEnd"),
        "watchRegion": meta.get("watchRegion") or WATCH_REGION,
        "totalTitles": len(items),
        "movieCount": sum(1 for item in items if item.get("mediaType") == "movie"),
        "seriesCount": sum(1 for item in items if item.get("mediaType") == "series"),
        "averageBuzz": round(sum(scores) / len(scores)) if scores else 0,
        "highConfidenceTitles": sum(1 for item in items if item.get("buzzConfidence") == "high"),
        "providerCounts": [
            {"name": name, "count": count, "logoUrl": provider_logos.get(name)}
            for name, count in provider_counts.most_common()
        ],
        "topGenres": [
            {"name": name, "count": count}
            for name, count in genre_counts.most_common(6)
        ],
        "methodology": (
            "Buzz combines Bayesian viewer quality, rating confidence, popularity momentum, "
            "freshness, and streaming availability. Scores are capped at 100."
        ),
        "availabilitySource": "JustWatch via TMDB",
    }


def list_buzzwatch_items(
    user_id: str,
    mode: str = "recent",
    year: Optional[str] = None,
    media_type: str = "all",
    limit: int = 60,
) -> Dict[str, Any]:
    mode = "year" if mode == "year" else "recent"
    media_type = media_type if media_type in {"movie", "series"} else "all"
    user_token = cache_token(user_id)
    response_key = ":".join(
        [
            "buzzwatch",
            RESPONSE_CACHE_VERSION,
            "items",
            user_token,
            mode,
            str(year or "all"),
            media_type,
            str(max(1, min(limit, 240))),
        ]
    )
    cached_response = cache_get(response_key)
    if cached_response is not None:
        cached_response.setdefault("cache", {})
        cached_response["cache"].update({"responseHit": True, "layer": "redis"})
        return cached_response

    preference = get_buzzwatch_preference(user_id)
    selected_genres = _valid_genre_keys(preference.get("genreKeys") or [])
    year_source = HYBRID_SOURCE if _tmdb_configured() else IMDB_SOURCE
    year_source_version = HYBRID_SOURCE_VERSION if _tmdb_configured() else IMDB_SOURCE_VERSION
    year_cache_hit = False
    serving_stale_year = False
    year_refresh_queued = False
    use_current_year_source = True
    if mode == "year" and year and year != "all":
        requested_types = [media_type] if media_type != "all" else ["movie", "series"]
        year_cache_hit = _year_cache_is_fresh(
            str(year),
            year_source,
            year_source_version,
            requested_types,
        )
        if not year_cache_hit:
            stale_query: Dict[str, Any] = {"year": str(year)}
            if media_type != "all":
                stale_query["mediaType"] = media_type
            current_query = {
                **stale_query,
                "source": year_source,
                "sourceVersion": year_source_version,
            }
            current_docs_exist = col(BUZZWATCH_ITEMS_COLLECTION).count_documents(current_query, limit=1) > 0
            any_docs_exist = current_docs_exist or col(BUZZWATCH_ITEMS_COLLECTION).count_documents(stale_query, limit=1) > 0
            if any_docs_exist:
                serving_stale_year = True
                use_current_year_source = current_docs_exist
                year_refresh_queued = _schedule_year_refresh(str(year))
            else:
                _refresh_year_cache(str(year))

    query: Dict[str, Any] = {}
    if mode == "year" and year and year != "all":
        query["year"] = year
        if use_current_year_source:
            query["source"] = year_source
            query["sourceVersion"] = year_source_version
    elif mode == "recent":
        cutoff = (_utc_now() - timedelta(days=LATEST_WINDOW_DAYS)).strftime("%Y-%m-%d")
        query["catalogScope"] = LATEST_CATALOG_SCOPE
        query["releaseDate"] = {"$gte": cutoff}
    if media_type != "all":
        query["mediaType"] = media_type

    docs = [jsonable(doc) for doc in col(BUZZWATCH_ITEMS_COLLECTION).find(query)]
    filtered = [_with_match_metadata(doc, selected_genres) for doc in docs if _matches_genres(doc, selected_genres)]
    filtered.sort(
        key=lambda item: (
            item.get("recommendationScore") or item.get("matchScore") or 0,
            item.get("buzzScore") or 0,
            item.get("releaseDate") or "",
        ),
        reverse=True,
    )
    result_limit = YEAR_RESULT_TARGET if mode == "year" else max(1, min(limit, 80))
    limited = filtered[:result_limit]

    recent_cutoff = (_utc_now() - timedelta(days=LATEST_WINDOW_DAYS)).strftime("%Y-%m-%d")
    recent_query: Dict[str, Any] = {
        "catalogScope": LATEST_CATALOG_SCOPE,
        "releaseDate": {"$gte": recent_cutoff},
    }
    if media_type != "all":
        recent_query["mediaType"] = media_type
    recent_docs = [jsonable(doc) for doc in col(BUZZWATCH_ITEMS_COLLECTION).find(recent_query)]
    recent = [
        _with_match_metadata(doc, selected_genres)
        for doc in recent_docs
        if _matches_genres(doc, selected_genres)
    ]
    recent.sort(
        key=lambda item: (
            item.get("recommendationScore") or item.get("matchScore") or 0,
            item.get("buzzScore") or 0,
            item.get("releaseDate") or "",
        ),
        reverse=True,
    )
    recent = recent[:24]

    meta_key = f"buzzwatch-year-{year}" if mode == "year" and year and year != "all" else "buzzwatch-refresh"
    meta = jsonable(col(BUZZWATCH_META_COLLECTION).find_one({"key": meta_key}) or {})
    insight_docs = [
        jsonable(doc)
        for doc in col(BUZZWATCH_ITEMS_COLLECTION).find(
            {"catalogScope": LATEST_CATALOG_SCOPE, "releaseDate": {"$gte": recent_cutoff}}
        )
    ]
    insights = _latest_catalog_insights(insight_docs, meta) if mode == "recent" else None
    result = {
        "genres": GENRES,
        "preference": preference,
        "mode": mode,
        "year": year if mode == "year" else None,
        "mediaType": media_type,
        "items": limited,
        "recent": recent,
        "insights": insights,
        "years": static_year_options(),
        "stats": {
            "totalMatches": len(filtered),
            "shown": len(limited),
            "recent": len(recent),
            "rated": len(
                [
                    item
                    for item in filtered
                    if item.get("rtScore") is not None
                    or item.get("tmdbRating") is not None
                    or item.get("imdbRating") is not None
                ]
            ),
            "withRottenTomatoes": len([item for item in filtered if item.get("rtScore") is not None]),
            "providers": len((insights or {}).get("providerCounts") or []),
            "averageBuzz": (insights or {}).get("averageBuzz") or 0,
        },
        "lastUpdatedAt": meta.get("lastUpdatedAt"),
        "ratingProvider": year_source if mode == "year" else meta.get("ratingProvider") or "Not refreshed yet",
        "cache": {
            "hit": year_cache_hit,
            "responseHit": False,
            "layer": "mongo-stale" if serving_stale_year else "mongo",
            "ttlHours": YEAR_CACHE_TTL_HOURS,
            "scope": f"year:{year}" if mode == "year" else "recent",
            "servingStale": serving_stale_year,
            "refreshQueued": year_refresh_queued,
        },
    }
    response_ttl = (
        YEAR_STALE_RESPONSE_CACHE_SECONDS
        if serving_stale_year
        else YEAR_RESPONSE_CACHE_SECONDS
        if mode == "year"
        else RECENT_RESPONSE_CACHE_SECONDS
    )
    cache_set(response_key, result, response_ttl)
    return result


def _has_moviehub_access(user: Dict[str, str]) -> bool:
    if str(user.get("role") or "").upper() == "ADMIN":
        return True
    db_user = find_one("users", {"userId": user["userId"]}) or {}
    email = db_user.get("email") or user.get("email", "")
    return bool(find_one(MOVIEHUB_ACCESS_USERS_COLLECTION, {"userEmail": email, "active": True}))


def _cached_title_details(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    cache = item.get("detailCache") or {}
    try:
        fetched_at = datetime.fromisoformat(str(cache.get("fetchedAt") or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    if fetched_at < _utc_now() - timedelta(hours=TITLE_DETAILS_CACHE_TTL_HOURS):
        return None
    return cache.get("value") or None


def _resolve_title_tmdb_id(item: Dict[str, Any]) -> Optional[int]:
    if item.get("tmdbId"):
        return int(item["tmdbId"])
    media_type = "movie" if item.get("mediaType") == "movie" else "tv"
    title = str(item.get("title") or "").strip()
    params: Dict[str, Any] = {"query": title, "include_adult": "false"}
    if item.get("year"):
        params["year" if media_type == "movie" else "first_air_date_year"] = item["year"]
    search_path = f"/search/{media_type}"
    results = _tmdb_get(search_path, params).get("results") or []
    if not results and item.get("year"):
        results = _tmdb_get(search_path, {"query": title, "include_adult": "false"}).get("results") or []
    if not results:
        simplified = re.sub(r"[^\w\s]", " ", title)
        simplified = re.sub(r"\s+", " ", simplified).strip()
        if simplified and simplified != title:
            results = _tmdb_get(search_path, {"query": simplified, "include_adult": "false"}).get("results") or []
    return int(results[0]["id"]) if results else None


def _title_certification(details: Dict[str, Any], media_type: str) -> Optional[str]:
    if media_type == "movie":
        rows = (details.get("release_dates") or {}).get("results") or []
        countries = sorted(rows, key=lambda row: row.get("iso_3166_1") != "US")
        for country in countries:
            for release in country.get("release_dates") or []:
                if release.get("certification"):
                    return release["certification"]
    else:
        rows = (details.get("content_ratings") or {}).get("results") or []
        countries = sorted(rows, key=lambda row: row.get("iso_3166_1") != "US")
        for row in countries:
            if row.get("rating"):
                return row["rating"]
    return None


def get_buzzwatch_item_details(item_id: str) -> Dict[str, Any]:
    response_key = f"buzzwatch:{RESPONSE_CACHE_VERSION}:details:{cache_token(item_id)}"
    redis_cached = cache_get(response_key)
    if redis_cached is not None:
        redis_cached["cache"] = {"hit": True, "layer": "redis", "ttlHours": TITLE_DETAILS_CACHE_TTL_HOURS}
        return redis_cached
    item = jsonable(col(BUZZWATCH_ITEMS_COLLECTION).find_one({"itemId": item_id}) or {})
    if not item:
        raise ValueError("BuzzWatch title was not found")
    cached = _cached_title_details(item)
    if cached:
        result = {**cached, "cache": {"hit": True, "layer": "mongo", "ttlHours": TITLE_DETAILS_CACHE_TTL_HOURS}}
        cache_set(response_key, result, TITLE_DETAILS_CACHE_TTL_HOURS * 3600)
        return result
    if not _tmdb_configured():
        raise RuntimeError("TMDB is not configured")

    tmdb_id = _resolve_title_tmdb_id(item)
    if not tmdb_id:
        raise ValueError("Details are not available for this title")
    media_type = "movie" if item.get("mediaType") == "movie" else "tv"
    details = _tmdb_get(
        f"/{media_type}/{tmdb_id}",
        {"append_to_response": "credits,external_ids,content_ratings,release_dates"},
    )
    imdb_id = ((details.get("external_ids") or {}).get("imdb_id") or item.get("imdbId"))
    crew = (details.get("credits") or {}).get("crew") or []
    creators = [
        person.get("name")
        for person in crew
        if person.get("job") in {"Director", "Creator"} and person.get("name")
    ]
    creators.extend(
        person.get("name")
        for person in details.get("created_by") or []
        if person.get("name")
    )
    runtime = details.get("runtime")
    if not runtime:
        runtime = next(iter(details.get("episode_run_time") or []), None)
    value = {
        "itemId": item_id,
        "tmdbId": tmdb_id,
        "imdbId": imdb_id,
        "title": details.get("title") or details.get("name") or item.get("title"),
        "mediaType": item.get("mediaType"),
        "tagline": details.get("tagline") or "",
        "overview": details.get("overview") or item.get("overview") or "",
        "posterUrl": f"{TMDB_IMAGE_BASE}{details.get('poster_path')}" if details.get("poster_path") else item.get("posterUrl"),
        "backdropUrl": f"{TMDB_IMAGE_BASE}{details.get('backdrop_path')}" if details.get("backdrop_path") else item.get("backdropUrl"),
        "releaseDate": details.get("release_date") or details.get("first_air_date") or item.get("releaseDate"),
        "genres": [genre.get("name") for genre in details.get("genres") or [] if genre.get("name")],
        "rating": round(float(details.get("vote_average") or 0), 1),
        "voteCount": int(details.get("vote_count") or 0),
        "runtimeMinutes": runtime,
        "status": details.get("status"),
        "certification": _title_certification(details, media_type),
        "numberOfSeasons": details.get("number_of_seasons"),
        "creators": list(dict.fromkeys(creators))[:4],
        "cast": [
            {
                "personId": person.get("id"),
                "name": person.get("name"),
                "character": person.get("character") or "",
                "profileUrl": f"{TMDB_IMAGE_BASE}{person.get('profile_path')}" if person.get("profile_path") else None,
            }
            for person in ((details.get("credits") or {}).get("cast") or [])[:12]
            if person.get("name")
        ],
        "parentsGuide": _imdb_parents_guide(imdb_id),
        "parentsGuideSource": "IMDb community parental guide",
    }
    fetched_at = now_iso()
    col(BUZZWATCH_ITEMS_COLLECTION).update_one(
        {"itemId": item_id},
        {"$set": {"tmdbId": tmdb_id, "imdbId": imdb_id, "detailCache": {"fetchedAt": fetched_at, "value": value}}},
    )
    result = {**value, "cache": {"hit": False, "layer": "upstream", "ttlHours": TITLE_DETAILS_CACHE_TTL_HOURS}}
    cache_set(response_key, result, TITLE_DETAILS_CACHE_TTL_HOURS * 3600)
    return result


def request_buzzwatch_item(user: Dict[str, str], item_id: str) -> Dict[str, Any]:
    if not _has_moviehub_access(user):
        raise PermissionError("Connect your MovieHub account before requesting titles from BuzzWatch")
    item = jsonable(col(BUZZWATCH_ITEMS_COLLECTION).find_one({"itemId": item_id}) or {})
    if not item:
        raise ValueError("BuzzWatch title was not found")
    title = str(item.get("title") or "").strip()
    if not title:
        raise ValueError("BuzzWatch title is missing a title")

    media_type = "MOVIES" if item.get("mediaType") == "movie" else "SHOWS"
    payload: Dict[str, Any] = {
        "title": title,
        "mediaType": media_type,
        "qualityProfileId": "any",
        "tmdbId": item.get("tmdbId") or None,
        "imdbId": item.get("imdbId") or None,
    }
    if media_type == "SHOWS":
        latest_season = int(item.get("latestSeasonNumber") or 1)
        payload["season"] = [max(1, latest_season)]

    is_admin = str(user.get("role") or "").upper() == "ADMIN"
    if is_admin:
        record = create_approved_request_from_automation(user["userId"], payload)
        message = "Request approved and queued for download"
    else:
        record = create_request_from_automation(user["userId"], payload)
        message = "Request submitted for approval"

    return {
        "message": message,
        "requestId": record.get("requestId"),
        "status": record.get("status"),
        "title": record.get("title"),
        "mediaType": record.get("mediaType"),
        "season": record.get("season") or [],
        "autoApproved": is_admin,
        "notification": record.get("notification"),
    }
