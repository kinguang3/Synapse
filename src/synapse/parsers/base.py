from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class RawNode:
    local_key: str
    node_type: str
    title: str
    content: str
    start_line: int
    end_line: int
    symbol_kind: str | None = None
    qualified_name: str | None = None
    docstring: str = ""
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RawRelation:
    from_local_key: str
    to_local_key: str
    relation_type: str
    confidence: float = 0.95
    provenance: str = "ast"
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RawRef:
    from_local_key: str
    ref_kind: str
    target_text: str
    target_path: str | None = None
    line: int | None = None
    confidence: float = 0.8
    provenance: str = "ast"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RawFile:
    path: str
    language: str
    nodes: list[RawNode] = field(default_factory=list)
    relations: list[RawRelation] = field(default_factory=list)
    unresolved: list[RawRef] = field(default_factory=list)
    diagnostics: list[str] = field(default_factory=list)
