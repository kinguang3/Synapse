from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from synapse.core.clock import utc_now_iso
from synapse.core.hashing import sha256_text
from synapse.errors import StorageError

if TYPE_CHECKING:
    from synapse.storage.sqlite.database import Database

_SCHEMA_DIR = Path(__file__).resolve().parent / "schema"


class MigrationRunner:
    def __init__(self, database: Database, schema_dir: Path | None = None) -> None:
        self._database = database
        self._schema_dir = schema_dir or _SCHEMA_DIR

    def apply_all(self) -> list[int]:
        connection = self._database.connect()
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version    INTEGER PRIMARY KEY,
              name       TEXT NOT NULL,
              checksum   TEXT NOT NULL,
              applied_at TEXT NOT NULL
            )
            """
        )
        applied = {
            int(row["version"]): row
            for row in connection.execute("SELECT * FROM schema_migrations").fetchall()
        }
        applied_now: list[int] = []
        for path in sorted(self._schema_dir.glob("*.sql")):
            version = int(path.name.split("_", 1)[0])
            sql = path.read_text(encoding="utf-8")
            checksum = sha256_text(sql)
            if version in applied:
                if applied[version]["checksum"] != checksum:
                    raise StorageError(
                        f"迁移校验失败: {path.name}",
                        details={"version": version},
                    )
                continue
            connection.executescript(sql)
            connection.execute(
                "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES(?,?,?,?)",
                (version, path.name, checksum, utc_now_iso()),
            )
            applied_now.append(version)
        return applied_now

    def applied_versions(self) -> list[int]:
        connection = self._database.connect()
        rows = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        ).fetchall()
        return [int(row["version"]) for row in rows]
