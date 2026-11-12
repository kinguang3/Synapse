from __future__ import annotations

from pathlib import Path

import pytest

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.errors import InvalidArgument, ProjectNotFound


def _build(tmp_path: Path):
    settings = Settings(home=tmp_path / "home")
    return build_application(settings)


def _project(tmp_path: Path, name: str = "project") -> tuple[Path, Path, str]:
    root = tmp_path / name
    root.mkdir(parents=True, exist_ok=True)
    home = tmp_path / "home"
    with build_application(Settings(home=home)) as application:
        project_id = application.project_tools.register(str(root))["id"]
    return root, home, project_id


def _remember_many(
    application,
    project_id: str,
    *,
    prefix: str,
    memory_type: str,
    count: int,
) -> list[str]:
    ids = []
    for index in range(count):
        payload = application.memory_tools.remember(
            project_id,
            f"{prefix} content {index}",
            title=f"{prefix} {index:03d}",
            memory_type=memory_type,
        )
        ids.append(payload["node"]["node_id"])
    return ids


def _set_times(application, node_ids: list[str], timestamp: str) -> None:
    with application.database.transaction() as connection:
        connection.executemany(
            "UPDATE nodes SET created_at=?, updated_at=? WHERE id=?",
            [(timestamp, timestamp, node_id) for node_id in node_ids],
        )


def test_list_returns_all_types_and_filters_by_memory_type(tmp_path: Path) -> None:
    _root, home, project_id = _project(tmp_path)
    with build_application(Settings(home=home)) as application:
        application.memory_tools.remember(
            project_id, "Python is used", title="Fact", memory_type="fact"
        )
        application.memory_tools.remember(
            project_id, "Use SQLite", title="Decision", memory_type="decision"
        )
        application.memory_tools.remember(
            project_id, "Prefer explicit APIs", title="Preference", memory_type="preference"
        )

        all_memories = application.memory_tools.list(project_id, limit=200)
        assert all_memories["total"] == 3
        assert {item["memory_type"] for item in all_memories["memories"]} == {
            "fact",
            "decision",
            "preference",
        }

        facts = application.memory_tools.list(
            project_id, memory_type="fact", limit=200
        )
        assert facts["total"] == 1
        assert [item["title"] for item in facts["memories"]] == ["Fact"]


def test_pagination_offset_and_total_are_correct(tmp_path: Path) -> None:
    _root, home, project_id = _project(tmp_path)
    with build_application(Settings(home=home)) as application:
        created = _remember_many(
            application, project_id, prefix="fact", memory_type="fact", count=60
        )

        first = application.memory_tools.list(project_id, limit=10, offset=0)
        second = application.memory_tools.list(project_id, limit=10, offset=10)
        late = application.memory_tools.list(project_id, limit=5, offset=55)
        beyond = application.memory_tools.list(project_id, limit=10, offset=500)

        assert first["total"] == second["total"] == late["total"] == 60
        assert len(first["memories"]) == 10
        assert len(second["memories"]) == 10
        assert len(late["memories"]) == 5
        assert beyond["memories"] == []
        assert beyond["total"] == 60

        paged = []
        for offset in range(0, 60, 7):
            page = application.memory_tools.list(project_id, limit=7, offset=offset)
            paged.extend(item["node_id"] for item in page["memories"])
        all_ids = [
            item["node_id"]
            for item in application.memory_tools.list(project_id, limit=200)["memories"]
        ]
        assert paged == all_ids
        assert len(paged) == len(created) == len(set(paged))


def test_type_filter_before_limit_regression(tmp_path: Path) -> None:
    _root, home, project_id = _project(tmp_path)
    with build_application(Settings(home=home)) as application:
        fact_ids = _remember_many(
            application, project_id, prefix="fact", memory_type="fact", count=10
        )
        decision_ids = _remember_many(
            application,
            project_id,
            prefix="decision",
            memory_type="decision",
            count=50,
        )
        _set_times(application, fact_ids, "2026-01-01T00:00:00.000+00:00")
        _set_times(application, decision_ids, "2026-01-02T00:00:00.000+00:00")

        payload = application.memory_tools.list(
            project_id, memory_type="fact", limit=10, offset=0
        )

        assert payload["total"] == 10
        assert len(payload["memories"]) == 10
        assert {item["memory_type"] for item in payload["memories"]} == {"fact"}
        assert {item["node_id"] for item in payload["memories"]} == set(fact_ids)


def test_query_filter_paginates_without_fifty_item_window(tmp_path: Path) -> None:
    _root, home, project_id = _project(tmp_path)
    with build_application(Settings(home=home)) as application:
        fact_ids = _remember_many(
            application, project_id, prefix="fact", memory_type="fact", count=60
        )
        _remember_many(
            application,
            project_id,
            prefix="decision",
            memory_type="decision",
            count=5,
        )

        payload = application.memory_tools.list(
            project_id,
            memory_type="fact",
            query="fact",
            limit=5,
            offset=55,
        )

        assert payload["total"] == 60
        assert len(payload["memories"]) == 5
        assert {item["node_id"] for item in payload["memories"]} <= set(fact_ids)


def test_insufficient_page_empty_result_and_validation(tmp_path: Path) -> None:
    root, home, project_id = _project(tmp_path)
    with build_application(Settings(home=home)) as application:
        _remember_many(
            application, project_id, prefix="fact", memory_type="fact", count=3
        )

        short = application.memory_tools.list(project_id, limit=10)
        empty = application.memory_tools.list(
            project_id, memory_type="summary", limit=10
        )

        assert short["total"] == 3
        assert len(short["memories"]) == 3
        assert empty["total"] == 0
        assert empty["memories"] == []

        with pytest.raises(InvalidArgument):
            application.memory_tools.list(project_id, limit=0)
        with pytest.raises(InvalidArgument):
            application.memory_tools.list(project_id, limit=201)
        with pytest.raises(InvalidArgument):
            application.memory_tools.list(project_id, offset=-1)
        with pytest.raises(ProjectNotFound):
            application.memory_tools.list(str(root / "missing"), limit=10)


def test_project_and_type_filters_are_isolated(tmp_path: Path) -> None:
    root_a = tmp_path / "project-a"
    root_b = tmp_path / "project-b"
    root_a.mkdir()
    root_b.mkdir()
    home = tmp_path / "home"
    with build_application(Settings(home=home)) as application:
        project_a = application.project_tools.register(str(root_a))["id"]
        project_b = application.project_tools.register(str(root_b))["id"]
        memory_a = application.memory_tools.remember(
            project_a, "Project A fact", title="A", memory_type="fact"
        )["node"]["node_id"]
        application.memory_tools.remember(
            project_b, "Project B decision", title="B", memory_type="decision"
        )

        filtered_a = application.memory_tools.list(
            project_a, memory_type="fact", limit=10
        )
        filtered_b = application.memory_tools.list(
            project_b, memory_type="fact", limit=10
        )

        assert filtered_a["total"] == 1
        assert [item["node_id"] for item in filtered_a["memories"]] == [memory_a]
        assert filtered_b["total"] == 0
        with pytest.raises(InvalidArgument):
            application.memory_tools.get(memory_a, project=project_b)


def test_same_timestamps_have_stable_node_id_order(tmp_path: Path) -> None:
    _root, home, project_id = _project(tmp_path)
    with build_application(Settings(home=home)) as application:
        ids = _remember_many(
            application, project_id, prefix="fact", memory_type="fact", count=12
        )
        _set_times(application, ids, "2026-02-01T00:00:00.000+00:00")

        expected = sorted(ids)
        first = application.memory_tools.list(project_id, limit=5, offset=0)
        second = application.memory_tools.list(project_id, limit=5, offset=5)
        third = application.memory_tools.list(project_id, limit=5, offset=10)

        actual = [
            item["node_id"]
            for page in (first, second, third)
            for item in page["memories"]
        ]
        assert actual == expected
        assert len(actual) == len(set(actual))
