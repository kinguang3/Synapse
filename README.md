<p align="center">
  <img src="https://raw.githubusercontent.com/kinguang3/Synapse/main/docs/assets/synapse-icon.png" alt="Synapse" width="80">
</p>

<h3 align="center">Local knowledge for AI coding agents.</h3>
<p align="center">Code graph, project context and persistent memory — all on your machine.</p>

<p align="center">
  <a href="#install-from-pypi"><b>Install</b></a> ·
  <a href="#highlights">Features</a> ·
  <a href="#mcp-server">MCP</a> ·
  <a href="#common-commands">CLI</a> ·
  <a href="#gui">GUI</a> ·
  <a href="#documentation">Docs</a>
</p>

<p align="center">
  <a href="https://pypi.org/project/synapse-knowledge/"><img src="https://img.shields.io/pypi/v/synapse-knowledge?label=PyPI&color=0ab887" alt="PyPI version"></a>
  <a href="https://pypi.org/project/synapse-knowledge/"><img src="https://img.shields.io/pypi/pyversions/synapse-knowledge?color=0ab887" alt="Python versions"></a>
  <a href="https://github.com/kinguang3/Synapse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kinguang3/Synapse" alt="Apache-2.0 license"></a>
  <a href="https://github.com/kinguang3/Synapse/stargazers"><img src="https://img.shields.io/github/stars/kinguang3/Synapse?color=0ab887" alt="GitHub stars"></a>
</p>

<p align="center"><sub><b>English</b> · <a href="https://github.com/kinguang3/Synapse/blob/main/README.zh-CN.md">简体中文</a></sub></p>

**Local-first, open source, and yours to run.** One SQLite workspace shared by MCP, CLI and GUI. No cloud account required.

## Highlights

- Local-first SQLite knowledge graph with Python/Markdown parsing, FTS5 search, Chinese indexing, reference resolution, graph-expanded retrieval, and crash-safe indexing.
- Local stdio MCP server with 9 project-scoped tools for search, graph exploration, context, and memory.
- CLI for project management, indexing, search, context, and the full memory workflow.
- Optional local GUI for graph exploration, search, memory browsing, context preview, and index management.
- `keyword` and `hybrid` retrieval only; no fake semantic mode.
- Project-level locking prevents concurrent indexing of the same project; interrupted runs recover on the next scan.

Not yet implemented: file watching, embedding/vector retrieval, memory editing/versioning, and cloud sync.

Known limitations: `synapse_recall` returns summaries and snippets, so use `synapse_memory_get` for full memory content and tags; context ranking is lexical/graph-based; and constructor parameter injection is not fully modeled. See [Limitations](https://github.com/kinguang3/Synapse/blob/main/docs/reference/limitations.md).

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) for `uvx` and `uv tool` installation
- Windows 10/11, Linux, or macOS
- SQLite with FTS5 enabled (usually available in the SQLite bundled with Python)

## Install from PyPI

Use `uvx` to run the MCP server without a global install:

```powershell
uvx --from synapse-knowledge synapse-mcp
```

For MCP clients, use this configuration:

```json
{
  "mcpServers": {
    "synapse": {
      "command": "uvx",
      "args": ["--from", "synapse-knowledge", "synapse-mcp"]
    }
  }
}
```

Install the CLI once, then register and index a project:

```powershell
uv tool install synapse-knowledge
synapse config init
synapse doctor
synapse projects register . --index
```

`uvx` uses an isolated cache and does not modify your project. Projects, configuration, and memories stay under `SYNAPSE_HOME` or the platform default directory, so package upgrades do not delete data.

## From source (Windows PowerShell)

```powershell
cd C:\path\to\Synapse
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -e ".[dev]"
synapse config init
synapse projects register . --index
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

The recommended configuration is shown in [Install from PyPI](#install-from-pypi). Add `env.SYNAPSE_HOME` only when you need a custom data directory.

For a source checkout, use `synapse-mcp` or `python -m synapse.integrations.mcp`. This is a local stdio server and does not listen on a port.

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

All project-scoped tools require a registered project. `synapse_remember` writes to the local SQLite database; the other tools are read-only. Use `synapse_recall` to find a memory, then `synapse_memory_get` with its `node_id` to read the full content and tags. stdout carries only MCP JSON-RPC, while logs go to stderr. See the [MCP documentation](https://github.com/kinguang3/Synapse/blob/main/docs/reference/mcp.md).

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

Override these paths with `SYNAPSE_HOME` and `SYNAPSE_CONFIG`. See the [configuration documentation](https://github.com/kinguang3/Synapse/blob/main/docs/guides/configuration.md).

## Documentation

The detailed documentation is currently written in Chinese. Start from the [documentation index](https://github.com/kinguang3/Synapse/blob/main/docs/README.md).

- [Getting started](https://github.com/kinguang3/Synapse/blob/main/docs/guides/getting-started.md)
- [Configuration](https://github.com/kinguang3/Synapse/blob/main/docs/guides/configuration.md)
- [Development and testing](https://github.com/kinguang3/Synapse/blob/main/docs/guides/development.md)
- [Architecture](https://github.com/kinguang3/Synapse/blob/main/docs/architecture/overview.md)
- [CLI](https://github.com/kinguang3/Synapse/blob/main/docs/reference/cli.md)
- [MCP Server](https://github.com/kinguang3/Synapse/blob/main/docs/reference/mcp.md)
- [Data model](https://github.com/kinguang3/Synapse/blob/main/docs/reference/data-model.md)
- [Limitations](https://github.com/kinguang3/Synapse/blob/main/docs/reference/limitations.md)

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
