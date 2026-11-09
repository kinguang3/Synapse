from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from synapse.core.hashing import sha256_text
from synapse.core.ids import stable_id
from synapse.core.text import normalize_qualified_name, tokenize_for_search
from synapse.domain.enums import NodeType, Provenance, RelationType
from synapse.domain.models import NodeDraft, RelationDraft
from synapse.parsers.base import RawFile

_SALIENCE: dict[str, float] = {
    "project": 1.0,
    "file": 0.45,
    "document": 0.50,
    "doc_section": 0.50,
    "class": 0.60,
    "function": 0.55,
    "method": 0.50,
    "note": 0.65,
    "memory": 0.70,
}


@dataclass(slots=True)
class NormalizedFile:
    nodes: list[NodeDraft] = field(default_factory=list)
    relations: list[RelationDraft] = field(default_factory=list)
    refs: list[dict[str, Any]] = field(default_factory=list)


class Normalizer:
    def normalize(
        self,
        *,
        project_id: str,
        source_id: str,
        raw: RawFile,
        max_search_chars: int = 200_000,
    ) -> NormalizedFile:
        local_to_id: dict[str, str] = {}
        nodes: list[NodeDraft] = []

        for raw_node in raw.nodes:
            node_id = stable_id(project_id, source_id, raw_node.node_type, raw_node.local_key)
            local_to_id[raw_node.local_key] = node_id
            search_value = "\n".join(
                [
                    raw_node.title,
                    raw_node.qualified_name or "",
                    raw_node.docstring,
                    raw_node.content,
                    " ".join(raw_node.tags),
                ]
            )
            provenance = (
                Provenance.EXPLICIT_REF
                if raw_node.node_type in {"document", "doc_section"}
                else Provenance.AST
            )
            metadata = dict(raw_node.metadata)
            if raw_node.docstring:
                metadata.setdefault("docstring", raw_node.docstring[:2000])
            nodes.append(
                NodeDraft(
                    id=node_id,
                    project_id=project_id,
                    source_id=source_id,
                    node_type=NodeType(raw_node.node_type),
                    node_key=raw_node.local_key,
                    title=raw_node.title,
                    content=raw_node.content,
                    search_text=tokenize_for_search(search_value, max_chars=max_search_chars),
                    tags=" ".join(raw_node.tags),
                    content_hash=sha256_text(f"{raw_node.node_type}:{raw_node.content}"),
                    path=raw.path,
                    start_line=raw_node.start_line,
                    end_line=raw_node.end_line,
                    summary=raw_node.docstring[:300] if raw_node.docstring else None,
                    language=raw.language,
                    symbol_kind=raw_node.symbol_kind,
                    qualified_name=raw_node.qualified_name,
                    qualified_name_norm=normalize_qualified_name(raw_node.qualified_name),
                    salience=_SALIENCE.get(raw_node.node_type, 0.5),
                    provenance=provenance,
                    metadata=metadata,
                )
            )

        relations: dict[str, RelationDraft] = {}
        for raw_relation in raw.relations:
            from_id = local_to_id.get(raw_relation.from_local_key)
            to_id = local_to_id.get(raw_relation.to_local_key)
            if not from_id or not to_id or from_id == to_id:
                continue
            try:
                relation_type = RelationType(raw_relation.relation_type)
            except ValueError:
                continue
            relation_id = stable_id(
                "relation", project_id, from_id, to_id, relation_type.value
            )
            evidence = {
                **raw_relation.evidence,
                "provenance": raw_relation.provenance,
                "source_id": source_id,
                "detail": raw_relation.evidence.get(
                    "detail", raw_relation.relation_type
                ),
            }
            existing = relations.get(relation_id)
            if existing is not None:
                existing.evidence.append(evidence)
                existing.confidence = max(existing.confidence, raw_relation.confidence)
                continue
            relations[relation_id] = RelationDraft(
                id=relation_id,
                project_id=project_id,
                from_node_id=from_id,
                to_node_id=to_id,
                relation_type=relation_type,
                confidence=min(1.0, max(0.0, raw_relation.confidence)),
                weight=1.0,
                provenance=Provenance(raw_relation.provenance),
                evidence=[evidence],
            )

        refs: list[dict[str, Any]] = []
        seen_refs: set[tuple[str, str, str, str | None, int | None]] = set()
        for raw_ref in raw.unresolved:
            from_id = local_to_id.get(raw_ref.from_local_key)
            if not from_id:
                continue
            signature = (
                from_id,
                raw_ref.ref_kind,
                raw_ref.target_text,
                raw_ref.target_path,
                raw_ref.line,
            )
            if signature in seen_refs:
                continue
            seen_refs.add(signature)
            refs.append(
                {
                    "project_id": project_id,
                    "source_id": source_id,
                    "from_node_id": from_id,
                    "ref_kind": raw_ref.ref_kind,
                    "target_text": raw_ref.target_text,
                    "target_path": raw_ref.target_path,
                    "line": raw_ref.line,
                    "confidence": raw_ref.confidence,
                    "provenance": raw_ref.provenance,
                }
            )

        return NormalizedFile(nodes=nodes, relations=list(relations.values()), refs=refs)
