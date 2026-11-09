# 配置

配置使用 Pydantic Settings，来源优先级从高到低为：

1. 显式传入的 `Settings(...)`
2. 环境变量
3. TOML 配置文件
4. 默认值

## 默认位置

```text
Windows: %LOCALAPPDATA%\Synapse\config.toml
Windows: %LOCALAPPDATA%\Synapse\synapse.db
Linux:   ~/.local/share/Synapse/config.toml
macOS:   ~/Library/Application Support/Synapse/config.toml
```

实际路径以 `synapse config show --json` 为准。

## 环境变量

```powershell
$env:SYNAPSE_HOME = "C:\path\to\synapse-data"
$env:SYNAPSE_CONFIG = "C:\path\to\synapse-data\custom.toml"
$env:SYNAPSE_INDEXING__WORKERS = "8"
$env:SYNAPSE_STORAGE__BUSY_TIMEOUT_MS = "10000"
```

规则：

- `SYNAPSE_HOME` 决定默认 home。
- `SYNAPSE_CONFIG` 指定配置文件；优先于 `SYNAPSE_HOME/config.toml`。
- 嵌套字段使用双下划线，例如 `SYNAPSE_INDEXING__LOCK_TIMEOUT_SECONDS`。
- 环境变量前缀为 `SYNAPSE_`。

## 完整示例

```toml
home = "C:\\path\\to\\synapse-data"

[storage]
path = "C:\\path\\to\\synapse-data\\synapse.db"
busy_timeout_ms = 5000
wal = true

[indexing]
max_file_bytes = 2000000
max_search_text_chars = 200000
workers = 4
lock_timeout_seconds = 30.0
follow_symlinks = false
verify_content_hashes = false
extra_include_suffixes = []

[retrieval]
default_limit = 10
graph_expand = true
graph_depth = 1
max_graph_nodes = 200
max_neighbors_per_node = 8
weight_lexical = 0.60
weight_graph = 0.20
weight_recency = 0.08
weight_importance = 0.07
weight_confidence = 0.05

[logging]
level = "INFO"
format = "json"
```

## storage

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `path` | 未设置 | 数据库路径；未设置时使用 `<home>/synapse.db` |
| `busy_timeout_ms` | `5000` | SQLite busy timeout |
| `wal` | `true` | 启用 WAL 与 `synchronous=NORMAL` |

顶层 `database_path` 也可以直接指定数据库，优先级高于 `storage.path`。

## indexing

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `max_file_bytes` | `2000000` | 单文件大小上限 |
| `max_search_text_chars` | `200000` | 搜索文本截断 |
| `workers` | `4` | 解析线程数，1-32 |
| `lock_timeout_seconds` | `30.0` | 获取项目索引锁的等待时间 |
| `follow_symlinks` | `false` | 是否跟随符号链接 |
| `verify_content_hashes` | `false` | 元数据未变时仍校验内容哈希 |
| `extra_include_suffixes` | `[]` | 额外纳入扫描的后缀 |

`verify_content_hashes=true` 会增加每次扫描的读取量，但能发现 mtime 和 size 都未变、内容却变化的情况。

## retrieval

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `default_limit` | `10` | 默认结果数 |
| `graph_expand` | `true` | 是否启用图扩展 |
| `graph_depth` | `1` | 图扩展深度 |
| `max_graph_nodes` | `200` | 图扩展节点上限 |
| `max_neighbors_per_node` | `8` | 每节点邻居上限 |
| `weight_*` | 见示例 | 检索评分权重 |

## logging

当前仅保留配置结构；CLI 输出由 Rich/JSON 输出层控制。

## 验证

```powershell
synapse config show --json
synapse doctor --json
```

`config init` 不会覆盖已有配置文件。
