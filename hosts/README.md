# Synapse Companion

在 VS Code 兼容编辑器的活动栏中提供 Synapse 项目搜索、记忆浏览和上下文构建。

## 能力

- 搜索代码、文档和记忆，支持 `hybrid` / `keyword`。
- 浏览按项目隔离的记忆，并查看完整正文。
- 按查询和 token 预算构建项目上下文。
- 在编辑器中打开搜索结果并定位到起始行。
- 从侧边栏启动本地 Synapse GUI 服务或设置访问令牌。

## 安装

从最新 GitHub Release 一键安装：

```powershell
irm https://github.com/kinguang3/Synapse/releases/latest/download/install-sidebar.ps1 | iex
```

脚本会自动检测 VS Code、VS Code Insiders、Trae CN 和 Trae。也可以手动安装 VSIX：

```powershell
code --install-extension D:\Synapse\dist\synapse-companion-0.1.1.vsix
```

Trae CN 使用 `trae-cn --install-extension <path>`。安装后从活动栏打开 **Synapse**，或运行 `Synapse: Open Companion Sidebar`。

## 连接方式

侧边栏只通过扩展宿主访问本机 Synapse API：

```text
Webview -> postMessage RPC -> 扩展宿主 -> 127.0.0.1:8765 -> Synapse Core
```

- 服务地址仅允许 loopback；不支持远程主机。
- 访问令牌保存在编辑器 SecretStorage，只通过 `Authorization: Bearer` 请求头发送。
- Webview 不允许直接发起网络请求；令牌不会写入 HTML、URL 或日志。
- 自动启动服务默认关闭。可运行 `Synapse: Start Local Service`，或启用 `synapse.autoStartServer`。

## 设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `synapse.serverUrl` | `http://127.0.0.1:8765` | 本地 GUI API 地址，必须是 loopback。 |
| `synapse.pythonPath` | 空 | 启动服务使用的 Python；留空时优先使用工作区 `.venv`。 |
| `synapse.autoStartServer` | `false` | 侧边栏无法连接时是否自动启动服务。 |
| `synapse.requestTimeoutMs` | `15000` | API 请求超时，范围 1000-120000 毫秒。 |

## 开发

```powershell
npm test
npx --yes @vscode/vsce package --out ..\dist\synapse-companion-0.1.1.vsix
```

`npm test` 从 `hosts/` 运行 Node 测试。DOM 渲染测试需要本机安装 Edge 或 Chrome。
