# Synapse Companion

在 VS Code 兼容编辑器的活动栏中提供 Synapse 项目搜索、记忆浏览、上下文构建和图探索。

## 能力

- 搜索代码、文档和记忆，支持 `hybrid` / `keyword`。
- 浏览按项目隔离的记忆，并查看完整正文。
- 按查询和 token 预算构建项目上下文。
- 在编辑器中打开搜索结果并定位到起始行。
- 自动启动本地 Synapse GUI 服务，或手动设置访问令牌。

## 安装

推荐使用项目根目录的一键安装器，它会同时安装 CLI、MCP、GUI 运行时和侧边栏：

```powershell
irm https://github.com/kinguang3/Synapse/releases/latest/download/install.ps1 | iex
```

也可以手动安装 VSIX：

```powershell
code --install-extension D:\Synapse\dist\synapse-companion-0.1.1.vsix
```

其他 VS Code 兼容编辑器如果提供 `--install-extension` CLI，使用对应命令安装同一个 VSIX。安装后重启编辑器，从活动栏打开 **Synapse**，或运行 `Synapse: Open Companion Sidebar`。

## 连接方式

侧边栏只通过扩展宿主访问本机 Synapse API：

```text
Webview -> postMessage RPC -> 扩展宿主 -> 127.0.0.1:8765 -> Synapse Core
```

- 服务地址仅允许 loopback；不支持远程主机。
- 访问令牌保存在编辑器 SecretStorage，只通过 `Authorization: Bearer` 请求头发送。
- Webview 不允许直接发起网络请求；令牌不会写入 HTML、URL 或日志。
- 默认自动启动本地 GUI 服务。打开侧边栏时如果服务未运行，扩展会使用托管运行时启动它。

## 设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `synapse.serverUrl` | `http://127.0.0.1:8765` | 本地 GUI API 地址，必须是 loopback。 |
| `synapse.pythonPath` | 空 | 启动服务使用的 Python；留空时优先使用托管运行时、工作区 `.venv` 或 PATH。 |
| `synapse.autoStartServer` | `true` | 侧边栏无法连接时是否自动启动服务。 |
| `synapse.requestTimeoutMs` | `15000` | API 请求超时，范围 1000-120000 毫秒。 |
| `synapse.graphNodeDistance` | `68` | 知识图谱默认节点间距，范围 40-200；数值越大布局越松。 |

## 开发

```powershell
npm test
npx --yes @vscode/vsce package --out ..\dist\synapse-companion-0.1.1.vsix
```

`npm test` 从 `hosts/` 运行 Node 测试。DOM 渲染测试需要本机安装 Edge 或 Chrome。
