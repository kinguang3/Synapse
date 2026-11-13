# Synapse

English | [简体中文](README.zh-CN.md)

Synapse is a local-first MCP service that gives AI coding agents a structured code knowledge graph, project context retrieval, and persistent project memory. It stores projects, source code, documentation, explicit memories, and their relationships in SQLite, and exposes the same knowledge through MCP, CLI, and a local GUI.

## Status

- Phase 1: a working local knowledge engine.
- Phase 1.5: configuration, project-level index locking, FTS fallback, Source/node transaction consistency, crash recovery, boundary tests, documentation, and benchmarks.
- Phase 2.1: a local stdio MCP Server with 8 project-scoped retrieval and memory tools.
- Phase 2.1.1: discovery of all 8 tools and A-F E2E validation in a real Trae session.
- Phase 2.2.1: `synapse_memory_get` retrieves the full content and metadata of a recalled memory, bringing the MCP tool count to 9.
- Phase 2.2.2: query-aware context module selection, structural overview, path deduplication, and token-budget trimming.
- Phase 3.0: knowledge-graph GUI architecture design completed.
- Phase 3.1: read-only local GUI API and static knowledge workspace (Overview, Knowledge Graph, Search, Memory, Context, Indexing), reusing the same Core and SQLite database.
- Phase 3.2.1: corrected Memory list type/query filtering, pagination, and exact totals, and added GUI API contract regression tests.
- Phase 3.2.2: connected server-side Memory pagination to the GUI with keyword/type filters, exact totals, stale-response protection, and responsive pager controls.
- Capability boundaries are aligned: MCP, CLI, and GUI expose only `keyword` / `hybrid` retrieval; `synapse memory-get` completes the CLI memory loop.
- Not yet implemented: file watching, embedding/vector retrieval, memory editing/versioning, and cloud sync.

`semantic` is not true vector semantic retrieval and is not exposed by any entrypoint; there is no embedding model or vector index yet.

Known limitations: `synapse_recall` returns summaries and snippets, so callers must use `synapse_memory_get` for full memory content and tags; context ranking is lexical/graph-based rather than semantic; and the knowledge graph does not fully model constructor parameter injection. See [Limitations](docs/reference/limitations.md).

## Features

- Python AST parsing (tree-sitter) and structural Markdown parsing.
- File-level node fallback for other common text formats.
- SQLite + FTS5 full-text search, including Chinese unigram/bigram indexing.
- Code reference resolution, cross-file relationships, and graph-expanded retrieval.
- Query-aware project context that ranks relevant modules, covers distinct paths, and trims optional sections to a token budget.
- Explicit memory types: `fact`, `experience`, `decision`, `preference`, and `summary`.
- Memory list API with project/type/query filters, `limit` / `offset` pagination, and exact filtered totals.
- GUI Memory browser with 20-row server-side pages, exact range/total display, keyword and type filters, and stale-response protection.
- Project-level FileLock to prevent concurrent indexing of the same project.
- After a process crash, interrupted index runs are marked, unfinished tasks are cancelled, and the next scan safely rebuilds.
- Local stdio MCP Server that reuses the same Core, configuration, and data directory.
- MCP exposes only `keyword` / `hybrid` retrieval by default, rather than presenting unavailable semantic retrieval as implemented.
- MCP tools enforce project scope and validate node ownership to prevent cross-project reads.
- Local GUI workspace for graph exploration, search, memory inspection, context preview, and index status/trigger; it talks to the same Core and never opens SQLite directly.

## Requirements

- Python 3.11+
- Windows 10/11, Linux, or macOS
- SQLite with FTS5 enabled (usually available in the SQLite bundled with Python)

## Quick start (Windows PowerShell)

```powershell
cd C:\path\to\Synapse
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -e ".[dev]"
```

Initialize configuration and check the environment:

```powershell
synapse config init
synapse doctor
```

Register and index a project:

```powershell
synapse projects register . --index
synapse projects status
```

Search and build context:

```powershell
synapse search "ContextBuilder" --limit 5
synapse context . --max-tokens 1200
synapse context . --query "retrieval module" --max-tokens 700
```

Store and recall explicit memories:

```powershell
synapse remember . "Use SQLite FTS5 for local retrieval." --type decision --title "Use FTS5"
synapse recall "FTS5" --limit 5
```

Query, indexing, memory, and project-management commands support `--json` for agents and scripts; `version` prints plain text only.

## Common commands

```text
synapse projects list
synapse projects register <path> [--name NAME] [--index]
synapse projects status [reference]
synapse index [reference] [--full] [--workers N]
synapse search <query> [--project REF] [--limit N] [--mode keyword|hybrid]
synapse related <node_id>
synapse explore <node_id> [--depth N] [--direction outgoing|incoming|both]
synapse remember <project> <content> [--type TYPE] [--title TITLE] [--tag TAG]
synapse recall <query> [--project REF]
synapse memory-get <node_id> [--project REF]
synapse context <project> [--max-tokens N] [--section SECTION] [--query QUERY]
synapse config show
synapse config init
synapse doctor
synapse version
```

## MCP Server

After installation, use the `synapse-mcp` entry point or start the server as a module:

```powershell
synapse-mcp
python -m synapse.integrations.mcp
```

This is a local stdio MCP Server and does not listen on a port. Example configuration for an external agent:

```json
{
  "mcpServers": {
    "synapse": {
      "command": "C:\\path\\to\\Synapse\\.venv\\Scripts\\synapse-mcp.exe",
      "args": [],
      "env": {
        "SYNAPSE_HOME": "C:\\path\\to\\synapse-home"
      }
    }
  }
}
```

Available tools:

- `synapse_projects_list`
- `synapse_project_status`
- `synapse_search`
- `synapse_related`
- `synapse_explore_graph`
- `synapse_context`
- `synapse_remember`
- `synapse_recall`
- `synapse_memory_get`

All project-scoped tools require a registered project. `synapse_remember` writes to the local SQLite database; the other tools are read-only. Use `synapse_recall` to find a memory, then `synapse_memory_get` with its `node_id` to read the full content and tags. stdout carries only MCP JSON-RPC, while logs go to stderr. See the [MCP documentation](docs/reference/mcp.md).

## GUI

A local knowledge workspace for developers is included as an optional extra:

```powershell
python -m pip install -e ".[gui]"
python -m synapse.integrations.gui --port 8765
```

Open `http://127.0.0.1:8765/` and connect with the access token printed by the server, or set `SYNAPSE_GUI_TOKEN` before starting it. The GUI reads the same `<home>/synapse.db` as MCP and CLI and never opens SQLite directly.

- Pages: Overview, Knowledge Graph, Search, Memory, Context, Indexing.
- Knowledge edits are not implemented yet; the Indexing page can start an index run through the same Core and project-level lock.
- Requests require a local bearer token and pass Host/Origin checks.

## Data location

The default directory is determined by `platformdirs`:

- Windows: `%LOCALAPPDATA%\Synapse\Synapse\`
- Configuration: `<home>\config.toml`
- Database: `<home>\synapse.db`
- Lock files: `<home>\locks\index-<project_id>.lock`

Override these paths with `SYNAPSE_HOME` and `SYNAPSE_CONFIG`. See the [configuration documentation](docs/guides/configuration.md).

## Documentation

The detailed documentation is currently written in Chinese. Start from the [documentation index](docs/README.md).

- [Getting started](docs/guides/getting-started.md)
- [Configuration](docs/guides/configuration.md)
- [Development and testing](docs/guides/development.md)
- [Architecture](docs/architecture/overview.md)
- [CLI](docs/reference/cli.md)
- [MCP Server](docs/reference/mcp.md)
- [Data model](docs/reference/data-model.md)
- [Limitations](docs/reference/limitations.md)

## Development

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
```

Performance benchmark:

```powershell
.\.venv\Scripts\python.exe scripts\benchmark.py --project . --runs 3
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
