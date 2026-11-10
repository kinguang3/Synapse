from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Sequence
from contextlib import contextmanager
from typing import Any

from synapse.core.clock import utc_now_iso
from synapse.core.ids import new_id
from synapse.core.paths import normalized_root
from synapse.domain.enums import (
    PROVENANCE_TRUST,
    MemoryType,
    NodeStatus,
    NodeType,
    Provenance,
    RelationType,
    RunStatus,
    SourceStatus,
    SourceType,
)
from synapse.domain.models import (
    IndexStats,
    KnowledgeNode,
    NodeDraft,
    Project,
    Relation,
    RelationDraft,
    Source,
)
from synapse.domain.scoring import noisy_or
from synapse.errors import IndexUnavailable, ProjectNotFound, StorageError
from synapse.storage.sqlite.database import Database

_CHUNK = 500


def _chunks(values: Sequence[Any], size: int = _CHUNK) -> Iterable[Sequence[Any]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


@contextmanager
def _write_scope(database: Database, connection: sqlite3.Connection | None) -> Any:
    if connection is not None:
        yield connection
        return
    with database.transaction() as managed:
        yield managed


def _json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _project_from_row(row: sqlite3.Row) -> Project:
    return Project(
        id=row["id"],
        slug=row["slug"],
        name=row["name"],
        root_path=row["root_path"],
        description=row["description"],
        config=_json_load(row["config_json"], {}),
        metadata=_json_load(row["metadata_json"], {}),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        last_indexed_at=row["last_indexed_at"],
    )


def _source_from_row(row: sqlite3.Row) -> Source:
    return Source(
        id=row["id"],
        project_id=row["project_id"],
        source_type=SourceType(row["source_type"]),
        uri=row["uri"],
        language=row["language"],
        content_hash=row["content_hash"],
        size_bytes=row["size_bytes"],
        mtime_ns=row["mtime_ns"],
        status=SourceStatus(row["status"]),
        parser_name=row["parser_name"],
        parser_version=row["parser_version"],
        indexed_at=row["indexed_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        metadata=_json_load(row["metadata_json"], {}),
    )


def _node_from_row(row: sqlite3.Row) -> KnowledgeNode:
    entity_data = dict(row)
    return KnowledgeNode(
        pk=entity_data["pk"],
        id=entity_data["id"],
        project_id=entity_data["project_id"],
        source_id=entity_data["source_id"],
        node_type=NodeType(entity_data["node_type"]),
        node_key=entity_data["node_key"],
        version=entity_data["version"],
        title=entity_data["title"],
        content=entity_data["content"],
        search_text=entity_data["search_text"],
        tags=entity_data["tags"],
        content_hash=entity_data["content_hash"],
        summary=entity_data["summary"],
        language=entity_data["language"],
        path=entity_data["path"],
        start_line=entity_data["start_line"],
        end_line=entity_data["end_line"],
        symbol_kind=entity_data["symbol_kind"],
        qualified_name=entity_data["qualified_name"],
        qualified_name_norm=entity_data["qualified_name_norm"],
        status=NodeStatus(entity_data["status"]),
        salience=float(entity_data["salience"]),
        confidence=float(entity_data["confidence"]),
        memory_type=MemoryType(entity_data["memory_type"]) if entity_data["memory_type"] else None,
        provenance=Provenance(entity_data["provenance"]),
        created_at=entity_data["created_at"],
        updated_at=entity_data["updated_at"],
        accessed_at=entity_data["accessed_at"],
        access_count=entity_data["access_count"],
        metadata=_json_load(entity_data["metadata_json"], {}),
    )


def _relation_from_row(row: sqlite3.Row) -> Relation:
    return Relation(
        id=row["id"],
        project_id=row["project_id"],
        from_node_id=row["from_node_id"],
        to_node_id=row["to_node_id"],
        relation_type=RelationType(row["relation_type"]),
        confidence=float(row["confidence"]),
        weight=float(row["weight"]),
        provenance=Provenance(row["provenance"]),
        evidence=_json_load(row["evidence_json"], []),
        status=row["status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        access_count=row["access_count"],
        last_accessed_at=row["last_accessed_at"],
        metadata=_json_load(row["metadata_json"], {}),
    )


class ProjectRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def create(self, project: Project) -> Project:
        now = utc_now_iso()
        try:
            with self._database.transaction() as connection:
                connection.execute(
                    """
                    INSERT INTO projects(
                      id, slug, name, root_path, description, config_json,
                      metadata_json, created_at, updated_at, last_indexed_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        project.id,
                        project.slug,
                        project.name,
                        project.root_path,
                        project.description,
                        _json_dump(project.config),
                        _json_dump(project.metadata),
                        project.created_at or now,
                        project.updated_at or now,
                        project.last_indexed_at,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise StorageError(
                "项目已存在（slug 或根路径重复）",
                details={"slug": project.slug, "root_path": project.root_path},
            ) from exc
        result = self.get(project.id)
        if result is None:
            raise StorageError("项目创建后无法读取")
        return result

    def get(self, project_id: str) -> Project | None:
        row = self._database.connect().execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        return _project_from_row(row) if row else None

    def get_by_slug(self, slug: str) -> Project | None:
        row = self._database.connect().execute(
            "SELECT * FROM projects WHERE slug = ?", (slug,)
        ).fetchone()
        return _project_from_row(row) if row else None

    def resolve(self, reference: str) -> Project:
        project = self.get(reference) or self.get_by_slug(reference)
        if project is None:
            try:
                reference_root = normalized_root(reference)
            except OSError:
                reference_root = ""
            if reference_root:
                for candidate in self.list():
                    try:
                        candidate_root = normalized_root(candidate.root_path)
                    except OSError:
                        continue
                    if candidate_root == reference_root:
                        return candidate
        if project is None:
            raise ProjectNotFound(f"项目不存在: {reference}", details={"reference": reference})
        return project

    def list(self) -> list[Project]:
        rows = self._database.connect().execute(
            "SELECT * FROM projects ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [_project_from_row(row) for row in rows]

    def delete(self, project_id: str) -> None:
        with self._database.transaction() as connection:
            connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    def touch_indexed(self, project_id: str, timestamp: str) -> None:
        with self._database.transaction() as connection:
            connection.execute(
                "UPDATE projects SET last_indexed_at = ?, updated_at = ? WHERE id = ?",
                (timestamp, timestamp, project_id),
            )


class SourceRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def get(self, source_id: str) -> Source | None:
        row = self._database.connect().execute(
            "SELECT * FROM sources WHERE id = ?", (source_id,)
        ).fetchone()
        return _source_from_row(row) if row else None

    def get_by_uri(self, project_id: str, source_type: str, uri: str) -> Source | None:
        row = self._database.connect().execute(
            "SELECT * FROM sources WHERE project_id=? AND source_type=? AND uri=?",
            (project_id, str(source_type), uri),
        ).fetchone()
        return _source_from_row(row) if row else None

    def list_for_project(self, project_id: str) -> list[Source]:
        rows = self._database.connect().execute(
            "SELECT * FROM sources WHERE project_id=? ORDER BY uri", (project_id,)
        ).fetchall()
        return [_source_from_row(row) for row in rows]

    def insert(
        self,
        source: Source,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> Source:
        now = utc_now_iso()
        with _write_scope(self._database, connection) as managed:
            managed.execute(
                """
                INSERT INTO sources(
                  id, project_id, source_type, uri, language, content_hash,
                  size_bytes, mtime_ns, status, parser_name, parser_version,
                  indexed_at, created_at, updated_at, metadata_json
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    source.id,
                    source.project_id,
                    str(source.source_type),
                    source.uri,
                    source.language,
                    source.content_hash,
                    source.size_bytes,
                    source.mtime_ns,
                    str(source.status),
                    source.parser_name,
                    source.parser_version,
                    source.indexed_at,
                    source.created_at or now,
                    source.updated_at or now,
                    _json_dump(source.metadata),
                ),
            )
        result = self.get(source.id)
        if result is None:
            raise StorageError("来源创建后无法读取")
        return result

    def update(
        self,
        source: Source,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        with _write_scope(self._database, connection) as managed:
            managed.execute(
                """
                UPDATE sources SET
                  uri=?, language=?, content_hash=?, size_bytes=?, mtime_ns=?,
                  status=?, parser_name=?, parser_version=?, indexed_at=?,
                  updated_at=?, metadata_json=?
                WHERE id=?
                """,
                (
                    source.uri,
                    source.language,
                    source.content_hash,
                    source.size_bytes,
                    source.mtime_ns,
                    str(source.status),
                    source.parser_name,
                    source.parser_version,
                    source.indexed_at,
                    source.updated_at,
                    _json_dump(source.metadata),
                    source.id,
                ),
            )

    def update_uri(
        self,
        source_id: str,
        uri: str,
        timestamp: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        with _write_scope(self._database, connection) as managed:
            managed.execute(
                "UPDATE sources SET uri=?, updated_at=? WHERE id=?",
                (uri, timestamp, source_id),
            )

    def update_stat(
        self,
        source_id: str,
        *,
        size_bytes: int,
        mtime_ns: int,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        with _write_scope(self._database, connection) as managed:
            managed.execute(
                "UPDATE sources SET size_bytes=?, mtime_ns=? WHERE id=?",
                (size_bytes, mtime_ns, source_id),
            )

    def mark_deleted(
        self,
        source_id: str,
        timestamp: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        with _write_scope(self._database, connection) as managed:
            managed.execute(
                "UPDATE sources SET status=?, updated_at=? WHERE id=?",
                (str(SourceStatus.DELETED), timestamp, source_id),
            )

    def mark_indexed(
        self,
        source_id: str,
        *,
        content_hash: str,
        size_bytes: int,
        mtime_ns: int,
        parser_name: str,
        parser_version: str,
        timestamp: str,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        with _write_scope(self._database, connection) as managed:
            managed.execute(
                """
                UPDATE sources SET
                  content_hash=?, size_bytes=?, mtime_ns=?, parser_name=?,
                  parser_version=?, indexed_at=?, updated_at=?, status=?
                WHERE id=?
                """,
                (
                    content_hash,
                    size_bytes,
                    mtime_ns,
                    parser_name,
                    parser_version,
                    timestamp,
                    timestamp,
                    str(SourceStatus.ACTIVE),
                    source_id,
                ),
            )

    def count_by_project(self, project_id: str) -> int:
        row = self._database.connect().execute(
            "SELECT COUNT(*) AS count FROM sources WHERE project_id=? AND status='active'",
            (project_id,),
        ).fetchone()
        return int(row["count"])


class NodeRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def get(self, node_id: str) -> KnowledgeNode | None:
        row = self._database.connect().execute(
            "SELECT * FROM nodes WHERE id = ?", (node_id,)
        ).fetchone()
        return _node_from_row(row) if row else None

    def get_many(self, node_ids: list[str]) -> list[KnowledgeNode]:
        if not node_ids:
            return []
        nodes: list[KnowledgeNode] = []
        connection = self._database.connect()
        for chunk in _chunks(node_ids):
            placeholders = ",".join("?" for _ in chunk)
            rows = connection.execute(
                f"SELECT * FROM nodes WHERE id IN ({placeholders})", tuple(chunk)
            ).fetchall()
            nodes.extend(_node_from_row(row) for row in rows)
        return nodes

    def list_keys_for_source(
        self,
        source_id: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> dict[str, str]:
        conn = connection or self._database.connect()
        rows = conn.execute(
            "SELECT id, node_key FROM nodes WHERE source_id = ?", (source_id,)
        ).fetchall()
        return {row["id"]: row["node_key"] for row in rows}

    def upsert_many(
        self,
        nodes: list[NodeDraft],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        if not nodes:
            return 0
        now = utc_now_iso()
        values = [
            (
                node.id,
                node.project_id,
                node.source_id,
                str(node.node_type),
                node.node_key,
                node.title,
                node.content,
                node.search_text,
                node.tags,
                node.content_hash,
                node.summary,
                node.language,
                node.path,
                node.start_line,
                node.end_line,
                node.symbol_kind,
                node.qualified_name,
                node.qualified_name_norm,
                str(node.status),
                node.salience,
                node.confidence,
                str(node.memory_type) if node.memory_type else None,
                str(node.provenance),
                now,
                now,
                _json_dump(node.metadata),
            )
            for node in nodes
        ]
        with _write_scope(self._database, connection) as managed:
            managed.executemany(
                """
                INSERT INTO nodes(
                  id, project_id, source_id, node_type, node_key, title, content,
                  search_text, tags, content_hash, summary, language, path,
                  start_line, end_line, symbol_kind, qualified_name,
                  qualified_name_norm, status, salience, confidence, memory_type,
                  provenance, created_at, updated_at, metadata_json
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  source_id=excluded.source_id,
                  node_type=excluded.node_type,
                  node_key=excluded.node_key,
                  version=nodes.version + 1,
                  title=excluded.title,
                  content=excluded.content,
                  search_text=excluded.search_text,
                  tags=excluded.tags,
                  content_hash=excluded.content_hash,
                  summary=excluded.summary,
                  language=excluded.language,
                  path=excluded.path,
                  start_line=excluded.start_line,
                  end_line=excluded.end_line,
                  symbol_kind=excluded.symbol_kind,
                  qualified_name=excluded.qualified_name,
                  qualified_name_norm=excluded.qualified_name_norm,
                  status=excluded.status,
                  salience=excluded.salience,
                  confidence=excluded.confidence,
                  memory_type=excluded.memory_type,
                  provenance=excluded.provenance,
                  updated_at=excluded.updated_at,
                  metadata_json=excluded.metadata_json
                """,
                values,
            )
        return len(nodes)

    def delete_by_ids(
        self,
        node_ids: list[str],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        if not node_ids:
            return 0
        deleted = 0
        with _write_scope(self._database, connection) as managed:
            for chunk in _chunks(node_ids):
                placeholders = ",".join("?" for _ in chunk)
                cursor = managed.execute(
                    f"DELETE FROM nodes WHERE id IN ({placeholders})", tuple(chunk)
                )
                deleted += cursor.rowcount
        return deleted

    def delete_by_source(
        self,
        source_id: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        with _write_scope(self._database, connection) as managed:
            cursor = managed.execute("DELETE FROM nodes WHERE source_id = ?", (source_id,))
            return cursor.rowcount

    def search_fts(
        self,
        match_query: str,
        *,
        project_id: str | None,
        limit: int,
        node_types: list[str] | None,
        path_prefix: str | None,
    ) -> list[tuple[KnowledgeNode, float, str]]:
        conditions = ["node_fts MATCH ?", "nodes.status = 'active'"]
        parameters: list[Any] = [match_query]
        if project_id:
            conditions.append("nodes.project_id = ?")
            parameters.append(project_id)
        if node_types:
            placeholders = ",".join("?" for _ in node_types)
            conditions.append(f"nodes.node_type IN ({placeholders})")
            parameters.extend(node_types)
        if path_prefix:
            conditions.append("nodes.path LIKE ?")
            parameters.append(path_prefix.rstrip("/") + "%")
        parameters.append(limit)
        sql = f"""
            SELECT nodes.*,
                   bm25(node_fts, 5.0, 1.0, 2.0) AS rank,
                   snippet(node_fts, 1, '[', ']', '…', 16) AS snippet
            FROM node_fts
            JOIN nodes ON nodes.pk = node_fts.rowid
            WHERE {' AND '.join(conditions)}
            ORDER BY rank
            LIMIT ?
        """
        try:
            rows = self._database.connect().execute(sql, tuple(parameters)).fetchall()
        except sqlite3.DatabaseError as exc:
            raise IndexUnavailable(
                "全文索引不可用",
                details={"error": str(exc)},
            ) from exc
        return [(_node_from_row(row), float(row["rank"]), str(row["snippet"])) for row in rows]

    def find_exact_symbols(
        self,
        normalized_query: str,
        *,
        project_id: str | None,
        limit: int,
    ) -> list[KnowledgeNode]:
        conditions = [
            "status = 'active'",
            "(qualified_name_norm = ? OR qualified_name_norm LIKE ?)",
        ]
        parameters: list[Any] = [normalized_query, f"%.{normalized_query}"]
        if project_id:
            conditions.append("project_id = ?")
            parameters.append(project_id)
        parameters.extend([normalized_query, limit])
        rows = self._database.connect().execute(
            f"""
            SELECT * FROM nodes
            WHERE {' AND '.join(conditions)}
            ORDER BY CASE WHEN qualified_name_norm = ? THEN 0 ELSE 1 END,
                     length(qualified_name_norm) ASC
            LIMIT ?
            """,
            tuple(parameters),
        ).fetchall()
        return [_node_from_row(row) for row in rows]

    def find_by_path(self, project_id: str, path: str) -> KnowledgeNode | None:
        row = self._database.connect().execute(
            """
            SELECT * FROM nodes
            WHERE project_id=? AND path=? AND node_type IN ('file','document')
            LIMIT 1
            """,
            (project_id, path),
        ).fetchone()
        return _node_from_row(row) if row else None

    def find_symbols_by_name(
        self, project_id: str, name: str, *, limit: int = 10
    ) -> list[KnowledgeNode]:
        rows = self._database.connect().execute(
            """
            SELECT * FROM nodes
            WHERE project_id=? AND status='active'
              AND (qualified_name_norm=? OR qualified_name_norm LIKE ?)
            LIMIT ?
            """,
            (project_id, name, f"%.{name}", limit),
        ).fetchall()
        return [_node_from_row(row) for row in rows]

    def top_by_salience(
        self,
        project_id: str,
        *,
        node_types: list[str],
        limit: int,
    ) -> list[KnowledgeNode]:
        placeholders = ",".join("?" for _ in node_types)
        rows = self._database.connect().execute(
            f"""
            SELECT * FROM nodes
            WHERE project_id=? AND status='active' AND node_type IN ({placeholders})
            ORDER BY salience DESC, updated_at DESC
            LIMIT ?
            """,
            (project_id, *node_types, limit),
        ).fetchall()
        return [_node_from_row(row) for row in rows]

    def recent(self, project_id: str, limit: int) -> list[KnowledgeNode]:
        rows = self._database.connect().execute(
            """
            SELECT * FROM nodes
            WHERE project_id=? AND status='active'
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (project_id, limit),
        ).fetchall()
        return [_node_from_row(row) for row in rows]

    def memories(
        self,
        project_id: str,
        *,
        memory_type: str | None = None,
        limit: int = 10,
    ) -> list[KnowledgeNode]:
        conditions = [
            "project_id=?",
            "status='active'",
            "node_type=?",
        ]
        parameters: list[Any] = [project_id, NodeType.MEMORY.value]
        if memory_type:
            conditions.append("memory_type=?")
            parameters.append(memory_type)
        parameters.append(limit)
        rows = self._database.connect().execute(
            f"""
            SELECT * FROM nodes
            WHERE {' AND '.join(conditions)}
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            tuple(parameters),
        ).fetchall()
        return [_node_from_row(row) for row in rows]

    def all_for_project(self, project_id: str, *, limit: int = 100_000) -> list[KnowledgeNode]:
        rows = self._database.connect().execute(
            "SELECT * FROM nodes WHERE project_id=? AND status='active' LIMIT ?",
            (project_id, limit),
        ).fetchall()
        return [_node_from_row(row) for row in rows]

    def modules_for_paths(
        self,
        project_id: str,
        paths: list[str],
        *,
        limit: int = 500,
    ) -> list[KnowledgeNode]:
        if not paths:
            return []
        placeholders = ",".join("?" for _ in paths)
        rows = self._database.connect().execute(
            f"""
            SELECT * FROM nodes
            WHERE project_id=? AND status='active'
              AND node_type IN ('class','file','document')
              AND path IN ({placeholders})
            ORDER BY path, salience DESC, updated_at DESC, length(content) DESC, title
            LIMIT ?
            """,
            (project_id, *paths, limit),
        ).fetchall()
        return [_node_from_row(row) for row in rows]

    def counts(self, project_id: str) -> dict[str, int]:
        connection = self._database.connect()
        total = connection.execute(
            "SELECT COUNT(*) AS count FROM nodes WHERE project_id=?", (project_id,)
        ).fetchone()
        rows = connection.execute(
            "SELECT node_type, COUNT(*) AS count FROM nodes WHERE project_id=? GROUP BY node_type",
            (project_id,),
        ).fetchall()
        result = {str(row["node_type"]): int(row["count"]) for row in rows}
        result["total"] = int(total["count"])
        return result

    def get_by_source(self, source_id: str) -> list[KnowledgeNode]:
        rows = self._database.connect().execute(
            "SELECT * FROM nodes WHERE source_id=? ORDER BY start_line", (source_id,)
        ).fetchall()
        return [_node_from_row(row) for row in rows]


class RelationRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def get(self, relation_id: str) -> Relation | None:
        row = self._database.connect().execute(
            "SELECT * FROM relations WHERE id=?", (relation_id,)
        ).fetchone()
        return _relation_from_row(row) if row else None

    def upsert_many(
        self,
        relations: list[RelationDraft],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        if not relations:
            return 0
        existing: dict[str, Relation] = {}
        ids = [relation.id for relation in relations]
        reader = connection or self._database.connect()
        for chunk in _chunks(ids):
            placeholders = ",".join("?" for _ in chunk)
            rows = reader.execute(
                f"SELECT * FROM relations WHERE id IN ({placeholders})", tuple(chunk)
            ).fetchall()
            for row in rows:
                mapped = _relation_from_row(row)
                existing[mapped.id] = mapped

        now = utc_now_iso()
        values: list[tuple[Any, ...]] = []
        for draft in relations:
            evidence = list(draft.evidence)
            confidence = draft.confidence
            provenance = draft.provenance
            weight = draft.weight
            created_at = now
            previous = existing.get(draft.id)
            if previous is not None:
                created_at = previous.created_at
                known = {
                    (
                        str(item.get("provenance", "")),
                        str(item.get("source_id", "")),
                        str(item.get("detail", "")),
                    )
                    for item in previous.evidence
                }
                new_items = [
                    item
                    for item in evidence
                    if (
                        str(item.get("provenance", "")),
                        str(item.get("source_id", "")),
                        str(item.get("detail", "")),
                    )
                    not in known
                ]
                if new_items:
                    evidence = [*previous.evidence, *new_items]
                    confidence = noisy_or([previous.confidence, draft.confidence])
                else:
                    evidence = previous.evidence
                    confidence = max(previous.confidence, draft.confidence)
                weight = max(previous.weight, draft.weight)
                provenance = max(
                    [previous.provenance, draft.provenance],
                    key=lambda item: PROVENANCE_TRUST.get(str(item), 0.0),
                )
            values.append(
                (
                    draft.id,
                    draft.project_id,
                    draft.from_node_id,
                    draft.to_node_id,
                    str(draft.relation_type),
                    confidence,
                    weight,
                    str(provenance),
                    _json_dump(evidence),
                    draft.status,
                    created_at,
                    now,
                    _json_dump(draft.metadata),
                )
            )
        with _write_scope(self._database, connection) as managed:
            managed.executemany(
                """
                INSERT INTO relations(
                  id, project_id, from_node_id, to_node_id, relation_type,
                  confidence, weight, provenance, evidence_json, status,
                  created_at, updated_at, metadata_json
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  confidence=excluded.confidence,
                  weight=excluded.weight,
                  provenance=excluded.provenance,
                  evidence_json=excluded.evidence_json,
                  status=excluded.status,
                  updated_at=excluded.updated_at,
                  metadata_json=excluded.metadata_json
                """,
                values,
            )
            return len(relations)

    def get_neighbors(
        self,
        node_ids: list[str],
        *,
        direction: str = "both",
        relation_types: list[str] | None = None,
        limit_per_node: int = 8,
        total_limit: int = 500,
    ) -> list[Relation]:
        if not node_ids:
            return []
        connection = self._database.connect()
        result: list[Relation] = []
        seen: set[str] = set()
        per_node = {node_id: 0 for node_id in node_ids}

        def collect(column: str, ids: list[str]) -> None:
            placeholders = ",".join("?" for _ in ids)
            conditions = [f"{column} IN ({placeholders})", "status='active'"]
            parameters: list[Any] = list(ids)
            if relation_types:
                type_placeholders = ",".join("?" for _ in relation_types)
                conditions.append(f"relation_type IN ({type_placeholders})")
                parameters.extend(relation_types)
            parameters.append(total_limit)
            rows = connection.execute(
                f"SELECT * FROM relations WHERE {' AND '.join(conditions)} "
                "ORDER BY confidence DESC, weight DESC LIMIT ?",
                tuple(parameters),
            ).fetchall()
            for row in rows:
                if len(result) >= total_limit:
                    return
                relation = _relation_from_row(row)
                if relation.id in seen:
                    continue
                touched = relation.from_node_id if relation.from_node_id in per_node else relation.to_node_id
                if per_node.get(touched, 0) >= limit_per_node:
                    continue
                seen.add(relation.id)
                per_node[touched] = per_node.get(touched, 0) + 1
                result.append(relation)

        for chunk in _chunks(node_ids):
            if direction in ("out", "outgoing", "both"):
                collect("from_node_id", list(chunk))
            if direction in ("in", "incoming", "both"):
                collect("to_node_id", list(chunk))
        return result

    def delete_outgoing_for_nodes(
        self,
        node_ids: list[str],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        if not node_ids:
            return 0
        deleted = 0
        with _write_scope(self._database, connection) as managed:
            for chunk in _chunks(node_ids):
                placeholders = ",".join("?" for _ in chunk)
                cursor = managed.execute(
                    f"DELETE FROM relations WHERE from_node_id IN ({placeholders})",
                    tuple(chunk),
                )
                deleted += cursor.rowcount
        return deleted

    def path_connection_counts(
        self,
        project_id: str,
        *,
        exclude_relation_types: tuple[str, ...] = ("CONTAINS",),
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        exclusion = ""
        exclusion_parameters: list[Any] = []
        if exclude_relation_types:
            placeholders = ",".join("?" for _ in exclude_relation_types)
            exclusion = f" AND relation_type NOT IN ({placeholders})"
            exclusion_parameters.extend(exclude_relation_types)
        rows = self._database.connect().execute(
            f"""
            WITH edges AS (
              SELECT from_node_id AS source_id, to_node_id AS target_id,
                     confidence, weight
              FROM relations
              WHERE project_id=?{exclusion}
              UNION ALL
              SELECT to_node_id AS source_id, from_node_id AS target_id,
                     confidence, weight
              FROM relations
              WHERE project_id=?{exclusion}
            )
            SELECT source.path AS path,
                   COUNT(DISTINCT target.path) AS neighbor_paths,
                   SUM(edges.confidence * edges.weight) AS strength
            FROM nodes source
            JOIN edges ON edges.source_id = source.id
            JOIN nodes target ON target.id = edges.target_id
            WHERE source.project_id=? AND source.status='active'
              AND source.path IS NOT NULL AND source.path != ''
              AND target.path IS NOT NULL AND target.path != ''
              AND target.path != source.path
            GROUP BY source.path
            ORDER BY neighbor_paths DESC, strength DESC, source.path ASC
            LIMIT ?
            """,
            (
                project_id,
                *exclusion_parameters,
                project_id,
                *exclusion_parameters,
                project_id,
                limit,
            ),
        ).fetchall()
        return [
            {
                "path": str(row["path"]),
                "neighbor_paths": int(row["neighbor_paths"]),
                "strength": float(row["strength"]),
            }
            for row in rows
        ]

    def counts(self, project_id: str) -> int:
        row = self._database.connect().execute(
            "SELECT COUNT(*) AS count FROM relations WHERE project_id=?",
            (project_id,),
        ).fetchone()
        return int(row["count"])

    def all_for_project(self, project_id: str, *, limit: int = 200_000) -> list[Relation]:
        rows = self._database.connect().execute(
            "SELECT * FROM relations WHERE project_id=? LIMIT ?",
            (project_id, limit),
        ).fetchall()
        return [_relation_from_row(row) for row in rows]


class RefRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def replace_for_source(
        self,
        source_id: str,
        refs: list[dict[str, Any]],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        now = utc_now_iso()
        with _write_scope(self._database, connection) as managed:
            managed.execute("DELETE FROM unresolved_refs WHERE source_id=?", (source_id,))
            managed.executemany(
                """
                INSERT INTO unresolved_refs(
                  project_id, source_id, from_node_id, ref_kind, target_text,
                  target_path, line, resolved_node_id, created_at, updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                [
                    (
                        ref["project_id"],
                        ref.get("source_id"),
                        ref.get("from_node_id"),
                        ref["ref_kind"],
                        ref.get("target_text", ""),
                        ref.get("target_path"),
                        ref.get("line"),
                        None,
                        now,
                        now,
                    )
                    for ref in refs
                ],
            )

    def delete_for_source(
        self,
        source_id: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        with _write_scope(self._database, connection) as managed:
            managed.execute("DELETE FROM unresolved_refs WHERE source_id=?", (source_id,))

    def list_for_project(self, project_id: str) -> list[dict[str, Any]]:
        rows = self._database.connect().execute(
            "SELECT * FROM unresolved_refs WHERE project_id=? ORDER BY id",
            (project_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def list_unresolved_for_project(self, project_id: str) -> list[dict[str, Any]]:
        rows = self._database.connect().execute(
            "SELECT * FROM unresolved_refs WHERE project_id=? AND resolved_node_id IS NULL ORDER BY id",
            (project_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def mark_resolved(
        self,
        ref_id: int,
        resolved_node_id: str | None,
        timestamp: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        with _write_scope(self._database, connection) as managed:
            managed.execute(
                "UPDATE unresolved_refs SET resolved_node_id=?, updated_at=? WHERE id=?",
                (resolved_node_id, timestamp, ref_id),
            )

    def mark_many_resolved(
        self,
        resolutions: list[tuple[int, str | None]],
        timestamp: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        if not resolutions:
            return
        with _write_scope(self._database, connection) as managed:
            managed.executemany(
                "UPDATE unresolved_refs SET resolved_node_id=?, updated_at=? WHERE id=?",
                [(resolved, timestamp, ref_id) for ref_id, resolved in resolutions],
            )

    def count_unresolved(self, project_id: str) -> int:
        row = self._database.connect().execute(
            "SELECT COUNT(*) AS count FROM unresolved_refs WHERE project_id=? AND resolved_node_id IS NULL",
            (project_id,),
        ).fetchone()
        return int(row["count"])


class TaskRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def enqueue_many(self, project_id: str, kind: str, payloads: list[dict[str, Any]]) -> int:
        if not payloads:
            return 0
        now = utc_now_iso()
        with self._database.transaction() as connection:
            connection.executemany(
                """
                INSERT INTO tasks(
                  id, project_id, kind, payload_json, status, priority,
                  attempts, max_attempts, available_at, created_at, updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,
                [
                    (
                        new_id(),
                        project_id,
                        kind,
                        _json_dump(payload),
                        "queued",
                        int(payload.get("priority", 0)),
                        0,
                        int(payload.get("max_attempts", 3)),
                        now,
                        now,
                        now,
                    )
                    for payload in payloads
                ],
            )
        return len(payloads)

    def claim(
        self,
        limit: int,
        *,
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        now = utc_now_iso()
        with self._database.transaction() as connection:
            conditions = ["status='queued'", "available_at <= ?"]
            parameters: list[Any] = [now]
            if project_id:
                conditions.append("project_id=?")
                parameters.append(project_id)
            parameters.append(limit)
            rows = connection.execute(
                f"""
                SELECT * FROM tasks
                WHERE {' AND '.join(conditions)}
                ORDER BY priority DESC, created_at ASC
                LIMIT ?
                """,
                tuple(parameters),
            ).fetchall()
            if not rows:
                return []
            ids = [row["id"] for row in rows]
            placeholders = ",".join("?" for _ in ids)
            connection.execute(
                f"""
                UPDATE tasks SET status='running', started_at=?, updated_at=?,
                  attempts=attempts + 1
                WHERE id IN ({placeholders})
                """,
                (now, now, *ids),
            )
            claimed = connection.execute(
                f"SELECT * FROM tasks WHERE id IN ({placeholders})", tuple(ids)
            ).fetchall()
            return [
                {
                    "id": row["id"],
                    "project_id": row["project_id"],
                    "kind": row["kind"],
                    "payload": _json_load(row["payload_json"], {}),
                    "attempts": row["attempts"],
                    "max_attempts": row["max_attempts"],
                }
                for row in claimed
            ]

    def complete(self, task_id: str, timestamp: str) -> None:
        with self._database.transaction() as connection:
            connection.execute(
                "UPDATE tasks SET status='succeeded', finished_at=?, updated_at=? WHERE id=?",
                (timestamp, timestamp, task_id),
            )

    def fail(self, task_id: str, error: str, timestamp: str) -> None:
        with self._database.transaction() as connection:
            connection.execute(
                """
                UPDATE tasks SET
                  status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
                  last_error=?,
                  available_at=?,
                  updated_at=?
                WHERE id=?
                """,
                (error[:2000], timestamp, timestamp, task_id),
            )

    def cancel_pending(
        self,
        project_id: str,
        timestamp: str,
        *,
        reason: str | None = None,
    ) -> int:
        with self._database.transaction() as connection:
            cursor = connection.execute(
                """
                UPDATE tasks SET status='canceled', finished_at=?, updated_at=?,
                  last_error=COALESCE(?, last_error)
                WHERE project_id=? AND status IN ('queued','running')
                """,
                (
                    timestamp,
                    timestamp,
                    reason[:2000] if reason else None,
                    project_id,
                ),
            )
            return cursor.rowcount

    def counts(self, project_id: str) -> dict[str, int]:
        rows = self._database.connect().execute(
            "SELECT status, COUNT(*) AS count FROM tasks WHERE project_id=? GROUP BY status",
            (project_id,),
        ).fetchall()
        return {str(row["status"]): int(row["count"]) for row in rows}


class IndexRunRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def create(self, run_id: str, project_id: str, mode: str, timestamp: str) -> None:
        with self._database.transaction() as connection:
            connection.execute(
                """
                INSERT INTO index_runs(id, project_id, mode, status, stats_json, started_at)
                VALUES(?,?,?,?,?,?)
                """,
                (run_id, project_id, mode, "running", "{}", timestamp),
            )

    def mark_interrupted(
        self,
        project_id: str,
        timestamp: str,
        error: str,
    ) -> int:
        with self._database.transaction() as connection:
            cursor = connection.execute(
                """
                UPDATE index_runs SET
                  status=?,
                  error=CASE
                    WHEN error IS NULL OR error='' THEN ?
                    ELSE error || ' | ' || ?
                  END,
                  finished_at=?
                WHERE project_id=? AND status=?
                """,
                (
                    RunStatus.INTERRUPTED.value,
                    error[:2000],
                    error[:2000],
                    timestamp,
                    project_id,
                    RunStatus.RUNNING.value,
                ),
            )
            return cursor.rowcount

    def update_progress(self, run_id: str, stats: IndexStats) -> None:
        with self._database.transaction() as connection:
            connection.execute(
                "UPDATE index_runs SET stats_json=? WHERE id=?",
                (_json_dump(stats.to_dict()), run_id),
            )

    def finish(
        self,
        run_id: str,
        status: str,
        stats: IndexStats,
        timestamp: str,
        error: str | None = None,
    ) -> None:
        with self._database.transaction() as connection:
            connection.execute(
                """
                UPDATE index_runs SET status=?, stats_json=?, error=?, finished_at=?
                WHERE id=?
                """,
                (status, _json_dump(stats.to_dict()), error, timestamp, run_id),
            )

    def latest(self, project_id: str) -> dict[str, Any] | None:
        row = self._database.connect().execute(
            "SELECT * FROM index_runs WHERE project_id=? ORDER BY started_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "project_id": row["project_id"],
            "mode": row["mode"],
            "status": row["status"],
            "stats": _json_load(row["stats_json"], {}),
            "error": row["error"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
        }
