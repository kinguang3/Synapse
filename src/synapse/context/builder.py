from __future__ import annotations

import json
import tomllib
from pathlib import Path
from typing import Any

from synapse.core.text import estimate_tokens
from synapse.domain.enums import MemoryType, NodeType, SourceStatus, SourceType
from synapse.domain.models import KnowledgeNode
from synapse.storage.sqlite.repositories import (
    NodeRepository,
    ProjectRepository,
    RelationRepository,
    SourceRepository,
)

_TECH_FILES = {
    "Dockerfile": "Docker",
    "docker-compose.yml": "Docker Compose",
    "tsconfig.json": "TypeScript",
    "package.json": "Node.js",
    "go.mod": "Go",
    "Cargo.toml": "Rust",
    "requirements.txt": "Python",
    "pyproject.toml": "Python",
}


class ContextBuilder:
    def __init__(
        self,
        *,
        projects: ProjectRepository,
        nodes: NodeRepository,
        relations: RelationRepository,
        sources: SourceRepository,
    ) -> None:
        self._projects = projects
        self._nodes = nodes
        self._relations = relations
        self._sources = sources

    def build(
        self,
        project_reference: str,
        *,
        sections: list[str] | None = None,
        max_tokens: int = 1200,
    ) -> dict[str, Any]:
        project = self._projects.resolve(project_reference)
        root = Path(project.root_path)
        node_counts = self._nodes.counts(project.id)
        sources = self._sources.list_for_project(project.id)
        active_sources = [source for source in sources if source.status is SourceStatus.ACTIVE]
        top_modules = self._top_modules(project.id)
        decisions = self._decisions(project.id)
        recent_changes = self._recent_changes(
            [source for source in active_sources if source.source_type is SourceType.FILE]
        )

        result: dict[str, Any] = {
            "project": {
                "id": project.id,
                "name": project.name,
                "root_path": project.root_path,
            },
            "stats": {
                "nodes": node_counts.get("total", 0),
                "node_types": {
                    key: value
                    for key, value in node_counts.items()
                    if key != "total"
                },
                "relations": self._relations.counts(project.id),
                "sources": len(active_sources),
            },
            "tech_stack": self._tech_stack(root),
            "top_modules": top_modules,
            "decisions": decisions,
            "recent_changes": recent_changes,
        }
        if sections:
            allowed = set(sections)
            result = {
                key: value
                for key, value in result.items()
                if key in allowed or key in {"project", "stats"}
            }
        if estimate_tokens(json.dumps(result, ensure_ascii=False)) > max_tokens:
            result["truncated"] = True
            self._trim(result, max_tokens)
        result["token_estimate"] = estimate_tokens(json.dumps(result, ensure_ascii=False))
        return result

    def _top_modules(self, project_id: str) -> list[dict[str, Any]]:
        nodes = self._nodes.top_by_salience(
            project_id,
            node_types=[
                NodeType.FILE.value,
                NodeType.DOCUMENT.value,
                NodeType.CLASS.value,
            ],
            limit=12,
        )
        return [self._node_brief(node) for node in nodes]

    def _decisions(self, project_id: str) -> list[dict[str, Any]]:
        decisions = self._nodes.memories(
            project_id,
            memory_type=MemoryType.DECISION.value,
            limit=10,
        )
        return [self._node_brief(node) for node in decisions]

    def _recent_changes(self, sources: list[Any]) -> list[dict[str, Any]]:
        ordered = sorted(sources, key=lambda source: source.updated_at, reverse=True)
        return [
            {
                "path": source.uri,
                "language": source.language,
                "updated_at": source.updated_at,
            }
            for source in ordered[:10]
        ]

    def _node_brief(self, node: KnowledgeNode) -> dict[str, Any]:
        return {
            "node_id": node.id,
            "node_type": node.node_type.value,
            "title": node.title,
            "path": node.path,
            "summary": node.summary,
            "salience": node.salience,
        }

    def _tech_stack(self, root: Path) -> list[str]:
        names: list[str] = []
        for filename, label in _TECH_FILES.items():
            if (root / filename).exists() and label not in names:
                names.append(label)
        names.extend(self._dependencies(root))
        return _dedupe(names)[:20]

    def _dependencies(self, root: Path) -> list[str]:
        names: list[str] = []
        pyproject = root / "pyproject.toml"
        if pyproject.is_file():
            try:
                data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
            except (OSError, tomllib.TOMLDecodeError):
                data = {}
            project_data = data.get("project", {})
            for dependency in project_data.get("dependencies", []) or []:
                name = _dependency_name(str(dependency))
                if name:
                    names.append(name)
            poetry = data.get("tool", {}).get("poetry", {})
            for dependency in (poetry.get("dependencies") or {}):
                if dependency.lower() != "python":
                    names.append(dependency)
            build = data.get("build-system", {})
            for requirement in build.get("requires", []) or []:
                name = _dependency_name(str(requirement))
                if name:
                    names.append(name)

        requirements = root / "requirements.txt"
        if requirements.is_file():
            try:
                lines = requirements.read_text(encoding="utf-8").splitlines()
            except OSError:
                lines = []
            for line in lines:
                name = _dependency_name(line)
                if name:
                    names.append(name)

        package_json = root / "package.json"
        if package_json.is_file():
            try:
                data = json.loads(package_json.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                data = {}
            for key in ("dependencies", "devDependencies"):
                names.extend((data.get(key) or {}).keys())
        return names

    def _trim(self, result: dict[str, Any], max_tokens: int) -> None:
        lists = ("recent_changes", "top_modules", "decisions", "tech_stack")
        while estimate_tokens(json.dumps(result, ensure_ascii=False)) > max_tokens:
            trimmed = False
            for key in lists:
                values = result.get(key)
                if isinstance(values, list) and values:
                    values.pop()
                    trimmed = True
                    break
            if not trimmed:
                return


def _dependency_name(specification: str) -> str | None:
    token = specification.strip()
    if not token or token.startswith(("#", "-")):
        return None
    token = token.split(";")[0].strip()
    for separator in ("[", "<", ">", "=", "!", "~", " ", "@"):
        index = token.find(separator)
        if index > 0:
            token = token[:index]
    token = token.strip()
    return token or None


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result
