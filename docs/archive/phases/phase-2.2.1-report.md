# Phase 2.2.1 记忆完整读取报告

## 目标

让 AI Agent 在召回一条长期记忆后，能够按 `node_id` 读取完整正文和元数据，而不只看到被截断的 `summary`。

验收重点：

1. `synapse_recall` 仍负责搜索和排序，并返回 `node_id`；
2. 新增 `synapse_memory_get`，按 `node_id` 读取完整 `content`、`tags` 和记忆元数据；
3. 新工具强制项目隔离，只允许读取当前项目的记忆；
4. 不修改现有 SQLite Schema，不改变现有工具的返回语义；
5. 在真实 Trae 中完成召回、读取和非截断验证。

## 背景

Phase 2.1.1 已确认 `synapse_remember` 能完整写入记忆，但 `synapse_recall` 只返回检索字段：

- `summary` 在写入时取 `content[:300]`；
- `synapse_recall` 不返回完整 `content` 和 `tags`；
- 长记忆在召回结果中会被截断，Agent 无法恢复被截断的正文。

Phase 2.2.1 采用“两阶段读取”：

```text
synapse_recall(query) -> node_id + summary/snippet
synapse_memory_get(project, node_id) -> full content + metadata
```

## 设计

### 为什么不需要改 Schema

现有 `nodes` 表已经保存了所需字段：

| 字段 | 用途 |
| --- | --- |
| `content` | 完整记忆正文 |
| `summary` | 前 300 字符摘要 |
| `tags` | 空格分隔的标签文本 |
| `memory_type` | `fact` / `experience` / `decision` / `preference` / `summary` |
| `metadata_json` | 原始 `tags` 数组、`source_type` 等元数据 |
| `provenance` | 写入来源 |
| `confidence`、`salience` | 记忆质量字段 |
| `created_at`、`updated_at` | 时间字段 |

`NodeRepository.get(node_id)` 已经存在并返回完整 `KnowledgeNode`，因此只新增业务读取入口和 MCP 适配，不修改存储结构。

### 最小改动边界

- 不在 `synapse_recall` 中直接返回完整正文，避免普通检索响应膨胀；
- 不重写记忆系统，不新增表、不新增索引；
- 不改变 `synapse_remember`、`synapse_recall` 的既有参数语义；
- 不删除任何记忆；
- 不新增第三方依赖。

## 实现

### 1. MemoryTools 完整读取

`src/synapse/tools/memory_tools.py`：

- `MemoryTools.get(node_id, *, project=None)`：
  - 节点不存在时返回 `NODE_NOT_FOUND`；
  - 传入项目时解析项目并校验 `node.project_id`，跨项目返回 `INVALID_ARGUMENT`；
  - 只接受 `memory` / `note` 节点，其他类型返回 `INVALID_ARGUMENT`；
  - 使用新的完整载荷返回记忆详情。
- `_memory_detail_payload()` 在既有 `_node_payload()` 基础上增加：
  - `summary`；
  - `provenance`；
  - `tags` 恢复为数组。
- `tags` 恢复优先读取 `metadata_json.tags` 中的原始数组；旧数据没有该字段时退回按空格拆分 `node.tags`。
- `synapse_remember` 继续复用原 `_node_payload()`，保持既有返回结构不变；`synapse_memory_get` 使用增强后的完整载荷。

### 2. MCP 工具

`src/synapse/integrations/mcp/server.py`：

- 新增只读工具 `synapse_memory_get`；
- 参数：
  - `project`：项目 id、slug 或根路径；
  - `node_id`：`synapse_recall` 返回的记忆节点 id；
- 工具在 MCP 层解析项目，再调用 `MemoryTools.get()`；
- 工具描述和 Server instructions 明确说明：先用 `synapse_recall`，再用 `synapse_memory_get` 读取完整正文；
- 工具注解为 `read_only_hint=true`。

### 3. 测试

`tests/test_mcp_server.py` 增加：

- 工具发现集合包含 `synapse_memory_get`；
- 输入 schema 必填 `project`、`node_id`；
- 只读注解；
- 长记忆召回后 `summary == content[:300]`；
- `synapse_remember` 的既有返回结构保持不变；
- `synapse_memory_get` 返回完整 608 字符正文、完整结尾、`tags` 数组、`memory_type`、`provenance`、时间字段；
- 非记忆节点返回 `INVALID_ARGUMENT`；
- 不存在的节点返回 `NODE_NOT_FOUND`；
- 跨项目记忆返回 `INVALID_ARGUMENT`；
- stdout 仍只包含 MCP JSON-RPC。

### 4. 文档

同步更新：

- `docs/mcp.md`：新工具、两阶段读取流程、安全边界和当前限制；
- `docs/architecture.md`：记忆读取数据流和标签恢复策略；
- `docs/limitations.md`：明确 `recall` 与 `memory_get` 的职责边界；
- `docs/development.md`：测试地图；
- `docs/getting-started.md`：MCP 记忆读取说明；
- `README.md`、`README.zh-CN.md`：工具列表和状态说明。

## 测试

### 自动化测试

```text
pytest -q
35 passed

ruff check src tests
All checks passed!

mypy src
Success: no issues found in 58 source files
```

### 真实 Trae E2E

| 项目 | 值 |
| --- | --- |
| Trae | Trae CN `3.4.16` |
| Synapse | `0.1.0` |
| Python | `3.12.8` |
| MCP SDK | `2.3.0` |
| 隔离 home | `D:\Test\trae\phase-2.2.1-home` |
| 测试数据库 | `D:\Test\trae\phase-2.2.1-home\synapse.db` |
| 测试项目 | `D:\Synapse` |
| 项目 ID | `01d1c724-8c19-53fb-80ef-298efe1fa976` |
| 项目 slug | `synapse` |
| 测试记忆标题 | `PHASE_2_2_1_LONG_MEMORY` |
| 测试记忆 node_id | `b2cdac2f-9d27-533f-9b4f-9b2a57a47403` |
| 测试标识 | `PHASE_2_2_1_E2E_MARKER` |
| 正文结尾标识 | `TAIL_PHASE_2_2_1_COMPLETE` |
| 正文长度 | 608 字符 |
| summary 长度 | 300 字符，确认截断 |
| tags | `phase-2.2.1`、`isolated-home` |

真实 Trae 在 `18:35:56` 发现 9 个 Synapse 工具：

```text
synapse_projects_list, synapse_project_status, synapse_search,
synapse_related, synapse_explore_graph, synapse_context,
synapse_remember, synapse_recall, synapse_memory_get
```

独立会话 `6af1a20368f2a6067e2d0412` 中执行了 3 次有效调用：

| 工具 | 参数 | 结果 |
| --- | --- | --- |
| `synapse_recall` | `project=synapse`、`query=PHASE_2_2_1_E2E_MARKER`、`mode=keyword`、`limit=5` | `code=0`，命中 1 条，`node_id=b2cdac2f-9d27-533f-9b4f-9b2a57a47403`，`summary` 恰好 300 字符且被截断 |
| `synapse_memory_get` | `project=synapse`、`node_id=b2cdac2f-...` | `code=0`，返回完整 608 字符正文，结尾为 `TAIL_PHASE_2_2_1_COMPLETE` |
| `synapse_memory_get` | 同上 | `code=0`，复验 tags、`memory_type=fact`、`provenance=user`、`content` 中 `isolated Synapse home` 出现 8 次 |

Trae MCP render 日志未记录错误，3 次调用均为 `hasError=false`。本轮没有用独立 MCP Client 替代真实 Trae 调用。

### 配置恢复

真实 Trae 配置在测试期间临时加入 `synapse` entry，指向隔离 home；测试结束后已恢复。

| 状态 | SHA256 |
| --- | --- |
| 测试前备份 | `79C8766CA56E4DEEABF7899B5517E6348D2ED38B89D3C26A5B8AEC67C24F4C0C` |
| 测试期间配置 | `E5D49E191B88ABD2A8C7AD43D7B9C55507D584468857960EBE1EA67F52617C3B` |
| 恢复后配置 | `79C8766CA56E4DEEABF7899B5517E6348D2ED38B89D3C26A5B8AEC67C24F4C0C` |

## 数据隔离

隔离测试库：

| 指标 | 值 |
| --- | --- |
| projects | 1 |
| nodes | 679 |
| memory nodes | 1 |
| sources | 84 |
| 测试记忆 | `b2cdac2f-9d27-533f-9b4f-9b2a57a47403` |

真实 Synapse 数据目录：

| 指标 | 值 |
| --- | --- |
| projects | 0 |
| nodes | 0 |
| relations | 0 |
| sources | 0 |
| memory nodes | 0 |

测试记忆只存在于隔离 home，没有写入真实 Synapse 数据库。真实 Trae `mcp.json` 已恢复原内容。

## 回归

- `pytest -q`：35 passed；
- `ruff check src tests`：通过；
- `mypy src`：58 个源文件通过；
- 文档链接检查：39 个本地链接，0 个缺失；
- 未执行 Git commit / push / merge / reset；
- 未修改 SQLite Schema；
- 未新增依赖或云服务。

## 已知边界与风险

1. `synapse_recall` 仍然只返回 `summary` 和 `snippet`。这是有意设计，避免普通召回响应携带完整长正文；调用方必须使用两阶段读取。
2. `synapse_memory_get` 目前一次返回完整正文，最长可到 `synapse_remember` 的 200,000 字符上限，没有分页或截断参数。超大记忆会增加 MCP 响应体积。
3. `memory_get` 只接受 `memory` / `note` 节点，不能作为通用节点读取工具；代码节点仍使用 `synapse_search`、`synapse_related` 或 `synapse_explore_graph`。
4. tags 优先从 `metadata_json.tags` 恢复；没有原始数组的旧节点只能按空格拆分，无法保留本身包含空格的 tag 边界。
5. 本轮真实 Trae E2E 使用 CLI 预置的隔离测试记忆，重点验证读取链路；记忆写入链路已由 MCP 自动化测试和 Phase 2.1.1 覆盖。

## 结论

Phase 2.2.1 已完成。

- 新增 `synapse_memory_get`，Agent 可以用 `node_id` 读取完整记忆正文和元数据；
- 记忆读取强制项目隔离和节点类型校验；
- 不修改 SQLite Schema，不改变既有工具参数语义；
- 自动化测试、静态检查和真实 Trae E2E 均通过；
- 真实 Trae 配置已恢复，真实 Synapse 数据未被污染。
