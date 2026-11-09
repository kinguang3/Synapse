# 数据模型

Synapse 使用单个 SQLite 数据库保存多个项目。所有项目数据通过 `project_id` 隔离。

## 表

### `schema_migrations`

记录已应用的迁移版本、名称、校验和与时间。

### `projects`

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定 ID，由规范化根路径生成 |
| `slug` | 唯一可读标识 |
| `name` | 展示名 |
| `root_path` | 绝对根路径，唯一 |
| `description` | 可选描述 |
| `config_json` | 项目级配置 |
| `metadata_json` | 扩展元数据 |
| `last_indexed_at` | 最近成功索引时间 |

### `sources`

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定 Source ID |
| `project_id` | 所属项目 |
| `source_type` | `file`、`text`、`url`、`agent`、`user` |
| `uri` | 项目内相对 POSIX 路径，或 `text://...` |
| `language` | 语言 |
| `content_hash` | 内容 SHA-256 |
| `size_bytes` | 大小 |
| `mtime_ns` | 纳秒修改时间 |
| `status` | `active` 或 `deleted` |
| `parser_name` / `parser_version` | 解析器与版本 |
| `indexed_at` | 最近成功写节点时间 |

同一项目内 `(source_type, uri)` 唯一。

### `nodes`

知识图谱节点，包括文件、类、函数、文档章节、记忆等。

关键字段：

- `id`：稳定节点 ID，相同来源和节点键重复索引时复用。
- `node_type`：`file`、`document`、`class`、`function`、`memory`、`note` 等。
- `node_key`：Source 内唯一键。
- `status`：`active`、`archived`、`tombstone`。
- `content_hash`、`search_text`、`tags`：检索与去重。
- `memory_type`、`provenance`、`confidence`、`salience`：记忆体验与排序。
- `path`、`start_line`、`end_line`：源码定位。

唯一约束：`(source_id, node_type, node_key)`。

### `node_fts`

FTS5 外部内容表，索引 `title`、`search_text`、`tags`。由触发器与 `nodes` 同步。

### `relations`

图边，唯一约束为 `(from_node_id, to_node_id, relation_type)`。关系包含置信度、权重、来源和证据 JSON。

### `unresolved_refs`

暂未解析的引用，例如导入、链接或符号引用。解析器重新运行后可被标记为已解析。

### `tasks`

索引任务队列：

| 字段 | 说明 |
| --- | --- |
| `kind` | 当前为 `index_file` |
| `payload_json` | 任务参数，包括路径和可选 Source ID |
| `status` | `queued`、`running`、`succeeded`、`failed`、`canceled` |
| `attempts` / `max_attempts` | 重试计数与上限 |
| `available_at` | 下次可领取时间 |
| `last_error` | 最近错误或恢复原因 |

### `index_runs`

一次索引运行的审计记录：

| 状态 | 含义 |
| --- | --- |
| `running` | 正在执行，或进程崩溃后尚未恢复 |
| `succeeded` | 正常完成 |
| `failed` | 抛出异常并记录错误 |
| `canceled` | 被 Ctrl+C 取消 |
| `interrupted` | 进程中断，已由下一次索引恢复 |
| `stats_json` | 进度或最终统计 |
| `error` | 失败或恢复说明 |

## 稳定 ID

项目、Source、节点、关系和任务 ID 都由稳定输入生成或使用随机 ID。节点 ID 在重复索引时保持不变，因此：

- 重复索引不会创建重复节点。
- 关系通过唯一约束去重。
- 重命名会复用原 Source，并原子更新 URI 与节点路径。

## 恢复语义

- 未完成的 `index_runs` 标记为 `interrupted`。
- 未完成的 `tasks` 标记为 `canceled`，原因写入 `last_error`。
- 下一次扫描根据 Source 状态重新生成所需任务。
- 失败任务不会被视为成功；已成功任务保持 `succeeded`。
