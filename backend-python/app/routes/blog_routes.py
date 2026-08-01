from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Request, Response

from app.middlewares.auth import admin_user, current_user, optional_user
from app.services.blogs import (
    blog_reaction,
    blog_metrics,
    create_blog,
    create_blog_comment,
    create_blog_version,
    delete_blog_comment,
    get_public_blog,
    get_blog_term_summary,
    list_admin_blogs,
    list_blog_versions,
    list_blog_comments,
    list_public_blogs,
    load_blog_asset,
    record_blog_event,
    save_blog_asset,
    update_blog,
    update_blog_version,
    publish_blog_version,
)
from app.services.blog_announcements import announce_blog_publication
from app.utils.responses import success


router = APIRouter()


@router.get("/v2/blogs")
def public_blogs():
    return success({"items": list_public_blogs()})


@router.get("/v2/blogs/{slug}")
def public_blog(slug: str):
    return success(get_public_blog(slug))


@router.post("/v2/blogs/{slug}/term-summary")
def public_blog_term_summary(slug: str, body: Dict[str, Any]):
    return success(get_blog_term_summary(slug, body))


@router.post("/v2/blogs/{slug}/events")
def public_blog_event(slug: str, body: Dict[str, Any], request: Request):
    return success(record_blog_event(slug, body, request))


@router.post("/v2/blogs/{slug}/reaction")
def public_blog_reaction(slug: str, body: Dict[str, Any], request: Request):
    return success(blog_reaction(slug, body, request))


@router.get("/v2/blogs/{slug}/comments")
def public_blog_comments(
    slug: str,
    user: Dict[str, str] = Depends(optional_user),
):
    return success({"items": list_blog_comments(slug, user)})


@router.post("/v2/blogs/{slug}/comments")
def public_blog_comment_create(
    slug: str,
    body: Dict[str, Any],
    user: Dict[str, str] = Depends(current_user),
):
    return success(create_blog_comment(slug, body, user))


@router.delete("/v2/blogs/{slug}/comments/{comment_id}")
def public_blog_comment_delete(
    slug: str,
    comment_id: str,
    user: Dict[str, str] = Depends(current_user),
):
    return success(delete_blog_comment(slug, comment_id, user))


@router.get("/v2/blog-assets/{asset_id}")
def public_blog_asset(asset_id: str):
    asset = load_blog_asset(asset_id)
    return Response(
        content=asset.read(),
        media_type=getattr(asset, "contentType", "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/v2/admin/blogs")
def admin_blogs(_: Dict[str, str] = Depends(admin_user)):
    return success({"items": list_admin_blogs()})


@router.post("/v2/admin/blogs")
def admin_create_blog(body: Dict[str, Any], user: Dict[str, str] = Depends(admin_user)):
    return success(create_blog(body, user.get("email", "")))


@router.put("/v2/admin/blogs/{slug}")
def admin_update_blog(
    slug: str,
    body: Dict[str, Any],
    user: Dict[str, str] = Depends(admin_user),
):
    return success(update_blog(slug, body, user.get("email", "")))


@router.get("/v2/admin/blogs/{slug}/versions")
def admin_blog_versions(slug: str, _: Dict[str, str] = Depends(admin_user)):
    return success(list_blog_versions(slug))


@router.post("/v2/admin/blogs/{slug}/versions")
def admin_create_blog_version(
    slug: str,
    body: Dict[str, Any],
    user: Dict[str, str] = Depends(admin_user),
):
    return success(create_blog_version(slug, body, user.get("email", "")))


@router.put("/v2/admin/blogs/{slug}/versions/{version_id}")
def admin_update_blog_version(
    slug: str,
    version_id: str,
    body: Dict[str, Any],
    user: Dict[str, str] = Depends(admin_user),
):
    return success(update_blog_version(slug, version_id, body, user.get("email", "")))


@router.post("/v2/admin/blogs/{slug}/versions/{version_id}/publish")
def admin_publish_blog_version(
    slug: str,
    version_id: str,
    background_tasks: BackgroundTasks,
    user: Dict[str, str] = Depends(admin_user),
):
    result = publish_blog_version(slug, version_id, user.get("email", ""))
    background_tasks.add_task(
        announce_blog_publication,
        result.get("post") or {},
        version_id,
        user.get("email", ""),
    )
    return success({**result, "announcementQueued": True})


@router.post("/v2/admin/blog-assets")
async def admin_upload_blog_asset(
    request: Request,
    x_filename: str = Header("blog-image"),
    _: Dict[str, str] = Depends(admin_user),
):
    data = await request.body()
    return success(save_blog_asset(data, x_filename, request.headers.get("content-type", "")))


@router.get("/v2/admin/blog-metrics")
def admin_blog_metrics(
    days: int = Query(30, ge=1, le=90),
    slug: Optional[str] = Query(None),
    _: Dict[str, str] = Depends(admin_user),
):
    return success(blog_metrics(days=days, slug=slug))
