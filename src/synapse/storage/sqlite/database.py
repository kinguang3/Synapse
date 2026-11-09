from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from synapse.errors import StorageError
from synapse.storage.sqlite.migrations import MigrationRunner


class Database:
    def __init__(
        self,
        path: str | Path,
        *,
        busy_timeout_ms: int = 5000,
        wal: bool = True,
    ) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._busy_timeout_ms = busy_timeout_ms
        self._wal = wal
        self._local = threading.local()
        self._write_lock = threading.RLock()

    def _new_connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            str(self.path),
            timeout=self._busy_timeout_ms / 1000.0,
            isolation_level=None,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(f"PRAGMA busy_timeout = {self._busy_timeout_ms}")
        connection.execute("PRAGMA temp_store = MEMORY")
        if self._wal:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
        return connection

    def connect(self) -> sqlite3.Connection:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = self._new_connection()
            self._local.connection = connection
        return connection

    @contextmanager
    def transaction(self, *, write: bool = True) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        if not write:
            yield connection
            return
        with self._write_lock:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
            except BaseException:
                connection.execute("ROLLBACK")
                raise
            else:
                connection.execute("COMMIT")

    def initialize(self) -> list[int]:
        applied = MigrationRunner(self).apply_all()
        self.connect().execute("PRAGMA user_version = 1")
        return applied

    def integrity_check(self) -> list[str]:
        rows = self.connect().execute("PRAGMA integrity_check").fetchall()
        return [str(row[0]) for row in rows]

    def fts_integrity_check(self) -> list[str]:
        try:
            rows = self.connect().execute(
                "INSERT INTO node_fts(node_fts) VALUES('integrity-check')"
            ).fetchall()
            return [str(row[0]) for row in rows] or ["ok"]
        except sqlite3.DatabaseError as exc:
            return [str(exc)]

    def backup(self, destination: str | Path) -> Path:
        target = Path(destination).expanduser().resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise StorageError(f"备份目标已存在: {target}")
        try:
            self.connect().execute("VACUUM INTO ?", (str(target),))
        except sqlite3.DatabaseError:
            escaped = str(target).replace("'", "''")
            self.connect().execute(f"VACUUM INTO '{escaped}'")
        return target

    def close(self) -> None:
        connection = getattr(self._local, "connection", None)
        if connection is not None:
            connection.close()
            self._local.connection = None
