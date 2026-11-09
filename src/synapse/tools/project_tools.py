from __future__ import annotations

from pathlib import Path
from typing import Any

from synapse.core.clock import utc_now_iso
from synapse.core.ids import stable_id
from synapse.core.paths import normalized_root
from synapse.core.text import slugify
from synapse.domain.enums import SourceStatus
from synapse.domain.models import Project
from synapse.errors import InvalidArgument
from synapse.ingestion.pipeline import IngestionService
from synapse.storage.sqlite.repositories import (
    IndexRunRepository,
    NodeRepository,
    ProjectRepository,
    RefRepository,
    RelationRepository,
    SourceRepository,
)


class ProjectTools:
    def __init__(
        self,
        *,
        projects: ProjectRepository,
        nodes: NodeRepository,
        sources: SourceRepository,
        relations: RelationRepository,
        refs: RefRepository,
        runs: IndexRunRepository,
        ingestion: IngestionService,
    ) -> None:
        self._projects = projects
        self._nodes = nodes
        self._sources = sources
        self._relations = relations
        self._refs = refs
        self._runs = runs
        self._ingestion = ingestion

    def register(self, path: str, *, name: str | None = None) -> dict[str, Any]:
        root = Path(path).expanduser().resolve()
        if not root.is_dir():
            raise InvalidArgument(f"目录不存在: {path}")
        canonical = str(root)
        canonical_root = normalized_root(canonical)
        for project in self._projects.list():
            if normalized_root(project.root_path) == canonical_root:
                return self._project_payload(project)
        project_name = (name or root.name).strip() or root.name
        slug = slugify(project_name) or "project"
        base_slug = slug
        suffix = 2
        while self._projects.get_by_slug(slug) is not None:
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        now = utc_now_iso()
        project = Project(
            id=stable_id("project", canonical),
            slug=slug,
            name=project_name,
            root_path=canonical,
            created_at=now,
            updated_at=now,
        )
        stored = self._projects.create(project)
        return self._project_payload(stored)

    def list_projects(self) -> list[dict[str, Any]]:
        return [self._project_payload(project) for project in self._projects.list()]

    def status(self, reference: str) -> dict[str, Any]:
        project = self._projects.resolve(reference)
        sources = self._sources.list_for_project(project.id)
        active_sources = [
            source for source in sources if source.status is SourceStatus.ACTIVE
        ]
        node_counts = self._nodes.counts(project.id)
        top_modules = self._nodes.top_by_salience(
            project.id,
            node_types=["file", "document", "class"],
            limit=5,
        )
        return {
            "project": self._project_payload(project),
            "stats": {
                "nodes": node_counts.get("total", 0),
                "node_types": {
                    key: value
                    for key, value in node_counts.items()
                    if key != "total"
                },
                "relations": self._relations.counts(project.id),
                "sources": len(active_sources),
                "unresolved_refs": self._refs.count_unresolved(project.id),
            },
            "top_modules": [
                {
                    "node_id": node.id,
                    "node_type": node.node_type.value,
                    "title": node.title,
                    "path": node.path,
                    "salience": node.salience,
                }
                for node in top_modules
            ],
            "last_run": self._runs.latest(project.id),
        }

    def index(
        self,
        reference: str,
        *,
        full: bool = False,
        workers: int | None = None,
    ) -> dict[str, Any]:
        stats = self._ingestion.index_project(reference, full=full, workers=workers)
        return {"project": reference, "stats": stats.to_dict()}

    def _project_payload(self, project: Project) -> dict[str, Any]:
        return {
            "id": project.id,
            "slug": project.slug,
            "name": project.name,
            "root_path": project.root_path,
            "description": project.description,
            "last_indexed_at": project.last_indexed_at,
            "created_at": project.created_at,
        }
