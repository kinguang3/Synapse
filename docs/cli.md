# CLI

安装后命令名为 `synapse`。所有查询和索引命令都支持 `--json`。

```text
synapse [command] [options]
```

## projects

### `projects list`

```powershell
synapse projects list
synapse projects list --json
```

列出项目、根路径和最近索引时间。

### `projects register`

```powershell
synapse projects register <path> [--name NAME] [--index] [--json]
```

- `path`：项目根目录，必须存在。
- `--name`：展示名；默认使用目录名。
- `--index`：注册后立即索引。
- 相同根路径（Windows 下忽略大小写）返回已有项目。

### `projects status`

```powershell
synapse projects status [reference] [--json]
```

`reference` 可以是项目 ID、slug 或根路径。省略时按当前目录或唯一项目推断。输出包括节点、关系、Source、未解析引用和最近一次索引运行。

## index

```powershell
synapse index [reference] [--full] [--workers N] [--json]
```

- `--full`：跳过元数据快速路径，重新解析所有文件。
- `--workers`：1 到 32。
- 同一项目已有进程在索引时会返回 `INDEX_LOCKED`。
- 进程崩溃后的下一次执行会自动恢复。

## search

```powershell
synapse search <query> [options]
```

| 选项 | 说明 |
| --- | --- |
| `--project`, `-p` | 项目 ID、slug 或根路径 |
| `--limit`, `-l` | 1-50，默认 10 |
| `--mode` | `keyword`、`hybrid`、`semantic` |
| `--type` | 节点类型，可重复 |
| `--path-prefix` | 路径前缀 |
| `--graph-depth` | 0-3 |
| `--relation` | 关系类型，可重复 |
| `--json` | 输出 JSON |

`semantic` 当前返回 `degraded=["semantic_unavailable"]`，使用词法结果。

## related

```powershell
synapse related <node_id> [--limit N] [--relation TYPE] [--include code|docs|memory|other] [--json]
```

返回与节点直接相关的节点，按关系类型和方向组织。

## explore

```powershell
synapse explore <node_id> [--depth N] [--direction outgoing|incoming|both] [--relation TYPE] [--limit N] [--json]
```

从节点出发进行图扩展。`--depth` 为 0-3，`--limit` 为 1-200。

## remember

```powershell
synapse remember <project> <content> [--title TITLE] [--type TYPE] [--tag TAG] [--confidence F] [--json]
```

- `content` 为 `-` 时从 stdin 读取。
- `--type`：`fact`、`experience`、`decision`、`preference`、`summary`，默认 `fact`。
- `--tag` 可重复。
- `--confidence` 为 0 到 1。

## recall

```powershell
synapse recall <query> [--project REF] [--limit N] [--mode MODE] [--json]
```

只返回显式记忆节点。

## context

```powershell
synapse context <project> [--section NAME] [--max-tokens N] [--query QUERY] [--json]
```

- `--max-tokens`：100-20000，默认 1200。
- `--section` 可重复：`tech_stack`、`top_modules`、`decisions`、`recent_changes` 等。
- `--query`：按任务问题选择相关模块；省略时返回项目概览。
- 超出预算时可选列表会被裁剪，输出 `truncated=true`；`top_modules[].reason` 记录选择原因。

## config

```powershell
synapse config show [--json]
synapse config init [--json]
```

`show` 显示生效配置、解析后的 home、配置文件和数据库路径。`init` 仅在配置文件不存在时写入默认配置。

## doctor

```powershell
synapse doctor [--json]
```

检查数据库完整性、FTS 完整性和项目数量。

## version

```powershell
synapse version
```

## 退出码

- `0`：成功。
- `1`：参数、项目、存储或索引错误。
- `130`：索引被 Ctrl+C 取消。
