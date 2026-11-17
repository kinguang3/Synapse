(function () {
  'use strict';

  var core = window.SynapseSidebarCore;
  var vscode = acquireVsCodeApi();
  var state = core.createState();
  var pending = new Map();
  var sequence = 0;
  var currentTab = 'search';
  var memoryLoadedFor = '';
  var busy = false;
  var transientStatus = '';
  var noticeTimer = null;
  var persisted = vscode.getState() || {};

  function byId(id) {
    return document.getElementById(id);
  }

  var elements = {
    connection: byId('connection'),
    connectionDot: byId('connection-dot'),
    connectionText: byId('connection-text'),
    projectSelect: byId('project-select'),
    refreshButton: byId('refresh-button'),
    tabs: Array.prototype.slice.call(document.querySelectorAll('.tab')),
    panels: Array.prototype.slice.call(document.querySelectorAll('.panel')),
    searchForm: byId('search-form'),
    searchQuery: byId('search-query'),
    searchMode: byId('search-mode'),
    searchMeta: byId('search-meta'),
    searchResults: byId('search-results'),
    searchButton: byId('search-form').querySelector('button'),
    memoryForm: byId('memory-form'),
    memoryQuery: byId('memory-query'),
    memoryType: byId('memory-type'),
    memoryMeta: byId('memory-meta'),
    memoryResults: byId('memory-results'),
    memoryButton: byId('memory-form').querySelector('button'),
    memoryPager: byId('memory-pager'),
    memoryPrev: byId('memory-prev'),
    memoryNext: byId('memory-next'),
    memoryRange: byId('memory-range'),
    memoryDetail: byId('memory-detail'),
    memoryDetailBody: byId('memory-detail-body'),
    memoryBack: byId('memory-back'),
    contextForm: byId('context-form'),
    contextQuery: byId('context-query'),
    contextBudget: byId('context-budget'),
    contextMeta: byId('context-meta'),
    contextOutput: byId('context-output'),
    contextButton: byId('context-form').querySelector('button'),
    notice: byId('notice'),
    statusText: byId('status-text'),
    indexButton: byId('index-button'),
    startButton: byId('start-button'),
    tokenButton: byId('token-button'),
    settingsButton: byId('settings-button'),
  };

  function create(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function showNotice(message, level) {
    if (noticeTimer) clearTimeout(noticeTimer);
    elements.notice.textContent = String(message || '');
    elements.notice.className = level === 'error' ? 'notice is-error' : level === 'warning' ? 'notice is-warning' : 'notice';
    elements.notice.hidden = !message;
    if (message) {
      noticeTimer = setTimeout(function () {
        elements.notice.hidden = true;
      }, level === 'error' ? 9000 : 5000);
    }
  }

  function rpc(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = ++sequence;
      var timer = setTimeout(function () {
        pending.delete(id);
        reject({ code: 'UI_TIMEOUT', message: '请求超时' });
      }, timeoutMs || 30000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      vscode.postMessage({ type: 'rpc', id: id, method: method, params: params || {} });
    });
  }

  function handleFailure(error) {
    var code = String((error && error.code) || '');
    var message = core.errorMessage(error);
    if (code === 'UNAUTHENTICATED' || code === 'AUTH_REQUIRED') {
      setConnection('auth-required', message);
    } else if (code === 'SERVICE_UNAVAILABLE' || code === 'TIMEOUT' || code === 'NON_LOOPBACK_SERVER') {
      setConnection('error', message);
    }
    showNotice(message, 'error');
  }

  async function withBusy(label, task) {
    if (busy) return;
    busy = true;
    transientStatus = label;
    renderStatus();
    refreshControls();
    try {
      return await task();
    } catch (error) {
      handleFailure(error);
      return null;
    } finally {
      busy = false;
      transientStatus = '';
      renderStatus();
      refreshControls();
    }
  }

  function defaultStatus() {
    var stats = state.status && state.status.stats;
    if (state.connection === 'connected' && stats) {
      return String(stats.nodes || 0) + ' 节点 · ' + String(stats.relations || 0) + ' 关系 · ' + String(stats.sources || 0) + ' 来源';
    }
    if (state.connection === 'connected') return '已连接';
    return core.connectionLabel(state.connection);
  }

  function renderStatus() {
    elements.statusText.textContent = transientStatus || defaultStatus();
  }

  function setConnection(status, message) {
    state.connection = status || 'error';
    state.connectionMessage = message || '';
    renderConnection();
    renderStatus();
  }

  function renderConnection() {
    var status = state.connection || 'connecting';
    elements.connectionDot.className = 'dot is-' + status;
    var text = core.connectionLabel(status);
    if (state.connectionMessage) text += ' · ' + state.connectionMessage;
    elements.connectionText.textContent = text;
    elements.startButton.hidden = status !== 'offline' && status !== 'error';
    elements.tokenButton.hidden = status !== 'auth-required';
    refreshControls();
  }

  function renderProjects() {
    var fragment = document.createDocumentFragment();
    if (!state.projects.length) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = state.connection === 'connected' ? '没有已注册项目' : '连接后选择项目';
      fragment.appendChild(empty);
    } else {
      state.projects.forEach(function (project) {
        var option = document.createElement('option');
        option.value = String(project.id);
        option.textContent = core.projectLabel(project);
        option.title = String(project.root_path || '');
        fragment.appendChild(option);
      });
    }
    elements.projectSelect.replaceChildren(fragment);
    elements.projectSelect.value = state.projectId;
    refreshControls();
  }

  function refreshControls() {
    var ready = state.connection === 'connected' && Boolean(state.projectId) && !busy;
    elements.projectSelect.disabled = busy || !state.projects.length;
    elements.searchButton.disabled = !ready;
    elements.memoryButton.disabled = !ready;
    elements.contextButton.disabled = !ready;
    elements.indexButton.disabled = !ready;
    elements.refreshButton.disabled = busy;
    elements.startButton.disabled = busy;
    elements.tokenButton.disabled = busy;
    elements.settingsButton.disabled = busy;
    elements.memoryPrev.disabled = busy;
    elements.memoryNext.disabled = busy;
  }

  function clearResults() {
    state.results = [];
    state.memories = [];
    state.memoryTotal = 0;
    state.memoryOffset = 0;
    state.context = null;
    memoryLoadedFor = '';
    elements.searchResults.replaceChildren();
    elements.memoryResults.replaceChildren();
    elements.memoryMeta.textContent = '';
    elements.memoryPager.hidden = true;
    elements.memoryDetail.hidden = true;
    elements.memoryResults.hidden = false;
    elements.contextOutput.hidden = true;
    elements.contextOutput.textContent = '';
    elements.contextMeta.textContent = '';
  }

  function applyBootstrap(data) {
    var payload = data || {};
    var previousProject = state.projectId;
    state.projects = Array.isArray(payload.projects) ? payload.projects : [];
    state.projectId = core.pickProjectId(state.projects, payload.selectedProjectId || previousProject);
    state.status = payload.status || null;
    if (previousProject !== state.projectId) clearResults();
    setConnection(payload.connection || 'error', payload.message || '');
    renderProjects();
    renderStatus();
    if (currentTab === 'memory' && state.connection === 'connected' && state.projectId && memoryLoadedFor !== state.projectId) {
      setTimeout(function () {
        if (!busy) loadMemories(true);
      }, 0);
    }
  }

  async function bootstrap() {
    transientStatus = '连接中…';
    renderStatus();
    refreshControls();
    try {
      var data = await rpc('bootstrap');
      applyBootstrap(data);
    } catch (error) {
      handleFailure(error);
    } finally {
      transientStatus = '';
      renderStatus();
    }
  }

  function renderSearchMeta(meta) {
    var info = meta || {};
    var parts = [];
    if (info.returned !== undefined) parts.push(String(info.returned) + ' 条');
    if (info.took_ms !== undefined) parts.push(String(info.took_ms) + ' ms');
    if (info.mode) parts.push(String(info.mode));
    if (Array.isArray(info.degraded) && info.degraded.length > 0) parts.push('降级');
    elements.searchMeta.textContent = parts.join(' · ');
  }

  function renderSearchResults() {
    var fragment = document.createDocumentFragment();
    if (!state.results.length) {
      fragment.appendChild(create('div', 'empty', '没有搜索结果'));
      elements.searchResults.replaceChildren(fragment);
      return;
    }
    state.results.forEach(function (item, index) {
      var article = create('article', 'result');
      var head = create('div', 'result-head');
      head.appendChild(create('span', 'type-badge', item.node_type || 'node'));
      head.appendChild(create('span', 'score', core.formatScore(item.score)));
      article.appendChild(head);

      var title = create('button', 'result-title', item.title || '(untitled)');
      title.type = 'button';
      title.dataset.act = 'open-search';
      title.dataset.index = String(index);
      article.appendChild(title);

      var location = core.formatLocation(item);
      if (location) article.appendChild(create('div', 'result-path', location));
      var summary = item.snippet || item.summary;
      if (summary) article.appendChild(create('p', 'result-snippet', summary));

      var actions = create('div', 'result-actions');
      var open = create('button', 'secondary', '打开');
      open.type = 'button';
      open.dataset.act = 'open-search';
      open.dataset.index = String(index);
      open.disabled = !item.path;
      actions.appendChild(open);
      var copy = create('button', 'secondary', '复制');
      copy.type = 'button';
      copy.dataset.act = 'copy-search';
      copy.dataset.index = String(index);
      actions.appendChild(copy);
      article.appendChild(actions);
      fragment.appendChild(article);
    });
    elements.searchResults.replaceChildren(fragment);
  }

  function renderMemoryResults() {
    var fragment = document.createDocumentFragment();
    if (!state.memories.length) {
      fragment.appendChild(create('div', 'empty', '没有记忆'));
      elements.memoryResults.replaceChildren(fragment);
      return;
    }
    state.memories.forEach(function (item, index) {
      var article = create('article', 'result');
      var head = create('div', 'result-head');
      head.appendChild(create('span', 'type-badge', item.memory_type || item.node_type || 'memory'));
      head.appendChild(create('span', 'score', core.formatScore(item.salience)));
      article.appendChild(head);

      var title = create('button', 'result-title', item.title || '(untitled)');
      title.type = 'button';
      title.dataset.act = 'open-memory';
      title.dataset.index = String(index);
      article.appendChild(title);
      if (item.summary) article.appendChild(create('p', 'result-snippet', item.summary));
      if (Array.isArray(item.tags) && item.tags.length) {
        var tags = create('div', 'tags');
        item.tags.forEach(function (tag) {
          tags.appendChild(create('span', 'tag', tag));
        });
        article.appendChild(tags);
      }
      fragment.appendChild(article);
    });
    elements.memoryResults.replaceChildren(fragment);
  }

  function renderMemoryPage() {
    elements.memoryMeta.textContent = core.memoryRange(state.memoryOffset, state.memoryLimit, state.memoryTotal);
    elements.memoryRange.textContent = core.memoryRange(state.memoryOffset, state.memoryLimit, state.memoryTotal);
    elements.memoryPager.hidden = state.memoryTotal <= state.memoryLimit && state.memoryOffset === 0;
    elements.memoryPrev.disabled = busy || !core.canPage(state.memoryOffset, state.memoryLimit, state.memoryTotal, 'prev');
    elements.memoryNext.disabled = busy || !core.canPage(state.memoryOffset, state.memoryLimit, state.memoryTotal, 'next');
  }

  function renderMemoryDetail(memory) {
    var fragment = document.createDocumentFragment();
    var title = create('h2', 'detail-title', memory.title || '(untitled)');
    fragment.appendChild(title);
    var metaParts = [];
    if (memory.memory_type) metaParts.push(String(memory.memory_type));
    if (memory.provenance) metaParts.push(String(memory.provenance));
    if (memory.updated_at) metaParts.push(String(memory.updated_at));
    fragment.appendChild(create('div', 'detail-meta', metaParts.join(' · ')));
    if (Array.isArray(memory.tags) && memory.tags.length) {
      var tags = create('div', 'tags');
      memory.tags.forEach(function (tag) {
        tags.appendChild(create('span', 'tag', tag));
      });
      fragment.appendChild(tags);
    }
    var body = memory.content || memory.summary || '';
    fragment.appendChild(create('p', 'detail-body', body));
    var actions = create('div', 'result-actions');
    var copy = create('button', 'secondary', '复制内容');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      copyText(body);
    });
    actions.appendChild(copy);
    fragment.appendChild(actions);
    elements.memoryDetailBody.replaceChildren(fragment);
    elements.memoryDetail.hidden = false;
    elements.memoryResults.hidden = true;
    elements.memoryPager.hidden = true;
  }

  function currentProject() {
    for (var index = 0; index < state.projects.length; index += 1) {
      if (String(state.projects[index].id) === String(state.projectId)) return state.projects[index];
    }
    return null;
  }

  function copyText(text) {
    if (!text) return Promise.resolve();
    return rpc('copy', { text: String(text) }).catch(handleFailure);
  }

  async function copySearchResult(index) {
    var item = state.results[index];
    if (!item) return;
    var parts = [item.title, core.formatLocation(item), item.snippet || item.summary].filter(Boolean);
    await copyText(parts.join('\n'));
  }

  async function openSearchResult(index) {
    var item = state.results[index];
    if (!item || !item.path) return;
    try {
      await rpc('openPath', { path: item.path, line: item.start_line || 1 });
    } catch (error) {
      handleFailure(error);
    }
  }

  async function openMemory(index) {
    var item = state.memories[index];
    if (!item) return;
    try {
      var data = await rpc('memory', { projectId: state.projectId, nodeId: item.node_id });
      renderMemoryDetail(data && data.memory ? data.memory : data);
    } catch (error) {
      handleFailure(error);
    }
  }

  async function search() {
    var query = elements.searchQuery.value.trim();
    if (!query) {
      elements.searchQuery.focus();
      return;
    }
    if (!state.projectId) return;
    await withBusy('搜索中…', async function () {
      var data = await rpc('search', {
        projectId: state.projectId,
        query: query,
        mode: elements.searchMode.value,
      });
      state.results = Array.isArray(data && data.results) ? data.results : [];
      renderSearchResults();
      renderSearchMeta(data && data.meta);
    });
  }

  async function loadMemories(reset) {
    if (!state.projectId) return;
    var offset = reset ? 0 : state.memoryOffset;
    var query = elements.memoryQuery.value.trim();
    var memoryType = elements.memoryType.value;
    await withBusy('加载记忆…', async function () {
      var data = await rpc('memories', {
        projectId: state.projectId,
        query: query,
        memoryType: memoryType,
        offset: offset,
        limit: state.memoryLimit,
      });
      state.memories = Array.isArray(data && data.memories) ? data.memories : [];
      state.memoryTotal = Number((data && data.total) || 0);
      state.memoryOffset = Number((data && data.offset) || offset);
      state.memoryLimit = Number((data && data.limit) || state.memoryLimit);
      memoryLoadedFor = state.projectId;
      elements.memoryDetail.hidden = true;
      elements.memoryResults.hidden = false;
      renderMemoryResults();
      renderMemoryPage();
    });
  }

  async function loadContext() {
    if (!state.projectId) return;
    var budget = Math.max(100, Math.min(20000, Number(elements.contextBudget.value) || 2000));
    elements.contextBudget.value = String(budget);
    await withBusy('构建上下文…', async function () {
      var data = await rpc('context', {
        projectId: state.projectId,
        query: elements.contextQuery.value.trim(),
        maxTokens: budget,
      });
      state.context = data;
      elements.contextOutput.textContent = core.prettyContext(data);
      elements.contextOutput.hidden = false;
      var info = data || {};
      var parts = [];
      if (info.token_estimate !== undefined) parts.push('~' + String(info.token_estimate) + ' tokens');
      parts.push('budget ' + String(budget));
      if (info.truncated) parts.push('已截断');
      elements.contextMeta.textContent = parts.join(' · ');
    });
  }

  async function runIndex() {
    if (!state.projectId) return;
    await withBusy('索引中…', async function () {
      var data = await rpc('index', { projectId: state.projectId }, 180000);
      var stats = data && data.stats ? data.stats : {};
      var parts = [];
      if (stats.indexed !== undefined) parts.push(String(stats.indexed) + ' 已索引');
      if (stats.updated !== undefined) parts.push(String(stats.updated) + ' 更新');
      if (stats.removed !== undefined) parts.push(String(stats.removed) + ' 移除');
      showNotice(parts.length ? '索引完成：' + parts.join(' · ') : '索引完成');
      var status = await rpc('status', { projectId: state.projectId });
      state.status = status;
      renderStatus();
    });
  }

  async function startServer() {
    await withBusy('启动服务…', async function () {
      var data = await rpc('startServer', {}, 60000);
      applyBootstrap(data);
      if (data && data.connection === 'connected') {
        showNotice('本地服务已启动');
      } else if (data && data.message) {
        showNotice(data.message, 'error');
      }
    });
  }

  async function setToken() {
    await withBusy('等待令牌…', async function () {
      var data = await rpc('setToken', {}, 60000);
      if (data && data.cancelled) return;
      applyBootstrap(data);
      if (data && data.connection === 'connected') showNotice('令牌已保存');
    });
  }

  async function openSettings() {
    try {
      await rpc('openSettings');
    } catch (error) {
      handleFailure(error);
    }
  }

  function switchTab(tab) {
    currentTab = tab || 'search';
    elements.tabs.forEach(function (button) {
      var active = button.dataset.tab === currentTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    elements.panels.forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== currentTab;
    });
    persisted.tab = currentTab;
    vscode.setState(persisted);
    if (currentTab === 'memory' && state.projectId && memoryLoadedFor !== state.projectId && !busy) {
      loadMemories(true);
    }
  }

  elements.refreshButton.addEventListener('click', bootstrap);
  elements.startButton.addEventListener('click', startServer);
  elements.tokenButton.addEventListener('click', setToken);
  elements.settingsButton.addEventListener('click', openSettings);
  elements.indexButton.addEventListener('click', runIndex);

  elements.tabs.forEach(function (button) {
    button.addEventListener('click', function () {
      switchTab(button.dataset.tab);
    });
  });

  elements.projectSelect.addEventListener('change', function () {
    state.projectId = elements.projectSelect.value;
    clearResults();
    transientStatus = '切换项目…';
    renderStatus();
    rpc('selectProject', { projectId: state.projectId })
      .then(function (data) {
        state.status = data && data.status ? data.status : null;
        renderStatus();
        if (currentTab === 'memory' && state.projectId) loadMemories(true);
      })
      .catch(handleFailure)
      .finally(function () {
        transientStatus = '';
        renderStatus();
      });
  });

  elements.searchForm.addEventListener('submit', function (event) {
    event.preventDefault();
    search();
  });

  elements.memoryForm.addEventListener('submit', function (event) {
    event.preventDefault();
    loadMemories(true);
  });

  elements.contextForm.addEventListener('submit', function (event) {
    event.preventDefault();
    loadContext();
  });

  elements.memoryPrev.addEventListener('click', function () {
    if (!core.canPage(state.memoryOffset, state.memoryLimit, state.memoryTotal, 'prev')) return;
    state.memoryOffset = Math.max(0, state.memoryOffset - state.memoryLimit);
    loadMemories(false);
  });

  elements.memoryNext.addEventListener('click', function () {
    if (!core.canPage(state.memoryOffset, state.memoryLimit, state.memoryTotal, 'next')) return;
    state.memoryOffset += state.memoryLimit;
    loadMemories(false);
  });

  elements.memoryBack.addEventListener('click', function () {
    elements.memoryDetail.hidden = true;
    elements.memoryResults.hidden = false;
    renderMemoryPage();
  });

  elements.searchResults.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-act]');
    if (!button) return;
    var index = Number(button.dataset.index);
    if (button.dataset.act === 'open-search') openSearchResult(index);
    if (button.dataset.act === 'copy-search') copySearchResult(index);
  });

  elements.memoryResults.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-act]');
    if (!button) return;
    if (button.dataset.act === 'open-memory') openMemory(Number(button.dataset.index));
  });

  window.addEventListener('message', function (event) {
    var message = event.data || {};
    if (message.type === 'rpcResult') {
      var entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(message.error || { message: '请求失败' });
      return;
    }
    if (message.type === 'event') {
      if (message.event === 'connection') {
        setConnection(message.connection, message.message);
      } else if (message.event === 'notice') {
        showNotice(message.message, message.level);
      } else if (message.event === 'bootstrap') {
        applyBootstrap(message.data);
      }
    }
  });

  renderConnection();
  renderProjects();
  renderStatus();
  switchTab(core.tabFromHash(location.hash) || persisted.tab || 'search');
  bootstrap();
})();
