'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { GuiClient, GuiError, normalizeBaseUrl } = require('../../hosts/vscode/gui_client.js');

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('accepts loopback server URLs and rejects remote or credentialed URLs', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8765/').toString(), 'http://127.0.0.1:8765/');
  assert.equal(normalizeBaseUrl('http://localhost:8765').hostname, 'localhost');
  assert.throws(() => normalizeBaseUrl('http://example.com:8765'), GuiError);
  assert.throws(() => normalizeBaseUrl('http://user:pass@127.0.0.1:8765'), GuiError);
  assert.throws(() => normalizeBaseUrl('file:///tmp/socket'), GuiError);
});

test('sends the bearer token in headers and never in the URL', async () => {
  let seen = null;
  const client = new GuiClient({
    baseUrl: 'http://127.0.0.1:8765',
    token: 'top-secret-token',
    fetchImpl: async (url, options) => {
      seen = { url: String(url), options };
      return jsonResponse({ results: [], meta: {} });
    },
  });

  await client.search('project/one', 'hello world', { mode: 'keyword', limit: 5 });
  assert.equal(seen.options.headers.Authorization, 'Bearer top-secret-token');
  assert.equal(seen.url.includes('top-secret-token'), false);
  assert.equal(seen.url.includes('hello+world'), true);
  assert.equal(seen.url.includes('/api/v1/projects/project%2Fone/search'), true);
});

test('health probes do not require or send a token', async () => {
  let seen = null;
  const client = new GuiClient({
    baseUrl: 'http://127.0.0.1:8765',
    token: 'not-for-health',
    fetchImpl: async (url, options) => {
      seen = options;
      return jsonResponse({ status: 'ok' });
    },
  });
  const health = await client.health();
  assert.equal(health.status, 'ok');
  assert.equal(seen.headers, undefined);
});

test('maps API and authentication errors into GuiError', async () => {
  const client = new GuiClient({
    baseUrl: 'http://127.0.0.1:8765',
    token: 'bad',
    fetchImpl: async () =>
      jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'bad token' } }, 401),
  });
  await assert.rejects(
    () => client.projects(),
    (error) => error instanceof GuiError && error.status === 401 && error.code === 'UNAUTHENTICATED',
  );
});

test('reports unavailable services and request timeouts', async () => {
  const unavailable = new GuiClient({
    baseUrl: 'http://127.0.0.1:8765',
    token: 'token',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(
    () => unavailable.projects(),
    (error) => error.code === 'SERVICE_UNAVAILABLE',
  );

  const slow = new GuiClient({
    baseUrl: 'http://127.0.0.1:8765',
    token: 'token',
    timeoutMs: 10,
    fetchImpl: async (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  await assert.rejects(
    () => slow.projects(),
    (error) => error.code === 'TIMEOUT',
  );
});
