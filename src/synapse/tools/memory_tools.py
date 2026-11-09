from __future__ import annotations

from typing import Any

from synapse.domain.enums import MemoryType, NodeType, SourceType
from synapse.errors import InvalidArgument, NodeNotFound
from synapse.knowledge.service import KnowledgeService
from synapse.retrieval.service import RetrievalService
from synapse.storage.sqlite.repositories import NodeRepository, ProjectRepository


class MemoryTools:
    def __init__(
        self,
        *,
        projects: ProjectRepository,
        nodes: NodeRepository,
        knowledge: KnowledgeService,
        retrieval: RetrievalService,
    ) -> None:
        self._projects = projects
        self._nodes = nodes
        self._knowledge = knowledge
        self._retrieval = retrieval

    def remember(
        self,
        project_reference: str,
        content: str,
        *,
        title: str | None = None,
        memory_type: str = "fact",
        tags: list[str] | None = None,
        confidence: float = 1.0,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        project = self._projects.resolve(project_reference)
        text = content.strip()
        if not text:
            raise InvalidArgument("记忆内容不能为空")
        try:
            memory = MemoryType(memory_type)
        except ValueError as exc:
            raise InvalidArgument(f"未知记忆类型: {memory_type}") from exc
        node_title = (title or text.splitlines()[0])[:120]
        source, node = self._knowledge.ingest_text(
            project_id=project.id,
            content=text,
            title=node_title,
            source_type=SourceType.USER,
            tags=tags,
            idempotency_key=idempotency_key,
            memory_type=memory,
            confidence=confidence,
        )
        return {
            "source_id": source.id,
            "node": self._node_payload(node),
        }

    def recall(
        self,
        query: str,
        *,
        project: str | None = None,
        limit: int = 10,
        mode: str = "hybrid",
    ) -> dict[str, Any]:
        return self._retrieval.search(
            query,
            project_reference=project,
            limit=limit,
            mode=mode,
            node_types=[NodeType.MEMORY.value, NodeType.NOTE.value],
        )

    def get(self, node_id: str) -> dict[str, Any]:
        node = self._nodes.get(node_id)
        if node is None:
            raise NodeNotFound(f"节点不存在: {node_id}")
        return self._node_payload(node)

    def _node_payload(self, node: Any) -> dict[str, Any]:
        return {
            "node_id": node.id,
            "node_type": node.node_type.value,
            "memory_type": node.memory_type.value if node.memory_type else None,
            "title": node.title,
            "content": node.content,
            "tags": node.tags,
            "confidence": node.confidence,
            "salience": node.salience,
            "created_at": node.created_at,
            "updated_at": node.updated_at,
        }
