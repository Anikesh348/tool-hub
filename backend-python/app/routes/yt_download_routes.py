from typing import Dict, Optional

from fastapi import APIRouter, Depends, Request

from app.middlewares.auth import admin_user, current_user
from app.services.yt_download import (
    add_download,
    check_downloads,
    delete_library_item,
    delete_request,
    get_formats,
    get_status,
    list_library_items,
    list_requests,
    start_download,
    stream_status,
)

router = APIRouter()


@router.post("/v2/yt/formats")
async def yt_formats(request: Request, _: Dict[str, str] = Depends(current_user)):
    return get_formats(await request.json())


@router.post("/v2/admin/yt/download/add")
async def yt_add(request: Request, user: Dict[str, str] = Depends(admin_user)):
    return add_download(await request.json(), user)


@router.post("/v2/admin/yt/download/start")
def yt_start_admin(_: Dict[str, str] = Depends(admin_user)):
    return start_download()


@router.post("/v2/yt/download/cronStart")
@router.get("/v2/yt/download/cronStart")
def yt_start():
    return start_download()


@router.post("/v2/yt/download/check")
@router.get("/v2/yt/download/check")
def yt_check():
    return check_downloads()


@router.get("/v2/admin/yt/download/requests")
def yt_requests(_: Dict[str, str] = Depends(admin_user)):
    return list_requests()


@router.delete("/v2/admin/yt/download/requests/{request_id}")
def yt_delete_request(request_id: str, _: Dict[str, str] = Depends(admin_user)):
    return delete_request(request_id)


@router.get("/v2/admin/yt/download/status/{video_id}")
def yt_status(video_id: str, _: Dict[str, str] = Depends(admin_user)):
    return get_status(video_id)


@router.get("/v2/admin/yt/download/status/stream/{video_id}")
def yt_status_stream_admin(video_id: str, _: Dict[str, str] = Depends(admin_user)):
    return stream_status(video_id)


@router.get("/v2/yt/download/status/stream/{video_id}")
def yt_status_stream(video_id: str, _: Dict[str, str] = Depends(current_user)):
    return stream_status(video_id)


@router.get("/v2/admin/yt/library/items")
def yt_library_items(startIndex: int = 0, limit: int = 100, parentId: Optional[str] = None, _: Dict[str, str] = Depends(admin_user)):
    return list_library_items(startIndex, limit, parentId)


@router.delete("/v2/admin/yt/library/items/{item_id}")
def yt_library_delete(item_id: str, _: Dict[str, str] = Depends(admin_user)):
    return delete_library_item(item_id)
