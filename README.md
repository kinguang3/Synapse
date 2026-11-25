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
- A VS Code-compatible editor for the sidebar

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

Opening the sidebar starts the service only when it is not already healthy, then waits for the health check before loading projects. If it still shows offline, run `Synapse: Start Local Service` and check the Synapse output channel. To disable automatic startup, set `synapse.autoStartServer` to `false`. To tune graph spacing, set `synapse.graphNodeDistance` (40-200, default 68).

The MCP server is local stdio and is started by your MCP client, not by the sidebar.

## Manual GUI and custom paths

### Start the GUI manually

The sidebar starts the GUI automatically. To use the browser UI instead, run this for a default install:

```powershell
& "$env:LOCALAPPDATA\Synapse\Synapse\runtime\Scripts\python.exe" -m synapse.integrations.gui
```

If you set a custom `SYNAPSE_HOME`, replace the path with `<SYNAPSE_HOME>\runtime\Scripts\python.exe`.

Open `http://127.0.0.1:8765/` and enter the token printed in the terminal. For a fixed token, set it before starting:

```powershell
$env:SYNAPSE_GUI_TOKEN = "your-long-token"
& "$env:LOCALAPPDATA\Synapse\Synapse\runtime\Scripts\python.exe" -m synapse.integrations.gui
```

### Use a custom path

The simplest way is to set `SYNAPSE_HOME` before the one-command install:

```powershell
$env:SYNAPSE_HOME = "D:\SynapseData"
irm https://github.com/kinguang3/Synapse/releases/latest/download/install.ps1 | iex
```

The runtime, database, and `mcp.json` all go under `D:\SynapseData`. Set the same `SYNAPSE_HOME` when starting the GUI or using the CLI. For permanent use, make it a user environment variable and reopen the terminal.

To change only the runtime directory, download the installer and pass `-RuntimePath`:

```powershell
$installer = Join-Path $env:TEMP "synapse-install.ps1"
irm https://github.com/kinguang3/Synapse/releases/latest/download/install.ps1 -OutFile $installer
& $installer -RuntimePath "D:\Synapse\runtime"
```

If the runtime is outside `<SYNAPSE_HOME>\runtime`, set `synapse.pythonPath` in the editor to `<runtime>\Scripts\python.exe` so the sidebar can auto-start it.

Other options: `-Editor`, `-VsixPath`, `-UvPath`, `-Version`, `-NoPath`, `-Force`, `-DryRun`.

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

## Agent skill

The repository includes an official agent skill in `skills/synapse`. It teaches agents when to use Synapse MCP tools or the CLI, with references for both interfaces.

Install it into the current project's `.opencode/skills` directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\synapse\scripts\install.ps1
```

Use `-Scope User` for the user-level opencode skills directory, or `-Scope Custom -Target <path>` for another location. The skill does not start a service or register MCP automatically; configure MCP as described in [Getting started](https://github.com/kinguang3/Synapse/blob/main/docs/guides/getting-started.md). See [Agent skill](https://github.com/kinguang3/Synapse/blob/main/docs/reference/skill.md).

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
- [Agent skill](https://github.com/kinguang3/Synapse/blob/main/docs/reference/skill.md)
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
