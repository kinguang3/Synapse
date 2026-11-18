'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const TOKEN = 'integration-secret-token';

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

class FakeUri {
  constructor(fsPath) {
    this.fsPath = fsPath;
    this.path = fsPath.replace(/\\/g, '/');
  }

  static file(fsPath) {
    return new FakeUri(fsPath);
  }

  static joinPath(base, ...parts) {
    return new FakeUri(path.join(base.fsPath, ...parts));
  }

  toString() {
    return 'file:///' + this.path.replace(/^\//, '');
  }
}

test('host bridge bootstraps, searches, and rejects path escapes without exposing the token', async () => {
  const commands = new Map();
  const requestLog = [];
  const posted = [];
  const secretStore = new Map([['synapse.companion.token', TOKEN]]);
  const stateStore = new Map();
  let messageHandler = null;
  let registeredProvider = null;

  const configuration = {
    serverUrl: 'http://127.0.0.1:8765',
    pythonPath: '',
    autoStartServer: false,
    requestTimeoutMs: 5000,
  };

  const vscode = {
    Uri: FakeUri,
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Selection: class Selection {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    workspace: {
      workspaceFolders: [{ uri: FakeUri.file('D:\\Synapse') }],
      getConfiguration: () => ({
        get: (key, fallback) => (key in configuration ? configuration[key] : fallback),
      }),
      openTextDocument: async () => ({ lineCount: 10 }),
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      registerWebviewViewProvider: (_id, provider) => {
        registeredProvider = provider;
        return { dispose() {} };
      },
      showTextDocument: async () => ({ selection: null, revealRange() {} }),
      showInputBox: async () => undefined,
      showInformationMessage() {},
      showWarningMessage() {},
      showErrorMessage() {},
    },
    commands: {
      registerCommand: (id, callback) => {
        commands.set(id, callback);
        return { dispose() {} };
      },
      executeCommand: async () => undefined,
    },
    env: {
      clipboard: {
        writeText: async () => undefined,
      },
    },
  };

  const context = {
    extensionUri: FakeUri.file('D:\\Synapse\\hosts'),
    subscriptions: [],
    secrets: {
      get: async (key) => secretStore.get(key),
      store: async (key, value) => {
        secretStore.set(key, value);
      },
      delete: async (key) => {
        secretStore.delete(key);
      },
    },
    workspaceState: {
      get: (key, fallback) => (stateStore.has(key) ? stateStore.get(key) : fallback),
      update: async (key, value) => {
        stateStore.set(key, value);
      },
    },
  };

  const originalFetch = global.fetch;
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };

  global.fetch = async (url, options) => {
    const parsed = new URL(String(url));
    requestLog.push({
      path: parsed.pathname,
      authorization: options && options.headers ? options.headers.Authorization : '',
      url: String(url),
    });
    if (parsed.pathname === '/api/v1/health') {
      return jsonResponse({ status: 'ok', version: '0.0.0' });
    }
    if (parsed.pathname === '/api/v1/projects') {
      return jsonResponse({
        projects: [
          {
            id: 'project-1',
            slug: 'synapse',
            name: 'Synapse',
            root_path: 'D:\\Synapse',
          },
        ],
      });
    }
    if (parsed.pathname === '/api/v1/projects/project-1/status') {
      return jsonResponse({
        project: { id: 'project-1', name: 'Synapse' },
        stats: { nodes: 12, relations: 9, sources: 3 },
      });
    }
    if (parsed.pathname === '/api/v1/projects/project-1/search') {
      return jsonResponse({
        results: [
          {
            node_id: 'node-1',
            node_type: 'function',
            title: 'search_nodes',
            path: 'src/synapse/integrations/gui/query_service.py',
            start_line: 139,
            end_line: 160,
            snippet: 'def search_nodes',
            score: 0.8,
          },
        ],
        meta: { mode: 'hybrid', returned: 1, took_ms: 4 },
      });
    }
    if (parsed.pathname === '/api/v1/projects/project-1/context') {
      return jsonResponse({
        project: { id: 'project-1', name: 'Synapse' },
        stats: { nodes: 12, relations: 9, sources: 3 },
        token_estimate: 42,
      });
    }
    if (parsed.pathname === '/api/v1/projects/project-1/graph/capabilities') {
      return jsonResponse({
        project_id: 'project-1',
        node_counts: { file: 2, function: 1 },
        relation_counts: { CONTAINS: 2, CALLS: 1 },
        views: {},
      });
    }
    if (parsed.pathname === '/api/v1/projects/project-1/graph/structure') {
      return jsonResponse({
        project_id: 'project-1',
        prefix: '',
        directories: [],
        files: [{ node_id: 'file-1', node_type: 'file', title: 'app.py', path: 'app.py' }],
        truncated: false,
        meta: { file_count: 1, directory_count: 0 },
      });
    }
    if (parsed.pathname === '/api/v1/projects/project-1/graph/overview') {
      return jsonResponse({
        project_id: 'project-1',
        nodes: [{ node_id: 'doc-1', node_type: 'document', title: 'README.md' }],
        edges: [],
        truncated: false,
      });
    }
    if (parsed.pathname === '/api/v1/projects/project-1/nodes/node-1') {
      return jsonResponse({
        node: { node_id: 'node-1', node_type: 'function', title: 'search_nodes' },
        related: { calls: [] },
      });
    }
    if (parsed.pathname === '/api/v1/projects/project-1/graph/node-1/neighbors') {
      return jsonResponse({
        start_node_id: 'node-1',
        nodes: [{ node_id: 'node-2', node_type: 'function', title: 'graph_nodes' }],
        edges: [],
        truncated: false,
      });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  try {
    const extension = require('../../hosts/vscode/extension.js');
    extension.activate(context);
    assert.ok(registeredProvider);
    assert.ok(commands.has('synapse.companion.focus'));
    assert.ok(commands.has('synapse.companion.startServer'));
    assert.ok(commands.has('synapse.companion.setToken'));

    const webview = {
      cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
      options: null,
      html: '',
      asWebviewUri: (uri) =>
        'https://file+.vscode-resource.vscode-cdn.net/' +
        uri.fsPath.split('hosts\\')[1].replace(/\\/g, '/'),
      onDidReceiveMessage: (callback) => {
        messageHandler = callback;
        return { dispose() {} };
      },
      postMessage: async (message) => {
        posted.push(message);
        return true;
      },
    };
    const view = {
      webview,
      visible: true,
      onDidChangeVisibility: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    };

    await registeredProvider.resolveWebviewView(view);
    assert.ok(messageHandler);
    assert.equal(webview.html.includes(TOKEN), false);
    assert.equal(webview.html.includes('Bearer'), false);
    assert.ok(webview.options.localResourceRoots.length >= 2);

    await messageHandler({ type: 'rpc', id: 1, method: 'bootstrap', params: {} });
    const bootstrap = posted.find((message) => message.id === 1);
    assert.equal(bootstrap.ok, true);
    assert.equal(bootstrap.result.connection, 'connected');
    assert.equal(bootstrap.result.selectedProjectId, 'project-1');
    assert.equal(bootstrap.result.status.stats.nodes, 12);
    assert.equal(JSON.stringify(bootstrap.result).includes(TOKEN), false);

    const projectsRequest = requestLog.find((item) => item.path === '/api/v1/projects');
    assert.equal(projectsRequest.authorization, 'Bearer ' + TOKEN);
    assert.equal(projectsRequest.url.includes(TOKEN), false);

    await messageHandler({
      type: 'rpc',
      id: 2,
      method: 'search',
      params: { projectId: 'project-1', query: 'search nodes', mode: 'keyword' },
    });
    const search = posted.find((message) => message.id === 2);
    assert.equal(search.ok, true);
    assert.equal(search.result.results[0].title, 'search_nodes');

    await messageHandler({
      type: 'rpc',
      id: 5,
      method: 'context',
      params: { projectId: 'project-1', query: 'memory', maxTokens: 2000 },
    });
    const contextResult = posted.find((message) => message.id === 5);
    assert.equal(contextResult.ok, true);
    assert.equal(contextResult.result.token_estimate, 42);

    await messageHandler({
      type: 'rpc',
      id: 6,
      method: 'graphCapabilities',
      params: { projectId: 'project-1' },
    });
    const capabilities = posted.find((message) => message.id === 6);
    assert.equal(capabilities.ok, true);
    assert.equal(capabilities.result.node_counts.file, 2);

    await messageHandler({
      type: 'rpc',
      id: 7,
      method: 'graphStructure',
      params: { projectId: 'project-1', pathPrefix: '', limit: 80 },
    });
    const structure = posted.find((message) => message.id === 7);
    assert.equal(structure.ok, true);
    assert.equal(structure.result.files[0].node_id, 'file-1');

    await messageHandler({
      type: 'rpc',
      id: 8,
      method: 'graphSearch',
      params: { projectId: 'project-1', query: 'search nodes', nodeTypes: 'function,class' },
    });
    const graphSearch = posted.find((message) => message.id === 8);
    assert.equal(graphSearch.ok, true);
    assert.equal(graphSearch.result.results[0].title, 'search_nodes');

    await messageHandler({
      type: 'rpc',
      id: 9,
      method: 'node',
      params: { projectId: 'project-1', nodeId: 'node-1' },
    });
    const nodeResult = posted.find((message) => message.id === 9);
    assert.equal(nodeResult.ok, true);
    assert.equal(nodeResult.result.node.title, 'search_nodes');

    await messageHandler({
      type: 'rpc',
      id: 10,
      method: 'graphNeighbors',
      params: {
        projectId: 'project-1',
        nodeId: 'node-1',
        depth: 1,
        direction: 'both',
        relationTypes: 'CALLS',
      },
    });
    const neighbors = posted.find((message) => message.id === 10);
    assert.equal(neighbors.ok, true);
    assert.equal(neighbors.result.nodes[0].node_id, 'node-2');

    const graphRequest = requestLog.find(
      (item) => item.path === '/api/v1/projects/project-1/graph/capabilities',
    );
    assert.equal(graphRequest.authorization, 'Bearer ' + TOKEN);
    assert.equal(graphRequest.url.includes(TOKEN), false);

    await messageHandler({
      type: 'rpc',
      id: 3,
      method: 'openPath',
      params: { path: '../outside.txt', line: 1 },
    });
    const escape = posted.find((message) => message.id === 3);
    assert.equal(escape.ok, false);
    assert.equal(escape.error.code, 'INVALID_PATH');

    await messageHandler({
      type: 'rpc',
      id: 4,
      method: 'openPath',
      params: { path: 'C:\\Windows\\win.ini', line: 1 },
    });
    const absolute = posted.find((message) => message.id === 4);
    assert.equal(absolute.ok, false);
    assert.equal(absolute.error.code, 'INVALID_PATH');
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
  }
});
