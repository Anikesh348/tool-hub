from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime
from functools import lru_cache
from typing import Any
from urllib.parse import urlencode

import airportsdata
import requests
from bs4 import BeautifulSoup
from fast_flights import FlightQuery, Passengers, create_query, fetch_flights_html
from fast_flights.model import Airport, Airline, Alliance, CarbonEmission, Flights, JsMetadata, SimpleDatetime, SingleFlight
from fast_flights.parser import ResultList
from selectolax.parser import HTMLParser


AIRPORTS = airportsdata.load("IATA")
SKYSCANNER_BASE_URL = "https://www.skyscanner.com"
SKYSCANNER_RADAR_SEARCH_URL = f"{SKYSCANNER_BASE_URL}/g/radar/api/search/v1"
KIWI_SEARCH_URL = "https://tequila-api.kiwi.com/v2/search"


def _normalize_query(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).lower()


@lru_cache(maxsize=256)
def _search_places_cached(normalized: str, limit: int) -> tuple[tuple[tuple[str, Any], ...], ...]:
    if len(normalized) < 2:
        return tuple()

    scored: list[tuple[int, dict[str, Any]]] = []
    for code, airport in AIRPORTS.items():
        city = str(airport.get("city") or "").strip()
        name = str(airport.get("name") or "").strip()
        country = str(airport.get("country") or "").strip()
        code_text = str(code or "").upper()
        haystack = " ".join([code_text, city, name, country]).lower()
        if normalized not in haystack:
            continue

        score = 40
        if code_text.lower() == normalized:
            score = 100
        elif city.lower() == normalized:
            score = 90
        elif city.lower().startswith(normalized):
            score = 80
        elif name.lower().startswith(normalized):
            score = 70

        scored.append(
            (
                score,
                {
                    "code": code_text,
                    "name": name,
                    "city": city,
                    "country": country,
                    "label": f"{city or name} ({code_text})",
                    "subtitle": f"{name}, {country}".strip(", "),
                },
            )
        )

    scored.sort(key=lambda item: (-item[0], item[1]["city"], item[1]["name"]))
    return tuple(tuple(result.items()) for _, result in scored[: max(1, min(limit, 25))])


def search_places(query: str, limit: int = 12) -> list[dict[str, Any]]:
    normalized = _normalize_query(query)
    if len(normalized) < 2:
        return []
    safe_limit = max(1, min(int(limit or 12), 25))
    return [dict(items) for items in _search_places_cached(normalized, safe_limit)]


def _date_to_skyscanner(value: str) -> str:
    return datetime.strptime(value, "%Y-%m-%d").strftime("%y%m%d")


def _date_to_kiwi(value: str) -> str:
    return datetime.strptime(value, "%Y-%m-%d").strftime("%d/%m/%Y")


def build_skyscanner_path(payload: dict[str, Any]) -> str:
    origin = str(payload.get("origin") or "").strip().lower()
    destination = str(payload.get("destination") or "").strip().lower()
    outbound = _date_to_skyscanner(str(payload.get("departureDate") or ""))
    inbound_date = str(payload.get("returnDate") or "").strip()
    path = f"/transport/flights/{origin}/{destination}/{outbound}/"
    if inbound_date:
        path = f"/transport/flights/{origin}/{destination}/{outbound}/{_date_to_skyscanner(inbound_date)}/"
    return path


def _skyscanner_query(payload: dict[str, Any]) -> dict[str, Any]:
    cabin = str(payload.get("cabin") or "ECONOMY").strip().lower().replace("_", "")
    cabin_map = {
        "economy": "economy",
        "premiumeconomy": "premiumeconomy",
        "business": "business",
        "first": "first",
    }
    adults = max(1, int(payload.get("adults") or 1))
    children = max(0, int(payload.get("children") or 0))
    query = {
        "adultsv2": adults,
        "cabinclass": cabin_map.get(cabin, "economy"),
        "childrenv2": "|".join(["12"] * children),
        "currency": str(payload.get("currency") or "INR").upper(),
        "locale": str(payload.get("locale") or "en-IN"),
        "market": str(payload.get("market") or "IN"),
        "sortby": "price",
    }
    if payload.get("maxStops") == 0:
        query["preferdirects"] = "true"
    return query


def build_skyscanner_url(payload: dict[str, Any]) -> str:
    path = build_skyscanner_path(payload)
    query = _skyscanner_query(payload)
    return f"{SKYSCANNER_BASE_URL}{path}?{urlencode(query)}"


def build_skyscanner_context_url(payload: dict[str, Any]) -> str:
    path = build_skyscanner_path(payload)
    query = {**_skyscanner_query(payload), "path": path}
    return f"{SKYSCANNER_BASE_URL}/g/banana/api/context?{urlencode(query)}"


def _blocked_by_skyscanner(response: requests.Response) -> bool:
    text = response.text.lower()
    return (
        response.status_code in {403, 429}
        or "/captcha" in response.url.lower()
        or "px/captcha" in text
        or "reason\":\"blocked" in text
    )


def _request_headers(payload: dict[str, Any], referer: str, accept: str) -> dict[str, str]:
    locale = str(payload.get("locale") or "en-IN")
    market = str(payload.get("market") or "IN")
    currency = str(payload.get("currency") or "INR").upper()
    return {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": accept,
        "Accept-Language": "en-IN,en;q=0.9",
        "Cache-Control": "no-cache",
        "DNT": "1",
        "Referer": referer,
        "Origin": SKYSCANNER_BASE_URL,
        "X-Skyscanner-Locale": locale,
        "X-Skyscanner-Market": market,
        "X-Skyscanner-Currency": currency,
    }


def _walk_json(node: Any):
    if isinstance(node, dict):
        yield node
        for child in node.values():
            yield from _walk_json(child)
    elif isinstance(node, list):
        for child in node:
            yield from _walk_json(child)


def _extract_json_payloads(soup: BeautifulSoup) -> list[Any]:
    payloads: list[Any] = []
    for script in soup.find_all("script"):
        raw = script.string or script.get_text(strip=True)
        if not raw:
            continue
        stripped = raw.strip()
        if stripped.startswith(("{", "[")):
            try:
                payloads.append(json.loads(stripped))
            except Exception:
                pass
        for marker in ("__NEXT_DATA__", "window.__", "bootstrap", "itinerary", "flight"):
            if marker.lower() not in raw.lower():
                continue
            for match in re.finditer(r"({\"props\".*|{\"data\".*|{\"context\".*)", raw):
                try:
                    payload, _ = json.JSONDecoder().raw_decode(raw[match.start() :])
                    payloads.append(payload)
                except Exception:
                    continue
    return payloads


def _price_from_value(value: Any) -> float | None:
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "")
        match = re.search(r"(?<!\d)(\d{2,7}(?:\.\d{1,2})?)(?!\d)", cleaned)
        if match:
            parsed = float(match.group(1))
            if parsed > 0:
                return parsed
    return None


def _dedupe_sort_offers(offers: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    seen: set[tuple[Any, ...]] = set()
    cleaned: list[dict[str, Any]] = []
    for offer in offers:
        price = _price_from_value(offer.get("price"))
        if not price:
            continue
        normalized = {
            **offer,
            "price": round(price, 2),
            "currency": str(offer.get("currency") or "INR").upper(),
            "airlines": list(offer.get("airlines") or []),
        }
        key = (
            normalized["price"],
            normalized["currency"],
            ",".join(sorted(map(str, normalized["airlines"]))),
            normalized.get("stops"),
            normalized.get("departureAt"),
            normalized.get("arrivalAt"),
            normalized.get("provider") or normalized.get("source"),
        )
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(normalized)
    cleaned.sort(key=lambda item: float(item.get("price") or 0))
    return cleaned[:limit]


def _simple_datetime_to_iso(value: Any) -> str | None:
    date = getattr(value, "date", None)
    time_value = getattr(value, "time", None)
    if not date or len(date) < 3 or any(part is None for part in date[:3]):
        return None
    hour = int(time_value[0]) if time_value and time_value[0] is not None else 0
    minute = int(time_value[1]) if time_value and len(time_value) > 1 and time_value[1] is not None else 0
    return f"{int(date[0]):04d}-{int(date[1]):02d}-{int(date[2]):02d}T{hour:02d}:{minute:02d}:00"


def _fast_flights_seat(payload: dict[str, Any]) -> str:
    cabin = str(payload.get("cabin") or "ECONOMY").strip().upper().replace(" ", "_")
    cabin_map = {
        "ECONOMY": "economy",
        "PREMIUM_ECONOMY": "premium-economy",
        "BUSINESS": "business",
        "FIRST": "first",
    }
    return cabin_map.get(cabin, "economy")


def _google_flights_url(payload: dict[str, Any]) -> str:
    origin = str(payload.get("origin") or "").strip().upper()
    destination = str(payload.get("destination") or "").strip().upper()
    date = str(payload.get("departureDate") or "").strip()
    if payload.get("returnDate"):
        date = f"{date},{payload.get('returnDate')}"
    return f"https://www.google.com/travel/flights?q=Flights%20from%20{origin}%20to%20{destination}%20on%20{date}"


def _google_flights_query_url(query: Any) -> str:
    return f"https://www.google.com/travel/flights?{urlencode(query.params(), doseq=True)}"


def _safe_google_parse_js(js: str) -> ResultList:
    data = js.split("data:", 1)[1].rsplit(",", 1)[0]
    payload = json.loads(data)
    alliances = []
    airlines = []

    try:
        alliances_data, airlines_data = payload[7][1][0], payload[7][1][1]
    except Exception:
        alliances_data, airlines_data = [], []

    for code, name in alliances_data:
        alliances.append(Alliance(code=code, name=name))
    for code, name in airlines_data:
        airlines.append(Airline(code=code, name=name))

    flights = ResultList()
    flights.metadata = JsMetadata(alliances=alliances, airlines=airlines)
    try:
        rows = payload[3][0] or []
    except Exception:
        return flights

    for row in rows:
        try:
            flight = row[0]
            price = row[1][0][1]
            if not _price_from_value(price):
                continue

            segments = []
            for single_flight in flight[2]:
                segments.append(
                    SingleFlight(
                        from_airport=Airport(code=single_flight[3], name=single_flight[4]),
                        to_airport=Airport(code=single_flight[6], name=single_flight[5]),
                        departure=SimpleDatetime(date=single_flight[20], time=single_flight[8]),
                        arrival=SimpleDatetime(date=single_flight[21], time=single_flight[10]),
                        duration=single_flight[11],
                        plane_type=single_flight[17],
                    )
                )
            extras = flight[22] or []
            carbon_emission = extras[7] if len(extras) > 7 else 0
            typical_carbon_emission = extras[8] if len(extras) > 8 else 0
            flights.append(
                Flights(
                    type=flight[0],
                    price=price,
                    airlines=flight[1] or [],
                    flights=segments,
                    carbon=CarbonEmission(
                        typical_on_route=typical_carbon_emission,
                        emission=carbon_emission,
                    ),
                )
            )
        except Exception:
            continue
    return flights


def _safe_google_parse(html: str) -> ResultList:
    parser = HTMLParser(html)
    script = parser.css_first('script[class="ds:1"]')
    if not script:
        for candidate in parser.css("script"):
            text = candidate.text()
            if "AF_initDataCallback" in text and "data:" in text:
                script = candidate
                break
    if not script:
        raise RuntimeError("Google Flights response did not include the expected flight data script.")
    return _safe_google_parse_js(script.text())


def _google_offer_to_dict(offer: Any, payload: dict[str, Any], google_url: str) -> dict[str, Any]:
    segments = list(getattr(offer, "flights", []) or [])
    departure_at = _simple_datetime_to_iso(getattr(segments[0], "departure", None)) if segments else None
    arrival_at = _simple_datetime_to_iso(getattr(segments[-1], "arrival", None)) if segments else None
    return {
        "provider": "google-flights",
        "source": "fast-flights",
        "price": round(float(getattr(offer, "price")), 2),
        "currency": str(payload.get("currency") or "INR").upper(),
        "airlines": list(getattr(offer, "airlines", []) or []),
        "stops": max(0, len(segments) - 1),
        "departureAt": departure_at,
        "arrivalAt": arrival_at,
        "url": google_url,
        "fetchedUrl": google_url,
    }


def _scrape_google_flights(payload: dict[str, Any]) -> dict[str, Any]:
    origin = str(payload.get("origin") or "").strip().upper()
    destination = str(payload.get("destination") or "").strip().upper()
    departure_date = str(payload.get("departureDate") or "").strip()
    return_date = str(payload.get("returnDate") or "").strip()
    trip = "round-trip" if return_date else "one-way"
    flights = [FlightQuery(date=departure_date, from_airport=origin, to_airport=destination)]
    if return_date:
        flights.append(FlightQuery(date=return_date, from_airport=destination, to_airport=origin))

    query = create_query(
        flights=flights,
        trip=trip,
        seat=_fast_flights_seat(payload),
        passengers=Passengers(
            adults=max(1, int(payload.get("adults") or 1)),
            children=max(0, int(payload.get("children") or 0)),
            infants_on_lap=max(0, int(payload.get("infants") or 0)),
        ),
        language=str(payload.get("locale") or "en-IN"),
        currency=str(payload.get("currency") or "INR").upper(),
        max_stops=None,
    )
    google_url = _google_flights_query_url(query)
    max_stops = payload.get("maxStops")
    offers: list[Any] = []
    last_error: str | None = None
    attempts = 3 if max_stops not in (None, "") else 2
    for attempt in range(attempts):
        try:
            results = _safe_google_parse(fetch_flights_html(query))
        except Exception as exc:
            last_error = str(exc)
            results = []
        offers = [offer for offer in results if _price_from_value(getattr(offer, "price", None))]
        if max_stops not in (None, ""):
            offers = [
                offer
                for offer in offers
                if max(0, len(list(getattr(offer, "flights", []) or [])) - 1) <= int(max_stops)
            ]
        if offers:
            break
        if attempt < attempts - 1:
            time.sleep(0.7 + (attempt * 0.4))

    if not offers:
        error_message = "Google Flights did not return any priced itineraries for this search."
        if last_error:
            error_message = f"{error_message} Last parser error: {last_error}"
        return {
            "status": "failure",
            "provider": "google-flights",
            "error": error_message,
            "url": google_url,
        }

    ranked_offers: list[dict[str, Any]] = []
    for offer in offers:
        try:
            ranked_offers.append(_google_offer_to_dict(offer, payload, google_url))
        except (TypeError, ValueError, IndexError):
            continue
    ranked_offers = _dedupe_sort_offers(ranked_offers)
    if not ranked_offers:
        return {
            "status": "failure",
            "provider": "google-flights",
            "error": "Google Flights returned fare rows, but none could be normalized.",
            "url": google_url,
        }
    best = ranked_offers[0]
    return {
        "status": "success",
        "provider": "google-flights",
        "price": best["price"],
        "currency": best["currency"],
        "airlines": best.get("airlines", []),
        "stops": best.get("stops"),
        "departureAt": best.get("departureAt"),
        "arrivalAt": best.get("arrivalAt"),
        "url": google_url,
        "fetchedUrl": google_url,
        "source": "fast-flights",
        "offers": ranked_offers,
    }


def _scrape_kiwi_flights(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv("KIWI_TEQUILA_API_KEY", "").strip()
    if not api_key:
        return {"status": "skipped", "provider": "kiwi-tequila", "error": "KIWI_TEQUILA_API_KEY is not configured."}

    params: dict[str, Any] = {
        "fly_from": str(payload.get("origin") or "").strip().upper(),
        "fly_to": str(payload.get("destination") or "").strip().upper(),
        "date_from": _date_to_kiwi(str(payload.get("departureDate") or "")),
        "date_to": _date_to_kiwi(str(payload.get("departureDate") or "")),
        "adults": max(1, int(payload.get("adults") or 1)),
        "children": max(0, int(payload.get("children") or 0)),
        "infants": max(0, int(payload.get("infants") or 0)),
        "curr": str(payload.get("currency") or "INR").upper(),
        "sort": "price",
        "limit": 10,
    }
    if payload.get("returnDate"):
        params["return_from"] = _date_to_kiwi(str(payload.get("returnDate") or ""))
        params["return_to"] = _date_to_kiwi(str(payload.get("returnDate") or ""))
    if payload.get("maxStops") not in (None, ""):
        params["max_stopovers"] = int(payload.get("maxStops"))

    response = requests.get(
        KIWI_SEARCH_URL,
        headers={"apikey": api_key, "accept": "application/json"},
        params=params,
        timeout=30,
    )
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Kiwi returned non-JSON response: {exc}") from exc
    if response.status_code < 200 or response.status_code >= 300:
        return {
            "status": "failure",
            "provider": "kiwi-tequila",
            "error": data.get("message") or f"Kiwi returned HTTP {response.status_code}",
        }

    offers = data.get("data") or []
    if not offers:
        return {
            "status": "failure",
            "provider": "kiwi-tequila",
            "error": "Kiwi did not return any priced itineraries for this search.",
        }

    ranked_offers: list[dict[str, Any]] = []
    for offer in offers:
        route = offer.get("route") or []
        outbound_route = [
            segment
            for segment in route
            if str(segment.get("return") or "0") == "0" or not payload.get("returnDate")
        ]
        ranked_offers.append(
            {
                "provider": "kiwi-tequila",
                "source": "kiwi-tequila",
                "price": round(float(offer.get("price") or 0), 2),
                "currency": str(payload.get("currency") or "INR").upper(),
                "airlines": sorted({str(segment.get("airline")) for segment in route if segment.get("airline")}),
                "stops": max(0, len(outbound_route or route) - 1),
                "departureAt": offer.get("local_departure") or offer.get("utc_departure"),
                "arrivalAt": offer.get("local_arrival") or offer.get("utc_arrival"),
                "url": offer.get("deep_link") or _google_flights_url(payload),
                "fetchedUrl": offer.get("deep_link") or _google_flights_url(payload),
            }
        )
    ranked_offers = _dedupe_sort_offers(ranked_offers)
    best = ranked_offers[0]
    return {
        "status": "success",
        "provider": "kiwi-tequila",
        "price": best["price"],
        "currency": best["currency"],
        "airlines": best.get("airlines", []),
        "stops": best.get("stops"),
        "departureAt": best.get("departureAt"),
        "arrivalAt": best.get("arrivalAt"),
        "url": best.get("url"),
        "fetchedUrl": best.get("fetchedUrl"),
        "source": "kiwi-tequila",
        "offers": ranked_offers,
    }


def _no_provider_error(payload: dict[str, Any], provider_errors: list[dict[str, Any]], fallback: str) -> str:
    google_error = next(
        (
            str(item.get("error") or "")
            for item in provider_errors
            if item.get("provider") == "google-flights"
        ),
        "",
    )
    if payload.get("maxStops") == 0 and "did not return any priced itineraries" in google_error:
        return "No provider returned a priced direct fare for this route/date. Try All stops, another Goa airport, or configure KIWI_TEQUILA_API_KEY for another live-price source."
    if "did not return any priced itineraries" in google_error:
        return "No provider returned a priced fare for this route/date. Try another airport/date or configure KIWI_TEQUILA_API_KEY for another live-price source."
    return fallback


def _extract_lowest_offer_from_json(payload: Any, currency: str, source: str = "json") -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    price_keys = {"price", "amount", "rawprice", "totalprice", "minprice", "totalamount", "total"}
    price_path_markers = ("price", "fare", "quote", "itinerar", "pricing", "cost", "amount")

    def visit(node: Any, path: tuple[str, ...]) -> None:
        if isinstance(node, dict):
            lower_keys = {str(key).lower(): key for key in node.keys()}
            for key_name in price_keys:
                original_key = lower_keys.get(key_name)
                if not original_key:
                    continue
                path_text = ".".join((*path, str(original_key))).lower()
                if key_name in {"amount", "total"} and not any(marker in path_text for marker in price_path_markers):
                    continue
                price_value = _price_from_value(node.get(original_key))
                if not price_value or price_value < 10:
                    continue
                node_currency = currency
                currency_key = lower_keys.get("currency") or lower_keys.get("currencycode")
                if currency_key:
                    node_currency = str(node.get(currency_key) or currency)
                candidates.append(
                    {
                        "price": round(price_value, 2),
                        "currency": node_currency.upper(),
                        "airlines": [],
                        "stops": None,
                        "source": source,
                    }
                )

            for key, child in node.items():
                visit(child, (*path, str(key)))
        elif isinstance(node, list):
            for index, child in enumerate(node):
                visit(child, (*path, str(index)))

    visit(payload, ())
    if not candidates:
        return None
    return min(candidates, key=lambda item: item["price"])


def _extract_lowest_offer_from_html(html: str, currency: str) -> dict[str, Any] | None:
    soup = BeautifulSoup(html, "lxml")
    candidates: list[dict[str, Any]] = []

    for payload in _extract_json_payloads(soup):
        offer = _extract_lowest_offer_from_json(payload, currency, "embedded-json")
        if offer:
            candidates.append(offer)

    if not candidates:
        text = soup.get_text(" ", strip=True)
        for match in re.finditer(r"([$€£₹]|USD|INR|EUR|GBP)\s*([0-9][0-9,]*(?:\.\d{1,2})?)", text):
            price_value = _price_from_value(match.group(2))
            if price_value:
                candidates.append(
                    {
                        "price": round(price_value, 2),
                        "currency": currency.upper(),
                        "airlines": [],
                        "stops": None,
                        "source": "page-text",
                    }
                )

    if not candidates:
        return None
    return min(candidates, key=lambda item: item["price"])


def _cabin_api_value(payload: dict[str, Any]) -> str:
    cabin = str(payload.get("cabin") or "ECONOMY").strip().upper().replace(" ", "_")
    cabin_map = {
        "ECONOMY": "CABIN_CLASS_ECONOMY",
        "PREMIUM_ECONOMY": "CABIN_CLASS_PREMIUM_ECONOMY",
        "BUSINESS": "CABIN_CLASS_BUSINESS",
        "FIRST": "CABIN_CLASS_FIRST",
    }
    return cabin_map.get(cabin, "CABIN_CLASS_ECONOMY")


def _entity_from_leg(leg: dict[str, Any], side: str) -> dict[str, Any]:
    prefix = "origin" if side == "origin" else "destination"
    return {
        "id": leg.get(f"{prefix}Id"),
        "entityId": leg.get(f"{prefix}EntityId"),
        "cityId": leg.get(f"{prefix}CityId"),
        "countryId": leg.get(f"{prefix}CountryId"),
        "name": leg.get(f"{prefix}Name"),
        "type": leg.get(f"{prefix}Type"),
    }


def _build_search_request(payload: dict[str, Any], flight_search: dict[str, Any]) -> dict[str, Any]:
    legs: list[dict[str, Any]] = []
    for leg in flight_search.get("flightLegs") or []:
        if not isinstance(leg, dict):
            continue
        legs.append(
            {
                "origin": _entity_from_leg(leg, "origin"),
                "destination": _entity_from_leg(leg, "destination"),
                "date": leg.get("date"),
            }
        )

    if not legs:
        origin = str(payload.get("origin") or "").strip().upper()
        destination = str(payload.get("destination") or "").strip().upper()
        legs.append(
            {
                "origin": {"id": origin},
                "destination": {"id": destination},
                "date": str(payload.get("departureDate") or ""),
            }
        )
        if payload.get("returnDate"):
            legs.append(
                {
                    "origin": {"id": destination},
                    "destination": {"id": origin},
                    "date": str(payload.get("returnDate") or ""),
                }
            )

    trip_type = "RETURN" if payload.get("returnDate") else "ONE_WAY"
    return {
        "adults": max(1, int(payload.get("adults") or flight_search.get("adultsV2") or 1)),
        "childAges": [12] * max(0, int(payload.get("children") or 0)),
        "legs": legs,
        "nearbyAirports": False,
        "cabinClass": _cabin_api_value(payload),
        "preferDirects": payload.get("maxStops") == 0,
        "tripType": trip_type,
    }


def _build_request_context(payload: dict[str, Any]) -> dict[str, Any]:
    view_id = str(uuid.uuid4())
    return {
        "localisationContext": {
            "currency": str(payload.get("currency") or "INR").upper(),
            "locale": str(payload.get("locale") or "en-IN"),
            "market": str(payload.get("market") or "IN"),
        },
        "trustedFunnelId": view_id,
        "viewId": view_id,
        "channelId": "website",
        "platform": "PLATFORM_WEB",
        # This enum is accepted by Radar validation and keeps the context list non-empty.
        "supportedFeatures": ["SUPPORTED_FEATURE_UNSPECIFIED"],
    }


def _radar_request_bodies(payload: dict[str, Any], flight_search: dict[str, Any]) -> list[dict[str, Any]]:
    request_context = _build_request_context(payload)
    search_request = _build_search_request(payload, flight_search)
    return [
        {"requestContext": request_context, "searchRequest": search_request},
        {"request_context": request_context, "search_request": search_request},
    ]


def _search_radar(session: requests.Session, payload: dict[str, Any], context: dict[str, Any], page_url: str) -> tuple[dict[str, Any] | None, str | None]:
    flight_search = context.get("flightSearch") or {}
    headers = _request_headers(payload, page_url, "application/json,text/plain,*/*")
    headers["Content-Type"] = "application/json"
    last_error: str | None = None

    for body in _radar_request_bodies(payload, flight_search):
        try:
            response = session.post(SKYSCANNER_RADAR_SEARCH_URL, headers=headers, json=body, timeout=30)
        except requests.RequestException as exc:
            last_error = f"Skyscanner Radar request failed: {exc}"
            continue

        if _blocked_by_skyscanner(response):
            return None, "Skyscanner returned a captcha or anti-bot block for the JSON search endpoint."
        if response.status_code < 200 or response.status_code >= 300:
            message = response.text[:240].replace("\n", " ")
            last_error = f"Skyscanner Radar returned HTTP {response.status_code}: {message}"
            continue
        try:
            data = response.json()
        except ValueError:
            last_error = "Skyscanner Radar returned a non-JSON response."
            continue

        offer = _extract_lowest_offer_from_json(data, str(payload.get("currency") or "INR"), "radar-json")
        if offer:
            return offer, None
        last_error = "Skyscanner Radar returned JSON but no fare-like price field was found."

        polling_id = (
            data.get("pollingSessionId")
            or (data.get("pollingSession") or {}).get("id")
            or (data.get("pollingSession") or {}).get("pollingSessionId")
        )
        if polling_id:
            for _ in range(3):
                time.sleep(1)
                poll_body = body | {"pollingSessionId": polling_id}
                try:
                    poll_response = session.post(
                        SKYSCANNER_RADAR_SEARCH_URL,
                        headers=headers,
                        json=poll_body,
                        timeout=30,
                    )
                except requests.RequestException as exc:
                    last_error = f"Skyscanner Radar poll failed: {exc}"
                    continue
                if _blocked_by_skyscanner(poll_response):
                    return None, "Skyscanner returned a captcha or anti-bot block while polling JSON search."
                if poll_response.status_code < 200 or poll_response.status_code >= 300:
                    last_error = f"Skyscanner Radar poll returned HTTP {poll_response.status_code}"
                    continue
                try:
                    poll_data = poll_response.json()
                except ValueError:
                    last_error = "Skyscanner Radar poll returned a non-JSON response."
                    continue
                offer = _extract_lowest_offer_from_json(
                    poll_data,
                    str(payload.get("currency") or "INR"),
                    "radar-json",
                )
                if offer:
                    return offer, None

    return None, last_error


def scrape_skyscanner_flights(payload: dict[str, Any]) -> dict[str, Any]:
    provider_errors: list[dict[str, Any]] = []
    for provider_name, provider in (
        ("kiwi-tequila", _scrape_kiwi_flights),
        ("google-flights", _scrape_google_flights),
    ):
        try:
            result = provider(payload)
            if result.get("status") == "success":
                return result
            provider_errors.append(
                {
                    "provider": provider_name,
                    "status": result.get("status") or "failure",
                    "error": result.get("error") or f"{provider_name} did not return a fare.",
                }
            )
        except Exception as exc:
            provider_errors.append({"provider": provider_name, "status": "failure", "error": str(exc)})

    url = build_skyscanner_url(payload)
    context_url = build_skyscanner_context_url(payload)
    session = requests.Session()
    json_headers = _request_headers(payload, url, "application/json,text/plain,*/*")

    try:
        context_response = session.get(context_url, headers=json_headers, timeout=30, allow_redirects=True)
    except requests.RequestException as exc:
        context_response = None
        context_error = f"Skyscanner context request failed: {exc}"
    else:
        context_error = None

    if context_response is not None:
        if _blocked_by_skyscanner(context_response):
            return {
                "status": "failure",
                "error": _no_provider_error(
                    payload,
                    provider_errors,
                    "No provider returned a fare. Skyscanner is blocked by captcha on this network.",
                ),
                "url": url,
                "fetchedUrl": context_response.url,
                "contextUrl": context_url,
                "providerErrors": provider_errors,
            }
        if 200 <= context_response.status_code < 300:
            try:
                context_payload = context_response.json()
            except ValueError:
                context_error = "Skyscanner context endpoint returned a non-JSON response."
            else:
                context = context_payload.get("context") if isinstance(context_payload, dict) else None
                if isinstance(context, dict):
                    offer, radar_error = _search_radar(session, payload, context, url)
                    if offer:
                        return {"status": "success", "url": url, "fetchedUrl": context_response.url, **offer}
                    context_error = radar_error or "Skyscanner context was readable, but Radar did not return a fare."
                else:
                    context_error = "Skyscanner context endpoint did not include a flight search context."
        else:
            context_error = f"Skyscanner context endpoint returned HTTP {context_response.status_code}."

    headers = _request_headers(payload, SKYSCANNER_BASE_URL, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    response = session.get(url, headers=headers, timeout=30, allow_redirects=True)
    if _blocked_by_skyscanner(response):
        return {
            "status": "failure",
            "error": _no_provider_error(
                payload,
                provider_errors,
                "No provider returned a fare. Skyscanner is blocked by captcha on this network.",
            ),
            "url": url,
            "fetchedUrl": response.url,
            "contextError": context_error,
            "providerErrors": provider_errors,
        }
    if response.status_code < 200 or response.status_code >= 300:
        return {
            "status": "failure",
            "error": f"Skyscanner returned HTTP {response.status_code}",
            "url": url,
            "fetchedUrl": response.url,
            "contextError": context_error,
            "providerErrors": provider_errors,
        }

    offer = _extract_lowest_offer_from_html(response.text, str(payload.get("currency") or "INR"))
    if not offer:
        return {
            "status": "failure",
            "error": (
                context_error
                or "Skyscanner served an app shell without fare data in the static HTML payload."
            ),
            "url": url,
            "fetchedUrl": response.url,
            "contextUrl": context_url,
            "providerErrors": provider_errors,
        }
    return {"status": "success", "provider": "skyscanner-scraper", "url": url, "fetchedUrl": response.url, **offer}
