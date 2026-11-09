from __future__ import annotations

from pathlib import Path
from typing import Any

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.domain.enums import SourceStatus


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_failed_node_write_does_not_leave_active_source(
    tmp_path: Path, monkeypatch
) -> None:
    root = tmp_path / "project"
    _write(root / "app.py", "def build_widget() -> str:\n    return 'widget'\n")
    settings = Settings(home=tmp_path / "home")

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        original = application.nodes.upsert_many

        def fail_upsert(nodes: list[Any], *, connection: Any = None) -> int:
            raise RuntimeError("injected node write failure")

        monkeypatch.setattr(application.nodes, "upsert_many", fail_upsert)
        result = application.project_tools.index(project_id)

        assert result["stats"]["failed"] >= 1
        assert application.sources.list_for_project(project_id) == []
        assert application.nodes.counts(project_id)["total"] == 0

        monkeypatch.setattr(application.nodes, "upsert_many", original)
        recovered = application.project_tools.index(project_id)

        sources = application.sources.list_for_project(project_id)
        assert recovered["stats"]["failed"] == 0
        assert len(sources) == 1
        assert sources[0].status is SourceStatus.ACTIVE
        assert sources[0].uri == "app.py"
        assert application.nodes.counts(project_id)["total"] > 0
