from typing import Dict

from fastapi import APIRouter, Depends, Request, Response

from app.middlewares.auth import current_user, user_info
from app.services.mongo import find_one
from app.services.schedule import schedule_price_check
from app.services.user import (
    login_user,
    logout_user,
    refresh_user_session,
    register_user,
)

router = APIRouter()


@router.post("/v2/register")
async def register(request: Request):
    return register_user(await request.json())


@router.post("/v2/login")
async def login(request: Request, response: Response):
    return login_user(await request.json(), request, response)


@router.post("/v2/token/refresh")
def refresh_token(request: Request, response: Response):
    return refresh_user_session(request, response)


@router.post("/v2/logout")
def logout(request: Request, response: Response):
    return logout_user(request, response)


@router.get("/v2/session")
def session(user: Dict[str, str] = Depends(current_user)):
    record = find_one("users", {"userId": user["userId"]})
    if not record:
        return {"authenticated": False}
    return {"authenticated": True, "user": user_info(record)}


@router.get("/v2/schedule")
def schedule(_: Dict[str, str] = Depends(current_user)):
    return schedule_price_check()
