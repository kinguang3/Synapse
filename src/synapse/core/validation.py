from __future__ import annotations

import re

from synapse.errors import InvalidArgument

_DRIVE_RE = re.compile(r"^[A-Za-z]:")


def normalize_path_prefix(value: str | None) -> str | None:
    """Validate and normalize a project-relative path prefix.

    Every entrypoint (CLI, GUI API, MCP) goes through this single rule:
    backslashes become forward slashes, empty values are ignored, and
    absolute paths, drive letters and ``..`` segments are rejected.
    """

    if value is None:
        return None
    normalized = value.replace("\\", "/").strip()
    if not normalized:
        return None
    if normalized.startswith("/") or _DRIVE_RE.match(normalized):
        raise InvalidArgument("path_prefix 必须是项目内相对路径前缀")
    parts = [part for part in normalized.split("/") if part not in {"", "."}]
    if any(part == ".." for part in parts):
        raise InvalidArgument("path_prefix 不得包含 '..'")
    return "/".join(parts) or None
