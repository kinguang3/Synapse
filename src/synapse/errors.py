from __future__ import annotations

from typing import Any


class SynapseError(Exception):
    code = "INTERNAL"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


class InvalidArgument(SynapseError):
    code = "INVALID_ARGUMENT"


class ProjectNotFound(SynapseError):
    code = "PROJECT_NOT_FOUND"


class NodeNotFound(SynapseError):
    code = "NODE_NOT_FOUND"


class AmbiguousProject(SynapseError):
    code = "AMBIGUOUS_PROJECT"


class DatabaseBusy(SynapseError):
    code = "DB_BUSY"


class IndexUnavailable(SynapseError):
    code = "INDEX_UNAVAILABLE"


class IndexLocked(SynapseError):
    code = "INDEX_LOCKED"


class ConflictVersion(SynapseError):
    code = "CONFLICT_VERSION"


class NotImplementedTool(SynapseError):
    code = "NOT_IMPLEMENTED"


class ParserError(SynapseError):
    code = "PARSER_ERROR"


class StorageError(SynapseError):
    code = "STORAGE_ERROR"
