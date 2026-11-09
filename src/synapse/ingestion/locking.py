from __future__ import annotations

from pathlib import Path

from filelock import FileLock

from synapse.config import Settings


def index_lock_path(settings: Settings, project_id: str) -> Path:
    return settings.resolved_home() / "locks" / f"index-{project_id}.lock"


def index_lock(settings: Settings, project_id: str) -> FileLock:
    path = index_lock_path(settings, project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    return FileLock(str(path), timeout=settings.indexing.lock_timeout_seconds)
