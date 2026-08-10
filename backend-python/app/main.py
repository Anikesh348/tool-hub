from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.middlewares.moviehub_access import moviehub_access_middleware
from app.middlewares.metrics import metrics_middleware, metrics_response
from app.routes import activity_routes, admin_home_routes, admin_remote_routes, admin_routes, admin_settings_routes, ai_routes, blog_routes, buzzwatch_routes, course_routes, flight_routes, health_routes, leetcode_ai_routes, leetcode_routes, moviehub_chat_routes, moviehub_routes, notification_routes, product_routes, scheduler_routes, speedtest_routes, user_routes, yt_download_routes
from app.services.blogs import ensure_blog_indexes_and_seed
from app.services.blog_announcements import ensure_blog_announcement_indexes
from app.services.ai_chats import ensure_ai_indexes
from app.services.courses import ensure_course_indexes_and_seed
from app.services.leetcode_ai import ensure_leetcode_ai_indexes
from app.services.leetcode_set_wizard import ensure_leetcode_set_wizard_indexes
from app.services.notifications import ensure_notification_indexes
from app.services.activity import ensure_activity_indexes
from app.services.scheduler_history import ensure_scheduler_history_indexes
from app.services.schedule import price_check_scheduler
from app.utils.responses import error


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_ai_indexes()
    ensure_leetcode_ai_indexes()
    ensure_leetcode_set_wizard_indexes()
    ensure_course_indexes_and_seed()
    ensure_blog_indexes_and_seed()
    ensure_blog_announcement_indexes()
    ensure_notification_indexes()
    ensure_scheduler_history_indexes()
    ensure_activity_indexes()
    price_check_scheduler.start()
    try:
        yield
    finally:
        await price_check_scheduler.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="ToolHub Backend Python", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "Accept", "X-Requested-With"],
    )

    app.middleware("http")(moviehub_access_middleware)
    app.middleware("http")(metrics_middleware)

    app.add_api_route("/metrics", metrics_response, methods=["GET"], include_in_schema=False)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content=error(exc.detail))

    app.include_router(health_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(admin_home_routes.router)
    app.include_router(admin_remote_routes.router)
    app.include_router(admin_settings_routes.router)
    app.include_router(ai_routes.router)
    app.include_router(course_routes.router)
    app.include_router(blog_routes.router)
    app.include_router(user_routes.router)
    app.include_router(product_routes.router)
    app.include_router(flight_routes.router)
    app.include_router(leetcode_routes.router)
    app.include_router(leetcode_ai_routes.router)
    app.include_router(buzzwatch_routes.router)
    app.include_router(speedtest_routes.router)
    app.include_router(yt_download_routes.router)
    app.include_router(notification_routes.router)
    app.include_router(scheduler_routes.router)
    app.include_router(activity_routes.router)
    app.include_router(moviehub_routes.router)
    app.include_router(moviehub_chat_routes.router)
    return app


app = create_app()
