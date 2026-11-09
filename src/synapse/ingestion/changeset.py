from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from synapse.core.hashing import sha256_file
from synapse.domain.enums import SourceStatus, SourceType
from synapse.domain.models import Source
from synapse.ingestion.scanner import FileInfo, ScanResult
from synapse.parsers.registry import ParserRegistry


@dataclass(slots=True)
class FileChange:
    kind: str
    info: FileInfo
    source: Source | None = None
    content_hash: str | None = None
    old_uri: str | None = None


@dataclass(slots=True)
class ChangeSet:
    changes: list[FileChange] = field(default_factory=list)
    deleted: list[Source] = field(default_factory=list)
    touched: list[tuple[FileInfo, Source]] = field(default_factory=list)
    unchanged: int = 0

    @property
    def renamed_count(self) -> int:
        return sum(1 for change in self.changes if change.kind == "renamed")


class ChangeDetector:
    def __init__(
        self,
        registry: ParserRegistry,
        *,
        verify_content_hashes: bool = False,
    ) -> None:
        self._registry = registry
        self._verify_content_hashes = verify_content_hashes

    def diff(
        self,
        scan: ScanResult,
        sources: list[Source],
        *,
        full: bool = False,
    ) -> ChangeSet:
        by_uri = {
            source.uri: source
            for source in sources
            if source.source_type is SourceType.FILE
        }
        scanned_uris: set[str] = set()
        result = ChangeSet()

        for info in scan.files:
            source = by_uri.get(info.relative_path)
            parser = self._registry.for_path(info.path, info.language)
            parser_version = getattr(parser, "version", None)
            if source is None:
                result.changes.append(FileChange(kind="added", info=info))
                continue

            scanned_uris.add(info.relative_path)
            if source.status is SourceStatus.DELETED:
                result.changes.append(FileChange(kind="modified", info=info, source=source))
                continue
            if full:
                result.changes.append(FileChange(kind="modified", info=info, source=source))
                continue

            metadata_unchanged = (
                source.mtime_ns == info.mtime_ns
                and source.size_bytes == info.size_bytes
                and source.parser_version == parser_version
            )
            if metadata_unchanged and not self._verify_content_hashes:
                result.unchanged += 1
                continue

            content_hash = sha256_file(info.path)
            if source.content_hash == content_hash and source.parser_version == parser_version:
                result.touched.append((info, source))
                result.unchanged += 1
                continue
            result.changes.append(
                FileChange(
                    kind="modified",
                    info=info,
                    source=source,
                    content_hash=content_hash,
                )
            )

        active_sources = [
            source
            for source in sources
            if source.source_type is SourceType.FILE
            and source.status is SourceStatus.ACTIVE
            and source.uri not in scanned_uris
        ]
        deleted = list(active_sources)
        if not full and deleted:
            self._detect_renames(result, deleted)
        result.deleted = deleted
        return result

    def _detect_renames(self, result: ChangeSet, deleted: list[Source]) -> None:
        added = [change for change in result.changes if change.kind == "added"]
        if not added:
            return
        deleted_by_hash: dict[str, list[Source]] = {}
        for source in deleted:
            if source.content_hash:
                deleted_by_hash.setdefault(source.content_hash, []).append(source)
        if not deleted_by_hash:
            return

        for change in added:
            content_hash = change.content_hash or sha256_file(change.info.path)
            change.content_hash = content_hash
            candidates = deleted_by_hash.get(content_hash)
            if not candidates:
                continue
            same_name = [
                source
                for source in candidates
                if Path(source.uri).name == Path(change.info.relative_path).name
            ]
            pool = same_name or candidates
            source = pool[0]
            pool.remove(source)
            if source in candidates:
                candidates.remove(source)
            if not candidates:
                deleted_by_hash.pop(content_hash, None)
            change.kind = "renamed"
            change.source = source
            change.old_uri = source.uri
            if source in deleted:
                deleted.remove(source)
