from __future__ import annotations

from pathlib import Path

import pathspec

DEFAULT_IGNORED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    "node_modules",
    "dist",
    "build",
    "target",
    "bin",
    "obj",
    ".idea",
    ".vscode",
    ".next",
    ".nuxt",
    "coverage",
    "htmlcov",
    ".synapse",
}

_IGNORE_FILES = (".gitignore", ".synapseignore")


def load_ignore_spec(root: Path) -> pathspec.PathSpec:
    lines: list[str] = []
    for name in _IGNORE_FILES:
        path = root / name
        if not path.is_file():
            continue
        try:
            lines.extend(path.read_text(encoding="utf-8", errors="replace").splitlines())
        except OSError:
            continue
    if not lines:
        return pathspec.PathSpec.from_lines("gitwildmatch", [])
    return pathspec.PathSpec.from_lines("gitwildmatch", lines)
