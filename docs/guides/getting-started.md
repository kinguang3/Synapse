# 快速开始

## 推荐：一键安装（Windows）

前置条件：Windows 10/11、PowerShell 5.1+、[uv](https://docs.astral.sh/uv/)，以及 VS Code 兼容编辑器。

```powershell
irm https://github.com/kinguang3/Synapse/releases/latest/download/install.ps1 | iex
```

安装器会创建托管运行时，安装 CLI、MCP、GUI 依赖和编辑器侧边栏，生成 `%LOCALAPPDATA%\Synapse\Synapse\mcp.json`，并把运行时命令目录加入用户 `PATH`。

安装完成后重启编辑器和终端。打开 Synapse 侧边栏时，本地 GUI 服务会自动启动。把生成的 MCP 配置加入客户端即可。

## 1. 手动安装

如果不想使用一键安装，可以从 PyPI 安装 CLI：

```powershell
uv tool install synapse-knowledge
synapse version
```

只想运行 MCP Server 时可以不安装 CLI，直接使用 `uvx`：

```powershell
uvx --from synapse-knowledge synapse-mcp
```

从源码开发时使用 Windows PowerShell：

```powershell
cd C:\path\to\Synapse
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -e ".[dev]"
```

如果 PowerShell 阻止激活脚本，可以直接使用虚拟环境中的解释器：

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\synapse.exe version
```

## 2. 初始化配置

```powershell
synapse config init
synapse config show
synapse doctor
```

默认配置和数据库位于 `%LOCALAPPDATA%\Synapse\Synapse\`。测试和基准会使用临时 home，不会写入真实数据库。

## 3. 注册项目

```powershell
synapse projects register C:\path\to\project --name "My Project"
synapse index "My Project"
synapse projects status "My Project"
```

也可以注册当前目录并立即索引：

```powershell
synapse projects register . --index
```

注册会解析为绝对路径。在 Windows 上，仅大小写不同的同一路径会返回已有项目。

## 4. 搜索

```powershell
synapse search "BookRecommender" --limit 5
synapse search "推荐算法" --limit 5
synapse search "ContextBuilder" --type class --json
```

可选过滤：

- `--project`：项目 ID、slug 或根路径。
- `--limit`：1 到 50。
- `--mode keyword|hybrid`：`hybrid` 会结合词法与图关系。
- `--type`：节点类型。
- `--path-prefix`：路径前缀。
- `--graph-depth`、`--relation`：图扩展控制。

## 5. 浏览关系

```powershell
synapse related <node_id>
synapse explore <node_id> --depth 2 --direction both
```

## 6. 记忆

```powershell
synapse remember . "Use SQLite FTS5 for local retrieval." --type decision --title "Use FTS5"
synapse remember . "选中方案 A。" --type decision --tag architecture
synapse recall "FTS5"
```

记忆会作为 `memory` 节点写入图谱，可被普通搜索、召回和 Context 使用。MCP 中先用 `synapse_recall` 找到记忆，再用 `synapse_memory_get` 按 `node_id` 读取完整正文和 tags。GUI Memory 页支持关键词搜索、类型筛选和分页。

## 7. 生成上下文

```powershell
synapse context . --max-tokens 1200
synapse context . --query "retrieval 模块" --max-tokens 700
synapse context . --section tech_stack --section decisions --json
```

Context 会返回项目、统计、技术栈、重要模块、决策与最近变更。提供 `--query` 时优先返回与任务相关的模块；不提供时返回项目概览。超过 token 预算时会裁剪可选列表并标记 `truncated=true`。

## 8. 重新索引

```powershell
synapse index .                 # 增量
synapse index . --full          # 重新解析所有文件
synapse index . --workers 8     # 调整解析并发
```

索引失败时会保留 `index_runs.error`、任务 `last_error` 和错误统计。进程崩溃后直接再次执行 `index` 即可触发恢复。

## 9. 连接 MCP Client

推荐用 `uvx` 启动已发布包。以 VS Code 兼容编辑器的用户级 `mcp.json` 为例：

```json
{
  "mcpServers": {
    "synapse": {
      "command": "uvx",
      "args": ["--from", "synapse-knowledge", "synapse-mcp"],
      "env": {
        "SYNAPSE_HOME": "C:\\path\\to\\synapse-home"
      }
    }
  }
}
```

从源码安装时也可以使用 `synapse-mcp` 或 `python -m synapse.integrations.mcp`。先调用 `synapse_projects_list` 获取项目 ID 或 slug，再调用其他项目级工具。`synapse_remember` 会写入本地记忆；`synapse_search` 只接受 `keyword` / `hybrid`。详见 [MCP 文档](../reference/mcp.md)。

## 10. 安装编辑器侧边栏

推荐直接使用一键安装。也可以手动安装 VSIX：

```powershell
code --install-extension .\synapse-companion-0.1.1.vsix
```

其他 VS Code 兼容编辑器如果提供 `--install-extension` CLI，使用对应命令安装同一个 VSIX。安装后重启编辑器，从活动栏打开 Synapse。

侧边栏默认自动启动本地 GUI 服务。如果关闭了 `synapse.autoStartServer`，可运行 `Synapse: Start Local Service` 手动启动。

## 11. 可选：安装 Agent Skill

仓库在 `skills/synapse` 提供官方 agent skill，用于让 agent 按统一策略选择 MCP 或 CLI。安装到当前项目的 `.opencode/skills`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\synapse\scripts\install.ps1
```

安装到用户级 opencode skills 目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\synapse\scripts\install.ps1 -Scope User
```

安装到自定义目录时使用 `-Scope Custom -Target <path>`；目标已存在时加 `-Force`。Skill 只提供调用策略、参考文档和辅助脚本，不会启动服务，也不会自动注册 MCP。MCP 仍需按第 9 节配置。详见 [Agent Skill](../reference/skill.md)。

## 12. 清理

Synapse 不使用隐藏后台服务。删除项目数据可删除对应 SQLite 数据库；删除默认数据目录前请先确认没有需要保留的记忆。
