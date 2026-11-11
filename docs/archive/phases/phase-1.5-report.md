# Phase 1.5 报告

## 目标

Phase 1.5 面向三个问题：

1. 修复 Phase 1 中影响可靠性、可维护性和数据一致性的工程债。
2. 证明索引、检索、记忆和 CLI 在边界条件下仍可预测。
3. 建立可重复的性能基线，为 Phase 2 的 MCP/API/监听/检索扩展提供参照。

本轮没有进入 MCP、HTTP API、文件监听或 Embedding。

## 初始审查发现

审查确认核心链路可运行，但发现以下问题：

- 配置 home 与实际数据库路径可能不一致。
- 没有项目级索引锁，同一项目可能被多个进程同时写入。
- FTS 异常被吞掉，检索可能静默返回空结果。
- Source 与节点写入不在同一事务，失败时可能留下半完成状态。
- Context 通过 `all_for_project()` 读取全部节点后再过滤，存在性能与过滤风险。
- ports 中存在未被使用且签名过期的协议。
- 索引中断后会遗留 `running` 的 run/task。
- 变更检测默认依赖 mtime/size，存在内容变化无法发现的边界。
- 缺少 README、架构文档、CLI/配置文档和 Benchmark。

## 已完成修复

### 配置与锁

- `resolve_home()`、`resolve_config_path()` 统一解析 `SYNAPSE_HOME`、`SYNAPSE_CONFIG`。
- `config show/init` 使用同一 resolved config path。
- 新增项目级 FileLock：`<home>/locks/index-<project_id>.lock`。
- 新增 `IndexLocked` / `INDEX_LOCKED`，包含项目、锁路径和超时信息。
- `indexing.lock_timeout_seconds` 默认 30 秒。

### 一致性与错误处理

- FTS 损坏或查询失败时抛出 `IndexUnavailable`，检索层返回 `fts_unavailable` degraded 状态。
- Source 的创建/更新与节点、关系、引用写入合并到同一事务。
- Source 不再在任务执行前提前更新 URI 或内容统计；重命名 URI 与节点路径原子更新。
- Context decision 查询改用 Repository 级 `memories()`，不再加载全量节点。
- 删除未使用的 ports，仅保留 `ParserPort`。

### 崩溃恢复

新流程：

```text
获取项目锁
  -> 将遗留 running index_runs 标记为 interrupted
  -> 将遗留 queued/running tasks 标记为 canceled 并写入原因
  -> 创建新 index_run
  -> 重新扫描
  -> 根据未更新的 Source 重新生成任务
  -> 正常完成或失败
```

关键保证：

- 只有拿到项目锁才执行恢复，不会误伤其他运行中的进程。
- 恢复按项目隔离。
- 恢复幂等：没有遗留记录时计数为 0。
- 不把未完成任务标记为成功。
- 恢复后再次扫描不会重复创建节点或关系。
- CLI 的 `index --json` 输出 `recovered_runs`、`recovered_tasks`。
- 历史 run 保留 `interrupted` 状态、错误和完成时间。

### 边界能力

- 新增 `indexing.verify_content_hashes`，可选择在 mtime/size 未变时校验内容哈希。
- Context 裁剪增加 `tech_stack`，超预算时输出 `truncated=true`。
- Windows 项目路径查找在应用层忽略大小写。
- JSON CLI 输出使用 ASCII 转义，避免 Windows PowerShell 5.1 管道编码破坏 JSON。

## 测试覆盖

新增或扩展：

- 真实子进程崩溃：在解析任务中 `os._exit`，验证下一次索引恢复中断 run 和 running task。
- 重命名崩溃：崩溃后 Source 仍保持旧 URI，恢复后原子切换到新 URI 和节点路径。
- 恢复项目隔离：其他项目的 run/task 不受影响。
- 重复索引幂等：节点和关系数量稳定。
- 内容变化但 mtime/size 不变：开启 hash 校验后可检测。
- Windows 路径大小写。
- Context token 预算裁剪。
- 任务重试到 `max_attempts` 后失败。
- 同项目锁阻塞、跨项目锁隔离。
- 同项目与不同项目并发索引。
- Source/节点事务一致性、FTS 降级、配置优先级。

最终检查：

```text
pytest -q            31 passed
ruff check .         passed
mypy src             55 source files, no issues
CLI smoke test       config init / doctor / register+index / search /
                     context / remember / recall / status all passed
```

## Benchmark

脚本：`scripts/benchmark.py`

方法：

- 每个数据集使用全新的临时 home 和临时数据库。
- 每个数据集运行 3 次。
- 每次依次测量：冷启动索引、无变更增量索引、全量重解析。
- 记录扫描文件数、节点数、关系数、数据库大小、失败数、环境信息。
- 不修改被测项目，不访问未授权目录。

最终结果：

| 数据集 | 文件 | 节点 | 关系 | 数据库 | 冷启动中位数 | 无变更增量中位数 | 全量中位数 | 失败 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Synapse 自身 | 75 | 558 | 1115 | 3,112,960 B | 447.071 ms | 40.085 ms | 470.436 ms | 0 |
| `<test-project>` | 9 | 27 | 55 | 409,600 B | 39.866 ms | 6.937 ms | 39.663 ms | 0 |

波动范围：

- Synapse 冷启动：423.195 - 449.725 ms；增量：40.033 - 42.978 ms；全量：460.302 - 481.779 ms。
- recommendation 冷启动：38.188 - 45.999 ms；增量：6.456 - 7.637 ms；全量：39.234 - 43.372 ms。

环境：Windows 11、Python 3.12.8、SQLite 3.45.3、24 logical CPUs、workers=4、每个数据集 3 次。

原始结果：

- `benchmarks/results/benchmark-20261107T070106Z.json`
- `benchmarks/results/benchmark-20261107T070106Z.md`

说明：`<test-project>` 是用户授权的真实 Python 子项目；扫描器自动忽略其 `venv`。Benchmark 使用临时数据库，不改动该项目。

## 已知限制

- `semantic` 仍是降级/词法模式，没有向量检索。
- 默认增量检测仍依赖 mtime/size；需要严格校验时开启 `verify_content_hashes`。
- Context token 是近似估算，极小预算下必要字段仍可能超限。
- SQLite 唯一索引对 `root_path` 仍大小写敏感，应用层已规避但极端并发注册仍依赖应用层检查。
- 恢复策略是取消未完成任务并由扫描重建，不是断点续传。
- 无 MCP、HTTP API、文件监听。

## 结论

Phase 1.5 的可靠性修复、崩溃恢复、边界测试、文档与双数据集 Benchmark 已完成。可以进入 Phase 2，并按 MCP Server -> 本地图谱/HTTP API -> 文件监听 -> Embedding 的顺序推进。
