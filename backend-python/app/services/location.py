import logging
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Any, Dict, List, Optional, Tuple

import requests
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING, ReturnDocument

from app.services.mongo import col
from app.utils.responses import now_iso

logger = logging.getLogger("uvicorn.error")

LOCATION_EVENTS_COLLECTION = "locationevents"
LOCATION_SUMMARY_CACHE_COLLECTION = "locationsummarycache"
LOCATION_PLACES_COLLECTION = "locationplaces"
EVENT_RETENTION_DAYS = 180
EARTH_RADIUS_KM = 6371.0
IST = timezone(timedelta(hours=5, minutes=30))

RANGE_WINDOWS = ("today", "week", "month")
SPECIAL_ZONE_LABELS = {"not_home": "Traveling", None: "Unknown"}

# A "not_home" dwell shorter than this is just transit (a traffic light, a
# turn, driving past) - only longer stays are worth auto-tagging as a place.
MIN_STAY_MINUTES_FOR_PLACE = 10
PLACE_MATCH_RADIUS_KM = 0.15
NOMINATIM_USER_AGENT = "ToolHub-LocationTracker/1.0 (personal use)"

# Route-map road-snapping (see _snap_route_to_roads): collapse pings within
# this radius of each other before ever calling OSRM - a stay's once-a-
# minute heartbeat pings are all the same spot and just bloat the request.
ROUTE_DEDUPE_RADIUS_KM = 0.015
# A gap this long between (deduped) pings means "not the same trip" - e.g.
# the arrival ping of a stay and the departure ping an hour later. OSRM's
# map matcher is built for one continuous stretch of movement; feeding it a
# whole day spanning unrelated, far-apart stays makes it fail outright
# ("TooBig"), so each gap starts a fresh segment to match independently.
ROUTE_SEGMENT_GAP_MINUTES = 5
OSRM_MATCH_URL = "https://router.project-osrm.org/match/v1/driving/"
OSRM_MATCH_RADIUS_M = 30
OSRM_MATCH_MAX_BATCH = 90


def _zone_label(slug: Optional[str]) -> str:
    if slug in SPECIAL_ZONE_LABELS:
        return SPECIAL_ZONE_LABELS[slug]
    return slug.replace("_", " ").title()


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime) -> str:
    return _as_utc(value).isoformat().replace("+00:00", "Z")


def ensure_location_indexes() -> None:
    try:
        collection = col(LOCATION_EVENTS_COLLECTION)
        collection.create_index("occurredAt", expireAfterSeconds=EVENT_RETENTION_DAYS * 86400)
    except Exception:
        logger.exception("Unable to ensure location indexes")


def _parse_occurred_at(raw: Any) -> datetime:
    if isinstance(raw, str) and raw.strip():
        try:
            value = raw.strip()
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            return _as_utc(datetime.fromisoformat(value))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def record_zone_transition(body: Dict[str, Any]) -> Dict[str, Any]:
    to_zone = str(body.get("toZone") or "").strip().lower()
    if not to_zone:
        raise HTTPException(status_code=400, detail="toZone is required")
    from_zone = str(body.get("fromZone") or "").strip().lower() or None

    doc: Dict[str, Any] = {
        "fromZone": from_zone,
        "toZone": to_zone,
        "occurredAt": _parse_occurred_at(body.get("occurredAt")),
        "createdAt": datetime.now(timezone.utc),
    }
    try:
        doc["latitude"] = float(body["latitude"]) if body.get("latitude") is not None else None
        doc["longitude"] = float(body["longitude"]) if body.get("longitude") is not None else None
    except (TypeError, ValueError):
        doc["latitude"] = None
        doc["longitude"] = None

    col(LOCATION_EVENTS_COLLECTION).insert_one(doc)
    return {"stored": True, "fromZone": from_zone, "toZone": to_zone}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a))


def _place_jsonable(place: Dict[str, Any]) -> Dict[str, Any]:
    place = dict(place)
    place["_id"] = str(place["_id"])
    for key in ("createdAt", "updatedAt"):
        if isinstance(place.get(key), datetime):
            place[key] = _iso(place[key])
    return place


NEARBY_POI_RADIUS_KM = 0.06
OVERPASS_USER_AGENT = NOMINATIM_USER_AGENT
_POI_TAG_KEYS = ("shop", "amenity", "office", "tourism", "leisure")
# amenity values that are street furniture, not a "place" worth naming as a stay
_SKIP_AMENITY_VALUES = {
    "bench", "waste_basket", "waste_disposal", "recycling", "bicycle_parking",
    "atm", "post_box", "telephone", "clock", "drinking_water", "fire_hydrant",
    "street_lamp", "vending_machine", "grit_bin", "parking_space", "parking_entrance",
}


def _nearby_poi_name(lat: float, lon: float) -> Optional[str]:
    """A plain reverse-geocode snaps to whatever OSM feature the exact point
    sits on - usually the road itself, since a GPS fix routinely lands on or
    near the road rather than inside the building footprint of the actual
    business someone was at. Overpass lets us search a small radius instead
    and pick the closest genuinely named POI (a restaurant, shop, clinic,
    etc.), which is what "I was at X" actually means."""
    tag_filter = "|".join(_POI_TAG_KEYS)
    query = (
        f'[out:json][timeout:8];'
        f'(node(around:{int(NEARBY_POI_RADIUS_KM * 1000)},{lat},{lon})'
        f'[~"^({tag_filter})$"~"."]["name"];);'
        f"out body;"
    )
    try:
        response = requests.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query},
            headers={"User-Agent": OVERPASS_USER_AGENT},
            timeout=10,
        )
        response.raise_for_status()
        elements = response.json().get("elements", [])
    except Exception:
        logger.exception("Nearby-POI lookup failed for %s,%s", lat, lon)
        return None

    best_name: Optional[str] = None
    best_distance: Optional[float] = None
    for element in elements:
        tags = element.get("tags", {})
        name = tags.get("name")
        node_lat, node_lon = element.get("lat"), element.get("lon")
        if not name or node_lat is None or node_lon is None:
            continue
        if tags.get("amenity") in _SKIP_AMENITY_VALUES:
            continue
        distance = _haversine_km(lat, lon, node_lat, node_lon)
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_name = str(name).strip()[:100]
    return best_name


def _reverse_geocode(lat: float, lon: float) -> Tuple[Optional[str], Optional[str]]:
    """Returns (short label, formatted address) - the label is used as the
    place's display name, the address as a secondary line under it. A nearby
    named POI (see _nearby_poi_name) takes priority over Nominatim's own
    plain reverse-lookup label, which is usually just the road."""
    poi_label = _nearby_poi_name(lat, lon)
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 18},
            headers={"User-Agent": NOMINATIM_USER_AGENT},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        address = data.get("address") or {}
        fallback_label = (
            address.get("amenity")
            or address.get("shop")
            or address.get("office")
            or address.get("building")
            or address.get("road")
            or data.get("name")
        )
        fallback_label = str(fallback_label).strip()[:100] if fallback_label else None
        label = poi_label or fallback_label
        address_parts = [
            address.get("road"),
            address.get("suburb") or address.get("neighbourhood"),
            address.get("city") or address.get("town") or address.get("village"),
            address.get("state"),
            address.get("postcode"),
        ]
        formatted_address = ", ".join(part for part in address_parts if part)[:200] or None
        return label or None, formatted_address
    except Exception:
        logger.exception("Reverse geocode failed for %s,%s", lat, lon)
        return poi_label, None


def _load_places() -> List[Dict[str, Any]]:
    return list(col(LOCATION_PLACES_COLLECTION).find({}))


def _match_place(places: List[Dict[str, Any]], lat: float, lon: float) -> Optional[Dict[str, Any]]:
    for place in places:
        radius = place.get("radiusKm", PLACE_MATCH_RADIUS_KM)
        if _haversine_km(place["latitude"], place["longitude"], lat, lon) <= radius:
            return place
    return None


def _resolve_or_create_place(places: List[Dict[str, Any]], lat: float, lon: float) -> Dict[str, Any]:
    existing = _match_place(places, lat, lon)
    if existing:
        return existing
    geocoded_label, address = _reverse_geocode(lat, lon)
    label = geocoded_label or f"Unnamed place ({lat:.4f}, {lon:.4f})"
    now = datetime.now(timezone.utc)
    doc = {
        "label": label,
        "address": address,
        "latitude": lat,
        "longitude": lon,
        "radiusKm": PLACE_MATCH_RADIUS_KM,
        "source": "auto",
        "createdAt": now,
        "updatedAt": now,
    }
    result = col(LOCATION_PLACES_COLLECTION).insert_one(doc)
    doc["_id"] = result.inserted_id
    places.append(doc)
    return doc


def _resolve_display_zone(
    zone: str,
    point: Optional[Tuple[float, float]],
    dwell_minutes: float,
    places: List[Dict[str, Any]],
) -> Tuple[str, str]:
    """Real HA zones (home/office/etc) pass through unchanged. A "not_home"
    dwell long enough to be a real stop gets resolved against the auto-tagged
    places registry (reverse-geocoding a new entry if this is the first time)
    instead of showing as generic "Traveling".
    """
    if zone != "not_home" or point is None or dwell_minutes < MIN_STAY_MINUTES_FOR_PLACE:
        return zone, _zone_label(zone)
    place = _resolve_or_create_place(places, point[0], point[1])
    return f"place:{place['_id']}", place["label"]


def list_places() -> List[Dict[str, Any]]:
    places = col(LOCATION_PLACES_COLLECTION).find({}).sort("updatedAt", DESCENDING)
    return [_place_jsonable(place) for place in places]


def create_place(label: str, latitude: float, longitude: float) -> Dict[str, Any]:
    label = (label or "").strip()[:100]
    if not label:
        raise HTTPException(status_code=400, detail="label is required")
    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="latitude and longitude are required")
    now = datetime.now(timezone.utc)
    doc = {
        "label": label,
        "latitude": latitude,
        "longitude": longitude,
        "radiusKm": PLACE_MATCH_RADIUS_KM,
        "source": "manual",
        "createdAt": now,
        "updatedAt": now,
    }
    result = col(LOCATION_PLACES_COLLECTION).insert_one(doc)
    doc["_id"] = result.inserted_id
    return _place_jsonable(doc)


def rename_place(place_id: str, label: str) -> Dict[str, Any]:
    label = (label or "").strip()[:100]
    if not label:
        raise HTTPException(status_code=400, detail="label is required")
    try:
        object_id = ObjectId(place_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="invalid place id")
    updated = col(LOCATION_PLACES_COLLECTION).find_one_and_update(
        {"_id": object_id},
        {"$set": {"label": label, "source": "manual", "updatedAt": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="place not found")
    return _place_jsonable(updated)


def _range_bounds(range_key: str, date_str: Optional[str] = None) -> Tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(IST)
    if range_key == "day":
        if not date_str:
            raise HTTPException(status_code=400, detail="date is required for range=day")
        try:
            day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=IST)
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be formatted YYYY-MM-DD")
        if day.date() > local_now.date():
            raise HTTPException(status_code=400, detail="date cannot be in the future")
        start_local = day
        end_local = min(start_local + timedelta(days=1), local_now)
        return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)
    if range_key == "today":
        start_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_key == "week":
        start_local = (local_now - timedelta(days=local_now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    elif range_key == "month":
        start_local = local_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        raise HTTPException(status_code=400, detail="range must be today, week, month, or day")
    return start_local.astimezone(timezone.utc), now


def _initial_zone(before: datetime) -> Optional[str]:
    doc = col(LOCATION_EVENTS_COLLECTION).find_one(
        {"occurredAt": {"$lte": before}}, sort=[("occurredAt", DESCENDING)]
    )
    return doc["toZone"] if doc else None


def _summarize_range(start: datetime, end: datetime) -> Dict[str, Any]:
    events = list(
        col(LOCATION_EVENTS_COLLECTION)
        .find({"occurredAt": {"$gt": start, "$lte": end}})
        .sort("occurredAt", ASCENDING)
    )

    # Pass 1: total path distance across every raw ping, independent of which
    # zone owns the time - a noise floor keeps a stationary phone's GPS
    # jitter from inflating this over hundreds of pings/day.
    total_distance_km = 0.0
    prev_point: Optional[Tuple[float, float]] = None
    for event in events:
        lat, lon = event.get("latitude"), event.get("longitude")
        if prev_point and lat is not None and lon is not None:
            step_km = _haversine_km(prev_point[0], prev_point[1], lat, lon)
            if step_km > 0.05:
                total_distance_km += step_km
        if lat is not None and lon is not None:
            prev_point = (lat, lon)

    # Pass 2: collapse the raw ping stream into completed "legs". A leg ends
    # when the HA zone changes OR - this is the fix - when the point drifts
    # more than PLACE_MATCH_RADIUS_KM from the anchor of the current spatial
    # cluster. Without the second condition, a whole multi-stop trip that
    # never changes HA zone (home -> McDonald's -> Outer Ring Road -> home is
    # all just "not_home") collapses into one leg, and that leg's resolved
    # point ends up being whatever the very last ping happened to be - which
    # can land inside an unrelated saved place's geofence on the way home and
    # mislabel the entire trip under that place. Splitting on spatial drift
    # turns each real stop into its own leg, resolved from the centroid of
    # its own cluster rather than a single trailing ping. MIN_STAY_MINUTES_
    # FOR_PLACE (Pass 3) still decides whether a leg is long enough to be
    # worth naming, so brief clustered stops (a red light, a turn) still fold
    # into travel time same as before.
    legs: List[Dict[str, Any]] = []
    zone = _initial_zone(start)
    leg_start = start
    leg_distance_km = 0.0
    cluster_anchor: Optional[Tuple[float, float]] = None
    cluster_sum: Tuple[float, float] = (0.0, 0.0)
    cluster_count = 0
    prev_point: Optional[Tuple[float, float]] = None

    def _cluster_centroid() -> Optional[Tuple[float, float]]:
        if cluster_count == 0:
            return None
        return (cluster_sum[0] / cluster_count, cluster_sum[1] / cluster_count)

    for event in events:
        occurred_at = _as_utc(event["occurredAt"])
        lat, lon = event.get("latitude"), event.get("longitude")
        point = (lat, lon) if lat is not None and lon is not None else None

        if point and prev_point:
            step_km = _haversine_km(prev_point[0], prev_point[1], point[0], point[1])
            if step_km > 0.05:
                leg_distance_km += step_km
        if point:
            prev_point = point

        # Only re-cluster within "not_home" - real HA zones (home/office/etc)
        # already have a trusted boundary from HA itself, so GPS jitter that
        # occasionally exceeds PLACE_MATCH_RADIUS_KM inside one of those
        # zones must not fragment it into multiple rows.
        cluster_broken = (
            zone == "not_home"
            and point is not None
            and cluster_anchor is not None
            and _haversine_km(cluster_anchor[0], cluster_anchor[1], point[0], point[1]) > PLACE_MATCH_RADIUS_KM
        )

        if event["toZone"] != zone or cluster_broken:
            legs.append(
                {"zone": zone, "start": leg_start, "end": occurred_at, "distanceKm": leg_distance_km, "point": _cluster_centroid()}
            )
            zone = event["toZone"]
            leg_start = occurred_at
            leg_distance_km = 0.0
            cluster_anchor = None
            cluster_sum = (0.0, 0.0)
            cluster_count = 0

        if point:
            if cluster_anchor is None:
                cluster_anchor = point
            cluster_sum = (cluster_sum[0] + point[0], cluster_sum[1] + point[1])
            cluster_count += 1

    legs.append({"zone": zone, "start": leg_start, "end": end, "distanceKm": leg_distance_km, "point": _cluster_centroid()})

    # Pass 3: resolve each leg's display zone/label (this is where a long
    # enough "not_home" leg gets auto-tagged against the places registry),
    # then aggregate zone minutes and build the trips list.
    places = _load_places()
    resolved: List[Dict[str, Any]] = []
    for leg in legs:
        duration_minutes = max(0.0, (leg["end"] - leg["start"]).total_seconds() / 60)
        if leg["zone"]:
            display_zone, display_label = _resolve_display_zone(leg["zone"], leg["point"], duration_minutes, places)
        else:
            display_zone, display_label = None, _zone_label(None)
        resolved.append({**leg, "durationMinutes": duration_minutes, "displayZone": display_zone, "displayLabel": display_label})

    zone_minutes: Dict[str, float] = {}
    zone_labels: Dict[str, str] = {}
    for leg in resolved:
        if leg["displayZone"]:
            zone_minutes[leg["displayZone"]] = zone_minutes.get(leg["displayZone"], 0.0) + leg["durationMinutes"]
            zone_labels[leg["displayZone"]] = leg["displayLabel"]

    places_by_zone_key = {f"place:{place['_id']}": place for place in places}

    # Pass 4: collapse the leg stream into a "stays" timeline. A leg only
    # becomes its own row if it's somewhere real (a named zone/place) or -
    # for the very last leg - if it's the ongoing "currently traveling"
    # state. Anything else (a short "not_home" blip, or an unresolved gap
    # before the first event) is transit: it disappears as a standalone row
    # and its time/distance gets folded into the *next* stay as travel time,
    # so a single trip shows up once instead of as two flip-flopping rows.
    stays: List[Dict[str, Any]] = []
    pending_travel_minutes = 0.0
    pending_travel_km = 0.0
    has_pending_travel = False
    prev_stay_label: Optional[str] = None
    last_index = len(resolved) - 1

    for index, leg in enumerate(resolved):
        is_transit = leg["displayZone"] in (None, "not_home") and index != last_index
        if is_transit:
            pending_travel_minutes += leg["durationMinutes"]
            pending_travel_km += leg["distanceKm"]
            has_pending_travel = True
            continue

        is_current = index == last_index
        place = places_by_zone_key.get(leg["displayZone"]) if leg["displayZone"] else None
        stays.append(
            {
                "zone": leg["displayZone"],
                "label": leg["displayLabel"],
                "address": place.get("address") if place else None,
                "arrivedAt": _iso(leg["start"]),
                "departedAt": None if is_current else _iso(leg["end"]),
                "durationMinutes": round(leg["durationMinutes"]),
                "current": is_current,
                "latitude": leg["point"][0] if leg["point"] else None,
                "longitude": leg["point"][1] if leg["point"] else None,
                "fromLabel": prev_stay_label,
                "travelMinutes": round(pending_travel_minutes) if has_pending_travel else None,
                "travelDistanceKm": round(pending_travel_km, 2) if has_pending_travel and pending_travel_km else None,
            }
        )
        prev_stay_label = leg["displayLabel"]
        pending_travel_minutes = 0.0
        pending_travel_km = 0.0
        has_pending_travel = False

    zone_breakdown = [
        {"zone": zone_key, "label": zone_labels[zone_key], "minutes": round(minutes)}
        for zone_key, minutes in sorted(zone_minutes.items(), key=lambda item: item[1], reverse=True)
    ]

    current_leg = resolved[-1] if resolved else None
    return {
        "currentZone": current_leg["displayZone"] if current_leg else None,
        "currentZoneLabel": current_leg["displayLabel"] if current_leg else _zone_label(None),
        "zoneMinutes": zone_minutes,
        "zoneBreakdown": zone_breakdown,
        "totalTrips": sum(1 for stay in stays if stay["fromLabel"]),
        "totalDistanceKm": round(total_distance_km, 1),
        "stays": list(reversed(stays))[:50],
    }


def _compute_summary(range_key: str, date_str: Optional[str] = None) -> Dict[str, Any]:
    start, end = _range_bounds(range_key, date_str)
    current = _summarize_range(start, end)

    # Comparison window: the same elapsed duration immediately before this
    # one, so a partial "today" (00:00 to now) is compared fairly against
    # the same number of hours yesterday, not a full day.
    previous_start = start - (end - start)
    previous = _summarize_range(previous_start, start)

    return {
        "range": range_key,
        "date": date_str,
        "rangeStart": _iso(start),
        "rangeEnd": _iso(end),
        "currentZone": current["currentZone"],
        "currentZoneLabel": current["currentZoneLabel"],
        "zoneBreakdown": current["zoneBreakdown"],
        "totalTrips": current["totalTrips"],
        "totalDistanceKm": current["totalDistanceKm"],
        "stays": current["stays"],
        "previousTotalTrips": previous["totalTrips"],
        "previousTotalDistanceKm": previous["totalDistanceKm"],
        "previousZoneMinutes": {zone: round(minutes) for zone, minutes in previous["zoneMinutes"].items()},
    }


def get_summary(range_key: str, date_str: Optional[str] = None) -> Dict[str, Any]:
    range_key = (range_key or "today").strip().lower()
    if range_key == "day":
        # One specific calendar day, picked via the date picker - there are
        # too many possible dates to precompute, so this always runs live
        # instead of going through the rollup cache.
        return _compute_summary(range_key, (date_str or "").strip())
    if range_key not in RANGE_WINDOWS:
        raise HTTPException(status_code=400, detail="range must be today, week, month, or day")
    cached = col(LOCATION_SUMMARY_CACHE_COLLECTION).find_one({"_id": f"range-{range_key}"})
    if cached:
        cached.pop("_id", None)
        return cached
    return _compute_summary(range_key)


def run_location_rollup() -> Dict[str, Any]:
    """Scheduled job body - see ToolHubScheduler/FixedIntervalJob in schedule.py.
    Runs on the scheduler's own thread via asyncio.to_thread, so this never
    blocks the event loop or any live request.
    """
    refreshed = []
    for range_key in RANGE_WINDOWS:
        payload = _compute_summary(range_key)
        payload["computedAt"] = now_iso()
        col(LOCATION_SUMMARY_CACHE_COLLECTION).replace_one(
            {"_id": f"range-{range_key}"}, {**payload, "_id": f"range-{range_key}"}, upsert=True
        )
        refreshed.append(range_key)
    return {"rangesRefreshed": refreshed}


def get_current_status() -> Dict[str, Any]:
    latest = col(LOCATION_EVENTS_COLLECTION).find_one({}, sort=[("occurredAt", DESCENDING)])
    if not latest:
        return {
            "zone": None,
            "zoneLabel": _zone_label(None),
            "since": None,
            "lastPingAt": None,
            "latitude": None,
            "longitude": None,
        }
    # "since" means "entered this zone", not "most recent heartbeat" - walk
    # back to the last event that actually changed the zone (a heartbeat
    # ping repeats the same toZone, so it isn't itself a real entry).
    entered = col(LOCATION_EVENTS_COLLECTION).find_one(
        {
            "toZone": latest["toZone"],
            "fromZone": {"$ne": None},
            "$expr": {"$ne": ["$fromZone", "$toZone"]},
        },
        sort=[("occurredAt", DESCENDING)],
    )
    since_doc = entered or latest
    since = _as_utc(since_doc["occurredAt"])
    dwell_minutes = max(0.0, (datetime.now(timezone.utc) - since).total_seconds() / 60)

    lat, lon = latest.get("latitude"), latest.get("longitude")
    point = (lat, lon) if lat is not None and lon is not None else None
    display_zone, display_label = _resolve_display_zone(latest["toZone"], point, dwell_minutes, _load_places())

    return {
        "zone": display_zone,
        "zoneLabel": display_label,
        "since": _iso(since),
        "lastPingAt": _iso(latest["occurredAt"]),
        "latitude": lat,
        "longitude": lon,
    }


def get_timeline(days: int) -> Dict[str, Any]:
    days = max(1, min(days, 90))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    events = list(
        col(LOCATION_EVENTS_COLLECTION)
        .find({"occurredAt": {"$gte": since}})
        .sort("occurredAt", DESCENDING)
        .limit(300)
    )
    items = [
        {
            "occurredAt": _iso(event["occurredAt"]),
            "fromZone": event.get("fromZone"),
            "fromZoneLabel": _zone_label(event.get("fromZone")),
            "toZone": event["toZone"],
            "toZoneLabel": _zone_label(event["toZone"]),
            "latitude": event.get("latitude"),
            "longitude": event.get("longitude"),
        }
        for event in events
    ]
    return {"days": days, "events": items}


def _dedupe_route_points(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    for point in points:
        if deduped and _haversine_km(
            deduped[-1]["latitude"], deduped[-1]["longitude"], point["latitude"], point["longitude"]
        ) < ROUTE_DEDUPE_RADIUS_KM:
            continue
        deduped.append(point)
    return deduped


def _split_route_segments(points: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    segments: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    prev_time: Optional[datetime] = None
    for point in points:
        occurred_at = _as_utc(datetime.fromisoformat(point["occurredAt"].replace("Z", "+00:00")))
        if prev_time and (occurred_at - prev_time).total_seconds() > ROUTE_SEGMENT_GAP_MINUTES * 60:
            if current:
                segments.append(current)
            current = []
        current.append(point)
        prev_time = occurred_at
    if current:
        segments.append(current)
    return segments


def _snap_batch_to_roads(batch: List[Dict[str, Any]]) -> Optional[List[List[float]]]:
    if len(batch) < 2:
        return None
    coords = ";".join(f"{point['longitude']},{point['latitude']}" for point in batch)
    radiuses = ";".join([str(OSRM_MATCH_RADIUS_M)] * len(batch))
    try:
        response = requests.get(
            f"{OSRM_MATCH_URL}{coords}",
            params={"geometries": "geojson", "overview": "full", "radiuses": radiuses},
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("code") != "Ok" or not data.get("matchings"):
            return None
        snapped: List[List[float]] = []
        for matching in data["matchings"]:
            snapped.extend([lat, lon] for lon, lat in matching["geometry"]["coordinates"])
        return snapped or None
    except Exception:
        logger.exception("OSRM map-matching failed for a %d-point batch", len(batch))
        return None


def _snap_route_to_roads(points: List[Dict[str, Any]]) -> List[List[float]]:
    """Best-effort road-snapping of a raw breadcrumb trail via OSRM's public
    map-matching API, so the route map draws a road-following line instead
    of straight segments between once-a-minute pings. Falls back to the
    plain (deduped) points for any stretch that fails to snap - a network
    hiccup, or a genuinely unmatchable jump - so the map always has
    something to draw rather than a gap."""
    deduped = _dedupe_route_points(points)
    path: List[List[float]] = []
    for segment in _split_route_segments(deduped):
        for start in range(0, len(segment), OSRM_MATCH_MAX_BATCH):
            batch = segment[start : start + OSRM_MATCH_MAX_BATCH]
            snapped = _snap_batch_to_roads(batch)
            path.extend(snapped if snapped else [[point["latitude"], point["longitude"]] for point in batch])
    return path


def get_route(range_key: str, date_str: Optional[str] = None) -> Dict[str, Any]:
    """Raw lat/lng breadcrumb trail for a range, for drawing a map route -
    unlike `get_summary`, this returns every ping with a coordinate rather
    than collapsing them into stays, so the frontend can plot the actual
    path travelled."""
    range_key = (range_key or "today").strip().lower()
    if range_key not in RANGE_WINDOWS and range_key != "day":
        raise HTTPException(status_code=400, detail="range must be today, week, month, or day")
    start, end = _range_bounds(range_key, date_str)
    events = list(
        col(LOCATION_EVENTS_COLLECTION)
        .find(
            {
                "occurredAt": {"$gt": start, "$lte": end},
                "latitude": {"$ne": None},
                "longitude": {"$ne": None},
            }
        )
        .sort("occurredAt", ASCENDING)
    )
    points = [
        {
            "occurredAt": _iso(event["occurredAt"]),
            "latitude": event["latitude"],
            "longitude": event["longitude"],
            "zone": event.get("toZone"),
        }
        for event in events
    ]
    path = _snap_route_to_roads(points)
    return {
        "range": range_key,
        "date": date_str,
        "rangeStart": _iso(start),
        "rangeEnd": _iso(end),
        "points": points,
        "path": path,
    }
