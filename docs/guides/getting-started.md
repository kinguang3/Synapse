# 快速开始

## 1. 安装

Windows PowerShell：

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
- `--mode keyword|hybrid|semantic`：`semantic` 当前会降级。
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

记忆会作为 `memory` 节点写入图谱，可被普通搜索、召回和 Context 使用。MCP 中先用 `synapse_recall` 找到记忆，再用 `synapse_memory_get` 按 `node_id` 读取完整正文和 tags。

GUI API 的记忆列表支持 `memory_type`、`q`、`limit`（1-200）和 `offset`，返回的 `total` 是应用过滤后的准确数量。当前 GUI 的 Memory 页仍固定读取前 100 条，尚未提供前端翻页控件。

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

安装后可用 `synapse-mcp` 或 `python -m synapse.integrations.mcp` 启动本地 stdio MCP Server。以 Trae 的用户级 `mcp.json` 为例：

```json
{
  "mcpServers": {
    "synapse": {
      "command": "C:\\path\\to\\Synapse\\.venv\\Scripts\\synapse-mcp.exe",
      "args": [],
      "env": {
        "SYNAPSE_HOME": "C:\\path\\to\\synapse-home"
      }
    }
  }
}
```

先调用 `synapse_projects_list` 获取项目 ID 或 slug，再调用其他项目级工具。`synapse_remember` 会写入本地记忆；`synapse_search` 只接受 `keyword` / `hybrid`。详见 [MCP 文档](../reference/mcp.md)。

## 10. 清理

Synapse 不使用隐藏后台服务。删除项目数据可删除对应 SQLite 数据库；删除默认数据目录前请先确认没有需要保留的记忆。

## 11. 验证

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_memory_lifecycle.py tests\test_gui_api.py -q
```

这两个测试文件分别覆盖记忆过滤/分页/总数契约和 GUI API 认证、错误映射、锁冲突与分页行为。
