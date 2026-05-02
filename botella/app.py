"""create_app(manifest) — the single integration point a bot exposes.

Forked bots' bot.py collapses to:

    from botella import create_app
    from botella_manifest import manifest
    app = create_app(manifest)
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from botella.adapters.http import build_http_router
from botella.adapters.ws import build_ws_router
from botella.auth.routes import build_auth_router
from botella.contract import BotManifest


def create_app(manifest: BotManifest) -> FastAPI:
    app = FastAPI(title=f"botella::{manifest.name}")

    # CORS: in dev allow everything so the Expo web build can hit the API
    # from a different localhost port. In prod set BOTELLA_ALLOWED_ORIGINS
    # to a comma-separated list (or leave default and lock down explicitly).
    origins_env = os.environ.get("BOTELLA_ALLOWED_ORIGINS", "*")
    origins = [o.strip() for o in origins_env.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(build_auth_router(manifest))
    app.include_router(build_http_router(manifest))
    app.include_router(build_ws_router(manifest))

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "bot": manifest.name}

    return app
