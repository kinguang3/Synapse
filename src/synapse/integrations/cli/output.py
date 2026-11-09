from __future__ import annotations

import json
import sys
from typing import Any

from rich.console import Console
from rich.table import Table
from rich.text import Text

console = Console()


def emit_json(data: Any) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=True, indent=2) + "\n")


def print_search(payload: dict[str, Any]) -> None:
    results = payload.get("results", [])
    meta = payload.get("meta", {})
    if not results:
        console.print("[yellow]没有找到匹配结果[/yellow]")
        _print_meta(meta)
        return
    table = Table(show_lines=True, header_style="bold cyan")
    table.add_column("Score", justify="right", width=7)
    table.add_column("Type", width=12)
    table.add_column("Title / Snippet", ratio=1)
    table.add_column("Location", ratio=1)
    table.add_column("Why", width=18)
    for item in results:
        title = Text(item.get("title") or "")
        snippet = item.get("snippet")
        if snippet:
            title.append("\n" + snippet, style="dim")
        location = item.get("path") or ""
        if item.get("start_line"):
            location += f":{item.get('start_line')}"
            if item.get("end_line"):
                location += f"-{item.get('end_line')}"
        table.add_row(
            f"{item.get('score', 0):.3f}",
            item.get("node_type", ""),
            title,
            location,
            ", ".join(item.get("reasons", [])),
        )
    console.print(table)
    _print_meta(meta)


def print_related(payload: dict[str, Any]) -> None:
    node = payload.get("node", {})
    console.print(f"[bold]{node.get('title')}[/bold]  [dim]{node.get('node_id')}[/dim]")
    related = payload.get("related", {})
    found = False
    for category in ("code", "docs", "memory", "other"):
        items = related.get(category) or []
        if not items:
            continue
        found = True
        console.print(f"\n[bold cyan]{category}[/bold cyan]")
        table = Table(show_header=True, header_style="bold")
        table.add_column("Type", width=12)
        table.add_column("Relation", width=14)
        table.add_column("Title", ratio=1)
        table.add_column("Location", ratio=1)
        for item in items:
            location = item.get("path") or ""
            if item.get("start_line"):
                location += f":{item.get('start_line')}"
            table.add_row(
                item.get("node_type", ""),
                f"{item.get('relation_type')} ({item.get('direction')})",
                item.get("title") or "",
                location,
            )
        console.print(table)
    if not found:
        console.print("[yellow]没有关联节点[/yellow]")


def print_context(payload: dict[str, Any]) -> None:
    project = payload.get("project", {})
    console.print(f"[bold]{project.get('name')}[/bold]  [dim]{project.get('root_path')}[/dim]")
    stats = payload.get("stats", {})
    console.print(
        "nodes={nodes} relations={relations} sources={sources}".format(
            nodes=stats.get("nodes", 0),
            relations=stats.get("relations", 0),
            sources=stats.get("sources", 0),
        )
    )
    tech = payload.get("tech_stack") or []
    if tech:
        console.print(f"[cyan]Tech stack:[/cyan] {', '.join(tech)}")
    top_modules = payload.get("top_modules") or []
    if top_modules:
        table = Table(title="Top modules", header_style="bold cyan")
        table.add_column("Type", width=12)
        table.add_column("Title", ratio=1)
        table.add_column("Path", ratio=1)
        table.add_column("Salience", justify="right", width=8)
        for item in top_modules:
            table.add_row(
                item.get("node_type", ""),
                item.get("title") or "",
                item.get("path") or "",
                f"{item.get('salience', 0):.2f}",
            )
        console.print(table)
    decisions = payload.get("decisions") or []
    if decisions:
        console.print("[bold cyan]Decisions[/bold cyan]")
        for item in decisions:
            console.print(f"- {item.get('title')}")
    recent = payload.get("recent_changes") or []
    if recent:
        table = Table(title="Recent changes", header_style="bold cyan")
        table.add_column("Path", ratio=1)
        table.add_column("Updated", width=24)
        for item in recent:
            table.add_row(item.get("path") or "", item.get("updated_at") or "")
        console.print(table)
    console.print(f"[dim]~{payload.get('token_estimate', 0)} tokens[/dim]")


def print_stats(payload: dict[str, Any]) -> None:
    project = payload.get("project", {})
    console.print(f"[bold]{project.get('name')}[/bold]  [dim]{project.get('root_path')}[/dim]")
    last = project.get("last_indexed_at")
    console.print(f"last_indexed_at: {last or '[yellow]never[/yellow]'}")
    stats = payload.get("stats", {})
    table = Table(header_style="bold cyan")
    table.add_column("Metric")
    table.add_column("Value", justify="right")
    for key, value in stats.items():
        if key == "node_types":
            value = ", ".join(f"{name}={count}" for name, count in value.items())
        table.add_row(key, str(value))
    console.print(table)
    run = payload.get("last_run")
    if run:
        console.print(
            f"[dim]last run: {run.get('status')} {run.get('mode')} "
            f"started={run.get('started_at')} finished={run.get('finished_at')}[/dim]"
        )


def _print_meta(meta: dict[str, Any]) -> None:
    if not meta:
        return
    parts = [f"mode={meta.get('mode')}", f"candidates={meta.get('candidates')}"]
    if meta.get("degraded"):
        parts.append("degraded=" + ",".join(meta["degraded"]))
    if meta.get("took_ms") is not None:
        parts.append(f"{meta['took_ms']}ms")
    console.print("[dim]" + "  ".join(parts) + "[/dim]")
