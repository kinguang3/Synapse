<p align="center">
  <img src="https://raw.githubusercontent.com/kinguang3/Synapse/main/docs/assets/synapse-icon.png" alt="Synapse" width="80">
</p>

<h3 align="center">为 AI 编程助手提供本地知识。</h3>
<p align="center">代码图谱、项目上下文与持久记忆，全部运行在你的电脑上。</p>

<p align="center">
  <a href="#从-pypi-安装"><b>安装</b></a> ·
  <a href="#核心特性">特性</a> ·
  <a href="#mcp-server">MCP</a> ·
  <a href="#常用命令">CLI</a> ·
  <a href="#gui">GUI</a> ·
  <a href="#编辑器侧边栏">侧边栏</a> ·
  <a href="#文档">文档</a>
</p>

<p align="center">
  <a href="https://pypi.org/project/synapse-knowledge/"><img src="https://img.shields.io/pypi/v/synapse-knowledge?label=PyPI&color=0ab887" alt="PyPI 版本"></a>
  <a href="https://pypi.org/project/synapse-knowledge/"><img src="https://img.shields.io/pypi/pyversions/synapse-knowledge?color=0ab887" alt="Python 版本"></a>
  <a href="https://github.com/kinguang3/Synapse"><img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript"></a>
  <a href="https://github.com/kinguang3/Synapse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kinguang3/Synapse" alt="Apache-2.0 许可证"></a>
  <a href="https://github.com/kinguang3/Synapse/stargazers"><img src="https://img.shields.io/github/stars/kinguang3/Synapse?color=0ab887" alt="GitHub Stars"></a>
</p>

<p align="center"><sub><a href="https://github.com/kinguang3/Synapse/blob/main/README.md">English</a> · <b>简体中文</b></sub></p>

**本地优先、开源、完全属于你。** 一个 SQLite 工作区，同时服务 MCP、CLI 与 GUI，无需云账号。

## 核心特性

- 本地优先的 SQLite 知识图谱：Python/Markdown 解析、FTS5 检索、中文索引、引用解析、图扩展检索和崩溃安全索引。
- 本地 stdio MCP Server：提供 9 个项目作用域工具，覆盖检索、图探索、上下文和记忆。
- CLI：覆盖项目管理、索引、检索、上下文和完整记忆流程。
- 可选本地 GUI：支持图探索、检索、记忆浏览、上下文预览和索引管理。
- 只提供 `keyword` 与 `hybrid` 检索，不伪装不可用的语义模式。
- 项目级锁避免同一项目并发索引；中断的索引会在下次扫描时安全恢复。

尚未实现：文件监听、Embedding/向量检索、记忆编辑/版本管理、云同步。

已知限制：`synapse_recall` 只返回 summary 和 snippet，完整正文与 tags 需通过 `synapse_memory_get` 读取；上下文排序基于词法与图关系；构造函数参数注入尚未完整建模。详见 [限制与边界](https://github.com/kinguang3/Synapse/blob/main/docs/reference/limitations.md)。

## 环境要求

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)（用于 `uvx` 和 `uv tool` 安装）
- Windows 10/11、Linux 或 macOS
- SQLite 需启用 FTS5（随 Python 自带 SQLite 通常可用）

## 从 PyPI 安装

使用 `uvx` 直接运行 MCP Server，无需全局安装：

```powershell
uvx --from synapse-knowledge synapse-mcp
```

MCP Client 配置：

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

安装一次 CLI，然后注册并索引项目：

```powershell
uv tool install synapse-knowledge
synapse config init
synapse doctor
synapse projects register . --index
```

`uvx` 使用隔离缓存，不会修改当前项目。项目、配置和记忆保存在 `SYNAPSE_HOME` 或平台默认目录中，升级包不会删除数据。

## 从源码运行（Windows PowerShell）

```powershell
cd C:\path\to\Synapse
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -e ".[dev]"
synapse config init
synapse projects register . --index
```

查询、索引、记忆和项目管理命令都支持 `--json`，便于 Agent 或脚本调用；`version` 仅输出纯文本。

## 常用命令

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

推荐配置见 [从 PyPI 安装](#从-pypi-安装)。只有需要自定义数据目录时才添加 `env.SYNAPSE_HOME`。

从源码运行时，使用 `synapse-mcp` 或 `python -m synapse.integrations.mcp`。这是本地 stdio Server，不监听端口。

可用工具：

- `synapse_projects_list`
- `synapse_project_status`
- `synapse_search`
- `synapse_related`
- `synapse_explore_graph`
- `synapse_context`
- `synapse_remember`
- `synapse_recall`
- `synapse_memory_get`

所有项目级工具都必须传已注册项目。`synapse_remember` 会写入本地 SQLite，其他工具只读。推荐先用 `synapse_recall` 找到记忆，再用 `synapse_memory_get` 读取完整正文和 tags。stdout 只输出 MCP JSON-RPC，日志写入 stderr。详见 [MCP 文档](https://github.com/kinguang3/Synapse/blob/main/docs/reference/mcp.md)。

## GUI

安装可选 `gui` extra 后启动本地知识工作台：

```powershell
python -m pip install -e ".[gui]"
python -m synapse.integrations.gui --port 8765
```

打开 `http://127.0.0.1:8765/`，使用启动时打印的访问令牌连接，或提前设置 `SYNAPSE_GUI_TOKEN`。GUI 读取与 MCP/CLI 相同的 `<home>/synapse.db`，不直连 SQLite。

- 页面：Overview、Knowledge Graph、Search、Memory、Context、Indexing。
- 记忆编辑尚未实现；Indexing 页面可以通过同一套 Core 触发一次索引，沿用项目级 FileLock。
- 请求需要本地 Bearer Token，并经过 Host/Origin 校验。

## 编辑器侧边栏

Synapse Companion 是 VS Code 兼容侧边栏，提供检索、记忆浏览、上下文构建和图探索。它以独立 VSIX 分发，不需要 Node 构建步骤。

从最新 GitHub Release 一键安装：

```powershell
irm https://github.com/kinguang3/Synapse/releases/latest/download/install-sidebar.ps1 | iex
```

脚本会下载对应 VSIX，自动检测 `code`、`code-insiders`、`trae-cn` 和 `trae`，并安装到所有检测到的编辑器。如需限定目标，可下载脚本后传 `-Editor code`。也可以直接安装已下载的 VSIX：

```powershell
code --install-extension .\synapse-companion-0.1.1.vsix
trae-cn --install-extension .\synapse-companion-0.1.1.vsix
```

从源码目录安装：

```powershell
.\scripts\install-sidebar.ps1 -VsixPath .\dist\synapse-companion-0.1.1.vsix
```

侧边栏需要本地 GUI API。可在扩展中运行 `Synapse: Start Local Service`，或使用 [GUI](#gui) 命令启动；如需扩展按需启动服务，可启用 `synapse.autoStartServer`。

## 数据位置

默认目录由 `platformdirs` 决定：

- Windows：`%LOCALAPPDATA%\Synapse\Synapse\`
- 配置：`<home>\config.toml`
- 数据库：`<home>\synapse.db`
- 锁文件：`<home>\locks\index-<project_id>.lock`

可以通过 `SYNAPSE_HOME`、`SYNAPSE_CONFIG` 覆盖。详见 [配置文档](https://github.com/kinguang3/Synapse/blob/main/docs/guides/configuration.md)。

## 文档

从 [文档索引](https://github.com/kinguang3/Synapse/blob/main/docs/README.md) 开始阅读。

- [快速开始](https://github.com/kinguang3/Synapse/blob/main/docs/guides/getting-started.md)
- [配置](https://github.com/kinguang3/Synapse/blob/main/docs/guides/configuration.md)
- [开发与测试](https://github.com/kinguang3/Synapse/blob/main/docs/guides/development.md)
- [架构](https://github.com/kinguang3/Synapse/blob/main/docs/architecture/overview.md)
- [CLI](https://github.com/kinguang3/Synapse/blob/main/docs/reference/cli.md)
- [MCP Server](https://github.com/kinguang3/Synapse/blob/main/docs/reference/mcp.md)
- [数据模型](https://github.com/kinguang3/Synapse/blob/main/docs/reference/data-model.md)
- [限制与边界](https://github.com/kinguang3/Synapse/blob/main/docs/reference/limitations.md)

## 开发

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
```

性能基准：

```powershell
.\.venv\Scripts\python.exe scripts\benchmark.py --project . --runs 3
```

## License

本项目使用 Apache License 2.0，详见 [LICENSE](LICENSE)。
