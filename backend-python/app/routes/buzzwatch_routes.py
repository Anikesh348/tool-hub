import asyncio

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.middlewares.auth import admin_user, current_user
from app.services.buzzwatch import (
    get_buzzwatch_genres,
    get_buzzwatch_item_details,
    get_buzzwatch_preference,
    list_buzzwatch_person_credits,
    list_buzzwatch_items,
    refresh_buzzwatch_items,
    request_buzzwatch_item,
    save_buzzwatch_preference,
    search_buzzwatch_people,
)
from app.utils.responses import error, success

router = APIRouter()


@router.get("/v2/buzzwatch/genres")
def buzzwatch_genres(_: dict = Depends(current_user)):
    return success(get_buzzwatch_genres())


@router.get("/v2/buzzwatch/preference")
def buzzwatch_preference(user: dict = Depends(current_user)):
    return success(get_buzzwatch_preference(user["userId"]))


@router.put("/v2/buzzwatch/preference")
async def buzzwatch_save_preference(request: Request, user: dict = Depends(current_user)):
    body = await request.json()
    try:
        return success(save_buzzwatch_preference(user["userId"], body.get("genreKeys") or []))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))


@router.get("/v2/buzzwatch/items")
def buzzwatch_items(
    mode: str = Query(default="recent"),
    year: str = Query(default="all"),
    mediaType: str = Query(default="all"),
    limit: int = Query(default=120, ge=1, le=240),
    user: dict = Depends(current_user),
):
    return success(list_buzzwatch_items(user_id=user["userId"], mode=mode, year=year, media_type=mediaType, limit=limit))


@router.get("/v2/buzzwatch/items/{item_id}/details")
def buzzwatch_item_details(item_id: str, _: dict = Depends(current_user)):
    try:
        return success(get_buzzwatch_item_details(item_id))
    except ValueError as exc:
        return JSONResponse(status_code=404, content=error(str(exc)))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.get("/v2/buzzwatch/details")
def buzzwatch_details(
    itemId: str = Query(min_length=1, max_length=500),
    _: dict = Depends(current_user),
):
    try:
        return success(get_buzzwatch_item_details(itemId))
    except ValueError as exc:
        return JSONResponse(status_code=404, content=error(str(exc)))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.get("/v2/buzzwatch/people")
def buzzwatch_people(
    query: str = Query(min_length=2, max_length=100),
    user: dict = Depends(current_user),
):
    try:
        return success(search_buzzwatch_people(query))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.get("/v2/buzzwatch/people/{person_id}/credits")
def buzzwatch_person_credits(
    person_id: int,
    mediaType: str = Query(default="all"),
    user: dict = Depends(current_user),
):
    try:
        return success(list_buzzwatch_person_credits(user["userId"], person_id, mediaType))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/buzzwatch/request")
async def buzzwatch_request_title(request: Request, user: dict = Depends(current_user)):
    body = await request.json()
    try:
        result = await asyncio.to_thread(request_buzzwatch_item, user, str(body.get("itemId") or ""))
        return success(result)
    except PermissionError as exc:
        return JSONResponse(status_code=403, content=error(str(exc)))
    except ValueError as exc:
        return JSONResponse(status_code=400, content=error(str(exc)))
    except RuntimeError as exc:
        return JSONResponse(status_code=409, content=error(str(exc)))
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))


@router.post("/v2/admin/buzzwatch/refresh")
def buzzwatch_refresh(_: dict = Depends(admin_user)):
    return success(refresh_buzzwatch_items())
