# Phase 3.2.1 报告：Memory 数据正确性与 GUI 回归保护

## 1. 阶段目标

本阶段只处理 Memory 列表的数据正确性、GUI API 回归保护和 `uvx` 单命令分发评估：

- 修复记忆列表在 `memory_type`、`q`、`limit`、`offset` 组合下的分页、过滤和 `total` 错误。
- 为 GUI API 增加自动化回归测试，覆盖全部只读端点、认证、错误映射、项目级索引锁和记忆分页契约。
- 核对 GUI、Core、MCP 与 CLI 的边界，避免引入第二套业务逻辑。
- 评估通过 `uvx` 启动 MCP Server 的可行性、包名、数据持久化和发布风险。
- 更新受影响文档，并补充本报告。

本阶段不修改 SQLite Schema，不新增记忆更新、删除、归档或版本能力，不改变 MCP 工具语义，不修改 Graph、Context、Embedding 或文件监听，不写入真实用户数据库，不删除或弱化测试，也不自动执行 git commit、push、merge、reset 或 rebase。

## 2. 实际改动文件

源码：

- `src/synapse/storage/sqlite/repositories.py`
  - 新增 `NodeRepository.memory_page()`。
  - 项目、状态、节点类型、记忆类型和可选 FTS 查询统一进入 SQL 条件。
  - 使用与列表相同的过滤条件执行独立 `COUNT(*)`。
  - 使用稳定排序和 `LIMIT ? OFFSET ?`。
  - 原 `memories()` 改为委托 `memory_page()`，保持 ContextBuilder 等现有调用方兼容。
- `src/synapse/tools/memory_tools.py`
  - `MemoryTools.list()` 改为调用 `memory_page()`。
  - 增加 `_MAX_MEMORY_LIMIT = 200`。
  - `limit` 必须在 1-200 之间，`offset` 必须非负，否则返回 `INVALID_ARGUMENT`。
  - 删除先取固定窗口、再在 Python 中过滤的逻辑。
  - 查询列表使用 SQL FTS 关键词匹配，`meta.mode` 为 `keyword`。

测试：

- `tests/test_memory_lifecycle.py`：7 个测试。
- `tests/test_gui_api.py`：6 个测试。

文档：

- `README.md`
- `README.zh-CN.md`
- `docs/architecture/overview.md`
- `docs/guides/getting-started.md`
- `docs/reference/limitations.md`
- `docs/reference/mcp.md`
- `docs/research/phase-3.2.1-report.md`

## 3. 问题复现

技术审计报告中的 Memory 问题可以稳定复现：

- 数据集为 5 条 `decision` 和 60 条 `fact`。
- `memory_type=decision&limit=10` 返回 `total=0` 和空列表。
- `q=fact&limit=1&offset=55` 返回 `total=50`，但第 56 条实际不存在于结果中。
- 无过滤 `limit=100` 返回 `total=65`，与 `limit=10` 等分页请求不完全一致。

根因：

1. 旧实现先按 `offset + limit` 取一个窗口，再在 Python 中过滤 `memory_type`，过滤发生在截断之后。
2. `total` 在有类型过滤时被改成 `len(filtered)`，只代表当前窗口，而不是项目内全部匹配记录。
3. 查询路径通过 `RetrievalService.search()` 取候选，候选上限被限制为 50，无法支持 `offset=55` 之后的分页。
4. COUNT 与列表查询不是同一套过滤条件，导致总数和页面可能互相矛盾。

## 4. Memory 列表契约修复

`MemoryTools.list()` 现在的契约：

```text
MemoryTools.list(project, memory_type?, query?, limit=50, offset=0)
  -> NodeRepository.memory_page(project.id, memory_type, query, limit, offset)
  -> (memories, total)
```

行为定义：

- `project` 仍为必填项目引用，项目隔离由 Repository 条件保证。
- `memory_type` 在 SQL 中先过滤，再分页。
- `query` 使用 `build_fts_query()` 生成 FTS 表达式；无有效关键词时返回空列表和 `total=0`。
- `limit` 范围为 1-200，`offset` 必须非负。
- `total` 与当前项目、记忆类型、查询条件完全一致，不受当前页大小影响。
- 排序为 `updated_at DESC, created_at DESC, id ASC`，同一时间戳下仍有稳定顺序。
- 查询结果额外按 `bm25(node_fts, 5.0, 1.0, 2.0) ASC` 排序，再使用稳定字段兜底。
- 响应继续包含 `project_id`、`memories`、`total`、`offset`、`limit`、`query`、`meta`。
- 查询列表的 `meta.mode` 为 `keyword`，表示这是 SQL 关键词列表查询，而不是 `synapse_recall` 的 hybrid 召回排序。

这是本阶段唯一有意的语义调整：GUI 记忆列表的 `q` 从混合检索候选改为 SQL FTS 列表查询，以保证过滤、分页和总数可证明一致。MCP `synapse_recall` 仍保持原有 hybrid 召回行为。

## 5. 测试与 GUI 回归保护

### Memory 生命周期测试

`tests/test_memory_lifecycle.py` 覆盖：

- 混合类型列表和 `memory_type` 过滤。
- `limit` / `offset` 分页与 `total`。
- 类型过滤发生在 `LIMIT` 之前的旧 bug 回归。
- `q=fact&offset=55` 不再受 50 条候选窗口限制。
- 越界页返回空列表但保留正确 `total`。
- `limit=0`、`limit=201`、负 `offset` 返回错误。
- 项目隔离和类型过滤组合。
- 相同时间戳下按 `node_id` 稳定排序。

### GUI API 测试

`tests/test_gui_api.py` 使用临时 `SYNAPSE_HOME`、临时项目、测试 Token 和临时数据库，不访问真实数据。覆盖全部 13 个 API 端点：

- `GET /api/v1/health`
- `GET /api/v1/projects`
- `GET /api/v1/projects/{project_id}`
- `GET /api/v1/projects/{project_id}/status`
- `POST /api/v1/projects/{project_id}/index`
- `GET /api/v1/projects/{project_id}/overview`
- `GET /api/v1/projects/{project_id}/search`
- `GET /api/v1/projects/{project_id}/graph/overview`
- `GET /api/v1/projects/{project_id}/nodes/{node_id}`
- `GET /api/v1/projects/{project_id}/memories`
- `GET /api/v1/projects/{project_id}/memories/{node_id}`
- `GET /api/v1/projects/{project_id}/context`
- `GET /api/v1/projects/{project_id}/graph/{node_id}/neighbors`

另外覆盖：

- 静态首页 `/` 返回前端 HTML。
- 所有受保护端点缺少 Bearer Token 时返回 401。
- 不存在的项目、节点和记忆返回 404。
- 持有项目级 `FileLock` 时 `POST /index` 返回 423。
- 记忆列表的类型过滤、查询过滤、分页和 `total` 与 Core 契约一致。
- Core 返回的上下文字段和搜索字段结构未被 GUI 适配层破坏。

## 6. GUI + Core 契约核对

- GUI 仍然通过 `CoreWorker` 调用 `MemoryTools.list()`，没有新增 SQL 或复制过滤逻辑。
- GUI API 的参数校验、项目解析、错误映射和响应整形仍留在适配层。
- 记忆列表现在把 `memory_type`、`q`、`limit`、`offset` 原样交给 Core；适配层不再做二次过滤。
- 其他节点和图谱端点继续由 Repository 读取，未改变现有数据契约。
- GUI 前端 Memory 页仍固定请求 `limit: 100`，没有前端翻页控件。本阶段优先保证后端契约正确，未修改前端交互；该事项保留为后续 P1。

## 7. 验证结果

最终执行：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
```

结果：

- `pytest`：54 个测试全部通过。
- 新增测试：Memory 7 个，GUI API 6 个。
- `ruff`：`All checks passed!`
- `mypy`：`Success: no issues found in 65 source files`
- 测试使用临时 home 和临时数据库，未写入真实用户数据。

补充验证：

- `pip wheel . --no-deps` 构建 `synapse_knowledge-0.1.0-py3-none-any.whl` 成功。
- Wheel 包含 87 个文件，包含 GUI `static/`、字体、`entry_points.txt` 和 `METADATA`。
- Console scripts 确认为 `synapse` 与 `synapse-mcp`。

## 8. 未修改 Schema 与能力边界

- 没有新增表、列、索引或迁移。
- 没有修改 MCP 工具名称、参数或返回结构。
- `synapse_recall` 仍返回 summary/snippet，完整正文仍需 `synapse_memory_get`。
- CLI 没有新增记忆列表命令。
- GUI 仍只读，除索引触发外没有写操作。
- GUI 仍只监听 `127.0.0.1`，并要求 Bearer Token、Host/Origin 校验。
- 没有引入 Embedding、向量检索、文件监听、记忆编辑、删除或版本历史。
- 未使用真实用户数据库。

## 9. uvx 技术评估

### 当前包状态

`pyproject.toml` 已具备发布基础：

- 构建后端：`hatchling.build`。
- 发行包名：`synapse-knowledge`。
- 版本：`0.1.0`。
- Python 要求：`>=3.11`。
- MCP 依赖：`mcp>=2.3,<2.4`。
- Console scripts：`synapse`、`synapse-mcp`。
- Wheel 包路径：`src/synapse`。

已确认：

- PyPI 上 `synapse-knowledge` 当前返回 404，名称可用。
- PyPI 上 `synapse-mcp` 已被其他项目占用，因此不能把发行包名设为 `synapse-mcp`。
- 发行包名与命令行名称是两件事；即使发行包叫 `synapse-knowledge`，入口仍可以是 `synapse-mcp`。
- Wheel 已包含 GUI 静态资源，MCP 默认依赖不包含 `fastapi` / `uvicorn`，不会因 GUI 资源引入额外运行依赖。

### 推荐启动方式

发布后推荐：

```powershell
uvx --from synapse-knowledge synapse-mcp
```

固定版本：

```powershell
uvx --from synapse-knowledge==0.1.0 synapse-mcp
```

MCP Client 配置：

```json
{
  "mcpServers": {
    "synapse": {
      "command": "uvx",
      "args": ["--from", "synapse-knowledge", "synapse-mcp"],
      "env": {
        "SYNAPSE_HOME": "<Synapse home>"
      }
    }
  }
}
```

### 数据与锁

- `uvx` 只缓存 Python 环境和包，不决定 Synapse 数据目录。
- 数据目录仍由 `platformdirs` 的 `user_data_dir("Synapse", "Synapse")` 决定，或由 `SYNAPSE_HOME` 覆盖。
- 升级或重新创建 `uvx` 环境不会删除 SQLite 数据库。
- 多个 MCP Client 可以启动多个 Server，但都应指向同一 `SYNAPSE_HOME`；SQLite WAL、busy timeout 和项目级 FileLock 仍负责并发边界。
- stdout 只用于 MCP JSON-RPC，`uvx` 不应向该通道写普通文本；当前入口和日志行为满足这一要求。

### 发布前仍需完成

- 补充 `project.readme`、`project.license`、作者、分类器和项目 URL。
- 确认 LICENSE 与 README 进入包元数据。
- 在干净环境执行 wheel 安装和 MCP 初始化 smoke test。
- 在 Windows、Linux、macOS 分别验证 FTS5、数据目录和入口脚本。
- 决定版本策略：建议 `uvx --from synapse-knowledge==<version>` 固定版本，避免自动升级导致 MCP 行为漂移。
- 发布前再次检查 `synapse-knowledge` 名称和商标风险。

### 是否需要 npm 包装

当前不需要。`uvx` 已能满足“一条命令启动 Python MCP Server”的目标；npm wrapper 会增加发布、签名、代理和故障排查成本，建议后续有明确 Node 生态需求时再评估。

## 10. 文档更新

- `README.md` / `README.zh-CN.md`：增加 Phase 3.2.1 状态和 Memory 列表能力说明。
- `docs/architecture/overview.md`：增加记忆列表的 SQL 过滤、COUNT、分页、排序和验证说明。
- `docs/guides/getting-started.md`：补充 Memory 列表 API 参数和 GUI 前端翻页限制，增加回归测试命令。
- `docs/reference/mcp.md`：增加尚未发布的 `uvx` 启动方案、包名说明和 Client 配置。
- `docs/reference/limitations.md`：更新 Memory 列表分页边界和 GUI 前端固定 100 条的现状。
- `docs/research/phase-3.2.1-report.md`：本报告。

## 11. 遗留问题与风险

- GUI Memory 页前端仍固定请求 100 条，没有翻页控件；后端已支持 `offset`，后续需要补前端交互。
- 其他 GUI 接口仍没有完整分页，例如搜索、图谱和上下文列表；本阶段未扩大范围。
- 记忆列表的 `q` 已改为 SQL FTS 关键词查询，不再复用 hybrid 召回排序；这是为分页和总数一致性做的取舍，应在后续 UI 文案中说明“列表查询”和“召回”不是同一语义。
- 当前没有 Memory 更新、删除、归档和版本历史；这些仍属于后续阶段。
- 真实用户数据库未参与验证；所有测试均使用临时 home。
- `uvx` 发布未执行，PyPI 名称可用性只代表当前检查结果，正式发布前需要复查。
- MCP 行为未变化，因此本阶段未重新做真实 Trae 端到端验证；`synapse_recall` 和 `synapse_memory_get` 的既有验证结论仍有效。

## 12. 结论与下一步

Phase 3.2.1 的 P0 数据正确性问题已关闭：

- 类型过滤、查询过滤、分页和 `total` 现在由同一套 SQL 条件计算。
- 50 条候选窗口和 Python 后置过滤已移除。
- GUI API 的关键读取路径已有自动化回归保护。
- Schema、MCP 工具语义和 CLI 能力边界未被扩大。

建议下一步按以下顺序推进：

1. 为 GUI Memory 页补 `offset` 翻页控件，并展示后端返回的准确 `total`。
2. 评估其他 GUI 端点是否需要统一分页契约。
3. 补齐 PyPI 发布元数据，在干净环境完成 `uvx` smoke test 后再发布。
4. 继续保持“数据准确性优先于功能扩张”的原则，避免在 UI 层复制过滤逻辑。
