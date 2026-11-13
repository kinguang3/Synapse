# Synapse

[English](README.md) | 简体中文

Synapse 是一个本地优先的 MCP 服务，为 AI Coding Agents 提供结构化的代码知识图谱、项目上下文检索和持久化项目记忆。它用 SQLite 保存项目、源码、文档、显式记忆和它们之间的关系，并通过 MCP、CLI 和本地 GUI 暴露同一份知识。

## 当前状态

- Phase 1：可运行的本地知识引擎。
- Phase 1.5：完成配置、项目级索引锁、FTS 降级、Source/节点事务一致性、崩溃恢复、边界测试、文档与 Benchmark。
- Phase 2.1：完成本地 stdio MCP Server，提供 8 个项目范围的检索与记忆工具。
- Phase 2.1.1：在真实 Trae 中完成 8 工具发现和 A-F E2E 调用验证。
- Phase 2.2.1：新增 `synapse_memory_get`，按 `node_id` 读取完整记忆正文和元数据，MCP 工具总数达到 9 个。
- Phase 2.2.2：完成 query-aware 上下文模块选择、结构化 overview、路径去重和 token 预算裁剪。
- Phase 3.0：完成知识图谱 GUI 架构设计。
- Phase 3.1：完成本地只读 GUI API 与静态知识工作台（Overview、Knowledge Graph、Search、Memory、Context、Indexing），复用同一套 Core 与同一个 SQLite 知识库。
- Phase 3.2.1：修复记忆列表的类型/查询过滤、分页与总数准确性，并补充 GUI API 契约回归测试。
- Phase 3.2.2：将后端记忆分页接入 GUI，支持关键词/类型筛选、准确总数、旧请求防覆盖和响应式分页控件。
- 能力口径已对齐：MCP、CLI 与 GUI 只暴露 `keyword` / `hybrid` 检索；CLI 新增 `synapse memory-get` 补齐记忆读取闭环。
- 尚未实现：文件监听、Embedding/向量检索、记忆编辑/版本管理、云同步。

`semantic` 不是真正的语义向量检索，也不再由任何入口暴露；当前没有 Embedding 模型或向量索引。

已知限制包括：`synapse_recall` 只返回 summary 和 snippet，完整正文与 tags 需要通过 `synapse_memory_get` 读取；上下文排序基于词法与图关系，而不是语义向量；知识图谱尚未完整建模构造函数参数注入关系。详见 [限制与边界](docs/reference/limitations.md)。

## 功能

- Python AST 解析（tree-sitter）与 Markdown 结构解析。
- 其他常见文本格式以文件级节点兜底。
- SQLite + FTS5 全文检索，支持中文 unigram/bigram。
- 代码引用解析、跨文件关系、图扩展检索。
- 查询感知的项目上下文：优先选择相关模块、覆盖不同路径，并按 token 预算裁剪可选部分。
- 显式记忆：`fact`、`experience`、`decision`、`preference`、`summary`。
- 记忆列表 API 支持项目/类型/查询过滤、`limit` / `offset` 分页，并返回过滤后的准确总数。
- GUI 记忆浏览器使用每页 20 条的后端分页，显示准确范围/总数，支持关键词与类型筛选，并防止旧请求覆盖新结果。
- 项目级 FileLock，避免同一项目被多个进程同时索引。
- 进程崩溃后会标记中断的索引运行、取消未完成任务，并由下一次扫描安全重建。
- 本地 stdio MCP Server，复用同一套 Core、配置和数据目录。
- MCP 默认只暴露 `keyword` / `hybrid` 检索，不把不可用的语义检索伪装成已实现能力。
- MCP 工具强制项目范围，并校验节点归属，避免跨项目读取。
- 本地 GUI 工作台：图谱探索、检索、记忆查看、上下文预览和索引状态/触发；直接复用 Core，不直连 SQLite。

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
synapse context . --query "retrieval 模块" --max-tokens 700
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
- `synapse_memory_get`

所有项目级工具都必须传已注册项目。`synapse_remember` 会写入本地 SQLite，其他工具只读。推荐先用 `synapse_recall` 找到记忆，再用 `synapse_memory_get` 读取完整正文和 tags。stdout 只输出 MCP JSON-RPC，日志写入 stderr。详见 [MCP 文档](docs/reference/mcp.md)。

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

## 数据位置

默认目录由 `platformdirs` 决定：

- Windows：`%LOCALAPPDATA%\Synapse\Synapse\`
- 配置：`<home>\config.toml`
- 数据库：`<home>\synapse.db`
- 锁文件：`<home>\locks\index-<project_id>.lock`

可以通过 `SYNAPSE_HOME`、`SYNAPSE_CONFIG` 覆盖。详见 [配置文档](docs/guides/configuration.md)。

## 文档

从 [文档索引](docs/README.md) 开始阅读。

- [快速开始](docs/guides/getting-started.md)
- [配置](docs/guides/configuration.md)
- [开发与测试](docs/guides/development.md)
- [架构](docs/architecture/overview.md)
- [CLI](docs/reference/cli.md)
- [MCP Server](docs/reference/mcp.md)
- [数据模型](docs/reference/data-model.md)
- [限制与边界](docs/reference/limitations.md)

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
