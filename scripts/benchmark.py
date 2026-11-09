from __future__ import annotations

import argparse
import json
import os
import platform
import sqlite3
import statistics
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(_ROOT / "src"))

from synapse import __version__  # noqa: E402
from synapse.bootstrap import build_application  # noqa: E402
from synapse.config import Settings  # noqa: E402


def _timed_index(application: Any, project_id: str, *, full: bool, workers: int) -> dict[str, Any]:
    started = time.perf_counter()
    payload = application.project_tools.index(project_id, full=full, workers=workers)
    elapsed_ms = (time.perf_counter() - started) * 1000
    stats = payload["stats"]
    return {
        "wall_ms": round(elapsed_ms, 3),
        "stats": stats,
    }


def _database_bytes(application: Any) -> int:
    application.database.connect().execute("PRAGMA wal_checkpoint(TRUNCATE)")
    path = application.database.path
    total = 0
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(str(path) + suffix)
        if candidate.exists():
            total += candidate.stat().st_size
    return total


def _run_once(project: Path, *, workers: int) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="synapse-benchmark-") as temp:
        home = Path(temp) / "home"
        settings = Settings(home=home, indexing={"workers": workers})
        with build_application(settings) as application:
            project_id = application.project_tools.register(str(project))["id"]
            cold = _timed_index(application, project_id, full=False, workers=workers)
            warm = _timed_index(application, project_id, full=False, workers=workers)
            full = _timed_index(application, project_id, full=True, workers=workers)
            status = application.project_tools.status(project_id)["stats"]
            db_size = _database_bytes(application)
        return {
            "cold": cold,
            "warm_incremental": warm,
            "full": full,
            "project_stats": status,
            "database_bytes": db_size,
        }


def _aggregate(runs: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in ("cold", "warm_incremental", "full"):
        values = [float(run[key]["wall_ms"]) for run in runs]
        result[key] = {
            "median_ms": round(statistics.median(values), 3),
            "min_ms": round(min(values), 3),
            "max_ms": round(max(values), 3),
        }
    first = runs[0]
    result["project_stats"] = first["project_stats"]
    result["cold_stats"] = first["cold"]["stats"]
    result["database_bytes"] = first["database_bytes"]
    result["failed"] = sum(int(run["cold"]["stats"].get("failed", 0)) for run in runs)
    return result


def _environment() -> dict[str, Any]:
    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "synapse_version": __version__,
        "python": platform.python_version(),
        "sqlite": sqlite3.sqlite_version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpu_count": os.cpu_count(),
        "cwd": str(Path.cwd()),
    }


def _markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Synapse Benchmark",
        "",
        f"- Generated: {payload['environment']['generated_at']}",
        f"- Synapse: {payload['environment']['synapse_version']}",
        f"- Python: {payload['environment']['python']}",
        f"- SQLite: {payload['environment']['sqlite']}",
        f"- Platform: {payload['environment']['platform']}",
        f"- CPU count: {payload['environment']['cpu_count']}",
        f"- Runs per dataset: {payload['runs']}",
        f"- Workers: {payload['workers']}",
        "",
        "| Dataset | Files | Nodes | Relations | DB bytes | Cold ms | Warm ms | Full ms | Failed |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for dataset in payload["datasets"]:
        summary = dataset["summary"]
        stats = summary["project_stats"]
        lines.append(
            "| {name} | {files} | {nodes} | {relations} | {db} | {cold} | {warm} | {full} | {failed} |".format(
                name=dataset["name"],
                files=summary["cold_stats"].get("scanned", 0),
                nodes=stats.get("nodes", 0),
                relations=stats.get("relations", 0),
                db=summary["database_bytes"],
                cold=summary["cold"]["median_ms"],
                warm=summary["warm_incremental"]["median_ms"],
                full=summary["full"]["median_ms"],
                failed=summary["failed"],
            )
        )
    lines.extend(
        [
            "",
            "Cold = first index in a fresh database. Warm = immediate no-change incremental index.",
            "Full = reparse every scanned file. Each run uses a fresh temporary database.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run reproducible Synapse index benchmarks.")
    parser.add_argument(
        "--project",
        action="append",
        required=True,
        help="Authorized project root; repeat for multiple datasets.",
    )
    parser.add_argument("--runs", type=int, default=3, help="Fresh-database runs per dataset.")
    parser.add_argument("--workers", type=int, default=4, help="Parser workers.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("benchmarks/results"),
        help="Directory for JSON and Markdown output.",
    )
    args = parser.parse_args()

    if args.runs < 1:
        parser.error("--runs must be >= 1")
    if args.workers < 1 or args.workers > 32:
        parser.error("--workers must be between 1 and 32")

    projects = [Path(value).expanduser().resolve() for value in args.project]
    for project in projects:
        if not project.is_dir():
            parser.error(f"project directory does not exist: {project}")

    datasets: list[dict[str, Any]] = []
    for project in projects:
        runs = [_run_once(project, workers=args.workers) for _ in range(args.runs)]
        datasets.append(
            {
                "name": project.name,
                "path": str(project),
                "summary": _aggregate(runs),
                "runs": runs,
            }
        )

    payload = {
        "environment": _environment(),
        "runs": args.runs,
        "workers": args.workers,
        "datasets": datasets,
    }

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    json_path = output_dir / f"benchmark-{stamp}.json"
    markdown_path = output_dir / f"benchmark-{stamp}.md"
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    markdown_path.write_text(_markdown(payload), encoding="utf-8")
    print(str(json_path))
    print(str(markdown_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
