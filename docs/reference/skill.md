# Agent Skill

`skills/synapse` 是面向 AI 编码代理的官方 skill。它不是运行时服务，而是“调用策略 + 参考文档 + 辅助脚本”：告诉代理何时使用 Synapse MCP、何时回退到 CLI，以及项目注册、搜索、上下文、图关系和记忆的标准工作流。

真正执行仍由 `synapse-mcp` 或 `synapse` CLI 完成。Skill 不会自动注册 MCP Server，也不会暴露 GUI 或编辑器侧边栏 API。

## 适用场景

- Agent 需要在已索引项目中搜索代码、文档或记忆。
- Agent 需要为当前任务构建紧凑的项目上下文。
- Agent 需要查看节点关系、扩展知识图谱或读写长期项目记忆。
- MCP 工具不可用时，需要按统一规则回退到 CLI `--json`。

## 结构

```text
skills/synapse/
  SKILL.md
  references/
    cli.md
    mcp.md
  scripts/
    check.ps1
    install.ps1
```

- `SKILL.md`：触发后的路由规则、前置检查、工作流和约束。
- `references/cli.md`：CLI 命令、参数和 JSON 用法。
- `references/mcp.md`：MCP 启动方式、客户端配置和工具参数。
- `scripts/check.ps1`：检查 `synapse` / `synapse-mcp` 是否可用。
- `scripts/install.ps1`：把 skill 安装到项目级、用户级或自定义目录。

## 安装

安装到当前项目的 `.opencode/skills/synapse`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\synapse\scripts\install.ps1
```

安装到用户级 opencode skills 目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\synapse\scripts\install.ps1 -Scope User
```

安装到自定义目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\synapse\scripts\install.ps1 -Scope Custom -Target D:\path\to\skills\synapse
```

目标已存在时需要加 `-Force`。`.opencode/` 是本地忽略目录，修改 skill 时应编辑 `skills/synapse` 源目录，再重新安装。

## 检查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\synapse\scripts\check.ps1
```

加 `-Deep` 会额外执行 `synapse projects list --json`。

## 使用约定

1. MCP 工具可用时优先使用 MCP，其次使用 CLI `--json`。
2. 先调用 `synapse_projects_list` 或 `synapse projects list --json` 确认项目。
3. 构建任务上下文时优先使用 `synapse_context`，符号或概念查找使用 `synapse_search`。
4. 搜索结果的 `node_id` 可继续用于 `synapse_related` 和 `synapse_explore_graph`。
5. 写入记忆前先用 `synapse_recall` 检查已有记忆；不要存储密钥、凭据或临时任务状态。
6. GUI 和编辑器侧边栏面向人类使用，不作为 agent API。

MCP 配置见 [MCP Server](mcp.md)，CLI 命令见 [CLI](cli.md)。
