from __future__ import annotations

import os
import secrets
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "testserver"}
DEFAULT_DEV_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}


def resolve_token() -> str:
    configured = os.environ.get("SYNAPSE_GUI_TOKEN", "").strip()
    return configured or secrets.token_urlsafe(32)


def configured_origins() -> set[str]:
    raw = os.environ.get("SYNAPSE_GUI_ALLOWED_ORIGINS", "")
    values = {item.strip().rstrip("/") for item in raw.split(",") if item.strip()}
    return DEFAULT_DEV_ORIGINS | values


def _host_name(value: str) -> str | None:
    try:
        return urlsplit(f"//{value}").hostname
    except ValueError:
        return None


def is_allowed_host(host: str) -> bool:
    hostname = _host_name(host)
    return hostname is not None and hostname.lower() in LOOPBACK_HOSTS


def is_allowed_origin(origin: str, host: str, allowed_origins: set[str]) -> bool:
    if origin == "null":
        return False
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or parsed.hostname is None:
        return False
    if parsed.hostname.lower() not in LOOPBACK_HOSTS:
        return False
    if parsed.netloc.lower() == host.lower():
        return True
    return origin.rstrip("/").lower() in {item.lower() for item in allowed_origins}


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": {}}},
    )


class SecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, *, allowed_origins: set[str]) -> None:
        super().__init__(app)
        self._allowed_origins = allowed_origins

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.method == "OPTIONS":
            return await call_next(request)
        if request.url.path.startswith("/api/") and request.url.path != "/api/v1/health":
            host = request.headers.get("host", "")
            if not is_allowed_host(host):
                return _error(403, "ORIGIN_NOT_ALLOWED", "Host 不在本地白名单内")
            origin = request.headers.get("origin")
            if origin and not is_allowed_origin(
                origin,
                host,
                self._allowed_origins,
            ):
                return _error(403, "ORIGIN_NOT_ALLOWED", "Origin 不在本地白名单内")
        return await call_next(request)


def require_token(request: Request) -> None:
    expected = getattr(request.app.state, "gui_token", "")
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHENTICATED", "message": "缺少本地 GUI Token"},
        )
    provided = header.removeprefix("Bearer ").strip()
    if not expected or not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHENTICATED", "message": "GUI Token 无效"},
        )
