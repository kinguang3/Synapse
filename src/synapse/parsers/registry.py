from __future__ import annotations

from pathlib import Path

from synapse.parsers.base import RawFile
from synapse.parsers.markdown_parser import MarkdownParser
from synapse.parsers.plain_text_parser import PlainTextParser
from synapse.parsers.python_parser import PythonParser
from synapse.ports.parsers import ParserPort

_LANGUAGE_BY_SUFFIX = {
    ".py": "python",
    ".md": "markdown",
    ".markdown": "markdown",
    ".json": "json",
    ".jsonc": "json",
    ".toml": "toml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".txt": "text",
    ".cfg": "ini",
    ".ini": "ini",
    ".conf": "ini",
    ".csv": "csv",
    ".xml": "xml",
}


def language_for_path(path: Path) -> str | None:
    return _LANGUAGE_BY_SUFFIX.get(path.suffix.lower())


class ParserRegistry:
    def __init__(self, parsers: list[ParserPort] | None = None) -> None:
        self._parsers: list[ParserPort] = parsers or [
            PythonParser(),
            MarkdownParser(),
            PlainTextParser(),
        ]

    @property
    def supported_suffixes(self) -> set[str]:
        suffixes: set[str] = set(_LANGUAGE_BY_SUFFIX)
        for parser in self._parsers:
            suffixes.update(getattr(parser, "suffixes", set()))
        return suffixes

    def language_for(self, path: Path) -> str | None:
        return language_for_path(path)

    def for_path(self, path: Path, language: str | None = None) -> ParserPort | None:
        resolved = language or language_for_path(path)
        for parser in self._parsers:
            if parser.supports(path, resolved):
                return parser
        return None

    def parse(self, path: Path, relative_path: str, data: bytes, language: str) -> tuple[RawFile, str, str]:
        parser = self.for_path(path, language)
        if parser is None:
            raise ValueError(f"没有可用的解析器: {path}")
        raw = parser.parse(path, relative_path, data)
        return raw, parser.name, parser.version
