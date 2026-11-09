from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.core.clock import utc_now_iso
from synapse.core.ids import new_id
from synapse.errors import IndexLocked

_HOLD_SCRIPT = """
import sys
import time
from pathlib import Path
from filelock import FileLock
from synapse.config import Settings
from synapse.ingestion.locking import index_lock_path

settings = Settings(home=Path(sys.argv[1]))
lock_path = index_lock_path(settings, sys.argv[2])
lock_path.parent.mkdir(parents=True, exist_ok=True)
with FileLock(str(lock_path)):
    print("locked", flush=True)
    time.sleep(float(sys.argv[3]))
print("released", flush=True)
"""

_INDEX_SCRIPT = """
import json
import sys
from pathlib import Path
from synapse.bootstrap import build_application
from synapse.config import Settings

settings = Settings(home=Path(sys.argv[1]))
with build_application(settings) as application:
    result = application.project_tools.index(sys.argv[2])
print(json.dumps(result["stats"]), flush=True)
"""


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _sample_project(root: Path, name: str) -> None:
    _write(
        root / f"{name}.py",
        f'def {name}() -> str:\n    return "{name}"\n',
    )


def _spawn_hold(home: Path, project_id: str, seconds: float) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "-c", _HOLD_SCRIPT, str(home), project_id, str(seconds)],
        cwd=str(Path.cwd()),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _spawn_index(home: Path, project_id: str) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "-c", _INDEX_SCRIPT, str(home), project_id],
        cwd=str(Path.cwd()),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _wait_locked(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    line = process.stdout.readline().strip()
    assert line == "locked", process.stderr.read() if process.stderr else ""


def _stop(process: subprocess.Popen[str]) -> None:
    if process.poll() is None:
        process.terminate()
    process.wait(timeout=10)


def test_same_project_lock_blocks_before_recovery(tmp_path: Path) -> None:
    home = tmp_path / "home"
    root = tmp_path / "project"
    _sample_project(root, "alpha")
    settings = Settings(
        home=home,
        indexing={"lock_timeout_seconds": 0.2},
    )

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        task_id = new_id()
        now = utc_now_iso()
        application.database.connect().execute(
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
                '{"relative_path": "alpha.py"}',
                "running",
                0,
                0,
                3,
                now,
                now,
                now,
            ),
        )

        holder = _spawn_hold(home, project_id, 3.0)
        try:
            _wait_locked(holder)
            with pytest.raises(IndexLocked):
                application.project_tools.index(project_id)

            assert application.runs.latest(project_id) is None
            row = application.database.connect().execute(
                "SELECT status FROM tasks WHERE id=?", (task_id,)
            ).fetchone()
            assert row is not None
            assert row["status"] == "running"
        finally:
            _stop(holder)


def test_lock_is_scoped_to_one_project(tmp_path: Path) -> None:
    home = tmp_path / "home"
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    _sample_project(first_root, "alpha")
    _sample_project(second_root, "beta")
    settings = Settings(
        home=home,
        indexing={"lock_timeout_seconds": 0.2},
    )

    with build_application(settings) as application:
        first_id = application.project_tools.register(str(first_root))["id"]
        second_id = application.project_tools.register(str(second_root))["id"]

        holder = _spawn_hold(home, first_id, 3.0)
        try:
            _wait_locked(holder)
            result = application.project_tools.index(second_id)
            assert result["stats"]["changed"] == 1
            assert result["stats"]["failed"] == 0
        finally:
            _stop(holder)


def test_two_processes_can_index_the_same_project(tmp_path: Path) -> None:
    home = tmp_path / "home"
    root = tmp_path / "project"
    _sample_project(root, "alpha")
    settings = Settings(home=home)

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]

    first = _spawn_index(home, project_id)
    second = _spawn_index(home, project_id)
    try:
        first_out, first_err = first.communicate(timeout=60)
        second_out, second_err = second.communicate(timeout=60)
    finally:
        _stop(first)
        _stop(second)

    assert first.returncode == 0, first_err
    assert second.returncode == 0, second_err
    assert first_out.strip()
    assert second_out.strip()


def test_two_projects_can_be_indexed_concurrently(tmp_path: Path) -> None:
    home = tmp_path / "home"
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    _sample_project(first_root, "alpha")
    _sample_project(second_root, "beta")
    settings = Settings(home=home)

    with build_application(settings) as application:
        first_id = application.project_tools.register(str(first_root))["id"]
        second_id = application.project_tools.register(str(second_root))["id"]

    first = _spawn_index(home, first_id)
    second = _spawn_index(home, second_id)
    try:
        first_out, first_err = first.communicate(timeout=60)
        second_out, second_err = second.communicate(timeout=60)
    finally:
        _stop(first)
        _stop(second)

    assert first.returncode == 0, first_err
    assert second.returncode == 0, second_err
    assert first_out.strip()
    assert second_out.strip()
