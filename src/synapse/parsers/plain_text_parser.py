from __future__ import annotations

from pathlib import Path

from synapse.parsers.base import RawFile, RawNode

_MAX_CONTENT_CHARS = 200_000


class PlainTextParser:
    name = "plain-text"
    version = "1"
    suffixes = {
        ".json",
        ".jsonc",
        ".toml",
        ".yaml",
        ".yml",
        ".txt",
        ".cfg",
        ".ini",
        ".conf",
        ".csv",
        ".xml",
    }

    def supports(self, path: Path, language: str | None) -> bool:
        return path.suffix.lower() in self.suffixes

    def parse(self, path: Path, relative_path: str, data: bytes) -> RawFile:
        content = data.decode("utf-8", errors="replace")[:_MAX_CONTENT_CHARS]
        language = path.suffix.lower().lstrip(".") or "text"
        node = RawNode(
            local_key="file",
            node_type="file",
            title=relative_path,
            content=content,
            start_line=1,
            end_line=max(1, content.count("\n") + 1),
            symbol_kind="file",
            qualified_name=relative_path,
            tags=[language],
            metadata={"language": language},
        )
        return RawFile(path=relative_path, language=language, nodes=[node])
