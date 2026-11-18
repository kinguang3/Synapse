'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWebviewHtml } = require('../../hosts/vscode/webview_html.js');

function options() {
  return {
    cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
    nonce: 'abc123',
    coreUri: 'https://file+.vscode-resource.vscode-cdn.net/core.js',
    graphCoreUri: 'https://file+.vscode-resource.vscode-cdn.net/graph_core.js',
    graphUri: 'https://file+.vscode-resource.vscode-cdn.net/graph.js',
    sidebarUri: 'https://file+.vscode-resource.vscode-cdn.net/sidebar.js',
    styleUri: 'https://file+.vscode-resource.vscode-cdn.net/sidebar.css',
  };
}

test('requires complete webview asset metadata', () => {
  assert.throws(() => buildWebviewHtml({}), /incomplete/);
  assert.throws(() => buildWebviewHtml(Object.assign(options(), { nonce: '' })), /incomplete/);
});

test('uses external scripts with a nonce and a restrictive CSP', () => {
  const html = buildWebviewHtml(options());
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /<script nonce="abc123" src="https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\/core\.js"><\/script>/);
  assert.match(html, /<script nonce="abc123" src="https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\/graph_core\.js"><\/script>/);
  assert.match(html, /<script nonce="abc123" src="https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\/graph\.js"><\/script>/);
  assert.match(html, /<script nonce="abc123" src="https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\/sidebar\.js"><\/script>/);
  assert.equal(html.includes('<script>'), false);
});

test('loads the shared stylesheet and never embeds a token', () => {
  const html = buildWebviewHtml(options());
  assert.match(html, /href="https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\/sidebar\.css"/);
  assert.equal(html.includes('Bearer'), false);
  assert.equal(html.includes('Authorization'), false);
  assert.equal(html.includes('token='), false);
});

test('provides the stable sidebar shell ids used by the shared UI', () => {
  const html = buildWebviewHtml(options());
  for (const id of [
    'project-select',
    'search-form',
    'search-results',
    'memory-form',
    'memory-results',
    'graph-root',
    'context-form',
    'context-output',
    'start-button',
    'token-button',
    'settings-button',
  ]) {
    assert.equal(html.includes(`id="${id}"`), true, id);
  }
});
