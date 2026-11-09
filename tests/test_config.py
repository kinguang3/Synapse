from __future__ import annotations

import json
from pathlib import Path

from synapse.config import (
    Settings,
    default_home,
    resolve_config_path,
    resolve_home,
    write_default_config,
)


def _write_config(path: Path, *, workers: int, home: Path | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    if home is not None:
        escaped_home = str(home).replace("\\", "\\\\")
        lines.append(f'home = "{escaped_home}"')
    lines.extend(
        [
            "[indexing]",
            f"workers = {workers}",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def _clear_synapse_env(monkeypatch) -> None:
    for name in (
        "SYNAPSE_HOME",
        "SYNAPSE_CONFIG",
        "SYNAPSE_INDEXING__WORKERS",
    ):
        monkeypatch.delenv(name, raising=False)


def test_default_home_and_config_path(monkeypatch) -> None:
    _clear_synapse_env(monkeypatch)

    expected_home = default_home().expanduser().resolve()
    assert resolve_home() == expected_home
    assert resolve_config_path() == expected_home / "config.toml"


def test_custom_home_loads_its_config(tmp_path: Path, monkeypatch) -> None:
    _clear_synapse_env(monkeypatch)
    home = tmp_path / "home"
    _write_config(home / "config.toml", workers=7)

    settings = Settings(home=home)

    assert settings.resolved_home() == home.resolve()
    assert settings.resolved_config_path() == home.resolve() / "config.toml"
    assert settings.indexing.workers == 7


def test_synapse_home_env_loads_config(tmp_path: Path, monkeypatch) -> None:
    _clear_synapse_env(monkeypatch)
    home = tmp_path / "env-home"
    _write_config(home / "config.toml", workers=8)
    monkeypatch.setenv("SYNAPSE_HOME", str(home))

    settings = Settings()

    assert settings.resolved_home() == home.resolve()
    assert settings.indexing.workers == 8


def test_synapse_config_env_selects_config_file(tmp_path: Path, monkeypatch) -> None:
    _clear_synapse_env(monkeypatch)
    home = tmp_path / "home"
    config_path = tmp_path / "custom-config" / "config.toml"
    _write_config(config_path, workers=11)
    monkeypatch.setenv("SYNAPSE_HOME", str(home))
    monkeypatch.setenv("SYNAPSE_CONFIG", str(config_path))

    settings = Settings()

    assert settings.resolved_home() == home.resolve()
    assert settings.resolved_config_path() == config_path.resolve()
    assert settings.indexing.workers == 11


def test_priority_init_over_env_over_config(tmp_path: Path, monkeypatch) -> None:
    _clear_synapse_env(monkeypatch)
    home = tmp_path / "home"
    _write_config(home / "config.toml", workers=7)
    monkeypatch.setenv("SYNAPSE_INDEXING__WORKERS", "9")

    settings = Settings(home=home, indexing={"workers": 5})

    assert settings.indexing.workers == 5


def test_priority_env_over_config(tmp_path: Path, monkeypatch) -> None:
    _clear_synapse_env(monkeypatch)
    home = tmp_path / "home"
    _write_config(home / "config.toml", workers=7)
    monkeypatch.setenv("SYNAPSE_INDEXING__WORKERS", "9")

    settings = Settings(home=home)

    assert settings.indexing.workers == 9


def test_config_init_writes_to_resolved_config_path(
    tmp_path: Path, monkeypatch
) -> None:
    _clear_synapse_env(monkeypatch)
    home = tmp_path / "home"
    config_path = tmp_path / "custom-config" / "config.toml"

    written = write_default_config(home, config_path=config_path)

    assert written == config_path.resolve()
    assert written.is_file()
    monkeypatch.setenv("SYNAPSE_CONFIG", str(written))
    settings = Settings()
    assert settings.resolved_config_path() == written
    assert settings.indexing.workers == 4


def test_cli_config_init_and_show_use_same_path(
    tmp_path: Path, monkeypatch
) -> None:
    from typer.testing import CliRunner

    import synapse.integrations.cli.main as cli

    _clear_synapse_env(monkeypatch)
    home = tmp_path / "home"
    config_path = tmp_path / "custom-config" / "config.toml"
    monkeypatch.setenv("SYNAPSE_HOME", str(home))
    monkeypatch.setenv("SYNAPSE_CONFIG", str(config_path))

    runner = CliRunner()
    initialized = runner.invoke(cli.app, ["config", "init", "--json"])
    shown = runner.invoke(cli.app, ["config", "show", "--json"])

    assert initialized.exit_code == 0, initialized.output
    assert shown.exit_code == 0, shown.output
    assert json.loads(initialized.output)["config_file"] == str(config_path.resolve())
    assert json.loads(shown.output)["config_file"] == str(config_path.resolve())
