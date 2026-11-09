from __future__ import annotations

from enum import StrEnum


class NodeType(StrEnum):
    PROJECT = "project"
    FILE = "file"
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    DOCUMENT = "document"
    DOC_SECTION = "doc_section"
    NOTE = "note"
    MEMORY = "memory"


class MemoryType(StrEnum):
    FACT = "fact"
    EXPERIENCE = "experience"
    DECISION = "decision"
    PREFERENCE = "preference"
    SUMMARY = "summary"


class RelationType(StrEnum):
    CONTAINS = "CONTAINS"
    IMPORTS = "IMPORTS"
    CALLS = "CALLS"
    INHERITS = "INHERITS"
    REFERENCES = "REFERENCES"
    EXPLAINS = "EXPLAINS"
    DEPENDS_ON = "DEPENDS_ON"
    RELATED_TO = "RELATED_TO"
    DERIVED_FROM = "DERIVED_FROM"
    SOLVES = "SOLVES"
    CONTRADICTS = "CONTRADICTS"
    MENTIONS = "MENTIONS"


class Provenance(StrEnum):
    AST = "ast"
    EXPLICIT_REF = "explicit_ref"
    USER = "user"
    AGENT_CONFIRMED = "agent_confirmed"
    LLM = "llm"
    EMBEDDING = "embedding"
    HEURISTIC = "heuristic"


PROVENANCE_TRUST: dict[str, float] = {
    Provenance.USER: 1.00,
    Provenance.EXPLICIT_REF: 1.00,
    Provenance.AST: 0.95,
    Provenance.AGENT_CONFIRMED: 0.90,
    Provenance.HEURISTIC: 0.65,
    Provenance.LLM: 0.50,
    Provenance.EMBEDDING: 0.40,
}


class NodeStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    TOMBSTONE = "tombstone"


class SourceType(StrEnum):
    FILE = "file"
    TEXT = "text"
    URL = "url"
    AGENT = "agent"
    USER = "user"


class SourceStatus(StrEnum):
    ACTIVE = "active"
    DELETED = "deleted"


class TaskStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"


class RunStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"
    INTERRUPTED = "interrupted"


class SearchMode(StrEnum):
    KEYWORD = "keyword"
    SEMANTIC = "semantic"
    HYBRID = "hybrid"
