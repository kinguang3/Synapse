# 性能基准

本目录归档历史索引性能结果，由 `scripts/benchmark.py` 生成，不参与测试或构建。

## 结果

- [2026-11-07 基准](benchmark-20261107T070106Z.md)
  - Synapse：75 files / 558 nodes / 1115 relations
  - Cold 447 ms，Warm 40 ms，Full 470 ms
- [2026-11-09 Phase 2.1 基准](phase-2.1/benchmark-20261109T082120Z.md)
  - Synapse：79 files / 604 nodes / 1199 relations
  - Cold 460 ms，Warm 46 ms，Full 483 ms

每份结果同时保留原始 JSON 数据：

- [2026-11-07 JSON](benchmark-20261107T070106Z.json)
- [2026-11-09 JSON](phase-2.1/benchmark-20261109T082120Z.json)

## 重新运行

```powershell
.\.venv\Scripts\python.exe scripts\benchmark.py --project . --runs 3
```

Cold 表示全新数据库首次索引，Warm 表示立即无变更增量索引，Full 表示重新解析全部文件。每次运行使用独立的临时数据库。
