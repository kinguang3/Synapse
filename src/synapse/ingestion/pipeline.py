from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from filelock import Timeout

from synapse.config import Settings
from synapse.core.clock import utc_now_iso
from synapse.core.hashing import sha256_bytes
from synapse.core.ids import new_id
from synapse.domain.enums import SourceStatus, SourceType
from synapse.domain.models import IndexStats, Project, RecoveryReport, Source
from synapse.errors import IndexLocked, InvalidArgument
from synapse.ingestion.changeset import ChangeDetector
from synapse.ingestion.locking import index_lock, index_lock_path
from synapse.ingestion.scanner import FileInfo, Scanner
from synapse.knowledge.service import KnowledgeService
from synapse.normalizer.resolver import ReferenceResolver
from synapse.parsers.base import RawFile
from synapse.parsers.registry import ParserRegistry
from synapse.storage.sqlite.repositories import (
    IndexRunRepository,
    NodeRepository,
    ProjectRepository,
    RefRepository,
    RelationRepository,
    SourceRepository,
    TaskRepository,
)


@dataclass(slots=True)
class ParsedTask:
    task_id: str
    payload: dict[str, Any]
    info: FileInfo | None = None
    raw: RawFile | None = None
    content_hash: str | None = None
    size_bytes: int = 0
    mtime_ns: int = 0
    parser_name: str = ""
    parser_version: str = ""
    error: str | None = None


class IngestionService:
    def __init__(
        self,
        *,
        settings: Settings,
        projects: ProjectRepository,
        sources: SourceRepository,
        nodes: NodeRepository,
        relations: RelationRepository,
        refs: RefRepository,
        tasks: TaskRepository,
        runs: IndexRunRepository,
        knowledge: KnowledgeService,
        resolver: ReferenceResolver,
        registry: ParserRegistry,
    ) -> None:
        self._settings = settings
        self._projects = projects
        self._sources = sources
        self._nodes = nodes
        self._relations = relations
        self._refs = refs
        self._tasks = tasks
        self._runs = runs
        self._knowledge = knowledge
        self._resolver = resolver
        self._registry = registry
        self._scanner = Scanner(
            registry,
            max_file_bytes=settings.indexing.max_file_bytes,
            follow_symlinks=settings.indexing.follow_symlinks,
        )
        self._detector = ChangeDetector(
            registry,
            verify_content_hashes=settings.indexing.verify_content_hashes,
        )

    def index_project(
        self,
        project_reference: str,
        *,
        full: bool = False,
        workers: int | None = None,
    ) -> IndexStats:
        project = self._projects.resolve(project_reference)
        root = Path(project.root_path)
        if not root.is_dir():
            raise InvalidArgument(f"项目根目录不存在: {project.root_path}")

        lock = index_lock(self._settings, project.id)
        try:
            with lock:
                return self._index_project_locked(project, full=full, workers=workers)
        except Timeout as exc:
            lock_path = index_lock_path(self._settings, project.id)
            raise IndexLocked(
                "项目正在索引中，请稍后重试",
                details={
                    "project_id": project.id,
                    "lock_path": str(lock_path),
                    "timeout_seconds": self._settings.indexing.lock_timeout_seconds,
                },
            ) from exc

    def _index_project_locked(
        self,
        project: Project,
        *,
        full: bool,
        workers: int | None,
    ) -> IndexStats:
        root = Path(project.root_path)
        recovery = self._recover_project(project.id)
        run_id = new_id()
        started = time.monotonic()
        now = utc_now_iso()
        self._runs.create(run_id, project.id, "full" if full else "incremental", now)
        stats = IndexStats(
            recovered_runs=recovery.interrupted_runs,
            recovered_tasks=recovery.canceled_tasks,
        )

        try:
            scan = self._scanner.scan(root)
            stats.scanned = len(scan.files)
            stats.errors.extend(scan.errors)
            sources = self._sources.list_for_project(project.id)
            changeset = self._detector.diff(scan, sources, full=full)
            stats.unchanged = changeset.unchanged
            stats.deleted = len(changeset.deleted)
            stats.renamed = changeset.renamed_count
            stats.changed = len(changeset.changes)

            for info, source in changeset.touched:
                self._sources.update_stat(
                    source.id,
                    size_bytes=info.size_bytes,
                    mtime_ns=info.mtime_ns,
                )

            for source in changeset.deleted:
                stats.nodes_removed += self._knowledge.delete_source(source.id)

            payloads = [
                {
                    "relative_path": change.info.relative_path,
                    "change_kind": change.kind,
                    "source_id": change.source.id if change.source else None,
                }
                for change in changeset.changes
            ]
            self._tasks.enqueue_many(project.id, "index_file", payloads)
            info_map = {info.relative_path: info for info in scan.files}
            self._process_tasks(
                project,
                run_id,
                info_map,
                stats,
                max(1, workers or self._settings.indexing.workers),
            )

            resolved, _ = self._resolver.resolve_project(project.id)
            stats.resolved = resolved
            stats.unresolved = self._refs.count_unresolved(project.id)
            stats.duration_ms = int((time.monotonic() - started) * 1000)
            finished_at = utc_now_iso()
            self._projects.touch_indexed(project.id, finished_at)
            self._runs.finish(run_id, "succeeded", stats, finished_at)
            return stats
        except KeyboardInterrupt:
            finished_at = utc_now_iso()
            self._tasks.cancel_pending(project.id, finished_at)
            stats.duration_ms = int((time.monotonic() - started) * 1000)
            self._runs.finish(run_id, "canceled", stats, finished_at, "canceled")
            raise
        except Exception as exc:
            finished_at = utc_now_iso()
            stats.duration_ms = int((time.monotonic() - started) * 1000)
            stats.errors.append(str(exc))
            self._runs.finish(run_id, "failed", stats, finished_at, str(exc))
            raise

    def _recover_project(self, project_id: str) -> RecoveryReport:
        timestamp = utc_now_iso()
        message = "index run interrupted; unfinished tasks were rebuilt by the next scan"
        interrupted = self._runs.mark_interrupted(project_id, timestamp, message)
        canceled = self._tasks.cancel_pending(project_id, timestamp, reason=message)
        return RecoveryReport(
            interrupted_runs=interrupted,
            canceled_tasks=canceled,
        )

    def _process_tasks(
        self,
        project: Project,
        run_id: str,
        info_map: dict[str, FileInfo],
        stats: IndexStats,
        workers: int,
    ) -> None:
        while True:
            tasks = self._tasks.claim(workers * 2, project_id=project.id)
            if not tasks:
                break
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {
                    executor.submit(self._parse_task, task, info_map): task
                    for task in tasks
                }
                for future in as_completed(futures):
                    parsed = future.result()
                    try:
                        self._apply_parsed(project, parsed, stats)
                        self._tasks.complete(parsed.task_id, utc_now_iso())
                    except Exception as exc:  # noqa: BLE001
                        stats.failed += 1
                        message = f"{parsed.payload.get('relative_path')}: {exc}"
                        stats.errors.append(message)
                        self._tasks.fail(parsed.task_id, message, utc_now_iso())
            self._runs.update_progress(run_id, stats)

    def _parse_task(
        self,
        task: dict[str, Any],
        info_map: dict[str, FileInfo],
    ) -> ParsedTask:
        payload = dict(task["payload"])
        task_id = str(task["id"])
        relative_path = str(payload.get("relative_path") or "")
        info = info_map.get(relative_path)
        if info is None:
            return ParsedTask(
                task_id=task_id,
                payload=payload,
                error=f"文件不存在或已被忽略: {relative_path}",
            )
        try:
            data = info.path.read_bytes()
            raw, parser_name, parser_version = self._registry.parse(
                info.path,
                relative_path,
                data,
                info.language or "",
            )
            return ParsedTask(
                task_id=task_id,
                payload=payload,
                info=info,
                raw=raw,
                content_hash=sha256_bytes(data),
                size_bytes=len(data),
                mtime_ns=info.mtime_ns,
                parser_name=parser_name,
                parser_version=parser_version,
            )
        except Exception as exc:  # noqa: BLE001
            return ParsedTask(
                task_id=task_id,
                payload=payload,
                info=info,
                error=str(exc),
            )

    def _apply_parsed(
        self,
        project: Project,
        parsed: ParsedTask,
        stats: IndexStats,
    ) -> None:
        if parsed.error or parsed.info is None or parsed.raw is None:
            raise RuntimeError(parsed.error or "解析结果为空")
        payload = parsed.payload
        source_id = payload.get("source_id")
        source = self._sources.get(source_id) if source_id else None
        if source is None:
            source = self._sources.get_by_uri(
                project.id, str(SourceType.FILE), parsed.info.relative_path
            )
        create_source = source is None
        update_source = False
        if source is None:
            now = utc_now_iso()
            source = Source(
                id=new_id(),
                project_id=project.id,
                source_type=SourceType.FILE,
                uri=parsed.info.relative_path,
                language=parsed.info.language,
                status=SourceStatus.ACTIVE,
                created_at=now,
                updated_at=now,
            )
        else:
            source_changed = source.language != parsed.info.language
            if (
                payload.get("change_kind") == "renamed"
                and source.uri != parsed.info.relative_path
            ):
                source.uri = parsed.info.relative_path
                source_changed = True
            if source_changed:
                source.language = parsed.info.language
                source.updated_at = utc_now_iso()
                update_source = True

        nodes, relations, _ = self._knowledge.apply_file(
            project_id=project.id,
            source=source,
            raw=parsed.raw,
            content_hash=parsed.content_hash or "",
            size_bytes=parsed.size_bytes,
            mtime_ns=parsed.mtime_ns,
            parser_name=parsed.parser_name,
            parser_version=parsed.parser_version,
            create_source=create_source,
            update_source=update_source,
        )
        stats.nodes_upserted += nodes
        stats.relations_upserted += relations
