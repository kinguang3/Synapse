"""Stdio MCP Server adapter for Synapse.

The adapter owns only protocol plumbing. All business behavior is delegated to
the existing Synapse ``Application`` built by :func:`synapse.bootstrap.build_application`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal, TypeVar

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from synapse import __version__
from synapse.bootstrap import Application, build_application
from synapse.errors import InvalidArgument, NodeNotFound, SynapseError

logger = logging.getLogger("synapse.mcp")

T = TypeVar("T")

_READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
_MEMORY_WRITE = ToolAnnotations(
    read_only_hint=False,
    destructive_hint=False,
    idempotent_hint=False,
    open_world_hint=False,
)


class McpRuntime:
    """Own one Synapse Application on a dedicated single worker thread.

    Synapse's SQLite layer keeps connections in thread-local state. Serializing
    every Core call onto one worker thread keeps reads and writes on the same
    connection and lets the server close that connection on the same thread.
    """

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="synapse-mcp",
        )
        self._application: Application | None = None
        self._closed = False

    async def start(self) -> Application:
        if self._application is not None:
            return self._application
        loop = asyncio.get_running_loop()
        application = await loop.run_in_executor(self._executor, build_application)
        self._application = application
        logger.info("Synapse Core initialized on MCP worker thread")
        return application

    async def call(self, operation: Callable[[Application], T]) -> T:
        application = self._application
        if application is None:
            raise RuntimeError("Synapse Core is not initialized")
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, lambda: operation(application))

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        application = self._application
        if application is not None:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(self._executor, application.close)
            self._application = None
        self._executor.shutdown(wait=True)

    def shutdown(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._executor.shutdown(wait=True)


class SynapseTools:
    """Thin MCP-facing wrapper around existing Synapse tool classes."""

    def __init__(self, runtime: McpRuntime) -> None:
        self._runtime = runtime

    async def _run(self, operation: Callable[[Application], T]) -> T:
        try:
            return await self._runtime.call(operation)
        except SynapseError as exc:
            raise ToolError(_error_payload(exc)) from exc
        except Exception:
            logger.exception("Unexpected error while executing an MCP tool")
            raise

    async def projects_list(self) -> dict[str, Any]:
        """List projects already registered in this Synapse data directory."""
        return await self._run(
            lambda app: {"projects": app.project_tools.list_projects()}
        )

    async def project_status(
        self,
        project: Annotated[
            str,
            Field(min_length=1, description="Registered project id, slug, or root path."),
        ],
    ) -> dict[str, Any]:
        """Return index statistics and last-run information for one project."""

        def operation(app: Application) -> dict[str, Any]:
            resolved = app.projects.resolve(project)
            return app.project_tools.status(resolved.id)

        return await self._run(operation)

    async def search(
        self,
        project: Annotated[
            str,
            Field(min_length=1, description="Registered project id, slug, or root path."),
        ],
        query: Annotated[
            str,
            Field(min_length=1, description="Keyword, symbol, or natural-language query."),
        ],
        limit: Annotated[
            int,
            Field(ge=1, le=50, description="Maximum number of results."),
        ] = 10,
        mode: Annotated[
            Literal["keyword", "hybrid"],
            Field(description="keyword for FTS only; hybrid adds graph ranking."),
        ] = "hybrid",
        node_types: Annotated[
            list[str] | None,
            Field(description="Optional node type filter, e.g. function or document."),
        ] = None,
        path_prefix: Annotated[
            str | None,
            Field(description="Optional project-relative path prefix filter."),
        ] = None,
        graph_depth: Annotated[
            int | None,
            Field(ge=0, le=3, description="Optional graph expansion depth."),
        ] = None,
        relation_types: Annotated[
            list[str] | None,
            Field(description="Optional relation type filter for graph expansion."),
        ] = None,
    ) -> dict[str, Any]:
        """Search indexed code and documentation in one project.

        Exact symbol lookup is included when the query looks like a symbol.
        Semantic retrieval is intentionally not exposed in this phase.
        """

        def operation(app: Application) -> dict[str, Any]:
            resolved = app.projects.resolve(project)
            prefix = _validate_path_prefix(path_prefix)
            return app.search_tools.search(
                query,
                project=resolved.id,
                limit=limit,
                mode=mode,
                node_types=node_types,
                path_prefix=prefix,
                graph_depth=graph_depth,
                relation_types=relation_types,
            )

        return await self._run(operation)

    async def related(
        self,
        project: Annotated[
            str,
            Field(min_length=1, description="Registered project id, slug, or root path."),
        ],
        node_id: Annotated[str, Field(min_length=1, description="Node id to inspect.")],
        limit: Annotated[
            int,
            Field(ge=1, le=100, description="Maximum related nodes per category."),
        ] = 20,
        relation_types: Annotated[
            list[str] | None,
            Field(description="Optional relation type filter."),
        ] = None,
        include: Annotated[
            list[Literal["code", "docs", "memory", "other"]] | None,
            Field(description="Optional categories to include."),
        ] = None,
    ) -> dict[str, Any]:
        """List nodes related to a node in the specified project."""

        def operation(app: Application) -> dict[str, Any]:
            resolved_id = _resolve_project_node(app, project, node_id)
            include_values = [str(item) for item in include] if include is not None else None
            return app.search_tools.get_related(
                resolved_id,
                relation_types=relation_types,
                include=include_values,
                limit=limit,
            )

        return await self._run(operation)

    async def explore_graph(
        self,
        project: Annotated[
            str,
            Field(min_length=1, description="Registered project id, slug, or root path."),
        ],
        node_id: Annotated[str, Field(min_length=1, description="Start node id.")],
        depth: Annotated[
            int,
            Field(ge=0, le=3, description="Traversal depth."),
        ] = 2,
        direction: Annotated[
            Literal["outgoing", "incoming", "both"],
            Field(description="Edge direction."),
        ] = "both",
        relation_types: Annotated[
            list[str] | None,
            Field(description="Optional relation type filter."),
        ] = None,
        limit: Annotated[
            int,
            Field(ge=1, le=200, description="Maximum nodes returned."),
        ] = 50,
    ) -> dict[str, Any]:
        """Explore the local knowledge graph around a node in one project."""

        def operation(app: Application) -> dict[str, Any]:
            resolved_id = _resolve_project_node(app, project, node_id)
            return app.search_tools.explore_graph(
                resolved_id,
                depth=depth,
                direction=direction,
                relation_types=relation_types,
                limit=limit,
            )

        return await self._run(operation)

    async def context(
        self,
        project: Annotated[
            str,
            Field(min_length=1, description="Registered project id, slug, or root path."),
        ],
        sections: Annotated[
            list[str] | None,
            Field(description="Optional context sections to include."),
        ] = None,
        max_tokens: Annotated[
            int,
            Field(ge=100, le=20000, description="Approximate token budget."),
        ] = 1200,
    ) -> dict[str, Any]:
        """Build a compact project context payload for an AI coding agent."""

        def operation(app: Application) -> dict[str, Any]:
            resolved = app.projects.resolve(project)
            return app.search_tools.get_context(
                resolved.id,
                sections=sections,
                max_tokens=max_tokens,
            )

        return await self._run(operation)

    async def remember(
        self,
        project: Annotated[
            str,
            Field(min_length=1, description="Registered project id, slug, or root path."),
        ],
        content: Annotated[
            str,
            Field(min_length=1, max_length=200_000, description="Memory content."),
        ],
        title: Annotated[
            str | None,
            Field(max_length=120, description="Optional memory title."),
        ] = None,
        memory_type: Annotated[
            Literal["fact", "experience", "decision", "preference", "summary"],
            Field(description="Memory category."),
        ] = "fact",
        tags: Annotated[
            list[str] | None,
            Field(description="Optional tags."),
        ] = None,
        confidence: Annotated[
            float,
            Field(ge=0.0, le=1.0, description="Confidence from 0 to 1."),
        ] = 1.0,
        idempotency_key: Annotated[
            str | None,
            Field(max_length=200, description="Optional idempotency key."),
        ] = None,
    ) -> dict[str, Any]:
        """Store an explicit long-term memory in the local Synapse database.

        Side effect: this tool writes a new memory node and source record.
        """

        def operation(app: Application) -> dict[str, Any]:
            resolved = app.projects.resolve(project)
            return app.memory_tools.remember(
                resolved.id,
                content,
                title=title,
                memory_type=memory_type,
                tags=tags,
                confidence=confidence,
                idempotency_key=idempotency_key,
            )

        return await self._run(operation)

    async def recall(
        self,
        project: Annotated[
            str,
            Field(min_length=1, description="Registered project id, slug, or root path."),
        ],
        query: Annotated[
            str,
            Field(min_length=1, description="Memory search query."),
        ],
        limit: Annotated[
            int,
            Field(ge=1, le=50, description="Maximum number of memories."),
        ] = 10,
        mode: Annotated[
            Literal["keyword", "hybrid"],
            Field(description="keyword for FTS only; hybrid adds graph ranking."),
        ] = "hybrid",
    ) -> dict[str, Any]:
        """Search long-term memories previously stored for one project."""

        def operation(app: Application) -> dict[str, Any]:
            resolved = app.projects.resolve(project)
            return app.memory_tools.recall(
                query,
                project=resolved.id,
                limit=limit,
                mode=mode,
            )

        return await self._run(operation)

    async def memory_get(
        self,
        project: Annotated[
            str,
            Field(min_length=1, description="Registered project id, slug, or root path."),
        ],
        node_id: Annotated[
            str,
            Field(min_length=1, description="Memory node id returned by recall."),
        ],
    ) -> dict[str, Any]:
        """Return the full content and metadata of one memory node."""

        def operation(app: Application) -> dict[str, Any]:
            resolved = app.projects.resolve(project)
            return app.memory_tools.get(node_id, project=resolved.id)

        return await self._run(operation)


def _error_payload(exc: SynapseError) -> str:
    return json.dumps(exc.to_dict(), ensure_ascii=False)


def _validate_path_prefix(path_prefix: str | None) -> str | None:
    if path_prefix is None:
        return None
    normalized = path_prefix.replace("\\", "/").strip()
    if not normalized:
        return None
    if normalized.startswith("/") or (len(normalized) > 1 and normalized[1] == ":"):
        raise InvalidArgument("path_prefix 必须是项目内相对路径前缀")
    if any(part == ".." for part in normalized.split("/")):
        raise InvalidArgument("path_prefix 不得包含 '..'")
    return normalized


def _resolve_project_node(
    app: Application,
    project_reference: str,
    node_id: str,
) -> str:
    project = app.projects.resolve(project_reference)
    node = app.nodes.get(node_id)
    if node is None:
        raise NodeNotFound(f"节点不存在: {node_id}", details={"node_id": node_id})
    if node.project_id != project.id:
        raise InvalidArgument(
            "节点不属于指定项目",
            details={"node_id": node_id},
        )
    return node.id


def create_server(runtime: McpRuntime) -> MCPServer[Application]:
    @asynccontextmanager
    async def lifespan(_: MCPServer[Application]) -> AsyncIterator[Application]:
        application = await runtime.start()
        try:
            yield application
        finally:
            await runtime.close()

    server: MCPServer[Application] = MCPServer(
        name="synapse",
        title="Synapse Knowledge & Memory",
        description=(
            "Local-first code knowledge graph and long-term memory for AI coding agents."
        ),
        instructions=(
            "Call synapse_projects_list first to discover registered projects. "
            "Pass the project id or slug to every project-scoped tool. "
            "Use synapse_memory_get with a node_id from synapse_recall to read "
            "the full memory content. "
            "synapse_remember writes to the local Synapse database."
        ),
        version=__version__,
        lifespan=lifespan,
        log_level="INFO",
    )

    tools = SynapseTools(runtime)
    server.add_tool(
        tools.projects_list,
        name="synapse_projects_list",
        description="List projects registered in the local Synapse database.",
        annotations=_READ_ONLY,
        structured_output=False,
    )
    server.add_tool(
        tools.project_status,
        name="synapse_project_status",
        description="Show index statistics and last index run for one project.",
        annotations=_READ_ONLY,
        structured_output=False,
    )
    server.add_tool(
        tools.search,
        name="synapse_search",
        description=(
            "Search indexed code and documentation in one project. "
            "Exact symbol lookup is included when the query looks like a symbol. "
            "Semantic retrieval is not available in this phase."
        ),
        annotations=_READ_ONLY,
        structured_output=False,
    )
    server.add_tool(
        tools.related,
        name="synapse_related",
        description="List code, documentation, and memory nodes related to a node.",
        annotations=_READ_ONLY,
        structured_output=False,
    )
    server.add_tool(
        tools.explore_graph,
        name="synapse_explore_graph",
        description="Explore the local knowledge graph around a node.",
        annotations=_READ_ONLY,
        structured_output=False,
    )
    server.add_tool(
        tools.context,
        name="synapse_context",
        description="Build a compact project context payload for an AI coding agent.",
        annotations=_READ_ONLY,
        structured_output=False,
    )
    server.add_tool(
        tools.remember,
        name="synapse_remember",
        description=(
            "Store an explicit long-term memory in the local Synapse database. "
            "Side effect: writes a memory node and source record."
        ),
        annotations=_MEMORY_WRITE,
        structured_output=False,
    )
    server.add_tool(
        tools.recall,
        name="synapse_recall",
        description="Search long-term memories previously stored for one project.",
        annotations=_READ_ONLY,
        structured_output=False,
    )
    server.add_tool(
        tools.memory_get,
        name="synapse_memory_get",
        description=(
            "Return the full content and metadata of one memory node. "
            "Use the node_id returned by synapse_recall."
        ),
        annotations=_READ_ONLY,
        structured_output=False,
    )
    return server


def main() -> None:
    runtime = McpRuntime()
    try:
        server = create_server(runtime)
        logger.info("Starting Synapse MCP server over stdio")
        anyio.run(server.run_stdio_async, backend="asyncio")
    except KeyboardInterrupt:
        logger.info("Synapse MCP server interrupted")
    except Exception:
        logger.exception("Synapse MCP server failed")
        raise SystemExit(1) from None
    finally:
        runtime.shutdown()


if __name__ == "__main__":
    main()
