# 开发与测试

## 环境

```powershell
cd C:\path\to\Synapse
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

Python 3.11+。项目使用 hatchling 构建，源码位于 `src/synapse`。

## 常用检查

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
```

`pyproject.toml` 中已配置：

- pytest：`testpaths = ["tests"]`，`addopts = "-q"`
- ruff：`E/F/I/B/UP/SIM`，行宽 100
- mypy：`check_untyped_defs = true`，`warn_unused_ignores = true`

## 测试地图

| 文件 | 覆盖 |
| --- | --- |
| `test_pipeline.py` | 增量索引、搜索、重命名、删除、CLI roundtrip |
| `test_index_lock.py` | 同项目锁、跨项目锁隔离、同/不同项目并发进程 |
| `test_recovery.py` | 真实子进程崩溃、中断 run、任务取消、重命名崩溃一致性、恢复幂等、项目隔离 |
| `test_boundaries.py` | 重复索引幂等、mtime/size 不变内容变化、Windows 路径大小写、Context 预算、任务重试 |
| `test_source_consistency.py` | Source 与节点事务一致性、失败回滚 |
| `test_fts.py` | FTS 损坏时降级与错误 |
| `test_context.py` | 决策记忆查询不加载全量节点、查询相关模块、路径去重、六类查询、CLI/MCP query、token 预算 |
| `test_config.py` | 配置优先级、home/config 路径、CLI 一致性 |
| `test_text.py` | 文本切分、CJK、搜索查询构造 |
| `test_mcp_server.py` | MCP 初始化、工具发现、schema、错误映射、业务调用、完整记忆读取、记忆持久化、跨项目拒绝、stdout 纯净性 |

## 运行单个测试

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_recovery.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_recovery.py::test_real_process_crash_is_recovered_on_next_index -q
.\.venv\Scripts\python.exe -m pytest tests\test_mcp_server.py -q
```

## 基准

```powershell
.\.venv\Scripts\python.exe scripts\benchmark.py --project . --runs 3
```

输出到 `benchmarks/results/`：

- `benchmark-<timestamp>.json`：完整环境、每轮统计和聚合结果。
- `benchmark-<timestamp>.md`：便于阅读的摘要。

公开仓库中的基准结果已将本机路径替换为 `<repo-root>` / `<test-project>` 占位符，测量数据未改动。

脚本使用临时 home 和临时数据库，不会索引或修改其他数据目录。

## 代码约定

- 领域层不访问 SQLite、文件系统或 CLI。
- Repository 负责 SQL；Service 负责事务流程；Tools 负责面向 Agent 的响应结构。
- 不添加无用途的抽象端口。
- 新增错误应继承 `SynapseError`，并在 tools/CLI 层转换为稳定 payload。
- 文件写入与数据库写入必须明确事务边界。
- 不提交 `.venv`、数据库、缓存或基准临时文件。

## 迁移

数据库迁移位于 `src/synapse/storage/sqlite/schema/`，由 `MigrationRunner` 按版本应用。修改已有迁移会触发校验和不一致；应新增迁移文件。
