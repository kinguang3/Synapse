from __future__ import annotations

from typing import Any

from synapse.core.clock import utc_now_iso
from synapse.core.hashing import sha256_text
from synapse.core.ids import stable_id
from synapse.core.text import tokenize_for_search
from synapse.domain.enums import MemoryType, NodeType, Provenance, SourceStatus, SourceType
from synapse.domain.models import KnowledgeNode, NodeDraft, Source
from synapse.normalizer.normalizer import Normalizer
from synapse.parsers.base import RawFile
from synapse.storage.sqlite.database import Database
from synapse.storage.sqlite.repositories import (
    NodeRepository,
    RefRepository,
    RelationRepository,
    SourceRepository,
)


class KnowledgeService:
    def __init__(
        self,
        database: Database,
        sources: SourceRepository,
        nodes: NodeRepository,
        relations: RelationRepository,
        refs: RefRepository,
        normalizer: Normalizer | None = None,
    ) -> None:
        self._database = database
        self._sources = sources
        self._nodes = nodes
        self._relations = relations
        self._refs = refs
        self._normalizer = normalizer or Normalizer()

    def apply_file(
        self,
        *,
        project_id: str,
        source: Source,
        raw: RawFile,
        content_hash: str,
        size_bytes: int,
        mtime_ns: int,
        parser_name: str,
        parser_version: str,
        create_source: bool = False,
        update_source: bool = False,
    ) -> tuple[int, int, int]:
        normalized = self._normalizer.normalize(
            project_id=project_id,
            source_id=source.id,
            raw=raw,
        )
        now = utc_now_iso()
        with self._database.transaction() as connection:
            if create_source:
                self._sources.insert(source, connection=connection)
            elif update_source:
                self._sources.update(source, connection=connection)
            existing = self._nodes.list_keys_for_source(source.id, connection=connection)
            new_ids = {node.id for node in normalized.nodes}
            stale_ids = [node_id for node_id in existing if node_id not in new_ids]
            if stale_ids:
                self._nodes.delete_by_ids(stale_ids, connection=connection)
            affected = list(set(existing) | new_ids)
            if affected:
                self._relations.delete_outgoing_for_nodes(affected, connection=connection)
            self._nodes.upsert_many(normalized.nodes, connection=connection)
            self._relations.upsert_many(normalized.relations, connection=connection)
            self._refs.replace_for_source(source.id, normalized.refs, connection=connection)
            self._sources.mark_indexed(
                source.id,
                content_hash=content_hash,
                size_bytes=size_bytes,
                mtime_ns=mtime_ns,
                parser_name=parser_name,
                parser_version=parser_version,
                timestamp=now,
                connection=connection,
            )
        return len(normalized.nodes), len(normalized.relations), len(normalized.refs)

    def delete_source(self, source_id: str) -> int:
        now = utc_now_iso()
        with self._database.transaction() as connection:
            removed = self._nodes.delete_by_source(source_id, connection=connection)
            self._refs.delete_for_source(source_id, connection=connection)
            self._sources.mark_deleted(source_id, now, connection=connection)
        return removed

    def ingest_text(
        self,
        *,
        project_id: str,
        content: str,
        title: str,
        source_type: SourceType = SourceType.USER,
        tags: list[str] | None = None,
        idempotency_key: str | None = None,
        memory_type: MemoryType | None = None,
        confidence: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[Source, KnowledgeNode]:
        now = utc_now_iso()
        key = idempotency_key or stable_id("text", project_id, title, sha256_text(content))
        uri = f"text://{key}"
        source_id = stable_id("source", project_id, str(source_type), uri)
        source = self._sources.get_by_uri(project_id, str(source_type), uri)
        tags = tags or []
        tag_text = " ".join(tags)
        node_type = NodeType.MEMORY if memory_type is not None else NodeType.NOTE
        node_id = stable_id(project_id, source_id, node_type.value, "root")
        node = NodeDraft(
            id=node_id,
            project_id=project_id,
            source_id=source_id,
            node_type=node_type,
            node_key="root",
            title=title,
            content=content,
            search_text=tokenize_for_search("\n".join([title, content, tag_text])),
            tags=tag_text,
            content_hash=sha256_text(content),
            path=None,
            start_line=None,
            end_line=None,
            summary=content[:300],
            language="markdown",
            symbol_kind="note" if node_type is NodeType.NOTE else "memory",
            qualified_name=title,
            qualified_name_norm=title.strip().lower(),
            salience=0.65 if node_type is NodeType.NOTE else 0.70,
            confidence=max(0.0, min(1.0, confidence)),
            memory_type=memory_type,
            provenance=Provenance.USER,
            metadata={
                "source_type": str(source_type),
                "tags": tags,
                **(metadata or {}),
            },
        )
        with self._database.transaction() as connection:
            if source is None:
                source = Source(
                    id=source_id,
                    project_id=project_id,
                    source_type=source_type,
                    uri=uri,
                    language="markdown",
                    content_hash=sha256_text(content),
                    size_bytes=len(content.encode("utf-8")),
                    status=SourceStatus.ACTIVE,
                    parser_name="manual",
                    parser_version="1",
                    indexed_at=now,
                    created_at=now,
                    updated_at=now,
                    metadata=metadata or {},
                )
                self._sources.insert(source, connection=connection)
            else:
                self._sources.mark_indexed(
                    source_id,
                    content_hash=sha256_text(content),
                    size_bytes=len(content.encode("utf-8")),
                    mtime_ns=0,
                    parser_name="manual",
                    parser_version="1",
                    timestamp=now,
                    connection=connection,
                )
            self._nodes.upsert_many([node], connection=connection)
        stored = self._nodes.get(node_id)
        if stored is None:
            raise RuntimeError("写入知识节点后无法读取")
        return source, stored
