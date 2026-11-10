from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal, TypeVar

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from synapse import __version__
from synapse.bootstrap import Application
from synapse.config import Settings, load_settings
from synapse.errors import SynapseError
from synapse.integrations.gui import query_service
from synapse.integrations.gui.core_worker import CoreWorker
from synapse.integrations.gui.security import (
    SecurityMiddleware,
    configured_origins,
    require_token,
    resolve_token,
)

logger = logging.getLogger(__name__)
T = TypeVar("T")
_STATIC_DIR = Path(__file__).resolve().parent / "static"

_STATUS_CODES: dict[str, int] = {
    "INVALID_ARGUMENT": 400,
    "PROJECT_NOT_FOUND": 404,
    "NODE_NOT_FOUND": 404,
    "AMBIGUOUS_PROJECT": 409,
    "DB_BUSY": 503,
    "INDEX_UNAVAILABLE": 503,
    "INDEX_LOCKED": 423,
    "CONFLICT_VERSION": 409,
    "NOT_IMPLEMENTED": 501,
    "PARSER_ERROR": 422,
    "STORAGE_ERROR": 500,
    "INTERNAL": 500,
}


def _error_response(status_code: int, error: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": error})


def create_app(
    settings: Settings | None = None,
    *,
    token: str | None = None,
    worker: CoreWorker | None = None,
) -> FastAPI:
    resolved_settings = settings or load_settings()
    resolved_token = token or resolve_token()
    allowed_origins = configured_origins()
    owns_worker = worker is None
    core_worker = worker or CoreWorker(resolved_settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        import asyncio

        if owns_worker:
            await asyncio.to_thread(core_worker.start)
        try:
            yield
        finally:
            if owns_worker:
                await asyncio.to_thread(core_worker.close)

    app = FastAPI(
        title="Synapse GUI API",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    app.state.gui_token = resolved_token
    app.state.worker = core_worker

    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.add_middleware(
        SecurityMiddleware,
        allowed_origins=allowed_origins,
    )

    @app.exception_handler(SynapseError)
    async def synapse_error_handler(
        _: Request,
        exc: SynapseError,
    ) -> JSONResponse:
        return _error_response(
            _STATUS_CODES.get(exc.code, 500),
            exc.to_dict(),
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            error = {
                "code": str(detail.get("code", "HTTP_ERROR")),
                "message": str(detail.get("message", "请求失败")),
                "details": detail.get("details", {}),
            }
        else:
            error = {
                "code": "HTTP_ERROR",
                "message": str(detail),
                "details": {},
            }
        return _error_response(exc.status_code, error)

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled GUI API error on %s", request.url.path, exc_info=exc)
        return _error_response(
            500,
            {
                "code": "INTERNAL",
                "message": "内部错误",
                "details": {},
            },
        )

    async def run(operation: Callable[[Application], T], request: Request) -> T:
        worker_instance: CoreWorker = request.app.state.worker
        return await worker_instance.run(operation)

    @app.get("/api/v1/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "version": __version__}

    router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])

    @router.get("/projects")
    async def projects(request: Request) -> dict[str, Any]:
        return await run(query_service.list_projects, request)

    @router.get("/projects/{project_id}")
    async def project(project_id: str, request: Request) -> dict[str, Any]:
        return await run(
            lambda application: query_service.project_detail(
                application,
                project_id,
            ),
            request,
        )

    @router.get("/projects/{project_id}/status")
    async def status(project_id: str, request: Request) -> dict[str, Any]:
        return await run(
            lambda application: query_service.project_status(
                application,
                project_id,
            ),
            request,
        )

    @router.post("/projects/{project_id}/index")
    async def index(
        project_id: str,
        request: Request,
        full: bool = Query(default=False),
    ) -> dict[str, Any]:
        return await run(
            lambda application: query_service.run_index(
                application,
                project_id,
                full=full,
            ),
            request,
        )

    @router.get("/projects/{project_id}/overview")
    async def overview(project_id: str, request: Request) -> dict[str, Any]:
        return await run(
            lambda application: query_service.project_overview(
                application,
                project_id,
            ),
            request,
        )

    @router.get("/projects/{project_id}/search")
    async def search(
        project_id: str,
        request: Request,
        q: str = Query(min_length=1, max_length=500),
        mode: Literal["keyword", "hybrid"] = "hybrid",
        node_types: str | None = None,
        path_prefix: str | None = None,
        limit: int = Query(default=20, ge=1, le=50),
    ) -> dict[str, Any]:
        return await run(
            lambda application: query_service.search_nodes(
                application,
                project_id,
                query=q,
                mode=mode,
                node_types=node_types,
                path_prefix=path_prefix,
                limit=limit,
            ),
            request,
        )

    @router.get("/projects/{project_id}/graph/overview")
    async def graph(
        project_id: str,
        request: Request,
        max_nodes: int = Query(default=80, ge=1, le=200),
        node_types: str | None = None,
        relation_types: str | None = None,
    ) -> dict[str, Any]:
        return await run(
            lambda application: query_service.graph_overview(
                application,
                project_id,
                max_nodes=max_nodes,
                node_types=node_types,
                relation_types=relation_types,
            ),
            request,
        )

    @router.get("/projects/{project_id}/nodes/{node_id}")
    async def node(
        project_id: str,
        node_id: str,
        request: Request,
    ) -> dict[str, Any]:
        return await run(
            lambda application: query_service.node_detail(
                application,
                project_id,
                node_id,
            ),
            request,
        )

    @router.get("/projects/{project_id}/memories")
    async def memories(
        project_id: str,
        request: Request,
        memory_type: Literal["fact", "experience", "decision", "preference", "summary"] | None = None,
        q: str | None = Query(default=None, max_length=500),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        return await run(
            lambda application: query_service.list_memories(
                application,
                project_id,
                memory_type=memory_type,
                query=q,
                limit=limit,
                offset=offset,
            ),
            request,
        )

    @router.get("/projects/{project_id}/memories/{node_id}")
    async def memory(
        project_id: str,
        node_id: str,
        request: Request,
    ) -> dict[str, Any]:
        return await run(
            lambda application: query_service.memory_detail(
                application,
                project_id,
                node_id,
            ),
            request,
        )

    @router.get("/projects/{project_id}/context")
    async def context(
        project_id: str,
        request: Request,
        q: str | None = Query(default=None, max_length=500),
        max_tokens: int = Query(default=2000, ge=100, le=20000),
    ) -> dict[str, Any]:
        return await run(
            lambda application: query_service.context_inspection(
                application,
                project_id,
                query=q,
                max_tokens=max_tokens,
            ),
            request,
        )

    @router.get("/projects/{project_id}/graph/{node_id}/neighbors")
    async def neighbors(
        project_id: str,
        node_id: str,
        request: Request,
        depth: int = Query(default=1, ge=0, le=3),
        direction: Literal["in", "out", "both"] = "both",
        relation_types: str | None = None,
        node_types: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        return await run(
            lambda application: query_service.graph_neighbors(
                application,
                project_id,
                node_id,
                depth=depth,
                direction=direction,
                relation_types=relation_types,
                node_types=node_types,
                limit=limit,
            ),
            request,
        )

    app.include_router(router)
    if _STATIC_DIR.is_dir() and (_STATIC_DIR / "index.html").is_file():
        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="ui")
    return app


def create_default_app() -> FastAPI:
    return create_app()
