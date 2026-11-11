# Phase 3.0 知识图谱 GUI 架构设计与技术验证

> 状态：架构设计完成，尚未实现 GUI。  
> 本轮范围：只读审查、通信方案设计、API/安全/前端设计、架构报告。  
> 未执行：最小 Spike、页面开发、Schema 修改、Core 重构、真实用户数据或 Trae 配置修改、Git 提交。
>
> 后续进展：Phase 3.1 已按本设计实现只读 GUI API、静态知识工作台和索引触发；当前能力见 [架构](../../architecture/overview.md) 与 [限制与边界](../../reference/limitations.md)。

## 0. 结论摘要

### 0.1 五个直接回答

| 问题 | 结论 |
| --- | --- |
| 推荐哪种 GUI 与 Core 通信方案？ | 推荐 **FastAPI 本地 HTTP API + React/Vite SPA**。FastAPI 只做本地适配层，业务仍由现有 `Application`、Tools、Services、Repositories 完成。 |
| 是否需要 FastAPI？ | **需要**。它是当前 Python Core 与 React 之间成本最低、调试最直接、跨平台最容易的本地通信层。依赖应作为可选 `gui` extra，不进入 CLI/MCP 的必需依赖。 |
| 是否需要 Tauri？ | **Phase 3.1 不需要**。Tauri 适合后续桌面壳和安装包阶段；现在引入会同时增加 Rust 工具链、Python sidecar 打包、进程管理、升级迁移和 Windows 发布成本。 |
| React GUI 如何复用现有 Core？ | React 只调用本地 HTTP API；API 适配层通过 `bootstrap.build_application()` 复用同一套 `Application`/Tools/Services/Repositories，不复制检索、索引、记忆或 SQL 逻辑。 |
| 是否需要修改现有数据库？ | **不需要 Schema 修改**。项目、Source、Node、Relation、Task、IndexRun 和记忆数据结构已足够。少量缺失能力通过新增只读适配查询或 Service 方法解决，必须另行确认。 |
| Phase 3.1 应该从什么开始？ | 从 **API 基础层 + 本地认证 + Core 工作线程 + 只读项目/状态/搜索/局部图谱接口 + React 壳** 开始；不要先做完整图谱 UI 或 Tauri 打包。 |

### 0.2 推荐架构一句话

```text
React SPA
  -> 127.0.0.1 FastAPI（本地 Token + Origin/Host 校验）
  -> GUI 适配层（参数校验、项目隔离、分页、错误映射、索引任务管理）
  -> 现有 build_application() / Tools / Services / Repositories
  -> 同一个 SQLite + FTS5 数据库
```

### 0.3 本轮未做的事

- 没有新增 FastAPI、React、Tauri 或任何前端依赖。
- 没有新增或修改 SQLite Schema、迁移、表、列、索引。
- 没有修改 MCP 9 个工具、CLI 命令或真实 Trae 配置。
- 没有修改 OpenCode V2 Spike；当前仓库中未发现该目录。
- 没有建立第二套知识存储，没有让 React 直接访问 SQLite。
- 没有执行 Phase 3.0 Spike。
- 没有提交或推送 Git。

## 1. 审查方法与当前基线

### 1.1 审查方式

本轮只读检查了：

- `src/synapse/bootstrap.py`
- `src/synapse/domain/`
- `src/synapse/knowledge/`
- `src/synapse/ingestion/`
- `src/synapse/retrieval/`
- `src/synapse/context/`
- `src/synapse/tools/`
- `src/synapse/storage/sqlite/`
- `src/synapse/integrations/mcp/`
- `src/synapse/integrations/cli/`
- `src/synapse/config.py`
- `pyproject.toml`
- `tests/`
- `README.md`、`README.zh-CN.md`、`docs/`

所有结论以源码和现有测试为准，不按文件名猜测职责。

### 1.2 当前基线

- 当前分支：`main`
- 当前提交：`5355e2f Add query-aware context module selection`
- 自动化测试基线：`41 passed`
- `ruff`：通过
- `mypy`：58 个源文件通过
- MCP：9 个工具
- 当前没有 HTTP API、GUI、Tauri、FastAPI、React 或前端目录
- 当前没有 `src/synapse/services/` 目录；Service 实际分布在 `knowledge/`、`ingestion/`、`retrieval/`、`context/`

## 2. 现有架构审查

### 2.1 实际分层

```text
integrations/cli        integrations/mcp
        \                   /
         -> tools
             -> knowledge / ingestion / retrieval / context
                 -> domain
                 -> ports
                 -> storage/sqlite
```

关键事实：

- 组合根是 `src/synapse/bootstrap.py:57-144` 的 `build_application(settings=None)`。
- `Application` 是 `@dataclass(slots=True)`，直接暴露 Database、全部 Repository、Service 和 Tools（`bootstrap.py:28-54`）。
- CLI 每次命令调用 `build_application()`，不直接写 SQL（`integrations/cli/main.py:85` 等）。
- MCP 通过 `McpRuntime` 在专用单线程 executor 中调用同一个 `build_application()`（`integrations/mcp/server.py:40-87`）。
- 各层 `__init__.py` 基本只有 docstring，没有稳定导出 API；GUI 需要按具体模块导入，或由新增适配层集中导入。

### 2.2 Core 组件与真实职责

| 组件 | 位置 | 真实职责 | GUI 复用判断 |
| --- | --- | --- | --- |
| `KnowledgeService` | `knowledge/service.py:22-180` | 单文件事务写入、删除 Source、文本记忆写入 | 可复用；记忆更新/删除需要新增 Service 方法 |
| `IngestionService` | `ingestion/pipeline.py:50-328` | 同步索引、项目 FileLock、扫描、变更检测、任务队列、引用解析 | 可复用；不能直接放在 API 事件循环中 |
| `RetrievalService` | `retrieval/service.py:27-415` | FTS/符号/图扩展/混合评分/多样性；局部图遍历；相关节点 | 可复用；搜索无分页，`project=None` 会跨项目 |
| `ContextBuilder` | `context/builder.py:34-384` | 项目上下文、技术栈、top modules、决策、最近变更、预算裁剪 | 可用于 Overview 和 AI 上下文；不是 GUI 项目概览 API |
| `Normalizer` | `normalizer/normalizer.py:33-159` | Parser 输出转 NodeDraft/RelationDraft/refs | 不应由 GUI 直接调用 |
| `ReferenceResolver` | `normalizer/resolver.py:72-227` | 全项目引用解析 | 索引内部使用，GUI 不直接调用 |
| `ParserRegistry` | `parsers/registry.py:33-63` | 解析器选择与解析 | 索引内部使用，GUI 不直接调用 |

### 2.3 Tools 层现状

| Tool | 位置 | 主要方法 | GUI 复用性 |
| --- | --- | --- | --- |
| `ProjectTools` | `tools/project_tools.py:24-132` | `register`、`list_projects`、`status`、`index` | 项目/状态可复用；`index` 同步阻塞且无 run_id/进度/取消 |
| `SearchTools` | `tools/search_tools.py:9-87` | `search`、`get_related`、`get_context`、`explore_graph` | 基本可复用；`get_related`/`explore_graph` 无项目参数，需要适配层补归属校验 |
| `MemoryTools` | `tools/memory_tools.py:12-125` | `remember`、`recall`、`get` | 创建/检索/详情可复用；没有 list/update/delete，tags 结构不一致 |

具体事实：

- `ProjectTools.register` 接受路径和可选 `name`，按规范化根路径去重（`project_tools.py:44-68`）。
- `ProjectTools.status` 返回项目、统计、5 个 top modules 和最近一次 index run（`project_tools.py:75-111`）。
- `ProjectTools.index` 同步调用 `IngestionService.index_project`，返回 `{"project": reference, "stats": ...}`；`project` 是输入字符串而不是项目对象（`project_tools.py:113-121`）。
- `SearchTools.search` 直接调用 `RetrievalService.search`；`project=None` 会全局搜索（`search_tools.py:19-40`、`retrieval/service.py:371-374`）。
- `SearchTools.get_related` 和 `explore_graph` 只接收 `node_id`，不做项目归属校验；MCP 层额外做了校验（`mcp/server.py:409-423`）。
- `MemoryTools.remember` 返回 `tags` 字符串，`get` 返回 `tags` 列表（`memory_tools.py:101`、`memory_tools.py:118-125`）。
- `MemoryTools.get` 的 `project` 可选；不传时不校验归属（`memory_tools.py:77-87`）。
- `MemoryTools` 没有 update、delete、list、按 tag 过滤。

### 2.4 MCP 现状

MCP 是 stdio 适配器，不是 GUI 后端：

- 入口：`synapse-mcp` 或 `python -m synapse.integrations.mcp`（`pyproject.toml:33-35`、`integrations/mcp/__main__.py`）。
- 仅 stdio，不监听 HTTP 端口（`integrations/mcp/server.py:530-542`）。
- `McpRuntime` 使用 `ThreadPoolExecutor(max_workers=1)`，所有 Core 调用串行到同一线程（`server.py:40-87`）。
- 9 个工具：`synapse_projects_list`、`synapse_project_status`、`synapse_search`、`synapse_related`、`synapse_explore_graph`、`synapse_context`、`synapse_remember`、`synapse_recall`、`synapse_memory_get`（`server.py:454-526`）。
- `SynapseError` 转为 `ToolError(json.dumps(exc.to_dict()))`；非 `SynapseError` 记录日志后原样抛出（`server.py:96-103`）。
- `path_prefix` 拒绝绝对路径、盘符路径和 `..`（`server.py:396-406`）。
- `related`、`explore_graph` 校验节点属于指定项目（`server.py:409-423`）。
- `memory_get` 校验项目归属和 `memory`/`note` 类型（`memory_tools.py:77-93`）。

结论：GUI 不应通过 MCP 访问 Core。MCP 是面向 Agent 的协议适配器，stdin/stdout 和单 worker 模型不适合浏览器 GUI。

### 2.5 CLI 现状

- `synapse` 是 Typer 应用（`pyproject.toml:34`）。
- 命令：`projects list/register/status`、`index`、`search`、`related`、`explore`、`remember`、`recall`、`context`、`config show/init`、`doctor`、`version`。
- 每个业务命令内部调用 `build_application()`（`cli/main.py:85` 等）。
- `_project_reference` 支持显式 reference、唯一项目、按当前目录匹配；多项目无法确定时抛 `AmbiguousProject`（`cli/main.py:54-71`）。
- `search`/`recall` 省略 `--project` 时是跨项目检索（`cli/main.py:213-215`、`354-356`）。
- `related`/`explore` 没有项目参数（`cli/main.py:235-302`）。
- 索引命令同步执行，`KeyboardInterrupt` 退出码 130（`cli/main.py:155-193`）。
- CLI 没有项目删除、数据库备份、索引历史、任务列表、记忆删除命令。

CLI 的多项目自动选择依赖 `Path.cwd()`，不适合 GUI；GUI 必须显式使用项目 ID。

### 2.6 数据层

#### 表与用途

| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `schema_migrations` | 迁移版本与校验和 | `version` 主键 |
| `projects` | 全局项目注册表 | `slug` 唯一、`root_path` 唯一索引 |
| `sources` | 文件/文本/Agent/User 来源 | `(project_id, source_type, uri)` 唯一 |
| `nodes` | 文件、类、函数、文档、章节、记忆、笔记 | `id` 唯一；`(source_id, node_type, node_key)` 唯一；类型/路径/qualified name 索引 |
| `node_fts` | FTS5 外部内容表 | `title`、`search_text`、`tags`；`content='nodes'` |
| `relations` | 知识图谱边 | `(from_node_id, to_node_id, relation_type)` 唯一；from/to/type/status 索引 |
| `unresolved_refs` | 未解析 import/call/inherit/link | 项目、来源、目标索引 |
| `tasks` | 索引任务队列 | claim 索引；无 `run_id` 列 |
| `index_runs` | 索引运行记录 | 项目 + 开始时间索引 |

事实：

- 只有一份迁移：`storage/sqlite/schema/0001_init.sql`。
- 记忆不是独立表，而是 `nodes` 中 `node_type='memory'` 或 `'note'` 的行。
- `nodes.version` 已存在，可用于乐观并发；当前 Tools 没有暴露 ETag/If-Match。
- `nodes.tags` 是空格分隔文本，原始数组保存在 `metadata_json.tags`；FTS 将 tags 作为独立列。
- `nodes.memory_type` 有枚举，但只有 `NodeRepository.memories()` 支持按类型过滤。
- `relations.project_id` 存在，但没有单独项目索引；`get_neighbors` 不按项目过滤，依赖调用方传入同项目节点。
- `SourceRepository.list_for_project` 返回 active 和 deleted 来源，不区分状态。
- `NodeRepository.get` 不限制 status；`search_fts` 等查询大多只取 active。
- `NodeRepository.counts` 和 `RelationRepository.counts` 不按 status 过滤。
- `all_for_project` 的硬上限是 100000 节点 / 200000 关系，不适合直接作为 GUI 全图接口。

#### Repository 能力与缺口

已有：

- 项目解析：id、slug、规范化根路径（`repositories.py:207-224`）。
- FTS 搜索、精确符号、路径查找、按来源列节点、top salience、recent、memories（`repositories.py:562-713`）。
- 单跳邻居、跨路径连接统计、全项目节点/关系读取（`repositories.py:873-1012`）。
- 任务 claim/complete/fail/cancel/counts（`repositories.py:1113-1247`）。
- 最新 index run（`repositories.py:1317-1333`）。

缺口：

- 全层没有 OFFSET/cursor 分页，只有 `LIMIT`。
- 没有文件树/目录层级查询，只有扁平 `sources` 和节点 `path`。
- 没有按 path 安全读取源码正文的 Repository/Service。
- 没有 `IndexRunRepository.list_for_project`、`get`。
- 没有记忆 update/delete/list-by-tag。
- 没有 `TaskRepository.list` 或 run 关联；tasks 没有 `run_id`。
- 没有关系类型聚合统计。
- 没有全文搜索 `total` 命中数。

### 2.7 配置与启动

- `Settings` 使用 Pydantic Settings，优先级：显式 Settings > 环境变量 > TOML > 默认值（`config.py:97-113`）。
- `SYNAPSE_HOME` 决定 home；`SYNAPSE_CONFIG` 决定配置文件（`config.py:21-38`）。
- 数据库路径优先级：`database_path` > `storage.path` > `<home>/synapse.db`（`config.py:121-126`）。
- `build_application()` 启动时执行迁移检查和 `PRAGMA user_version = 1`（`bootstrap.py:57-64`、`database.py:66-69`）。
- `logging` 配置结构存在但未接线（`config.py:78-80`、`docs/configuration.md:108-110`）。
- MCP 日志固定 `INFO`，不读取 `Settings.logging.level`。

GUI 必须显式传入 `Settings(home=...)` 或继承默认配置；不能让前端决定数据库路径。

### 2.8 可直接复用的能力

| 能力 | 现有入口 | 复用方式 |
| --- | --- | --- |
| 项目注册/列表/状态 | `ProjectTools.register/list_projects/status` | 直接调用，适配层补 HTTP 校验和响应封装 |
| 项目统计 | `ProjectTools.status` | 直接调用；补充 task counts |
| 搜索 | `SearchTools.search` | 强制 `project`，限制 limit |
| 相关节点 | `SearchTools.get_related` | 适配层先做项目归属校验 |
| 局部图谱 | `SearchTools.explore_graph` | 适配层补项目校验、节点类型过滤、响应上限 |
| 项目上下文 | `SearchTools.get_context` | Overview/AI 面板直接复用 |
| 记忆创建 | `MemoryTools.remember` | 直接调用 |
| 记忆检索 | `MemoryTools.recall` | 强制项目 |
| 记忆详情 | `MemoryTools.get` | 强制项目 |
| 索引执行 | `ProjectTools.index` | 在独立进程/后台任务中调用，不阻塞 API 事件循环 |
| 索引状态 | `ProjectTools.status.last_run`、`IndexRunRepository.latest` | 轮询读取 |
| 项目删除 | `ProjectRepository.delete` | 当前未暴露，Phase 3.2 再设计 |

### 2.9 不适合 GUI 直接调用的接口

| 接口/行为 | 问题 | GUI 处理 |
| --- | --- | --- |
| `ProjectTools.index` | 同步阻塞、无 run_id、无进度/取消、返回完整 errors | 独立 worker 进程 + Job Manager；轮询 latest run |
| `SearchTools.search` | 无分页、`project=None` 可跨项目、结果无正文 | 强制 project、限制 limit、详情另取 |
| `SearchTools.get_related` | 无 project 参数、无归属校验 | 适配层校验节点 |
| `SearchTools.explore_graph` | 无 project 参数、无 node_type 过滤、无分页 | 适配层校验、过滤、上限 |
| `MemoryTools.recall` | 无 memory_type/tag 过滤、混入 NOTE | 适配层过滤或新增只读查询 |
| `MemoryTools.get` | project 可选、不传不校验 | API 强制 project |
| `ProjectTools.list_projects` | 无分页 | 适配层分页 |
| `NodeRepository.all_for_project` | 最多 100000，不能直接给前端 | 禁止全图接口，只用局部展开 |
| `RelationRepository.all_for_project` | 最多 200000，不能直接给前端 | 禁止全图接口 |
| `Database.close` | 只关闭当前线程连接 | Core 固定工作线程，或每线程独立 Application |
| 裸 `RuntimeError`/`sqlite3.OperationalError` | 不是稳定业务错误 | API 统一错误映射与日志 |

### 2.10 需要新增的 GUI 专用适配层

建议新增在 `src/synapse/integrations/gui/`，不放进 `domain` 或 Tools：

| 组件 | 职责 |
| --- | --- |
| `api/app.py` | FastAPI 应用、路由注册、lifespan、CORS/Origin/Host 中间件 |
| `api/auth.py` | 启动 Token、Bearer 校验、Host/Origin 校验、速率限制 |
| `api/errors.py` | `SynapseError`/SQLite busy/未知异常到 HTTP 错误的映射 |
| `api/schemas.py` | Pydantic 请求/响应模型；生成 OpenAPI |
| `api/deps.py` | 项目解析、节点归属、路径校验、分页参数 |
| `core_worker.py` | 单线程 Core worker，持有 `Application`，串行调用 |
| `query_service.py` | GUI 只读组合查询：overview、文件树、图 overview、facets |
| `memory_service.py` | 记忆 update/delete（待设计，Phase 3.2） |
| `index_jobs.py` | 索引 Job Manager；独立进程执行现有 `ProjectTools.index` |
| `file_access.py` | 受控源码读取、路径 containment、大小/行数限制 |
| `static/` | 构建后的 React SPA（生产模式） |

这些适配层只做协议、校验、组合和进程管理，不复制业务逻辑。

### 2.11 SQLite 并发现状

事实：

- `Database` 使用 `threading.local()` 每线程缓存连接（`database.py:25`、`43-48`）。
- 连接参数：`timeout=busy_timeout_ms/1000`、`isolation_level=None`、`foreign_keys=ON`、`busy_timeout`、`temp_store=MEMORY`（`database.py:28-41`）。
- WAL 开启时设置 `journal_mode=WAL`、`synchronous=NORMAL`（`database.py:38-40`）。
- 写事务使用进程内 `RLock` + `BEGIN IMMEDIATE`；读事务不显式 `BEGIN`（`database.py:50-64`）。
- 默认 `busy_timeout_ms=5000`、`wal=true`（`config.py:49-52`）。
- 同一项目索引有 `<home>/locks/index-<project_id>.lock`，默认超时 30 秒（`ingestion/locking.py:10-17`、`config.py:59`）。
- 不同项目可并发索引，但共享 SQLite 单写锁。
- MCP 每个进程有独立 Application 和单 worker；不与其他进程共享连接。
- SQLite busy/locked 没有统一转换为 `DatabaseBusy`；`DatabaseBusy` 已定义但未使用（`errors.py:34-35`）。
- 没有全局写队列、busy 重试、`wal_checkpoint` 或 `journal_size_limit` 设置。
- 读语句没有跨多语句快照；轮询可能看到不同提交点。

结论：

- 多进程同时读通常可行。
- 多进程同时写受 SQLite 单写者限制，可能因 5 秒 busy_timeout 失败。
- 不能声称 SQLite 并发问题已解决。
- GUI 设计必须把写入串行化、缩短事务、映射 `DB_BUSY`，并通过 Spike 验证 MCP + GUI 同时读写。

### 2.12 多项目与多实例现状

- 单库多项目；`projects` 表是全局注册表；`project_id` 是隔离键。
- 项目 ID 是规范化根路径的稳定 UUID5；slug 冲突自动加后缀。
- 没有后台守护进程；CLI 每次启动独立进程。
- MCP 每个 Server 进程独立。
- 同一项目索引由 FileLock 串行化；不同项目仍共享 SQLite 写锁。
- 没有项目级数据库文件；没有每项目独立 home。
- 没有多 GUI 窗口协调机制；Phase 3.1 应由单个 API 进程承载多个窗口。

## 3. 通信方案对比

### 3.1 方案 A：FastAPI 本地 HTTP Server

React GUI 通过 `127.0.0.1` HTTP API 访问 Python Core。

优点：

- 与现有 Python Core 兼容性最高；直接复用 `build_application()`。
- 不要求 Rust、Node sidecar 打包或 Tauri 进程模型。
- Windows 开发和调试简单：`uvicorn` + Vite dev server。
- 未来可以同一套 API 支持 Web、Tauri、Electron 或其他本地壳。
- OpenAPI 可生成 TypeScript 类型，减少前后端契约漂移。
- 索引可以独立子进程运行，API 保持响应。

风险：

- localhost 不是自动安全；必须处理 Origin、Host、Token、CORS、CSRF。
- 需要新增 FastAPI/Uvicorn 依赖和 API 适配层。
- 需要自己实现索引 Job Manager 和错误映射。
- 多进程写 SQLite 的 busy 风险仍然存在。

适用条件：

- 接受“先本地 Web UI，后续再做桌面壳”。
- 接受新增可选 `gui` 依赖。
- 接受 API 适配层作为新的集成边界。

### 3.2 方案 B：Tauri + Python Sidecar

Tauri 负责桌面窗口和进程管理，Python Core 作为 sidecar。

优点：

- 桌面应用体验和安装包更完整。
- Tauri IPC 可以避免浏览器 localhost 暴露面。
- 前端资源可打包进桌面应用。
- 未来可以做系统托盘、文件选择器、自动更新。

风险：

- 需要 Rust/Tauri 工具链和 Windows 签名/发布流程。
- Python 运行时、tree-sitter、SQLite、依赖和资源路径需要打包。
- sidecar 生命周期、崩溃重启、端口/IPC、升级迁移都要自己处理。
- 调试链路比 FastAPI + Vite 长。
- 当前项目没有前端和桌面基础设施，Phase 3.0 直接上 Tauri 会把风险前置。
- Tauri IPC 仍需要设计项目隔离、路径安全、Token/权限和错误协议。

结论：适合 Phase 3.3/3.4 的桌面发布阶段，不适合作为 Phase 3.1 的第一步。

### 3.3 方案 C：其他方案

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| Electron + Python sidecar | 前端生态成熟 | 包体大、内存高、Python 打包仍复杂 | 不推荐 |
| pywebview + Python 内置 HTTP/JS bridge | 依赖少、Windows 简单 | UI 生态弱、调试和组件化差、跨平台体验一般 | 不作为主方案 |
| 纯 CLI/TUI | 无浏览器安全面 | 不满足知识图谱可视化目标 | 不满足需求 |
| 直接让 React 读 SQLite | 少一层 API | 浏览器不能安全访问 SQLite；破坏分层；跨项目/路径风险 | 禁止 |
| 通过 MCP stdio 给 GUI | 复用协议 | stdio 面向 Agent，单 worker，不适合浏览器并发和生命周期 | 不推荐 |

### 3.4 对比矩阵

评分：1 最差，5 最好。

| 维度 | FastAPI | Tauri + Sidecar | Electron + Sidecar | pywebview |
| --- | ---: | ---: | ---: | ---: |
| 开发复杂度（越高越好） | 4 | 2 | 2 | 3 |
| 与现有 Core 兼容性 | 5 | 3 | 3 | 3 |
| 本地优先程度 | 4 | 5 | 4 | 5 |
| 安全性（默认暴露面） | 3 | 4 | 3 | 4 |
| Windows 部署难度（越高越易） | 4 | 2 | 2 | 3 |
| 跨平台扩展能力 | 4 | 4 | 4 | 2 |
| 开发调试体验 | 5 | 2 | 3 | 3 |
| 未来维护成本（越高越低） | 4 | 2 | 2 | 3 |

### 3.5 推荐方案

推荐 **方案 A：FastAPI 本地 HTTP + React/Vite SPA**。

理由：

1. 现有 Core 是 Python，FastAPI 是同一运行时内的薄适配层，不需要第二套业务实现。
2. React GUI 需要的是结构化 JSON、分页、错误码和 OpenAPI 契约，HTTP 比 Tauri IPC 更直接。
3. 索引任务可以独立子进程执行，避免阻塞 GUI API。
4. 后续如果确实需要桌面安装包，可以在 FastAPI 外面加 Tauri/Electron 壳，而不重写 API 和前端。
5. Tauri 的打包、签名、sidecar 生命周期和升级迁移不是当前阶段的成功标准。

推荐的前提：

- 必须实现本地 Token、Host/Origin 校验、严格 CORS 和项目隔离。
- 必须新增 GUI 适配层，不把业务逻辑放进 React 或 FastAPI 路由。
- 必须通过 Spike 验证 SQLite 并发和 API 关闭后的前端错误状态。
- 不默认监听 `0.0.0.0`，不允许任意 Origin，不把 Token 写死在前端。

## 4. 推荐架构

### 4.1 逻辑架构

```text
React SPA
  |
  |  HTTP /api/v1 + Bearer Token + Origin/Host 校验
  v
FastAPI GUI Adapter
  |-- auth / errors / schemas / deps
  |-- query_service（只读组合查询）
  |-- memory_service（Phase 3.2）
  |-- index_jobs（独立进程）
  |-- file_access（受控源码读取）
  |
  v
Core Worker（单线程，持有 Application）
  |
  v
现有 Tools / Services / Repositories
  |
  v
SQLite + FTS5
```

### 4.2 进程模型

Phase 3.1 推荐：

- **1 个 GUI API 进程**：FastAPI + 单 Core worker 线程。
- **0..1 个索引子进程/项目**：由 Job Manager 启动，执行现有索引逻辑。
- **0..N 个 MCP 进程**：与 GUI 独立，继续 stdio。
- 所有进程共享同一个 `<home>/synapse.db`。

不推荐在 Phase 3.1：

- 多个 API 进程同时监听同一端口。
- 在 API 事件循环中直接执行同步索引。
- 让 React 直接访问 SQLite。
- 让 API 内部再启动一个 MCP Server 作为代理。

### 4.3 生命周期

FastAPI lifespan：

1. 读取 `Settings`（默认或显式 `SYNAPSE_HOME`）。
2. 生成每次启动唯一的 256-bit Token，仅保存在内存。
3. 启动单线程 Core worker；在 worker 线程调用 `build_application(settings)`。
4. 启动 Job Manager，清理/标记上次进程遗留的 running job（只读检查，不修改真实数据）。
5. 应用退出时在 worker 线程调用 `Application.close()`，关闭 executor，停止 Job Manager。
6. 索引子进程由 Job Manager 管理；API 退出时不得强杀正在写数据库的索引进程，应等待或标记为孤儿，让下次索引恢复。

### 4.4 为什么单 worker

`Database` 使用 thread-local 连接，`Application.close()` 只关闭当前线程连接（`database.py:96-100`）。MCP 已采用“单 worker 线程 + 同线程关闭”的模式（`mcp/server.py:40-87`）。

Phase 3.1 采用同样模式：

- 避免多线程共享同一个 `Application`。
- 保证连接创建、使用、关闭在同一线程。
- 读请求串行，但本地单用户可接受；搜索限制 50，局部图限制 200。
- 索引在独立进程，不阻塞 API。

后续如果需要并发读，可扩展为“每 worker 线程一个 Application”的 Core worker pool，但必须单独验证 SQLite 写竞争和连接关闭。

### 4.5 GUI 适配层职责

- 参数校验：Pydantic、范围、枚举、路径。
- 项目解析：所有项目级接口先解析 `project_id`。
- 项目隔离：节点、边、文件、记忆必须属于该项目。
- 分页/上限：统一 `limit`、`cursor`、最大返回规模。
- 错误映射：`SynapseError`、`sqlite3.OperationalError`、未知异常。
- 响应封装：稳定 `data/page` 或 `error`。
- 索引 Job：启动、状态、去重、清理。
- 源码读取：只读已索引 Source，路径 containment。
- 日志：请求 ID、状态码、耗时；不记录 Token、源码、记忆正文。

## 5. GUI API 设计

### 5.1 基本约定

- Base URL：`/api/v1`
- 仅监听 `127.0.0.1`，生产模式由 FastAPI 直接提供 SPA 静态资源，避免跨端口 CORS。
- 所有 `/api/v1/*`（除 `/health`）要求 `Authorization: Bearer <token>`。
- 请求/响应：`application/json; charset=utf-8`。
- 项目级路径统一使用稳定 `project_id`，不使用显示名或相对路径。
- 成功响应：

```json
{
  "data": {}
}
```

- 列表/图谱响应：

```json
{
  "data": {
    "items": []
  },
  "page": {
    "limit": 50,
    "next_cursor": null
  }
}
```

- 错误响应：

```json
{
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "项目不存在",
    "details": {},
    "request_id": "..."
  }
}
```

选择统一错误 envelope 的原因：现有 CLI 的 `{"error": ...}` 与 MCP 的 `ToolError` 不同；GUI 需要稳定的 HTTP 契约，但不要求 Core 改变异常模型。

### 5.2 HTTP 状态码映射

| 业务错误 | HTTP | 说明 |
| --- | ---: | --- |
| `INVALID_ARGUMENT` | 400 | 参数、枚举、路径、范围错误 |
| `UNAUTHENTICATED` | 401 | 缺失/错误 Token |
| `ORIGIN_NOT_ALLOWED` | 403 | Origin/Host 校验失败 |
| `FORBIDDEN` | 403 | 跨项目访问或不允许的操作 |
| `PROJECT_NOT_FOUND` | 404 | 项目不存在 |
| `NODE_NOT_FOUND` | 404 | 节点/关系/文件不存在 |
| `CONFLICT_VERSION` | 409 | 记忆更新版本冲突（Phase 3.2） |
| `INDEX_LOCKED` | 423 | 同项目索引进行中 |
| `DB_BUSY` | 503 | SQLite busy/locked，可重试 |
| `INDEX_UNAVAILABLE` | 503 | FTS 不可用 |
| `PAYLOAD_TOO_LARGE` | 413 | 文件/记忆/图谱超过上限 |
| `NOT_IMPLEMENTED` | 501 | 未开放的记忆编辑/删除等 |
| `INTERNAL` | 500 | 未预期异常，不返回 traceback |

### 5.3 分页策略

- 统一使用不透明 `cursor`，不使用 `offset`。
- `limit` 默认值和最大值按接口定义。
- `next_cursor=null` 表示没有更多。
- Cursor 建议编码：

```json
{"v":1,"k":"updated_at|name|path","id":"..."}
```

- 对现有 Core 没有原生 cursor 的接口，适配层可以做“有界切片 + cursor 绑定索引时间”；如果 `last_indexed_at` 变化，cursor 失效并返回 409/重新从第一页开始。
- 不承诺跨索引运行的稳定分页；GUI 应在索引完成时失效相关 Query。

### 5.4 最大返回规模

| 类型 | 默认 | 最大 | 说明 |
| --- | ---: | ---: | --- |
| 项目列表 | 100 | 500 | 本地项目通常很少 |
| 搜索结果 | 10 | 50 | 受 `RetrievalService` 限制 |
| 相关节点 | 20 | 100 | 受 `related` 限制 |
| 图节点 | 50 | 200 | 禁止全图 |
| 图边 | 200 | 1000 | 与节点一起截断 |
| 图深度 | 1 | 3 | 受 `explore_graph` 限制 |
| 文件树条目 | 200 | 500 | 单次目录层级 |
| 文件正文 | 200 KB | 2 MB | 与 `max_file_bytes` 对齐 |
| 源码行数 | 500 | 2000 | 单次片段 |
| 记忆正文 | 200 KB | 200000 字符 | 与现有 MCP 一致 |
| 错误列表 | 20 | 100 | 超出截断并标记 |

### 5.5 端点总表

#### Project

| Method | URL | 说明 | 现有能力 |
| --- | --- | --- | --- |
| GET | `/projects` | 项目列表 | `ProjectTools.list_projects` |
| POST | `/projects` | 注册项目 | `ProjectTools.register` |
| GET | `/projects/{project_id}` | 项目详情 | `ProjectRepository.resolve` |
| GET | `/projects/{project_id}/status` | 状态/统计/最近 run | `ProjectTools.status` |
| GET | `/projects/{project_id}/stats` | 纯统计 | `ProjectTools.status.stats` |
| GET | `/projects/{project_id}/overview` | Overview 组合读模型 | `ProjectTools.status` + `ContextBuilder` |
| GET | `/projects/{project_id}/modules` | 模块分布 | `path_connection_counts` + `modules_for_paths`（新增适配） |

`POST /projects` 请求：

```json
{
  "path": "D:\\work\\my-project",
  "name": "My Project"
}
```

约束：

- `path` 必须是绝对路径、存在的目录。
- 仅本地已认证用户可调用；这是特权操作，不是任意文件读取。
- 已注册根路径直接返回已有项目，保持现有幂等语义。

`GET /projects/{project_id}/overview` 响应：

```json
{
  "data": {
    "project": {},
    "stats": {
      "nodes": 716,
      "node_types": {"file": 84, "class": 120},
      "relations": 1364,
      "sources": 85,
      "unresolved_refs": 453
    },
    "tech_stack": [],
    "top_modules": [],
    "recent_changes": [],
    "last_run": {},
    "tasks": {"queued": 0, "running": 0, "succeeded": 0, "failed": 0}
  }
}
```

`tasks` 由 `TaskRepository.counts` 提供；当前没有 run 关联。

#### Graph

| Method | URL | 说明 | 现有能力 |
| --- | --- | --- | --- |
| GET | `/projects/{id}/graph/overview` | 初始骨架图 | 新增适配：top modules + cross-module + `explore_graph` |
| GET | `/projects/{id}/graph/nodes/{node_id}` | 节点详情 | `NodeRepository.get` + 项目校验 |
| GET | `/projects/{id}/graph/nodes/{node_id}/neighbors` | 局部展开 | `explore_graph`/`get_neighbors` |
| POST | `/projects/{id}/graph/expand` | 批量节点展开 | 新增适配 |
| GET | `/projects/{id}/graph/edges/{relation_id}` | 关系详情 | `RelationRepository.get` + 项目校验 |
| GET | `/projects/{id}/graph/search` | 图中定位 | 复用搜索 |
| GET | `/projects/{id}/graph/facets` | 类型计数（可选） | 新增只读聚合，Phase 3.2 |

图谱原则：

- 不提供“返回整个项目全部节点和边”的接口。
- 初始图只返回骨架，建议最多 120 个节点、600 条边。
- 用户点击节点后局部展开，深度默认 1，最大 3。
- 每次响应带 `truncated`；如果为 `true`，前端显示“结果已截断，请缩小过滤条件或从具体节点展开”。
- 节点/边按稳定顺序排序：`node_type, path, start_line, node_id`；边按 `relation_type, relation_id`。
- `node_types` 和 `relation_types` 在服务端过滤，不能只靠前端隐藏。
- 图谱查询必须有超时/规模上限；禁止 `all_for_project` 直接暴露。

`GET /graph/overview` 响应：

```json
{
  "data": {
    "nodes": [
      {
        "node_id": "...",
        "node_type": "class",
        "title": "ContextBuilder",
        "path": "src/synapse/context/builder.py",
        "start_line": 34,
        "end_line": 384,
        "summary": "...",
        "language": "python",
        "salience": 0.8,
        "confidence": 1.0,
        "updated_at": "...",
        "selection_reason": "cross_module_links"
      }
    ],
    "edges": [
      {
        "relation_id": "...",
        "from_node_id": "...",
        "to_node_id": "...",
        "relation_type": "IMPORTS",
        "confidence": 0.9,
        "weight": 1.0
      }
    ],
    "truncated": false
  },
  "page": {
    "limit": 120,
    "next_cursor": null
  }
}
```

`GET /graph/nodes/{node_id}` 响应可包含 `content`，但必须限制大小；默认返回 `content_preview`，完整内容通过受控源码接口获取。

`POST /graph/expand` 请求：

```json
{
  "node_ids": ["..."],
  "depth": 1,
  "direction": "both",
  "relation_types": ["IMPORTS", "CALLS"],
  "node_types": ["file", "class", "function"],
  "limit": 100
}
```

约束：

- `node_ids` 最多 20 个。
- `depth` 0..2（批量展开建议 1）。
- `limit` 1..200。
- 所有节点必须属于当前项目。
- 返回合并去重后的节点/边，带 `truncated`。

#### Code Browser

| Method | URL | 说明 | 现有能力 |
| --- | --- | --- | --- |
| GET | `/projects/{id}/files` | 文件树/目录条目 | 新增适配：从 active Sources 构造 |
| GET | `/projects/{id}/files/{path:path}` | 文件详情/符号 | `find_by_path` + `get_by_source` |
| GET | `/projects/{id}/files/{path:path}/content` | 受控源码读取 | 新增 `FileAccessGuard` |
| GET | `/projects/{id}/files/{path:path}/symbols` | 文件内类/函数/方法 | `get_by_source` |
| GET | `/projects/{id}/nodes/{node_id}/source` | 节点源码片段 | 节点 content 或受控文件读取 |

文件树：

- 只列出 active 且 `source_type=file` 的 Source，不读取任意目录。
- 从 `sources.uri` 的 POSIX 相对路径构造目录层级。
- `parent_path` 必须是项目内相对路径；拒绝绝对路径、盘符、UNC、`..`。
- `depth` 1..3；单次最多 500 条目。
- 二进制、超大文件、被 ignore 的文件不会出现在树中，这是现有索引边界。

源码读取安全：

- 只允许 active Source 的 `uri`。
- `path.resolve()` 必须位于 `project.root_path.resolve()` 内。
- 拒绝符号链接/重解析点逃逸。
- 最大 2 MB、最多 2000 行。
- 返回 `content`、`start_line`、`end_line`、`language`、`truncated`。
- 不提供任意路径参数；不接受 `D:\`、`\\server\share`、`..`。

#### Search

| Method | URL | 说明 | 现有能力 |
| --- | --- | --- | --- |
| GET | `/projects/{id}/search` | 全文/符号搜索 | `SearchTools.search` |
| GET | `/projects/{id}/search/symbols` | 符号搜索 | 搜索 + node_types |
| GET | `/projects/{id}/search/related` | 相关节点 | `SearchTools.get_related` |
| GET | `/projects/{id}/context` | 任务上下文 | `SearchTools.get_context` |

搜索约束：

- `project` 必填，禁止跨项目全局搜索。
- `mode` 仅 `keyword`/`hybrid`；不暴露不可用的 `semantic`。
- `limit` 1..50。
- `path_prefix` 只允许项目内相对路径，拒绝绝对路径和 `..`。
- 搜索无原生分页；Phase 3.1 可只返回第一页，`next_cursor=null`，并在 UI 说明“最多 50 条”；Phase 3.2 再增加 cursor。

#### Memory

| Method | URL | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/projects/{id}/memories` | 记忆列表/筛选 | 可基于 `NodeRepository.memories`，tag/cursor 待扩展 |
| GET | `/projects/{id}/memories/{node_id}` | 完整记忆 | 现有 `MemoryTools.get` |
| POST | `/projects/{id}/memories` | 新增记忆 | 现有 `MemoryTools.remember` |
| PATCH | `/projects/{id}/memories/{node_id}` | 编辑记忆 | **待设计/Phase 3.2** |
| DELETE | `/projects/{id}/memories/{node_id}` | 删除记忆 | **待设计/Phase 3.2** |
| GET | `/projects/{id}/memory-tags` | 标签聚合 | **待设计/Phase 3.2** |

列表查询参数：

```text
memory_type=fact|experience|decision|preference|summary
tag=<exact tag>
q=<optional text>
limit=50
cursor=<opaque>
```

当前能力与缺口：

- `NodeRepository.memories` 支持 `memory_type` 和 limit，不支持 tag、q、cursor。
- `recall` 支持 q，但混入 NOTE，且返回 snippet。
- tags 存在 `nodes.tags` 和 `metadata_json.tags`，没有 SQL 级精确 tag 索引。
- 记忆详情可复用 `MemoryTools.get`。
- 记忆创建可复用 `MemoryTools.remember`。

记忆编辑/删除的安全设计：

- 不得绕过 Repository 直接 SQL。
- 更新必须新增 `MemoryService.update_memory()`（Phase 3.2），复用 `NodeRepository`/`KnowledgeService`，保留 `source_id` 和 `node_id`，更新 title/content/tags/metadata、`search_text`、`content_hash`、`summary`、`updated_at`、`version`。
- 更新使用 `If-Match: <version>`；版本不匹配返回 409 `CONFLICT_VERSION`。`nodes.version` 已存在，无需 Schema 修改。
- 删除必须新增 `MemoryService.delete_memory()`，校验项目归属和 `memory`/`note` 类型，再调用 `KnowledgeService.delete_source()`；当前语义是 Source 软删除、节点硬删除、关系级联删除。
- 删除前需要 UI 二次确认；不做“回收站/撤销”，除非未来单独设计。
- 记忆更新/删除在实现前返回 `501 NOT_IMPLEMENTED`，不能假装已支持。
- tags 精确过滤需要新增只读查询或在适配层有界过滤；Phase 3.2 再定。

#### Indexing

| Method | URL | 说明 | 状态 |
| --- | --- | --- | --- |
| GET | `/projects/{id}/index/status` | 最近 run + task counts + job | 可组合现有能力 |
| GET | `/projects/{id}/index/runs` | 索引历史 | **待新增 Repository list** |
| GET | `/projects/{id}/index/runs/{run_id}` | 单次 run | **待新增 Repository get** |
| POST | `/projects/{id}/index` | 触发增量/全量 | 新增 Job Manager |
| GET | `/projects/{id}/index/jobs/{job_id}` | 任务状态 | 新增 Job Manager |
| DELETE | `/projects/{id}/index/jobs/{job_id}` | 取消 | **暂不支持，返回 501/409** |
| GET | `/projects/{id}/index/jobs/{job_id}/events` | SSE | Phase 3.2 可选 |

触发请求：

```json
{
  "mode": "incremental",
  "workers": 4
}
```

响应：`202 Accepted`

```json
{
  "data": {
    "job_id": "...",
    "project_id": "...",
    "mode": "incremental",
    "status": "queued",
    "created_at": "..."
  }
}
```

Job 状态：

```json
{
  "data": {
    "job_id": "...",
    "project_id": "...",
    "mode": "incremental",
    "status": "running",
    "run_id": "...",
    "started_at": "...",
    "finished_at": null,
    "progress": {
      "scanned": 84,
      "changed": 12,
      "unchanged": 72,
      "nodes_upserted": 120,
      "relations_upserted": 80,
      "failed": 0,
      "errors": []
    },
    "tasks": {
      "queued": 3,
      "running": 1,
      "succeeded": 8,
      "failed": 0,
      "canceled": 0
    }
  }
}
```

索引设计事实：

- `ProjectTools.index` 同步阻塞；不能直接在 FastAPI 事件循环执行。
- `IndexRunRepository.latest` 可读最近一次 run 的 stats，但 `ProjectTools.index` 不返回 run_id。
- `tasks` 没有 `run_id`，不能把任务精确关联到 run。
- `IndexStats` 没有 `processed`/`total_tasks`/百分比。
- 没有取消 API；只有 `KeyboardInterrupt` 分支。
- 没有 run 历史列表。

推荐 Job Manager：

- 每个项目最多一个 active job。
- API 进程内维护 job 元数据（job_id、project_id、mode、状态、run_id、时间）。
- 通过独立进程执行现有索引逻辑，避免阻塞 API。
- 子进程可以使用 `python -m synapse.integrations.gui.index_worker`（Phase 3.1 新增适配模块），内部调用 `build_application()` + `ProjectTools.index`；不复制索引业务。
- 进度只显示已有字段，不伪造百分比。
- 如果无法拿到 run_id，Job 状态只显示 latest run；Phase 3.1 可接受，Phase 3.2 再增加可选 `run_id` 返回。
- 取消暂不支持；UI 显示“正在运行，暂不支持取消”。
- API 重启后，内存 job 丢失；通过 latest run/tasks 显示最近状态，并提示“上次任务状态可能已丢失”。

### 5.6 请求/响应契约摘要

下表是 Phase 3.1 的契约冻结候选。所有项目级接口都要求 Token，并先解析 `project_id`。

| 接口 | Request | Response | 主要错误 | 上限/分页 |
| --- | --- | --- | --- | --- |
| `GET /projects` | 无 | `Page<ProjectSummary>` | 401/500 | limit 100/500，cursor |
| `POST /projects` | `{path, name?}` | `201 ProjectSummary` | 400/401/409 | 路径必须是绝对目录 |
| `GET /projects/{id}` | 无 | `ProjectSummary` | 401/404 | 单条 |
| `GET /projects/{id}/status` | 无 | `ProjectStatus` | 401/404/503 | 单条 |
| `GET /projects/{id}/stats` | 无 | `Stats` | 401/404/503 | 单条 |
| `GET /projects/{id}/overview` | 无 | `Overview` | 401/404/503 | 单条 |
| `GET /projects/{id}/modules` | `limit` | `Page<ModuleSummary>` | 401/404/503 | limit 50/200 |
| `GET /projects/{id}/graph/overview` | `max_nodes,node_types,relation_types` | `GraphPayload` | 400/401/404 | 节点 200，边 1000 |
| `GET /projects/{id}/graph/nodes/{node_id}` | 无 | `NodeDetail` | 401/404 | 正文预览上限 200 KB |
| `GET /projects/{id}/graph/nodes/{node_id}/neighbors` | `depth,direction,relation_types,node_types,limit,cursor` | `GraphPayload` | 400/401/404 | depth 3，节点 200 |
| `POST /projects/{id}/graph/expand` | `{node_ids,depth,direction,relation_types,node_types,limit}` | `GraphPayload` | 400/401/404/413 | node_ids 20，节点 200 |
| `GET /projects/{id}/graph/edges/{relation_id}` | 无 | `EdgeDetail` | 401/404 | 单条 |
| `GET /projects/{id}/graph/search` | `q,node_types,limit` | `SearchPage` | 400/401/404/503 | limit 50 |
| `GET /projects/{id}/files` | `parent_path,depth,limit,cursor` | `Page<FileEntry>` | 400/401/404 | depth 3，条目 500 |
| `GET /projects/{id}/files/{path:path}` | 无 | `FileDetail` | 400/401/404 | 仅 active Source |
| `GET /projects/{id}/files/{path:path}/content` | `start_line,end_line` | `FileContent` | 400/401/404/413 | 2 MB，2000 行 |
| `GET /projects/{id}/files/{path:path}/symbols` | 无 | `Page<SymbolSummary>` | 400/401/404 | limit 500 |
| `GET /projects/{id}/nodes/{node_id}/source` | `context_lines` | `SourceSnippet` | 400/401/404/413 | 2000 行 |
| `GET /projects/{id}/search` | `q,mode,node_types,path_prefix,limit,cursor` | `SearchPage` | 400/401/404/503 | limit 50 |
| `GET /projects/{id}/search/symbols` | `q,limit` | `SearchPage` | 400/401/404/503 | limit 50 |
| `GET /projects/{id}/search/related` | `node_id,relation_types,include,limit` | `RelatedPayload` | 400/401/404 | limit 100 |
| `GET /projects/{id}/context` | `query,max_tokens,sections` | `ContextPayload` | 400/401/404 | max_tokens 100..20000 |
| `GET /projects/{id}/memories` | `memory_type,tag,q,limit,cursor` | `Page<MemorySummary>` | 400/401/404 | limit 50；tag/cursor 待扩展 |
| `GET /projects/{id}/memories/{node_id}` | 无 | `MemoryDetail` | 401/404 | 正文 200000 字符 |
| `POST /projects/{id}/memories` | `{content,title?,memory_type?,tags?,confidence?,idempotency_key?}` | `201 MemoryDetail` | 400/401/404/413 | content 200000 |
| `PATCH /projects/{id}/memories/{node_id}` | `{title?,content?,tags?,confidence?,memory_type?}` + `If-Match` | `200 MemoryDetail` | 400/401/404/409/501 | Phase 3.2 |
| `DELETE /projects/{id}/memories/{node_id}` | `If-Match?` | `204` | 401/404/409/501 | Phase 3.2 |
| `GET /projects/{id}/index/status` | 无 | `IndexStatus` | 401/404/503 | 单条 |
| `GET /projects/{id}/index/runs` | `limit,cursor` | `Page<IndexRunSummary>` | 401/404/501 | 需新增 Repository list |
| `GET /projects/{id}/index/runs/{run_id}` | 无 | `IndexRunDetail` | 401/404/501 | 需新增 Repository get |
| `POST /projects/{id}/index` | `{mode,workers?}` | `202 IndexJob` | 400/401/404/409/423 | 每项目一个 active job |
| `GET /projects/{id}/index/jobs/{job_id}` | 无 | `IndexJob` | 401/404 | 单条 |
| `DELETE /projects/{id}/index/jobs/{job_id}` | 无 | `501` | 401/404/501 | 暂不支持取消 |
| `GET /health` | 无 | `{status,version}` | 500 | 无敏感数据，免 Token |

通用校验：

- `project_id`、`node_id`、`relation_id` 必须是非空字符串。
- `limit`、`depth`、`max_tokens`、`start_line`、`end_line` 使用 Pydantic `Field` 限制。
- `path`/`path_prefix`/`parent_path` 统一 POSIX 分隔符；拒绝绝对路径、盘符、UNC、`..`。
- 请求体使用 `extra="forbid"`，避免前端误传字段被静默忽略。
- 所有写操作必须有明确副作用说明；GET 不得写数据库。

### 5.7 统一请求/响应 Schema 示例

项目摘要：

```json
{
  "id": "...",
  "slug": "synapse",
  "name": "Synapse",
  "root_path": "D:\\Synapse",
  "description": null,
  "last_indexed_at": "...",
  "created_at": "..."
}
```

节点摘要：

```json
{
  "node_id": "...",
  "node_type": "function",
  "title": "build_application",
  "path": "src/synapse/bootstrap.py",
  "start_line": 57,
  "end_line": 144,
  "summary": "...",
  "language": "python",
  "salience": 0.8,
  "confidence": 1.0,
  "updated_at": "..."
}
```

记忆详情：

```json
{
  "node_id": "...",
  "node_type": "memory",
  "memory_type": "decision",
  "title": "...",
  "content": "...",
  "tags": ["architecture", "sqlite"],
  "confidence": 1.0,
  "salience": 0.7,
  "summary": "...",
  "provenance": "user",
  "created_at": "...",
  "updated_at": "...",
  "version": 3
}
```

注意：`version` 目前不在 `MemoryTools.get` 返回中，Phase 3.2 需要补充；不是 Schema 修改。

## 6. API 安全设计

### 6.1 监听地址

- 默认只绑定 `127.0.0.1`。
- 禁止默认 `0.0.0.0`。
- 如需 IPv6，单独绑定 `::1`，不要隐式双栈暴露。
- 端口优先使用临时端口（`port=0`），启动后把实际端口写入用户级运行时文件或由启动器传递给前端。
- 固定端口时必须检测占用并给出明确错误，不自动切到公网接口。

### 6.2 其他设备访问

- 仅 loopback 监听，局域网设备不能直连。
- 不依赖 Windows 防火墙作为唯一防线。
- 不开启 UPnP、端口转发或远程访问。
- 不在 API 中提供“允许局域网访问”的默认开关。

### 6.3 恶意网页请求本地 API

localhost 不等于安全。浏览器中的恶意页面可以向 `127.0.0.1` 发请求。

必须：

- 所有敏感接口要求 `Authorization: Bearer`。
- 所有状态变更使用非简单请求（自定义头/JSON），触发预检。
- 校验 `Origin`，只允许 GUI 自身 Origin。
- 校验 `Host`，只允许 `127.0.0.1:<port>` / `localhost:<port>`，防止 DNS rebinding。
- 默认不返回 `Access-Control-Allow-Origin`；只有明确允许的开发 Origin 才返回。
- 拒绝 `Origin: null`。
- 对认证失败和异常请求做速率限制。
- GET 不产生副作用；所有写操作使用 POST/PATCH/DELETE。

### 6.4 CORS 与 Origin

- 生产模式：FastAPI 直接提供 SPA，浏览器同源，不需要 CORS。
- 开发模式：Vite `5173` 通过代理访问 API，浏览器仍视为同源；或只允许 `http://127.0.0.1:5173`。
- 禁止 `allow_origins=["*"]`。
- 禁止 `allow_credentials=True` + 任意 Origin。
- 对 `Origin` 缺失的请求：浏览器同源请求通常有 Origin；对无 Origin 的非浏览器客户端（如启动器）可单独允许，但必须带 Token。
- 对 `Referer` 做辅助校验，不作为唯一防线。

### 6.5 本地 API Token

推荐：

- 每次 API 启动生成 32 字节随机 Token（`secrets.token_urlsafe(32)`）。
- 只保存在进程内存，不写入仓库、不写入前端源码。
- 通过启动器把 Token 放入 URL fragment（`#token=...`）打开 SPA；前端读取后立即 `history.replaceState` 清除。
- 前端只在内存中保存 Token；刷新页面需要重新由启动器打开，或使用短期 HttpOnly session cookie + CSRF token。
- 请求使用 `Authorization: Bearer`，不要放 query string。
- 常量时间比较。
- 不在日志中输出 Token。
- 重启即轮换；不提供长期固定 Token。
- 开发模式可以由 Vite 代理注入 Token，浏览器端不持有 Token；或使用未跟踪的本地开发 Token 文件。

不推荐：

- Token 写死在前端 bundle。
- Token 写入 localStorage 长期保存。
- Token 放在 URL query（会进入历史/日志）。
- 无 Token 的“只监听 localhost 所以安全”。

### 6.6 项目路径任意读取

- 项目注册是特权操作；只有已认证本地用户可调用。
- 注册路径必须是绝对路径且是目录；服务端 `resolve()`。
- 项目级接口只使用 `project_id` 解析出的根路径。
- 不接受前端传入的任意根路径用于文件读取。
- 所有文件读取必须属于该项目已索引的 active Source。
- 拒绝 `..`、绝对路径、盘符路径、UNC、符号链接/重解析点逃逸。
- 使用 `Path.resolve()` 和 `is_relative_to(root)` 双重校验。

### 6.7 任意文件读取

- Code Browser 不提供任意路径读取。
- 只读取 active Source 的 `uri`。
- 只读取项目根目录内文件。
- 最大 2 MB、最多 2000 行。
- 二进制、超大文件、被 ignore 文件不返回。
- 返回内容时设置 `Content-Type: text/plain; charset=utf-8` 或 JSON 字符串。
- 不返回目录列表之外的系统信息。
- 不使用 `send_file` 直接拼接用户路径。

### 6.8 跨项目记忆读取

- 所有记忆接口必须带 `project_id`。
- `memory_get` 校验节点 `project_id` 和 `memory`/`note` 类型。
- 不提供全局记忆搜索。
- 不提供“按 node_id 读取任意节点正文”的无项目接口；节点详情也必须校验项目。
- 测试必须覆盖跨项目读取拒绝。

### 6.9 图谱查询规模

- 深度最大 3。
- 节点最大 200。
- 边最大 1000。
- 批量展开节点最多 20。
- 不允许 `all_for_project` 直接暴露。
- 服务端过滤 `node_types`/`relation_types`。
- 超出限制返回 400 或截断并标记 `truncated`；不能静默返回全图。
- 对超大项目，初始图只返回骨架。

### 6.10 异常请求日志

记录：

- 时间、request_id、method、path、status、duration_ms。
- Origin/Host 校验失败原因。
- 认证失败次数。
- 项目/节点不存在。
- DB busy、索引锁冲突。
- 写操作类型（记忆创建/更新/删除、索引触发），不记录正文。

不记录：

- Token。
- 记忆正文。
- 源码正文。
- 用户绝对路径以外的敏感环境信息。
- 完整 SQL 参数。

日志写 stderr 或用户级日志文件；不上传云端。

## 7. 前端技术设计

### 7.1 技术选型

| 技术 | 结论 | 理由 |
| --- | --- | --- |
| React | 采用 | 组件化、生态成熟，适合多页面和复杂图谱交互 |
| TypeScript | 采用 | API 契约、图谱数据、错误处理需要类型 |
| Vite | 采用 | 启动快、开发代理简单、构建轻 |
| Tailwind CSS | 采用 | 快速构建一致的本地工具 UI |
| shadcn/ui | 采用 | 可复制组件、无重型运行时锁定，适合内部工具 |
| React Flow / XYFlow | 采用 | 节点/边交互、局部展开、缩放、选中 |
| TanStack Query | 采用 | 服务端状态、缓存、失效、轮询索引状态 |
| Recharts | 采用 | 统计卡片/图表；只用于轻量可视化 |
| Zustand | 可选 | 只存 UI 状态（选中节点、过滤面板、布局），不存服务端数据 |
| React Router | 采用 | 页面路由与项目上下文 |
| elkjs / dagre | 可选 | 图布局；优先 elkjs，复杂图放 Worker |
| openapi-typescript | 采用 | 从 FastAPI OpenAPI 生成 TS 类型，避免手写漂移 |

不建议：

- Redux 作为主要状态管理。
- 前端直接拼 SQL 或读 SQLite。
- 前端实现检索/索引/记忆业务规则。
- 把 Token 写入源码或长期 localStorage。
- 引入云端图表/遥测 SDK。

### 7.2 前端项目结构

```text
frontend/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.tsx
    app/
      App.tsx
      router.tsx
      providers.tsx
    api/
      client.ts
      generated/schema.d.ts
      queries/
        projects.ts
        graph.ts
        search.ts
        memory.ts
        index.ts
    features/
      projects/
      overview/
      graph/
      code/
      search/
      memory/
      index/
    components/
      layout/
      graph/
      code/
      common/
    stores/
      ui.ts
    lib/
      auth.ts
      graph-adapter.ts
      format.ts
      errors.ts
    styles/
      globals.css
```

生产构建：

- `frontend/dist` 复制到 `src/synapse/integrations/gui/static/`，由 FastAPI 提供。
- 开发模式使用 Vite dev server + `/api` 代理。
- 不在 Python 包中存放 `node_modules`。

### 7.3 页面路由

| 路由 | 页面 |
| --- | --- |
| `/` | 项目选择/最近项目 |
| `/p/:projectId/overview` | Overview |
| `/p/:projectId/graph` | Graph Explorer |
| `/p/:projectId/code` | Code Browser |
| `/p/:projectId/search` | Search |
| `/p/:projectId/memory` | Memory |
| `/p/:projectId/index` | 可选：索引运行详情 |

项目切换器始终可见；切换项目时失效所有项目级 Query。

### 7.4 核心组件

| 组件 | 职责 |
| --- | --- |
| `AppShell` | 侧边栏、项目切换、全局错误/离线状态 |
| `ProjectSwitcher` | 项目列表、注册入口 |
| `OverviewCards` | 节点/关系/Source/未解析引用统计 |
| `TechStackPanel` | 技术栈标签 |
| `TopModulesPanel` | 模块分布/入口 |
| `IndexStatusBadge` | 最近 run 状态、任务计数、轮询 |
| `GraphCanvas` | React Flow 画布、节点/边、缩放、选中 |
| `GraphFilters` | 节点类型、关系类型、深度、规模 |
| `GraphLegend` | 颜色/类型图例 |
| `NodeInspector` | 节点详情、源码位置、展开邻居、跳转代码 |
| `FileTree` | 目录层级、文件选择 |
| `CodeViewer` | 源码片段、行号、节点高亮 |
| `SearchPanel` | 查询、模式、类型/路径过滤、结果 |
| `MemoryList` | 类型/标签/搜索、分页 |
| `MemoryDetail` | 完整正文、tags、来源、版本 |
| `MemoryEditor` | Phase 3.2 才开放；否则禁用并说明 |
| `EmptyState` / `ErrorState` | 空数据/API 关闭/权限错误 |

### 7.5 API Client 与类型共享

- FastAPI 自动生成 `/openapi.json`。
- 使用 `openapi-typescript` 生成 `src/api/generated/schema.d.ts`。
- 使用轻量 fetch wrapper 或 `openapi-fetch`；不要手写重复类型。
- CI/本地检查生成文件是否最新。
- `client.ts` 统一：
  - 注入 Bearer Token。
  - 处理 401/403/409/503。
  - 生成/传递 `X-Request-Id`。
  - 统一错误 envelope。
  - 取消请求（AbortController）。
- SPA 响应设置严格 CSP，默认只允许 `'self'`；不加载远程脚本、字体、图片或分析 SDK。
- 不在前端渲染不可信 HTML；Markdown/代码高亮必须禁用原始 HTML 或做白名单净化。
- Query key 规范：

```text
['projects']
['project', projectId]
['project', projectId, 'status']
['project', projectId, 'overview']
['project', projectId, 'graph', filters]
['project', projectId, 'node', nodeId]
['project', projectId, 'search', query, filters]
['project', projectId, 'memories', filters]
['project', projectId, 'index', 'status']
```

### 7.6 状态管理策略

- 服务端数据：TanStack Query；缓存只作为 UI 加速，不作为事实来源。
- UI 状态：Zustand 或 React context，保存选中节点、过滤面板、布局、侧栏宽度。
- URL 状态：搜索词、节点类型、关系类型、深度、页码/游标，便于刷新/分享。
- 写入成功后精确失效：
  - 新增/编辑/删除记忆 -> 失效 memories、overview、search。
  - 索引完成 -> 失效 status、overview、graph、search、files。
  - 注册项目 -> 失效 projects。
- 不在前端做跨项目缓存合并。

### 7.7 图谱数据适配

- API 节点 -> React Flow `Node`：

```ts
type GraphNode = {
  id: string;
  type: 'file' | 'class' | 'function' | 'method' | 'document' | 'memory';
  position: { x: number; y: number };
  data: {
    nodeId: string;
    title: string;
    path?: string;
    startLine?: number;
    nodeType: string;
    salience: number;
  };
};
```

- API 边 -> React Flow `Edge`：

```ts
type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  data: {
    relationType: string;
    confidence: number;
    weight: number;
  };
};
```

- 布局：初始图用 elkjs/dagre；局部展开时保留已存在节点位置，只对新增节点做局部布局，避免全图重排。
- 大图：限制 200 节点；超过时显示截断提示；布局放 Web Worker。
- 点击节点：打开 `NodeInspector`，按需加载详情。
- 双击/展开按钮：调用 `POST /graph/expand`，合并去重。
- 过滤：服务端过滤 + 前端隐藏双重保障；服务端为准。

## 8. 页面规划

### 8.1 Overview

- 项目名称、根路径、最后索引时间。
- 节点/关系/Source/未解析引用统计。
- 节点类型分布。
- 技术栈标签。
- top modules / 模块分布。
- 最近索引 run：状态、耗时、错误摘要、任务计数。
- 最近变更列表。
- 快捷入口：Graph、Code、Search、Memory。

数据来源：`/overview`、`/status`、`/modules`。

### 8.2 Graph Explorer

- 初始骨架图。
- 节点类型/关系类型筛选。
- 搜索定位节点。
- 点击节点查看详情。
- 双击或按钮展开邻居。
- 深度和节点上限控制。
- 截断提示。
- 节点与代码浏览器互相跳转。
- 不提供全图加载。

### 8.3 Code Browser

- 左侧文件树；只展示已索引文件。
- 右侧文件详情、类/函数/方法列表、源码片段。
- 行号、语言、节点高亮。
- 点击符号跳转图谱节点。
- 源码读取失败显示明确错误，不显示任意路径内容。

### 8.4 Search

- 全文/符号搜索。
- 模式：keyword/hybrid。
- 节点类型、路径前缀过滤。
- 结果列表：标题、类型、路径、行号、score、reasons、snippet。
- 打开代码或图谱。
- 任务上下文面板（`/context`）。
- 最多 50 条；Phase 3.1 不做无限滚动。

### 8.5 Memory

- 记忆列表：类型、标签、更新时间、摘要。
- 详情：完整正文、tags、memory_type、confidence、provenance、版本。
- 新增记忆。
- 编辑/删除在 Phase 3.2 实现前禁用，并显示“待实现”说明。
- 标签筛选需要精确查询；Phase 3.1 可先按类型和文本筛选。
- 删除二次确认；不做静默删除。

## 9. SQLite 并发策略

### 9.1 现状判断

- WAL 允许多读一写，但不支持多写并发。
- GUI API、MCP、索引子进程可以同时存在。
- GUI 读通常不被索引写阻塞；写操作可能被 SQLite busy 阻塞。
- `busy_timeout` 默认 5 秒；超时后可能抛出原始 `sqlite3.OperationalError`。
- 不能声称并发问题已解决。

### 9.2 GUI 与 MCP 是否共享同一个 Core 实例

结论：**不共享同一个进程内 `Application` 实例，但共享同一套 Core 代码和同一个数据库。**

原因：

- MCP 是独立 stdio 进程，有自己的 `McpRuntime`、worker 线程和 `Application`（`mcp/server.py:40-87`）。
- GUI API 是另一个进程，有自己的 Core worker 和 `Application`。
- `Database` 连接是线程本地的；跨进程不能共享连接。
- 强行让 MCP 和 GUI 在同一个进程内共享一个 `Application`，需要额外的协议、线程安全和生命周期管理，收益低、风险高。

可以共享的：

- `build_application()` 组合逻辑。
- Tools/Services/Repositories 代码。
- 同一个 `<home>/synapse.db`。
- 同一套配置和项目注册表。

不能共享的：

- SQLite 连接。
- 进程内 `threading.RLock` 写锁。
- `Application.close()` 生命周期。
- MCP 的 stdio 传输。

并发后果：

- GUI 的 `remember`、MCP 的 `synapse_remember`、索引子进程都可能同时写 SQLite。
- 读操作通常可并行；写操作串行，可能 busy。
- 不能因为“都在本机”就认为写冲突不存在。

### 9.3 Phase 3.1 策略

1. 单个 GUI API 进程。
2. 单个 Core worker 线程，串行执行 API 的 Core 调用。
3. 索引在独立子进程执行，使用现有项目 FileLock。
4. 所有写请求经 Core worker；不在 FastAPI 事件循环直接写 SQLite。
5. 缩短写事务；不在事务中读大文件或做网络操作。
6. API 捕获 `sqlite3.OperationalError` 中包含 `database is locked`/`busy` 的错误，映射为 `DB_BUSY`，返回 503 + `Retry-After`。
7. 只有幂等写操作（如带 `idempotency_key` 的记忆创建）才考虑有限重试；普通更新/删除不盲目重试。
8. 启动迁移与另一个写进程竞争时，返回明确启动错误；不静默失败。
9. 不做“读快照跨请求”承诺；前端以 `last_indexed_at`/run 状态提示数据可能正在更新。
10. 不增加 WAL checkpoint 配置，除非后续基准/Spike 证明必要；这是配置层改动，不是 Schema 改动。

### 9.4 多 GUI 窗口

- 多个窗口共享一个 API 进程和一个 Token（或同一启动会话）。
- UI 状态各自独立；服务端无状态。
- 索引 Job Manager 按项目去重，避免两个窗口重复触发。
- 不支持多个 API 进程同时服务同一 home；使用单实例锁或端口检测。
- 多窗口同时写记忆仍受单写者限制；UI 显示失败并允许重试。

### 9.5 进程异常退出

- API 进程退出：OS 关闭连接；索引子进程如果仍在运行，由其 FileLock 保护；下次索引执行恢复。
- 索引子进程崩溃：FileLock 释放；下一次索引标记 interrupted run、取消任务并重建。
- API 内存 Job 状态丢失：重启后通过 latest run/tasks 恢复显示；不伪造历史。
- 数据库损坏：现有恢复不修复损坏；`doctor` 只能检查。GUI 不承诺自动修复。

## 10. 数据一致性设计

- SQLite 是唯一事实来源；不建立第二套知识存储。
- React Query 缓存是临时视图，不作为写依据。
- 写入后失效相关查询；索引完成后失效项目级查询。
- 搜索/图结果可能来自索引中间状态；UI 显示 run 状态和最后索引时间。
- 记忆更新使用 `version` + `If-Match` 乐观并发；冲突返回 409。
- 记忆删除语义：Source 软删除、节点硬删除、关系级联；删除后不可在 UI 恢复。
- 记忆更新不得改变 `node_id`/`source_id`，避免破坏引用；如需改来源，走新建+删除。
- 标签同时更新 `nodes.tags` 和 `metadata_json.tags`，保持 FTS 触发器同步。
- 不直接改 `search_text` 以外的 FTS 表；依赖现有触发器。
- 项目隔离：所有读写先解析项目；节点/边/文件/记忆归属校验。
- 不跨项目合并搜索结果；GUI v1 不提供全局搜索。

## 11. 最小技术 Spike 计划

只有架构报告确认后才执行。Spike 只证明技术可行，不做完整页面。

### 11.1 范围

后端：

- 新增可选 `gui` 依赖：FastAPI、Uvicorn（仅 Spike 环境）。
- 新增 `src/synapse/integrations/gui/` 最小应用：
  - `/api/v1/health`
  - `/api/v1/projects`
  - `/api/v1/projects/{id}/status`
  - `/api/v1/projects/{id}/search`
  - `/api/v1/projects/{id}/graph/overview`
  - `/api/v1/projects/{id}/graph/nodes/{node_id}`
- 本地 Token、Host/Origin 校验。
- 单 Core worker。
- 错误映射。

前端：

- Vite + React + TypeScript 最小页面。
- 项目列表、状态、搜索、局部图、节点详情。
- API 关闭时显示错误状态。

### 11.2 验证项

1. 启动本地 API。
2. React 获取项目列表。
3. React 获取项目状态。
4. React 搜索节点。
5. React 获取局部图谱。
6. React 展示节点详情。
7. API 关闭后前端正确显示错误状态。
8. MCP 和 GUI 同时读取数据。
9. 隔离项目和数据库。

### 11.3 Spike 安全与数据

- 使用临时 `SYNAPSE_HOME` 和临时数据库。
- 使用测试项目/合成数据，不碰真实用户数据。
- 不修改真实 Trae 配置。
- 不提交、不推送。
- 验证跨项目读取拒绝。
- 验证 `Origin: null`、错误 Host、无 Token、错误 Token 被拒绝。
- 验证路径 `..`、绝对路径、盘符路径被拒绝。
- 验证 API 关闭后前端不显示旧数据为“已连接”。

### 11.4 Spike 验收

- 9 项全部通过。
- 不修改 Schema。
- 不修改 MCP 9 工具语义。
- 不破坏 CLI。
- 输出 Spike 报告，记录限制和后续问题。

## 12. Phase 3 后续拆分

| 阶段 | 目标 | 不包含 |
| --- | --- | --- |
| Phase 3.1 | API 基础、认证、Core worker、只读项目/状态/搜索/局部图、React 壳、Spike | 完整图谱 UX、Tauri、记忆编辑 |
| Phase 3.2 | Code Browser、文件树、源码安全读取、记忆编辑/删除、索引历史/取消、分页 | 全图布局、桌面打包 |
| Phase 3.3 | Graph Explorer 完整交互、布局、过滤、性能优化、代码/图联动 | 云端、Embedding |
| Phase 3.4 | 可选 Tauri/Electron 桌面壳、安装包、升级迁移、发布 | 重新实现 Core |

建议 Phase 3.1 从以下顺序开始：

1. 冻结 API 契约和错误码。
2. 新增 GUI 适配层骨架和可选依赖。
3. 实现 Token/Host/Origin/项目隔离。
4. 实现单 Core worker。
5. 实现 `/health`、`/projects`、`/status`。
6. 实现 `/search`、`/graph/overview`、节点详情。
7. 实现 React 壳和 API client。
8. 执行 Spike 9 项验证。
9. 输出 Spike 报告，等待 Phase 3.2 确认。

## 13. 风险与限制

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| SQLite 单写者 | 索引/MCP/GUI 同时写可能 busy | 单 worker、短事务、DB_BUSY 映射、Spike 验证 |
| 无可靠后台任务管理 | 进度/取消/历史不足 | Job Manager + latest run；不伪造百分比 |
| tasks 无 run_id | 任务无法精确归属 run | Phase 3.1 接受近似；Phase 3.2 评估加法字段 |
| 无 run 历史 | 不能展示历史索引 | 新增只读 Repository list/get（需确认） |
| 记忆无 update/delete | 不能完整 CRUD | Phase 3.2 新增 MemoryService，先返回 501 |
| tags 无精确索引 | 标签过滤性能/准确性 | 有界过滤或新增只读查询 |
| 搜索无分页 | 只能看前 50 | Phase 3.1 明示；Phase 3.2 加 cursor |
| 文件树/源码读取缺失 | Code Browser 需要新适配 | FileAccessGuard + active Source 白名单 |
| 图全量不可行 | 大项目性能 | 只做骨架 + 局部展开 + 上限 |
| localhost 安全 | 恶意网页/CSRF/DNS rebinding | Token、Origin、Host、CORS、速率限制 |
| Tauri 打包复杂 | Windows 发布慢 | 延后到 Phase 3.4 |
| 无 CI | 前端契约漂移 | 生成类型检查、API 测试、文档检查 |
| 现有 Core 异常不统一 | GUI 500/泄漏风险 | 适配层统一映射，不返回 traceback |
| 迁移启动写锁 | API 启动可能 busy | 明确错误/重试；不声称已解决 |
| 多 API 实例 | 端口/写竞争 | Phase 3.1 单实例，端口检测 |
| 真实数据风险 | 误操作 | Spike 用临时 home；写操作确认；不做 destructive 测试 |

## 14. 进入 Phase 3.1 的前置条件

必须确认：

1. 接受 FastAPI 本地 HTTP + React SPA 作为 Phase 3.1 方案。
2. 接受新增可选 `gui` 依赖，不改变 CLI/MCP 必需依赖。
3. 接受新增 `src/synapse/integrations/gui/` 适配层。
4. 接受单 API 进程 + 单 Core worker + 索引独立子进程。
5. 接受不修改 Schema；如需新增只读 Repository/Service 方法，先列出并确认。
6. 确认记忆编辑/删除延后到 Phase 3.2，Phase 3.1 返回 501。
7. 确认索引取消/历史列表延后或作为加法能力单独确认。
8. 确认 Token 交付方式（URL fragment + 内存 Token，或启动器/本地会话方案）。
9. 确认 Origin/Host/CORS/路径安全规则。
10. 确认 API 响应 envelope、错误码、分页和最大返回规模。
11. 确认前端技术栈和 OpenAPI 类型生成流程。
12. 确认 Spike 使用临时 home、临时数据库和合成项目，不碰真实数据。
13. 确认 Phase 3.1 不包含 Tauri/桌面打包。
14. 确认本轮不执行 Git 提交/推送，后续操作需明确授权。

## 15. 最终回答

- **推荐哪种 GUI 与 Core 通信方案？** FastAPI 本地 HTTP + React/Vite SPA。
- **是否需要 FastAPI？** 需要；作为可选 GUI 适配层依赖。
- **是否需要 Tauri？** Phase 3.1 不需要；保留到后续桌面发布阶段。
- **React GUI 如何复用现有 Core？** 通过 FastAPI 适配层调用 `build_application()` 和现有 Tools/Services/Repositories；React 只调用 HTTP API。
- **是否需要修改现有数据库？** 不需要 Schema 修改；记忆编辑/删除、索引历史等需要新增 Service/只读 Repository 方法，需另行确认。
- **Phase 3.1 应该从什么工作开始？** 从 API 契约、认证/安全、单 Core worker、只读项目/状态/搜索/局部图接口和 React 壳开始，再做最小 Spike。
