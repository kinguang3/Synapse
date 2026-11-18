# Phase 3.4 宿主能力审计

日期：2026-11-17

## 1. 目标

本审计回答一个问题：在不复制 Synapse Core、不维护多套业务前端的前提下，哪个宿主能力面可以同时承载 VS Code、Trae 和潜在的 Cursor 侧边栏。

结论：选择 **VS Code 兼容扩展宿主 + 共享 Webview + 本地 GUI HTTP API**。MCP 继续作为 Agent 工具通道，不作为本阶段 UI 通道。

## 2. 审计方法

- 阅读客户端扩展 API、Webview、SecretStorage 和本地服务相关文档。
- 在本机 VS Code 1.146.0 中运行 Extension Development Host。
- 将打包后的 VSIX 安装到隔离的 Trae CN 临时 profile，执行真实连接、搜索、上下文和打开文件。
- Cursor 未安装，只做静态兼容性分析，不标记为已验证。
- OpenCode 不在本阶段范围。

## 3. 宿主对照

| 能力 | VS Code 1.146.0 | Trae CN 3.4.20 | Cursor | 结论 |
| --- | --- | --- | --- | --- |
| 活动栏 Webview View | 已验证 | 已验证 | 未验证 | VS Code 兼容 API 可复用 |
| 扩展宿主 Node/HTTP | 已验证 | 已验证 | 未验证 | 本地 HTTP 调用放在扩展宿主 |
| SecretStorage | 已验证 | 已验证 | 未验证 | 令牌不进入 Webview |
| `workspaceFolders` | 已验证 | 已验证 | 未验证 | 用于匹配项目根目录 |
| `openTextDocument` / 行定位 | 已验证 | 已验证 | 未验证 | 搜索结果可直接打开 |
| 本机 VSIX 安装 | 开发宿主已验证 | 已验证 | 未验证 | 可离线分发 |
| 自动启动 Python 服务 | 已验证 | 已验证 | 未验证 | 由扩展宿主 spawn |
| stdio MCP | 与 Sidebar 独立 | 已有验证 | 未验证 | 继续作为工具通道 |
| MCP Apps UI | 无本机验证路径 | 无文档证据 | 无 | 不作为本阶段方案 |

Trae CN 的 VS Code 基础版本为 `1.107.1`；应用版本为 `3.4.20`。其 Webview 和目标 VS Code API 足够运行本扩展，但活动栏 DOM class 与标准 VS Code 不完全一致，不能依赖内部 class 选择器。

## 4. 候选方案

### 4.1 VS Code 兼容扩展 + Webview

优点：

- 直接获得活动栏、Webview、SecretStorage、工作区路径和文件打开能力。
- Trae 已验证兼容，Cursor 作为 VS Code 分支是合理候选。
- Sidebar 可以复用现有 GUI API，不复制索引、检索、记忆或上下文逻辑。
- 可打包为 VSIX，离线安装。

限制：

- 共享 UI 仍依赖 `acquireVsCodeApi()`；对非 VS Code 兼容宿主需要额外的 shim。
- 不同分支的 Webview CSP、主题变量和活动栏行为可能有差异。
- Cursor 未安装，不能声明运行时兼容。

### 4.2 MCP Apps

本阶段没有找到 VS Code 或 Trae 中可验证的 MCP Apps 宿主路径。Trae 的 MCP 支持集中在 stdio 工具调用，VS Code 也未作为本项目的 UI 承载目标验证。

因此 MCP Apps 不能作为三个编辑器的统一 Sidebar 方案。MCP 继续承担 Agent 工具调用；Sidebar 通过 GUI HTTP API 展示人类可读视图。

### 4.3 独立浏览器 GUI

现有 GUI 已经可用，但它是独立窗口，不是编辑器内嵌侧边栏。它仍保留，用于完整知识工作台和 Graph 页面；Sidebar 只提供高频的搜索、记忆和上下文。

## 5. 真实运行证据

### 5.1 VS Code

- 活动栏出现 **Synapse**。
- 从 Sidebar 启动本地服务成功。
- 项目显示为 `Synapse — D:\Synapse`。
- 搜索 `search_nodes` 返回 20 条结果，首条为 `src/synapse/integrations/gui/query_service.py:139-160`。
- 点击“打开”后在编辑器打开 `query_service.py`，并定位到第 139 行。
- 上下文构建成功，观测 `~1393 tokens · budget 2000`。
- 状态显示 `757 节点 · 1526 关系 · 95 来源`。

### 5.2 Trae CN

- 最终 VSIX 安装到隔离临时 profile，版本为 `0.1.0`。
- 活动栏出现 **Synapse**，Webview 正常渲染。
- 服务未启动时显示启动按钮；点击后成功启动并自动连接。
- 重启 Trae 后 SecretStorage 中的令牌仍可复用，侧边栏直接启动服务并连接。
- 搜索 `search_nodes` 返回 20 条结果；首条与 VS Code 一致。
- 上下文构建成功，观测 `~1374 tokens · budget 2000`。
- 点击“打开”后 `query_service.py` 成为活动编辑器。
- 状态显示同一项目的 `757 节点 · 1526 关系 · 95 来源`。

### 5.3 运行中发现的差异

- Trae 初次启动会显示登录/导入设置/模式选择覆盖层；切换到 IDE 模式后活动栏和扩展正常。
- Trae 的活动栏不是标准 `.activitybar` DOM；通过 `a.action-label[aria-label="Synapse"]` 可定位。产品代码不依赖该 DOM。
- Trae 首屏可能恢复上次 SOLO 模式；这是宿主状态，不是扩展错误。
- 搜索元信息曾错误地把空 `degraded` 数组显示为“降级”。后端实际返回 `degraded: []`；已修复为仅在非空数组时显示，并加入 DOM 回归断言。

## 6. Cursor 兼容性判断

Cursor 未安装，因此没有版本、扩展 API 或真实运行证据。静态判断如下：

- Cursor 是 VS Code 分支，通常支持 VSIX 和常见扩展 API。
- 当前扩展只使用 VS Code 1.107+ 的稳定 API，不依赖原生模块、构建链或私有命令。
- 代码不依赖 VS Code 内部 DOM；Trae 的活动栏差异已经证明这一约束有效。
- 共享 Webview 使用标准 CSP、nonce、`asWebviewUri` 和 `acquireVsCodeApi`。

结论：Cursor 是**候选兼容宿主**，不是已验证宿主。后续验收至少需要：

1. 安装同一 VSIX。
2. 活动栏出现 Synapse。
3. 启动服务并完成令牌持久化。
4. 搜索、上下文、打开文件可用。
5. 确认 Webview 没有因 CSP 或资源根路径被拦截。

## 7. 决策

1. Sidebar 作为 VS Code 兼容扩展交付，扩展根目录为 `hosts/`。
2. VS Code 与 Trae 共用同一套 `hosts/shared/sidebar` Webview 代码。
3. 所有数据访问经过扩展宿主和本地 GUI API；Webview 不持有令牌，也不直接访问网络。
4. 现有独立 GUI、CLI、MCP 和 Core 保持不变。
5. Cursor 在真实安装验证前只记录为候选宿主。
