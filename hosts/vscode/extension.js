'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const vscode = require('vscode');

const sidebarCore = require('../shared/sidebar/sidebar_core');
const { GuiClient, GuiError, normalizeBaseUrl } = require('./gui_client');
const { buildWebviewHtml } = require('./webview_html');

const TOKEN_KEY = 'synapse.companion.token';
const PROJECT_KEY = 'synapse.companion.projectId';
const VIEW_ID = 'synapse.companion.sidebar';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthError(error) {
  return Boolean(error && (error.status === 401 || error.code === 'UNAUTHENTICATED'));
}

function isUnavailableError(error) {
  return Boolean(
    error &&
      (error.code === 'SERVICE_UNAVAILABLE' ||
        error.code === 'TIMEOUT' ||
        error.code === 'FETCH_UNAVAILABLE'),
  );
}

function serializeError(error) {
  if (error instanceof GuiError) {
    return {
      message: error.message,
      code: error.code,
      status: error.status,
    };
  }
  return {
    message: String((error && error.message) || error || '未知错误'),
    code: String((error && error.code) || 'HOST_ERROR'),
    status: Number((error && error.status) || 0),
  };
}

function authError() {
  return new GuiError('需要本地服务访问令牌', { status: 401, code: 'UNAUTHENTICATED' });
}

class CompanionController {
  constructor(context, output) {
    this.extensionContext = context;
    this.output = output;
    this.projects = [];
    this.activeProjectId = '';
    this.serverProcess = null;
    this.serverExit = null;
    this.serverError = null;
    this.serverLog = [];
  }

  configuration() {
    return vscode.workspace.getConfiguration('synapse');
  }

  requestTimeout() {
    const value = Number(this.configuration().get('requestTimeoutMs', 15000));
    return Math.max(1000, Math.min(120000, value));
  }

  serverUrl() {
    return normalizeBaseUrl(this.configuration().get('serverUrl', 'http://127.0.0.1:8765'));
  }

  async getToken() {
    return String((await this.extensionContext.secrets.get(TOKEN_KEY)) || '');
  }

  async ensureToken() {
    let token = await this.getToken();
    if (!token) {
      token = crypto.randomBytes(32).toString('base64url');
      await this.extensionContext.secrets.store(TOKEN_KEY, token);
    }
    return token;
  }

  async makeClient(token) {
    const resolved = token === undefined ? await this.getToken() : token;
    return new GuiClient({
      baseUrl: this.serverUrl(),
      token: resolved,
      timeoutMs: this.requestTimeout(),
    });
  }

  async readyClient() {
    const token = await this.getToken();
    if (!token) throw authError();
    return this.makeClient(token);
  }

  async probe(baseUrl) {
    try {
      const client = new GuiClient({
        baseUrl: baseUrl || this.serverUrl(),
        token: '',
        timeoutMs: 2000,
      });
      await client.health();
      return true;
    } catch (error) {
      if (error && (error.code === 'INVALID_SERVER_URL' || error.code === 'NON_LOOPBACK_SERVER')) {
        throw error;
      }
      return false;
    }
  }

  normalizePath(value) {
    const resolved = path.resolve(String(value || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  resolveSelectedProject(projects) {
    const saved = String(this.extensionContext.workspaceState.get(PROJECT_KEY, '') || '');
    let workspaceMatch = '';
    const folders = vscode.workspace.workspaceFolders || [];
    for (const folder of folders) {
      const folderPath = this.normalizePath(folder.uri.fsPath);
      const match = projects.find(
        (project) => this.normalizePath(project.root_path) === folderPath,
      );
      if (match) {
        workspaceMatch = String(match.id);
        break;
      }
    }
    return sidebarCore.pickProjectId(
      projects,
      saved || workspaceMatch || this.activeProjectId,
    );
  }

  connectionError(error) {
    if (isAuthError(error)) {
      return {
        connection: 'auth-required',
        message: '访问令牌无效或已变更',
        projects: this.projects,
        selectedProjectId: this.activeProjectId,
      };
    }
    if (isUnavailableError(error)) {
      return {
        connection: 'offline',
        message: '本地 Synapse 服务未运行',
        projects: this.projects,
        selectedProjectId: this.activeProjectId,
      };
    }
    return {
      connection: 'error',
      message: String((error && error.message) || '连接失败'),
      projects: this.projects,
      selectedProjectId: this.activeProjectId,
    };
  }

  async connect(options) {
    const opts = options || {};
    try {
      const baseUrl = this.serverUrl();
      let healthy = await this.probe(baseUrl);
      if (!healthy && opts.allowStart && this.configuration().get('autoStartServer', false)) {
        try {
          await this.ensureServer();
          healthy = await this.probe(baseUrl);
        } catch (error) {
          return this.connectionError(error);
        }
      }
      if (!healthy) {
        return {
          connection: 'offline',
          message: '本地 Synapse 服务未运行',
          projects: this.projects,
          selectedProjectId: this.activeProjectId,
        };
      }

      const token = await this.getToken();
      if (!token) {
        return {
          connection: 'auth-required',
          message: '尚未保存访问令牌',
          projects: this.projects,
          selectedProjectId: this.activeProjectId,
        };
      }

      const client = await this.makeClient(token);
      const projects = await client.projects();
      const selectedProjectId = this.resolveSelectedProject(projects);
      this.projects = projects;
      this.activeProjectId = selectedProjectId;
      if (selectedProjectId) {
        await this.extensionContext.workspaceState.update(PROJECT_KEY, selectedProjectId);
      }

      let status = null;
      if (selectedProjectId) {
        try {
          status = await client.projectStatus(selectedProjectId);
        } catch (error) {
          if (isAuthError(error) || isUnavailableError(error)) throw error;
          this.output.appendLine(`Status unavailable: ${String(error.message || error)}`);
        }
      }

      return {
        connection: 'connected',
        message: '',
        projects,
        selectedProjectId,
        status,
      };
    } catch (error) {
      return this.connectionError(error);
    }
  }

  async bootstrap() {
    return this.connect({ allowStart: true });
  }

  async resolvePython() {
    const configured = String(this.configuration().get('pythonPath', '') || '').trim();
    if (configured) return configured;
    const fromEnvironment = String(process.env.SYNAPSE_PYTHON || '').trim();
    if (fromEnvironment) return fromEnvironment;

    const folders = vscode.workspace.workspaceFolders || [];
    const candidates = [
      path.join('.venv', 'Scripts', 'python.exe'),
      path.join('.venv', 'bin', 'python'),
      path.join('venv', 'Scripts', 'python.exe'),
      path.join('venv', 'bin', 'python'),
    ];
    for (const folder of folders) {
      for (const candidate of candidates) {
        const fullPath = path.join(folder.uri.fsPath, candidate);
        if (fs.existsSync(fullPath)) return fullPath;
      }
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  redact(value, token) {
    const text = String(value || '');
    return token ? text.split(token).join('[redacted]') : text;
  }

  captureServerLine(chunk, token) {
    const lines = String(chunk || '')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    for (const line of lines) {
      const safe = this.redact(line, token);
      this.serverLog.push(safe);
      if (this.serverLog.length > 20) this.serverLog.shift();
      this.output.appendLine(`[server] ${safe}`);
    }
  }

  async ensureServer() {
    if (await this.probe()) return false;

    if (this.serverProcess) {
      if (await this.waitForHealth(20)) return true;
      try {
        this.serverProcess.kill();
      } catch (error) {
        this.output.appendLine(`Failed to stop stale server: ${String(error)}`);
      }
      this.serverProcess = null;
    }

    const token = await this.ensureToken();
    const baseUrl = this.serverUrl();
    const python = await this.resolvePython();
    const port = baseUrl.port || (baseUrl.protocol === 'https:' ? '443' : '80');
    const host = baseUrl.hostname.replace(/^\[|\]$/g, '');
    const args = [
      '-m',
      'synapse.integrations.gui',
      '--host',
      host,
      '--port',
      port,
      '--no-access-log',
    ];

    this.output.appendLine(`Starting Synapse service with ${python}`);
    this.serverLog = [];
    this.serverExit = null;
    this.serverError = null;
    let child;
    try {
      child = spawn(python, args, {
        cwd: (vscode.workspace.workspaceFolders || [])[0]
          ? (vscode.workspace.workspaceFolders || [])[0].uri.fsPath
          : undefined,
        env: Object.assign({}, process.env, {
          SYNAPSE_GUI_TOKEN: token,
          PYTHONUNBUFFERED: '1',
        }),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new GuiError(`无法启动 Python：${String(error.message || error)}`, {
        code: 'SERVICE_START_FAILED',
      });
    }

    this.serverProcess = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.captureServerLine(chunk, token));
    child.stderr.on('data', (chunk) => this.captureServerLine(chunk, token));
    child.once('error', (error) => {
      this.serverError = error;
      this.output.appendLine(`[server] ${String(error.message || error)}`);
    });
    child.once('exit', (code, signal) => {
      this.serverExit = { code, signal };
      this.output.appendLine(`[server] exited code=${code} signal=${signal || ''}`);
      if (this.serverProcess === child) this.serverProcess = null;
    });

    const ready = await this.waitForHealth(60);
    if (!ready) {
      const detail = this.serverLog.length ? `：${this.serverLog[this.serverLog.length - 1]}` : '';
      try {
        child.kill();
      } catch (error) {
        this.output.appendLine(`Failed to stop failed server: ${String(error)}`);
      }
      throw new GuiError(`本地服务启动失败${detail}`, { code: 'SERVICE_START_FAILED' });
    }
    this.output.appendLine('Synapse service is ready');
    return true;
  }

  async waitForHealth(attempts) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await this.probe()) return true;
      if (this.serverError || this.serverExit) return false;
      await delay(250);
    }
    return false;
  }

  async startServer() {
    try {
      await this.ensureServer();
      return this.connect({ allowStart: false });
    } catch (error) {
      return this.connectionError(error);
    }
  }

  async setToken() {
    const token = await vscode.window.showInputBox({
      title: 'Synapse Companion',
      prompt: '输入本地 Synapse 服务访问令牌，留空可清除',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'SYNAPSE_GUI_TOKEN',
    });
    if (token === undefined) {
      return {
        cancelled: true,
        connection: 'auth-required',
        projects: this.projects,
        selectedProjectId: this.activeProjectId,
      };
    }
    const trimmed = token.trim();
    if (trimmed) await this.extensionContext.secrets.store(TOKEN_KEY, trimmed);
    else await this.extensionContext.secrets.delete(TOKEN_KEY);
    return this.connect({ allowStart: false });
  }

  requireProject(projectId) {
    const requested = String(projectId || this.activeProjectId || '');
    if (!requested) throw new GuiError('尚未选择项目', { code: 'PROJECT_NOT_SELECTED' });
    if (
      this.projects.length &&
      !this.projects.some((project) => String(project.id) === requested)
    ) {
      throw new GuiError('项目不存在或尚未加载', { code: 'PROJECT_NOT_AVAILABLE' });
    }
    return requested;
  }

  async search(params) {
    const projectId = this.requireProject(params.projectId);
    const query = String(params.query || '').trim();
    if (!query) throw new GuiError('搜索词不能为空', { code: 'INVALID_ARGUMENT' });
    const client = await this.readyClient();
    return client.search(projectId, query, {
      mode: String(params.mode || 'hybrid'),
      limit: 20,
    });
  }

  async memories(params) {
    const projectId = this.requireProject(params.projectId);
    const client = await this.readyClient();
    const limit = Math.max(1, Math.min(100, Number(params.limit || 20)));
    const offset = Math.max(0, Number(params.offset || 0));
    return client.memories(projectId, {
      query: String(params.query || '').trim(),
      memoryType: String(params.memoryType || ''),
      limit,
      offset,
    });
  }

  async memory(params) {
    const projectId = this.requireProject(params.projectId);
    const nodeId = String(params.nodeId || '');
    if (!nodeId) throw new GuiError('缺少记忆标识', { code: 'INVALID_ARGUMENT' });
    const client = await this.readyClient();
    return client.memory(projectId, nodeId);
  }

  async context(params) {
    const projectId = this.requireProject(params.projectId);
    const client = await this.readyClient();
    return client.context(projectId, {
      query: String(params.query || '').trim(),
      maxTokens: Math.max(100, Math.min(20000, Number(params.maxTokens || 2000))),
    });
  }

  async graphCapabilities(params) {
    const projectId = this.requireProject(params.projectId);
    const client = await this.readyClient();
    return client.graphCapabilities(projectId);
  }

  async graphStructure(params) {
    const projectId = this.requireProject(params.projectId);
    const client = await this.readyClient();
    return client.graphStructure(projectId, {
      pathPrefix: String(params.pathPrefix || ''),
      limit: Math.max(1, Math.min(500, Number(params.limit || 200))),
    });
  }

  async graphOverview(params) {
    const projectId = this.requireProject(params.projectId);
    const client = await this.readyClient();
    return client.graphOverview(projectId, {
      maxNodes: Math.max(1, Math.min(200, Number(params.maxNodes || 80))),
      nodeTypes: String(params.nodeTypes || ''),
      relationTypes: String(params.relationTypes || ''),
    });
  }

  async graphNode(params) {
    const projectId = this.requireProject(params.projectId);
    const nodeId = String(params.nodeId || '');
    if (!nodeId) throw new GuiError('缺少节点标识', { code: 'INVALID_ARGUMENT' });
    const client = await this.readyClient();
    return client.node(projectId, nodeId);
  }

  async graphNeighbors(params) {
    const projectId = this.requireProject(params.projectId);
    const nodeId = String(params.nodeId || '');
    if (!nodeId) throw new GuiError('缺少节点标识', { code: 'INVALID_ARGUMENT' });
    const client = await this.readyClient();
    return client.graphNeighbors(projectId, nodeId, {
      depth: Math.max(0, Math.min(3, Number(params.depth == null ? 1 : params.depth))),
      direction: String(params.direction || 'both'),
      relationTypes: String(params.relationTypes || ''),
      nodeTypes: String(params.nodeTypes || ''),
      limit: Math.max(1, Math.min(200, Number(params.limit || 50))),
    });
  }

  async graphSearch(params) {
    const projectId = this.requireProject(params.projectId);
    const query = String(params.query || '').trim();
    if (!query) throw new GuiError('搜索词不能为空', { code: 'INVALID_ARGUMENT' });
    const client = await this.readyClient();
    return client.search(projectId, query, {
      mode: 'hybrid',
      nodeTypes: String(params.nodeTypes || ''),
      limit: Math.max(1, Math.min(50, Number(params.limit || 20))),
    });
  }

  async index(params) {
    const projectId = this.requireProject(params.projectId);
    const client = await this.readyClient();
    this.output.appendLine(`Indexing project ${projectId}`);
    return client.index(projectId, Boolean(params.full));
  }

  async status(params) {
    const projectId = this.requireProject(params.projectId);
    const client = await this.readyClient();
    return client.projectStatus(projectId);
  }

  async selectProject(params) {
    const projectId = this.requireProject(params.projectId);
    this.activeProjectId = projectId;
    await this.extensionContext.workspaceState.update(PROJECT_KEY, projectId);
    if (!(await this.probe())) return { status: null };
    if (!(await this.getToken())) return { status: null };
    const client = await this.readyClient();
    return { status: await client.projectStatus(projectId) };
  }

  async openPath(params) {
    const relativePath = String(params.path || '');
    if (!relativePath || relativePath.includes('\0')) {
      throw new GuiError('文件路径无效', { code: 'INVALID_ARGUMENT' });
    }
    if (path.isAbsolute(relativePath)) {
      throw new GuiError('只允许打开项目内相对路径', { code: 'INVALID_PATH' });
    }
    const project = this.projects.find(
      (item) => String(item.id) === String(this.activeProjectId),
    );
    if (!project || !project.root_path) {
      throw new GuiError('尚未选择可打开的文件所属项目', { code: 'PROJECT_NOT_SELECTED' });
    }

    const root = path.resolve(String(project.root_path));
    const target = path.resolve(root, relativePath);
    const rootReal = await fs.promises.realpath(root).catch(() => root);
    const targetReal = await fs.promises.realpath(target).catch(() => target);
    const relative = path.relative(rootReal, targetReal);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new GuiError('文件路径超出项目根目录', { code: 'INVALID_PATH' });
    }
    if (!fs.existsSync(targetReal)) {
      throw new GuiError('文件不存在或尚未索引', { code: 'FILE_NOT_FOUND' });
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetReal));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const requestedLine = Math.max(0, Number(params.line || 1) - 1);
    const line = Math.min(requestedLine, Math.max(0, document.lineCount - 1));
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    return { opened: targetReal };
  }

  async copy(params) {
    const text = String(params.text || '');
    if (text) await vscode.env.clipboard.writeText(text);
    return { copied: Boolean(text) };
  }

  async openSettings() {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:synapse-local.synapse-companion',
    );
  }

  async handle(method, params) {
    switch (method) {
      case 'bootstrap':
        return this.bootstrap();
      case 'selectProject':
        return this.selectProject(params);
      case 'status':
        return this.status(params);
      case 'search':
        return this.search(params);
      case 'memories':
        return this.memories(params);
      case 'memory':
        return this.memory(params);
      case 'context':
        return this.context(params);
      case 'graphCapabilities':
        return this.graphCapabilities(params);
      case 'graphStructure':
        return this.graphStructure(params);
      case 'graphOverview':
        return this.graphOverview(params);
      case 'graphNode':
      case 'node':
        return this.graphNode(params);
      case 'graphNeighbors':
        return this.graphNeighbors(params);
      case 'graphSearch':
        return this.graphSearch(params);
      case 'index':
        return this.index(params);
      case 'openPath':
        return this.openPath(params);
      case 'copy':
        return this.copy(params);
      case 'startServer':
        return this.startServer();
      case 'setToken':
        return this.setToken();
      case 'openSettings':
        return this.openSettings();
      default:
        throw new GuiError(`未知请求：${String(method)}`, { code: 'UNKNOWN_METHOD' });
    }
  }

  dispose() {
    if (this.serverProcess) {
      try {
        this.serverProcess.kill();
      } catch (error) {
        this.output.appendLine(`Failed to stop service: ${String(error)}`);
      }
      this.serverProcess = null;
    }
  }
}

class SidebarViewProvider {
  constructor(extensionUri, controller) {
    this.extensionUri = extensionUri;
    this.controller = controller;
    this.view = null;
    this.messageDisposable = null;
  }

  post(message) {
    if (this.view) return this.view.webview.postMessage(message);
    return Promise.resolve(false);
  }

  async resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'shared'),
        vscode.Uri.joinPath(this.extensionUri, 'vscode', 'media'),
      ],
    };

    const nonce = crypto.randomBytes(16).toString('hex');
    const resource = (...parts) =>
      view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...parts));

    view.webview.html = buildWebviewHtml({
      cspSource: view.webview.cspSource,
      nonce,
      coreUri: resource('shared', 'sidebar', 'sidebar_core.js'),
      graphCoreUri: resource('shared', 'sidebar', 'sidebar_graph_core.js'),
      graphUri: resource('shared', 'sidebar', 'sidebar_graph.js'),
      sidebarUri: resource('shared', 'sidebar', 'sidebar.js'),
      styleUri: resource('shared', 'sidebar', 'sidebar.css'),
    });

    this.messageDisposable = view.webview.onDidReceiveMessage(async (message) => {
      if (!message || message.type !== 'rpc') return;
      try {
        const result = await this.controller.handle(message.method, message.params || {});
        this.post({ type: 'rpcResult', id: message.id, ok: true, result });
      } catch (error) {
        this.post({
          type: 'rpcResult',
          id: message.id,
          ok: false,
          error: serializeError(error),
        });
      }
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });

    view.onDidDispose(() => {
      if (this.messageDisposable) this.messageDisposable.dispose();
      this.messageDisposable = null;
      this.view = null;
    });
  }

  async refresh() {
    const data = await this.controller.bootstrap();
    await this.post({ type: 'event', event: 'bootstrap', data });
    return data;
  }
}

async function focusSidebar() {
  try {
    await vscode.commands.executeCommand('synapse.companion.sidebar.focus');
  } catch (error) {
    await vscode.commands.executeCommand('workbench.view.extension.synapseSidebar');
  }
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Synapse Companion');
  const controller = new CompanionController(context, output);
  const provider = new SidebarViewProvider(context.extensionUri, controller);

  context.subscriptions.push(output);
  context.subscriptions.push(controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('synapse.companion.focus', focusSidebar),
    vscode.commands.registerCommand('synapse.companion.refresh', async () => {
      const data = await provider.refresh();
      if (data && data.connection !== 'connected' && data.message) {
        vscode.window.showWarningMessage(`Synapse: ${data.message}`);
      }
    }),
    vscode.commands.registerCommand('synapse.companion.startServer', async () => {
      const data = await controller.startServer();
      await provider.post({ type: 'event', event: 'bootstrap', data });
      if (data.connection === 'connected') {
        vscode.window.showInformationMessage('Synapse 本地服务已启动');
      } else if (data.message) {
        vscode.window.showErrorMessage(`Synapse: ${data.message}`);
      }
    }),
    vscode.commands.registerCommand('synapse.companion.setToken', async () => {
      const data = await controller.setToken();
      if (data.cancelled) return;
      await provider.post({ type: 'event', event: 'bootstrap', data });
      if (data.connection === 'connected') {
        vscode.window.showInformationMessage('Synapse 访问令牌已保存');
      } else if (data.message) {
        vscode.window.showWarningMessage(`Synapse: ${data.message}`);
      }
    }),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
