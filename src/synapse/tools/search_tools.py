from __future__ import annotations

from typing import Any

from synapse.context.builder import ContextBuilder
from synapse.retrieval.service import RetrievalService


class SearchTools:
    def __init__(
        self,
        *,
        retrieval: RetrievalService,
        context: ContextBuilder,
    ) -> None:
        self._retrieval = retrieval
        self._context = context

    def search(
        self,
        query: str,
        *,
        project: str | None = None,
        limit: int = 10,
        mode: str = "hybrid",
        node_types: list[str] | None = None,
        path_prefix: str | None = None,
        graph_depth: int | None = None,
        relation_types: list[str] | None = None,
    ) -> dict[str, Any]:
        return self._retrieval.search(
            query,
            project_reference=project,
            limit=limit,
            mode=mode,
            node_types=node_types,
            path_prefix=path_prefix,
            graph_depth=graph_depth,
            relation_types=relation_types,
        )

    def get_related(
        self,
        node_id: str,
        *,
        relation_types: list[str] | None = None,
        include: list[str] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        return self._retrieval.related(
            node_id,
            relation_types=relation_types,
            include=include,
            limit=limit,
        )

    def get_context(
        self,
        project: str,
        *,
        sections: list[str] | None = None,
        max_tokens: int = 1200,
        query: str | None = None,
    ) -> dict[str, Any]:
        return self._context.build(
            project,
            sections=sections,
            max_tokens=max_tokens,
            query=query,
        )

    def explore_graph(
        self,
        node_id: str,
        *,
        depth: int = 2,
        direction: str = "both",
        relation_types: list[str] | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        return self._retrieval.explore_graph(
            node_id,
            depth=depth,
            direction=direction,
            relation_types=relation_types,
            limit=limit,
        )
