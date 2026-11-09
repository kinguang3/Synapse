from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import pathspec

from synapse.core.paths import relative_posix
from synapse.ingestion.ignore import DEFAULT_IGNORED_DIRS, load_ignore_spec
from synapse.parsers.registry import ParserRegistry

_BINARY_SAMPLE = 8192
_BINARY_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".7z",
    ".rar",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".pyc",
    ".pyo",
    ".class",
    ".jar",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".mp3",
    ".mp4",
    ".mov",
    ".avi",
    ".sqlite",
    ".db",
}


@dataclass(slots=True)
class FileInfo:
    path: Path
    relative_path: str
    size_bytes: int
    mtime_ns: int
    language: str | None


@dataclass(slots=True)
class ScanResult:
    files: list[FileInfo] = field(default_factory=list)
    ignored: int = 0
    errors: list[str] = field(default_factory=list)


class Scanner:
    def __init__(
        self,
        registry: ParserRegistry,
        *,
        max_file_bytes: int = 2_000_000,
        follow_symlinks: bool = False,
    ) -> None:
        self._registry = registry
        self._max_file_bytes = max_file_bytes
        self._follow_symlinks = follow_symlinks

    def scan(self, root: Path) -> ScanResult:
        root = root.resolve()
        spec = load_ignore_spec(root)
        supported = self._registry.supported_suffixes
        result = ScanResult()

        for current_root, dir_names, file_names in os.walk(
            root, followlinks=self._follow_symlinks
        ):
            current = Path(current_root)
            kept_dirs: list[str] = []
            for dir_name in sorted(dir_names):
                if dir_name in DEFAULT_IGNORED_DIRS:
                    result.ignored += 1
                    continue
                relative = (current / dir_name).relative_to(root).as_posix() + "/"
                if self._is_ignored(spec, relative):
                    result.ignored += 1
                    continue
                if not self._follow_symlinks and (current / dir_name).is_symlink():
                    result.ignored += 1
                    continue
                kept_dirs.append(dir_name)
            dir_names[:] = kept_dirs

            for file_name in sorted(file_names):
                if file_name.startswith("."):
                    result.ignored += 1
                    continue
                path = current / file_name
                if path.suffix.lower() in _BINARY_SUFFIXES:
                    result.ignored += 1
                    continue
                if path.suffix.lower() not in supported:
                    result.ignored += 1
                    continue
                relative = relative_posix(root, path)
                if self._is_ignored(spec, relative):
                    result.ignored += 1
                    continue
                try:
                    stat = path.stat()
                except OSError as exc:
                    result.errors.append(f"{relative}: {exc}")
                    continue
                if stat.st_size > self._max_file_bytes:
                    result.ignored += 1
                    continue
                try:
                    with path.open("rb") as handle:
                        sample = handle.read(_BINARY_SAMPLE)
                except OSError as exc:
                    result.errors.append(f"{relative}: {exc}")
                    continue
                if b"\x00" in sample:
                    result.ignored += 1
                    continue
                result.files.append(
                    FileInfo(
                        path=path,
                        relative_path=relative,
                        size_bytes=stat.st_size,
                        mtime_ns=stat.st_mtime_ns,
                        language=self._registry.language_for(path),
                    )
                )
        result.files.sort(key=lambda item: item.relative_path)
        return result

    @staticmethod
    def _is_ignored(spec: pathspec.PathSpec, relative_path: str) -> bool:
        return spec.match_file(relative_path)
