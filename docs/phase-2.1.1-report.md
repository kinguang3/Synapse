# Phase 2.1.1 真实 Trae E2E 验证报告

## 目标

在真实 Trae 对话中验证 Synapse MCP Server 的端到端能力，覆盖：

1. 项目发现与状态查询；
2. 代码搜索与定位；
3. 节点关系与局部图探索；
4. 项目上下文构建；
5. 长期记忆写入；
6. 新会话跨会话召回。

本轮只做验证，不新增 MCP 工具、不修改 Core/SQLite Schema、不提交 Git。

## 环境与隔离

| 项目 | 值 |
| --- | --- |
| Trae | Trae CN `3.4.16`，安装版本 `1.107.1` |
| Trae profile | 真实用户 profile |
| 真实配置 | `<trae-user-config>` |
| 配置备份 | `<private-evidence-dir>\mcp.json.before-phase-2.1.1` |
| 隔离 Synapse home | `<test-root>\phase-2.1.1-home` |
| 测试数据库 | `<test-root>\phase-2.1.1-home\synapse.db` |
| 测试项目 | `<repo-root>` |
| 项目 ID | `01d1c724-8c19-53fb-80ef-298efe1fa976` |
| 项目 slug | `synapse` |
| 测试标识 | `SYNAPSE_E2E_2.1.1_20261109` |
| Synapse MCP | `0.1.0` |
| Python | `3.12.8` |
| MCP SDK | `2.3.0` |

真实 Trae 配置在本轮测试期间临时加入 `synapse` entry，指向隔离 home。测试结束后已恢复原配置：

| 状态 | SHA256 |
| --- | --- |
| 测试前备份 | `<config-sha256-before>` |
| 测试期间配置 | `<config-sha256-during-test>` |
| 恢复后配置 | `<config-sha256-before>` |

> 为保护个人信息，本公开报告使用 `<trae-user-config>`、`<test-root>`、`<private-evidence-dir>`、`<repo-root>` 等占位符替代本机路径；完整证据保留在本地私有测试目录，不随仓库发布。

## 执行方法

1. 在真实 Trae 中打开 `<repo-root>`。
2. 临时配置 Synapse MCP，确认真实 Trae 发现 8 个工具。
3. 用户在新会话中手工执行 A-E。
4. 用户再新开独立会话执行 F，不提前提供记忆正文。
5. 从 Trae MCP render 日志提取工具名、参数、会话 ID 和返回结果。
6. 从隔离 SQLite 验证记忆节点、source 和计数变化。
7. 恢复真实 Trae 配置，运行回归测试并生成报告。

## 结果总览

| 测试 | 场景 | 使用工具 | 结果 |
| --- | --- | --- | --- |
| A | 项目发现与状态 | `synapse_projects_list`、`synapse_project_status` | 通过 |
| B | 代码定位与职责 | `synapse_search` | 通过 |
| C | 关系与图探索 | `synapse_search`、`synapse_explore_graph`、`synapse_related` | 通过，存在图建模限制 |
| D | 项目上下文 | `synapse_context` | 工具通过，上下文覆盖不足 |
| E | 长期记忆写入 | `synapse_remember` | 通过 |
| F | 新会话记忆召回 | `synapse_recall` | 核心召回通过，返回字段不完整 |

Trae 日志共记录 12 次 Synapse 工具调用，全部 `code=0`、`hasError=false`。A-E 使用会话 `<session-a-e>`，F 使用独立会话 `<session-f>`。

## 详细结果

### A：项目查询

Trae 依次调用了：

- `synapse_projects_list`：返回 1 个已注册项目；
- `synapse_project_status`：参数 `project="synapse"`，返回项目状态。

索引结果：

| 指标 | 值 |
| --- | --- |
| 节点数 | 637 |
| 关系数 | 1234 |
| 来源数 | 81 |
| 未解析引用 | 445 |
| 最近运行 | `01M6ZQ51B9XPXNPPFYC9DVR961` |
| 运行模式 | `incremental` |
| 运行状态 | `succeeded` |
| 扫描 / 变更 | 81 / 81 |
| 节点 upsert | 637 |
| 关系 upsert | 808 |
| 解析引用 | resolved 457 / unresolved 445 |
| 失败 | 0 |
| 耗时 | 454 ms |

结论：项目发现、状态查询和索引统计均正确。

### B：代码定位与职责

`synapse_search` 参数为 `project="synapse"`、`query="build_application"`、`mode="keyword"`、`limit=5`。

Top 1 结果：

| 字段 | 值 |
| --- | --- |
| node_id | `a2d4b847-b27b-5154-b8b8-a07515ec3dd4` |
| title | `build_application` |
| path | `src/synapse/bootstrap.py` |
| lines | 57-143 |
| score | 0.928477 |

源码交叉核对确认：

- `build_application` 是组合根函数；
- 构造 `Settings`、`Database` 和 7 个 Repository；
- 按依赖顺序构造 `KnowledgeService`、`ReferenceResolver`、`IngestionService`、`RetrievalService`、`ContextBuilder`；
- 最后构造 `ProjectTools`、`SearchTools`、`MemoryTools` 并返回 `Application`。

结论：工具定位准确，Trae 对函数职责和组装顺序的回答与源码一致。

### C：关系与图探索

Trae 先用 `synapse_search` 定位 `IngestionService`：

- node_id：`450db517-6328-5971-a392-5529f4eb890b`
- path：`src/synapse/ingestion/pipeline.py`
- lines：50-328

随后调用：

- `synapse_explore_graph`：返回 **38 个节点、47 条边**，`truncated=false`；
- `synapse_related`：`include=["code"]`，返回 9 个 code 项，包括 7 个方法、文件节点和 `build_application`；
- 额外搜索确认 `TaskRepository` 和 `IndexRunRepository` 存在，但没有出现在 depth=2 图结果中。

源码交叉核对确认 `IngestionService.__init__` 接收 11 个注入参数：

- 7 个 Repository：`ProjectRepository`、`SourceRepository`、`NodeRepository`、`RelationRepository`、`RefRepository`、`TaskRepository`、`IndexRunRepository`；
- 3 个服务/工具：`KnowledgeService`、`ReferenceResolver`、`ParserRegistry`；
- 1 个配置：`Settings`。

内部还自构造 `Scanner` 和 `ChangeDetector`。

结论：关系工具能发现类包含关系、文件关系和部分调用/导入关系；但构造函数参数注入没有被建模为图边，`TaskRepository` 和 `IndexRunRepository` 需要源码交叉检查才能补全。

### D：项目上下文

`synapse_context` 参数为 `project="synapse"`、`max_tokens=700`。

返回结果：

| 字段 | 值 |
| --- | --- |
| token_estimate | 694 |
| truncated | true |
| tech_stack | 14 项 |
| decisions | `[]` |
| recent_changes | `[]` |
| top_modules | 8 项 |

`top_modules` 为：

```text
ProjectTools
ProjectRepository
SourceRepository
NodeRepository
RelationRepository
RefRepository
TaskRepository
IndexRunRepository
```

结论：上下文工具可用，但在 700 token 预算下，`top_modules` 主要被 Repository 层占据，`RetrievalService`、`ContextBuilder`、`IngestionService` 等 Service 层组件没有进入结果；`decisions` 和 `recent_changes` 为空；`truncated=true` 表示内容被裁剪。对特定模块（例如 retrieval）的理解帮助有限。

### E：长期记忆写入

`synapse_remember` 参数：

| 参数 | 值 |
| --- | --- |
| project | `synapse` |
| memory_type | `fact` |
| title | `SYNAPSE_E2E_2.1.1_MEMORY` |
| tags | `["synapse-e2e-2.1.1", "isolated-home"]` |
| content | `Synapse MCP 的端到端验证正在使用独立测试环境。测试标识：SYNAPSE_E2E_2.1.1_20261109。` |

返回：

| 字段 | 值 |
| --- | --- |
| source_id | `1038d8cd-550b-5e83-9202-bc5d1dc2dc38` |
| node_id | `c476b727-6639-5f30-96f5-4fb4b1a5f479` |
| node_type | `memory` |
| memory_type | `fact` |
| confidence | 1.0 |
| salience | 0.7 |
| created_at | `2026-11-09T09:00:52.205+00:00` |

隔离数据库验证：

| 指标 | 写入前 | 写入后 |
| --- | ---: | ---: |
| nodes | 637 | 638 |
| relations | 1234 | 1234 |
| sources | 81 | 82 |
| memory nodes | 0 | 1 |

记忆正文与预期逐字一致，tags 存储为 `synapse-e2e-2.1.1 isolated-home`。

结论：写入成功，节点、source 和数据库计数变化符合预期。

### F：新会话跨会话召回

日志确认 F 使用独立会话 `<session-f>`，与 A-E 的 `<session-a-e>` 不同。

`synapse_recall` 参数：

```text
project = "synapse"
query = "SYNAPSE_E2E_2.1.1_20261109"
mode = "keyword"
```

返回：

| 字段 | 值 |
| --- | --- |
| node_id | `c476b727-6639-5f30-96f5-4fb4b1a5f479` |
| title | `SYNAPSE_E2E_2.1.1_MEMORY` |
| score | 0.778993 |
| returned | 1 |
| candidates | 1 |
| took_ms | 15 |

召回结果中的 `summary` 与写入正文一致。但返回 payload 不包含 `content` 和 `tags` 字段，只包含 `summary`、`snippet`、`title`、`node_id`、`score` 等。

结论：跨会话召回本身通过，node_id 与写入结果完全一致；但 MCP 返回的记忆载荷不完整，调用方无法拿到完整正文和标签。

## 工具调用证据

| 工具 | 调用次数 | 结果 |
| --- | ---: | --- |
| `synapse_projects_list` | 1 | `code=0` |
| `synapse_project_status` | 1 | `code=0` |
| `synapse_search` | 5 | `code=0` |
| `synapse_explore_graph` | 1 | `code=0` |
| `synapse_related` | 1 | `code=0` |
| `synapse_context` | 1 | `code=0` |
| `synapse_remember` | 1 | `code=0` |
| `synapse_recall` | 1 | `code=0` |
| **合计** | **12** | **全部成功** |

Trae render 日志中未发现 Synapse 工具失败。host 日志中的若干 `github`/`Unauthorized` warning 属于其他 MCP server，与本轮 Synapse 验证无关。

## 配置、数据与清理

| 检查项 | 结果 |
| --- | --- |
| 真实 Trae 配置已恢复 | 是，恢复后 SHA256 与测试前备份一致 |
| 真实 Synapse DB | `projects=0`、`nodes=0`、`relations=0`、`sources=0`、`memory_nodes=0` |
| 隔离测试 DB | `projects=1`、`nodes=638`、`relations=1234`、`sources=82`、`memory_nodes=1` |
| 测试记忆 | 保留在隔离 DB，node_id `c476b727-...` |
| 残留测试 MCP 进程 | 已停止 |
| 代码/Schema/工具变更 | 无 |

真实 Synapse 数据未被修改。隔离测试 home 和记忆按“可复核证据”保留；本轮没有删除记忆的 MCP 工具，因此未清理该测试记忆。

## 回归测试

```text
pytest -q -o addopts=""      35 passed in 5.59s
ruff check .                 All checks passed!
mypy src                     Success: no issues found in 58 source files
```

## 发现与限制

### 1. `synapse_recall` 返回字段不完整

`synapse_recall` 复用了检索结果的节点序列化逻辑，返回 `summary` 但不返回 `content` 和 `tags`。写入记忆时 `summary` 为 `content[:300]`，因此：

- 短记忆可以完整显示在 `summary` 中；
- 超过 300 字符的记忆会被截断；
- 调用方无法通过 MCP 召回结果获得完整正文和标签。

相关代码：

- `src/synapse/tools/memory_tools.py:61-75`
- `src/synapse/retrieval/service.py:356-369`
- `src/synapse/knowledge/service.py:131`

建议后续增加 `synapse_memory_get`，或在 `synapse_recall` 结果中返回完整 `content`、`tags` 和 `memory_type`。

### 2. `synapse_context` 的模块覆盖偏斜

在 700 token 预算下，`top_modules` 为 `ProjectTools` 加 7 个 Repository，`RetrievalService` 等 Service 层组件未出现；`decisions` 和 `recent_changes` 为空。对于“理解 retrieval 模块”这类任务，单靠 context 工具不够，需要配合 `synapse_search` 和 `synapse_explore_graph`。

### 3. 图模型没有覆盖构造函数注入

`IngestionService.__init__` 的 7 个 Repository 中，`TaskRepository` 和 `IndexRunRepository` 没有出现在 depth=2 的图结果里。图抽取更偏向 `CALLS`/`IMPORTS`/`CONTAINS`，构造参数注入需要源码交叉验证。

### 4. Trae 回答中的少量数量描述不准确

测试结果文档中的部分数量与工具原始返回不一致：

- `synapse_explore_graph` 实际返回 38 节点、47 边，不是 34 节点、45 边；
- `synapse_related` 实际返回 9 个 code 项，其中 7 个是方法；
- `top_modules` 包含 `ProjectTools`，并非全部是 Repository 类。

核心定位和依赖关系结论仍与源码一致；涉及数量时以 MCP 日志和源码为准。

### 5. 证据形式限制

本轮证据来自真实 Trae MCP 日志、隔离 SQLite 和测试结果文档，没有附带 GUI 截图。日志已经包含工具名、参数、session/message ID、返回结果和错误状态，但若需要视觉证据，仍应补充工具调用卡片截图。

## 结论

Phase 2.1.1 真实 Trae E2E 验证完成。8 个工具全部在真实 Trae 中发现并调用，12 次调用全部成功，A-F 场景覆盖项目查询、代码定位、关系探索、上下文、记忆写入和跨会话召回。

核心能力通过，但发现两个需要后续处理的产品问题：

1. `synapse_recall` 不返回完整记忆正文和 tags，长记忆会被 summary 截断；
2. `synapse_context` 在较小预算下对 Service 层和特定模块的覆盖不足。

真实 Trae 配置已恢复，真实 Synapse 数据未被修改，回归测试全部通过。

## 证据文件

以下文件保留在本地私有测试目录，不随公开仓库发布：

- `<private-evidence-dir>\e2e-test-results.md`
- `<private-evidence-dir>\manual-test-plan.md`
- `<private-evidence-dir>\mcp-call-results-phase-2.1.1.json`
- `<private-evidence-dir>\tool-call-summary.json`
- `<private-evidence-dir>\baseline-db.json`
- `<private-evidence-dir>\post-e-db-validation.json`
- `<private-evidence-dir>\verification-summary.json`
- `<private-evidence-dir>\logs\window1-mcp-servers-host.log`
- `<private-evidence-dir>\logs\window1-mcp-servers-render.log`
- `<private-evidence-dir>\mcp.json.before-phase-2.1.1`
- `<private-evidence-dir>\mcp.json.during-phase-2.1.1-test`
