# 架构

Synapse 采用分层结构，目标是让 CLI、脚本和 MCP 接口复用同一套 Core。

## 分层

```text
integrations/cli        integrations/mcp        integrations/gui
        \                   |                       /
         -> tools -------------------------------
             -> ingestion / retrieval / context / knowledge
                 -> domain
                 -> ports
                 -> adapters / services
                     -> storage/sqlite
```

约束：

- `core` 提供纯工具：路径、时钟、ID、哈希、文本、评分。
- `domain` 只包含枚举、数据模型和纯评分逻辑，不访问 I/O。
- `ports` 只保留实际使用的协议；目前是 `ParserPort`。
- `bootstrap.py` 是组合根，负责创建数据库、Repository、Service 和 Tools。
- CLI 不直接写 SQL，也不直接解析文件。
- MCP 适配层不实现检索、索引或记忆业务，只做协议转换、项目解析、参数校验和错误映射。

## 索引流程

```text
index_project(project)
  -> resolve project
  -> acquire per-project FileLock
  -> recover interrupted state
       -> mark leftover running index_runs as interrupted
       -> cancel leftover queued/running tasks
  -> create new index_run
  -> Scanner.scan(root)
  -> ChangeDetector.diff(scan, sources, full)
  -> delete missing sources
  -> enqueue index_file tasks for changed files
  -> claim tasks in batches
  -> parse files in a thread pool
  -> apply each parsed file in a SQLite transaction
  -> resolve references
  -> finish index_run
```

### 扫描与变更检测

- `Scanner` 按后缀选择解析器，并遵守 `.gitignore` / `.synapseignore` 风格规则。
- Python 文件使用 tree-sitter，Markdown 使用 `markdown-it-py`，其他文本格式由 PlainTextParser 生成文件级节点。
- 默认增量检测优先使用 `mtime_ns + size_bytes + parser_version`。
- 当元数据变化但内容哈希未变时，只更新 Source 的 stat，不重新解析。
- 设置 `indexing.verify_content_hashes = true` 后，即使 mtime/size 未变也会计算内容哈希，用于发现“内容变了但时间戳和大小没变”的情况。

### 事务边界

- `apply_file()` 在同一个事务中写入 Source、删除过期节点、写入新节点、关系、未解析引用，并标记 Source 已索引。
- 不再在任务执行前提前更新 Source 的 `uri`、`content_hash` 或 changefile 的 stat。
- 重命名时，新的 URI 与节点路径在同一事务中落库；如果进程中断，下一次扫描会重新检测到重命名。
- 因此进程崩溃不会留下“Source 已更新但节点仍旧”的半完成状态。

## 崩溃恢复

恢复只在成功获得项目锁后执行，避免把另一个仍在运行的进程误判为崩溃。

1. 将该项目所有 `index_runs.status='running'` 记录改为 `interrupted`，保留错误和完成时间。
2. 将该项目所有 `tasks.status IN ('queued','running')` 改为 `canceled`，写入 `last_error` 原因。
3. 创建新的 `index_run`。
4. 重新扫描项目；未完成的变更会因 Source 尚未更新而再次进入 `changes`，重新创建任务。
5. 新任务使用稳定的节点 ID 和唯一关系约束，重复处理不会产生重复节点或关系。

恢复是幂等的：没有遗留 running 记录时，两个恢复计数都为 0。

## 检索流程

```text
search(query)
  -> RetrievalService
      -> FTS5 lexical candidates
      -> optional graph expansion
      -> scoring: lexical + graph + recency + importance + confidence
  -> SearchTools formats result
```

FTS 查询失败时会抛出 `IndexUnavailable`，上层返回 `degraded=["fts_unavailable"]`，不会吞掉存储错误。

## 记忆读取

```text
recall(query)
  -> RetrievalService.search(node_types=[memory, note])
  -> summary / snippet / node_id

memory_get(node_id, project)
  -> MemoryTools
      -> NodeRepository.get(node_id)
      -> project ownership check
      -> memory/note type check
  -> full content + tags + memory_type + provenance + timestamps
```

- `recall` 负责搜索和排序，不返回完整正文，避免普通检索载荷膨胀。
- `memory_get` 负责按 ID 读取单条记忆，直接复用 `NodeRepository.get()`，不需要修改 schema。
- `tags` 在 SQLite 中保存为空格分隔文本，同时原始数组保存在节点 `metadata_json`；读取时优先恢复原始数组。

## 记忆列表

```text
MemoryTools.list(project, memory_type?, query?, limit, offset)
  -> NodeRepository.memory_page()
      -> SQL: project + node_type + memory_type + optional FTS
      -> COUNT(*) with the same filters
      -> ORDER BY updated_at DESC, created_at DESC, id ASC
      -> query results additionally order by bm25(node_fts, 5.0, 1.0, 2.0)
      -> LIMIT / OFFSET
  -> total / memories / offset / limit / query / meta
```

- 过滤、计数和分页在同一条 SQL 路径中完成，不再先取固定窗口再在 Python 中过滤，因此 `total` 与当前过滤条件一致。
- `limit` 范围为 1-200，`offset` 必须非负；超出范围的参数返回 `INVALID_ARGUMENT`。
- `query` 使用 SQL FTS 关键词匹配，返回顺序稳定；列表的 `meta.mode` 为 `keyword`。
- 项目隔离、节点类型和记忆类型条件同时应用于 COUNT 与列表查询，不会出现总数与页面不一致。

## 上下文构建

`ContextBuilder` 读取项目统计、技术栈、重要模块、决策记忆和最近变更，并按 `max_tokens` 裁剪可选列表。裁剪后如果仍有可裁剪内容，结果会带 `truncated=true`。项目与统计字段属于必要信息，始终保留。

`top_modules` 以路径为模块边界：没有 `query` 时，按跨模块图连接数选择不同路径的代表节点；传入 `query` 时，先复用 `RetrievalService` 的搜索结果选出相关路径，再用结构连接补足。每个路径只保留一个代表节点，`reason` 标记 `query_match`、`cross_module_links` 或 `salience`。查询模式优先保留相关模块，`recent_changes` 使用文件 mtime 并优先选择相关路径。

## MCP Server

```text
MCP Client
  -> stdio JSON-RPC
  -> integrations/mcp/server.py
      -> project resolution / argument validation
      -> tools
          -> same Application as CLI
```

- 入口：`synapse-mcp`，或 `python -m synapse.integrations.mcp`。
- 传输：仅本地 stdio；不启动 HTTP 端口。
- 生命周期：MCP lifespan 启动时在专用单线程 executor 中调用 `build_application()`，关闭时在同一线程关闭 `Application`。
- 并发：所有 Core 调用串行进入同一个 worker 线程，保证线程本地 SQLite 连接、事务和关闭顺序一致。
- 日志：Python logging / Rich 输出到 stderr；stdout 只写 MCP JSON-RPC。
- 错误：`SynapseError` 转为 `ToolError`，内容为稳定 JSON `code/message/details`；未知异常写 stderr，不向客户端返回 traceback。
- 安全：项目级工具必须显式传项目；节点工具校验 `node.project_id`；`synapse_memory_get` 额外限制为 `memory`/`note` 节点；`path_prefix` 拒绝绝对路径和 `..`；不暴露全局项目搜索。
- 能力边界：仅暴露 `keyword` / `hybrid`，不暴露不可用的 `semantic`。

## 并发模型

- 同一项目：FileLock 串行化索引。
- 不同项目：可以并发索引，共享 SQLite 写入锁。
- 任务解析：项目内使用线程池并行读取和解析。
- 数据库写入：事务串行化，WAL 模式降低读写阻塞。
- MCP：每个 Server 进程将 Core 调用串行到自己的单线程 executor；不与其他进程共享连接。

## GUI API

```text
static SPA（index.html / app.js / styles.css）
  -> 127.0.0.1 FastAPI（Bearer Token + Host/Origin 校验）
  -> CoreWorker（单线程串行调用）
  -> query_service 适配层
  -> build_application() / Tools / Services / Repositories
  -> 同一个 SQLite + FTS5 数据库
```

- 入口：`python -m synapse.integrations.gui --port 8765`（可选 `gui` extra）。
- 只读端点：projects、status、overview、search、graph/overview、nodes、graph/neighbors、memories、memories/{id}、context。
- 写操作：仅 `POST /projects/{id}/index` 触发一次索引，复用 `ProjectTools.index()` 与项目级 FileLock。
- 前端为无构建静态 SPA，由 FastAPI 直接托管；不引入 Node 构建链。
- 适配层负责参数校验、项目隔离、错误映射和响应整形；不写 SQL，不复制索引/检索/记忆业务。
- 记忆列表通过 `MemoryTools.list()` 进入 Core，支持 `memory_type`、`q`、`limit` 和 `offset`，`total` 为过滤后的准确数量；GUI Memory 页默认每页 20 条，显示当前范围与总页数，并由后端返回分页数据。
- 搜索输入使用 260ms 防抖；搜索词或类型变化会重置 `offset`，旧请求通过请求序号和查询上下文校验后丢弃，避免覆盖新结果。
- `tests/test_gui_api.py` 覆盖全部 13 个 API 端点、静态首页、认证/项目/节点错误、索引锁冲突，以及记忆分页和总数契约；`tests/frontend/memory_paging.test.js` 覆盖分页状态与请求竞态判定。
- 未实现：记忆编辑、删除与版本历史、索引历史页面。

## 演化方向

Phase 2 按以下顺序推进，且必须复用当前 Core：

1. MCP Server：已完成 Phase 2.1。
2. 本地 GUI API 与知识工作台：已完成 Phase 3.1（只读 + 索引触发）。
3. 文件监听。
4. Embedding/向量检索。

GUI 继续复用当前 Core 与 SQLite Schema；记忆编辑、删除和版本管理需要在后续阶段以加法能力实现。
- 设计详情见 [Phase 3.0 GUI 架构设计](../archive/design/phase-3.0-architecture.md)。
