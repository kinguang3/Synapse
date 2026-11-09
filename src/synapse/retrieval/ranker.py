from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from synapse.domain.models import KnowledgeNode
from synapse.domain.scoring import normalize_scores, recency_score, relevance


@dataclass(slots=True)
class Candidate:
    node: KnowledgeNode
    lexical: float = 0.0
    graph: float = 0.0
    exact: bool = False
    snippet: str = ""
    reasons: list[str] = field(default_factory=list)
    score: float = 0.0


class HybridRanker:
    def __init__(
        self,
        *,
        weight_lexical: float,
        weight_graph: float,
        weight_recency: float,
        weight_importance: float,
        weight_confidence: float,
    ) -> None:
        self._weight_lexical = weight_lexical
        self._weight_graph = weight_graph
        self._weight_recency = weight_recency
        self._weight_importance = weight_importance
        self._weight_confidence = weight_confidence

    def rank(
        self,
        candidates: dict[str, Candidate],
        *,
        now: datetime | None = None,
    ) -> list[Candidate]:
        raw_lexical = {
            node_id: candidate.lexical
            for node_id, candidate in candidates.items()
            if candidate.lexical > 0
        }
        normalized = normalize_scores(raw_lexical)
        ranked: list[Candidate] = []
        for node_id, candidate in candidates.items():
            lexical = 1.0 if candidate.exact else normalized.get(node_id, 0.0)
            if candidate.exact and "exact_symbol" not in candidate.reasons:
                candidate.reasons.append("exact_symbol")
            elif candidate.lexical > 0 and "fts" not in candidate.reasons:
                candidate.reasons.append("fts")
            candidate.score = relevance(
                lexical=lexical,
                graph=candidate.graph,
                recency=recency_score(candidate.node.updated_at, now),
                salience=candidate.node.salience,
                confidence=candidate.node.confidence,
                weight_lexical=self._weight_lexical,
                weight_graph=self._weight_graph,
                weight_recency=self._weight_recency,
                weight_importance=self._weight_importance,
                weight_confidence=self._weight_confidence,
            )
            ranked.append(candidate)
        ranked.sort(key=lambda item: item.score, reverse=True)
        return ranked
