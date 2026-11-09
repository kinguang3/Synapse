from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    TomlConfigSettingsSource,
)

from synapse.core.paths import default_home


def _resolved_path(value: str | Path) -> Path:
    return Path(value).expanduser().resolve()


def resolve_home(init_home: str | Path | None = None) -> Path:
    if init_home is not None:
        return _resolved_path(init_home)
    env_home = os.environ.get("SYNAPSE_HOME")
    if env_home:
        return _resolved_path(env_home)
    return _resolved_path(default_home())


def resolve_config_path(
    *,
    init_home: str | Path | None = None,
    config_file: str | Path | None = None,
) -> Path:
    explicit = config_file or os.environ.get("SYNAPSE_CONFIG")
    if explicit:
        return _resolved_path(explicit)
    return resolve_home(init_home) / "config.toml"


def _init_home(init_settings: PydanticBaseSettingsSource) -> Path | None:
    init_kwargs = getattr(init_settings, "init_kwargs", None)
    if not isinstance(init_kwargs, dict):
        return None
    value = init_kwargs.get("home")
    return Path(value) if value is not None else None


class StorageSettings(BaseModel):
    path: Path | None = None
    busy_timeout_ms: int = Field(default=5000, ge=0)
    wal: bool = True


class IndexingSettings(BaseModel):
    max_file_bytes: int = Field(default=2_000_000, ge=1024)
    max_search_text_chars: int = Field(default=200_000, ge=1024)
    workers: int = Field(default=4, ge=1, le=32)
    lock_timeout_seconds: float = Field(default=30.0, ge=0.0)
    follow_symlinks: bool = False
    verify_content_hashes: bool = False
    extra_include_suffixes: list[str] = Field(default_factory=list)


class RetrievalSettings(BaseModel):
    default_limit: int = Field(default=10, ge=1, le=50)
    graph_expand: bool = True
    graph_depth: int = Field(default=1, ge=0, le=3)
    max_graph_nodes: int = Field(default=200, ge=1)
    max_neighbors_per_node: int = Field(default=8, ge=1)
    weight_lexical: float = 0.60
    weight_graph: float = 0.20
    weight_recency: float = 0.08
    weight_importance: float = 0.07
    weight_confidence: float = 0.05


class LoggingSettings(BaseModel):
    level: str = "INFO"
    format: str = "json"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SYNAPSE_",
        env_nested_delimiter="__",
        extra="ignore",
    )

    home: Path = Field(default_factory=default_home)
    database_path: Path | None = None
    storage: StorageSettings = Field(default_factory=StorageSettings)
    indexing: IndexingSettings = Field(default_factory=IndexingSettings)
    retrieval: RetrievalSettings = Field(default_factory=RetrievalSettings)
    logging: LoggingSettings = Field(default_factory=LoggingSettings)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        config_path = resolve_config_path(init_home=_init_home(init_settings))
        sources: list[PydanticBaseSettingsSource] = [init_settings, env_settings]
        if config_path.is_file():
            sources.append(
                TomlConfigSettingsSource(settings_cls, toml_file=config_path)
            )
        sources.append(file_secret_settings)
        return tuple(sources)

    def resolved_home(self) -> Path:
        return _resolved_path(self.home)

    def resolved_config_path(self) -> Path:
        return resolve_config_path(init_home=self.home)

    def resolved_db_path(self) -> Path:
        if self.database_path is not None:
            return Path(self.database_path).expanduser().resolve()
        if self.storage.path is not None:
            return Path(self.storage.path).expanduser().resolve()
        return self.resolved_home() / "synapse.db"


DEFAULT_CONFIG = """\
home = "{home}"

[storage]
busy_timeout_ms = 5000
wal = true

[indexing]
max_file_bytes = 2000000
max_search_text_chars = 200000
workers = 4
lock_timeout_seconds = 30.0
follow_symlinks = false
verify_content_hashes = false
extra_include_suffixes = []

[retrieval]
default_limit = 10
graph_expand = true
graph_depth = 1
max_graph_nodes = 200
max_neighbors_per_node = 8
weight_lexical = 0.60
weight_graph = 0.20
weight_recency = 0.08
weight_importance = 0.07
weight_confidence = 0.05

[logging]
level = "INFO"
format = "json"
"""


def write_default_config(home: Path, *, config_path: Path | None = None) -> Path:
    home = _resolved_path(home)
    path = _resolved_path(config_path) if config_path else resolve_config_path(init_home=home)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(
            DEFAULT_CONFIG.format(home=str(home).replace("\\", "\\\\")),
            encoding="utf-8",
        )
    return path


def load_settings() -> Settings:
    return Settings()
