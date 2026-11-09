from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.core.clock import utc_now_iso
from synapse.core.ids import new_id

_CRASH_SCRIPT = """
import os
import sys
from pathlib import Path
from synapse.bootstrap import build_application
from synapse.config import Settings

settings = Settings(home=Path(sys.argv[1]))
with build_application(settings) as application:
    def crash(*args, **kwargs):
        os._exit(17)

    application.ingestion._parse_task = crash
    application.project_tools.index(sys.argv[2])
"""


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _spawn_crash(home: Path, project_id: str) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "-c", _CRASH_SCRIPT, str(home), project_id],
        cwd=str(Path.cwd()),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _seed_running_state(application, project_id: str) -> tuple[str, str]:
    run_id = new_id()
    task_id = new_id()
    now = utc_now_iso()
    connection = application.database.connect()
    connection.execute(
        """
        INSERT INTO index_runs(id, project_id, mode, status, stats_json, started_at)
        VALUES(?,?,?,?,?,?)
        """,
        (run_id, project_id, "incremental", "running", "{}", now),
    )
    connection.execute(
        """
        INSERT INTO tasks(
          id, project_id, kind, payload_json, status, priority,
          attempts, max_attempts, available_at, created_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            task_id,
            project_id,
            "index_file",
            '{"relative_path": "ghost.py"}',
            "running",
            0,
            1,
            3,
            now,
            now,
            now,
        ),
    )
    return run_id, task_id


def test_real_process_crash_is_recovered_on_next_index(tmp_path: Path) -> None:
    home = tmp_path / "home"
    root = tmp_path / "project"
    _write(root / "app.py", "def alpha() -> str:\n    return 'a'\n")
    settings = Settings(home=home)

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
        _write(root / "crash_me.py", "def crash_me() -> str:\n    return 'new'\n")

        child = _spawn_crash(home, project_id)
        try:
            _, stderr = child.communicate(timeout=60)
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=10)

        assert child.returncode == 17, stderr
        crashed = application.runs.latest(project_id)
        assert crashed is not None
        crashed_id = crashed["id"]
        assert crashed["status"] == "running"
        assert application.tasks.counts(project_id).get("running") == 1

        recovered = application.project_tools.index(project_id)["stats"]
        assert recovered["recovered_runs"] == 1
        assert recovered["recovered_tasks"] == 1
        assert recovered["changed"] == 1
        assert recovered["failed"] == 0

        row = application.database.connect().execute(
            "SELECT status, error, finished_at FROM index_runs WHERE id=?",
            (crashed_id,),
        ).fetchone()
        assert row is not None
        assert row["status"] == "interrupted"
        assert row["error"]
        assert row["finished_at"]

        counts = application.tasks.counts(project_id)
        assert counts.get("running", 0) == 0
        assert counts.get("queued", 0) == 0
        assert counts.get("canceled", 0) == 1
        assert counts.get("succeeded", 0) == 2

        before = application.project_tools.status(project_id)["stats"]
        second = application.project_tools.index(project_id)["stats"]
        after = application.project_tools.status(project_id)["stats"]
        assert second["recovered_runs"] == 0
        assert second["recovered_tasks"] == 0
        assert second["changed"] == 0
        assert after["nodes"] == before["nodes"]
        assert after["relations"] == before["relations"]


def test_crash_during_rename_keeps_source_and_nodes_consistent(tmp_path: Path) -> None:
    home = tmp_path / "home"
    root = tmp_path / "project"
    _write(root / "old.py", "def alpha() -> str:\n    return 'a'\n")
    settings = Settings(home=home)

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
        (root / "old.py").rename(root / "new.py")

        child = _spawn_crash(home, project_id)
        try:
            _, stderr = child.communicate(timeout=60)
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=10)

        assert child.returncode == 17, stderr
        assert application.sources.get_by_uri(project_id, "file", "old.py") is not None
        assert application.sources.get_by_uri(project_id, "file", "new.py") is None

        recovered = application.project_tools.index(project_id)["stats"]
        assert recovered["recovered_runs"] == 1
        assert recovered["renamed"] == 1
        assert recovered["failed"] == 0
        assert application.sources.get_by_uri(project_id, "file", "old.py") is None
        assert application.sources.get_by_uri(project_id, "file", "new.py") is not None

        found = application.search_tools.search("alpha", project=project_id)
        assert found["results"]
        assert found["results"][0]["path"] == "new.py"


def test_recovery_is_scoped_to_one_project(tmp_path: Path) -> None:
    home = tmp_path / "home"
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    _write(first_root / "alpha.py", "def alpha() -> str:\n    return 'a'\n")
    _write(second_root / "beta.py", "def beta() -> str:\n    return 'b'\n")
    settings = Settings(home=home)

    with build_application(settings) as application:
        first_id = application.project_tools.register(str(first_root))["id"]
        second_id = application.project_tools.register(str(second_root))["id"]
        second_run, second_task = _seed_running_state(application, second_id)

        application.project_tools.index(first_id)

        run_row = application.database.connect().execute(
            "SELECT status FROM index_runs WHERE id=?", (second_run,)
        ).fetchone()
        task_row = application.database.connect().execute(
            "SELECT status FROM tasks WHERE id=?", (second_task,)
        ).fetchone()
        assert run_row is not None and run_row["status"] == "running"
        assert task_row is not None and task_row["status"] == "running"
