import asyncio
from typing import Dict

from fastapi import APIRouter, Depends, Request

from app.middlewares.auth import current_user
from app.services.flights import (
    check_one_flight_watch,
    create_flight_watch,
    delete_flight_watch,
    get_flight_watch,
    get_flight_history,
    get_flight_watches,
    provider_status,
    search_flight_places,
)

router = APIRouter()


@router.get("/v2/flights/provider-status")
def flight_provider_status_route():
    return provider_status()


@router.get("/v2/flights/places")
def flight_places_route(query: str, limit: int = 12):
    return search_flight_places(query, limit)


@router.get("/v2/flights/watches")
def flight_watches_route(user: Dict[str, str] = Depends(current_user)):
    return get_flight_watches(user)


@router.post("/v2/flights/watches")
async def create_flight_watch_route(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return await asyncio.to_thread(create_flight_watch, body, user)


@router.delete("/v2/flights/watches/{watch_id}")
def delete_flight_watch_route(watch_id: str, user: Dict[str, str] = Depends(current_user)):
    return delete_flight_watch(watch_id, user)


@router.get("/v2/flights/watches/{watch_id}")
def get_flight_watch_route(watch_id: str, user: Dict[str, str] = Depends(current_user)):
    return get_flight_watch(watch_id, user)


@router.post("/v2/flights/watches/{watch_id}/check")
def check_flight_watch_route(watch_id: str, user: Dict[str, str] = Depends(current_user)):
    return check_one_flight_watch(watch_id, user)


@router.get("/v2/flights/watches/{watch_id}/history")
def flight_history_route(watch_id: str, user: Dict[str, str] = Depends(current_user)):
    return get_flight_history(watch_id, user)
