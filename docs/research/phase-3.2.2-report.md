# Phase 3.2.2 报告：GUI Memory 分页与查询体验

## 1. 修改前 GUI Memory 的分页问题

Phase 3.2.1 已经在 Core 层完成 `memory_page()` 的 SQL 过滤、COUNT、LIMIT/OFFSET，但 GUI 仍存在以下问题：

- `app.js` 固定请求 `limit: 100`，没有传递 `offset`。
- 后端返回的 `total` 只显示为 “65 total”，没有当前页范围、总页数或上一页/下一页。
- 搜索框已有 260ms 防抖，但搜索词变化不会重置分页，因为没有前端分页状态。
- 类型筛选只改变 `memory_type`，同样没有重置分页。
- 快速连续输入时没有请求序号或取消机制，旧请求可能在新请求之后返回并覆盖结果。
- 切换项目时会清空筛选状态，但没有重置分页或 detail 请求状态。
- 空状态、错误状态和加载状态存在，但没有与分页控件联动。

本阶段没有改变后端查询语义，只把已有能力完整接入 GUI。

## 2. 修改文件列表

前端：

- `src/synapse/integrations/gui/static/app.js`
  - 增加 Memory 分页状态、搜索/类型筛选、防抖、请求竞态保护、详情请求保护。
  - 接入每页 20 条的后端分页。
- `src/synapse/integrations/gui/static/memory_paging.js`（新增）
  - 纯分页状态与范围计算，供浏览器和 Node 测试共用。
- `src/synapse/integrations/gui/static/index.html`
  - 在 `app.js` 之前加载 `memory_paging.js`。
- `src/synapse/integrations/gui/static/styles.css`
  - 增加搜索区、分页控件、窄屏布局和列表滚动高度。

测试：

- `tests/test_gui_api.py`
  - 增加 Memory 分页边界测试和静态资源测试。
- `tests/frontend/memory_paging.test.js`（新增）
  - 使用 Node 内置 `node:test` 覆盖分页状态、范围计算和请求竞态判定。

文档：

- `README.md`
- `README.zh-CN.md`
- `docs/architecture/overview.md`
- `docs/guides/getting-started.md`
- `docs/reference/limitations.md`
- `docs/research/phase-3.2.2-report.md`

没有修改后端 Python 查询代码、SQLite Schema 或 MCP 工具。

## 3. 分页状态设计

前端 Memory 状态：

```text
state.memory = {
  type,
  q,
  selected,
  offset,
  limit: 20,
  total,
  rows,
  loading,
}
```

分页规则：

- 默认 `limit = 20`，`offset = 0`。
- 点击 Next：`offset += limit`。
- 点击 Previous：`offset -= limit`，最小为 0。
- 第一页禁用 Previous。
- 最后一页禁用 Next。
- 请求进行中隐藏分页条并设置 `loading`，阻止重复翻页。
- `total = 0` 时隐藏分页条，只显示空状态。
- 当前页越界时，使用 `normalizeOffset()` 回到最后一个有效页并重新请求。
- 分页数据全部来自后端，不在前端截取或模拟分页。

显示内容：

```text
Showing 21–40 of 65 memories
Previous    Page 2 of 4    Next
```

同时 panel header 显示后端返回的 `65 total`。

分页数学被放在 `memory_paging.js`，提供：

- `normalizeLimit()`
- `normalizeTotal()`
- `normalizeOffset()`
- `pageSummary()`
- `previousOffset()`
- `nextOffset()`

## 4. 搜索与筛选实现

- 搜索继续使用现有 `q` 参数，后端执行 SQL FTS 关键词查询。
- UI 明确标注 `SQL FTS · keyword · not hybrid recall`，不把列表搜索描述为 AI 语义搜索。
- 搜索采用 260ms 防抖；清空搜索时立即请求第一页。
- `memory_type` 使用系统真实的五种 `MemoryType`：`fact`、`experience`、`decision`、`preference`、`summary`。
- `note` 是 `NodeType`，不是 `MemoryType`，因此没有把它加入类型筛选，避免发送后端不接受的参数。
- 搜索词变化时：`offset = 0`、清除当前选择、重置详情、请求第一页。
- 类型变化时：`offset = 0`、清除当前选择、清除待执行防抖、请求第一页。
- 搜索和类型筛选可以组合，仍由后端 SQL 同时过滤并返回准确 `total`。
- 前端没有实现任何额外过滤逻辑。

## 5. 异步请求竞争处理

列表请求：

- 每次请求分配递增的 `memoryRequestSeq`。
- 请求携带 `id`、`projectId`、`type`、`q`。
- 响应返回后必须同时满足：
  - 请求 id 仍是最新 id；
  - 当前项目未变化；
  - 当前搜索词未变化；
  - 当前类型未变化。
- 任一条件不满足，旧响应直接丢弃，不更新列表、总数或分页状态。

详情请求：

- `memoryDetailSeq` 单独保护 Memory detail。
- 切换选择、筛选、分页或项目时递增，旧详情响应不会覆盖新详情。
- 列表重新加载后如果当前选中项不在新页面，会自动选择新页面第一条或显示空状态。

项目切换：

- 递增列表和详情请求序号。
- 重置 Memory 状态到默认分页。
- 重新进入 Memory 页面时不会显示旧项目的数据。

## 6. 测试覆盖

前端纯逻辑测试（10 个）：

- 默认每页 20 条及 limit 边界。
- 第一页、中间页、最后一页。
- 空结果。
- total 小于 limit。
- total 正好等于 limit。
- total 为 limit 的整数倍。
- 当前页越界时回到最后一个有效页。
- Previous/Next offset 计算。
- 请求 id 与项目/类型/查询上下文不匹配时拒绝旧响应。

API 回归测试新增：

- 第一页、中间页、最后一页的 `offset` / `limit` / `total`。
- 类型过滤后的整数倍分页。
- total 小于 limit。
- total 等于 limit。
- 静态首页加载 `memory_paging.js`，且脚本可访问。

原有测试继续覆盖：

- 搜索与类型组合。
- 超出范围页返回空列表但保留准确 `total`。
- 项目隔离和类型隔离。
- GUI 全部 13 个 API 端点、认证、404、423。
- Memory 详情读取。
- MCP recall 和 memory_get 的既有测试。

## 7. 完整验证结果

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
node --test tests\frontend\memory_paging.test.js
node --check src\synapse\integrations\gui\static\memory_paging.js
node --check src\synapse\integrations\gui\static\app.js
```

结果：

- `pytest`：55 个测试全部通过。
- `ruff`：`All checks passed!`
- `mypy`：`Success: no issues found in 65 source files`
- Node 前端测试：10 个全部通过。
- `node --check`：两个前端脚本语法检查通过。
- 前端没有现有构建系统或 DOM 测试框架，因此使用 Node 24 内置测试运行器，没有引入新依赖。

headless Edge + CDP 交互检查：

- Next：`Page 1 of 4` → `Page 2 of 4`，范围 `21–40`，显示 20 条。
- Previous：回到 `Page 1 of 4`，范围 `1–20`，Previous 禁用。
- 类型筛选 `decision`：`5 total`、`Page 1 of 1`，Previous/Next 均禁用。
- 类型 `fact` + 关键词 `fact`：`60 total`、`Page 1 of 3`，组合筛选生效。
- 清空关键词后保留 `fact` 类型，回到 `Page 1 of 3`。
- 竞态检查：人为延迟 `q=slow` 请求 900ms，随后输入 `q=fact`；最终页面为 `fact` 的 `60 total`、`Page 1 of 3`，旧请求没有覆盖新结果。

## 8. 视觉与响应式检查结果

使用临时 home、临时项目和 65 条记忆，通过本地 GUI 与 headless Edge 截图检查：

- 1440×1000 桌面布局：搜索框、类型 chips、Memory 列表、分页条和详情面板均正常。
- 760×1200 窄屏布局：Memory 列表与详情自动改为单列，分页条完整显示，未出现横向溢出。
- 桌面端为 Memory 列表设置滚动高度，分页条保持在面板内可见，不再被 20 条记录推到页面底部。
- 分页按钮沿用现有 ghost 按钮与灰阶体系，没有引入大型彩色控件。
- 搜索框、类型 chips 和分页控件在窄屏下自动换行。
- 空状态、加载状态、错误状态和重试按钮均有对应样式。
- 截图检查没有发现文字遮挡、按钮溢出或分页条错位。

## 9. 是否修改 Schema

没有。

- 没有新增表、列、索引或迁移。
- 没有修改 Memory 数据模型。
- 没有修改 `NodeRepository.memory_page()` 或 `MemoryTools.list()` 的查询语义。

## 10. 是否影响 MCP、CLI、Core

没有改变语义或契约：

- MCP 工具名称、参数和返回结构未变。
- `synapse_recall` 仍使用 hybrid 召回；GUI Memory 列表的 `q` 仍是 SQL FTS 关键词查询。
- CLI 命令未变。
- Core 的 `MemoryTools.list()` 仍接收相同的 `memory_type`、`query`、`limit`、`offset`。
- GUI 仍通过现有 `/memories` API 和 CoreWorker 访问 Core，没有前端 SQL 或第二套查询。
- GUI API 的既有响应字段保持兼容。

## 11. 遗留问题

- 前端没有 DOM 级自动化测试；当前由纯分页逻辑测试、API 测试和 headless 截图共同覆盖。
- 页面大小固定为 20，没有提供 10/20/50 的页大小选择器。
- 分页和筛选状态没有同步到 URL，刷新页面后会回到默认第一页。
- Memory 类型 chips 仍与 `MemoryType` 枚举保持手工同步；未来新增类型时需要同步前端常量。
- GUI 其他接口仍没有完整分页。
- 记忆编辑、删除、归档和版本历史仍不在当前阶段范围内。
- 本阶段未执行 Git commit、push、merge、reset 或 rebase。

## 12. 下一阶段建议

1. 为 GUI 增加轻量浏览器 E2E 测试，覆盖点击 Next/Previous、快速输入和项目切换的真实 DOM 行为。
2. 将 Memory 的搜索词、类型和 offset 同步到 URL，支持刷新后恢复浏览位置。
3. 评估是否暴露后端支持的 Memory 类型元数据，避免前端手工维护类型列表。
4. 为其他 GUI 列表端点统一分页契约，但继续保持后端负责过滤和计数。
5. 在记忆编辑/版本能力进入规划后，优先复用现有 Memory API 和 Core，而不是在 GUI 内新增写逻辑。
