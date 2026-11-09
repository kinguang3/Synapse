# Synapse

Synapse 是一个本地优先的代码与知识关联引擎，用 SQLite 保存项目、源码、文档、显式记忆和它们之间的关系，为 AI Agent 提供可检索、可解释的本地上下文。

## 当前状态

- Phase 1：可运行的本地知识引擎。
- Phase 1.5：完成配置、项目级索引锁、FTS 降级、Source/节点事务一致性、崩溃恢复、边界测试、文档与 Benchmark。
- Phase 2.1：完成本地 stdio MCP Server，提供 8 个项目范围的检索与记忆工具。
- Phase 2.1.1：在真实 Trae 中完成 8 工具发现和 A-F E2E 调用验证。
- 尚未实现：HTTP API、文件监听、Embedding/向量检索。

`semantic` 模式目前不是真正的语义向量检索；它会返回 `degraded=["semantic_unavailable"]` 并退回词法检索。

已知限制包括：`synapse_recall` 尚未返回完整记忆正文和 tags；`synapse_context` 的模块覆盖存在偏斜；知识图谱尚未完整建模构造函数参数注入关系。详见 [限制与边界](docs/limitations.md) 和 [Phase 2.1.1 报告](docs/phase-2.1.1-report.md)。

## 功能

- Python AST 解析（tree-sitter）与 Markdown 结构解析。
- 其他常见文本格式以文件级节点兜底。
- SQLite + FTS5 全文检索，支持中文 unigram/bigram。
- 代码引用解析、跨文件关系、图扩展检索。
- 项目上下文压缩，按 token 预算裁剪可选部分。
- 显式记忆：`fact`、`experience`、`decision`、`preference`、`summary`。
- 项目级 FileLock，避免同一项目被多个进程同时索引。
- 进程崩溃后会标记中断的索引运行、取消未完成任务，并由下一次扫描安全重建。
- 本地 stdio MCP Server，复用同一套 Core、配置和数据目录。
- MCP 默认只暴露 `keyword` / `hybrid` 检索，不把不可用的语义检索伪装成已实现能力。
- MCP 工具强制项目范围，并校验节点归属，避免跨项目读取。

## 环境要求

- Python 3.11+
- Windows 10/11、Linux 或 macOS
- SQLite 需启用 FTS5（随 Python 自带 SQLite 通常可用）

## 快速开始（Windows PowerShell）

```powershell
cd C:\path\to\Synapse
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -e ".[dev]"
```

初始化配置并检查环境：

```powershell
synapse config init
synapse doctor
```

注册并索引一个项目：

```powershell
synapse projects register . --index
synapse projects status
```

检索与读取上下文：

```powershell
synapse search "ContextBuilder" --limit 5
synapse context . --max-tokens 1200
```

存储和召回显式记忆：

```powershell
synapse remember . "Use SQLite FTS5 for local retrieval." --type decision --title "Use FTS5"
synapse recall "FTS5" --limit 5
```

查询、索引、记忆和项目管理命令都支持 `--json`，便于 Agent 或脚本调用；`version` 仅输出纯文本。

## 常用命令

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

安装后提供 `synapse-mcp` 入口，也可以使用模块方式启动：

```powershell
synapse-mcp
python -m synapse.integrations.mcp
```

这是本地 stdio MCP Server，不监听端口。外部 Agent 配置示例：

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

可用工具：

- `synapse_projects_list`
- `synapse_project_status`
- `synapse_search`
- `synapse_related`
- `synapse_explore_graph`
- `synapse_context`
- `synapse_remember`
- `synapse_recall`

所有项目级工具都必须传入已注册项目。`synapse_remember` 会写入本地 SQLite；其余工具为只读。stdout 只承载 MCP JSON-RPC，日志写入 stderr。详见 [MCP 文档](docs/mcp.md)。

## 数据位置

默认目录由 `platformdirs` 决定：

- Windows：`%LOCALAPPDATA%\Synapse\`
- 配置：`<home>\config.toml`
- 数据库：`<home>\synapse.db`
- 锁文件：`<home>\locks\index-<project_id>.lock`

可以通过 `SYNAPSE_HOME`、`SYNAPSE_CONFIG` 覆盖。详见 [配置文档](docs/configuration.md)。

## 文档

- [快速开始](docs/getting-started.md)
- [架构](docs/architecture.md)
- [CLI](docs/cli.md)
- [配置](docs/configuration.md)
- [数据模型](docs/data-model.md)
- [MCP Server](docs/mcp.md)
- [限制与边界](docs/limitations.md)
- [开发与测试](docs/development.md)
- [Phase 1.5 报告](docs/phase-1.5-report.md)
- [Phase 2.1 报告](docs/phase-2.1-report.md)
- [Phase 2.1.1 真实 Trae E2E 报告](docs/phase-2.1.1-report.md)

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

当前仓库未声明开源许可证。公开仓库发布前，项目所有者需要明确选择并添加许可证；在添加许可证前，不应默认视为可自由分发。
