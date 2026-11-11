# Phase 2.2.2 上下文构建质量报告

## 目标

提升 `synapse_context` 在真实 AI 编码任务中的可用性，重点解决 Phase 2.1.1 E2E 暴露的上下文覆盖偏斜问题：

1. 支持按任务 `query` 优先选择相关模块；
2. overview 模式按跨模块结构连接选择代表模块，而不是只按静态 salience；
3. 每个文件路径只出现一次，避免同一文件内多个节点重复占位；
4. `top_modules[].reason` 明确标记模块入选来源；
5. 在 `300`、`700`、`1500`、`3000` token 预算下保持可控裁剪；
6. 不修改 SQLite Schema、不重写 Core、不引入 embedding 依赖；
7. 在真实 Trae CN 中完成 A-F E2E 验证。

## 结论

Phase 2.2.2 通过验收。query 模式和 overview 模式已经产生明确不同的模块选择行为，路径去重、reason 标记、预算裁剪和真实 Trae MCP 调用均验证成功。

本轮没有修改数据库结构，没有破坏 `synapse_recall` / `synapse_memory_get` 的既有语义，也没有使用独立 MCP Client 代替真实 Trae 调用。

## 设计

### Query 模式

提供可选 `query` 参数，保持向后兼容：

- 不传 `query`：保持原来的项目概览行为；
- 传入 `query`：复用 `RetrievalService.search()` 的 hybrid 检索结果，按路径聚合最高分，选择相关路径；
- 中文问题中夹带代码标识符时，优先尝试最长代码风格 token，再回退到原 query；
- 每个路径只保留一个代表节点，优先使用 `class`、`file`、`document` 节点；
- query 结果不足时，再用跨模块结构连接补足。

### Overview 模式

不传 `query` 时：

- 通过非 `CONTAINS` 关系统计跨模块连接；
- 同时统计出边和入边，排除同一路径内部关系；
- 按邻居路径数和关系强度选择项目骨架模块；
- reason 标记为 `cross_module_links`。

### 兼容边界

- MCP `synapse_context` 新增可选 `query`，最大 500 字符；
- CLI `synapse context` 新增 `--query`；
- `SearchTools.get_context()` 新增 `query` 关键字参数；
- `ContextBuilder.build()` 新增 `query` 关键字参数；
- 现有调用不传 `query` 时行为与旧版一致；
- 没有新增表、列、索引或迁移。

### 裁剪顺序

query 模式优先保护相关模块，裁剪顺序为：

```text
recent_changes -> tech_stack -> decisions -> top_modules
```

overview 模式裁剪顺序为：

```text
recent_changes -> top_modules -> decisions -> tech_stack
```

`project` 和 `stats` 属于必要字段，始终保留。

## 实现

| 文件 | 变更 |
| --- | --- |
| `src/synapse/context/builder.py` | 新增 query 路径选择、结构连接选择、路径去重、reason、mtime 最近变更、query-aware 裁剪 |
| `src/synapse/storage/sqlite/repositories.py` | 新增 `modules_for_paths()` 和 `path_connection_counts()` |
| `src/synapse/bootstrap.py` | 向 `ContextBuilder` 注入 `RetrievalService` |
| `src/synapse/tools/search_tools.py` | `get_context()` 传递 `query` |
| `src/synapse/integrations/mcp/server.py` | `synapse_context` schema 新增可选 `query` |
| `src/synapse/integrations/cli/main.py` | `synapse context` 新增 `--query` |
| `tests/test_context.py` | 新增 query、预算、路径去重、中文 token 回退、CLI 测试 |
| `tests/test_mcp_server.py` | 新增 context query schema 和调用测试 |
| `README.md`、`README.zh-CN.md`、`docs/*.md` | 同步使用方式和限制说明 |

`NodeRepository.modules_for_paths()` 按路径返回代表节点，排序为：

```text
path, salience DESC, updated_at DESC, length(content) DESC, title
```

`RelationRepository.path_connection_counts()` 不修改数据，只读取现有关系并统计跨路径连接。

## 自动化验证

```text
pytest -q
41 passed

ruff check src tests
All checks passed!

mypy src
Success: no issues found in 58 source files
```

文档本地链接检查：

```text
checked 41 local links in 15 files
broken 0
```

新增测试覆盖：

- `ContextBuilder` 注入 `RetrievalService`；
- `query` 优先返回相关路径；
- 6 个 query 场景的模块选择；
- 中文 query + 代码标识符回退；
- 路径唯一性；
- `300`、`700`、`1500`、`3000` token 预算；
- `top_modules[].reason`；
- CLI `--query`；
- MCP context query schema 和实际调用；
- 既有 context 和 memory 行为回归。

## 真实 Trae E2E

### 环境

| 项目 | 值 |
| --- | --- |
| 测试日期 | 2026-11-10 |
| Trae | Trae CN `3.4.16` |
| Synapse | `0.1.0` |
| Python | `3.12.8` |
| MCP SDK | `2.3.0` |
| 隔离 home | `D:\Test\trae\phase-2.2.2-home` |
| 测试数据库 | `D:\Test\trae\phase-2.2.2-home\synapse.db` |
| 测试项目 | `D:\Synapse` |
| 项目 id | `01d1c724-8c19-53fb-80ef-298efe1fa976` |
| 项目 slug | `synapse` |
| 测试标识 | `SYNAPSE_E2E_2.2.2_20261109` |
| 记忆标题 | `SYNAPSE_E2E_2.2.2_DECISION` |
| 记忆 node_id | `8c69dd0b-d74a-5e67-aabc-a8a4d9114be4` |
| 记忆 source_id | `49b07c7a-e432-5189-bb74-93738ec5369d` |

真实 Trae 使用用户级 `mcp.json`，不需要工作区 `.trae/mcp.json`。测试期间临时加入：

```json
{
  "mcpServers": {
    "synapse": {
      "command": "D:\\Synapse\\.venv\\Scripts\\synapse-mcp.exe",
      "args": [],
      "env": {
        "SYNAPSE_HOME": "D:\\Test\\trae\\phase-2.2.2-home"
      }
    }
  }
}
```

真实 Trae 发现 9 个 Synapse 工具：

```text
synapse_projects_list, synapse_project_status, synapse_search,
synapse_related, synapse_explore_graph, synapse_context,
synapse_remember, synapse_recall, synapse_memory_get
```

### 执行方式

1. 在真实 Trae CN 中打开 `D:\Synapse`。
2. 使用隔离 home 和独立测试数据库。
3. A-E 在同一个原生 Trae Agent 会话中执行；F 在新会话中执行。
4. Agent 类型为 `solo_agent`，通过真实 Trae MCP 调用 Synapse。
5. 测试结束后恢复真实 Trae 用户级 `mcp.json`。

会话：

| 测试 | 会话 id |
| --- | --- |
| A-E | `6af2b3c6e9f967c53d1c2221` |
| F | `6af2b54ae9f967c53d1c2273` |

### 结果总览

| 测试 | 场景 | 工具 | 结果 |
| --- | --- | --- | --- |
| A | 项目与索引状态 | `synapse_projects_list`、`synapse_project_status` | 通过 |
| B | `query="ContextBuilder"` | `synapse_context` | 通过 |
| C | `query="retrieval"` | `synapse_context` | 通过 |
| D | overview | `synapse_context` | 通过 |
| E | 中文 query + 300 token | `synapse_context` | 通过 |
| F | 跨会话召回 decision | `synapse_recall`、`synapse_memory_get` | 通过 |

真实 Trae 日志共记录 10 次 Synapse tool 调用，其中 8 次成功、2 次因参数名不符合 schema 被拒绝；修正后均成功。没有工具逻辑错误。

### A：项目与索引状态

调用：

```text
synapse_projects_list {}
synapse_project_status {"project": "01d1c724-8c19-53fb-80ef-298efe1fa976"}
```

结果：

| 指标 | 值 |
| --- | ---: |
| nodes | 716 |
| relations | 1364 |
| sources | 85 |
| unresolved refs | 453 |
| memory nodes | 1 |
| class | 76 |
| method | 185 |
| function | 186 |
| doc_section | 184 |
| file | 70 |
| document | 14 |

最近一次索引：

| 字段 | 值 |
| --- | --- |
| run id | `01M700A6SQ3KHECEPK24BEZZJ1` |
| mode | `full` |
| status | `succeeded` |
| duration | 625 ms |
| scanned / changed | 84 / 84 |
| nodes upserted | 715 |
| relations upserted | 899 |
| resolved refs | 497 |
| unresolved refs | 453 |
| errors | 0 |

`project_status` 第一次使用了不存在的 `project_id` 参数，被 schema 拒绝；改用 `project` 后成功。这说明 MCP 参数校验生效。

项目状态中的 `relations=1364` 是最终 active 关系总数；索引运行中的 `relations_upserted=899` 是本轮 upsert 计数，两者口径不同，不代表数据丢失。

### B：query = `ContextBuilder`

参数：

```text
project=synapse
query=ContextBuilder
max_tokens=700
```

结果：

| 字段 | 值 |
| --- | --- |
| token_estimate | 655 |
| truncated | true |
| top_modules | 8 |
| tech_stack | 0 |
| recent_changes | 0 |

top_modules：

| # | title | path | node_type | reason |
| --- | --- | --- | --- | --- |
| 1 | ContextBuilder | `src/synapse/context/builder.py` | class | query_match |
| 2 | tests/test_context.py | `tests/test_context.py` | file | query_match |
| 3 | SearchTools | `src/synapse/tools/search_tools.py` | class | query_match |
| 4 | Application | `src/synapse/bootstrap.py` | class | query_match |
| 5 | RelationType | `src/synapse/domain/enums.py` | class | query_match |
| 6 | IndexStats | `src/synapse/domain/models.py` | class | query_match |
| 7 | README.md | `README.md` | document | query_match |
| 8 | src/synapse/core/text.py | `src/synapse/core/text.py` | file | query_match |

目标路径 `src/synapse/context/builder.py` 和 `tests/test_context.py` 分别位于第 1、2 位。所有路径唯一。

### C：query = `retrieval`

参数：

```text
project=synapse
query=retrieval
max_tokens=700
```

结果：

| 字段 | 值 |
| --- | --- |
| token_estimate | 687 |
| truncated | true |
| top_modules | 8 |
| unique paths | 8 |

top_modules：

| # | title | path | reason |
| --- | --- | --- | --- |
| 1 | HybridRanker | `src/synapse/retrieval/ranker.py` | query_match |
| 2 | src/synapse/retrieval/diversify.py | `src/synapse/retrieval/diversify.py` | query_match |
| 3 | RetrievalService | `src/synapse/retrieval/service.py` | query_match |
| 4 | src/synapse/retrieval/__init__.py | `src/synapse/retrieval/__init__.py` | query_match |
| 5 | GraphExpander | `src/synapse/retrieval/graph_expand.py` | query_match |
| 6 | SearchTools | `src/synapse/tools/search_tools.py` | query_match |
| 7 | docs/configuration.md | `docs/configuration.md` | query_match |
| 8 | MemoryTools | `src/synapse/tools/memory_tools.py` | query_match |

retrieval 模块的 5 个目标文件全部进入 top 5，且没有重复路径。

### D：overview

参数：

```text
project=synapse
max_tokens=700
```

结果：

| 字段 | 值 |
| --- | --- |
| token_estimate | 693 |
| truncated | true |
| top_modules | 5 |
| tech_stack | 14 |
| decisions | 1 |
| recent_changes | 0 |

top_modules：

| # | title | path | reason |
| --- | --- | --- | --- |
| 1 | Application | `src/synapse/bootstrap.py` | cross_module_links |
| 2 | NodeRepository | `src/synapse/storage/sqlite/repositories.py` | cross_module_links |
| 3 | IngestionService | `src/synapse/ingestion/pipeline.py` | cross_module_links |
| 4 | Settings | `src/synapse/config.py` | cross_module_links |
| 5 | RetrievalService | `src/synapse/retrieval/service.py` | cross_module_links |

tech_stack 返回 14 项：Python、pydantic、pydantic-settings、typer、rich、tree-sitter、tree-sitter-python、markdown-it-py、mdit-py-plugins、pathspec、platformdirs、filelock、mcp、hatchling。

decisions 返回 `SYNAPSE_E2E_2.2.2_DECISION`。所有 top_modules 的 reason 均为 `cross_module_links`，说明 overview 模式已经按跨模块结构选择，而不是按 query 字符串匹配。

### E：中文 query + 300 token

参数：

```text
project=synapse
query=如何理解 retrieval 模块
max_tokens=300
```

结果：

| 字段 | 值 |
| --- | --- |
| token_estimate | 270 |
| truncated | true |
| top_modules | 2 |
| tech_stack | 0 |

top_modules：

| # | title | path | reason |
| --- | --- | --- | --- |
| 1 | HybridRanker | `src/synapse/retrieval/ranker.py` | query_match |
| 2 | src/synapse/retrieval/diversify.py | `src/synapse/retrieval/diversify.py` | query_match |

300 token 下仍保留 retrieval 相关头部模块。与 700 token 结果相比，第 1、2 位完全一致；预算压缩主要减少召回广度，没有破坏头部精度。

### F：跨会话召回 decision

新会话 `6af2b54ae9f967c53d1c2273` 中调用：

```text
synapse_recall {"project":"synapse","query":"SYNAPSE_E2E_2.2.2_20261109","mode":"keyword"}
```

返回唯一命中：

| 字段 | 值 |
| --- | --- |
| node_id | `8c69dd0b-d74a-5e67-aabc-a8a4d9114be4` |
| node_type | memory |
| title | `SYNAPSE_E2E_2.2.2_DECISION` |
| salience | 0.7 |
| confidence | 1.0 |
| score | 0.777556 |
| reasons | `["fts"]` |

随后调用：

```text
synapse_memory_get {"project":"synapse","node_id":"8c69dd0b-d74a-5e67-aabc-a8a4d9114be4"}
```

返回：

| 字段 | 值 |
| --- | --- |
| memory_type | decision |
| tags | `["synapse-e2e-2.2.2", "isolated-home", "query-aware-context"]` |
| confidence | 1.0 |
| salience | 0.7 |
| provenance | user |

完整 content 包含 `query-aware`、`cross-module linkage` 和 `cross_module_links`，两个验收关键词均命中。

第一次 `memory_get` 使用了不存在的 `memory_id` 参数，被 schema 拒绝；改用 `project` + `node_id` 后成功。这验证了 MCP 参数边界，也说明调用方必须遵循两阶段读取流程。

## E2E 发现

### Query 模式

- query 路径优先选择生效：`ContextBuilder` 和 `retrieval` 都能把目标文件放在头部；
- 5 个 retrieval 文件全部覆盖；
- 所有路径唯一；
- 中文 query 中夹带英文代码标识符时，能回退到 `retrieval` 并保持头部稳定；
- `reason` 只表示路径入选来源，不代表没有图扩展评分；query 模式实际走 `RetrievalService` 的 hybrid 检索，图扩展仍可能参与分数计算。

### Overview 模式

- top_modules reason 全部为 `cross_module_links`；
- 选出的模块是 `bootstrap.py`、`repositories.py`、`pipeline.py`、`config.py`、`retrieval/service.py`，符合项目骨架；
- tech_stack 和 decisions 正常返回；
- 与 query 模式形成明确行为区分。

### 预算裁剪

- query 模式在 300 和 700 token 下都优先保护 top_modules；
- `recent_changes`、`tech_stack`、`decisions` 在 700 token query 模式下被优先裁剪为空；
- 这是裁剪顺序的结果，不是字段被禁用；
- 补充 CLI 复验显示，query 模式在 `max_tokens=1500` 时返回 12 个模块、14 个技术栈条目、1 条 decision、9 条 recent_changes；在 `3000` 时返回 10 条 recent_changes。

### 参数校验

- `synapse_project_status` 不接受 `project_id`，必须使用 `project`；
- `synapse_memory_get` 不接受 `memory_id`，必须使用 `project` + `node_id`；
- 两次错误均在 MCP schema 层被拒绝，修正参数后调用成功；
- 没有出现返回数据错误或跨项目数据泄露。

## 数据隔离

隔离数据库：

| 指标 | 值 |
| --- | ---: |
| projects | 1 |
| nodes | 716 |
| relations | 1364 |
| sources | 85 |
| unresolved refs | 453 |
| resolved refs | 497 |
| memory nodes | 1 |
| decision nodes | 1 |

索引运行：

| 指标 | 值 |
| --- | ---: |
| scanned | 84 |
| changed | 84 |
| nodes upserted | 715 |
| relations upserted | 899 |
| failed | 0 |
| duration | 625 ms |

真实用户数据未被修改。测试只使用 `D:\Test\trae\phase-2.2.2-home`。

## 配置恢复

真实 Trae 用户级 `mcp.json`：

| 状态 | SHA256 |
| --- | --- |
| 测试前备份 | `79C8766CA56E4DEEABF7899B5517E6348D2ED38B89D3C26A5B8AEC67C24F4C0C` |
| 测试期间配置 | `F1C85DB4C491C2C8DB7A11E63E13DD0E43E11735E724336D1BD58F418B7D6834` |
| 恢复后配置 | `79C8766CA56E4DEEABF7899B5517E6348D2ED38B89D3C26A5B8AEC67C24F4C0C` |

备份文件：

```text
D:\Test\trae\config\trae-mcp.json.phase-2.2.2.bak
```

恢复后配置只保留原有的 `godot-mcp`，没有残留 Synapse entry。

## 证据

| 类型 | 路径 |
| --- | --- |
| E2E 计划 | `D:\Test\trae\reports\phase-2.2.2\manual-test-plan.md` |
| 隔离数据库 | `D:\Test\trae\phase-2.2.2-home\synapse.db` |
| Trae renderer 日志 | `C:\Users\54863\AppData\Roaming\Trae CN\logs\20261110T140230\window1\renderer.log` |
| Trae MCP render 日志 | `C:\Users\54863\AppData\Roaming\Trae CN\logs\20261110T140230\window1\mcp-servers-render.log` |
| Trae MCP host 日志 | `C:\Users\54863\AppData\Roaming\Trae CN\logs\20261110T140230\window1\exthost\mcp-servers-host.log` |
| 配置备份 | `D:\Test\trae\config\trae-mcp.json.phase-2.2.2.bak` |

## 限制与后续

- query 模式仍是本地词法 + 图扩展检索，不是 embedding 语义检索；
- 纯中文且不含代码标识符的问题可能退回项目概览；
- 700 token 以下 query 模式会优先裁剪 `recent_changes`、`tech_stack`、`decisions`，需要这些字段时应提高预算；
- overview 模式仍以跨模块连接为主，不等同于完整架构图；
- 构造函数参数注入仍未完整建模为图边，需要结合源码核对；
- 真实 Trae E2E 证明上下文质量明显改善，但后续仍可评估语义检索、模块摘要质量和更细粒度的预算分配。

## 验收

- [x] `query` 参数向后兼容；
- [x] query 模式能选择相关模块；
- [x] overview 模式按跨模块连接选择；
- [x] 路径去重；
- [x] `reason` 可解释；
- [x] 300/700/1500/3000 预算可裁剪；
- [x] 真实 Trae 发现 9 个工具；
- [x] A-F 功能场景通过；
- [x] 参数 schema 错误被正确拒绝；
- [x] 隔离数据库验证；
- [x] 真实 Trae 配置恢复；
- [x] 自动化测试和静态检查通过。
