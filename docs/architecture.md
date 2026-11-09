# 架构

Synapse 采用分层结构，目标是让 CLI、脚本和 MCP 接口复用同一套 Core。

## 分层

```text
integrations/cli        integrations/mcp
        \                   /
         -> tools
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

## 上下文构建

`ContextBuilder` 读取项目统计、技术栈、重要模块、决策记忆和最近变更，并按 `max_tokens` 裁剪可选列表。裁剪后如果仍有可裁剪内容，结果会带 `truncated=true`。项目与统计字段属于必要信息，始终保留。

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
- 安全：项目级工具必须显式传项目；节点工具校验 `node.project_id`；`path_prefix` 拒绝绝对路径和 `..`；不暴露全局项目搜索。
- 能力边界：仅暴露 `keyword` / `hybrid`，不暴露不可用的 `semantic`。

## 并发模型

- 同一项目：FileLock 串行化索引。
- 不同项目：可以并发索引，共享 SQLite 写入锁。
- 任务解析：项目内使用线程池并行读取和解析。
- 数据库写入：事务串行化，WAL 模式降低读写阻塞。
- MCP：每个 Server 进程将 Core 调用串行到自己的单线程 executor；不与其他进程共享连接。

## 演化方向

Phase 2 按以下顺序推进，且必须复用当前 Core：

1. MCP Server：已完成 Phase 2.1。
2. 本地图谱/HTTP API。
3. 文件监听。
4. Embedding/向量检索。
