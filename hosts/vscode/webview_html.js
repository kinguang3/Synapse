'use strict';

function buildWebviewHtml(options) {
  const opts = options || {};
  const cspSource = String(opts.cspSource || '');
  const nonce = String(opts.nonce || '');
  const coreUri = String(opts.coreUri || '');
  const sidebarUri = String(opts.sidebarUri || '');
  const styleUri = String(opts.styleUri || '');
  if (!cspSource || !nonce || !coreUri || !sidebarUri || !styleUri) {
    throw new Error('Webview asset metadata is incomplete');
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; base-uri 'none'; form-action 'none';">
<link rel="stylesheet" href="${styleUri}">
<title>Synapse Companion</title>
</head>
<body>
<div class="shell">
  <header class="top">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <span class="brand-name">Synapse</span>
      <span class="brand-tag">COMPANION</span>
    </div>
    <button class="icon-button" id="refresh-button" type="button" title="刷新" aria-label="刷新">
      <span aria-hidden="true">↻</span>
    </button>
  </header>

  <div class="connection" id="connection">
    <span class="dot" id="connection-dot"></span>
    <span id="connection-text">未连接</span>
  </div>

  <label class="project-field">
    <span class="field-label">项目</span>
    <select id="project-select" aria-label="项目"></select>
  </label>

  <nav class="tabs" aria-label="Synapse 视图">
    <button type="button" class="tab is-active" data-tab="search">搜索</button>
    <button type="button" class="tab" data-tab="memory">记忆</button>
    <button type="button" class="tab" data-tab="context">上下文</button>
  </nav>

  <main class="content">
    <section class="panel" data-panel="search">
      <form id="search-form" class="form-row">
        <input id="search-query" type="search" placeholder="搜索代码、文档或记忆" autocomplete="off">
        <select id="search-mode" aria-label="检索模式">
          <option value="hybrid">hybrid</option>
          <option value="keyword">keyword</option>
        </select>
        <button class="primary" type="submit">搜索</button>
      </form>
      <div class="meta-row" id="search-meta"></div>
      <div class="result-list" id="search-results"></div>
    </section>

    <section class="panel" data-panel="memory" hidden>
      <form id="memory-form" class="form-row memory-form">
        <input id="memory-query" type="search" placeholder="筛选记忆" autocomplete="off">
        <select id="memory-type" aria-label="记忆类型">
          <option value="">全部</option>
          <option value="fact">fact</option>
          <option value="experience">experience</option>
          <option value="decision">decision</option>
          <option value="preference">preference</option>
          <option value="summary">summary</option>
        </select>
        <button class="primary" type="submit">筛选</button>
      </form>
      <div class="meta-row" id="memory-meta"></div>
      <div class="result-list" id="memory-results"></div>
      <div class="pager" id="memory-pager" hidden>
        <button type="button" class="secondary" id="memory-prev">上一页</button>
        <span id="memory-range"></span>
        <button type="button" class="secondary" id="memory-next">下一页</button>
      </div>
      <div class="detail" id="memory-detail" hidden>
        <button type="button" class="back" id="memory-back">← 返回记忆列表</button>
        <div id="memory-detail-body"></div>
      </div>
    </section>

    <section class="panel" data-panel="context" hidden>
      <form id="context-form" class="form-row context-form">
        <input id="context-query" type="search" placeholder="可选：围绕任务构建上下文" autocomplete="off">
        <input id="context-budget" type="number" min="100" max="20000" step="100" value="2000" aria-label="Token 预算">
        <button class="primary" type="submit">构建</button>
      </form>
      <div class="meta-row" id="context-meta"></div>
      <pre class="context-output" id="context-output" hidden></pre>
    </section>
  </main>

  <div class="notice" id="notice" hidden></div>

  <footer class="footer">
    <span class="footer-status" id="status-text">就绪</span>
    <div class="footer-actions">
      <button type="button" class="secondary" id="index-button">索引</button>
      <button type="button" class="secondary" id="start-button" hidden>启动服务</button>
      <button type="button" class="secondary" id="token-button" hidden>设置令牌</button>
      <button type="button" class="secondary" id="settings-button">设置</button>
    </div>
  </footer>
</div>
<script nonce="${nonce}" src="${coreUri}"></script>
<script nonce="${nonce}" src="${sidebarUri}"></script>
</body>
</html>`;
}

module.exports = { buildWebviewHtml };
