# Synapse 产品定位与架构认知报告

> 状态：认知基线文档（只读审查结论，不含代码变更）
> 审查对象：`D:\Synapse`，工作区基线 `5355e2f Add query-aware context module selection` + 未提交工作区改动
> 审查方式：源码与文档交叉核对 + 本地最小端到端实测；不以 README 或项目名为依据推断能力
> 本文用途：作为后续架构设计、功能开发、GUI 设计与技术路线规划的统一依据

---

## 0. 审查方法与核验口径

### 0.1 阅读范围

**源码**（`src/synapse/`，约 4,300 行）：

| 层 | 阅读内容 |
| --- | --- |
| 组合根 | `bootstrap.py`、`config.py`、`errors.py` |
| domain | `domain/enums.py`、`domain/models.py`、`domain/scoring.py` |
| core | `core/text.py`、`core/ids.py`、`core/paths.py`、`core/hashing.py`、`core/clock.py` |
| ports | `ports/parsers.py` |
| parsers | `parsers/base.py`、`parsers/registry.py`、`parsers/python_parser.py`、`parsers/markdown_parser.py`、`parsers/plain_text_parser.py` |
| normalizer | `normalizer/normalizer.py`、`normalizer/resolver.py`、`normalizer/keys.py` |
| ingestion | `ingestion/scanner.py`、`ingestion/changeset.py`、`ingestion/locking.py`、`ingestion/pipeline.py`、`ingestion/ignore.py` |
| knowledge | `knowledge/service.py` |
| retrieval | `retrieval/service.py`、`retrieval/ranker.py`、`retrieval/graph_expand.py`、`retrieval/diversify.py` |
| context | `context/builder.py` |
| storage | `storage/sqlite/database.py`、`migrations.py`、`repositories.py`、`schema/0001_init.sql` |
| tools | `tools/project_tools.py`、`tools/search_tools.py`、`tools/memory_tools.py` |
| integrations | `integrations/cli/`、`integrations/mcp/`、`integrations/gui/`（未提交） |

**文档**：`README.md`、`README.zh-CN.md`、`pyproject.toml`、`docs/architecture.md`、`docs/data-model.md`、`docs/mcp.md`、`docs/cli.md`、`docs/limitations.md`、`docs/phase-3.0-architecture.md`、`docs/phase-2.2.2-report.md`

**测试**：`tests/` 共 10 个文件、41 个测试函数（边界、配置、上下文、FTS、索引锁、MCP、流水线、崩溃恢复、Source 一致性、文本处理）

**Git 状态**：5 个已修改文件（README、README.zh-CN、architecture、limitations、pyproject）+ 2 个未跟踪项（`docs/phase-3.0-architecture.md`、`src/synapse/integrations/gui/`）。本次审查未修改任何受跟踪文件。

### 0.2 核验方法

1. 逐层阅读源码，确认职责与调用关系；
2. 用 `git diff` 区分"已提交基线"与"工作区实现"，避免把未提交代码当作既有能力；
3. 在工作区临时目录（`.tmp_pt/`，已尝试清理）注册并索引一个 3 文件样例项目，实测索引、检索、图扩展、记忆、上下文、GUI API；
4. 未采信文档中的历史 E2E 结论（如 Trae 实机验证），仅作为历史报告引用。

### 0.3 抽样实测结果（用于验证"文档声称 vs 实际行为"）

| 操作 | 结果 |
| --- | --- |
| 索引样例项目（2 个 Python 文件 + 1 个 Markdown） | `scanned=3, changed=3, nodes_upserted=10, relations_upserted=8, resolved=3, unresolved=1, failed=0` |
| `search login` | 返回 function `login`（`reasons=[graph:1hop, exact_symbol]`），并带出 `CALLS → verify`、跨文件 `IMPORTS`、`CONTAINS` 关系 |
| `remember ... --type decision` + `recall 认证` | 写入 memory 节点成功；中文 bigram 召回命中，`snippet` 含 `[认证]` 高亮 |
| `context --query "修改认证模块" --max-tokens 800` | 返回 project/stats/tech_stack/top_modules/decisions/recent_changes，`reason=cross_module_links`（纯中文 query 回退，与文档限制一致），`token_estimate=458` |
| GUI API（未提交实现）`GET /api/v1/health` | `{"status":"ok","version":"0.1.0"}` |
| GUI API `GET /api/v1/projects` 带 Bearer Token | 正常返回项目列表 |
| GUI API 不带 Token | `401`（本地 Token 校验生效） |

> 结论：核心链路（索引 → 图关系 → 检索 → 记忆 → 上下文）可以实际运行，不是文档愿景。

### 0.4 本次无法验证的事项

- **测试套件未能完整执行**：本机沙箱环境下 `pytest` 在创建/清理 `tmp_path` 时触发 `PermissionError: [WinError 5]`（`C:\Users\...\Temp\dsh-*` 与工作区临时目录的 ACL 均被拒绝），41 个用例全部在 fixture setup 阶段报错，属于环境限制而非用例失败。因此"41 passed"只能引用文档与历史报告，未在本次审查中复现。
- `ruff`、`mypy` 未运行。
- MCP stdio 真实会话未启动验证（仅审查 `server.py` 与 `tests/test_mcp_server.py` 的断言）。
- 真实 Trae / OpenCode / Claude / DeepSeek Harness 的接入行为未复验，仅引用 `docs/phase-2.1.1-report.md`、`docs/phase-2.2.2-report.md` 的历史记录。
- GUI 前端不存在，其视觉与交互无法验证。

---

## 1. 产品一句话定位

**Synapse 是一个本地优先（local-first）的 MCP 服务，为 AI Coding Agents 提供结构化的代码知识图谱、项目上下文检索与持久化的项目记忆。**

英文：

> Synapse is a local-first MCP service that gives AI coding agents a structured code knowledge graph, project context retrieval, and persistent project memory.

三点必须同时成立，缺一即偏离定位：

1. **它是服务，不是 Agent** —— 不推理、不规划、不生成、不执行代码；
2. **它以代码结构知识为核心** —— 图谱是差异化能力，记忆是补充能力；
3. **它本地优先** —— 基础索引、FTS 检索、图关系、记忆都不依赖云服务。

长期目标：成为 **AI Coding Agents 的项目知识基础设施（Project Knowledge Infrastructure）**。

---

## 2. 完整产品描述

### 2.1 它是什么

Synapse 在本地维护一份**跨会话、跨 Agent 共享的项目知识库**，由三部分组成：

- **代码知识图谱**：文件、类、函数、方法、文档章节作为节点；`CONTAINS / IMPORTS / CALLS / INHERITS / REFERENCES` 等作为边；边带置信度、来源（provenance）与证据。
- **项目记忆**：显式写入的 `fact / experience / decision / preference / summary`，与图谱同库、可检索、可回读全文。
- **检索与上下文供给**：FTS5 全文 + 精确符号 + 图扩展 + 加权排序 + 路径/类型去重，最终组装成受 token 预算约束的项目上下文。

对外通过三种入口暴露同一套能力：

```text
MCP（外部 Agent）      CLI（开发者/脚本）      GUI（开发者可视化，部分实现）
        \                    |                     /
         ------- 同一个 build_application() -------
                        |
             同一个 SQLite + FTS5 知识库
```

### 2.2 它如何工作（真实闭环）

```text
1. 注册项目        synapse projects register <path> --index
2. 建立知识        Scanner → ChangeDetector → 任务队列 → 线程池解析
                  → 单文件事务写 Source/Node/Relation/Ref
                  → ReferenceResolver 跨文件解析未落地的引用
3. 供给知识        search / related / explore / context / recall / memory_get
4. 沉淀记忆        remember（显式写入，Agent 或开发者决定何时写）
5. 下次会话        Agent 通过 MCP 直接拿到项目结构与决策，而非重新探索
```

### 2.3 它与 Agent 的关系

| 职责 | 归属 |
| --- | --- |
| 推理、规划、决策、生成、执行、工作流编排 | 外部 Agent |
| 索引、结构分析、图谱构建、检索、上下文组装、记忆存取 | Synapse |
| 何时写入记忆、用哪个工具、如何组合结果 | 外部 Agent（Synapse 只提供接口与约束） |

Synapse **不包含**任何 LLM SDK 调用、Prompt 编排、Agent 循环或代码执行逻辑。源码检索确认：除 `domain/enums.py` 中预留的 `Provenance.LLM / EMBEDDING / AGENT_CONFIRMED` 枚举值外，没有任何模型调用路径。

---

## 3. 目标用户

### 3.1 主要用户

1. **使用 AI Coding Agent 的开发者**：在 Trae、Claude Code、OpenCode、DeepSeek Harness 等客户端里开发中大型项目，受困于"每个会话重新认识项目"。
2. **多 Agent 并行工作的开发者**：同一项目被不同 Agent 反复接手，需要一份统一、可复用的项目知识来源。
3. **长期维护复杂代码库的团队个人**：项目结构复杂、跨模块关联多，全文搜索无法表达"谁依赖谁、改这里会碰到什么"。

### 3.2 次要用户

- **Agent 平台/工具链集成方**：需要以 MCP 标准接入一个项目知识服务，而不自建索引。
- **需要本地数据主权的用户**：不接受把源码与决策上传云端。
- **自动化脚本作者**：用 CLI `--json` 做索引巡检、CI 辅助、批量记忆导入。

### 3.3 非目标用户（当前阶段）

- 需要团队实时协作、云端共享知识库的组织；
- 期望"打开即对话"的通用聊天用户；
- 需要 Synapse 替自己写代码的用户（这不是产品职责）。

---

## 4. 解决的问题

| # | 问题 | Synapse 的应对 | 当前真实完成度 |
| --- | --- | --- | --- |
| 1 | 每次新会话都要重新理解项目 | 持久化知识库 + `synapse_context` 项目骨架 | 已可用；上下文为元数据级（见 §11 D5） |
| 2 | 无法快速掌握项目结构 | Overview 模式按跨模块连接选代表模块，路径去重 | 已可用（实测 `reason=cross_module_links`） |
| 3 | 难理解文件/函数/类/模块关系 | 符号级节点 + `CONTAINS/IMPORTS/CALLS/INHERITS/REFERENCES` | 基础可用；跨文件调用解析仍以启发式为主 |
| 4 | 仅全文搜索会漏关联 | FTS + 精确符号 + 图扩展 + 加权排序 | 已可用（实测 `graph:1hop` 命中相邻节点） |
| 5 | 缺乏跨文件、跨模块结构知识 | ReferenceResolver 落地 IMPORTS / 跨文件调用 / 文档链接 | 已可用；深度有限（见 §11 D4） |
| 6 | 决策与经验随会话丢失 | `remember / recall / memory_get` + 5 类记忆 | 写入与读取可用；无更新/版本/归档（见 §11 D7） |
| 7 | 不同 Agent 各建知识库 | 单一 SQLite + MCP 标准接口 | 已可用；GUI 共享同一库 |
| 8 | 任务前消耗大量上下文探索 | 预算感知的 context 组装 | 部分解决：输出为模块/决策/变更摘要，不含代码正文 |

> 一句话：Synapse 把"每次重新探索"替换为"一次索引、多次复用、跨 Agent 共享"。

---

## 5. 核心能力体系（五块能力 + 实现映射）

### 5.1 Code Knowledge Graph（代码知识图谱）—— 差异化核心

**设计**：节点抽象覆盖代码与文档；关系带 `confidence / weight / provenance / evidence`；`unresolved_refs` 先落地再解析，保证跨文件引用可重试、可追踪。

**现状**：

- 节点类型：`NodeType` 定义 9 种（project/file/class/function/method/document/doc_section/note/memory），实际产出 8 种；`project` 只是数据库表，不生成图节点。
- 关系类型：`RelationType` 定义 12 种，解析器实际产出 5 种（`CONTAINS`、`INHERITS`、`CALLS`、`IMPORTS`、`REFERENCES`）；`EXPLAINS / DEPENDS_ON / RELATED_TO / DERIVED_FROM / SOLVES / CONTRADICTS / MENTIONS` 尚未产出。
- Python：tree-sitter AST，提取类/函数/方法、继承、同文件调用、import、`self/cls` 方法调用、属性调用启发式。
- Markdown：文档节点 + 章节节点 + `CONTAINS` + 文档内链接 `REFERENCES`。
- 其他文本格式（json/toml/yaml/txt/ini/csv/xml）：仅文件级节点，不解析内部符号。
- 跨文件解析：`import` → 模块节点 `IMPORTS`；未落地调用 → 符号表/短名匹配 → `CALLS`；继承 → `INHERITS`；Markdown 链接 → 文档节点 `REFERENCES`。
- 未建模：构造函数参数注入、实例化关系、模块级依赖聚合、动态调用、类型推断。

### 5.2 Project Retrieval（项目知识检索）

完整链路（`retrieval/service.py`）：

```text
FTS5 bm25（title 5.0 / search_text 1.0 / tags 2.0）
  + 精确符号匹配（qualified_name_norm 精确或后缀匹配）
  + 图扩展（默认 depth=1，hop decay 0.5，单节点邻居上限 8，图节点上限 200）
  + 加权排序（lexical .60 / graph .20 / recency .08 / importance .07 / confidence .05）
  + 去重（单路径最多 3 条、单类型占比上限 50%）
  + 结果附带 snippet、score、reasons、relations 摘要
```

- 中文：索引侧 unigram + bigram，查询侧多字 CJK 用 bigram，混合查询按 AND/OR 策略拼 FTS 表达式。
- 降级：FTS 不可用 → `degraded=["fts_unavailable"]`；`semantic` 请求 → `degraded=["semantic_unavailable"]` 并回退词法。
- **未实现**：Embedding、向量库、ANN、rerank 模型。

### 5.3 Persistent Project Memory（项目长期记忆）

- 写入：`MemoryTools.remember` → `KnowledgeService.ingest_text` → `source_type=user`、`node_type=memory`、`provenance=user`、`salience=0.70`、`summary=正文前 300 字符`；支持 `idempotency_key` 与稳定 ID（相同标题+正文幂等）。
- 读取：`recall` 走检索（节点类型限制为 memory/note，只返回 summary/snippet）；`memory_get` 按 `node_id` 返回完整正文、tags、provenance、时间戳。
- **未实现**：更新、删除、版本历史（`nodes.version` 仅在 upsert 时自增，无历史表）、归档（`archived/tombstone` 未使用）、去重合并、冲突检测、来源追踪、重要性评估、LLM 自动整理。

### 5.4 Context Builder（上下文构建）

输出结构：`project`、`stats`、`tech_stack`、`top_modules`、`decisions`、`recent_changes`，必要时 `truncated`，并给出 `token_estimate`（字符数 ÷ 3 估算）。

模块选择三档：

1. 传 `query`：复用检索结果，按路径聚合最高分，`reason=query_match`；
2. 结构连接：按非 `CONTAINS` 关系的跨路径连接数与强度，`reason=cross_module_links`；
3. 兜底：按 salience 取 file/document/class，`reason=salience`。

每路径只保留一个代表节点（上限 12 条），`recent_changes` 按文件 mtime 排序并优先相关路径；裁剪优先级在 query 模式下为 `recent_changes → tech_stack → decisions → top_modules`，`project/stats` 永不裁剪。

**边界**：只负责检索、组织、裁剪；不制定修改计划，不生成代码建议。

### 5.5 Cross-Agent MCP Integration

- 传输：本地 stdio JSON-RPC（不监听端口）。
- 工具：9 个（projects_list / project_status / search / related / explore_graph / context / remember / recall / memory_get）。
- 隔离：所有项目级工具必须显式传项目；节点工具校验 `node.project_id`；`memory_get` 额外限制 memory/note；`path_prefix` 拒绝绝对路径与 `..`。
- 并发：所有 Core 调用串行到专用单线程 executor，匹配 SQLite 线程本地连接。
- 能力口径：只暴露 `keyword/hybrid`，不暴露不可用的 `semantic`——**这是当前最克制、最符合定位的一处设计**。
- 不支持：MCP resources / prompts / HTTP / SSE。

---

## 6. 产品边界

### 6.1 明确不属于 Synapse

- Agent 推理、自主规划、决策、代码生成、代码执行、工作流调度、任务管理；
- 通用聊天、Agent 控制台、AI 执行状态看板；
- 只保存对话历史的 Memory Plugin（记忆必须与项目知识绑定）。

### 6.2 当前不做 / 未做

- 云端同步、远程共享知识库（Cloud Optional，不作为基础前提）；
- 文件监听与后台守护进程（索引由 CLI 显式触发）；
- 语义/向量检索（`semantic` 仅保留兼容入口，永远返回降级标记）；
- 完整多语言 AST（当前只有 Python 的结构化解析）；
- 记忆的更新、删除、版本化、自动整理。

### 6.3 判断准则（用于未来功能评审）

1. 新功能是否强化"代码结构知识"这一核心？若只是通用聊天/助手能力，不做。
2. 是否复用同一个 Core 与同一个知识库？若需要第二套存储或复制业务逻辑，否决。
3. 是否把不可用能力伪装成已实现？不允许。
4. 是否迫使基础功能依赖云？不允许。
5. 是否让 Synapse 承担 Agent 职责？不允许。

---

## 7. 技术架构

### 7.1 真实分层（以源码为准）

```text
integrations/cli      integrations/mcp      integrations/gui（未提交）
        \                   |                    /
         --------------- tools -----------------
              ProjectTools / SearchTools / MemoryTools
                            |
        context / retrieval / knowledge / ingestion
                            |
                    normalizer / parsers
                            |
                         domain
                            |
                    ports（仅 ParserPort）
                            |
                storage/sqlite（Database + 7 Repository + schema）
```

约束（与 `docs/architecture.md` 一致，已核对）：

- `core`：纯函数工具（时钟、哈希、ID、路径、文本、评分）；
- `domain`：只有枚举、数据模型、纯评分逻辑，无 I/O；
- `ports`：当前只有 `ParserPort`；
- `bootstrap.build_application()` 是唯一组合根，负责 Database → Repository → Service → Tools 装配；
- CLI 不写 SQL、不解析文件；
- MCP 适配层只做协议转换、参数校验、错误映射。

### 7.2 模块职责与规模

| 模块 | 职责 | 关键事实 |
| --- | --- | --- |
| `bootstrap.py` | 组合根 | `Application` 直接暴露 Database、7 个 Repository、5 个 Service、3 个 Tools |
| `config.py` | 配置 | pydantic-settings；优先级 init > env（`SYNAPSE_*`）> config.toml；`SYNAPSE_HOME` / `SYNAPSE_CONFIG` |
| `ingestion/` | 扫描-变更-任务-解析-落库 | 项目级 FileLock；崩溃恢复；线程池解析 + 串行事务 |
| `knowledge/` | 单文件事务写入、Source 删除、文本/记忆写入 | `apply_file` 一个事务内完成 Source/Node/Relation/Ref 一致性 |
| `normalizer/` | 稳定 ID、search_text、salience、关系去重、引用归一 | `ReferenceResolver` 跨文件解析 |
| `retrieval/` | 检索、图扩展、排序、去重、related、explore | bm25 + 精确符号 + 图扩展 |
| `context/` | 上下文组装与预算裁剪 | 只依赖 Repository + RetrievalService |
| `storage/` | SQLite、迁移、仓储 | 线程本地连接、WAL、写锁、迁移校验和 |
| `tools/` | 面向入口的用例编排 | 3 个 Tool 类，共 11 个公开方法（ProjectTools 4 / SearchTools 4 / MemoryTools 3） |
| `integrations/` | CLI / MCP / GUI | 三个入口共用 Core |

### 7.3 数据模型（单库、多项目隔离）

真实表（`storage/sqlite/schema/0001_init.sql`）：

`projects`、`sources`、`nodes`、`node_fts`（FTS5 外部内容表）、`relations`、`unresolved_refs`、`tasks`、`index_runs`、`schema_migrations`。

关键约束：

- `projects.root_path` 唯一（应用层再做大小写归一）；
- `sources(project_id, source_type, uri)` 唯一；
- `nodes(source_id, node_type, node_key)` 唯一；`nodes.id` 稳定（uuid5）；
- `relations(from_node_id, to_node_id, relation_type)` 唯一；
- FTS5 由触发器与 `nodes` 同步；
- 迁移按 SQL 文件版本号 + 校验和防止篡改。

项目隔离由 `project_id` 贯穿所有查询；MCP/GUI 在适配层额外校验节点归属，防止跨项目读取。

### 7.4 关键流程

**索引（`ingestion/pipeline.py`）**

```text
resolve project → 获取 per-project FileLock → 恢复遗留 running/interrupted 状态
→ 创建 index_run → 扫描（ignore/二进制/大小过滤）→ 变更检测（mtime+size+parser_version）
→ 删除缺失 Source → 入队 index_file 任务 → 分批领取
→ 线程池解析 → 每文件单事务落库 → 解析未落地引用 → 写 run 统计
```

- 重命名：内容哈希匹配，复用原 Source，同一事务内更新 URI 与节点 path；
- 幂等：重复索引不产生重复节点/关系；崩溃后由下一次扫描重建，不做断点续传。

**检索**：见 §5.2。

**记忆**：`remember`（写）/`recall`（检索摘要）/`memory_get`（按 ID 读全文）。

**上下文**：见 §5.4。

### 7.5 并发与一致性

- 同一项目：FileLock 串行化索引；不同项目可并发，共享 SQLite 写锁。
- 连接：每线程一个连接；进程内写操作用 `threading.RLock` + `BEGIN IMMEDIATE`。
- MCP：一个进程一个单线程 executor，调用串行；不与其他进程共享连接。
- GUI（未提交）：同样单 worker 串行 Core 调用。
- 已知风险：跨进程写只靠 SQLite `busy_timeout`（默认 5s），超时后向入口抛 `DB_BUSY`（GUI 有映射，CLI/MCP 无重试策略）。

### 7.6 数据位置与配置

- 默认 home：`platformdirs.user_data_dir("Synapse", "Synapse")`；
- 数据库：`<home>/synapse.db`；锁：`<home>/locks/index-<project_id>.lock`；
- 配置：`<home>/config.toml`（可用 `SYNAPSE_CONFIG` 覆盖）；
- 索引/检索参数全部可配（workers、max_file_bytes、verify_content_hashes、图谱深度、5 个评分权重）。

---

## 8. 当前真实实现状态

### 8.1 核验矩阵（逐条对照给定基线）

| 基线声明 | 结论 | 证据 |
| --- | --- | --- |
| CLI → Tools → Services → Repositories → SQLite + FTS5 | ✅ 已实现 | `bootstrap.py`、`integrations/cli/main.py` |
| Bootstrap 依赖装配 | ✅ | `build_application()` |
| 纯 domain 数据结构与业务规则 | ✅ | `domain/` 无 I/O |
| Parser 与 Normalizer | ✅ | Python(tree-sitter)/Markdown/PlainText + Normalizer |
| 稳定 ID 的 Node、Relation、Ref | ⚠️ 部分 | Node/Relation 为 uuid5 稳定 ID；`unresolved_refs` 使用自增整数主键，Ref 本身不是稳定 ID |
| 跨文件 ReferenceResolver | ✅（启发式） | `normalizer/resolver.py`；实测跨文件 IMPORTS 生成 |
| 增量索引 | ✅ | mtime+size+parser_version，可选内容哈希校验 |
| 文件重命名和删除检测 | ✅ | 哈希匹配重命名；`delete_source` 级联删除 |
| 并行解析、串行写库 | ✅ | `ThreadPoolExecutor` + 每文件事务 |
| FTS5 全文检索 | ✅ | bm25 加权 + snippet |
| 中文 CJK bigram 检索 | ✅ | 索引 unigram+bigram；实测中文 recall 命中 |
| 精确符号检索 | ✅ | `find_exact_symbols`；实测 `exact_symbol` reason |
| 图关系扩展 | ✅ | `GraphExpander`；实测 `graph:1hop` |
| 项目上下文构建 | ✅ | `ContextBuilder` |
| remember / recall | ✅ | `MemoryTools`；实测中文记忆闭环 |
| memory_get | ✅（仅 MCP） | `MemoryTools.get` + MCP 工具；CLI 无对应命令 |
| MCP Server | ✅ 9 工具 | `integrations/mcp/server.py` |
| 项目状态与诊断 | ✅ | `project_tools.status()`、`synapse doctor`、`index_runs` |
| CLI JSON 输出 | ✅（`version` 除外） | 各命令 `--json` |
| Context Builder query 模式 | ✅ | 实测；纯中文 query 会回退结构选择（文档已声明） |
| Overview 项目骨架模式 | ✅ | `path_connection_counts` + reason |
| 上下文路径去重和预算裁剪 | ✅ | `diversify` + `_trim` + `truncated` |

### 8.2 尚未实现（逐一确认）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 真正的 Embedding 语义检索 | ❌ 未实现 | 无向量表、无模型依赖；`semantic` 永远 `degraded` |
| LLM 自动记忆整理 | ❌ 未实现 | 无任何模型调用 |
| 完整多语言 AST | ❌ 未实现 | 仅 Python 有 AST；其余后缀文件级节点 |
| 完整构造函数注入关系 | ❌ 未实现 | 无对应关系类型；实例化与参数注入不建模 |
| 完整文件监听系统 | ❌ 未实现 | 无 watcher；索引靠显式 CLI |
| GUI 知识图谱界面 | ❌ 前端未实现 | 仅未提交的只读 FastAPI 适配层，无 React/Vite 前端 |
| 远程同步 | ❌ 未实现 | 无网络层 |
| 完整记忆版本管理 | ❌ 未实现 | `version` 自增但无历史；无更新/删除接口 |
| 自动归档与去重 | ❌ 未实现 | `archived/tombstone` 从未使用 |

### 8.3 与给定基线不一致 / 需要补充的事实

1. **GUI 实现进度与文档不符**：README、`docs/architecture.md`、`docs/limitations.md` 均写"GUI 架构设计完成、尚未实现"；但工作区存在未提交的 `src/synapse/integrations/gui/`（FastAPI 只读 API、Token/Origin 安全、CoreWorker、query_service），`pyproject.toml` 已新增 `gui` extra，实测可启动并响应。这是**文档滞后于工作区实现**，不是实现超前于设计。
2. **定位表述有三个版本**：README/pyproject/CLI help 用"local-first knowledge memory and association engine"（记忆优先），MCP server description 用"code knowledge graph and long-term memory"，`__init__` docstring 用"knowledge memory and association engine"。缺少统一的"代码知识图谱 + 项目记忆 MCP 服务"表述。
3. **`semantic` 暴露不一致**：MCP 隐藏（正确）；CLI `--mode` 帮助与 `docs/cli.md` 列出 `semantic`；GUI `/search` 的 `mode` Literal 也包含 `semantic`。能力不可用但入口可见，需要显式提示降级。
4. **GUI API 覆盖度低于设计**：Phase 3.0 设计含分页、Memory 读写、索引触发、Code Browser、`/context` 等端点；当前实现只有 9 个只读端点（health、projects、project、status、overview、search、graph/overview、node、neighbors），无 Memory、无索引、无 context、无分页、无代码正文读取。
5. **CLI 与 MCP 能力不对称**：MCP 有 `memory_get`，CLI 没有；CLI 有 `index`，MCP 没有（Agent 无法主动刷新索引）。
6. **节点类型 `project` 未产出**：项目只是 `projects` 表，不生成图节点；`NodeType.PROJECT` 仅被 GUI 的默认过滤排除。
7. **错误类型预留未用**：`DatabaseBusy / ConflictVersion / NotImplementedTool` 已定义但无抛出点；GUI 状态码映射表对应项目前不会触发。
8. **`SearchMode` 枚举未使用**：检索层用字符串集合校验，`SearchMode` 是死代码。

### 8.4 测试与质量基线

- 41 个测试函数覆盖：幂等索引、同 mtime/size 内容变更、路径大小写、预算裁剪、任务重试、配置优先级、上下文 query/中文回退/路径去重/CLI、FTS 降级、索引锁（含多进程）、MCP 协议/错误映射/跨项目拒绝/stdout 纯净、增量索引、重命名删除、CLI 往返、真实进程崩溃恢复、Source 一致性、文本处理。
- 本次未能执行（环境 ACL 限制，见 §0.4）。
- `benchmarks/results/` 存有历史基准输出；未复核其环境与结论。
- GUI 目录**没有测试**。

---

## 9. 核心差异化价值

1. **符号级 + 关系级的代码知识，而不是文件级搜索**
   节点到函数/方法级别，边带置信度与证据，`reasons` 可解释（`fts / exact_symbol / graph:1hop`）。这是与"代码搜索 + 向量库"路线的根本区别。

2. **同一个 Core、同一个知识库、多个入口**
   CLI、MCP、GUI 共用 `build_application()` 与同一个 `synapse.db`；不需要为每个 Agent 重建索引，也不需要为 GUI 复制业务逻辑。

3. **本地优先且可解释**
   无云依赖；SQLite 单文件可备份、可检查（`doctor` 做 integrity + FTS integrity）；关系证据与 provenance 可追溯。

4. **记忆与图谱同库互补，而不是两个系统**
   记忆是节点、可被检索、可被图扩展带出；项目决策能自然进入 context 的 `decisions`。

5. **对不可用能力显式降级**
   `degraded=["semantic_unavailable"]`、MCP 不暴露 `semantic`、`limitations.md` 明列边界——这在 AI 工具普遍夸大能力的市场里，是可信任度资产。

6. **克制的产品边界**
   9 个 MCP 工具、无 Agent 循环、无聊天界面；把"理解项目"做深，而不是把"AI 功能"铺广。

---

## 10. 长期发展方向

> 以下为方向判断，**不代表已实现**。按"是否强化核心定位"排序。

### 方向一：更完整的代码知识图谱（最高优先级）

- 多语言 AST（建议顺序：TypeScript/JavaScript → Go → Java/C#，按用户分布决定）；
- 跨文件调用解析增强（当前同文件调用 + import 落地，跨模块方法调用仍弱）；
- 模块级依赖聚合与包边界（directory/module 级别节点或聚合视图）；
- 构造函数注入、实例化、类型引用；
- 代码影响分析（"改这个节点会影响谁"）——依赖反向图遍历 + 关系置信度。

### 方向二：更强的项目记忆

- 记忆生命周期：更新、删除、软删除（`archived/tombstone` 已预留）；
- 版本历史与来源追踪（`Provenance` 与 `evidence` 已就位）；
- 冲突检测（同主题矛盾记忆）与去重合并；
- 分层记忆（项目级 / 模块级 / 任务级）；
- 重要性评估（当前 `salience` 是按类型的静态值）。

### 方向三：高级检索

- 可选 Embedding（本地模型优先，保持 local-first），混合 lexical + graph + vector；
- 语义召回仅作为补充通道，不替换可解释的词法/图通道；
- 检索结果可解释性增强（当前已有 score/reasons/snippet，可扩展 evidence 摘要）；
- 上下文选择从"路径代表节点"升级为"任务相关代码块 + 记忆 + 关系"的组合。

### 方向四：项目知识可视化（GUI）

- Project Overview、Graph Explorer、Node Details、Relationship Exploration；
- Project Search、Memory Management、Indexing Status、Context Inspection；
- 交互式局部图谱（不全图加载）、截断提示、节点↔代码浏览器联动；
- 视觉上保持开发者工具的克制与专业，不做 Agent 聊天窗口或虚构执行状态。

### 方向五：生态扩展

- 更多 MCP Agent 接入验证（当前仅 Trae 有历史实机报告）；
- CLI 自动化能力（CI 索引巡检、记忆导入导出）；
- 可选导入/导出（项目知识包），可选云同步——**不得成为基础功能前提**。

### 不建议的方向

- 在 Core 内嵌 LLM 默认路径（会破坏可解释性与 local-first）；
- GUI 增加 Agent 控制台/聊天（偏离"知识可视化"定位）；
- 为多入口复制业务逻辑（破坏 One Core）；
- 为了功能数量引入与代码知识无关的通用 RAG/文档问答。

---

## 11. 当前架构与产品定位之间的偏差

> 偏差 = "定位要求"与"当前实现/文档"之间的差距。按影响排序。

### D1 文档与工作区实现漂移（高，需立即处理）

- README / architecture / limitations 声称"未提供 HTTP API、GUI 未实现"；
- 工作区实际存在未提交的 GUI 只读 API，且实测可运行；
- `docs/phase-3.0-architecture.md` 0.3 节写"没有新增 FastAPI"，但 `pyproject.toml` 已加 `gui` extra、代码已 import fastapi。
- **影响**：任何人按文档认知项目都会低估 GUI 进度；后续开发者可能重复实现。
- **要求**：要么把 GUI 实现纳入版本管理并更新文档，要么明确标记为"实验性未提交草稿"。

### D2 定位表述不统一（高）

- 三处口径不一致（memory-first vs graph-first），产品一句话定位缺失。
- **影响**：对外沟通、功能优先级、GUI 信息架构都会漂移。

### D3 `semantic` 能力边界不一致（中高）

- MCP 已正确隐藏；CLI 帮助与 GUI API 仍暴露 `semantic`，仅靠返回值降级。
- **影响**：Agent/开发者可能误以为存在语义检索，损害"不把未实现写成已实现"的原则。

### D4 图谱深度不足以支撑"知识图谱"叙事（中高）

- 关系类型 12 定义、5 实现；无模块级依赖、无跨模块调用解析、无影响分析、无构造函数注入；
- 非 Python 项目只有文件级节点，图谱价值骤降。
- **影响**：对多语言项目，"code knowledge graph"更多是文件/文档关联图。

### D5 Context Builder 仍是"项目目录索引"，不是"任务上下文"（中高）

- `top_modules` 只给节点 brief（title/path/summary/salience），**不含代码正文或记忆正文**；
- `decisions` 固定取最近 10 条，与 `query` 无关；
- 记忆只通过 `decisions` 一种类型进入上下文；
- **影响**：Agent 拿到上下文后仍需大量读取文件，与"减少重复探索"的定位有差距。

### D6 索引新鲜度的责任落在人类身上（中）

- 无文件监听、无 MCP `index` 工具、GUI 无索引触发；索引只能由 CLI 显式执行。
- **影响**：知识库很容易过期；Agent 无法自主刷新知识（也不应让 Agent 随意触发全量索引，但需要明确的刷新策略）。

### D7 记忆生命周期缺失（中）

- 无更新/删除/历史/归档/去重；`access_count`、`last_accessed_at`、`archived`、`tombstone` 均未使用；
- `remember` 只增不改，错误记忆无法纠偏（只能再写一条）。
- **影响**：长期使用后记忆质量会退化，"项目长期记忆"的可信度下降。

### D8 入口能力不对称（中）

- CLI 无 `memory_get`；MCP 无 `index`；GUI 无 Memory/Indexing/Context 端点；
- **影响**：同名能力在不同入口表现不同，文档与用户预期容易错位。

### D9 业务规则重复（中）

- `path_prefix` 校验有 3 份实现（`retrieval/service.py` 归一化、MCP `_validate_path_prefix`、GUI `validate_relative_path`）；
- 项目引用解析有 3 份（CLI `_project_reference`、MCP `projects.resolve`、GUI `query_service`）；
- 节点输出 payload 有 2 份（`RetrievalService._node_payload` 与 `query_service.node_payload`，字段集不同）；
- 任务状态枚举有 2 份（`domain/enums.TaskStatus` 与 GUI `_TASK_STATUSES`）。
- **影响**：规则变更需要多点同步，属于"One Core"原则的实质性侵蚀（虽然不涉及 SQL 复制）。

### D10 GUI 适配层绕过 Tools 直读 Repository（中）

- `node_detail`、`graph_overview`、`_related_for_project` 直接调用 `application.nodes` / `application.relations`；
- 未触碰 SQL（符合"不能直连 SQLite"要求），但绕过了 Tools 层，且自己拼装 payload、自己做项目过滤。
- **影响**：GUI 的读取路径与 MCP/CLI 不同源，未来权限/过滤规则变更容易只改一边。

### D11 能力字段空转（低）

- `salience` 按节点类型静态赋值；`access_count` 不更新；`confidence` 大多为 1.0；
- `SearchMode` 枚举、`DatabaseBusy/ConflictVersion/NotImplementedTool` 错误未使用；
- **影响**：排序里的 recency/importance/confidence 权重实际贡献很小，评分解释性有限。

### D12 GUI API 无分页、无上限治理（低）

- 只有 `limit` 上限（50/200），没有 cursor 分页；`graph/overview` 用 salience 取种子节点。
- **影响**：大型项目（10 万级节点）下首屏与图谱接口可能变慢，且无稳定分页语义。

---

## 12. 改进建议

> 原则：只强化"代码知识图谱 + 项目记忆 + 多入口单一 Core"；不引入 Agent 能力；不为数量牺牲定位。

### P0（先做，否则定位不可信）

1. **统一能力口径与文档**
   - 在 README 顶部固化一句话定位（中文/英文各一版）；
   - 明确 GUI 真实状态（已实现只读 API / 前端未开始 / 是否纳入版本管理）；
   - 更新 `docs/architecture.md`、`docs/limitations.md` 的 GUI 与 HTTP API 描述；
   - 验收：README、architecture、limitations、phase-3.0 四份文档对"已实现/未实现"的陈述互相一致。

2. **统一 `semantic` 边界**
   - 方案 A（推荐）：CLI/GUI 与 MCP 一致，不暴露 `semantic`；
   - 方案 B：保留入口，但在 CLI 输出与 GUI 响应中强制展示 `degraded` 并在 UI 明确标注"语义检索未实现"。
   - 验收：任何入口都不会让调用方误判存在向量检索。

3. **确定索引刷新策略**
   - 短期：在文档与 GUI 状态页明确"索引由 CLI 触发"；GUI 提供只读"最近索引时间 + 是否过期"提示；
   - 中期：GUI 触发索引（复用 `IngestionService`，仍加项目锁）；
   - 长期：文件监听 + 增量刷新（不改变 Core 语义）。
   - 验收：Agent 能通过 `project_status` 判断知识是否足够新；不存在"索引过期但无人知晓"的状态。

4. **记忆最小闭环**
   - 增加 `update / delete（软删）/ list`（GUI 设计已规划，MCP 可只开放读）；
   - 启用 `tombstone/archived` 与 `access_count`；
   - 验收：错误记忆可纠偏，删除后可解释（不物理丢失审计线索）。

### P1（决定产品价值上限）

5. **Context Builder 升级为真正的任务上下文**
   - 在 `top_modules` 之外增加"相关代码块"（节点 content 截断 + 行号）与"相关记忆正文"（按 query 检索 memory/note，而非只看 decisions）；
   - 预算按 section 分配（如 context 总预算的 50% 给代码块、20% 给记忆、30% 给结构），保留现有 `truncated` 语义；
   - 验收：给定"修改认证模块"，输出能同时包含认证相关函数签名、跨模块调用关系、相关决策记忆。

6. **图谱深化（按用户分布排优先级）**
   - 跨文件方法调用解析（结合 import 别名 + 类方法表）；
   - 模块级依赖聚合视图（不新增表，先做查询层聚合）；
   - 影响分析查询（反向遍历 + 置信度阈值）；
   - 构造函数注入/实例化关系（需新增关系类型，注意迁移与文档同步）。

7. **收敛重复业务规则**
   - `path_prefix` 校验、项目解析、节点 payload、任务状态枚举收敛到 Core（例如 `tools/validation.py` 或 `core/validation.py`）；
   - 验收：三个入口调用同一实现，删掉 GUI/MCP 的重复版本后测试仍通过。

8. **GUI 适配层按设计补齐**
   - 优先：Memory 只读列表/详情、索引状态与触发、`/context` 检查、分页；
   - 明确 adapter 只读边界：优先调用 Tools；确需 Repository 直读时集中到 `query_service` 并在文档标注原因；
   - 验收：GUI 不出现与 MCP 不一致的过滤/权限行为。

### P2（长期演进，保持可选）

9. **检索可解释性与质量评估**
   - 扩充 `benchmarks/` 为检索质量评估集（不只是性能）；
   - 输出 evidence 摘要（关系来自哪一行/哪条 import），提升可解释性。

10. **多语言 AST 渐进接入**
    - 通过 `ParserPort` + `ParserRegistry` 扩展，不改变 Core 流程；
    - 每个语言独立 parser_version，确保增量索引正确失效。

11. **可选 Embedding 通道**
    - 本地模型优先；只作为混合检索的补充通道；
    - 不改变"没有 Embedding 时所有功能可用"的前提；
    - 索引与存储需新增向量表/迁移，必须先更新文档与版本策略。

12. **记忆治理**
    - 去重、冲突检测、来源追踪、重要性评估；
    - 若引入 LLM 辅助整理，必须默认关闭、可解释、可回滚，且不进基础路径。

---

## 附录 A：核心文件索引

| 关注点 | 文件 |
| --- | --- |
| 组合根 / 依赖装配 | `src/synapse/bootstrap.py:57` |
| 配置与路径 | `src/synapse/config.py`、`src/synapse/core/paths.py` |
| 数据模型与枚举 | `src/synapse/domain/models.py`、`src/synapse/domain/enums.py` |
| 稳定 ID / 文本处理 | `src/synapse/core/ids.py`、`src/synapse/core/text.py` |
| 解析器 | `src/synapse/parsers/python_parser.py`、`markdown_parser.py`、`plain_text_parser.py` |
| 跨文件引用解析 | `src/synapse/normalizer/resolver.py` |
| 索引流水线 | `src/synapse/ingestion/pipeline.py` |
| 单文件事务写入 | `src/synapse/knowledge/service.py:39` |
| 检索与图扩展 | `src/synapse/retrieval/service.py`、`graph_expand.py`、`ranker.py`、`diversify.py` |
| 上下文构建 | `src/synapse/context/builder.py:50` |
| SQLite 与仓储 | `src/synapse/storage/sqlite/database.py`、`repositories.py`、`schema/0001_init.sql` |
| 工具层 | `src/synapse/tools/*.py` |
| CLI | `src/synapse/integrations/cli/main.py` |
| MCP | `src/synapse/integrations/mcp/server.py` |
| GUI（未提交） | `src/synapse/integrations/gui/` |
| 架构与限制 | `docs/architecture.md`、`docs/limitations.md`、`docs/mcp.md` |
| GUI 设计 | `docs/phase-3.0-architecture.md` |

## 附录 B：术语

| 术语 | 含义 |
| --- | --- |
| Core | `domain` + `core` + `ports` + `parsers` + `normalizer` + `ingestion` + `knowledge` + `retrieval` + `context` + `storage` + `tools` 的合称，由 `build_application()` 装配 |
| Source | 被索引的数据来源（文件、文本、URL 等），`sources` 表 |
| Node | 知识节点（文件/类/函数/方法/文档/章节/记忆/笔记），`nodes` 表 |
| Relation | 有向、带置信度与证据的图边，`relations` 表 |
| Ref | 解析器产出但尚未落地的引用，`unresolved_refs` 表 |
| degraded | 检索降级标记数组，表明哪些能力不可用 |
| provenance | 知识来源（ast / explicit_ref / user / agent_confirmed / llm / embedding / heuristic） |

## 附录 C：仓库状态快照

- 分支：`main`；已提交基线：`5355e2f`
- 已跟踪修改：README（中英）、`docs/architecture.md`、`docs/limitations.md`、`pyproject.toml`
- 未跟踪：`docs/phase-3.0-architecture.md`、`src/synapse/integrations/gui/`
- 版本：`0.1.0`；包名：`synapse-knowledge`
- 入口：`synapse`、`synapse-mcp`、`python -m synapse.integrations.gui`
- 依赖：pydantic / pydantic-settings / typer / rich / tree-sitter(-python) / markdown-it-py / mdit-py-plugins / pathspec / platformdirs / filelock / mcp；`gui` extra：fastapi / uvicorn；开发：pytest / ruff / mypy / httpx

---

**最终结论**

Synapse 的**产品方向与核心实现是自洽的**：它确实是一个本地优先、以代码结构与项目记忆为核心、通过 MCP 向外部 Agent 供给知识的服务，而不是 Agent 本身。CLI、MCP、GUI（后端）共用同一组合根与同一 SQLite，符合 One Core / One Knowledge Store / Multiple Entrypoints。

当前的主要问题不是"做错了方向"，而是**"叙事比实现更完整"**：图谱偏浅（Python 优先、关系有限）、上下文仍停留在元数据层、记忆缺少生命周期、索引刷新依赖人工、文档与工作区状态不一致。后续迭代应优先补强"代码知识图谱的深度"和"上下文对 Agent 的实际可用性"，而不是横向增加与项目知识无关的能力。

**一句话：Synapse 的核心价值不是替 Agent 完成开发，而是让 Agent 更准确、更持续地理解它正在开发的项目。**

---

## 附录 D：后续进展（2026-11-10）

本报告是审查时点的快照。此后已完成第一轮偏差收敛：

- Phase 3.1：本地只读 GUI API + 静态知识工作台（Overview、Knowledge Graph、Search、Memory、Context、Indexing），复用同一个 Core 与 SQLite。
- 新增只读接口：`memories`、`memories/{node_id}`、`context`；新增 `POST /projects/{id}/index` 触发一次索引。
- 能力口径对齐：MCP、CLI、GUI 只暴露 `keyword` / `hybrid`；CLI 新增 `memory-get`。
- `path_prefix` 校验收敛到 `core/validation.py`，MCP 与 GUI 的重复实现已删除。
- 记忆列表改由 `MemoryTools.list()` 进入 Core，GUI 不再直接查询 Repository。
- README、architecture、limitations、cli 文档已同步。

仍保留的偏差：D4 图谱深度、D5 上下文内容深度、D7 记忆生命周期、D11 能力字段利用、D12 完整分页。这些属于后续能力建设，不是文档或口径不一致。
