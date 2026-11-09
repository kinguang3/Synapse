# 限制与边界

## 检索

- `hybrid` 是词法检索 + 图扩展 + 评分，不是向量混合检索。
- `semantic` 当前不可用，会返回 `degraded=["semantic_unavailable"]` 并退回词法结果。
- 没有 Embedding、向量数据库或远程模型调用。
- 中文使用 unigram/bigram FTS，不等同于语言级分词。

## 解析

- Python 使用 tree-sitter AST；Markdown 使用结构化解析。
- 其他文本后缀（`json`、`jsonc`、`toml`、`yaml`、`yml`、`txt`、`cfg`、`ini`、`conf`、`csv`、`xml`）生成文件级节点，不解析内部符号。
- 二进制、超大文件和被忽略文件不会纳入。
- 符号引用解析是本地启发式，不保证跨动态语言结构完全正确。

## 增量索引

- 默认快速路径依赖 `mtime_ns + size_bytes + parser_version`。
- 如果内容变化但 mtime 和 size 都恰好不变，默认不会重新解析。
- 需要严格内容校验时设置 `indexing.verify_content_hashes = true`，代价是每次扫描读取全部文件。
- `--full` 可以强制重新解析所有文件。

## 并发

- 同一项目同一时间只允许一个索引进程。
- 不同项目可以并发索引，但共享 SQLite 写锁。
- 没有后台守护进程、文件监听或自动重建。
- 锁是进程级文件锁；不适用于网络文件系统上的强一致协调。

## 崩溃恢复

- 恢复只处理同一项目的遗留 `running` 状态。
- 恢复策略是标记中断、取消未完成任务，然后由下一次扫描重建，而不是断点续传。
- 如果进程在解析线程中被强制终止，已提交的事务保留，未提交事务由 SQLite 回滚。
- 崩溃恢复不能修复数据库文件损坏；使用 `synapse doctor` 检查完整性。

## 上下文

- `max_tokens` 使用字符数近似估算，不是目标模型的精确 tokenizer。
- 为保证项目与统计信息，预算极小时仍可能超过限制。
- `truncated=true` 表示可选列表曾被裁剪。

## 路径

- 项目根路径注册后会被解析为绝对路径。
- Windows 上仅大小写不同的路径在应用层视为同一项目。
- SQLite 的唯一索引本身仍是大小写敏感；并发注册极端情况下仍可能依赖应用层检查。

## MCP

- 仅提供本地 stdio 传输，不监听 HTTP 端口，也没有内置鉴权；能启动该进程的本地用户即可调用其工具。
- 所有项目级工具必须传已注册项目；不支持跨项目或全局搜索。
- 节点工具会校验节点属于指定项目；`path_prefix` 只接受项目内相对路径。
- 只暴露 `keyword` / `hybrid`，不暴露不可用的 `semantic`。
- `synapse_remember` 会写入本地 SQLite；调用方需要自行决定何时写入记忆。
- `synapse_recall` 当前不返回完整 `content` 和 `tags`，只返回 `summary`、`snippet` 等检索字段；`summary` 在写入时截取前 300 字符。
- `synapse_context` 在较小 `max_tokens` 下可能优先返回 Repository 层，`decisions`、`recent_changes` 可能为空。
- 图模型主要覆盖 `CALLS`、`IMPORTS`、`CONTAINS` 等关系；构造函数参数注入不会自动成为图边，需要结合源码核对。
- Core 调用在单个 worker 线程上串行执行；一个 MCP 进程内的并发请求不会并行访问数据库。
- 进程退出时关闭 `Application`；外部 Client 负责重启崩溃或退出的 Server。
- 已在真实 Trae CN `3.4.16` 中通过对话界面验证 8 个 MCP 工具的发现和 A-F 调用；详见 `docs/phase-2.1.1-report.md`。

## 平台

- 当前主要开发和验证环境是 Windows + Python 3.12。
- 声明支持 Python 3.11+，但其他平台需要单独运行测试。
- 未提供 HTTP API、IDE 插件或 Web UI。
