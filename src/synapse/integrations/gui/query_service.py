from __future__ import annotations

from typing import Any

from synapse.bootstrap import Application
from synapse.domain.enums import NodeStatus, NodeType, RelationType
from synapse.domain.models import KnowledgeNode, Project, Relation
from synapse.errors import InvalidArgument, NodeNotFound

_DEFAULT_GRAPH_NODE_TYPES = tuple(
    item.value for item in NodeType if item is not NodeType.PROJECT
)
_TASK_STATUSES = ("queued", "running", "succeeded", "failed", "canceled")


def _split_csv(value: str | None) -> list[str] | None:
    if not value:
        return None
    values = [item.strip() for item in value.split(",") if item.strip()]
    return values or None


def _node_type_values(value: str | None) -> list[str] | None:
    values = _split_csv(value)
    if not values:
        return None
    allowed = {item.value for item in NodeType}
    normalized = [item.lower() for item in values]
    invalid = [item for item in normalized if item not in allowed]
    if invalid:
        raise InvalidArgument(f"未知节点类型: {', '.join(invalid)}")
    return normalized


def _relation_type_values(value: str | None) -> list[str] | None:
    values = _split_csv(value)
    if not values:
        return None
    allowed = {item.value for item in RelationType}
    normalized = [item.upper() for item in values]
    invalid = [item for item in normalized if item not in allowed]
    if invalid:
        raise InvalidArgument(f"未知关系类型: {', '.join(invalid)}")
    return normalized


def project_payload(project: Project) -> dict[str, Any]:
    return {
        "id": project.id,
        "slug": project.slug,
        "name": project.name,
        "root_path": project.root_path,
        "description": project.description,
        "last_indexed_at": project.last_indexed_at,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def node_payload(
    node: KnowledgeNode,
    *,
    include_content: bool = False,
    content_limit: int = 4000,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "node_id": node.id,
        "project_id": node.project_id,
        "node_type": node.node_type.value,
        "title": node.title,
        "path": node.path,
        "start_line": node.start_line,
        "end_line": node.end_line,
        "summary": node.summary,
        "language": node.language,
        "salience": node.salience,
        "confidence": node.confidence,
        "updated_at": node.updated_at,
        "tags": node.tags.split() if node.tags else [],
        "version": node.version,
        "memory_type": node.memory_type.value if node.memory_type else None,
        "provenance": node.provenance.value,
    }
    if include_content:
        content = node.content or ""
        payload["content_preview"] = content[:content_limit]
        payload["content_truncated"] = len(content) > content_limit
    return payload


def relation_payload(relation: Relation) -> dict[str, Any]:
    return {
        "relation_id": relation.id,
        "project_id": relation.project_id,
        "from_node_id": relation.from_node_id,
        "to_node_id": relation.to_node_id,
        "relation_type": relation.relation_type.value,
        "confidence": relation.confidence,
        "weight": relation.weight,
    }


def task_counts(counts: dict[str, int]) -> dict[str, int]:
    return {status: int(counts.get(status, 0)) for status in _TASK_STATUSES}


def list_projects(application: Application) -> dict[str, Any]:
    return {
        "projects": [
            project_payload(project) for project in application.projects.list()
        ]
    }


def project_detail(application: Application, project_id: str) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    return {"project": project_payload(project)}


def project_status(application: Application, project_id: str) -> dict[str, Any]:
    status = application.project_tools.status(project_id)
    status["tasks"] = task_counts(application.tasks.counts(status["project"]["id"]))
    return status


def project_overview(application: Application, project_id: str) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    overview = application.context.build(
        project.id,
        sections=["tech_stack", "top_modules", "decisions", "recent_changes"],
        max_tokens=6000,
    )
    overview["project"] = project_payload(project)
    overview["tasks"] = task_counts(application.tasks.counts(project.id))
    overview["last_run"] = application.runs.latest(project.id)
    return overview


def search_nodes(
    application: Application,
    project_id: str,
    *,
    query: str,
    mode: str,
    node_types: str | None,
    path_prefix: str | None,
    limit: int,
) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    result = application.search_tools.search(
        query,
        project=project.id,
        limit=limit,
        mode=mode,
        node_types=_node_type_values(node_types),
        path_prefix=path_prefix,
    )
    for item in result["results"]:
        item["project_id"] = project.id
    return result


def graph_overview(
    application: Application,
    project_id: str,
    *,
    max_nodes: int,
    node_types: str | None,
    relation_types: str | None,
) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    allowed_node_types = _node_type_values(node_types) or list(
        _DEFAULT_GRAPH_NODE_TYPES
    )
    allowed_relation_types = _relation_type_values(relation_types)
    seeds = application.nodes.top_by_salience(
        project.id,
        node_types=allowed_node_types,
        limit=max_nodes,
    )
    selected: dict[str, KnowledgeNode] = {
        node.id: node
        for node in seeds
        if node.project_id == project.id and node.status is NodeStatus.ACTIVE
    }
    relations = application.relations.get_neighbors(
        list(selected),
        direction="both",
        relation_types=allowed_relation_types,
        limit_per_node=4,
        total_limit=max_nodes * 4,
    )
    neighbor_ids = {
        node_id
        for relation in relations
        if relation.project_id == project.id
        for node_id in (relation.from_node_id, relation.to_node_id)
        if node_id not in selected
    }
    for node in application.nodes.get_many(sorted(neighbor_ids)):
        if len(selected) >= max_nodes:
            break
        if node.project_id != project.id or node.status is not NodeStatus.ACTIVE:
            continue
        if node.node_type.value not in allowed_node_types:
            continue
        selected[node.id] = node
    edges = [
        relation_payload(relation)
        for relation in relations
        if relation.project_id == project.id
        and relation.from_node_id in selected
        and relation.to_node_id in selected
    ]
    nodes = sorted(
        (node_payload(node) for node in selected.values()),
        key=lambda item: (
            str(item["node_type"]),
            str(item["path"] or ""),
            int(item["start_line"] or 0),
            str(item["node_id"]),
        ),
    )
    edges.sort(key=lambda item: (str(item["relation_type"]), str(item["relation_id"])))
    truncated = len(selected) >= max_nodes and (
        len(neighbor_ids) > 0 or len(relations) >= max_nodes * 4
    )
    return {
        "project_id": project.id,
        "nodes": nodes,
        "edges": edges,
        "truncated": truncated,
        "meta": {
            "seed_nodes": len(seeds),
            "returned_nodes": len(nodes),
            "returned_edges": len(edges),
        },
    }


def _related_for_project(
    application: Application,
    project_id: str,
    node_id: str,
) -> dict[str, list[dict[str, Any]]]:
    related = application.search_tools.get_related(node_id, limit=12)
    ids = {
        item["node_id"]
        for bucket in related["related"].values()
        for item in bucket
    }
    node_map = {node.id: node for node in application.nodes.get_many(sorted(ids))}
    filtered: dict[str, list[dict[str, Any]]] = {}
    for bucket, items in related["related"].items():
        filtered[bucket] = []
        for item in items:
            node = node_map.get(item["node_id"])
            if node is None or node.project_id != project_id:
                continue
            filtered[bucket].append(
                {
                    **item,
                    "project_id": node.project_id,
                }
            )
    return filtered


def node_detail(
    application: Application,
    project_id: str,
    node_id: str,
) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    node = application.nodes.get(node_id)
    if node is None or node.project_id != project.id:
        raise NodeNotFound(f"节点不存在: {node_id}", details={"node_id": node_id})
    return {
        "node": node_payload(node, include_content=True),
        "related": _related_for_project(application, project.id, node.id),
    }


def graph_neighbors(
    application: Application,
    project_id: str,
    node_id: str,
    *,
    depth: int,
    direction: str,
    relation_types: str | None,
    node_types: str | None,
    limit: int,
) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    start = application.nodes.get(node_id)
    if start is None or start.project_id != project.id:
        raise NodeNotFound(f"节点不存在: {node_id}", details={"node_id": node_id})
    allowed_node_types = _node_type_values(node_types)
    result = application.search_tools.explore_graph(
        node_id,
        depth=depth,
        direction=direction,
        relation_types=_relation_type_values(relation_types),
        limit=limit,
    )
    ids = {item["node_id"] for item in result["nodes"]}
    node_map = {
        node.id: node for node in application.nodes.get_many(sorted(ids))
    }
    allowed_ids = {
        item_id
        for item_id, node in node_map.items()
        if node.project_id == project.id and node.status is NodeStatus.ACTIVE
    }
    if allowed_node_types:
        allowed_ids = {
            item_id
            for item_id in allowed_ids
            if item_id == node_id
            or node_map[item_id].node_type.value in allowed_node_types
        }
    nodes = [
        node_payload(node_map[item_id])
        for item_id in sorted(
            allowed_ids,
            key=lambda value: (
                node_map[value].node_type.value,
                node_map[value].path or "",
                node_map[value].start_line or 0,
                value,
            ),
        )
    ]
    edges = [
        edge
        for edge in result["edges"]
        if edge["from_node_id"] in allowed_ids
        and edge["to_node_id"] in allowed_ids
    ]
    return {
        "start_node_id": node_id,
        "nodes": nodes,
        "edges": edges,
        "truncated": bool(result.get("truncated"))
        or len(nodes) < len(result["nodes"])
        or len(edges) < len(result["edges"]),
    }


def list_memories(
    application: Application,
    project_id: str,
    *,
    memory_type: str | None = None,
    query: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    return application.memory_tools.list(
        project_id,
        memory_type=memory_type,
        query=query,
        limit=limit,
        offset=offset,
    )


def run_index(
    application: Application,
    project_id: str,
    *,
    full: bool = False,
) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    return application.project_tools.index(project.id, full=full)


def memory_detail(
    application: Application,
    project_id: str,
    node_id: str,
) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    return application.memory_tools.get(node_id, project=project.id)


def context_inspection(
    application: Application,
    project_id: str,
    *,
    query: str | None = None,
    max_tokens: int = 2000,
) -> dict[str, Any]:
    project = application.projects.resolve(project_id)
    return application.context.build(
        project.id,
        sections=["tech_stack", "top_modules", "decisions", "recent_changes"],
        max_tokens=max(100, min(max_tokens, 20000)),
        query=query.strip() if query and query.strip() else None,
    )
