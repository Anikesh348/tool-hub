from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.middlewares.moviehub_access import moviehub_access_middleware
from app.routes import health_routes, leetcode_routes, moviehub_chat_routes, moviehub_routes, product_routes, user_routes, yt_download_routes
from app.utils.responses import error


def create_app() -> FastAPI:
    app = FastAPI(title="ToolHub Backend Python", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "Accept", "X-Requested-With"],
    )

    app.middleware("http")(moviehub_access_middleware)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content=error(exc.detail))

    app.include_router(health_routes.router)
    app.include_router(user_routes.router)
    app.include_router(product_routes.router)
    app.include_router(leetcode_routes.router)
    app.include_router(yt_download_routes.router)
    app.include_router(moviehub_routes.router)
    app.include_router(moviehub_chat_routes.router)
    return app


app = create_app()
