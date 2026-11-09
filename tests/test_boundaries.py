from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.core.clock import utc_now_iso


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_repeated_index_is_idempotent(tmp_path: Path) -> None:
    root = tmp_path / "project"
    _write(root / "app.py", "def alpha() -> str:\n    return 'a'\n")
    settings = Settings(home=tmp_path / "home")

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
        first = application.project_tools.status(project_id)["stats"]

        for _ in range(2):
            stats = application.project_tools.index(project_id)["stats"]
            assert stats["changed"] == 0
            assert stats["unchanged"] == 1
            assert stats["nodes_upserted"] == 0

        after = application.project_tools.status(project_id)["stats"]
        assert after["nodes"] == first["nodes"]
        assert after["relations"] == first["relations"]


def test_content_change_with_same_mtime_and_size_is_detected_when_enabled(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    path = root / "app.py"
    _write(path, "def alpha() -> str:\n    return 'a'\n")
    settings = Settings(
        home=tmp_path / "home",
        indexing={"verify_content_hashes": True},
    )

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
        before = application.sources.get_by_uri(project_id, "file", "app.py")
        assert before is not None

        original = path.stat()
        _write(path, "def alpha() -> str:\n    return 'b'\n")
        assert path.stat().st_size == original.st_size
        os.utime(path, ns=(original.st_atime_ns, original.st_mtime_ns))

        stats = application.project_tools.index(project_id)["stats"]
        after = application.sources.get_by_uri(project_id, "file", "app.py")
        assert stats["changed"] == 1
        assert after is not None
        assert after.content_hash != before.content_hash


@pytest.mark.skipif(sys.platform != "win32", reason="Windows path semantics")
def test_project_path_lookup_is_case_insensitive(tmp_path: Path) -> None:
    root = tmp_path / "CaseProject"
    _write(root / "app.py", "def alpha() -> str:\n    return 'a'\n")
    settings = Settings(home=tmp_path / "home")

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        alternate = str(root).upper()

        assert application.project_tools.register(alternate)["id"] == project_id
        assert application.projects.resolve(alternate).id == project_id


def test_context_token_budget_trims_optional_sections(tmp_path: Path) -> None:
    root = tmp_path / "project"
    _write(root / "app.py", "def alpha() -> str:\n    return 'a'\n")
    _write(
        root / "pyproject.toml",
        '[project]\nname = "sample"\ndependencies = ["fastapi", "pydantic"]\n',
    )
    settings = Settings(home=tmp_path / "home")

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
        for index in range(10):
            application.memory_tools.remember(
                project_id,
                ("Long decision text " * 40) + f" decision-{index}",
                title=f"Decision {index}",
                memory_type="decision",
            )

        payload = application.search_tools.get_context(
            project_id,
            max_tokens=250,
        )

        assert payload["truncated"] is True
        assert payload["token_estimate"] <= 250


def test_tasks_retry_until_max_attempts(tmp_path: Path) -> None:
    root = tmp_path / "project"
    _write(root / "app.py", "def alpha() -> str:\n    return 'a'\n")
    settings = Settings(home=tmp_path / "home")

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.tasks.enqueue_many(
            project_id,
            "index_file",
            [{"relative_path": "app.py"}],
        )

        for attempt in (1, 2, 3):
            claimed = application.tasks.claim(10, project_id=project_id)
            assert len(claimed) == 1
            assert claimed[0]["attempts"] == attempt
            application.tasks.fail(
                claimed[0]["id"],
                f"failure-{attempt}",
                utc_now_iso(),
            )
            row = application.database.connect().execute(
                "SELECT status, attempts, last_error FROM tasks WHERE id=?",
                (claimed[0]["id"],),
            ).fetchone()
            assert row is not None
            assert row["attempts"] == attempt
            assert row["last_error"] == f"failure-{attempt}"
            expected = "failed" if attempt == 3 else "queued"
            assert row["status"] == expected

        assert application.tasks.counts(project_id) == {"failed": 1}
