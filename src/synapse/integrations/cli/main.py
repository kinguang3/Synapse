from __future__ import annotations

import contextlib
import sys
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from synapse import __version__
from synapse.bootstrap import Application, build_application
from synapse.config import Settings, write_default_config
from synapse.errors import AmbiguousProject, InvalidArgument, SynapseError
from synapse.integrations.cli.output import (
    console,
    emit_json,
    print_context,
    print_related,
    print_search,
    print_stats,
)

app = typer.Typer(
    help="Local-first knowledge memory and association engine for AI agents.",
    no_args_is_help=True,
    add_completion=False,
)
projects_app = typer.Typer(help="Manage registered projects.", no_args_is_help=True)
config_app = typer.Typer(help="Inspect or initialize configuration.", no_args_is_help=True)
app.add_typer(projects_app, name="projects")
app.add_typer(config_app, name="config")


@app.callback()
def _bootstrap() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            with contextlib.suppress(AttributeError, OSError):
                reconfigure(encoding="utf-8")


def _handle_error(exc: SynapseError, as_json: bool) -> None:
    if as_json:
        emit_json({"error": exc.to_dict()})
    else:
        console.print(f"[red]error:[/red] {exc.message}")
        if exc.details:
            console.print(f"[dim]{exc.details}[/dim]")
    raise typer.Exit(code=1)


def _project_reference(application: Application, reference: str | None) -> str:
    if reference:
        return reference
    projects = application.projects.list()
    if not projects:
        raise InvalidArgument("尚未注册项目，请先运行 synapse projects register")
    if len(projects) == 1:
        return projects[0].id
    cwd = Path.cwd().resolve()
    matches = []
    for project in projects:
        root = Path(project.root_path)
        if cwd == root or root in cwd.parents:
            matches.append(project)
    if matches:
        return max(matches, key=lambda item: len(item.root_path)).id
    slugs = ", ".join(project.slug for project in projects)
    raise AmbiguousProject(f"存在多个项目，请使用 --project 指定: {slugs}")


@app.command()
def version() -> None:
    """Print the Synapse version."""
    console.print(__version__)


@projects_app.command("list")
def projects_list(
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """List registered projects."""
    with build_application() as application:
        items = application.project_tools.list_projects()
    if as_json:
        emit_json(items)
        return
    if not items:
        console.print("[yellow]尚未注册项目[/yellow]")
        return
    table = Table(header_style="bold cyan")
    table.add_column("Slug", width=20)
    table.add_column("Name", ratio=1)
    table.add_column("Root path", ratio=2)
    table.add_column("Last indexed", width=24)
    for item in items:
        table.add_row(
            item["slug"],
            item["name"],
            item["root_path"],
            item.get("last_indexed_at") or "never",
        )
    console.print(table)


@projects_app.command("register")
def projects_register(
    path: str = typer.Argument(".", help="Project root directory."),
    name: str | None = typer.Option(None, "--name", "-n", help="Display name."),
    index: bool = typer.Option(False, "--index", help="Index immediately."),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Register a project directory."""
    try:
        with build_application() as application:
            project = application.project_tools.register(path, name=name)
            stats = None
            if index:
                stats = application.project_tools.index(project["id"])
                project = application.project_tools.register(path, name=name)
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json({**project, "index": stats})
        return
    console.print(f"[green]registered[/green] {project['name']} ({project['slug']})")
    console.print(f"[dim]{project['root_path']}[/dim]")
    if stats:
        console.print(f"[dim]{stats['stats']}[/dim]")


@projects_app.command("status")
def projects_status(
    reference: str | None = typer.Argument(None, help="Project id, slug, or root path."),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Show project status and index statistics."""
    try:
        with build_application() as application:
            payload = application.project_tools.status(
                _project_reference(application, reference)
            )
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json(payload)
    else:
        print_stats(payload)


@app.command()
def index(
    reference: str | None = typer.Argument(None, help="Project id, slug, or root path."),
    full: bool = typer.Option(False, "--full", help="Reparse every file."),
    workers: int | None = typer.Option(None, "--workers", "-w", min=1, max=32),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Index or update a project."""
    try:
        with build_application() as application:
            payload = application.project_tools.index(
                _project_reference(application, reference),
                full=full,
                workers=workers,
            )
    except KeyboardInterrupt:
        console.print("[yellow]index canceled[/yellow]")
        raise typer.Exit(code=130) from None
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json(payload)
        return
    stats = payload["stats"]
    table = Table(header_style="bold cyan")
    table.add_column("Metric")
    table.add_column("Value", justify="right")
    for key, value in stats.items():
        if key == "errors" or isinstance(value, list):
            table.add_row(key, str(len(value)))
        else:
            table.add_row(key, str(value))
    console.print(table)
    errors = stats.get("errors") or []
    if errors:
        console.print("[yellow]errors:[/yellow]")
        for message in errors[:10]:
            console.print(f"- {message}")


@app.command()
def search(
    query: str = typer.Argument(..., help="Search query."),
    project: str | None = typer.Option(None, "--project", "-p", help="Project id or slug."),
    limit: int = typer.Option(10, "--limit", "-l", min=1, max=50),
    mode: str = typer.Option("hybrid", "--mode", help="keyword, hybrid, or semantic."),
    node_types: list[str] | None = typer.Option(None, "--type", help="Node type filter."),
    path_prefix: str | None = typer.Option(None, "--path-prefix", help="Path prefix filter."),
    graph_depth: int | None = typer.Option(None, "--graph-depth", min=0, max=3),
    relation_types: list[str] | None = typer.Option(
        None, "--relation", help="Relation type filter for graph expansion."
    ),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Search knowledge with keyword + graph ranking."""
    try:
        with build_application() as application:
            reference = (
                _project_reference(application, project) if project is not None else None
            )
            payload = application.search_tools.search(
                query,
                project=reference,
                limit=limit,
                mode=mode,
                node_types=node_types,
                path_prefix=path_prefix,
                graph_depth=graph_depth,
                relation_types=relation_types,
            )
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json(payload)
    else:
        print_search(payload)


@app.command()
def related(
    node_id: str = typer.Argument(..., help="Node id."),
    limit: int = typer.Option(20, "--limit", "-l", min=1, max=100),
    relation_types: list[str] | None = typer.Option(None, "--relation"),
    include: list[str] | None = typer.Option(None, "--include", help="code/docs/memory/other."),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """List nodes related to a node."""
    try:
        with build_application() as application:
            payload = application.search_tools.get_related(
                node_id,
                relation_types=relation_types,
                include=include,
                limit=limit,
            )
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json(payload)
    else:
        print_related(payload)


@app.command()
def explore(
    node_id: str = typer.Argument(..., help="Node id."),
    depth: int = typer.Option(2, "--depth", "-d", min=0, max=3),
    direction: str = typer.Option("both", "--direction", help="outgoing, incoming, or both."),
    relation_types: list[str] | None = typer.Option(None, "--relation"),
    limit: int = typer.Option(50, "--limit", "-l", min=1, max=200),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Explore the graph around a node."""
    try:
        with build_application() as application:
            payload = application.search_tools.explore_graph(
                node_id,
                depth=depth,
                direction=direction,
                relation_types=relation_types,
                limit=limit,
            )
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json(payload)
        return
    console.print(
        f"[bold]{len(payload['nodes'])}[/bold] nodes, "
        f"[bold]{len(payload['edges'])}[/bold] edges"
    )
    table = Table(header_style="bold cyan")
    table.add_column("Type", width=12)
    table.add_column("Title", ratio=1)
    table.add_column("Path", ratio=1)
    table.add_column("Node id", width=36)
    for node in payload["nodes"]:
        table.add_row(
            node["node_type"],
            node.get("title") or "",
            node.get("path") or "",
            node["node_id"],
        )
    console.print(table)


@app.command()
def remember(
    project: str = typer.Argument(..., help="Project id, slug, or root path."),
    content: str = typer.Argument(..., help="Memory content, or - to read stdin."),
    title: str | None = typer.Option(None, "--title", "-t"),
    memory_type: str = typer.Option(
        "fact",
        "--type",
        help="fact, experience, decision, preference, or summary.",
    ),
    tags: list[str] | None = typer.Option(None, "--tag"),
    confidence: float = typer.Option(1.0, "--confidence", min=0.0, max=1.0),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Store an explicit memory."""
    if content == "-":
        content = sys.stdin.read()
    try:
        with build_application() as application:
            payload = application.memory_tools.remember(
                _project_reference(application, project),
                content,
                title=title,
                memory_type=memory_type,
                tags=tags,
                confidence=confidence,
            )
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json(payload)
        return
    node = payload["node"]
    console.print(f"[green]stored[/green] {node['node_id']}")
    console.print(f"[bold]{node['title']}[/bold] ({node['memory_type']})")


@app.command()
def recall(
    query: str = typer.Argument(..., help="Memory search query."),
    project: str | None = typer.Option(None, "--project", "-p"),
    limit: int = typer.Option(10, "--limit", "-l", min=1, max=50),
    mode: str = typer.Option("hybrid", "--mode"),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Recall explicit memories."""
    try:
        with build_application() as application:
            reference = (
                _project_reference(application, project) if project is not None else None
            )
            payload = application.memory_tools.recall(
                query,
                project=reference,
                limit=limit,
                mode=mode,
            )
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json(payload)
    else:
        print_search(payload)


@app.command()
def context(
    project: str = typer.Argument(..., help="Project id, slug, or root path."),
    sections: list[str] | None = typer.Option(None, "--section"),
    max_tokens: int = typer.Option(1200, "--max-tokens", min=100, max=20000),
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Build a compact project context for agents."""
    try:
        with build_application() as application:
            payload = application.search_tools.get_context(
                _project_reference(application, project),
                sections=sections,
                max_tokens=max_tokens,
            )
    except SynapseError as exc:
        _handle_error(exc, as_json)
        return
    if as_json:
        emit_json(payload)
    else:
        print_context(payload)


@config_app.command("show")
def config_show(
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Show effective configuration."""
    settings = Settings()
    payload: dict[str, Any] = settings.model_dump(mode="json")
    payload["resolved_home"] = str(settings.resolved_home())
    payload["resolved_db_path"] = str(settings.resolved_db_path())
    payload["config_file"] = str(settings.resolved_config_path())
    if as_json:
        emit_json(payload)
        return
    for key, value in payload.items():
        console.print(f"[cyan]{key}[/cyan] = {value}")


@config_app.command("init")
def config_init(
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Write a default config.toml if missing."""
    settings = Settings()
    path = write_default_config(
        settings.resolved_home(),
        config_path=settings.resolved_config_path(),
    )
    if as_json:
        emit_json({"config_file": str(path)})
    else:
        console.print(f"[green]config[/green] {path}")


@app.command()
def doctor(
    as_json: bool = typer.Option(False, "--json", help="Emit JSON."),
) -> None:
    """Check database and full-text index integrity."""
    with build_application() as application:
        payload: dict[str, Any] = {
            "database_path": str(application.database.path),
            "projects": len(application.projects.list()),
            "integrity": application.database.integrity_check(),
            "fts_integrity": application.database.fts_integrity_check(),
        }
    if as_json:
        emit_json(payload)
        return
    console.print(f"database: [bold]{payload['database_path']}[/bold]")
    console.print(f"projects: {payload['projects']}")
    console.print(f"integrity: {', '.join(payload['integrity'])}")
    console.print(f"fts_integrity: {', '.join(payload['fts_integrity'])}")


if __name__ == "__main__":
    app()
