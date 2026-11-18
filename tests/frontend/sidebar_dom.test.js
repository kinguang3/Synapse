'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const { buildWebviewHtml } = require('../../hosts/vscode/webview_html.js');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browser = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));

function mockScript() {
  return String.raw`
window.__rpcCalls = [];
window.acquireVsCodeApi = function () {
  var state = {};
  function reply(id, result) {
    setTimeout(function () {
      window.postMessage({ type: 'rpcResult', id: id, ok: true, result: result }, '*');
    }, 5);
  }
  return {
    postMessage: function (message) {
      window.__rpcCalls.push(message.method);
      if (message.method === 'bootstrap') {
        reply(message.id, {
          connection: 'connected',
          message: '',
          projects: [{ id: 'project-1', slug: 'synapse', name: 'Synapse', root_path: 'D:\\Synapse' }],
          selectedProjectId: 'project-1',
          status: { stats: { nodes: 12, relations: 9, sources: 3 } }
        });
      } else if (message.method === 'search') {
        reply(message.id, {
          results: [{
            node_id: 'node-1',
            node_type: 'function',
            title: 'search_nodes',
            path: 'src/synapse/integrations/gui/query_service.py',
            start_line: 139,
            end_line: 160,
            snippet: 'def search_nodes(application, project_id)',
            score: 0.8
          }],
          meta: { mode: 'hybrid', returned: 1, took_ms: 4 }
        });
      } else if (message.method === 'memories') {
        reply(message.id, {
          memories: [{
            node_id: 'memory-1',
            node_type: 'memory',
            memory_type: 'decision',
            title: 'Use SQLite FTS5',
            summary: 'Local retrieval decision',
            tags: ['db', 'retrieval'],
            confidence: 0.9,
            salience: 0.7
          }],
          total: 1,
          offset: 0,
          limit: 20
        });
      } else if (message.method === 'memory') {
        reply(message.id, {
          node_id: 'memory-1',
          node_type: 'memory',
          memory_type: 'decision',
          title: 'Use SQLite FTS5',
          summary: 'Local retrieval decision',
          content: 'Keep SQLite FTS5 for local retrieval.',
          tags: ['db', 'retrieval'],
          confidence: 0.9,
          salience: 0.7,
          provenance: 'explicit',
          updated_at: '2026-11-17T00:00:00Z'
        });
      } else {
        reply(message.id, {});
      }
    },
    getState: function () { return state; },
    setState: function (value) { state = value; }
  };
};
window.addEventListener('load', function () {
  setTimeout(function () {
    document.getElementById('search-query').value = 'search nodes';
    document.getElementById('search-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, 150);
  setTimeout(function () {
    document.querySelector('[data-tab="memory"]').click();
  }, 350);
  setTimeout(function () {
    var title = document.querySelector('#memory-results .result-title');
    if (title) title.click();
  }, 700);
});
`;
}

function buildHarness() {
  const nonce = 'dom-harness';
  const asset = (name) => pathToFileURL(path.join(__dirname, '..', '..', 'hosts', 'shared', 'sidebar', name)).toString();
  let html = buildWebviewHtml({
    cspSource: 'file:',
    nonce,
    coreUri: asset('sidebar_core.js'),
    sidebarUri: asset('sidebar.js'),
    styleUri: asset('sidebar.css'),
  });
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  const coreTag = `<script nonce="${nonce}" src="${asset('sidebar_core.js')}"></script>`;
  html = html.replace(coreTag, `<script>${mockScript()}</script>${coreTag}`);
  return html;
}

function runBrowser(filePath) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-sidebar-edge-'));
    const child = spawn(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        `--user-data-dir=${profile}`,
        '--virtual-time-budget=4000',
        '--dump-dom',
        pathToFileURL(filePath).toString(),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      fs.rmSync(profile, { recursive: true, force: true });
      if (code !== 0) reject(new Error(`Browser exited ${code}: ${errors}`));
      else resolve(output);
    });
  });
}

test(
  'shared sidebar renders search, memory details and connection status in a browser',
  { skip: !browser ? 'No Chromium browser is installed' : false, timeout: 30000 },
  async () => {
    const filePath = path.join(os.tmpdir(), `synapse-sidebar-${process.pid}.html`);
    fs.writeFileSync(filePath, buildHarness(), 'utf8');
    try {
      const html = await runBrowser(filePath);
      assert.match(html, /已连接/);
      assert.match(html, /12 节点 · 9 关系 · 3 来源/);
      assert.match(html, /search_nodes/);
      assert.match(html, /src\/synapse\/integrations\/gui\/query_service\.py:139-160/);
      assert.match(html, /Use SQLite FTS5/);
      assert.match(html, /Keep SQLite FTS5 for local retrieval\./);
      assert.match(html, /decision/);
      assert.match(html, /Synapse — D:\\Synapse/);
      assert.equal(html.includes('请求超时'), false);
      assert.equal(html.includes('连接失败'), false);
      assert.equal(html.includes('降级'), false);
      assert.equal(html.includes('test-token'), false);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  },
);
