# Synapse Post-GUI 技术审计报告

- 审计日期：2026-11-11
- 审计对象：`D:\Synapse`，HEAD `b94f9ba`
- 对照对象：`D:\SynapseWebsite`（官网视觉基准）
- 审计方式：只读源码/文档审查、静态检查、后端测试、GUI API 冒烟测试
- 约束：本报告不修改源码、Schema、配置、依赖、MCP/CLI/GUI 行为，不做 git 写操作

---

## 1. 审计目标、范围与方法

### 1.1 审计目标

本审计围绕以下问题展开：

1. 复核 D1-D12 偏差的当前真实状态，而不是沿用历史报告结论。
2. 核对 GUI 六页面是否真实实现，以及视觉系统与官网是否一致。
3. 评估知识图谱、检索、Context、记忆四条核心能力的产品可用性。
4. 核对 MCP、CLI、GUI 三个入口的能力对称性与架构边界。
5. 审查 SQLite 并发、事务、安全边界和前端实现质量。
6. 给出按依赖排序的整改路线，区分“产品缺口”“架构债务”“文档漂移”。

### 1.2 范围

纳入审计：

- `src/synapse/domain`、`storage`、`parsers`、`normalizer`、`ingestion`
- `src/synapse/retrieval`、`context`、`knowledge`、`tools`
- `src/synapse/integrations/mcp`、`integrations/cli`、`integrations/gui`
- GUI 静态资源：`index.html`、`styles.css`、`app.js`
- `tests/`、`pyproject.toml`、`README*`、`docs/`
- 官网 `D:\SynapseWebsite` 的 `globals.css`、品牌组件、图谱组件和页面结构

不纳入审计：

- 官网业务正确性与营销文案
- 真实 IDE/Agent 会话中的 MCP 端到端体验
- 生产环境压测、渗透测试、多操作系统兼容性认证

### 1.3 方法

1. 逐文件阅读后端核心、入口层、GUI 静态资源和文档。
2. 用代码搜索交叉验证 D1-D12 的证据，避免只依赖历史报告。
3. 在临时 `SYNAPSE_HOME` 下运行测试，避免污染真实数据库。
4. 用 FastAPI `TestClient` 对 GUI API 做只读冒烟，并构造分页/筛选边界数据。
5. 用官网 CSS token 与 GUI CSS token 做源码级视觉对照。
6. 所有结论标注证据位置；无法确认的内容放入“未验证事项”。

### 1.4 状态定义

本报告只使用以下五种状态：

- 已解决：当前实现和文档均已满足该项要求，未发现实质残余。
- 部分解决：主要路径已改善，但仍存在可复现缺口或未覆盖入口。
- 未解决：核心缺口仍然存在，当前实现不满足该项要求。
- 已恶化：相比历史基线更差，或新增了明显回归。
- 无法验证：缺少可执行环境或证据，不能下结论。

### 1.5 审计限制

- 本机 `rg` 不可用，使用内置搜索和 PowerShell 替代。
- PowerShell 控制台显示中文可能乱码，源文件内容以读取工具为准。
- 未进行真实浏览器截图对比，视觉结论基于 CSS/JS 源码。
- 未使用真实 MCP 客户端做端到端验证，MCP 结论基于实现和既有测试。
- 未做大数据量、长时运行、多进程竞争和故障注入测试。

### 1.6 未验证事项

以下内容未验证，不应在后续汇报中表述为“已确认”：

1. 真实浏览器中的视觉像素差异、响应式布局、Canvas 性能。
2. 真实 MCP 客户端（Trae/Claude Desktop 等）的端到端调用。
3. 大型项目（数万文件/数十万节点）的索引和查询性能。
4. 多进程同时索引/写入的长时间压力测试。
5. Windows/macOS/Linux 的路径、锁、编码差异。
6. GUI 可访问性（键盘、屏幕阅读器、对比度）。
7. 安全渗透测试（DNS rebinding、token 泄露、恶意 Origin）。
8. 数据库损坏后的恢复能力和备份/恢复演练。
9. Memory update/delete/archive（当前未实现，无法验证）。
10. semantic/embedding/vector 检索（当前未实现，无法验证）。
11. GUI 自动化测试（当前不存在）。
12. 图谱关系生成的语义正确率（当前无标注集）。

---

## 2. 执行摘要

### 2.1 总体判断

Synapse 当前是一个边界清晰、实现克制的 **local-first MCP 服务**：同一套 Core、同一 SQLite、三个入口。它不是一个 Agent Runtime、Agent 平台、聊天机器人或代码执行引擎。代码质量基线良好：41 个后端测试通过，ruff 和 mypy 均无问题。

GUI 六页面已经真实落地，且是只读知识工作台；视觉语言与官网高度接近。当前主要问题不在“页面有没有”，而在四类深度缺口：

1. 知识图谱仍是 AST 索引，不是可支撑复杂代码理解的语义图。
2. Context 仍是项目元数据 + 模块摘要，缺少代码正文、签名和关系证据。
3. 记忆只有写入/读取，没有更新、删除、归档、版本和访问生命周期。
4. 分页与计数在记忆查询路径上存在可复现的正确性错误。

此外，GUI 仍直接读取 Repository，业务规则在 GUI 层重复，且没有 GUI 自动化测试。这些是后续扩展前应优先偿还的债务。

### 2.2 Top 5 问题

| 排名 | 问题 | 对应偏差 | 严重程度 | 影响 |
|---|---|---|---|---|
| 1 | 图谱语义深度不足，只有 5 种关系真正生成 | D4 | High | Agent 仍靠搜索和人工探索，图谱价值被高估 |
| 2 | Context 仍为元数据级，没有代码正文/签名 | D5 | High | “一次调用获得上下文”的目标未达成 |
| 3 | 记忆没有生命周期 | D7 | High | 记忆会陈旧、冲突、不可纠正，无法长期维护 |
| 4 | 记忆分页/筛选返回错误结果 | D12 | High | GUI 和 API 会漏数据、报错总数 |
| 5 | GUI 绕过 Tools、重复业务规则，且无自动化测试 | D9/D10 | High | 三入口行为漂移，GUI 回归风险高 |

### 2.3 建议的总体策略

不要继续扩展 GUI 功能面。先把“核心能力深度 + 数据契约正确性 + GUI 测试”补齐，再考虑写入型 GUI、后台索引和更大规模图谱。

---

## 3. 产品定位与能力边界

### 3.1 定位基线

产品定位应为：

> **Local-first Code Knowledge Graph & Persistent Project Memory MCP Service**

它面向 AI Coding Agents，提供：

- 代码/文档的结构化知识图谱
- 项目上下文检索
- 持久化项目记忆
- 通过 MCP、CLI、本地 GUI 暴露同一份知识

证据：

- `README.md:5`：local-first MCP service
- `pyproject.toml:8`：Local-first MCP service for code knowledge graphs...
- `src/synapse/__init__.py:1`：local-first code knowledge graph, context and project memory MCP service
- MCP server description：Local-first MCP service for code knowledge graphs...
- GUI 自我描述：read-only window into the local project knowledge base

### 3.2 明确不做什么

| 是 | 不是 |
|---|---|
| 本地知识服务 | Agent Runtime / Agent 平台 |
| MCP 工具服务 | 聊天机器人 |
| 项目记忆存储 | 代码执行引擎 |
| 只读 GUI 知识工作台 | 云端多租户 SaaS |
| SQLite 单机存储 | 分布式图数据库 |

这一定位与当前实现基本一致。GUI 的“Knowledge Workspace”措辞没有改变服务定位，但容易让用户误以为它是完整 IDE/Agent 控制台，文档应明确“只读可视化窗口”。

### 3.3 D2 判定

**D2 定位表述不统一：已解决（基本）。**

README、README.zh-CN、pyproject、`__init__.py`、CLI help、MCP description 已统一到 local-first MCP service。残余问题只在历史文档，例如 `docs/archive/product/synapse-product-positioning.md` 仍包含“GUI 未实现”“GUI API 未提交”等时间点快照。这些应标注为历史基线，不应作为当前状态引用。

---

## 4. 代码库结构与依赖

### 4.1 分层结构

```text
src/synapse/
  domain/          枚举、模型、评分
  storage/sqlite/  Database、Repositories、Schema、Migrations
  parsers/         Python / Markdown / PlainText
  normalizer/      NodeDraft/RelationDraft 归一化、引用解析
  ingestion/       扫描、索引流水线、项目锁
  retrieval/       关键词/混合检索、图扩展
  context/         ContextBuilder
  knowledge/       apply_file / ingest_text
  tools/           ProjectTools / SearchTools / MemoryTools
  integrations/
    mcp/           stdio MCP Server
    cli/           Typer CLI
    gui/           FastAPI + 静态 SPA
```

分层意图是：

```text
CLI / MCP / GUI
      -> Tools -> Services -> Repositories -> SQLite
```

CLI 和 MCP 基本遵守；GUI 部分读取路径绕过 Tools，直接使用 Repository/ContextBuilder，见第 14 章。

### 4.2 依赖与入口

- `pyproject.toml` 定义 `synapse`、`synapse-mcp` 两个主要入口。
- GUI 通过 `python -m synapse.integrations.gui` 启动，FastAPI/uvicorn 放在 `gui` extra。
- MCP 使用 stdio，不监听端口。
- GUI 默认 `127.0.0.1:8765`，与 MCP/CLI 共享 `<home>/synapse.db`。

### 4.3 代码与测试规模

- mypy 检查 65 个源文件。
- `tests/` 有 10 个测试文件，41 个测试。
- 测试文件均为后端/核心能力测试，没有 `test_gui*.py`。
- 这说明 GUI 目前只有手工 API 冒烟，没有自动化回归保护。

### 4.4 工程质量基线

本次真实执行结果：

- `pytest`：41 passed
- `ruff check .`：All checks passed
- `mypy src`：Success: no issues found in 65 source files

静态质量良好，主要风险在契约正确性和能力深度，不在语法/类型层。

---

## 5. 数据模型与 SQLite Schema

### 5.1 核心表

| 表 | 作用 | 关键字段 |
|---|---|---|
| `projects` | 注册项目 | id, slug, root_path, last_indexed_at |
| `sources` | 文件/文本来源 | uri, source_type, content_hash, mtime_ns, size_bytes, status |
| `nodes` | 知识节点 | node_type, node_key, version, title, content, search_text, path, start/end_line, qualified_name, status, salience, confidence, memory_type, provenance, accessed_at, access_count, metadata_json |
| `relations` | 关系边 | from_node_id, to_node_id, relation_type, confidence, weight, provenance, evidence_json, status, access_count, last_accessed_at |
| `unresolved_refs` | 待解析引用 | ref_kind, target_text/path, line, resolved_node_id |
| `tasks` | 索引任务队列 | status, attempts, available_at, priority |
| `index_runs` | 索引运行记录 | mode, status, stats_json, error, started/finished_at |
| `node_fts` | FTS5 全文索引 | title, search_text, tags |

### 5.2 索引与一致性

- `node_fts` 通过触发器与 `nodes` 同步。
- `nodes` 有 `ux_nodes_key(source_id, node_type, node_key)` 唯一约束。
- `relations` 以 `stable_id(project_id, from_id, to_id, relation_type)` 去重。
- `upsert_many` 对节点执行 `ON CONFLICT(id) DO UPDATE`，`version = nodes.version + 1`。
- 关系 upsert 会合并 evidence，并用 `noisy_or` 提升置信度。
- `PRAGMA foreign_keys=ON`、WAL、`busy_timeout=5000ms`。

### 5.3 字段空转与未使用能力

| 字段/枚举 | 现状 | 影响 |
|---|---|---|
| `nodes.access_count` | 只读写模型，从未增加 | 无访问热度/衰减依据 |
| `nodes.accessed_at` | 从未更新 | 无法做“最近使用”排序 |
| `relations.access_count` | 从未增加 | 关系权重无法按使用强化 |
| `relations.last_accessed_at` | 从未更新 | 无生命周期 |
| `NodeStatus.ARCHIVED/TOMBSTONE` | 无写入路径 | 无法软删除/归档 |
| `NodeType.PROJECT` | 未持久化，Graph 默认排除 | 项目节点能力未实现 |
| `NodeType.NOTE` | `ingest_text` 可生成，但公共入口总是传 memory_type | 实际不会产生 note |
| `metadata_json` | 写入但查询 DTO 不暴露 | 解析元数据对 Agent 不可见 |
| `SearchMode.SEMANTIC` | 枚举存在，无实现 | 死枚举，易误导 |

这些属于 D11 的直接证据。

### 5.4 历史与生命周期

- `nodes.version` 只在覆盖更新时自增，但没有历史表、diff 或回滚。
- 没有 memory 的 update/delete/archive 表或 API。
- 没有任务历史分页 API，只有 `IndexRunRepository.latest`。
- 没有审计日志表。

---

## 6. 索引流水线

### 6.1 流水线阶段

```text
scan files
  -> source hash/mtime/size
  -> parser registry
  -> RawFile / RawNode / RawRef / RawRelation
  -> Normalizer -> NodeDraft / RelationDraft
  -> Repository upsert
  -> ReferenceResolver
  -> FTS triggers
  -> IndexRun stats
```

### 6.2 解析覆盖

| 文件类型 | 解析能力 | 产出 |
|---|---|---|
| Python | tree-sitter AST | file / class / function / method；CONTAINS、IMPORTS、INHERITS、CALLS、REFERENCES |
| Markdown | markdown-it | document / doc_section；CONTAINS、REFERENCES（链接） |
| Plain text | 文件级 | file 节点 |
| JSON/TOML/YAML/INI/CSV/XML 等 | 文件级 | file 节点，不做结构解析 |
| JS/TS/Go/Java/Rust 等 | 文件级 | file 节点，不做符号解析 |

证据：

- `parsers/registry.py` 仅注册 Python、Markdown、PlainText。
- `python_parser.py` 生成 `CONTAINS`、`IMPORTS`、`INHERITS`、`CALLS`。
- `markdown_parser.py` 生成 `CONTAINS` 和链接引用。
- `normalizer/resolver.py` 将引用解析为 `REFERENCES`/`IMPORTS`/`CALLS`/`INHERITS`。

### 6.3 引用解析的深度

`ReferenceResolver` 使用：

- `path_map`：文件路径
- `module_map`：Python 模块路径
- `symbol_map`：qualified_name_norm
- `short_map`：短名

它能把 import、继承、调用引用解析到目标节点，但仍是启发式：

- 短名冲突时可能错连或漏连。
- 不做类型推断，无法可靠解析 `self.x.method()` 的动态类型。
- 不建模构造函数参数注入。
- 不建模运行时注册、反射、字符串动态调用。
- 未解析引用保留在 `unresolved_refs`，但没有后续修复策略。

### 6.4 索引触发方式

- CLI：`synapse index`。
- GUI：`POST /api/v1/projects/{id}/index`。
- MCP：没有 index 工具。
- 没有文件 watcher、后台调度器或增量队列守护进程。
- 同一项目通过 FileLock 串行化索引，重复请求可能返回 `INDEX_LOCKED`/423。
- GUI 的 Reindex 是长 HTTP 请求，按钮禁用但没有进度、取消或 run_id 轮询。

因此 D6 定为 **部分解决**：GUI 可触发索引，但“索引自动化/后台化”未实现。

---

## 7. 知识图谱构建与图谱能力

### 7.1 节点类型

`NodeType` 有 9 种：

- project、file、class、function、method、document、doc_section、note、memory

实际公共入口可产生的类型：

- project：未使用
- note：未通过公共入口产生
- 其余 7 种可产生

### 7.2 关系类型

`RelationType` 有 12 种，但实际生成的只有 5 种：

| 关系 | 是否生成 | 来源 |
|---|---|---|
| CONTAINS | 是 | Python 类/函数、Markdown 章节 |
| IMPORTS | 是 | Python import |
| CALLS | 是 | Python 调用（文件内直接解析，跨文件经 refs） |
| INHERITS | 是 | Python 继承 |
| REFERENCES | 是 | 引用解析、Markdown 链接 |
| EXPLAINS | 否 | 无生成路径 |
| DEPENDS_ON | 否 | 无生成路径 |
| RELATED_TO | 否 | 无生成路径 |
| DERIVED_FROM | 否 | 无生成路径 |
| SOLVES | 否 | 无生成路径 |
| CONTRADICTS | 否 | 无生成路径 |
| MENTIONS | 否 | 无生成路径 |

代码证据：

- `domain/enums.py` 定义 12 种关系。
- `parsers/python_parser.py`、`parsers/markdown_parser.py`、`normalizer/resolver.py` 只产生上述 5 种。
- `docs/archive/product/synapse-product-positioning.md:179` 也明确记录“12 种关系类型，实际产生 5 种”。

GUI 的关系筛选下拉框展示全部 12 种（`app.js` 的 `RELATION_TYPES`），但其中 7 种永远无结果。这是用户可见的“空转字段”。

### 7.3 图谱查询能力

`query_service.graph_overview`：

1. 按 salience 取前 `max_nodes` 个种子节点。
2. 取每个种子最多 4 条关系，总关系上限 `max_nodes * 4`。
3. 把邻居节点加入，最多到 `max_nodes`。
4. 返回节点和边，`truncated` 表示是否截断。

限制：

- 不是全图查询，不能按路径/时间/子图分页。
- 种子完全由 salience 决定，可能遗漏低 salience 但结构重要的节点。
- 关系类型过滤只对已生成关系有效。
- 最大 200 节点，无法浏览大型项目全貌。

### 7.4 与“知识图谱”定位的差距

当前称其为“AST 索引 + 局部关系图”更准确。它支持：

- 符号搜索
- 文件/类/函数层级
- import/继承/调用/链接关系
- 一跳/多跳邻居探索

但不支持：

- 构造函数注入/依赖注入图
- 跨语言符号
- 数据流/控制流
- 业务概念与代码的语义关联
- 记忆/决策与代码的显式关系
- 动态调用和运行时注册

**D4 判定：未解决。**

---

## 8. 检索能力

### 8.1 检索模式

- `keyword`：FTS5 + bm25。
- `hybrid`：FTS + 精确符号 + 图扩展 + 多因子评分。
- `semantic`：未实现，仅是内部降级分支。

评分权重在 `RetrievalSettings`：

- lexical 0.60
- graph 0.20
- recency 0.08
- importance 0.07
- confidence 0.05

检索结果包含：

- node 基本信息
- score
- reasons
- snippet
- relations 数量
- confidence

### 8.2 入口暴露

| 入口 | 暴露模式 | 证据 |
|---|---|---|
| MCP | `Literal["keyword", "hybrid"]` | `integrations/mcp/server.py:141,354` |
| CLI | 运行时校验 keyword/hybrid | `integrations/cli/main.py:201,211,354,358` |
| GUI | `Literal["keyword", "hybrid"]` | `integrations/gui/app.py:202` |
| 内部 RetrievalService | `_MODES` 含 semantic，semantic 时记录 degraded | `retrieval/service.py:24,81-82` |

**D3 判定：已解决（外部入口）。**

三个用户入口都不再暴露 semantic；MCP 工具描述也明确说明 semantic 不可用。残余是内部死分支和 `SearchMode.SEMANTIC`，归入 D11，而不是入口暴露问题。

### 8.3 检索限制

- API `limit` 最大 50。
- 没有 `offset`，无法翻页。
- GUI 搜索固定 `limit: 20`。
- `meta.candidates` 是候选数量，不等于全部命中。
- FTS snippet 只截取局部，不能替代代码正文。
- 没有向量检索、rerank、语义相似度。

**D12 相关：检索分页未解决。**

### 8.4 检索质量判断

对于“找符号、找文件、找相关模块”，当前检索可用。对于“理解一个业务问题涉及哪些代码路径”，仍需要 Agent 多次搜索和读文件。检索是 lexical/graph，不是 semantic，文档已如实说明。

---

## 9. Context 构建能力

### 9.1 输出结构

`ContextBuilder.build` 输出：

```json
{
  "project": {"id", "name", "root_path"},
  "stats": {"nodes", "node_types", "relations", "sources"},
  "tech_stack": [...],
  "top_modules": [...],
  "decisions": [...],
  "recent_changes": [...],
  "token_estimate": 1234,
  "truncated": false
}
```

### 9.2 top_modules 的深度

`_module_brief` 返回：

- node_id
- node_type
- title
- path
- summary
- salience
- reason（query_match / cross_module_links / salience）

它不返回：

- 代码正文
- 函数签名
- 参数/返回类型
- import 关系
- 调用方/被调用方
- 相关测试
- 关键行号范围

Agent 拿到 top_modules 后，仍需要再调用 search 或读取文件。

### 9.3 tech_stack 的来源

- `_TECH_FILES` 通过根目录文件是否存在推断技术栈。
- `_dependencies` 从 `pyproject.toml` 等依赖文件读取名称。
- 这不是内容分析，也不能判断实际使用频率、入口框架或运行时版本。

### 9.4 query-aware 与 token 预算

已有改进：

- query 存在时，先用检索选出相关路径，再补充结构连接度高的模块。
- 输出 `token_estimate`。
- 超预算时设置 `truncated` 并调用 `_trim`。

但 `_trim` 主要是删减列表/字段，不是按“任务所需代码证据”重新组织上下文。预算控制存在，信息密度不足。

**D5 判定：未解决。** Context 仍是元数据级，不是“agent-ready code context”。

---

## 10. 记忆系统与生命周期

### 10.1 现有能力

- `remember`：写入 memory 节点 + source。
- `recall`：检索 memory/note。
- `list`：分页列出 memory，可按类型/查询过滤。
- `get`：读取完整内容和元数据。
- 记忆类型：fact、experience、decision、preference、summary。
- `idempotency_key`：相同内容可去重。
- summary：写入时截取前 300 字符。
- provenance：USER。
- confidence：写入时可指定。

### 10.2 生命周期缺口

| 能力 | 现状 |
|---|---|
| 编辑记忆 | 无 |
| 删除记忆 | 无 |
| 归档/墓碑 | 枚举存在，无写入 |
| 版本历史 | 无；只有 `version` 自增 |
| 冲突解决 | 无 |
| 记忆合并/去重策略 | 只有 idempotency key |
| 过期/TTL | 无 |
| 访问计数 | 字段存在，从不更新 |
| 最近访问排序 | 字段存在，从不更新 |
| 审计日志 | 无 |
| 记忆与代码关系 | 无 EXPLAINS/SOLVES 等关系生成 |

**D7 判定：未解决。**

### 10.3 可复现的分页/筛选错误

`MemoryTools.list` 的实现：

```python
window = offset + limit
if query:
    result = retrieval.search(..., limit=min(window, 50), ...)
    nodes = [...]
    total = len(nodes)
else:
    nodes = self._nodes.memories(project.id, limit=window)
    total = counts(...)
if memory_type:
    nodes = [n for n in nodes if n.memory_type.value == memory_type]
    total = len(nodes)
page = nodes[offset:offset + limit]
```

问题：

1. 带 query 时，检索最多只取 50 条，`total` 变成“已取回数量”，不是真实总数。
2. `offset > 50` 时，带 query 的翻页会直接返回空页。
3. 带 `memory_type` 时，先按 `updated_at` 取最近 `window` 条所有类型，再在内存中过滤；如果目标类型不在最近窗口内，会返回 0，即使实际存在。
4. GUI 的 Memory 页固定 `limit: 100`，没有分页控件；超过 100 条或目标类型被最近数据挤出窗口时，页面显示不完整甚至为空。

本次审计复现（临时库）：

- 写入 5 条 decision，再写入 60 条 fact。
- `GET /memories?memory_type=decision&limit=10` 返回 `total=0`、`memories=[]`。
- `GET /memories?q=fact&limit=1&offset=55` 返回 `total=50`、`memories=[]`。
- `GET /memories?limit=100` 返回 `total=65`、`memories=65`。

这不是“分页不完整”，而是**结果正确性缺陷**。**D12 判定：未解决。**

---

## 11. MCP 入口

### 11.1 工具清单

当前 MCP 暴露 9 个工具：

| 工具 | 作用 | 只读 |
|---|---|---|
| `synapse_projects_list` | 列出项目 | 是 |
| `synapse_project_status` | 项目统计/最后索引 | 是 |
| `synapse_search` | 项目内检索 | 是 |
| `synapse_related` | 相关节点 | 是 |
| `synapse_explore_graph` | 图探索 | 是 |
| `synapse_context` | 构建上下文 | 是 |
| `synapse_remember` | 写入记忆 | 否 |
| `synapse_recall` | 检索记忆 | 是 |
| `synapse_memory_get` | 读取完整记忆 | 是 |

### 11.2 优点

- 工具描述诚实说明 semantic 不可用。
- 项目作用域和节点归属校验存在，防止跨项目读取。
- stdout 只输出 JSON-RPC，日志走 stderr。
- 单 worker executor，符合 SQLite 线程模型。
- `memory_get` 补齐了“召回后读全文”的闭环。

### 11.3 缺口

- 没有 `index` 工具，Agent 无法主动刷新索引。
- 没有 `project_register`，Agent 不能注册新项目。
- 没有 `config`/`doctor`。
- 没有 resources/prompts。
- 没有关系写入/记忆更新/删除。
- 没有分页参数（search/related/explore 都只有 limit）。

**D8 判定：部分解决。**

---

## 12. CLI 入口

### 12.1 命令清单

- `version`
- `projects-list`
- `projects-register`
- `projects-status`
- `index`
- `search`
- `related`
- `explore`
- `remember`
- `recall`
- `memory-get`
- `context`
- `config-show` / `config-init`
- `doctor`

### 12.2 优点

- 覆盖注册、索引、检索、图探索、Context、记忆写入/读取、配置和诊断。
- 支持 `--json`，便于脚本化。
- 错误码统一，退出码可区分。
- `memory-get` 已补齐（D8 的历史缺口之一）。

### 12.3 缺口

- 没有 `memory-list`（只能 recall）。
- 没有 GUI 启动命令（只能 `python -m synapse.integrations.gui`）。
- 没有语义检索。
- search/recall 没有 offset。
- 没有历史索引 run 列表。

**D8 判定：部分解决。**

---

## 13. GUI 入口与六页面

### 13.1 API 路由

`integrations/gui/app.py` 提供：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/v1/health` | 健康检查（无鉴权） |
| GET | `/api/v1/projects` | 项目列表 |
| GET | `/api/v1/projects/{id}` | 项目详情 |
| GET | `/api/v1/projects/{id}/status` | 状态/任务/最后 run |
| POST | `/api/v1/projects/{id}/index` | 触发索引 |
| GET | `/api/v1/projects/{id}/overview` | 总览 |
| GET | `/api/v1/projects/{id}/search` | 搜索 |
| GET | `/api/v1/projects/{id}/graph/overview` | 图总览 |
| GET | `/api/v1/projects/{id}/nodes/{node_id}` | 节点详情 |
| GET | `/api/v1/projects/{id}/memories` | 记忆列表 |
| GET | `/api/v1/projects/{id}/memories/{node_id}` | 记忆详情 |
| GET | `/api/v1/projects/{id}/context` | Context 构建 |
| GET | `/api/v1/projects/{id}/graph/{node_id}/neighbors` | 邻居探索 |

所有 `/api/v1/*`（health 除外）要求 Bearer Token。

### 13.2 六页面实现

| 页面 | 主要功能 | 实现状态 |
|---|---|---|
| Overview | 项目头部、KPI、节点类型分布、最近索引、快速入口 | 可用 |
| Knowledge Graph | Canvas 图谱、类型/关系/数量筛选、缩放/拖拽、节点详情 | 可用 |
| Search | 查询、mode、类型、路径前缀、结果 snippet/reasons | 可用 |
| Memory | 类型筛选、搜索、列表、详情、跳转图谱 | 可用，只读 |
| Context | query、token 预算、分区展示、原始 JSON | 可用 |
| Indexing | 最后 run 统计、任务队列、Reindex、命令复制 | 可用 |

六页面不是占位：`app.js` 分别有 `renderOverview`、`renderGraph`、`renderSearch`、`renderMemory`、`renderContext`、`renderIndexing`，并有节点 Inspector、token 输入、连接状态、项目切换。

### 13.3 完成度评估

按不同目标分别评估：

| 维度 | 估计完成度 | 说明 |
|---|---|---|
| 页面骨架/导航/路由 | 100% | 六页面齐全 |
| 只读数据呈现 | 90% | 主要数据均有展示 |
| 筛选/详情/联动 | 85% | 图/搜索/记忆/Context 均可交互 |
| 分页/大数据浏览 | 40% | Memory 无分页，Search 固定 20，Graph 上限 200 |
| 写入操作 | 0% | 无 GUI remember/编辑/删除 |
| 索引任务体验 | 50% | 可触发，无进度/取消/run_id 轮询 |
| 自动化测试 | 0% | 无 GUI 测试文件 |
| 视觉一致性 | 85% | token 高度接近，语义色坍缩 |
| **只读 MVP 综合** | **约 80%** | 可演示、可使用，但边界体验不足 |
| **产品级综合** | **约 65-70%** | 缺写入、分页、进度、测试 |

### 13.4 GUI API 冒烟结果

本次使用临时 home 和 TestClient：

- health、projects、status、overview、graph、search、memories、context、static `/` 均返回 200。
- 未鉴权 `/api/v1/projects` 返回 401。
- 不存在的 node neighbors 返回 404。
- 搜索 meta 示例：`{"mode":"hybrid","degraded":[],"candidates":...,"returned":20,"took_ms":...}`。
- Context 返回 `token_estimate`、`truncated`。
- 记忆分页/筛选缺陷已复现，见 10.3。

### 13.5 GUI 主要问题

1. Memory 页无分页控件，固定 `limit: 100`。
2. Search 固定 `limit: 20`，无加载更多。
3. Reindex 是阻塞式请求，无进度条/取消。
4. 无 GUI 写入能力（只读）。
5. 无 GUI 自动化测试。
6. `emptyState(title, detail)` 的 `detail` 不转义；当前调用都是静态字符串，但这是潜在 XSS 模式。
7. Graph 关系筛选展示 12 种，实际 7 种永远为空。
8. 图谱默认最多 80 节点，最大 200，不能浏览全图。

---

## 14. 入口对称性、业务规则复用与架构边界

### 14.1 能力矩阵

图例：有 = 直接可用；部分 = 有限制/需间接方式；无 = 不提供。

| 能力 | MCP | CLI | GUI |
|---|---|---|---|
| 注册项目 | 无 | 有 | 无 |
| 列出项目 | 有 | 有 | 有 |
| 项目状态 | 有 | 有 | 有 |
| 触发索引 | 无 | 有 | 有 |
| 搜索 | 有 | 有 | 有 |
| 相关节点 | 有 | 有 | 有 |
| 图探索 | 有 | 有 | 有 |
| Context | 有 | 有 | 有 |
| 写入记忆 | 有 | 有 | 无 |
| 召回记忆 | 有 | 有 | 部分（列表 + 搜索） |
| 列出记忆 | 部分（recall） | 无 | 有 |
| 读取记忆全文 | 有 | 有 | 有 |
| 配置查看/初始化 | 无 | 有 | 无 |
| 诊断 doctor | 无 | 有 | 无 |
| 索引历史 | 部分（仅最后 run） | 部分（status） | 部分（仅最后 run） |
| 分页 | 部分 | 部分 | 部分 |
| 语义检索 | 无 | 无 | 无 |

**D8 判定：部分解决。** 历史缺口“CLI 无 memory-get”已修复，GUI 也补了 memory/index/context 端点；但 MCP 仍不能 index/register，GUI 不能 remember，CLI 不能 list memories，入口能力仍不对称。

### 14.2 D9 业务规则重复

已解决的部分：

- `core/validation.py::normalize_path_prefix` 统一了路径前缀校验：反斜杠转正斜杠、空值忽略、拒绝绝对路径/盘符/`..`。
- CLI、MCP、GUI 都调用这一规则，路径校验不再三份实现。

仍存在的重复：

| 重复逻辑 | 位置 A | 位置 B | 风险 |
|---|---|---|---|
| `_split_csv` | `gui/query_service.py:16` | `retrieval/service.py` 内部 | 解析规则漂移 |
| `_node_type_values` | `gui/query_service.py:23` | `retrieval/service.py::_node_types` | 类型校验重复 |
| `_relation_type_values` | `gui/query_service.py:35` | `retrieval/service.py::_relation_types` | 关系校验重复 |
| `project_payload` | `gui/query_service.py:47` | `tools/project_tools.py::_project_payload` | 字段不一致（GUI 有 updated_at，Tools 没有） |
| `node_payload` | `gui/query_service.py:60` | `tools/memory_tools.py::_node_payload`、`retrieval/service.py` | 返回字段不一致 |
| `_TASK_STATUSES` | `gui/query_service.py:13` | `domain/enums.py::TaskStatus` | 新增状态需改两处 |
| 前端类型列表 | `app.js` 的 `NODE_TYPES`/`RELATION_TYPES`/`MEMORY_TYPES` | 后端枚举 | 前后端漂移 |

**D9 判定：部分解决。**

### 14.3 D10 GUI 绕过 Tools

GUI 的部分路径是合规的：

- `search_nodes` -> `application.search_tools.search`
- `list_memories` -> `application.memory_tools.list`
- `run_index` -> `application.project_tools.index`
- `project_status` -> `application.project_tools.status`

但以下路径直接使用 Repository/Builder：

- `graph_overview` -> `application.nodes.top_by_salience`、`application.relations.get_neighbors`、`application.nodes.get_many`
- `node_detail` -> `application.nodes.get`、`application.search_tools.get_related`（部分合规）
- `graph_neighbors` -> `application.nodes.get`、`application.search_tools.explore_graph`
- `project_overview` -> `application.context.build`
- `context_inspection` -> `application.context.build`
- `_related_for_project` -> `application.nodes.get_many`

`docs/architecture/overview.md:157` 自己写明：记忆列表通过 `MemoryTools.list()`，节点图读取由 Repository 完成。这说明绕过是已知设计，不应再被描述为“完全同源”。

**D10 判定：部分解决。**

### 14.4 风险

- GUI 与 MCP/CLI 可能对同一数据返回不同字段/不同过滤语义。
- 权限、项目归属、状态过滤逻辑只在一条路径上实现，容易漏。
- 后续若新增 Service 级规则，GUI 必须重复修改。
- 测试无法覆盖所有入口组合。

### 14.5 建议

1. 提取共享 DTO/序列化模块（project/node/relation/memory payload）。
2. 在 Tools 或 Service 层提供 graph overview / node detail / context inspection 的正式方法，GUI 只做 HTTP 映射。
3. 用枚举驱动前端类型列表（构建时生成或 API 返回 facets）。
4. 把 `_TASK_STATUSES` 改为 `TaskStatus` 枚举派生。

---

## 15. GUI 视觉与官网一致性

### 15.1 视觉基准

官网 `D:\SynapseWebsite\src\app\globals.css` 与 GUI `styles.css` 的 token 对照：

| Token | 官网 | GUI | 是否一致 |
|---|---|---|---|
| background/ink | `#09090b` | `#09090b` | 是 |
| panel | `#111113` | `#111113` | 是 |
| panel-2 | `#18181b` | `#18181b` | 是 |
| brand | `#e4e4e7` | `#e4e4e7` | 是 |
| brand-soft | `#f4f4f5` | `#f4f4f5` | 是 |
| line | `rgba(255,255,255,0.12)` | `rgba(255,255,255,0.12)` | 是 |
| muted | `#a1a1aa` | `#a1a1aa` | 是 |
| violet | `#71717a` | `#a1a1aa` | 否 |
| sky | 官网未定义 | `#a1a1aa` | GUI 自设 |
| amber | 官网未定义 | `#a1a1aa` | GUI 自设 |
| red | 官网 destructive 为 `#a1a1aa` | `#d4d4d8` | 否 |
| green | 官网未定义 | `#fafafa` | GUI 自设 |

### 15.2 一致的部分

- 深色 zinc 单色体系。
- Geist / Geist Mono 字体栈。
- 发丝边框、pill 控件、面板圆角。
- 低饱和、低对比的“技术工具”气质。
- `styles.css` 头注释明确写“visual system aligned with the marketing site”。

### 15.3 不一致的部分

1. `--violet`：官网 `#71717a`，GUI `#a1a1aa`。
2. 语义色坍缩：`--sky`、`--amber`、`--violet` 都是 `#a1a1aa`；`--red` 是 `#d4d4d8`；`--green` 是 `#fafafa`。
3. 结果：成功/警告/错误/信息在视觉上几乎不可区分，只能靠文字。
4. `NODE_COLORS.note` 使用 `#9ca3af`，不在 zinc token 体系内。
5. GUI 多出 `--line-soft`、`--line-strong`，属于合理扩展，不构成偏差。

### 15.4 影响

- 错误、警告、成功状态的视觉辨识度低，增加误读风险。
- 图谱节点类型颜色区分度弱，复杂图上难以快速识别。
- 与官网“单色高级感”一致，但牺牲了信息编码。
- 对色弱用户不友好。

### 15.5 建议

- 至少恢复一组低饱和语义色：success、warning、danger、info。
- 对齐 `--violet`。
- 保持主视觉单色，但让状态点/边框有可区分色相。
- 增加视觉回归测试或截图基线。

**说明：本章为 CSS/JS 源码级对照，未做浏览器像素级对比。**

---

## 16. 前端实现质量

### 16.1 结构

- `app.js` 约 1769 行，单文件、无构建步骤、无框架。
- 自己实现路由、状态、API 封装、Canvas 图谱、Inspector、Toast、Token 弹窗。
- `styles.css` 592 行，完整设计系统。
- `index.html` 提供导航骨架和 SVG sprite。

优点：

- 依赖少，部署简单。
- 无构建链，FastAPI 直接托管。
- 主要动态内容使用 `esc()` 转义。
- `highlight()` 先转义再包 `<mark>`，避免 HTML 注入。
- 错误信息基本都经过 `esc()`。

问题：

1. **无自动化测试**：没有 DOM/浏览器测试，也没有 API 级 GUI 测试。
2. **`emptyState` 的 detail 未转义**：当前只传静态字符串，但接口设计上允许动态内容，属于潜在 XSS 模式。
3. **Memory 无分页**：固定 `limit: 100`，无 offset 控件。
4. **Search 无分页**：固定 `limit: 20`。
5. **Reindex 阻塞**：长请求，只有按钮禁用，无进度/取消。
6. **Token 处理**：支持从 URL query 读取 token 后写入 sessionStorage，并清理 URL；token 仍可能在初次访问时进入浏览器历史/日志。
7. **单文件维护成本**：1769 行集中在 `app.js`，后续加写入/分页/进度会继续膨胀。
8. **可访问性未审计**：Canvas 图谱、键盘导航、ARIA 状态未验证。
9. **响应式未审计**：窄屏布局、移动端未验证。

### 16.2 前端问题清单

| ID | 严重程度 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| AUD-13 | Low | `emptyState` detail 不转义 | `app.js:161` | 对 detail 做 `esc`，或改为显式 HTML 片段 API |
| AUD-14 | Low | Memory/Search 无分页控件 | `app.js:1277,1167` | 增加 offset/limit 控件，配合后端修复 |
| AUD-15 | Low | Reindex 无进度/取消 | `renderIndexing` 的 `#index-run` 处理 | 改为异步 run + 轮询/SSE |
| AUD-16 | Low | 图谱上限固定 | `app.js:48`、API `max_nodes<=200` | 增加分页/子图/按路径浏览 |

---

## 17. SQLite 并发、事务与安全

### 17.1 并发模型

- `Database` 使用 thread-local 连接。
- WAL 模式，`synchronous=NORMAL`。
- `busy_timeout=5000ms`。
- 写事务使用 `BEGIN IMMEDIATE` + `RLock`。
- `CoreWorker` 单线程 `ThreadPoolExecutor(max_workers=1)`。
- MCP `McpRuntime` 同样单 worker 线程。
- 项目索引使用 FileLock，同项目串行。

评价：

- 单进程内模型清晰，避免了 SQLite 跨线程共享连接问题。
- 多进程（CLI index + GUI/MCP）仍可能竞争，但 WAL + busy_timeout + FileLock 提供了基本保护。
- 未做多进程高并发压测，不能证明在重负载下无 `DB_BUSY`。

### 17.2 安全边界

GUI 安全实现：

- 仅允许 loopback Host：`127.0.0.1`、`localhost`、`::1`、`testserver`。
- Origin 必须是 loopback，且等于 Host 或在允许列表。
- 拒绝 `Origin: null`。
- 默认开发 Origin：`http://127.0.0.1:5173`、`http://localhost:5173`。
- `SYNAPSE_GUI_ALLOWED_ORIGINS` 可追加。
- Token：`SYNAPSE_GUI_TOKEN` 或 `secrets.token_urlsafe(32)`。
- Token 比较使用 `secrets.compare_digest`。
- CORS 只允许 GET/POST/OPTIONS，Authorization/Content-Type。
- 未捕获异常返回统一 500，不泄露 traceback。
- `/api/v1/health` 公开，仅返回 status/version。

评价：本地 GUI 的安全基线合格。残余风险：

1. `testserver` 在生产 allowlist 中没有必要，建议仅在测试环境注入。
2. Token 可从 URL query 进入浏览器历史；建议只支持粘贴/环境变量，或明确一次性 URL。
3. 若用户用 `--host 0.0.0.0` 启动，Host 校验会让服务不可用；这是安全默认，但文档应说明。
4. 没有速率限制/会话过期；本地单用户场景可接受。

### 17.3 错误映射

`gui/app.py::_STATUS_CODES` 覆盖：

- 400 INVALID_ARGUMENT
- 404 PROJECT_NOT_FOUND / NODE_NOT_FOUND
- 409 AMBIGUOUS_PROJECT / CONFLICT_VERSION
- 423 INDEX_LOCKED
- 422 PARSER_ERROR
- 500 STORAGE_ERROR / INTERNAL
- 501 NOT_IMPLEMENTED
- 503 DB_BUSY / INDEX_UNAVAILABLE

错误 envelope 统一为 `{"error": {"code", "message", "details"}}`，前端能显示 message。评价良好。

---

## 18. 文档、测试与工程质量

### 18.1 文档漂移（D1）

| 文档 | 问题 | 冲突对象 |
|---|---|---|
| `docs/guides/getting-started.md:60` | 仍写 `--mode keyword\|hybrid\|semantic`，并称 semantic 会降级 | `README.md:20`、`docs/reference/cli.md:67` 明确不暴露 semantic |
| `docs/archive/design/phase-3.0-architecture.md:3` | 头部仍写“架构设计完成，尚未实现 GUI” | 同文件 line 7 已说明 Phase 3.1 已包含只读 GUI API；实际已有 GUI |
| `docs/archive/product/synapse-product-positioning.md` | 仍包含“GUI API 未提交”“GUI 前端不存在”“GUI 未实现”等历史快照 | 当前 README、`integrations/gui/`、提交历史 |
| `docs/guides/development.md` | 测试地图只有 10 个后端测试文件，无 GUI 测试 | 不是文档错误，但暴露测试缺口 |

**D1 判定：部分解决。**

- 入口文档（README、cli.md、mcp.md、limitations.md）对 semantic 的口径已统一。
- 旧 getting-started 和 phase-3.0 状态头仍漂移。
- `synapse-product-positioning.md` 是时间点审查文档，应标注“历史基线，不代表当前状态”。

### 18.2 文档做得好的部分

- `docs/reference/limitations.md` 如实列出：无 watcher、记忆只读、无分页 UI、无全图、无 semantic。
- `docs/architecture/overview.md` 如实说明 GUI 图读取走 Repository。
- `docs/reference/mcp.md` 说明 9 工具、stdio、项目作用域、错误处理。
- README 对安装、CLI、MCP、GUI 的说明完整。

### 18.3 测试覆盖

现有 10 个测试文件覆盖：

- 边界/幂等/mtime/size/路径大小写/Context 预算
- 配置优先级
- Context/query-aware/token
- FTS
- 索引锁
- MCP Server
- 流水线
- 崩溃恢复
- Source 一致性
- 文本分块/CJK

缺口：

- 没有 GUI API 测试。
- 没有 memory list 分页/筛选测试。
- 没有入口能力矩阵契约测试。
- 没有大项目性能测试。
- 没有前端单元/DOM 测试。

### 18.4 建议

1. 新增 `tests/test_gui_api.py`：TestClient + 临时 home，覆盖 13 个路由、鉴权、错误码、分页。
2. 新增 `tests/test_memory_lifecycle.py`：分页、类型过滤、超过 50/100 条、offset 边界。
3. 新增入口契约测试：同一 fixture 下 MCP/CLI/GUI 返回核心字段一致。
4. 文档 CI：检查 getting-started 的 mode 列表与 CLI/MCP 实际暴露一致。

### 18.5 本次自动化检查

在临时 `SYNAPSE_HOME` 下执行：

```powershell
.\.venv\Scripts\python.exe -m pytest -q --disable-warnings --maxfail=1
# 41 passed

.\.venv\Scripts\python.exe -m ruff check .
# All checks passed!

.\.venv\Scripts\python.exe -m mypy src
# Success: no issues found in 65 source files
```

### 18.6 GUI API 冒烟

使用 FastAPI TestClient、临时 home、临时项目：

- `/api/v1/health` -> 200
- `/api/v1/projects` -> 200
- `/api/v1/projects/{id}/status` -> 200
- `/api/v1/projects/{id}/overview` -> 200
- `/api/v1/projects/{id}/graph/overview` -> 200
- `/api/v1/projects/{id}/search` -> 200
- `/api/v1/projects/{id}/memories` -> 200
- `/api/v1/projects/{id}/context` -> 200
- `/` -> 200
- 未鉴权 `/api/v1/projects` -> 401
- 不存在的 node neighbors -> 404

### 18.7 分页缺陷复现

临时库写入 5 条 decision、60 条 fact：

| 请求 | 结果 |
|---|---|
| `GET /memories?memory_type=decision&limit=10` | `total=0`，`memories=[]` |
| `GET /memories?q=fact&limit=1&offset=55` | `total=50`，`memories=[]` |
| `GET /memories?limit=100` | `total=65`，`memories=65` |

结论：Memory list 的类型过滤和 query 分页在数据量超过窗口/50 条时返回错误结果。

### 18.8 历史结果处理

历史报告中的测试数字、GUI 提交状态、semantic 描述不作为本次结论，仅用于定位偏差。本次结论以上述实时执行和源码证据为准。

---

## 19. D1-D12 偏差复核总表

| ID | 偏差 | 判定 | 关键证据 | 说明 |
|---|---|---|---|---|
| D1 | 文档漂移（GUI/semantic/状态） | 部分解决 | `docs/guides/getting-started.md:60`、`docs/archive/design/phase-3.0-architecture.md:3`、`docs/archive/product/synapse-product-positioning.md` 历史快照 | 入口文档已统一，旧文档仍漂移 |
| D2 | 产品定位表述不统一 | 已解决 | README:5、pyproject:8、`__init__.py:1`、MCP description、CLI help | 历史文档需标注基线 |
| D3 | semantic 暴露不一致 | 已解决 | CLI `main.py:211`、MCP `server.py:141`、GUI `app.py:202` | 外部入口均不暴露；内部死分支归 D11 |
| D4 | 图谱深度不足 | 未解决 | 仅 Python/Markdown；5 种关系；无构造注入/动态调用；`resolver.py` 启发式 | 仍是 AST 索引级图谱 |
| D5 | Context 仅元数据级 | 未解决 | `context/builder.py::_module_brief` 只返回 summary/salience 等；无代码正文/签名 | query-aware 已有，但深度不足 |
| D6 | 索引依赖人工 | 部分解决 | GUI `POST /index` 可用；CLI index；无 watcher/MCP index | GUI 可触发，但无后台/自动 |
| D7 | 记忆缺生命周期 | 未解决 | 只有 remember/recall/list/get；无 update/delete/archive/version history；access_count 未更新 | 长期记忆不可维护 |
| D8 | 入口能力不对称 | 部分解决 | CLI memory-get 已加；GUI memory/index/context 已加；MCP 无 index/register；GUI 无 remember；CLI 无 memory-list | 主要缺口仍在写/索引/注册 |
| D9 | 业务规则重复 | 部分解决 | `core/validation.py` 已收敛路径；GUI `query_service.py` 仍重复 payload/类型校验 | 路径规则解决，其他重复仍在 |
| D10 | GUI 绕过 Tools | 部分解决 | `graph_overview`/`node_detail`/`context_inspection` 直接访问 Repository/Builder | `docs/architecture/overview.md:157` 自认 |
| D11 | 字段空转 | 未解决 | `access_count`/`accessed_at` 无写入；`ARCHIVED/TOMBSTONE` 未用；`SearchMode.SEMANTIC` 死枚举；7 种关系无生成；metadata 不暴露 | 用户可见空筛选/空字段 |
| D12 | 分页不完整 | 未解决 | Memory query 上限 50、type 过滤先截断导致 total/结果错误；Search 无 offset；Graph 最大 200；GUI 固定 limit | 含正确性缺陷，不只是缺 UI |

### 19.1 状态汇总

- 已解决：D2、D3
- 部分解决：D1、D6、D8、D9、D10
- 未解决：D4、D5、D7、D11、D12
- 已恶化：无
- 无法验证：无（本报告范围内均有源码/运行证据）

---

## 20. 问题清单、整改路线与审计结论

### 20.1 问题清单

#### High

| ID | 问题 | 证据（文件/函数） | 影响 | 建议 |
|---|---|---|---|---|
| AUD-01 | 图谱语义深度不足 | `parsers/python_parser.py`、`normalizer/resolver.py`；仅 5 种关系生成 | Agent 无法理解构造注入、动态调用、跨语言依赖 | 增加跨文件调用解析、构造注入、关系生成器、语言解析器 |
| AUD-02 | Context 仍为元数据级 | `context/builder.py::_module_brief`、`_tech_stack` | 不能一次调用提供可读代码上下文 | 加入签名、关键片段、关系证据、按任务组装的 token 预算 |
| AUD-03 | 记忆无生命周期 | `tools/memory_tools.py` 仅 CRUD 的 C/R；`nodes.version` 无历史；`ARCHIVED/TOMBSTONE` 未用 | 记忆陈旧/冲突/不可纠正 | 增加 update/delete/archive/version/merge/expiry/访问计数 |
| AUD-04 | 记忆分页与筛选结果错误 | `tools/memory_tools.py::list` 的 `min(window, 50)`、先截断后过滤、`total=len(nodes)`；本次复现 5 decision + 60 fact -> decision total 0 | GUI/API 漏数据、总数错误、翻页为空 | 在 SQL 层做类型/查询过滤和 count；去掉 50 硬上限；补 offset 测试 |
| AUD-05 | GUI 绕过 Tools、重复业务规则 | `gui/query_service.py::graph_overview/node_detail/context_inspection`；重复 payload/type 校验 | 三入口行为漂移，规则重复 | 提取共享 service/DTO；GUI 只做 HTTP 映射 |
| AUD-06 | 无 GUI 自动化测试 | `tests/` 仅 10 个后端文件，无 `test_gui*` | GUI 回归不可发现 | 新增 TestClient 路由/鉴权/分页/错误码测试 |

#### Medium

| ID | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| AUD-07 | 文档漂移 | `docs/guides/getting-started.md:60`、`docs/archive/design/phase-3.0-architecture.md:3`、`docs/archive/product/synapse-product-positioning.md` | 用户按错误模式/状态操作 | 统一 semantic 口径；标注历史基线 |
| AUD-08 | 索引仅人工/同步 | 无 watcher；MCP 无 index；GUI POST 阻塞 | Agent 无法主动刷新；大项目 UI 等待 | 增加 MCP index、后台 job、进度/取消 |
| AUD-09 | 入口能力不对称 | 能力矩阵 14.1 | 用户需切换入口完成闭环 | 明确每入口最低能力集；补 MCP register/index、CLI memory-list、GUI remember |
| AUD-10 | 字段/枚举空转 | `access_count`、`ARCHIVED/TOMBSTONE`、`SearchMode.SEMANTIC`、7 种关系、`metadata_json` | 用户看到空筛选/假字段；维护困惑 | 删除死枚举或实现；前端只展示实际关系 |
| AUD-11 | 视觉语义色坍缩 | `styles.css:21-25`；`--violet` 与官网不一致 | 状态辨识度低；与官网细节不一致 | 恢复语义色；对齐 violet；视觉回归 |
| AUD-12 | 搜索/图谱分页不足 | search 无 offset；GUI limit 20；graph max 200 | 大项目无法浏览/翻页 | 增加 offset/游标；GUI 加载更多/分页 |

#### Low

| ID | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| AUD-13 | `emptyState` detail 未转义 | `app.js:161` | 潜在 XSS（当前静态调用） | 转义 detail 或显式 HTML 片段 API |
| AUD-14 | Memory 无分页控件 | `app.js:1277` | 超过 100 条不可见 | 配合 AUD-04 增加分页 |
| AUD-15 | Reindex 无进度/取消 | `renderIndexing` | 长任务体验差 | 异步 run + 轮询/SSE |
| AUD-16 | 图谱上限固定 | `app.js:48`、`app.py` graph `<=200` | 无法看全图 | 子图/路径/分页浏览 |
| AUD-17 | `testserver` 在 Host allowlist | `security.py:13` | 生产环境多余信任 | 仅测试注入 |
| AUD-18 | Token 可经 URL 进入历史 | `app.js` `readToken` | 本地 token 泄露面 | 改用粘贴/环境变量/一次性 URL |

### 20.2 路线表

| 阶段 | 目标 | 具体任务 | 前置依赖 | 优先级 | 验收标准 |
|---|---|---|---|---|---|
| P0 | 修正契约正确性与文档 | 修复 Memory list SQL 过滤/count/offset；去掉 query 50 硬上限；补 `test_memory_lifecycle.py`；统一 getting-started/phase-3.0；标注 historical positioning | 无 | 最高 | 5 decision + 60 fact 场景类型过滤正确；offset 55 可翻页；文档 mode 口径一致 |
| P0 | 建立 GUI 回归保护 | 新增 `tests/test_gui_api.py`：13 路由、401、404、423、分页、static | P0 契约修复 | 最高 | GUI 测试纳入 pytest；CI 可跑 |
| P1 | 提升 Context 信息密度 | `_module_brief` 增加签名/起止行/关键片段/关系证据；按 query 组装代码上下文；预算内裁剪 | 无 | 高 | `synapse_context` 在 token 预算内返回可读代码片段；有测试 |
| P1 | 图谱关系深化 | 跨文件调用解析、构造注入、import 作用域、关系生成器；前端只展示实际关系 | 无 | 高 | fixture 项目中构造注入/跨文件调用可被解析；关系类型与实际一致 |
| P1 | 消除 GUI 绕过/重复 | 提取共享 DTO；在 Tools/Service 提供 graph/node/context 方法；GUI 调用统一入口 | P1 Context/图谱接口 | 高 | GUI 与 MCP/CLI 同 fixture 返回一致核心字段 |
| P2 | 记忆生命周期 | update/delete/archive/version history/merge/expiry/access_count；Memory 写入 GUI | P0 Memory 契约 | 中高 | 可编辑/删除/归档；版本可查；access_count 增长 |
| P2 | 入口对称性 | MCP index/register；CLI memory-list；GUI remember；统一分页参数 | P0/P2 记忆 | 中 | 能力矩阵中“无”项有明确计划或已补齐 |
| P3 | 索引后台化 | watcher/后台队列/run_id 轮询/取消；MCP index | P2 入口 | 中 | 索引不阻塞 HTTP；可查询进度；可取消 |
| P3 | 视觉与可访问性 | 恢复语义色；对齐 violet；图谱颜色；键盘/ARIA；截图基线 | 无 | 低中 | 状态可区分；视觉回归通过；基本 a11y 检查通过 |

### 20.3 审计结论

1. Synapse 的定位是成立的：本地优先、SQLite、MCP 服务、同一 Core 多入口。
2. GUI 六页面是真实实现，不是占位；只读 MVP 可用，视觉与官网高度接近。
3. 当前最大短板不是页面数量，而是核心能力深度：图谱、Context、记忆生命周期。
4. D12 不是单纯“缺分页 UI”，而是记忆查询结果正确性问题，应作为 P0。
5. D9/D10 是后续功能扩展的主要维护风险，应在写入型 GUI 之前收敛。
6. 测试基线良好，但 GUI 和分页边界缺测试，不能支撑“GUI 已完成”的强结论。

---

## 附录 A：十条最终汇报

1. **真实状态**：Synapse 是边界清晰的 local-first MCP 服务，Core 质量良好；GUI 六页面已落地，但整体仍处于“只读 MVP + 核心能力待深化”阶段。
2. **D1-D12**：已解决 D2、D3；部分解决 D1、D6、D8、D9、D10；未解决 D4、D5、D7、D11、D12；无已恶化项。
3. **Top 5 问题**：图谱深度不足、Context 元数据级、记忆无生命周期、记忆分页/筛选错误、GUI 绕过 Tools/重复规则且无自动化测试。
4. **GUI 完成度**：六页面 6/6 可用；只读 MVP 约 80%，产品级约 65-70%；缺写入、分页、进度、测试。
5. **图谱能力**：Python AST + Markdown 链接 + 启发式引用解析；实际只产生 5 种关系；无构造注入、动态调用、跨语言、数据流。
6. **Context 能力**：有 query-aware 和 token 预算，但 top_modules 只有路径/摘要/salience，没有代码正文/签名/关系证据，仍属元数据级。
7. **Top 3 优先项**：修复 Memory 分页/筛选正确性；提升 Context 代码密度；深化跨文件调用/构造注入关系。
8. **报告路径**：`docs/research/post-gui-technical-audit.md`。
9. **测试结果**：pytest 41 passed；ruff All checks passed；mypy 65 files no issues；GUI API 冒烟通过；Memory 分页/筛选缺陷已复现。
10. **未验证事项**：真实浏览器视觉/响应式、真实 MCP 客户端 E2E、大项目性能、多进程压力、跨平台、可访问性、安全渗透、DB 恢复、Memory 生命周期、semantic 检索、GUI 自动化测试、图谱语义正确率。
