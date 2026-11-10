from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path
from typing import Any

from synapse.core.text import estimate_tokens
from synapse.domain.enums import MemoryType, NodeType, SourceStatus, SourceType
from synapse.domain.models import KnowledgeNode
from synapse.retrieval.service import RetrievalService
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

_CODE_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.:]*")


class ContextBuilder:
    def __init__(
        self,
        *,
        projects: ProjectRepository,
        nodes: NodeRepository,
        relations: RelationRepository,
        sources: SourceRepository,
        retrieval: RetrievalService,
    ) -> None:
        self._projects = projects
        self._nodes = nodes
        self._relations = relations
        self._sources = sources
        self._retrieval = retrieval

    def build(
        self,
        project_reference: str,
        *,
        sections: list[str] | None = None,
        max_tokens: int = 1200,
        query: str | None = None,
    ) -> dict[str, Any]:
        project = self._projects.resolve(project_reference)
        root = Path(project.root_path)
        query = query.strip() if query and query.strip() else None
        node_counts = self._nodes.counts(project.id)
        sources = self._sources.list_for_project(project.id)
        active_sources = [source for source in sources if source.status is SourceStatus.ACTIVE]
        top_modules = self._top_modules(project.id, query=query)
        selected_paths = {
            module["path"] for module in top_modules if module.get("path")
        }
        decisions = self._decisions(project.id)
        recent_changes = self._recent_changes(
            [source for source in active_sources if source.source_type is SourceType.FILE],
            preferred_paths=selected_paths if query else set(),
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
            self._trim(result, max_tokens, query_aware=query is not None)
        result["token_estimate"] = estimate_tokens(json.dumps(result, ensure_ascii=False))
        return result

    def _top_modules(
        self,
        project_id: str,
        *,
        query: str | None = None,
    ) -> list[dict[str, Any]]:
        ordered_paths: list[tuple[str, float]] = []
        if query:
            ordered_paths = self._query_paths(project_id, query)
        selected: dict[str, dict[str, Any]] = {}
        module_map = self._modules_for_paths(
            project_id, [path for path, _ in ordered_paths]
        )
        for path, _score in ordered_paths:
            node = module_map.get(path)
            if node is None or path in selected:
                continue
            selected[path] = self._module_brief(node, reason="query_match")
            if len(selected) >= 12:
                break

        if len(selected) < 12:
            structural = self._relations.path_connection_counts(project_id, limit=80)
            module_map = self._modules_for_paths(
                project_id,
                [row["path"] for row in structural if row["path"] not in selected],
            )
            for row in structural:
                path = row["path"]
                node = module_map.get(path)
                if node is None or path in selected:
                    continue
                selected[path] = self._module_brief(
                    node, reason="cross_module_links"
                )
                if len(selected) >= 12:
                    break

        if len(selected) < 12:
            fallback = self._nodes.top_by_salience(
                project_id,
                node_types=[
                    NodeType.FILE.value,
                    NodeType.DOCUMENT.value,
                    NodeType.CLASS.value,
                ],
                limit=36,
            )
            for node in fallback:
                node_path = node.path
                if not node_path or node_path in selected:
                    continue
                selected[node_path] = self._module_brief(node, reason="salience")
                if len(selected) >= 12:
                    break
        return list(selected.values())

    def _query_paths(self, project_id: str, query: str) -> list[tuple[str, float]]:
        results = self._query_results(project_id, query)
        scores: dict[str, float] = {}
        for result in results:
            path = result.get("path")
            if not path:
                continue
            score = float(result.get("score") or 0.0)
            scores[path] = max(scores.get(path, 0.0), score)
        return sorted(scores.items(), key=lambda item: (-item[1], item[0]))

    def _query_results(self, project_id: str, query: str) -> list[dict[str, Any]]:
        code_query = _code_query(query)
        attempts = [query]
        if code_query and code_query != query:
            attempts.insert(0, code_query)
        for attempt in attempts:
            results = self._retrieval.search(
                attempt,
                project_reference=project_id,
                limit=50,
                mode="hybrid",
            )["results"]
            if results:
                return results
        return []

    def _modules_for_paths(
        self,
        project_id: str,
        paths: list[str],
    ) -> dict[str, KnowledgeNode]:
        if not paths:
            return {}
        nodes = self._nodes.modules_for_paths(project_id, list(dict.fromkeys(paths)))
        modules: dict[str, KnowledgeNode] = {}
        for node in nodes:
            if node.path and node.path not in modules:
                modules[node.path] = node
        return modules

    def _module_brief(
        self,
        node: KnowledgeNode,
        *,
        reason: str,
    ) -> dict[str, Any]:
        payload = self._node_brief(node)
        payload["reason"] = reason
        return payload

    def _decisions(self, project_id: str) -> list[dict[str, Any]]:
        decisions = self._nodes.memories(
            project_id,
            memory_type=MemoryType.DECISION.value,
            limit=10,
        )
        return [self._node_brief(node) for node in decisions]

    def _recent_changes(
        self,
        sources: list[Any],
        *,
        preferred_paths: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        preferred_paths = preferred_paths or set()
        preferred_dirs = {
            path.rsplit("/", 1)[0] for path in preferred_paths if "/" in path
        }

        def rank(source: Any) -> tuple[int, int, str]:
            if source.uri in preferred_paths:
                relevance = 2
            elif source.uri.rsplit("/", 1)[0] in preferred_dirs:
                relevance = 1
            else:
                relevance = 0
            return (
                relevance,
                source.mtime_ns or 0,
                source.updated_at,
            )

        ordered = sorted(sources, key=rank, reverse=True)
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

    def _trim(
        self,
        result: dict[str, Any],
        max_tokens: int,
        *,
        query_aware: bool,
    ) -> None:
        lists = (
            ("recent_changes", "tech_stack", "decisions", "top_modules")
            if query_aware
            else ("recent_changes", "top_modules", "decisions", "tech_stack")
        )
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


def _code_query(query: str) -> str | None:
    tokens = []
    for match in _CODE_TOKEN_RE.finditer(query):
        token = match.group(0)
        if len(token) < 2 or token.isdigit():
            continue
        tokens.append(token)
    if not tokens:
        return None
    code_like = [
        token
        for token in tokens
        if any(character.isupper() for character in token)
        or any(separator in token for separator in ("_", ".", ":"))
    ]
    return max(code_like or tokens, key=len)
