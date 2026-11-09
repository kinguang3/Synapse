# Synapse

English | [简体中文](README.zh-CN.md)

Synapse is a local-first code and knowledge association engine. It stores projects, source code, documentation, explicit memories, and their relationships in SQLite, giving AI agents searchable and explainable local context.

## Status

- Phase 1: a working local knowledge engine.
- Phase 1.5: configuration, project-level index locking, FTS fallback, Source/node transaction consistency, crash recovery, boundary tests, documentation, and benchmarks.
- Phase 2.1: a local stdio MCP Server with 8 project-scoped retrieval and memory tools.
- Phase 2.1.1: discovery of all 8 tools and A-F E2E validation in a real Trae session.
- Phase 2.2.1: `synapse_memory_get` retrieves the full content and metadata of a recalled memory.
- Not yet implemented: HTTP API, file watching, and embedding/vector retrieval.

`semantic` mode is not true vector semantic retrieval; it returns `degraded=["semantic_unavailable"]` and falls back to lexical retrieval.

Known limitations: `synapse_recall` returns summaries and snippets, so callers must use `synapse_memory_get` for full memory content and tags; `synapse_context` has skewed module coverage; and the knowledge graph does not fully model constructor parameter injection. See [Limitations](docs/limitations.md), the [Phase 2.1.1 report](docs/phase-2.1.1-report.md), and the [Phase 2.2.1 report](docs/phase-2.2.1-report.md).

## Features

- Python AST parsing (tree-sitter) and structural Markdown parsing.
- File-level node fallback for other common text formats.
- SQLite + FTS5 full-text search, including Chinese unigram/bigram indexing.
- Code reference resolution, cross-file relationships, and graph-expanded retrieval.
- Project context compression that trims optional sections to a token budget.
- Explicit memory types: `fact`, `experience`, `decision`, `preference`, and `summary`.
- Project-level FileLock to prevent concurrent indexing of the same project.
- After a process crash, interrupted index runs are marked, unfinished tasks are cancelled, and the next scan safely rebuilds.
- Local stdio MCP Server that reuses the same Core, configuration, and data directory.
- MCP exposes only `keyword` / `hybrid` retrieval by default, rather than presenting unavailable semantic retrieval as implemented.
- MCP tools enforce project scope and validate node ownership to prevent cross-project reads.

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
synapse search <query> [--project REF] [--limit N] [--mode keyword|hybrid|semantic]
synapse related <node_id>
synapse explore <node_id> [--depth N] [--direction outgoing|incoming|both]
synapse remember <project> <content> [--type TYPE] [--title TITLE] [--tag TAG]
synapse recall <query> [--project REF]
synapse context <project> [--max-tokens N] [--section SECTION]
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

All project-scoped tools require a registered project. `synapse_remember` writes to the local SQLite database; the other tools are read-only. Use `synapse_recall` to find a memory, then `synapse_memory_get` with its `node_id` to read the full content and tags. stdout carries only MCP JSON-RPC, while logs go to stderr. See the [MCP documentation](docs/mcp.md).

## Data location

The default directory is determined by `platformdirs`:

- Windows: `%LOCALAPPDATA%\Synapse\Synapse\`
- Configuration: `<home>\config.toml`
- Database: `<home>\synapse.db`
- Lock files: `<home>\locks\index-<project_id>.lock`

Override these paths with `SYNAPSE_HOME` and `SYNAPSE_CONFIG`. See the [configuration documentation](docs/configuration.md).

## Documentation

The detailed documentation is currently written in Chinese:

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [CLI](docs/cli.md)
- [Configuration](docs/configuration.md)
- [Data model](docs/data-model.md)
- [MCP Server](docs/mcp.md)
- [Limitations](docs/limitations.md)
- [Development and testing](docs/development.md)
- [Phase 1.5 report](docs/phase-1.5-report.md)
- [Phase 2.1 report](docs/phase-2.1-report.md)
- [Phase 2.1.1 real Trae E2E report](docs/phase-2.1.1-report.md)
- [Phase 2.2.1 memory retrieval report](docs/phase-2.2.1-report.md)

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
