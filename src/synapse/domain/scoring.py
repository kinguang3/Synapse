from __future__ import annotations

import math
from datetime import UTC, datetime


def noisy_or(values: list[float]) -> float:
    if not values:
        return 0.0
    combined = 1.0
    for value in values:
        combined *= 1.0 - max(0.0, min(1.0, value))
    return 1.0 - combined


def recency_score(updated_at: str | None, now: datetime | None = None, half_life_days: float = 30.0) -> float:
    if not updated_at:
        return 0.0
    try:
        parsed = datetime.fromisoformat(updated_at)
    except ValueError:
        return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    current = now or datetime.now(UTC)
    days = max(0.0, (current - parsed).total_seconds() / 86400.0)
    return math.pow(0.5, days / half_life_days)


def relevance(
    *,
    lexical: float,
    graph: float,
    recency: float,
    salience: float,
    confidence: float,
    weight_lexical: float,
    weight_graph: float,
    weight_recency: float,
    weight_importance: float,
    weight_confidence: float,
) -> float:
    return (
        weight_lexical * lexical
        + weight_graph * graph
        + weight_recency * recency
        + weight_importance * salience
        + weight_confidence * confidence
    )


def normalize_scores(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    minimum = min(values.values())
    maximum = max(values.values())
    if maximum <= minimum:
        return {key: 1.0 for key in values}
    span = maximum - minimum
    return {key: (value - minimum) / span for key, value in values.items()}
