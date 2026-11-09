from __future__ import annotations

from collections import defaultdict

from synapse.retrieval.ranker import Candidate


def diversify(
    candidates: list[Candidate],
    *,
    limit: int,
    per_path: int = 3,
    type_ratio: float = 0.5,
) -> list[Candidate]:
    if limit <= 0:
        return []
    type_cap = max(1, int(limit * type_ratio))
    path_counts: dict[str, int] = defaultdict(int)
    type_counts: dict[str, int] = defaultdict(int)
    selected: list[Candidate] = []
    deferred: list[Candidate] = []

    for candidate in candidates:
        node = candidate.node
        path = node.path or ""
        node_type = node.node_type.value
        if path and path_counts[path] >= per_path:
            deferred.append(candidate)
            continue
        if type_counts[node_type] >= type_cap:
            deferred.append(candidate)
            continue
        selected.append(candidate)
        if path:
            path_counts[path] += 1
        type_counts[node_type] += 1
        if len(selected) >= limit:
            return selected

    for candidate in deferred:
        if len(selected) >= limit:
            break
        selected.append(candidate)
    selected.sort(key=lambda candidate: candidate.score, reverse=True)
    return selected
