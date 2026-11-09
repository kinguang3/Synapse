from __future__ import annotations

from pathlib import Path

from synapse.bootstrap import build_application
from synapse.config import Settings


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_context_decisions_use_repository_filter(
    tmp_path: Path, monkeypatch
) -> None:
    root = tmp_path / "project"
    _write(root / "app.py", "def build_widget() -> str:\n    return 'widget'\n")
    settings = Settings(home=tmp_path / "home")

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
        decision = application.memory_tools.remember(
            project_id,
            "Use SQLite FTS5 for local retrieval.",
            title="Use FTS5",
            memory_type="decision",
        )
        application.memory_tools.remember(
            project_id,
            "The project uses Python.",
            title="Python fact",
            memory_type="fact",
        )

        def fail_all_nodes(*args, **kwargs):
            raise AssertionError("context must not load all project nodes")

        monkeypatch.setattr(application.nodes, "all_for_project", fail_all_nodes)
        payload = application.search_tools.get_context(project_id)

    assert [item["title"] for item in payload["decisions"]] == ["Use FTS5"]
    assert payload["decisions"][0]["node_id"] == decision["node"]["node_id"]
