from typing import Dict

from fastapi import APIRouter, Depends, Request

from app.middlewares.auth import current_user
from app.services.schedule import schedule_price_check
from app.services.user import login_user, refresh_user_token, register_user

router = APIRouter()


@router.post("/v2/register")
async def register(request: Request):
    return register_user(await request.json())


@router.post("/v2/login")
async def login(request: Request):
    return login_user(await request.json())


@router.post("/v2/token/refresh")
async def refresh_token(request: Request):
    return refresh_user_token(await request.json())


@router.get("/v2/schedule")
def schedule(_: Dict[str, str] = Depends(current_user)):
    return schedule_price_check()
