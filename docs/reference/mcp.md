# MCP Server

Synapse 提供一个本地 stdio MCP Server，让外部 AI 编码代理复用 CLI 使用的同一套 Core、配置和数据目录。

## 启动

安装后有两个等价入口：

```powershell
synapse-mcp
python -m synapse.integrations.mcp
```

Server 从 stdin 读取 JSON-RPC，向 stdout 写 JSON-RPC。日志和错误信息写入 stderr。不要在这两个入口外层再包装会向 stdout 打印横幅、进度条或普通文本的脚本。

## 计划中的 uvx 启动（尚未发布）

Synapse 当前尚未发布到 PyPI。发行包名准备使用 `synapse-knowledge`；`synapse-mcp` 名称已被其他项目占用，但 console script 名称仍保持 `synapse-mcp`。发布后可使用：

```powershell
uvx --from synapse-knowledge synapse-mcp
```

固定版本时使用 `uvx --from synapse-knowledge==<version> synapse-mcp`。`uvx` 只缓存 Python 环境，项目与记忆仍保存在 `SYNAPSE_HOME` 或平台默认数据目录中，升级包不会删除数据。

MCP Client 配置示例：

```json
{
  "mcpServers": {
    "synapse": {
      "command": "uvx",
      "args": ["--from", "synapse-knowledge", "synapse-mcp"],
      "env": {
        "SYNAPSE_HOME": "<Synapse home>"
      }
    }
  }
}
```

## 配置

### Trae（用户级 `mcp.json`）

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

- `command` 使用绝对路径，路径中不能有需要 shell 解析的空格参数。
- `SYNAPSE_HOME` 应与 CLI 使用同一目录，否则 MCP 看到的是另一套项目与记忆数据。
- 省略 `env` 时使用平台默认 home。
- 修改配置后重启 IDE 或重新加载 MCP Server。

### 通用 stdio Client

```json
{
  "mcpServers": {
    "synapse": {
      "command": "python",
      "args": ["-m", "synapse.integrations.mcp"],
      "env": {
        "SYNAPSE_HOME": "<Synapse home>"
      }
    }
  }
}
```

如果 `python` 不是安装 Synapse 的解释器，请改成虚拟环境中的绝对路径。

## 工具

先调用 `synapse_projects_list` 获取项目 ID 或 slug，再把项目传给其他工具。

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `synapse_projects_list` | 列出已注册项目 | 无 |
| `synapse_project_status` | 项目索引统计和最近一次运行 | `project` |
| `synapse_search` | 搜索代码、文档和记忆 | `project`、`query`、`limit`、`mode`、`node_types`、`path_prefix`、`graph_depth`、`relation_types` |
| `synapse_related` | 查看节点直接关系 | `project`、`node_id`、`limit`、`relation_types`、`include` |
| `synapse_explore_graph` | 从节点扩展知识图谱 | `project`、`node_id`、`depth`、`direction`、`relation_types`、`limit` |
| `synapse_context` | 构建项目上下文 | `project`、`sections`、`max_tokens`、`query` |
| `synapse_remember` | 写入显式长期记忆 | `project`、`content`、`title`、`memory_type`、`tags`、`confidence`、`idempotency_key` |
| `synapse_recall` | 召回显式记忆，返回 `summary` 和 `snippet` | `project`、`query`、`limit`、`mode` |
| `synapse_memory_get` | 按 `node_id` 读取完整记忆正文和元数据 | `project`、`node_id` |

### 记忆读取流程

推荐流程：

1. 用 `synapse_recall` 按关键词或混合模式找到记忆，拿到 `node_id`。
2. 用 `synapse_memory_get` 传入同一项目和 `node_id`，读取完整正文。
3. 需要继续查看关联内容时，再用 `synapse_related` 或 `synapse_explore_graph`。

`synapse_memory_get` 返回 `node_id`、`node_type`、`memory_type`、`title`、`content`、`summary`、`tags`、`provenance`、`confidence`、`salience`、`created_at` 和 `updated_at`。`tags` 恢复为数组；项目或节点不存在、节点不属于指定项目、节点不是 `memory`/`note` 时返回稳定业务错误。

### 上下文选择

`synapse_context` 不传 `query` 时返回项目级概览，按跨模块图连接选择不同路径的代表模块。传入 `query` 时，先复用检索结果选出相关路径，再用结构连接补足模块；每个路径最多出现一次，`top_modules[].reason` 标记 `query_match`、`cross_module_links` 或 `salience`。中文问题中夹带代码标识符时，会退回到标识符查询。

### 范围与默认值

- `synapse_search.limit`：1-50，默认 10。
- `synapse_search.mode`：`keyword` 或 `hybrid`，默认 `hybrid`；不提供 `semantic`。
- `synapse_search.graph_depth`：0-3。
- `synapse_related.limit`：1-100，默认 20。
- `synapse_explore_graph.depth`：0-3，默认 2。
- `synapse_explore_graph.limit`：1-200，默认 50。
- `synapse_context.max_tokens`：100-20000，默认 1200。
- `synapse_context.query`：可选，最多 500 字符；提供后优先选择与任务相关的模块，而不是只按静态 salience 排序。
- `synapse_remember.content`：最多 200,000 字符。
- `synapse_remember.title`：最多 120 字符。
- `synapse_remember.confidence`：0-1。
- `synapse_recall.mode`：`keyword` 或 `hybrid`，默认 `hybrid`。

## 安全与错误

- 项目级工具必须显式传入项目，不能省略为全局搜索。
- `synapse_related`、`synapse_explore_graph` 和 `synapse_memory_get` 会检查 `node.project_id`，跨项目节点返回 `INVALID_ARGUMENT`。
- `synapse_memory_get` 只接受 `memory`/`note` 节点；其他节点类型返回 `INVALID_ARGUMENT`。
- `path_prefix` 必须是项目内相对路径；绝对路径、盘符路径和包含 `..` 的路径会被拒绝。
- `synapse_remember` 有写入副作用，工具注解为 `read_only_hint=false`。
- 业务错误返回 `ToolError`，文本为 JSON，例如：

```json
{"code":"PROJECT_NOT_FOUND","message":"项目不存在: missing","details":{}}
```

- 未知异常只写 stderr，不向 MCP Client 泄露 traceback。

## 数据与生命周期

- MCP 与 CLI 共享 `Settings`、`SYNAPSE_HOME`、`SYNAPSE_CONFIG` 和同一个 SQLite 数据库。
- 每个 MCP 进程在专用单线程 executor 中创建、调用和关闭 `Application`，以匹配 SQLite 的线程本地连接。
- 一个进程内的工具调用串行执行。
- 没有后台守护进程；Client 负责启动、停止和重启 Server。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_mcp_server.py -q
```

测试覆盖初始化、`tools/list`、schema、错误映射、业务调用、完整记忆读取、记忆持久化、跨项目拒绝和 stdout 纯净性。

Phase 2.1.1 已在真实 Trae CN `3.4.16` 对话中验证 8 个工具的发现和 A-F 场景调用，详见 `docs/archive/phases/phase-2.1.1-report.md`。Phase 2.2.1 新增 `synapse_memory_get`，并在真实 Trae 中验证召回后读取完整正文，详见 `docs/archive/phases/phase-2.2.1-report.md`。Phase 2.2.2 在真实 Trae 中验证 9 个工具、query-aware context、overview 结构选择和 token 预算裁剪，详见 `docs/archive/phases/phase-2.2.2-report.md`。

## 当前限制

- 仅支持 stdio，不支持 HTTP/SSE。
- 不提供语义/向量检索。
- 不提供 MCP resources 或 prompts；当前只暴露 tools。
- `synapse_recall` 仍只返回 `summary`、`snippet` 等检索字段；需要完整正文时必须再调用 `synapse_memory_get`。`summary` 在写入时截取前 300 字符，不应当作为长记忆正文使用。
- `synapse_context` 的 `query` 选择仍基于词法/图关系；纯中文且不含代码标识符的问题可能退回项目概览。较小 `max_tokens` 下 `decisions`、`recent_changes` 仍可能被裁剪。
- 图模型主要覆盖 `CALLS`、`IMPORTS`、`CONTAINS` 等关系，构造函数参数注入需要结合源码核对。
