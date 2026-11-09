from __future__ import annotations

import json
from pathlib import Path

from synapse.bootstrap import build_application
from synapse.config import Settings


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _sample_project(root: Path) -> None:
    _write(
        root / "pyproject.toml",
        """
[project]
name = "sample"
dependencies = ["fastapi>=0.110", "pydantic>=2"]
""".strip(),
    )
    _write(
        root / "app" / "recommender.py",
        '''
"""Recommendation service."""

from app.utils import normalize_title


class BookRecommender:
    """Rank books for a user."""

    def recommend_books(self, history: list[str]) -> list[str]:
        return [normalize_title(item) for item in history]


def build_recommender() -> BookRecommender:
    return BookRecommender()
'''.strip(),
    )
    _write(
        root / "app" / "utils.py",
        '''
def normalize_title(title: str) -> str:
    return " ".join(title.strip().lower().split())
'''.strip(),
    )
    _write(
        root / "docs" / "architecture.md",
        """
# Architecture

## Overview

The recommender uses [BookRecommender](../app/recommender.py).
推荐算法使用 bigram 进行检索。

## Storage

SQLite stores local data.
""".strip(),
    )


def test_incremental_index_and_search(tmp_path: Path) -> None:
    root = tmp_path / "project"
    _sample_project(root)
    settings = Settings(home=tmp_path / "home")

    with build_application(settings) as application:
        project = application.project_tools.register(str(root))
        project_id = project["id"]
        first = application.project_tools.index(project_id)["stats"]
        assert first["scanned"] == 4
        assert first["changed"] == 4
        assert first["failed"] == 0
        assert first["nodes_upserted"] > 0

        second = application.project_tools.index(project_id)["stats"]
        assert second["changed"] == 0
        assert second["unchanged"] == 4

        result = application.search_tools.search(
            "BookRecommender", project=project_id, limit=5
        )
        assert result["results"]
        assert result["results"][0]["title"] == "BookRecommender"
        assert result["results"][0]["node_type"] == "class"

        cjk = application.search_tools.search(
            "推荐算法", project=project_id, limit=5
        )
        assert cjk["results"]
        assert any(
            item["path"] == "docs/architecture.md" for item in cjk["results"]
        )

        related = application.search_tools.get_related(
            result["results"][0]["node_id"]
        )
        assert related["related"]["code"]

        graph = application.search_tools.explore_graph(
            result["results"][0]["node_id"], depth=1
        )
        assert len(graph["nodes"]) >= 2

        outgoing = application.search_tools.explore_graph(
            result["results"][0]["node_id"], depth=1, direction="outgoing"
        )
        assert outgoing["edges"]
        assert all(
            edge["from_node_id"] == result["results"][0]["node_id"]
            for edge in outgoing["edges"]
        )

        context = application.search_tools.get_context(project_id)
        assert context["project"]["id"] == project_id
        assert context["stats"]["nodes"] > 0
        assert "fastapi" in context["tech_stack"]

        memory = application.memory_tools.remember(
            project_id,
            "We use FTS5 for local search. 推荐算法使用 bigram。",
            title="Search decision",
            memory_type="decision",
            tags=["architecture"],
        )
        recalled = application.memory_tools.recall("推荐算法", project=project_id)
        assert any(item["node_id"] == memory["node"]["node_id"] for item in recalled["results"])
        assert all(
            item["node_type"] in {"memory", "note"} for item in recalled["results"]
        )


def test_rename_and_delete(tmp_path: Path) -> None:
    root = tmp_path / "project"
    _write(root / "a.py", "def alpha() -> str:\n    return 'a'\n")
    _write(root / "b.py", "def beta() -> str:\n    return 'b'\n")
    settings = Settings(home=tmp_path / "home")

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)

        (root / "a.py").rename(root / "c.py")
        renamed = application.project_tools.index(project_id)["stats"]
        assert renamed["renamed"] == 1
        assert renamed["deleted"] == 0
        assert renamed["changed"] == 1

        found = application.search_tools.search("alpha", project=project_id)
        assert found["results"]
        assert found["results"][0]["path"] == "c.py"

        (root / "c.py").unlink()
        deleted = application.project_tools.index(project_id)["stats"]
        assert deleted["deleted"] == 1
        assert deleted["nodes_removed"] > 0

        after = application.search_tools.search("alpha", project=project_id)
        assert after["results"] == []


def test_cli_roundtrip(tmp_path: Path, monkeypatch) -> None:
    from typer.testing import CliRunner

    import synapse.integrations.cli.main as cli

    root = tmp_path / "project"
    _sample_project(root)
    settings = Settings(home=tmp_path / "home")
    monkeypatch.setattr(cli, "build_application", lambda: build_application(settings))
    runner = CliRunner()

    registered = runner.invoke(
        cli.app, ["projects", "register", str(root), "--index", "--json"]
    )
    assert registered.exit_code == 0, registered.output
    assert registered.output.isascii()
    project = json.loads(registered.output)
    assert project["id"]
    assert project["last_indexed_at"]

    chinese = runner.invoke(
        cli.app, ["search", "推荐算法", "--project", project["id"], "--json"]
    )
    assert chinese.exit_code == 0, chinese.output
    assert chinese.output.isascii()
    assert json.loads(chinese.output)["results"]

    searched = runner.invoke(
        cli.app, ["search", "BookRecommender", "--project", project["id"], "--json"]
    )
    assert searched.exit_code == 0, searched.output
    payload = json.loads(searched.output)
    assert payload["results"][0]["title"] == "BookRecommender"

    doctor = runner.invoke(cli.app, ["doctor", "--json"])
    assert doctor.exit_code == 0, doctor.output
    checked = json.loads(doctor.output)
    assert checked["integrity"] == ["ok"]
    assert checked["fts_integrity"] == ["ok"]
