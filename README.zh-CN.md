<p align="center">
  <img src="https://raw.githubusercontent.com/kinguang3/Synapse/main/docs/assets/synapse-icon.png" alt="Synapse" width="80">
</p>

<h3 align="center">为 AI 编程助手提供本地知识。</h3>
<p align="center">代码图谱、项目上下文与持久记忆，全部运行在你的电脑上。</p>

<p align="center">
  <a href="#环境要求">环境要求</a> ·
  <a href="#一键安装">安装</a> ·
  <a href="#首次运行">首次运行</a> ·
  <a href="#不使用侧边栏">手动安装</a> ·
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

**本地优先、开源、完全属于你。** 一个 SQLite 工作区，同时服务 MCP、CLI、GUI 与编辑器侧边栏，无需云账号。

## 环境要求

- Windows 10/11 与 PowerShell 5.1+
- [uv](https://docs.astral.sh/uv/)
- 侧边栏需要 VS Code、VS Code Insiders、Trae CN 或 Trae

`uv` 会自动下载 Python 3.11。macOS 和 Linux 用户可参考[快速开始](https://github.com/kinguang3/Synapse/blob/main/docs/guides/getting-started.md)手动安装。

## 一键安装

```powershell
irm https://github.com/kinguang3/Synapse/releases/latest/download/install.ps1 | iex
```

安装器会自动完成：

- 在 `%LOCALAPPDATA%\Synapse\Synapse\runtime` 创建独立运行环境
- 安装 CLI、MCP Server 与 GUI 依赖
- 将 Synapse Companion 侧边栏安装到检测到的编辑器
- 在 `%LOCALAPPDATA%\Synapse\Synapse\mcp.json` 生成 MCP 配置
- 将运行时命令目录加入用户 `PATH`

## 首次运行

1. 重启编辑器和终端。
2. 从活动栏打开 **Synapse**。本地 GUI 服务会自动启动。
3. 注册并索引项目：

```powershell
synapse projects register . --index
```

4. 把生成的 `mcp.json` 配置加入你的 MCP 客户端。

打开侧边栏时，如果服务未运行或健康检查失败，扩展会启动服务并等待健康检查通过，再加载项目。如果仍显示离线，运行 `Synapse: Start Local Service` 并查看 Synapse 输出面板。如需关闭自动启动，将 `synapse.autoStartServer` 设为 `false`。

MCP Server 是本地 stdio 服务，由 MCP 客户端启动，不由侧边栏管理。

## 手动启动 GUI 与自定义路径

### 手动启动 GUI

侧边栏会自动启动 GUI。默认安装时，要使用浏览器界面可以执行：

```powershell
& "$env:LOCALAPPDATA\Synapse\Synapse\runtime\Scripts\python.exe" -m synapse.integrations.gui
```

如果设置了自定义 `SYNAPSE_HOME`，把路径换成 `<SYNAPSE_HOME>\runtime\Scripts\python.exe`。

打开 `http://127.0.0.1:8765/`，填入终端打印的令牌。想固定令牌，先设置再启动：

```powershell
$env:SYNAPSE_GUI_TOKEN = "your-long-token"
& "$env:LOCALAPPDATA\Synapse\Synapse\runtime\Scripts\python.exe" -m synapse.integrations.gui
```

### 自定义路径

最简单的方式：先设置 `SYNAPSE_HOME`，再执行一键安装：

```powershell
$env:SYNAPSE_HOME = "D:\SynapseData"
irm https://github.com/kinguang3/Synapse/releases/latest/download/install.ps1 | iex
```

运行时、数据库和 `mcp.json` 都会放在这个目录下。启动 GUI 或使用 CLI 时也要设置相同的 `SYNAPSE_HOME`。长期使用建议把它设为用户环境变量，然后重新打开终端。

如果只想改运行时目录，下载安装器并用 `-RuntimePath`：

```powershell
$installer = Join-Path $env:TEMP "synapse-install.ps1"
irm https://github.com/kinguang3/Synapse/releases/latest/download/install.ps1 -OutFile $installer
& $installer -RuntimePath "D:\Synapse\runtime"
```

如果运行时不在 `<SYNAPSE_HOME>\runtime` 下，还要在编辑器设置中把 `synapse.pythonPath` 设为 `<runtime>\Scripts\python.exe`，否则侧边栏无法自动启动它。

其他参数：`-Editor`、`-VsixPath`、`-UvPath`、`-Version`、`-NoPath`、`-Force`、`-DryRun`。

## 不使用侧边栏

仅使用 MCP：

```powershell
uvx --from synapse-knowledge synapse-mcp
```

仅使用 CLI：

```powershell
uv tool install synapse-knowledge
synapse config init
synapse doctor
```

源码安装、自定义数据目录和手动 GUI 启动方式见[快速开始](https://github.com/kinguang3/Synapse/blob/main/docs/guides/getting-started.md)。

## 常用命令

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

## 数据位置

默认目录由 `platformdirs` 决定：

- Windows：`%LOCALAPPDATA%\Synapse\Synapse\`
- 配置：`<home>\config.toml`
- 数据库：`<home>\synapse.db`
- 托管运行时：`<home>\runtime`
- 生成的 MCP 配置：`<home>\mcp.json`

可通过 `SYNAPSE_HOME` 覆盖数据目录。

## 文档

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

## License

本项目使用 Apache License 2.0，详见 [LICENSE](https://github.com/kinguang3/Synapse/blob/main/LICENSE)。
