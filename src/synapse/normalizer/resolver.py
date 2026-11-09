from __future__ import annotations

import posixpath
from collections import defaultdict
from typing import Any
from urllib.parse import unquote

from synapse.core.clock import utc_now_iso
from synapse.core.ids import stable_id
from synapse.core.text import normalize_qualified_name
from synapse.domain.enums import Provenance, RelationType
from synapse.domain.models import KnowledgeNode, RelationDraft
from synapse.storage.sqlite.repositories import (
    NodeRepository,
    RefRepository,
    RelationRepository,
)

_BUILTINS = {
    "abs",
    "all",
    "any",
    "bool",
    "bytes",
    "callable",
    "dict",
    "dir",
    "divmod",
    "enumerate",
    "filter",
    "float",
    "format",
    "getattr",
    "globals",
    "hasattr",
    "hash",
    "id",
    "input",
    "int",
    "isinstance",
    "issubclass",
    "iter",
    "len",
    "list",
    "locals",
    "map",
    "max",
    "min",
    "next",
    "object",
    "open",
    "pow",
    "print",
    "range",
    "repr",
    "reversed",
    "round",
    "set",
    "setattr",
    "slice",
    "sorted",
    "str",
    "sum",
    "super",
    "tuple",
    "type",
    "vars",
    "zip",
}


class ReferenceResolver:
    def __init__(
        self,
        nodes: NodeRepository,
        relations: RelationRepository,
        refs: RefRepository,
    ) -> None:
        self._nodes = nodes
        self._relations = relations
        self._refs = refs

    def resolve_project(self, project_id: str) -> tuple[int, int]:
        all_nodes = self._nodes.all_for_project(project_id)
        path_map: dict[str, KnowledgeNode] = {}
        module_map: dict[str, KnowledgeNode] = {}
        symbol_map: dict[str, list[KnowledgeNode]] = defaultdict(list)
        short_map: dict[str, list[KnowledgeNode]] = defaultdict(list)

        for node in all_nodes:
            if node.path and node.node_type.value in {"file", "document"}:
                path_map.setdefault(node.path, node)
            if node.path and node.path.endswith(".py"):
                stem = node.path[:-3].replace("/", ".")
                names = {stem}
                if stem.endswith(".__init__"):
                    names.add(stem[: -len(".__init__")])
                if stem.startswith("src."):
                    names.add(stem[len("src.") :])
                if stem.startswith("src.") and stem.endswith(".__init__"):
                    names.add(stem[len("src.") : -len(".__init__")])
                for name in names:
                    module_map.setdefault(name, node)
            if node.qualified_name_norm:
                symbol_map[node.qualified_name_norm].append(node)
                short_map[node.qualified_name_norm.rsplit(".", 1)[-1]].append(node)

        pending = self._refs.list_unresolved_for_project(project_id)
        drafts: dict[str, RelationDraft] = {}
        resolutions: list[tuple[int, str | None]] = []
        resolved_count = 0
        unresolved_count = 0
        now = utc_now_iso()

        for ref in pending:
            from_node = self._nodes.get(ref["from_node_id"]) if ref["from_node_id"] else None
            if from_node is None:
                resolutions.append((int(ref["id"]), None))
                continue
            target, relation_type, confidence, provenance = self._resolve_ref(
                ref,
                from_node,
                path_map=path_map,
                module_map=module_map,
                symbol_map=symbol_map,
                short_map=short_map,
            )
            if target is None or target.id == from_node.id:
                unresolved_count += 1
                resolutions.append((int(ref["id"]), None))
                continue
            resolved_count += 1
            relation_id = stable_id(
                "relation", project_id, from_node.id, target.id, relation_type.value
            )
            evidence = {
                "provenance": str(provenance),
                "source_id": ref.get("source_id"),
                "detail": f"{ref['ref_kind']}:{ref.get('target_text') or ref.get('target_path')}",
                "line": ref.get("line"),
            }
            existing = drafts.get(relation_id)
            if existing is not None:
                existing.evidence.append(evidence)
                existing.confidence = max(existing.confidence, confidence)
            else:
                drafts[relation_id] = RelationDraft(
                    id=relation_id,
                    project_id=project_id,
                    from_node_id=from_node.id,
                    to_node_id=target.id,
                    relation_type=relation_type,
                    confidence=confidence,
                    weight=1.0,
                    provenance=provenance,
                    evidence=[evidence],
                )
            resolutions.append((int(ref["id"]), target.id))

        if drafts:
            self._relations.upsert_many(list(drafts.values()))
        self._refs.mark_many_resolved(resolutions, now)
        return resolved_count, unresolved_count

    def _resolve_ref(
        self,
        ref: dict[str, Any],
        from_node: KnowledgeNode,
        *,
        path_map: dict[str, KnowledgeNode],
        module_map: dict[str, KnowledgeNode],
        symbol_map: dict[str, list[KnowledgeNode]],
        short_map: dict[str, list[KnowledgeNode]],
    ) -> tuple[KnowledgeNode | None, RelationType, float, Provenance]:
        kind = str(ref["ref_kind"])
        if kind == "link":
            target_path = unquote(str(ref.get("target_path") or ref.get("target_text") or ""))
            target_path = target_path.split("#", 1)[0].split("?", 1)[0]
            if not target_path or from_node.path is None:
                return None, RelationType.REFERENCES, 0.0, Provenance.EXPLICIT_REF
            if target_path.startswith("/"):
                normalized = posixpath.normpath(target_path.lstrip("/"))
            else:
                normalized = posixpath.normpath(
                    posixpath.join(posixpath.dirname(from_node.path), target_path)
                )
            if normalized.startswith(".."):
                return None, RelationType.REFERENCES, 0.0, Provenance.EXPLICIT_REF
            target = path_map.get(normalized)
            return target, RelationType.REFERENCES, 1.0, Provenance.EXPLICIT_REF

        if kind == "import":
            raw_target = str(ref.get("target_text") or "").strip()
            target_name = raw_target.lstrip(".").replace("/", ".").strip(".")
            if not target_name:
                return None, RelationType.IMPORTS, 0.0, Provenance.AST
            target = module_map.get(target_name)
            if target is not None:
                return target, RelationType.IMPORTS, 0.9, Provenance.AST
            candidates = [
                node
                for name, node in module_map.items()
                if name.endswith("." + target_name)
            ]
            unique = {node.id: node for node in candidates}
            if len(unique) == 1:
                return next(iter(unique.values())), RelationType.IMPORTS, 0.8, Provenance.AST
            return None, RelationType.IMPORTS, 0.0, Provenance.AST

        target_text = str(ref.get("target_text") or "").strip()
        normalized = normalize_qualified_name(target_text) or ""
        if not normalized:
            relation_type = RelationType.INHERITS if kind == "inherit" else RelationType.CALLS
            return None, relation_type, 0.0, Provenance.HEURISTIC

        relation_type = RelationType.INHERITS if kind == "inherit" else RelationType.CALLS
        exact = symbol_map.get(normalized)
        if exact and len({node.id for node in exact}) == 1:
            return exact[0], relation_type, 0.8, Provenance.HEURISTIC
        short = normalized.rsplit(".", 1)[-1]
        if short in _BUILTINS and kind == "call":
            return None, relation_type, 0.0, Provenance.HEURISTIC
        candidates = short_map.get(short, [])
        unique = {node.id: node for node in candidates}
        if len(unique) == 1:
            return next(iter(unique.values())), relation_type, 0.6, Provenance.HEURISTIC
        return None, relation_type, 0.0, Provenance.HEURISTIC
