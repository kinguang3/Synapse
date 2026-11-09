from __future__ import annotations

from pathlib import Path
from typing import Protocol

from synapse.parsers.base import RawFile


class ParserPort(Protocol):
    name: str
    version: str

    def supports(self, path: Path, language: str | None) -> bool: ...

    def parse(self, path: Path, relative_path: str, data: bytes) -> RawFile: ...
