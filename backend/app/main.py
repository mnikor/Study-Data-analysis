from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes.analysis import router as analysis_router
from .api.routes.health import router as health_router
from .config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router, prefix=settings.api_prefix)
    app.include_router(analysis_router, prefix=settings.api_prefix)

    return app


app = create_app()
