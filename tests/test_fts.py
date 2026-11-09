from __future__ import annotations

from pathlib import Path

import pytest

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.errors import IndexUnavailable


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _indexed_application(tmp_path: Path):
    root = tmp_path / "project"
    _write(root / "app.py", "def build_widget() -> str:\n    return 'widget'\n")
    settings = Settings(home=tmp_path / "home")
    application = build_application(settings)
    project_id = application.project_tools.register(str(root))["id"]
    application.project_tools.index(project_id)
    return application, project_id


def test_normal_empty_result_is_not_degraded(tmp_path: Path) -> None:
    application, project_id = _indexed_application(tmp_path)
    with application:
        result = application.search_tools.search(
            "definitely_missing_term",
            project=project_id,
            mode="keyword",
        )

    assert result["results"] == []
    assert "fts_unavailable" not in result["meta"]["degraded"]


def test_fts_table_unavailable_is_reported_as_degraded(tmp_path: Path) -> None:
    application, project_id = _indexed_application(tmp_path)
    with application:
        application.database.connect().execute("DROP TABLE node_fts")

        with pytest.raises(IndexUnavailable):
            application.nodes.search_fts(
                '"widget"',
                project_id=project_id,
                limit=10,
                node_types=None,
                path_prefix=None,
            )

        result = application.search_tools.search(
            "widget",
            project=project_id,
            mode="keyword",
        )

    assert result["results"] == []
    assert "fts_unavailable" in result["meta"]["degraded"]


def test_fts_query_error_is_reported_as_unavailable(tmp_path: Path) -> None:
    application, project_id = _indexed_application(tmp_path)
    with application, pytest.raises(IndexUnavailable):
        application.nodes.search_fts(
            "AND",
            project_id=project_id,
            limit=10,
            node_types=None,
            path_prefix=None,
        )
