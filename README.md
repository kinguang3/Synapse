<p align="center">
  <img src="https://raw.githubusercontent.com/kinguang3/Synapse/main/docs/assets/synapse-icon.png" alt="Synapse" width="80">
</p>

<h3 align="center">Local knowledge for AI coding agents.</h3>
<p align="center">Code graph, project context and persistent memory — all on your machine.</p>

<p align="center">
  <a href="#requirements">Requirements</a> ·
  <a href="#one-command-install">Install</a> ·
  <a href="#first-run">First run</a> ·
  <a href="#use-without-the-sidebar">Manual</a> ·
  <a href="#documentation">Docs</a>
</p>

<p align="center">
  <a href="https://pypi.org/project/synapse-knowledge/"><img src="https://img.shields.io/pypi/v/synapse-knowledge?label=PyPI&color=0ab887" alt="PyPI version"></a>
  <a href="https://pypi.org/project/synapse-knowledge/"><img src="https://img.shields.io/pypi/pyversions/synapse-knowledge?color=0ab887" alt="Python versions"></a>
  <a href="https://github.com/kinguang3/Synapse"><img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript"></a>
  <a href="https://github.com/kinguang3/Synapse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kinguang3/Synapse" alt="Apache-2.0 license"></a>
  <a href="https://github.com/kinguang3/Synapse/stargazers"><img src="https://img.shields.io/github/stars/kinguang3/Synapse?color=0ab887" alt="GitHub stars"></a>
</p>

<p align="center"><sub><b>English</b> · <a href="https://github.com/kinguang3/Synapse/blob/main/README.zh-CN.md">简体中文</a></sub></p>

**Local-first, open source, and yours to run.** One SQLite workspace shared by MCP, CLI, GUI and the editor sidebar. No cloud account required.

## Requirements

- Windows 10/11 with PowerShell 5.1+
- [uv](https://docs.astral.sh/uv/)
- VS Code, VS Code Insiders, Trae CN, or Trae for the sidebar

`uv` downloads Python 3.11 automatically. macOS and Linux users can follow the manual steps in [Getting started](https://github.com/kinguang3/Synapse/blob/main/docs/guides/getting-started.md).

## One-command install

```powershell
irm https://github.com/kinguang3/Synapse/releases/latest/download/install.ps1 | iex
```

The installer sets up everything:

- an isolated Synapse runtime at `%LOCALAPPDATA%\Synapse\Synapse\runtime`
- CLI, MCP server, and GUI dependencies in that runtime
- the Synapse Companion sidebar in every detected editor
- MCP client configuration at `%LOCALAPPDATA%\Synapse\Synapse\mcp.json`
- the runtime command directory on your user `PATH`

## First run

1. Restart your editor and terminal.
2. Open **Synapse** from the activity bar. The local GUI service starts automatically.
3. Register and index a project:

```powershell
synapse projects register . --index
```

4. Add the generated `mcp.json` entry to your MCP client.

If the service was stopped manually, run `Synapse: Start Local Service`. To disable automatic startup, set `synapse.autoStartServer` to `false`.

The MCP server is local stdio and is started by your MCP client, not by the sidebar.

## Use without the sidebar

MCP only:

```powershell
uvx --from synapse-knowledge synapse-mcp
```

CLI only:

```powershell
uv tool install synapse-knowledge
synapse config init
synapse doctor
```

For source installs, custom data directories, and manual GUI setup, see [Getting started](https://github.com/kinguang3/Synapse/blob/main/docs/guides/getting-started.md).

## Common commands

```text
synapse projects list
synapse projects register <path> [--name NAME] [--index]
synapse projects status [reference]
synapse index [reference] [--full] [--workers N]
synapse search <query> [--project REF] [--limit N] [--mode keyword|hybrid]
synapse remember <project> <content> [--type TYPE] [--title TITLE] [--tag TAG]
synapse recall <query> [--project REF]
synapse context <project> [--max-tokens N] [--section SECTION] [--query QUERY]
synapse doctor
synapse version
```

## Data location

The default directory is determined by `platformdirs`:

- Windows: `%LOCALAPPDATA%\Synapse\Synapse\`
- Configuration: `<home>\config.toml`
- Database: `<home>\synapse.db`
- Managed runtime: `<home>\runtime`
- Generated MCP config: `<home>\mcp.json`

Override the data directory with `SYNAPSE_HOME`.

## Documentation

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

## License

Apache License 2.0. See [LICENSE](https://github.com/kinguang3/Synapse/blob/main/LICENSE).
