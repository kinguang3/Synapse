# Phase 3.4 跨宿主 Sidebar 架构

日期：2026-11-17

## 1. 目标

在 VS Code 兼容编辑器中提供 Synapse 侧边栏，复用现有本地 GUI API、Core 和 SQLite 数据；同一套共享 UI 同时服务 VS Code 与 Trae，并为 Cursor 保留兼容路径。

非目标：

- 不重写现有独立 GUI。
- 不修改 SQLite schema。
- 不创建第二套数据库或第二套检索/记忆逻辑。
- 不把 MCP 改成 HTTP/SSE。
- 不为单一宿主复制 Sidebar 业务代码。

## 2. 总体结构

```text
┌──────────────────────────────┐
│ Shared Webview               │
│ hosts/shared/sidebar         │
│ search / memory / context    │
└──────────────┬───────────────┘
               │ postMessage RPC
┌──────────────▼───────────────┐
│ Host adapter                 │
│ hosts/vscode/extension.js    │
│ SecretStorage + commands     │
│ HTTP client + file open      │
└──────────────┬───────────────┘
               │ Bearer over loopback HTTP
┌──────────────▼───────────────┐
│ Synapse GUI API              │
│ FastAPI :8765                │
│ query_service                │
└──────────────┬───────────────┘
               │ 既有调用
┌──────────────▼───────────────┐
│ Core / Tools / SQLite        │
└──────────────────────────────┘
```

关键约束：

- Webview 只发送 RPC 消息，不直接请求本地 API。
- 扩展宿主是唯一的令牌持有者和 HTTP 调用者。
- 所有知识数据来自现有 GUI API；Sidebar 不实现检索、记忆或上下文算法。
- 同一项目只允许一个 GUI 服务实例；Sidebar 启动前先探测 health。

## 3. 目录与职责

```text
hosts/
  package.json                 扩展清单
  README.md                    安装与安全说明
  LICENSE                      MIT 许可证
  vscode/
    extension.js               activation、Webview provider、controller
    gui_client.js              loopback HTTP 客户端与错误映射
    webview_html.js            CSP + nonce + 资源 URI 的 HTML 外壳
    media/synapse.svg          活动栏图标
  shared/
    sidebar/
      sidebar.js               Webview 行为与 RPC 客户端
      sidebar_core.js          纯状态/格式化/分页 helper
      sidebar.css              主题变量与响应式样式
```

`shared/` 不包含宿主内业务；它依赖一个很小的宿主桥：`acquireVsCodeApi().postMessage`、`getState`、`setState`。因此它可以在任何 VS Code 兼容 Webview 中运行；非兼容宿主需要提供等价 shim。

## 4. Webview RPC 契约

请求：

```json
{
  "type": "rpc",
  "id": 1,
  "method": "search",
  "params": { "projectId": "...", "query": "...", "mode": "hybrid" }
}
```

成功响应：

```json
{ "type": "rpcResult", "id": 1, "ok": true, "result": {} }
```

失败响应：

```json
{
  "type": "rpcResult",
  "id": 1,
  "ok": false,
  "error": { "message": "...", "code": "UNAUTHENTICATED", "status": 401 }
}
```

方法：

| 方法 | 参数 | 作用 |
| --- | --- | --- |
| `bootstrap` | 无 | 探测服务、加载项目、项目状态 |
| `selectProject` | `projectId` | 切换并持久化当前项目 |
| `status` | `projectId` | 刷新节点/关系/来源统计 |
| `search` | `projectId`, `query`, `mode` | 搜索，固定最多 20 条 |
| `memories` | `projectId`, `query`, `memoryType`, `limit`, `offset` | 记忆分页列表 |
| `memory` | `projectId`, `nodeId` | 读取完整记忆 |
| `context` | `projectId`, `query`, `maxTokens` | 构建上下文 |
| `index` | `projectId`, `full` | 触发索引 |
| `openPath` | `path`, `line` | 打开项目内文件并定位 |
| `copy` | `text` | 写入宿主剪贴板 |
| `startServer` | 无 | 启动本地 GUI 服务 |
| `setToken` | 无 | 打开密码输入框保存/清除令牌 |
| `openSettings` | 无 | 打开扩展设置 |

未知方法返回 `UNKNOWN_METHOD`。每个 RPC 在 UI 侧有超时，避免 Webview 永久等待。

## 5. 连接与错误状态

状态机：

```text
connecting -> connected
           -> offline       (health 不可达)
           -> auth-required (服务可达但没有/错误令牌)
           -> error         (配置或未知错误)
```

- `bootstrap` 先探测 health，再读取 SecretStorage 令牌。
- 没有令牌时返回 `auth-required`，UI 显示“设置令牌”。
- 服务未运行时返回 `offline`，UI 显示“启动服务”。
- `startServer` 先生成/读取令牌，再以环境变量传入子进程。
- `autoStartServer` 默认关闭；启用后只在无法连接时尝试启动。
- 服务启动后轮询 health，最多约 15 秒；失败时终止子进程并返回稳定错误。

项目选择：

1. 优先使用 `workspaceState` 中保存的项目。
2. 其次匹配工作区根目录与 `project.root_path`。
3. 最后回退到第一个已注册项目。

## 6. 安全设计

### 6.1 令牌

- 令牌生成：`crypto.randomBytes(32).toString('base64url')`。
- 保存：VS Code `SecretStorage`，键为 `synapse.companion.token`。
- 传递：只放在 HTTP `Authorization: Bearer` 请求头。
- 启动服务：只通过子进程环境变量 `SYNAPSE_GUI_TOKEN` 传入，不进入命令行参数。
- 日志：服务 stdout/stderr 逐行写入 OutputChannel 前执行令牌替换。
- Webview：HTML、state、RPC payload 均不含令牌；测试断言 HTML 不含 `Bearer` 和令牌值。

### 6.2 网络边界

- `GuiClient` 只接受 `http` / `https`。
- 主机必须是 `127.0.0.1`、`localhost` 或 `::1`。
- 拒绝 URL 中的用户名/密码。
- 清空 query、fragment 和尾部斜杠。
- health 探测不发送令牌。

### 6.3 Webview

- CSP：`default-src 'none'`、`connect-src 'none'`。
- 脚本和样式只允许带 nonce 的本地资源。
- `localResourceRoots` 限制为 `shared/` 和 `vscode/media/`。
- 不使用内联事件处理器，不把数据拼接进 `innerHTML`。
- 动态列表使用 `textContent` 和 `replaceChildren`。

### 6.4 文件打开

`openPath` 只接受项目内相对路径：

1. 拒绝空路径、NUL 和绝对路径。
2. 以当前项目 `root_path` 解析目标。
3. 对 root 和 target 执行 `realpath`。
4. 用 `path.relative` 检查目标没有逃逸项目根目录。
5. 文件不存在时返回 `FILE_NOT_FOUND`。
6. 行号从 1 开始，越界时夹到文本最后一行。

该流程防止 `..`、符号链接和绝对路径逃逸。

## 7. 自动启动

候选 Python 顺序：

1. 配置 `synapse.pythonPath`。
2. 环境变量 `SYNAPSE_PYTHON`。
3. 工作区 `.venv/Scripts/python.exe` 或 `.venv/bin/python`。
4. 工作区 `venv` 等价路径。
5. `python` / `python3`。

启动参数：

```text
-m synapse.integrations.gui --host 127.0.0.1 --port 8765 --no-access-log
```

工作目录为第一个工作区根目录。子进程退出时记录 exit code/signal；扩展销毁时终止自己启动的进程。外部已在运行的服务不会被扩展接管或终止。

## 8. 宿主适配与打包

- 扩展根目录是 `hosts/`，不是 `hosts/vscode/`。
- `main` 指向 `./vscode/extension.js`。
- 活动栏容器 ID 为 `synapseSidebar`，不能包含点号；Webview view ID 为 `synapse.companion.sidebar`。
- `engines.vscode` 为 `^1.107.0`，覆盖 Trae 的 1.107.1 基础版本。
- `files` 只打包 `README.md`、`LICENSE`、`vscode/**`、`shared/**`。
- 无构建步骤；Node 直接加载 CommonJS。
- 无运行时 npm 依赖；VSIX 约 27 KB。

## 9. UI 设计

- 三个主视图：搜索、记忆、上下文。
- 搜索固定 `hybrid` / `keyword`，保留后端真实 `meta`。
- 记忆支持类型筛选、分页、详情返回。
- 上下文支持可选 query 和 100-20000 token 预算。
- 使用 VS Code 主题变量，不硬编码宿主背景和前景色。
- 无 React、Tailwind、XYFlow 或打包器；与仓库现有零构建前端保持一致。
- 窄侧边栏下表单自动换行，结果卡片保持可读。

## 10. 故障处理

| 场景 | 行为 |
| --- | --- |
| 服务未运行 | 显示 `offline` 和启动按钮 |
| 没有令牌 | 显示 `auth-required` 和设置令牌 |
| 令牌错误 | 显示 `auth-required`，不泄露服务详情 |
| 请求超时 | `TIMEOUT`，UI 提示并恢复控件 |
| 非 loopback URL | 拒绝连接，提示配置错误 |
| 项目根目录不匹配 | 保留已加载项目，无法打开文件时返回错误 |
| 文件逃逸或不存在 | `INVALID_PATH` / `FILE_NOT_FOUND` |
| 服务启动失败 | 终止子进程，返回最后一条脱敏日志 |

## 11. 测试边界

- `gui_client.test.js`：URL 限制、Bearer 头、health 无令牌、错误/超时映射。
- `webview_html.test.js`：CSP、nonce、外部脚本、稳定 DOM ID、无令牌。
- `sidebar_core.test.js`：项目选择、路径格式、分页、错误和 tab 规范化。
- `vscode_extension.test.js`：bootstrap、RPC、SecretStorage、路径逃逸、令牌不外泄、`context` 方法不被属性遮蔽。
- `sidebar_dom.test.js`：真实 Chromium/Edge 中渲染搜索、记忆、详情、连接状态，并断言空 `degraded` 不显示“降级”。

不覆盖：真实 Cursor、远程工作区、多根工作区下的跨根文件选择、宿主主题视觉回归。
