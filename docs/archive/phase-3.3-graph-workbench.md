# Phase 3.3 — Knowledge Graph 信息架构与探索体验

> 范围：Synapse GUI 的 Knowledge Graph 页面。本文只描述**已经落地**的行为，并把“仅 UI 具备、底层数据尚不支持”的部分单独标出。

## 1. 原 Graph 页面的问题

改造前的 `#/graph` 是数据库对象的直接可视化：

- 一次 `GET /graph/overview` 把 `file / class / function / method / document / doc_section / memory` 混在同一张图上，按 salience 取前 N 个种子再扩邻居。
- 没有层级：一个文件节点和它内部的函数节点平级，用户看不出“项目 → 目录 → 文件 → 符号”的结构。
- 文档章节、代码符号、长期记忆共用一套颜色和筛选器，知识层之间没有边界。
- 初始化即批量取节点，节点一多就只能靠缩放和拖动词找目标。
- 节点详情复用全局右侧 inspector，与图谱没有联动（展开邻居会绕过视图状态直接 merge 到画布）。
- 关系筛选只有“全部关系类型”一个下拉，且视图并不知道当前项目是否真的存在该类关系。

结论：它展示的是 `KnowledgeNode` 存储，而不是帮助开发者理解项目的探索界面。

## 2. 新的信息架构

同一个 `Application`、同一个 SQLite 知识库，四个**观察视角**：

| 视图 | 回答的问题 | 默认节点 | 真实关系 |
| --- | --- | --- | --- |
| Architecture | 项目由哪些目录/文件组成？ | file / document（目录为视图分组） | CONTAINS、IMPORTS、REFERENCES |
| Symbols | 文件内部有哪些类/函数？谁调用谁？ | file（入口）+ class / function / method | CONTAINS、CALLS、IMPORTS、INHERITS、REFERENCES |
| Documentation | 文档结构和章节归属 | document / doc_section | CONTAINS、REFERENCES |
| Memory | 项目留下了哪些长期记忆 | memory / note | 真实存在的记忆关系（通常为空） |

页面结构（沿用现有暗色设计体系）：

```text
Knowledge Graph                                   [READY] [Refresh]
[ Architecture | Symbols | Documentation | Memory ]   one store · four lenses
[ search ] [TYPE chips] [RELATION chips] [LIMIT]        [Fit] [Reload]
+---------------------------------------------+------------------+
|                                             |  node detail     |
|              canvas (lazy loaded)           |  panel           |
|                                             |                  |
+---------------------------------------------+------------------+
NODES 12   RELATIONS 8   VIEW ARCHITECTURE       3 derived groups
```

- 顶部四个视图切换；`#/graph/<view>` 可直接深链，`?node=<id>` 可定位并展开某个节点。
- 每个视图有自己的 store、类型过滤、关系过滤、搜索词和 LIMIT，来回切换不丢状态；换项目时整体重置。
- 窄屏（≤1180px）下详情面板变成右侧抽屉，选中节点才出现。

## 3. 四种视图的实现

### 3.1 Architecture

- 根节点是**视图层合成的项目分组**（`group:root`，标题取项目名），一级子节点来自 `GET /graph/structure`。
- 目录同样是合成分组（`dir:<path>`），带 `files / documents / symbols / sections` 真实计数。
- 目录展开 = 再请求一次 `/graph/structure?path_prefix=<dir>`，只取直接子层。
- 文件展开 = `/graph/<file_id>/neighbors?direction=out&relation_types=CONTAINS`，拿真实子符号。
- 合成节点与其包含边都带 `synthetic: true`，画布上用虚线绘制，详情面板明确写明“目录节点是视图层按真实 path 聚合的分组，不是 KnowledgeNode”。

### 3.2 Symbols

- 初始只加载 `/graph/overview?node_types=file` 得到的入口文件（受 LIMIT 限制），**不加载任何符号**。
- 展开文件 → CONTAINS 子节点（class/function）；展开 class → method；展开 function/method → `direction=both` 的 CALLS/REFERENCES/IMPORTS/INHERITS 邻居。
- 搜索走 `/search?node_types=class,function,method`，命中结果并入画布并聚焦。
- 没有真实边时提示“没有可展示的真实子节点”，绝不按名字猜调用关系。

### 3.3 Documentation

- 初始 `/graph/overview?node_types=document`，只显示文档。
- 展开文档 → CONTAINS 得 `doc_section`，章节可继续展开子章节。
- 章节与代码符号不会同时出现在该视图（节点类型过滤 + 后端 node_types 双重限制）。

### 3.4 Memory

- 完全复用 `GET /memories`（`memory_type`、`q`、`limit`、`offset`）与 `GET /memories/{id}`。
- 支持 memory_type chips、关键词搜索、点击查看完整正文 / tags / provenance。
- 记忆节点目前没有稳定关系边，所以视图显示“该节点暂未解析出关系”，不会伪造边。
- “N memories total”来自后端 `total`，是过滤后的准确数量。

## 4. 节点与关系映射

### 4.1 真实枚举（核对结果）

- `NodeType`：`project / file / class / function / method / document / doc_section / note / memory`。
  - `project` 只在枚举里存在，**Core 从不创建 project 节点**。
  - 解析器实际产出：python → `file / class / function / method`；markdown → `document / doc_section`；其他文本 → `file`；记忆 → `memory`（`note` 未由现有入口创建）。
- `RelationType`：`CONTAINS / IMPORTS / CALLS / INHERITS / REFERENCES / EXPLAINS / DEPENDS_ON / RELATED_TO / DERIVED_FROM / SOLVES / CONTRADICTS / MENTIONS`。
  - 现有解析/归一化实际写出的只有 `CONTAINS`、`IMPORTS`、`CALLS`、`INHERITS`、`REFERENCES`。

### 4.2 能力映射

| 视图 | 需要的节点 | 需要的关系 | 当前是否支持 | 缺失能力 |
| --- | --- | --- | --- | --- |
| Architecture | File / Document，目录分组 | 文件→符号 CONTAINS；文件→文件 IMPORTS | 部分支持 | Core 没有 directory / project 节点，目录只能是视图分组；无目录级分页 API |
| Symbols | class / function / method（file 作入口） | CONTAINS / CALLS / IMPORTS / INHERITS / REFERENCES | 支持 | CALLS 是否出现取决于 resolver 能否解析目标；节点没有 signature 字段 |
| Documentation | document / doc_section | CONTAINS / REFERENCES | 支持 | 文档间 REFERENCES 依赖未解析引用的解析结果，可能为空 |
| Memory | memory / note | 记忆关系 | 部分支持 | 写入记忆时不建立关系边，视图通常 0 条边 |

## 5. API 复用与扩展

### 复用（未改动语义）

- `GET /api/v1/projects/{id}/graph/overview`
- `GET /api/v1/projects/{id}/graph/{node_id}/neighbors`
- `GET /api/v1/projects/{id}/nodes/{node_id}`
- `GET /api/v1/projects/{id}/search`
- `GET /api/v1/projects/{id}/memories`、`GET /api/v1/projects/{id}/memories/{node_id}`

### 新增（只读，不落库）

1. `GET /api/v1/projects/{id}/graph/capabilities`
   ```json
   {"project_id":"…","node_counts":{"file":3,"document":2,"class":1,"function":3,"method":1,"memory":3,"total":12},
    "relation_counts":{"CONTAINS":9,"CALLS":3,"IMPORTS":1},
    "views":{"architecture":{"node_types":["file","document"],"node_count":5},"…":{}}}
   ```
   用途：节点类型 chip 的真实计数、关系过滤只显示项目里真实存在的类型、视图空状态提示。

2. `GET /api/v1/projects/{id}/graph/structure?path_prefix=&limit=200`
   ```json
   {"project_id":"…","prefix":"","directories":[{"path":"src","name":"src","files":1,"documents":0,"symbols":3,"sections":0}],
    "files":[{"path":"app.py","node_id":"…","title":"app.py","node_type":"file","symbols":2,"sections":0}],
    "truncated":false,"meta":{"directory_count":2,"file_count":2,"path_rows":12}}
   ```
   用途：Architecture 的逐层展开。只读 `nodes` 表的 `id/node_type/path/title`，不取正文。

实现位置：`NodeRepository.path_rows()`、`RelationRepository.counts_by_type()`、`query_service.graph_capabilities()` / `graph_structure()`，路由在 `app.py`。

### 同时修复的既有缺陷

`/graph/{node_id}/neighbors` 的 `direction` 参数接受 `in|out|both`，但 Core 的 `RetrievalService.explore_graph` 只认 `incoming|outgoing|both`，`direction=out` 会返回 400。现在 `query_service` 做了别名归一化，CLI/MCP 语义不变。

## 6. 主要修改文件

| 文件 | 改动 |
| --- | --- |
| `src/synapse/storage/sqlite/repositories.py` | 新增 `NodeRepository.path_rows`、`RelationRepository.counts_by_type` |
| `src/synapse/integrations/gui/query_service.py` | 新增 capabilities/structure 服务、path_prefix 校验、direction 归一化 |
| `src/synapse/integrations/gui/app.py` | 新增两个只读路由 |
| `src/synapse/integrations/gui/static/graph_views.js` | 新增纯视图模型（四视图定义、去重、折叠、请求守卫、关系过滤） |
| `src/synapse/integrations/gui/static/graph_page.js` | 新增 Graph 工作台页面（四视图、懒加载、详情面板、状态栏） |
| `src/synapse/integrations/gui/static/app.js` | `renderGraph` 委托给工作台；GraphView 支持分组节点/虚线/展开角标；state 增加视图字段；移除旧的混合图逻辑 |
| `src/synapse/integrations/gui/static/styles.css` | tabs、搜索、两栏布局、详情面板、状态栏、窄屏抽屉 |
| `src/synapse/integrations/gui/static/index.html` | 按顺序加载 graph_views.js → graph_page.js → app.js |
| `tests/test_gui_graph.py` | 新增 5 个 API 测试 |
| `tests/test_gui_api.py` | 静态资源与脚本顺序断言 |
| `tests/frontend/graph_views.test.js` | 新增 12 个前端逻辑测试 |

## 7. 展开机制与性能限制

展开规则（前端统一入口 `expandNode`）：

```text
directory  -> GET /graph/structure?path_prefix=<path>
file/document/class/doc_section -> GET /graph/<id>/neighbors?direction=out&relation_types=CONTAINS
function/method -> GET /graph/<id>/neighbors?direction=both&relation_types=CALLS,REFERENCES,IMPORTS,INHERITS
memory/note -> GET /graph/<id>/neighbors?direction=both（仅当真实边存在）
```

- 每次只取一层；子节点上限 `limit=80`，目录层受 `LIMIT`（40/80/120/200）约束。
- store 以 `node_id` 去重、以 `from|to|type` 去重边，重复展开不会产生重复节点/边。
- 折叠按 parent→children 递归删除，`descendants` 用 visited 集合处理环。
- 展开中标记 loading，失败 toast 并保留可重试状态；无子节点时移除展开角标。
- 异步请求带 `{epoch, view}` 令牌，切换视图/项目/重建视图后旧响应直接丢弃。
- 画布不承载全图：初始只有一层，规模上限由 LIMIT 控制；关系过滤和类型过滤在**已加载**数据上做，不触发请求。

已知成本：

- `path_rows` 每次展开会读该项目的全部 `path/id/title` 行（不含正文），万级文件仍可接受，但属于 O(files)；尚无目录级 SQL 聚合或游标分页。
- Symbols 的入口文件来自 `graph/overview` 的 salience Top-N，不是全部文件；文件多时需要靠搜索或从 Architecture 进入。
- 文档入口同样是 salience Top-N。

## 8. 节点详情

右侧面板按类型展示真实字段，缺字段显示 `—` 或不渲染：

- 通用：type、node id、project、file path、lines、language、salience、confidence、provenance、created/updated。
- 代码节点：路径 + 行号区间 + 正文预览（`content_preview`，来自 `/nodes/{id}`）。
- 文档节点：标题、路径、行号、章节列表（RELATIONS 里的 CONTAINS 子节点可点击跳转）。
- 记忆节点：memory_type、summary、完整正文（`/memories/{id}`）、tags、provenance。
- 合成分组：files/documents/symbols/sections 计数 + “这是视图分组”的说明。
- 动作：展开/折叠、在 Symbols 中查看（文件/文档）、复制 ID。
- 详情请求带独立令牌，快速切换选中不会出现旧详情覆盖；跨项目节点由后端 `/nodes/{id}` 校验项目归属。

## 9. 关系过滤

- chips 只列出**该视图关系白名单 ∩ 项目真实关系计数**（`capabilities.relation_counts`）以及当前已加载边里出现的类型。
- 项目里没有的关系不渲染 chip（例如 demo 项目没有 INHERITS，就没有该 chip）。
- 过滤只影响可见边，不删除 store 数据，清空选择即恢复全部。
- 合成包含边（目录/项目 → 子节点）以虚线区分，且不受真实关系过滤影响。

## 10. 测试

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| API | `tests/test_gui_graph.py` | capabilities 真实计数与四视图定义；structure 逐层路径/符号计数/truncated；路径穿越与绝对路径 400；overview 的 node_types 隔离；CONTAINS 扩展只返回代码子节点 |
| API | `tests/test_gui_api.py` | 原有 7 个端点测试 + 新增 graph_views.js/graph_page.js 可服务且顺序正确 |
| 前端 | `tests/frontend/graph_views.test.js` | 四视图分层、节点/边去重、孤儿边丢弃、父子折叠、环安全、toggle、陈旧令牌、关系选项、边过滤、合成分组、reset |
| 前端 | `tests/frontend/memory_paging.test.js` | 既有分页逻辑回归 |

执行结果（本机 Windows）：

```text
pytest -q                     60 passed
ruff check .                  All checks passed!
mypy src                      Success: no issues found in 65 source files
node tests/frontend/graph_views.test.js      12 passed
node tests/frontend/memory_paging.test.js    10 passed
```

`npm run build` 不适用：前端是无构建静态 SPA，仓库没有 `package.json`；等价验证是直接在浏览器加载 `static/` 并用 `node --test` 跑前端逻辑。

浏览器验证：用无头 Edge 加载真实 GUI（临时 home + 示例项目），逐一截图确认：

- Architecture：项目分组 + `src` / `docs` 目录 + 2 个文件，5 nodes / 4 edges，目录计数 3 个合成分组。
- Symbols：3 个入口文件；`?node=<app.py>` 自动展开出 `main` / `build`，选中节点高亮、邻居之外变暗。
- Documentation：2 个文档；展开 README 得到 doc_section，边为真实 CONTAINS。
- Memory：3 条记忆（decision/fact/preference）菱形节点；详情显示 summary、正文、provenance，关系为空时明确提示。
- 900px 窄屏：详情面板变为右侧抽屉，工具栏换行。

（截图保存在本地 `.smoke/*.png`，未纳入仓库。）

## 11. 是否修改 Schema

**没有。** 未新增表、列、索引或迁移；数据库仍兼容旧库。

## 12. MCP / CLI / Core 兼容性

- Core：只新增**只读查询方法**和 GUI 适配层函数，未改 `Application` 装配、未改节点/关系语义、未改 resol/索引流程。
- CLI：无改动，命令与输出不变。
- MCP：无改动，9 个工具的 schema 与行为不变。
- GUI：新增 2 个只读端点，原有 13 个端点行为不变；`POST /projects/{id}/index` 语义不变。
- `direction` 别名修复只影响 GUI 入参，CLI/MCP 本来只用 `incoming/outgoing/both`。

## 13. 尚未实现的能力

### 已实现
- 四视图切换、深链（`#/graph/<view>?node=<id>`）、按层展开/折叠、去重、环安全、加载/错误状态。
- 真实计数驱动的类型/关系 chip、搜索（词法）、选中高亮与邻居高亮、Fit/Zoom/拖拽、右侧详情、窄屏抽屉、底部真实统计。

### 仅有 UI、底层数据不支持（**不是真实功能**）
- “目录”和“项目”节点：视图层分组，标 `synthetic:true`、虚线边，不写库。
- 文件节点的正文预览：Core 的 file 节点没有正文，详情显示“（无内容）”。
- 记忆的关系边：写入记忆不建立关系，Memory 视图通常 0 边。
- 文档间 REFERENCES：只有 resolver 真正解析出引用时才有，demo 项目为 0。
- 符号 Signature：Core 无该字段，未展示。

### 需要后续 Core 改造
- 真实的 directory/project 实体（若要跨项目或跨视图共享目录关系）。
- 记忆关系（EXPLAINS / DERIVED_FROM / REFERENCES）的写入与归一化。
- `graph_structure` 的目录级聚合 SQL 或游标分页（当前 O(files) 每次展开）。
- 文件级 IMPORTS 汇总与更强的符号解析，让 CALLS 覆盖率可预期。
- 语义检索（当前 `hybrid` 仍是词法 + 图扩展）。

## 14. 下一阶段建议

1. 给 `/graph/structure` 增加游标与目录级聚合，支撑万级文件仓库。
2. 让 Symbols 入口从“salience Top-N 文件”升级为“最近改动 / 搜索优先”，减少无目的浏览。
3. 在 Core 侧补 memory→node 的 REFERENCES（例如 `remember` 时关联文件/符号），Memory 视图才会有结构。
4. 目录分组若被证明有价值，再评估是否引入 directory 节点与迁移，而不是在 UI 里长期模拟。
5. 用同一套 workbench 暴露 `related` 的“反向引用”（谁引用了我），当前详情只展示出边桶。
