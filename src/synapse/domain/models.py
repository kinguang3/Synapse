from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from synapse.domain.enums import (
    MemoryType,
    NodeStatus,
    NodeType,
    Provenance,
    RelationType,
    SourceStatus,
    SourceType,
)


@dataclass(slots=True)
class Project:
    id: str
    slug: str
    name: str
    root_path: str
    description: str | None = None
    config: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    last_indexed_at: str | None = None


@dataclass(slots=True)
class Source:
    id: str
    project_id: str
    source_type: SourceType
    uri: str
    language: str | None = None
    content_hash: str | None = None
    size_bytes: int | None = None
    mtime_ns: int | None = None
    status: SourceStatus = SourceStatus.ACTIVE
    parser_name: str | None = None
    parser_version: str | None = None
    indexed_at: str | None = None
    created_at: str = ""
    updated_at: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class NodeDraft:
    id: str
    project_id: str
    source_id: str | None
    node_type: NodeType
    node_key: str
    title: str
    content: str
    search_text: str
    tags: str
    content_hash: str
    path: str | None
    start_line: int | None
    end_line: int | None
    summary: str | None = None
    language: str | None = None
    symbol_kind: str | None = None
    qualified_name: str | None = None
    qualified_name_norm: str | None = None
    status: NodeStatus = NodeStatus.ACTIVE
    salience: float = 0.5
    confidence: float = 1.0
    memory_type: MemoryType | None = None
    provenance: Provenance = Provenance.AST
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class KnowledgeNode:
    pk: int
    id: str
    project_id: str
    source_id: str | None
    node_type: NodeType
    node_key: str
    version: int
    title: str
    content: str
    search_text: str
    tags: str
    content_hash: str
    summary: str | None
    language: str | None
    path: str | None
    start_line: int | None
    end_line: int | None
    symbol_kind: str | None
    qualified_name: str | None
    qualified_name_norm: str | None
    status: NodeStatus
    salience: float
    confidence: float
    memory_type: MemoryType | None
    provenance: Provenance
    created_at: str
    updated_at: str
    accessed_at: str | None
    access_count: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RelationDraft:
    id: str
    project_id: str
    from_node_id: str
    to_node_id: str
    relation_type: RelationType
    confidence: float
    weight: float
    provenance: Provenance
    evidence: list[dict[str, Any]] = field(default_factory=list)
    status: str = "active"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Relation:
    id: str
    project_id: str
    from_node_id: str
    to_node_id: str
    relation_type: RelationType
    confidence: float
    weight: float
    provenance: Provenance
    evidence: list[dict[str, Any]]
    status: str
    created_at: str
    updated_at: str
    access_count: int
    last_accessed_at: str | None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RecoveryReport:
    interrupted_runs: int = 0
    canceled_tasks: int = 0


@dataclass(slots=True)
class IndexStats:
    scanned: int = 0
    changed: int = 0
    unchanged: int = 0
    deleted: int = 0
    renamed: int = 0
    nodes_upserted: int = 0
    nodes_removed: int = 0
    relations_upserted: int = 0
    unresolved: int = 0
    resolved: int = 0
    failed: int = 0
    recovered_runs: int = 0
    recovered_tasks: int = 0
    duration_ms: int = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "scanned": self.scanned,
            "changed": self.changed,
            "unchanged": self.unchanged,
            "deleted": self.deleted,
            "renamed": self.renamed,
            "nodes_upserted": self.nodes_upserted,
            "nodes_removed": self.nodes_removed,
            "relations_upserted": self.relations_upserted,
            "unresolved": self.unresolved,
            "resolved": self.resolved,
            "failed": self.failed,
            "recovered_runs": self.recovered_runs,
            "recovered_tasks": self.recovered_tasks,
            "duration_ms": self.duration_ms,
            "errors": self.errors,
        }
