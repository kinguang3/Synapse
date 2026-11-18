# Phase 3.4 实施报告

日期：2026-11-17

## 1. 结论

Phase 3.4 已完成可运行的 VS Code 兼容侧边栏 MVP，并在真实 VS Code 与 Trae CN 中验证。

交付物：

- 共享 Sidebar Webview：搜索、记忆、上下文。
- VS Code 扩展宿主适配层：SecretStorage、服务启动、HTTP、文件打开。
- 可安装 VSIX：`dist/synapse-companion-0.1.0.vsix`。
- 17 个 Node 测试，全部通过。
- 宿主能力审计、架构文档和本报告。

未完成或未验证：

- Cursor 未安装，只有静态兼容性判断。
- MCP Apps 没有可验证的宿主路径。
- 远程工作区、多根工作区和主题视觉回归未覆盖。

## 2. 实现范围

### 2.1 共享 UI

`hosts/shared/sidebar/` 提供：

- 项目选择与连接状态。
- `hybrid` / `keyword` 搜索和结果列表。
- 结果打开、复制、路径与行号展示。
- 记忆类型筛选、分页、详情和返回。
- 上下文查询与 token 预算。
- 索引、启动服务、设置令牌和设置入口。

UI 使用零构建 JavaScript、CSS 和宿主 RPC，不复制 Core 逻辑。

### 2.2 扩展宿主

`hosts/vscode/` 提供：

- 活动栏容器 `synapseSidebar`。
- Webview view `synapse.companion.sidebar`。
- 自动/手动启动本地 GUI 服务。
- SecretStorage 令牌管理。
- loopback HTTP 客户端和稳定错误映射。
- 项目根目录匹配和文件打开定位。
- 输出通道和服务日志脱敏。
- CSP、nonce 和资源 URI 限制。

### 2.3 未修改

- 未修改 Core、Tools、检索、记忆、上下文或索引逻辑。
- 未修改 SQLite schema。
- 未创建第二套数据库。
- 未替换现有独立 GUI。
- 未修改 MCP stdio 传输。
- 未提交 Git。

## 3. 真实运行结果

### 3.1 VS Code 1.146.0

- Extension Development Host 中活动栏出现 **Synapse**。
- 侧边栏启动 `.venv` 服务成功。
- 搜索 `search_nodes` 返回 20 条结果。
- 首条结果打开到 `src/synapse/integrations/gui/query_service.py:139`。
- 上下文构建约 1393 tokens，预算 2000。
- 状态：757 节点、1526 关系、95 来源。

### 3.2 Trae CN 3.4.20

最终 VSIX 安装到隔离临时 profile，验证结果：

- 活动栏和 Webview 正常。
- 服务未运行时显示启动按钮；启动后自动连接。
- 关闭并重新打开 Trae 后，SecretStorage 令牌仍然有效。
- 搜索返回 20 条结果，首条与 VS Code 相同。
- 搜索元信息为 `20 条 · 16 ms · hybrid`，不再错误显示“降级”。
- 上下文构建约 1374 tokens，预算 2000。
- “打开”成功将 `query_service.py` 设为活动编辑器。
- 状态：同一项目的 757 节点、1526 关系、95 来源。

Trae 的 VS Code 基础版本是 `1.107.1`，说明 `engines.vscode = ^1.107.0` 的选择可用。

## 4. 测试

命令：

```powershell
cd D:\Synapse\hosts
npm test
```

结果：

```text
tests 17
pass 17
fail 0
skipped 0
```

覆盖：

- loopback URL 限制和 Bearer 认证。
- health 探测不带令牌。
- 超时、服务不可用和 HTTP 错误映射。
- Webview CSP、nonce、资源与稳定 DOM ID。
- 项目选择、格式化、分页和错误展示。
- 扩展 bootstrap、搜索、上下文、路径逃逸拒绝。
- 令牌不出现在 HTML、RPC 结果或 URL 中。
- 真实 Chromium/Edge DOM 渲染。
- 空 `degraded` 不显示“降级”。

## 5. 打包

```powershell
cd D:\Synapse\hosts
npx --yes @vscode/vsce@3.6.2 package --out D:\Synapse\dist\synapse-companion-0.1.0.vsix
```

结果：

- 12 个文件，约 26.57 KB。
- 包含 `package.json`、`README.md`、`LICENSE.txt`、共享 UI、扩展 JS 和图标。
- 无打包警告。
- 无运行时 npm 依赖。

标识：

```text
synapse-local.synapse-companion
```

## 6. 与原始技术假设的差异

原始假设包含 React、TypeScript、Tailwind 和 XYFlow。仓库当前前端是无构建静态 SPA，没有 Node 构建链，也没有这些依赖。

本阶段选择不引入新构建链：

- 与现有 GUI 的技术路线一致。
- 避免为一个小型 Sidebar 增加 Node 依赖、构建产物和版本维护。
- 便于同一份资产同时进入 VS Code 和 Trae 的 Webview。
- 不改变 Core 和 GUI 的 Python 交付方式。

代价：

- 没有 TypeScript 静态类型。
- 复杂交互和图形视图不适合继续用原生 DOM 扩展。
- 如果未来需要图工作台内嵌，应单独立项评估构建链，而不是继续堆叠原生 DOM。

## 7. 发现并修复的问题

| 问题 | 影响 | 修复 |
| --- | --- | --- |
| Webview view container ID 含点号 | VS Code 报告容器不存在 | 容器改为 `synapseSidebar`，view 仍保留点号 |
| `package.json` 放在 `hosts/vscode/` | 扩展根目录和 `main` 解析错误 | 移到 `hosts/package.json`，`main` 指向 `./vscode/extension.js` |
| `this.context` 属性遮蔽 `context()` 方法 | 上下文 RPC 报 `this.context is not a function` | 改为 `this.extensionContext`，加入回归测试 |
| PowerShell 写入 UTF-8 带 BOM | 扩展 JS 可能被宿主误解析 | 移除 BOM，后续使用无 BOM 写入 |
| 搜索元信息使用 `if (info.degraded)` | 空数组也显示“降级” | 改为检查非空数组，DOM 测试断言不出现 |
| 缺少 `README`、`LICENSE` 和 `files` | VSIX 打包警告和不必要内容风险 | 增加清单字段和文件，重新打包无警告 |

## 8. 安全评审

- 令牌只存在于扩展 SecretStorage、HTTP Authorization 头和子进程环境变量。
- 没有把令牌写进 URL、Webview HTML、Webview state、RPC 结果或日志。
- Webview `connect-src 'none'`，不能绕过宿主直接访问本地 API。
- 服务地址强制 loopback，拒绝远程主机和带凭据 URL。
- 文件打开执行 realpath 和项目根目录边界检查，拒绝绝对路径和 `..` 逃逸。
- 服务日志在写入输出前替换令牌。
- `context` 方法遮蔽问题已修复并有回归测试，避免 RPC 路由失效。

## 9. Cursor 判断

Cursor 未安装，没有运行时证据。

静态上，扩展只使用 VS Code 1.107+ 稳定 API、标准 Webview、SecretStorage 和 VSIX，不使用原生模块或私有命令，因此是合理的候选宿主。报告不把 Cursor 标记为已验证。

后续验收清单：

1. 安装同一 VSIX。
2. 活动栏出现 Synapse。
3. 令牌可持久化，服务可启动。
4. 搜索、上下文、打开文件正常。
5. CSP 和资源路径未被宿主拦截。

## 10. 剩余限制

- 只支持本机 loopback 服务。
- 只支持 `hybrid` / `keyword`，不提供语义/向量检索。
- 记忆写入仍通过 MCP/CLI，不在 Sidebar 中编辑。
- 没有图视图；完整 Graph 继续使用独立 GUI。
- 多根工作区只按项目根目录匹配，未实现跨根目录文件选择器。
- 自动启动依赖工作区的 Python 环境或配置的 `synapse.pythonPath`。
- Trae 的 SOLO/IDE 模式和登录覆盖层属于宿主行为，扩展无法统一控制。
- URL-only MCP 客户端仍不能直接连接 Synapse，因为 MCP 仍是 stdio-only。

## 11. 文件

新增：

- `hosts/package.json`
- `hosts/README.md`
- `hosts/LICENSE`
- `hosts/vscode/extension.js`
- `hosts/vscode/gui_client.js`
- `hosts/vscode/webview_html.js`
- `hosts/vscode/media/synapse.svg`
- `hosts/shared/sidebar/sidebar.js`
- `hosts/shared/sidebar/sidebar_core.js`
- `hosts/shared/sidebar/sidebar.css`
- `tests/frontend/gui_client.test.js`
- `tests/frontend/webview_html.test.js`
- `tests/frontend/sidebar_core.test.js`
- `tests/frontend/vscode_extension.test.js`
- `tests/frontend/sidebar_dom.test.js`
- `docs/research/phase-3.4-host-capability-audit.md`
- `docs/research/phase-3.4-sidebar-architecture.md`
- `docs/research/phase-3.4-report.md`

生成物：

- `dist/synapse-companion-0.1.0.vsix`

`dist/` 是否进入版本控制遵循仓库现有忽略规则；本阶段不提交。
