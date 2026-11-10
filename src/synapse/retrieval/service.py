from __future__ import annotations

import re
import time
from typing import Any

from synapse.config import Settings
from synapse.core.clock import utc_now
from synapse.core.text import build_fts_query, normalize_qualified_name
from synapse.core.validation import normalize_path_prefix
from synapse.domain.enums import NodeType, RelationType
from synapse.domain.models import KnowledgeNode
from synapse.errors import IndexUnavailable, InvalidArgument, NodeNotFound
from synapse.retrieval.diversify import diversify
from synapse.retrieval.graph_expand import GraphExpander
from synapse.retrieval.ranker import Candidate, HybridRanker
from synapse.storage.sqlite.repositories import (
    NodeRepository,
    ProjectRepository,
    RelationRepository,
)

_SYMBOL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.:]*$")
_MODES = {"keyword", "hybrid", "semantic"}
_DIRECTIONS = {"outgoing", "incoming", "both"}


class RetrievalService:
    def __init__(
        self,
        *,
        settings: Settings,
        projects: ProjectRepository,
        nodes: NodeRepository,
        relations: RelationRepository,
    ) -> None:
        self._settings = settings
        self._projects = projects
        self._nodes = nodes
        self._relations = relations
        retrieval = settings.retrieval
        self._ranker = HybridRanker(
            weight_lexical=retrieval.weight_lexical,
            weight_graph=retrieval.weight_graph,
            weight_recency=retrieval.weight_recency,
            weight_importance=retrieval.weight_importance,
            weight_confidence=retrieval.weight_confidence,
        )
        self._expander = GraphExpander(
            nodes,
            relations,
            max_neighbors_per_node=retrieval.max_neighbors_per_node,
            max_nodes=retrieval.max_graph_nodes,
        )

    def search(
        self,
        query: str,
        *,
        project_reference: str | None = None,
        limit: int | None = None,
        node_types: list[str] | None = None,
        path_prefix: str | None = None,
        mode: str = "hybrid",
        graph_depth: int | None = None,
        relation_types: list[str] | None = None,
    ) -> dict[str, Any]:
        started = time.monotonic()
        if not query or not query.strip():
            raise InvalidArgument("查询不能为空")
        mode = mode.lower()
        if mode not in _MODES:
            raise InvalidArgument(f"未知检索模式: {mode}")
        limit = self._normalize_limit(limit)
        project_id = self._project_id(project_reference)
        node_type_values = self._node_types(node_types)
        relation_type_values = self._relation_types(relation_types)
        path_prefix = normalize_path_prefix(path_prefix)

        degraded: list[str] = []
        if mode == "semantic":
            degraded.append("semantic_unavailable")

        candidates: dict[str, Candidate] = {}
        match_query = build_fts_query(query)
        if match_query:
            try:
                fts_results = self._nodes.search_fts(
                    match_query,
                    project_id=project_id,
                    limit=max(limit * 4, 20),
                    node_types=node_type_values,
                    path_prefix=path_prefix,
                )
            except IndexUnavailable:
                fts_results = []
                if "fts_unavailable" not in degraded:
                    degraded.append("fts_unavailable")
            for node, rank, snippet in fts_results:
                lexical = -rank if rank < 0 else 1.0
                candidates[node.id] = Candidate(
                    node=node,
                    lexical=max(lexical, 1e-6),
                    snippet=snippet,
                )

        normalized_query = normalize_qualified_name(query)
        if _SYMBOL_RE.match(query.strip()) and normalized_query:
            for node in self._nodes.find_exact_symbols(
                normalized_query,
                project_id=project_id,
                limit=max(limit * 2, 10),
            ):
                if node_type_values and node.node_type.value not in node_type_values:
                    continue
                if path_prefix and not (node.path or "").startswith(path_prefix):
                    continue
                existing = candidates.get(node.id)
                if existing:
                    existing.exact = True
                    existing.lexical = max(existing.lexical, 1.0)
                else:
                    candidates[node.id] = Candidate(
                        node=node,
                        exact=True,
                        lexical=1.0,
                    )

        depth = (
            self._settings.retrieval.graph_depth
            if graph_depth is None
            else max(0, min(graph_depth, 3))
        )
        if self._settings.retrieval.graph_expand and candidates:
            self._expander.expand(
                candidates,
                depth=depth,
                relation_types=relation_type_values,
            )
        if node_type_values or path_prefix or project_id:
            candidates = {
                node_id: candidate
                for node_id, candidate in candidates.items()
                if (not project_id or candidate.node.project_id == project_id)
                and (
                    not node_type_values
                    or candidate.node.node_type.value in node_type_values
                )
                and (
                    not path_prefix
                    or (candidate.node.path or "").startswith(path_prefix)
                )
            }

        ranked = self._ranker.rank(candidates, now=utc_now())
        selected = diversify(ranked, limit=limit)
        relation_map = self._relation_summaries([candidate.node.id for candidate in selected])
        results = [
            self._candidate_payload(candidate, relation_map.get(candidate.node.id, []))
            for candidate in selected
        ]
        return {
            "results": results,
            "meta": {
                "mode": mode,
                "degraded": degraded,
                "candidates": len(candidates),
                "returned": len(results),
                "took_ms": int((time.monotonic() - started) * 1000),
            },
        }

    def explore_graph(
        self,
        node_id: str,
        *,
        depth: int = 2,
        direction: str = "both",
        relation_types: list[str] | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        start = self._nodes.get(node_id)
        if start is None:
            raise NodeNotFound(f"节点不存在: {node_id}")
        direction = direction.lower()
        if direction not in _DIRECTIONS:
            raise InvalidArgument(f"未知方向: {direction}")
        depth = max(0, min(depth, 3))
        limit = max(1, min(limit, 200))
        relation_types = self._relation_types(relation_types)

        nodes: dict[str, KnowledgeNode] = {start.id: start}
        edges: dict[str, dict[str, Any]] = {}
        frontier = [start.id]
        truncated = False
        for _ in range(depth):
            if not frontier:
                break
            relations = self._relations.get_neighbors(
                frontier,
                direction=direction,
                relation_types=relation_types,
                limit_per_node=max(4, limit // max(1, len(frontier))),
                total_limit=limit * 4,
            )
            if not relations:
                break
            next_frontier: list[str] = []
            for edge in relations:
                other_id = (
                    edge.to_node_id
                    if edge.from_node_id in frontier
                    else edge.from_node_id
                )
                if other_id not in nodes:
                    if len(nodes) >= limit:
                        truncated = True
                        continue
                    node = self._nodes.get(other_id)
                    if node is None:
                        continue
                    nodes[other_id] = node
                    next_frontier.append(other_id)
                edges.setdefault(edge.id, self._edge_payload(edge))
            frontier = next_frontier

        return {
            "start_node_id": start.id,
            "nodes": [self._node_payload(node) for node in nodes.values()],
            "edges": list(edges.values()),
            "truncated": truncated,
        }

    def related(
        self,
        node_id: str,
        *,
        relation_types: list[str] | None = None,
        include: list[str] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        node = self._nodes.get(node_id)
        if node is None:
            raise NodeNotFound(f"节点不存在: {node_id}")
        limit = max(1, min(limit, 100))
        include_set = set(include or ["code", "docs", "memory", "other"])
        relations = self._relations.get_neighbors(
            [node.id],
            direction="both",
            relation_types=self._relation_types(relation_types),
            limit_per_node=limit,
            total_limit=limit * 2,
        )
        other_ids = {
            edge.to_node_id if edge.from_node_id == node.id else edge.from_node_id
            for edge in relations
        }
        node_map = {item.id: item for item in self._nodes.get_many(sorted(other_ids))}
        buckets: dict[str, list[dict[str, Any]]] = {
            "code": [],
            "docs": [],
            "memory": [],
            "other": [],
        }
        for edge in relations:
            other_id = (
                edge.to_node_id if edge.from_node_id == node.id else edge.from_node_id
            )
            other = node_map.get(other_id)
            if other is None:
                continue
            category = _category(other.node_type)
            if category not in include_set:
                continue
            if len(buckets[category]) >= limit:
                continue
            buckets[category].append(
                {
                    **self._node_payload(other),
                    "relation_type": edge.relation_type.value,
                    "direction": (
                        "outgoing" if edge.from_node_id == node.id else "incoming"
                    ),
                    "relation_confidence": edge.confidence,
                    "weight": edge.weight,
                }
            )
        return {
            "node": self._node_payload(node),
            "related": buckets,
        }

    def _candidate_payload(
        self,
        candidate: Candidate,
        relations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        payload = self._node_payload(candidate.node)
        payload["score"] = round(candidate.score, 6)
        payload["reasons"] = candidate.reasons
        snippet = (candidate.snippet or _snippet(candidate.node)).replace("\n", " ")
        payload["snippet"] = snippet[:180] + ("..." if len(snippet) > 180 else "")
        payload["relations"] = relations
        return payload

    def _relation_summaries(
        self,
        node_ids: list[str],
    ) -> dict[str, list[dict[str, Any]]]:
        if not node_ids:
            return {}
        edges = self._relations.get_neighbors(
            node_ids,
            direction="both",
            limit_per_node=3,
            total_limit=max(12, len(node_ids) * 3),
        )
        other_ids = {
            edge.to_node_id if edge.from_node_id in node_ids else edge.from_node_id
            for edge in edges
        }
        node_map = {node.id: node for node in self._nodes.get_many(sorted(other_ids))}
        result: dict[str, list[dict[str, Any]]] = {node_id: [] for node_id in node_ids}
        wanted = set(node_ids)
        for edge in edges:
            pivot = edge.from_node_id if edge.from_node_id in wanted else edge.to_node_id
            other_id = (
                edge.to_node_id if edge.from_node_id == pivot else edge.from_node_id
            )
            other = node_map.get(other_id)
            if other is None or len(result[pivot]) >= 3:
                continue
            result[pivot].append(
                {
                    "relation_type": edge.relation_type.value,
                    "direction": (
                        "outgoing" if edge.from_node_id == pivot else "incoming"
                    ),
                    "node_id": other.id,
                    "node_type": other.node_type.value,
                    "title": other.title,
                    "confidence": edge.confidence,
                }
            )
        return result

    def _edge_payload(self, edge: Any) -> dict[str, Any]:
        return {
            "relation_id": edge.id,
            "from_node_id": edge.from_node_id,
            "to_node_id": edge.to_node_id,
            "relation_type": edge.relation_type.value,
            "confidence": edge.confidence,
            "weight": edge.weight,
        }

    def _node_payload(self, node: KnowledgeNode) -> dict[str, Any]:
        return {
            "node_id": node.id,
            "node_type": node.node_type.value,
            "title": node.title,
            "path": node.path,
            "start_line": node.start_line,
            "end_line": node.end_line,
            "summary": node.summary,
            "language": node.language,
            "salience": node.salience,
            "confidence": node.confidence,
            "updated_at": node.updated_at,
        }

    def _project_id(self, project_reference: str | None) -> str | None:
        if not project_reference:
            return None
        return self._projects.resolve(project_reference).id

    def _normalize_limit(self, limit: int | None) -> int:
        value = self._settings.retrieval.default_limit if limit is None else limit
        return max(1, min(value, 50))

    def _node_types(self, values: list[str] | None) -> list[str] | None:
        if not values:
            return None
        normalized = [value.lower() for value in values]
        allowed = {item.value for item in NodeType}
        invalid = [value for value in normalized if value not in allowed]
        if invalid:
            raise InvalidArgument(f"未知节点类型: {', '.join(invalid)}")
        return normalized

    def _relation_types(self, values: list[str] | None) -> list[str] | None:
        if not values:
            return None
        normalized = [value.upper() for value in values]
        allowed = {item.value for item in RelationType}
        invalid = [value for value in normalized if value not in allowed]
        if invalid:
            raise InvalidArgument(f"未知关系类型: {', '.join(invalid)}")
        return normalized


def _category(node_type: NodeType) -> str:
    if node_type in {NodeType.FILE, NodeType.CLASS, NodeType.FUNCTION, NodeType.METHOD}:
        return "code"
    if node_type in {NodeType.DOCUMENT, NodeType.DOC_SECTION}:
        return "docs"
    if node_type in {NodeType.MEMORY, NodeType.NOTE}:
        return "memory"
    return "other"


def _snippet(node: KnowledgeNode) -> str:
    if node.summary:
        return node.summary
    content = (node.content or "").strip().replace("\n", " ")
    return content[:200]
