# Synapse 文档索引

本目录按“指南 / 架构 / 参考 / 归档”分类，当前实现文档与历史阶段报告分开存放。

## 快速开始与开发

- [快速开始](guides/getting-started.md)
- [配置](guides/configuration.md)
- [开发与测试](guides/development.md)

## 架构

- [系统架构总览](architecture/overview.md)

## 参考

- [CLI](reference/cli.md)
- [MCP Server](reference/mcp.md)
- [数据模型](reference/data-model.md)
- [限制与边界](reference/limitations.md)
- [性能基准](benchmarks/README.md)

## 研究

- [Phase 3.4 宿主能力审计](research/phase-3.4-host-capability-audit.md)
- [Phase 3.4 跨宿主 Sidebar 架构](research/phase-3.4-sidebar-architecture.md)
- [Phase 3.4 实施报告](research/phase-3.4-report.md)

## 归档

- [Phase 3.3 Graph Workbench](archive/phase-3.3-graph-workbench.md)

## 维护约定

- 描述当前行为的文档放入 `guides/`、`reference/` 或 `architecture/`。
- 阶段报告归档到 `archive/`；一次性审计和历史状态快照不长期保留，需要时从 Git 历史追溯。
- 代码行为变化时同步更新对应文档，避免保留过期说明。
