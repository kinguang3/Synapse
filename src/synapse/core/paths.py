from __future__ import annotations

import os
from pathlib import Path

from platformdirs import user_data_dir


def default_home() -> Path:
    return Path(user_data_dir("Synapse", "Synapse"))


def resolve_project_root(value: str | Path) -> Path:
    return Path(value).expanduser().resolve()


def normalized_root(value: str | Path) -> str:
    return os.path.normcase(str(resolve_project_root(value)))


def relative_posix(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()
