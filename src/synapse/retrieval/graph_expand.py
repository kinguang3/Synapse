from __future__ import annotations

from synapse.retrieval.ranker import Candidate
from synapse.storage.sqlite.repositories import NodeRepository, RelationRepository


class GraphExpander:
    def __init__(
        self,
        nodes: NodeRepository,
        relations: RelationRepository,
        *,
        max_neighbors_per_node: int = 8,
        max_nodes: int = 200,
    ) -> None:
        self._nodes = nodes
        self._relations = relations
        self._max_neighbors_per_node = max_neighbors_per_node
        self._max_nodes = max_nodes

    def expand(
        self,
        candidates: dict[str, Candidate],
        *,
        depth: int,
        relation_types: list[str] | None = None,
        seed_limit: int = 10,
        hop_decay: float = 0.5,
    ) -> None:
        if depth <= 0 or not candidates:
            return
        frontier = [
            candidate.node.id
            for candidate in sorted(
                candidates.values(),
                key=lambda item: (item.exact, item.lexical, item.score),
                reverse=True,
            )[:seed_limit]
        ]
        for hop in range(depth):
            if not frontier or len(candidates) >= self._max_nodes:
                break
            relations = self._relations.get_neighbors(
                frontier,
                direction="both",
                relation_types=relation_types,
                limit_per_node=self._max_neighbors_per_node,
                total_limit=max(20, len(frontier) * self._max_neighbors_per_node),
            )
            neighbor_ids = {
                edge.to_node_id if edge.from_node_id in frontier else edge.from_node_id
                for edge in relations
            }
            neighbor_nodes = {
                node.id: node for node in self._nodes.get_many(sorted(neighbor_ids))
            }
            next_frontier: list[str] = []
            for edge in relations:
                if len(candidates) >= self._max_nodes:
                    break
                other_id = (
                    edge.to_node_id if edge.from_node_id in frontier else edge.from_node_id
                )
                node = neighbor_nodes.get(other_id)
                if node is None:
                    continue
                graph_score = edge.confidence * edge.weight * (hop_decay**hop)
                existing = candidates.get(other_id)
                if existing is not None:
                    if graph_score > existing.graph:
                        existing.graph = graph_score
                    reason = f"graph:{hop + 1}hop"
                    if reason not in existing.reasons:
                        existing.reasons.append(reason)
                    continue
                candidate = Candidate(
                    node=node,
                    graph=graph_score,
                    reasons=[f"graph:{hop + 1}hop"],
                )
                candidates[other_id] = candidate
                next_frontier.append(other_id)
            frontier = next_frontier
