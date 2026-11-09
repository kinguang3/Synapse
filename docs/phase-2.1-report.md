# Phase 2.1 报告

## 目标

在现有 Synapse Core 上增加标准本地 stdio MCP Server，使外部 AI 编码代理能够：

1. 发现已注册项目；
2. 检索项目代码、文档和记忆；
3. 查看节点关系与局部图；
4. 构建项目上下文；
5. 写入并召回显式长期记忆。

本轮不实现 HTTP API、文件监听、Embedding/向量检索，也不修改既有 Core 业务逻辑、SQLite Schema 或 CLI 行为。

## 实现

### 入口

```text
synapse-mcp
python -m synapse.integrations.mcp
```

- `pyproject.toml` 新增依赖 `mcp>=2.3,<2.4`。
- 新增脚本入口 `synapse-mcp = "synapse.integrations.mcp.server:main"`。
- 使用 MCP Python SDK 2.3.0 的 `MCPServer`、`stdio_client` 和 `ClientSession`。
- `main()` 使用 `anyio.run(server.run_stdio_async, backend="asyncio")`。

### 适配层

新增 `src/synapse/integrations/mcp/`：

- `McpRuntime`：专用单线程 `ThreadPoolExecutor` 创建、调用和关闭 `Application`。
- `SynapseTools`：8 个异步工具封装，业务全部委托给现有 Tools。
- `create_server()`：注册工具、lifespan、说明和只读/写入注解。
- `main()`：启动 stdio Server，异常写 stderr 并返回非零。

### 工具

| 工具 | 只读 | 说明 |
| --- | --- | --- |
| `synapse_projects_list` | 是 | 列出项目 |
| `synapse_project_status` | 是 | 项目统计和最近运行 |
| `synapse_search` | 是 | 代码/文档/记忆搜索 |
| `synapse_related` | 是 | 节点直接关系 |
| `synapse_explore_graph` | 是 | 图扩展 |
| `synapse_context` | 是 | 项目上下文 |
| `synapse_remember` | 否 | 写入长期记忆 |
| `synapse_recall` | 是 | 召回长期记忆 |

MCP 工具数量固定为 8，`tools/list` 已断言集合完全一致。

### 范围与安全

- 所有项目级工具都要求 `project`，不提供全局 `project=None` 搜索。
- `synapse_related`、`synapse_explore_graph` 校验节点属于解析后的项目。
- `path_prefix` 拒绝绝对路径、盘符路径和 `..`。
- `mode` 只允许 `keyword` / `hybrid`，不暴露 `semantic`。
- `synapse_remember` 的 `read_only_hint=false`，描述中明确写入副作用。
- `SynapseError` 映射为 `ToolError` + JSON `code/message/details`。
- 未知异常写 stderr，不向客户端返回 traceback。
- stdout 只承载 MCP JSON-RPC；Rich 日志写入 stderr。

## 测试

新增 `tests/test_mcp_server.py`，使用真实子进程和隔离临时 home/SQLite：

- `initialize` 握手、server 名称、协议版本。
- `tools/list` 数量和名称。
- `synapse_search` 必填参数与 `mode` enum。
- `synapse_remember` 写入注解和描述。
- 空项目列表。
- 缺失项目错误 `PROJECT_NOT_FOUND`。
- `semantic` 参数被 schema 拒绝。
- 项目状态、搜索、关系、图探索、上下文。
- remember 后同一项目 recall。
- remember 后新 `Application` 仍能读取记忆。
- 跨项目 `node_id` 拒绝。
- stdout 纯净性：每一行都是 JSON-RPC，stderr 有启动日志。

### 结果

```text
pytest tests/test_mcp_server.py -q     4 passed
pytest -q                              35 passed
ruff check .                           All checks passed
mypy src                               58 source files, no issues
synapse version                        0.1.0
synapse doctor                         integrity ok, fts_integrity ok
synapse-mcp.exe initialize             returncode 0, stdout 为合法 JSON-RPC
```

CLI 隔离 smoke 使用 `<test-root>\home` 和 `<test-root>\fixtures\sample-project`：

```text
projects register + index   3 scanned, 6 nodes, 4 relations, 0 failed
projects status             6 nodes, 4 relations, 3 sources
search build_widget         3 results, hybrid + semantic_unavailable 降级
context                     360 token estimate
remember / recall           写入并召回成功
```

### Benchmark

脚本：`scripts/benchmark.py`，两个数据集各 3 次，workers=4，使用临时数据库。

结果文件：

- `benchmarks/results/phase-2.1/benchmark-20261109T082120Z.json`
- `benchmarks/results/phase-2.1/benchmark-20261109T082120Z.md`

| 数据集 | 文件 | 节点 | 关系 | 冷启动 | 无变更增量 | 全量 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Synapse | 79 | 604 | 1199 | 459.726 ms | 45.741 ms | 482.886 ms |
| recommendation | 9 | 27 | 55 | 37.235 ms | 6.143 ms | 37.489 ms |

失败数均为 0。Synapse 自身文件数从 75 增加到 79，节点从 558 增加到 604，主要来自本轮新增 MCP 源码和测试；性能仍在同一量级。

## Trae 接入

### 环境

- Trae CN `3.4.16`（安装目录版本 `1.107.1`）
- 隔离 profile：`<test-root>\profile3`
- 隔离扩展目录：`<test-root>\extensions`
- 隔离 Synapse home：`<test-root>\home`
- 测试配置：`<test-root>\profile3\User\mcp.json`
- 真实 Trae 配置未修改：`<trae-user-config>`
- 真实配置 SHA256：`<config-sha256>`

### 配置

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

### 结果

Trae 隔离实例成功加载配置、启动 Server 并完成工具发现：

```text
McpClientService startExtension: mcp.config.usrlocalmcp.synapse
MCPClient#start Start With StdioServerParameters
MCPClient#onStderr [Server Internal Log] Starting Synapse MCP server over stdio
MCPClient#onStderr [Server Internal Log] Synapse Core initialized on MCP worker thread
MCPServerManager#listTools Got tools: synapse_projects_list, synapse_project_status,
  synapse_search, synapse_related, synapse_explore_graph, synapse_context,
  synapse_remember, synapse_recall
MCPServerManager#start Connected.
```

日志：

- `<test-root>\reports\trae-profile3-mcp-servers-host.log`
- `<test-root>\reports\trae-profile3-mcp-servers-render.log`

Phase 2.1 阶段未通过 Trae 对话界面自动执行工具调用：隔离 profile 未登录，且当时没有 GUI 自动化能力。工具业务调用由独立 MCP Client 全量测试覆盖；Trae 侧已验证配置格式、进程启动、stdio 握手和工具发现。

## 已知限制

- 仅 stdio，不支持 HTTP/SSE。
- 不提供语义/向量检索。
- 不提供 MCP resources/prompts。
- 一个 MCP 进程内工具调用串行执行。
- 没有内置鉴权；能启动本地进程的用户即可调用工具。
- Phase 2.1 阶段尚未在 Trae 对话界面中自动执行工具调用。
- Trae workspace 级 `.trae/mcp.json` 在本轮隔离启动中未加载，因为新 profile 未进入工作区；用户级配置已验证。真实项目接入时应通过 Trae 的 MCP 设置或受信任工作区加载。

## 结论

Phase 2.1 的 MCP Server 已实现并通过独立 MCP Client、全量测试、静态检查、CLI smoke、Benchmark 和 Trae 隔离工具发现验证。真实 Trae 用户配置未被修改；端到端对话调用随后由 Phase 2.1.1 在已登录 Trae 中完成。

后续 Phase 2.1.1 已在真实 Trae CN `3.4.16` 中完成 A-F 端到端验证，详见 `docs/phase-2.1.1-report.md`。
