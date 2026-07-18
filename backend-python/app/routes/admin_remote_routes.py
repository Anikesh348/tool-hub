from typing import Dict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.middlewares.auth import admin_user
from app.services.host_admin import host_admin_request
from app.utils.responses import error, success

router = APIRouter()


@router.get("/v2/admin/remote/pi5-render")
def pi5_render_status(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success(host_admin_request("GET", "/v1/pi5-render"))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/remote/pi5-render/pause")
def pause_pi5_render(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success(host_admin_request("POST", "/v1/pi5-render/pause", timeout=45))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/remote/pi5-render/resume")
def resume_pi5_render(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success(host_admin_request("POST", "/v1/pi5-render/resume", timeout=45))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/remote/pi5-airplay/start")
def start_pi5_airplay(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success(host_admin_request("POST", "/v1/pi5-airplay/start", timeout=45))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))


@router.post("/v2/admin/remote/pi5-airplay/stop")
def stop_pi5_airplay(_: Dict[str, str] = Depends(admin_user)):
    try:
        return success(host_admin_request("POST", "/v1/pi5-airplay/stop", timeout=45))
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content=error(str(exc)))
