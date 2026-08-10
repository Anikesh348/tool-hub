import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
from fastapi.responses import JSONResponse

from app.services.mail import send_brevo_email
from app.services.mongo import col, find, find_one, insert
from app.services.notifications import emit_notification
from app.services.redis_cache import cache_get, cache_set, cache_token
from app.utils.responses import error, jsonable, now_iso, success


FLIGHT_WATCHES_COLLECTION = "flightwatches"
FLIGHT_HISTORY_COLLECTION = "flighthistory"
FLIGHT_ALERT_STATE_COLLECTION = "flight-alert-state"
SUPPORTED_CABINS = {"ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"}
IATA_RE = re.compile(r"^[A-Z]{3}$")
_SCRAPER_SESSION_LOCAL = threading.local()
FLIGHT_PLACE_CACHE_SECONDS = int(os.getenv("FLIGHT_PLACE_CACHE_SECONDS", "86400"))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _scraper_base_url() -> str:
    return os.getenv("SCRAPPER_FLIGHT_URL", os.getenv("SCRAPPER_SEARCH_URL", "http://scraper-beautifulsoup:8001")).rstrip("/")


def _scraper_url(path: str) -> str:
    base = _scraper_base_url()
    if base.endswith("/v2/search"):
        base = base[: -len("/v2/search")]
    return urljoin(base.rstrip("/") + "/", path.lstrip("/"))


def _scraper_session() -> requests.Session:
    session = getattr(_SCRAPER_SESSION_LOCAL, "session", None)
    if session is None:
        session = requests.Session()
        _SCRAPER_SESSION_LOCAL.session = session
    return session


def _normalize_iata(value: Any) -> str:
    code = str(value or "").strip().upper()
    if not IATA_RE.match(code):
        raise ValueError("Choose a city or airport from the search results")
    return code


def _normalize_date(value: Any, label: str) -> str:
    text = str(value or "").strip()
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"{label} must use YYYY-MM-DD") from exc
    if parsed < _utc_now().date():
        raise ValueError(f"{label} cannot be in the past")
    return parsed.isoformat()


def _normalize_positive_int(value: Any, label: str, default: int, minimum: int = 0, maximum: int = 9) -> int:
    if value in (None, ""):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number") from exc
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return parsed


def _normalize_threshold(value: Any) -> float:
    try:
        parsed = float(str(value or "").strip())
    except ValueError as exc:
        raise ValueError("Threshold price must be a number") from exc
    if parsed <= 0:
        raise ValueError("Threshold price must be greater than 0")
    return round(parsed, 2)


def _normalize_currency(value: Any) -> str:
    currency = str(value or "INR").strip().upper()
    if not re.match(r"^[A-Z]{3}$", currency):
        raise ValueError("Currency must be a 3-letter code")
    return currency


def _normalize_watch_body(body: Dict[str, Any], user: Dict[str, str]) -> Dict[str, Any]:
    origin = _normalize_iata(body.get("origin"))
    destination = _normalize_iata(body.get("destination"))
    if origin == destination:
        raise ValueError("Origin and destination must be different")

    departure_date = _normalize_date(body.get("departureDate"), "Departure date")
    return_date = str(body.get("returnDate") or "").strip()
    if return_date:
        return_date = _normalize_date(return_date, "Return date")
        if return_date < departure_date:
            raise ValueError("Return date cannot be before departure date")

    cabin = str(body.get("cabin") or "ECONOMY").strip().upper()
    if cabin not in SUPPORTED_CABINS:
        raise ValueError("Cabin must be ECONOMY, PREMIUM_ECONOMY, BUSINESS, or FIRST")

    adults = _normalize_positive_int(body.get("adults"), "Adults", 1, 1, 9)
    children = _normalize_positive_int(body.get("children"), "Children", 0, 0, 9)
    infants = _normalize_positive_int(body.get("infants"), "Infants", 0, 0, adults)
    max_stops = body.get("maxStops")
    normalized_max_stops = None
    if max_stops not in (None, ""):
        normalized_max_stops = _normalize_positive_int(max_stops, "Max stops", 0, 0, 3)

    now = now_iso()
    return {
        "watchId": uuid.uuid4().hex,
        "userId": user["userId"],
        "userEmail": user.get("email", ""),
        "origin": origin,
        "originLabel": str(body.get("originLabel") or origin).strip()[:120],
        "destination": destination,
        "destinationLabel": str(body.get("destinationLabel") or destination).strip()[:120],
        "departureDate": departure_date,
        "returnDate": return_date,
        "tripType": "return" if return_date else "one-way",
        "adults": adults,
        "children": children,
        "infants": infants,
        "cabin": cabin,
        "currency": _normalize_currency(body.get("currency")),
        "thresholdPrice": _normalize_threshold(body.get("thresholdPrice")),
        "maxStops": normalized_max_stops,
        "note": str(body.get("note") or "").strip()[:160],
        "active": True,
        "provider": "skyscanner-scraper",
        "createdAt": now,
        "updatedAt": now,
    }


def provider_status() -> Dict[str, Any]:
    return {
        "provider": "multi-provider-flight-scraper",
        "configured": True,
        "baseUrl": _scraper_base_url(),
        "note": "Uses ToolHub scraper container with Kiwi, Google Flights, and Skyscanner fallbacks when available.",
    }


def _cached_place_search(query: str, limit: int) -> Dict[str, Any]:
    cache_key = f"toolhub:v1:flight-places:{cache_token(query)}:{limit}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    response = _scraper_session().get(
        _scraper_url("/v2/flights/places"),
        params={"query": query, "limit": limit},
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    cache_set(cache_key, payload, FLIGHT_PLACE_CACHE_SECONDS)
    return payload


def search_flight_places(query: str, limit: int = 12) -> Dict[str, Any]:
    normalized_query = re.sub(r"\s+", " ", str(query or "").strip())
    safe_limit = max(1, min(int(limit or 12), 25))
    if len(normalized_query) < 2:
        return {"query": normalized_query, "results": []}
    try:
        return _cached_place_search(normalized_query.lower(), safe_limit)
    except Exception as exc:
        return {"query": normalized_query, "results": [], "error": str(exc)}


def _normalize_offer(raw_offer: Dict[str, Any], watch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        price = float(raw_offer.get("price") or 0)
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None
    return {
        "price": round(price, 2),
        "currency": str(raw_offer.get("currency") or watch.get("currency", "INR")).upper(),
        "airlines": raw_offer.get("airlines") or [],
        "stops": raw_offer.get("stops"),
        "departureAt": raw_offer.get("departureAt"),
        "arrivalAt": raw_offer.get("arrivalAt"),
        "sourceUrl": raw_offer.get("sourceUrl") or raw_offer.get("url"),
        "fetchedUrl": raw_offer.get("fetchedUrl"),
        "provider": raw_offer.get("provider") or raw_offer.get("source") or "flight-price-provider",
        "source": raw_offer.get("source"),
    }


def _sort_offers(offers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: Dict[tuple, Dict[str, Any]] = {}
    for offer in offers:
        key = (
            offer.get("price"),
            offer.get("currency"),
            ",".join(sorted(map(str, offer.get("airlines") or []))),
            offer.get("stops"),
            offer.get("departureAt"),
            offer.get("arrivalAt"),
            offer.get("provider"),
        )
        deduped[key] = offer
    return sorted(deduped.values(), key=lambda item: float(item.get("price") or 0))[:8]


def fetch_lowest_flight_offer(watch: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "origin": watch["origin"],
        "destination": watch["destination"],
        "departureDate": watch["departureDate"],
        "returnDate": watch.get("returnDate") or None,
        "adults": watch.get("adults", 1),
        "children": watch.get("children", 0),
        "infants": watch.get("infants", 0),
        "cabin": watch.get("cabin", "ECONOMY"),
        "currency": watch.get("currency", "INR"),
        "maxStops": watch.get("maxStops"),
    }
    response = _scraper_session().post(_scraper_url("/v2/flights/search"), json=payload, timeout=55)
    try:
        result = response.json()
    except Exception as exc:
        raise RuntimeError(f"Flight scraper returned invalid JSON: {exc}") from exc

    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(result.get("error") or f"Flight scraper returned HTTP {response.status_code}")
    if result.get("status") != "success":
        message = result.get("error") or "Flight scraper could not find a fare"
        if result.get("url"):
            message = f"{message} URL: {result.get('url')}"
        raise RuntimeError(message)

    price = float(result.get("price") or 0)
    if price <= 0:
        raise RuntimeError("Flight scraper did not return a valid price")

    offers = [
        offer
        for offer in (_normalize_offer(raw_offer, watch) for raw_offer in (result.get("offers") or []))
        if offer
    ]
    return {
        "price": round(price, 2),
        "currency": result.get("currency") or watch.get("currency", "INR"),
        "airlines": result.get("airlines") or [],
        "stops": result.get("stops"),
        "departureAt": result.get("departureAt"),
        "arrivalAt": result.get("arrivalAt"),
        "sourceUrl": result.get("url"),
        "fetchedUrl": result.get("fetchedUrl"),
        "rawProvider": result.get("provider") or "flight-price-provider",
        "offers": _sort_offers(offers) or [
            {
                "price": round(price, 2),
                "currency": result.get("currency") or watch.get("currency", "INR"),
                "airlines": result.get("airlines") or [],
                "stops": result.get("stops"),
                "departureAt": result.get("departureAt"),
                "arrivalAt": result.get("arrivalAt"),
                "sourceUrl": result.get("url"),
                "fetchedUrl": result.get("fetchedUrl"),
                "provider": result.get("provider") or "flight-price-provider",
                "source": result.get("source"),
            }
        ],
    }


def _history_record(watch: Dict[str, Any], result: Dict[str, Any], status: str = "ok", message: str = "") -> Dict[str, Any]:
    return {
        "historyId": uuid.uuid4().hex,
        "watchId": watch.get("watchId"),
        "userId": watch.get("userId"),
        "origin": watch.get("origin"),
        "originLabel": watch.get("originLabel"),
        "destination": watch.get("destination"),
        "destinationLabel": watch.get("destinationLabel"),
        "departureDate": watch.get("departureDate"),
        "returnDate": watch.get("returnDate"),
        "tripType": watch.get("tripType"),
        "price": result.get("price"),
        "currency": result.get("currency") or watch.get("currency"),
        "airlines": result.get("airlines", []),
        "stops": result.get("stops"),
        "sourceUrl": result.get("sourceUrl"),
        "provider": result.get("rawProvider"),
        "offers": result.get("offers", []),
        "status": status,
        "message": message,
        "createdAt": now_iso(),
    }


def create_flight_watch(body: Dict[str, Any], user: Dict[str, str]):
    try:
        watch = _normalize_watch_body(body, user)
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))
    insert(FLIGHT_WATCHES_COLLECTION, watch)
    try:
        return success(check_flight_watch(watch)["watch"])
    except Exception as exc:
        message = str(exc)
        _record_failed_check(watch, message)
        return success({**watch, "lastError": message, "lastCheckedAt": now_iso()})


def get_flight_watches(user: Dict[str, str]) -> List[Dict[str, Any]]:
    watches = find(FLIGHT_WATCHES_COLLECTION, {"userId": user["userId"]})
    watches.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return watches


def get_flight_watch(watch_id: str, user: Dict[str, str]):
    watch = find_one(FLIGHT_WATCHES_COLLECTION, {"watchId": watch_id, "userId": user["userId"]})
    if not watch:
        return JSONResponse(status_code=404, content=error("Flight watch not found"))
    return watch


def get_flight_history(watch_id: str, user: Dict[str, str]) -> List[Dict[str, Any]]:
    if not find_one(FLIGHT_WATCHES_COLLECTION, {"watchId": watch_id, "userId": user["userId"]}):
        return []
    records = find(FLIGHT_HISTORY_COLLECTION, {"watchId": watch_id, "userId": user["userId"]})
    records.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return records[:120]


def delete_flight_watch(watch_id: str, user: Dict[str, str]):
    col(FLIGHT_WATCHES_COLLECTION).delete_one({"watchId": watch_id, "userId": user["userId"]})
    col(FLIGHT_ALERT_STATE_COLLECTION).delete_many({"watchId": watch_id, "userId": user["userId"]})
    return success("Flight watch deleted")


def _format_money(value: Any, currency: str) -> str:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return f"{value} {currency}".strip()
    return f"{currency} {amount:,.2f}"


def _route_label(watch: Dict[str, Any]) -> str:
    origin = watch.get("originLabel") or watch.get("origin")
    destination = watch.get("destinationLabel") or watch.get("destination")
    dates = watch.get("departureDate", "")
    if watch.get("returnDate"):
        dates = f"{dates} to {watch.get('returnDate')}"
    return f"{origin} to {destination} on {dates}"


def _build_flight_alert_email(watch: Dict[str, Any], result: Dict[str, Any]) -> str:
    route = escape(_route_label(watch))
    price = escape(_format_money(result.get("price"), result.get("currency") or watch.get("currency", "INR")))
    threshold = escape(_format_money(watch.get("thresholdPrice"), watch.get("currency", "INR")))
    cabin = escape(str(watch.get("cabin", "ECONOMY")).replace("_", " ").title())
    source_url = escape(str(result.get("sourceUrl") or ""))
    link = f'<p><a href="{source_url}" target="_blank" rel="noopener noreferrer">Open Skyscanner search</a></p>' if source_url else ""
    return f"""
<html>
  <body style="font-family: Arial, sans-serif; line-height:1.6; color:#1f2937;">
    <h3 style="margin-bottom: 8px;">Flight price alert</h3>
    <p><strong>{route}</strong> is now available at <strong style="color:#047857;">{price}</strong>.</p>
    <p>Your alert threshold is <strong>{threshold}</strong>.</p>
    <p>Cabin: {cabin}</p>
    <p>Provider: {escape(str(result.get("rawProvider") or result.get("provider") or "flight-price-provider"))}</p>
    {link}
  </body>
</html>
"""


def _send_alert_if_needed(watch: Dict[str, Any], result: Dict[str, Any]) -> bool:
    price = float(result.get("price") or 0)
    threshold = float(watch.get("thresholdPrice") or 0)
    state_query = {"watchId": watch.get("watchId"), "userId": watch.get("userId")}
    state = find_one(FLIGHT_ALERT_STATE_COLLECTION, state_query) or {}
    checked_at = now_iso()

    if price > threshold:
        col(FLIGHT_ALERT_STATE_COLLECTION).update_one(
            state_query,
            {"$set": {"active": False, "lastSeenPrice": price, "lastCheckedAt": checked_at, "updatedAt": checked_at}, "$setOnInsert": {"createdAt": checked_at}},
            upsert=True,
        )
        return False

    should_alert = not state.get("active") or price < float(state.get("lastAlertedPrice") or threshold + 1)
    if not should_alert:
        col(FLIGHT_ALERT_STATE_COLLECTION).update_one(
            state_query,
            {"$set": {"lastSeenPrice": price, "lastCheckedAt": checked_at, "updatedAt": checked_at}, "$setOnInsert": {"createdAt": checked_at}},
            upsert=True,
        )
        return False

    recipient = (watch.get("userEmail") or "").strip()
    if not recipient:
        user = find_one("users", {"userId": watch.get("userId")}) or {}
        recipient = (user.get("email") or "").strip()
    if not recipient:
        return False

    alert_title = f"Flight drop: {_route_label(watch)} is {_format_money(price, result.get('currency') or watch.get('currency', 'INR'))}"
    send_brevo_email(alert_title, recipient, _build_flight_alert_email(watch, result))
    emit_notification(
        audience="ADMIN",
        title=alert_title,
        message=f"Threshold was {_format_money(threshold, result.get('currency') or watch.get('currency', 'INR'))}. Notified {recipient}.",
        severity="SUCCESS",
        category="price_alert",
        source="flights",
        action_url="/flights",
        metadata={"watchId": watch.get("watchId")},
    )
    col(FLIGHT_ALERT_STATE_COLLECTION).update_one(
        state_query,
        {
            "$set": {
                "active": True,
                "thresholdPrice": threshold,
                "lastAlertedPrice": price,
                "lastSeenPrice": price,
                "lastAlertedAt": checked_at,
                "lastCheckedAt": checked_at,
                "updatedAt": checked_at,
            },
            "$setOnInsert": {"createdAt": checked_at},
        },
        upsert=True,
    )
    return True


def check_flight_watch(watch: Dict[str, Any]) -> Dict[str, Any]:
    result = fetch_lowest_flight_offer(watch)
    history = _history_record(watch, result)
    insert(FLIGHT_HISTORY_COLLECTION, history)
    alerted = _send_alert_if_needed(watch, result)
    now = now_iso()
    update = {
        "lastPrice": result["price"],
        "lastCurrency": result["currency"],
        "lastAirlines": result.get("airlines", []),
        "lastStops": result.get("stops"),
        "sourceUrl": result.get("sourceUrl"),
        "lastProvider": result.get("rawProvider"),
        "lastOffers": result.get("offers", []),
        "lastCheckedAt": now,
        "lastError": "",
        "updatedAt": now,
    }
    if alerted:
        update["lastAlertedAt"] = now
    col(FLIGHT_WATCHES_COLLECTION).update_one({"watchId": watch["watchId"]}, {"$set": update})
    return {"watch": jsonable({**watch, **update}), "history": jsonable(history), "alerted": alerted}


def _record_failed_check(watch: Dict[str, Any], message: str) -> None:
    now = now_iso()
    insert(FLIGHT_HISTORY_COLLECTION, _history_record(watch, {}, "error", message))
    col(FLIGHT_WATCHES_COLLECTION).update_one(
        {"watchId": watch.get("watchId")},
        {"$set": {"lastError": message, "lastCheckedAt": now, "updatedAt": now}},
    )


def _relevant_travel_date(watch: Dict[str, Any]) -> str:
    # A round trip is only truly "done" once the return leg has passed; a
    # one-way trip is done once its single departure has passed.
    return watch.get("returnDate") or watch.get("departureDate") or ""


def _is_expired(watch: Dict[str, Any]) -> bool:
    date_str = _relevant_travel_date(watch)
    if not date_str:
        return False
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date() < _utc_now().date()
    except ValueError:
        return False


def _retire_expired_watch(watch: Dict[str, Any]) -> None:
    now = now_iso()
    col(FLIGHT_WATCHES_COLLECTION).update_one(
        {"watchId": watch.get("watchId")},
        {"$set": {"active": False, "expired": True, "lastError": "", "lastCheckedAt": now, "updatedAt": now}},
    )


def check_one_flight_watch(watch_id: str, user: Dict[str, str]):
    watch = find_one(FLIGHT_WATCHES_COLLECTION, {"watchId": watch_id, "userId": user["userId"]})
    if not watch:
        return JSONResponse(status_code=404, content=error("Flight watch not found"))
    if _is_expired(watch):
        _retire_expired_watch(watch)
        return JSONResponse(
            status_code=400,
            content=error("This trip's date has already passed. Create a new watch with an upcoming date to keep tracking this route."),
        )
    try:
        return success(check_flight_watch(watch))
    except Exception as exc:
        message = str(exc)
        _record_failed_check(watch, message)
        return JSONResponse(status_code=502, content=error(message))


def check_all_flight_watches() -> Dict[str, Any]:
    watches = find(FLIGHT_WATCHES_COLLECTION, {"active": True})
    summary = {"total": len(watches), "checked": 0, "historySaved": 0, "alertsSent": 0, "failed": 0, "expired": 0}
    if not watches:
        return summary

    # Watches whose travel date has already passed can never return a fare —
    # retiring them here stops the hourly job from hammering the scraper (and
    # recording a fresh "failed" check) for a trip that's already over.
    pending_watches = []
    for watch in watches:
        if _is_expired(watch):
            _retire_expired_watch(watch)
            summary["expired"] += 1
        else:
            pending_watches.append(watch)
    watches = pending_watches
    if not watches:
        return summary

    try:
        configured_workers = int(os.getenv("FLIGHT_CHECK_WORKERS", "4") or "4")
    except ValueError:
        configured_workers = 4
    max_workers = max(1, min(configured_workers, 8, len(watches)))

    def run_one(watch: Dict[str, Any]) -> Dict[str, Any]:
        try:
            result = check_flight_watch(watch)
            return {"ok": True, "alerted": bool(result.get("alerted"))}
        except Exception as exc:
            _record_failed_check(watch, str(exc))
            return {"ok": False}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(run_one, watch) for watch in watches]
        for future in as_completed(futures):
            result = future.result()
            summary["checked"] += 1
            if result.get("ok"):
                summary["historySaved"] += 1
                if result.get("alerted"):
                    summary["alertsSent"] += 1
            else:
                summary["failed"] += 1
    summary["workers"] = max_workers
    return summary
