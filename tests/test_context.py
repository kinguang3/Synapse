from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.integrations.cli.main import app as cli_app


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _seed_context_project(tmp_path: Path) -> tuple[Path, Path, str]:
    root = tmp_path / "project"
    _write(
        root / "src/retrieval/ranker.py",
        "class HybridRanker:\n"
        "    def rank(self) -> list[str]:\n"
        "        return []\n",
    )
    _write(
        root / "src/retrieval/service.py",
        "from retrieval.ranker import HybridRanker\n"
        "\n"
        "class RetrievalService:\n"
        "    def search(self) -> list[str]:\n"
        "        return HybridRanker().rank()\n",
    )
    _write(
        root / "src/context/builder.py",
        "class ContextBuilder:\n"
        "    def build(self) -> dict[str, str]:\n"
        "        return {}\n",
    )
    _write(
        root / "src/storage/repository.py",
        "class Repository:\n"
        "    def load(self) -> list[str]:\n"
        "        return []\n",
    )
    _write(
        root / "src/ingestion/pipeline.py",
        "class IngestionService:\n"
        "    def run(self) -> list[str]:\n"
        "        return []\n",
    )
    _write(
        root / "src/knowledge/service.py",
        "class KnowledgeService:\n"
        "    def remember(self) -> list[str]:\n"
        "        return []\n",
    )
    _write(
        root / "src/tools/search_tools.py",
        "class SearchTools:\n"
        "    def search(self) -> list[str]:\n"
        "        return []\n",
    )
    _write(
        root / "src/domain/models.py",
        "class Project:\n"
        "    id: str = ''\n",
    )
    _write(root / "README.md", "# Sample\n\nProject documentation.\n")
    home = tmp_path / "home"
    with build_application(Settings(home=home)) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
    return root, home, project_id


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


def test_context_query_prioritizes_relevant_modules(tmp_path: Path) -> None:
    _root, home, project_id = _seed_context_project(tmp_path)

    with build_application(Settings(home=home)) as application:
        payload = application.search_tools.get_context(
            project_id,
            query="HybridRanker",
        )

    modules = payload["top_modules"]
    assert modules
    assert modules[0]["path"] == "src/retrieval/ranker.py"
    assert modules[0]["reason"] == "query_match"


def test_context_query_supports_six_scenarios(tmp_path: Path) -> None:
    _root, home, project_id = _seed_context_project(tmp_path)
    scenarios = [
        ("HybridRanker", "src/retrieval/ranker.py"),
        ("ContextBuilder", "src/context/builder.py"),
        ("Repository", "src/storage/repository.py"),
        ("IngestionService", "src/ingestion/pipeline.py"),
        ("KnowledgeService", "src/knowledge/service.py"),
        ("SearchTools", "src/tools/search_tools.py"),
    ]

    with build_application(Settings(home=home)) as application:
        for query, expected_path in scenarios:
            payload = application.search_tools.get_context(
                project_id,
                query=query,
                max_tokens=1200,
            )
            paths = [item["path"] for item in payload["top_modules"]]
            assert expected_path in paths, (query, paths)


def test_context_query_falls_back_for_chinese_question(tmp_path: Path) -> None:
    _root, home, project_id = _seed_context_project(tmp_path)

    with build_application(Settings(home=home)) as application:
        payload = application.search_tools.get_context(
            project_id,
            query="如何理解 HybridRanker 模块",
        )

    assert payload["top_modules"]
    assert payload["top_modules"][0]["path"] == "src/retrieval/ranker.py"


def test_context_modules_are_unique_by_path(tmp_path: Path) -> None:
    _root, home, project_id = _seed_context_project(tmp_path)

    with build_application(Settings(home=home)) as application:
        payload = application.search_tools.get_context(project_id)

    paths = [item["path"] for item in payload["top_modules"]]
    assert paths
    assert len(paths) == len(set(paths))


def test_context_token_budgets_keep_query_modules(tmp_path: Path) -> None:
    _root, home, project_id = _seed_context_project(tmp_path)

    with build_application(Settings(home=home)) as application:
        for budget in (300, 700, 1500, 3000):
            payload = application.search_tools.get_context(
                project_id,
                query="retrieval",
                max_tokens=budget,
            )
            assert payload["token_estimate"] <= budget
            assert payload["top_modules"]
            assert payload["top_modules"][0]["reason"] == "query_match"
            assert payload["top_modules"][0]["path"].startswith(
                "src/retrieval/"
            )


def test_cli_context_query(tmp_path: Path, monkeypatch) -> None:
    _root, home, project_id = _seed_context_project(tmp_path)
    monkeypatch.setenv("SYNAPSE_HOME", str(home))

    result = CliRunner().invoke(
        cli_app,
        ["context", project_id, "--query", "HybridRanker", "--json"],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["top_modules"][0]["path"] == "src/retrieval/ranker.py"
