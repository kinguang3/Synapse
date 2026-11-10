'use strict';

/* Synapse GUI — a read-only window into the local project knowledge base.
   Every request goes through the local Core worker API; no SQLite access here. */

const API = '/api/v1';

const NODE_COLORS = {
  project: '#fafafa',
  file: '#d4d4d8',
  class: '#e4e4e7',
  function: '#fafafa',
  method: '#a1a1aa',
  document: '#d4d4d8',
  doc_section: '#71717a',
  memory: '#f4f4f5',
  note: '#9ca3af',
};

const NODE_TYPES = ['file', 'class', 'function', 'method', 'document', 'doc_section', 'memory', 'note'];
const RELATION_TYPES = [
  'CONTAINS', 'IMPORTS', 'CALLS', 'INHERITS', 'REFERENCES',
  'EXPLAINS', 'DEPENDS_ON', 'RELATED_TO', 'DERIVED_FROM',
  'SOLVES', 'CONTRADICTS', 'MENTIONS',
];
const MEMORY_TYPES = ['fact', 'experience', 'decision', 'preference', 'summary'];
const MEMORY_LABELS = {
  fact: '事实', experience: '经验', decision: '决策', preference: '偏好', summary: '摘要',
};
const REASON_LABELS = {
  query_match: 'query match',
  cross_module_links: 'cross-module',
  salience: 'salience',
};

const state = {
  token: '',
  projects: [],
  projectId: null,
  project: null,
  route: 'overview',
  cleanup: null,
  pendingFocus: null,
  graph: null,
  graphFilter: {
    types: new Set(['file', 'class', 'function', 'method', 'document', 'doc_section', 'memory']),
    relation: '',
    maxNodes: 80,
  },
  graphPositions: {},
  overview: null,
  memory: { type: '', q: '', selected: null },
  search: { last: null },
};

const view = document.getElementById('view');
const inspector = document.getElementById('inspector');
const inspectorBody = document.getElementById('inspector-body');
const toastEl = document.getElementById('toast');
const tokenModal = document.getElementById('token-modal');
const tokenInput = document.getElementById('token-input');
const connState = document.getElementById('conn-state');
const connText = document.getElementById('conn-text');
const indexPill = document.getElementById('index-pill');
const projectSelect = document.getElementById('project-select');
const projectMeta = document.getElementById('project-meta');
const crumbProject = document.getElementById('crumb-project');
const crumbView = document.getElementById('crumb-view');

/* ------------------------------------------------------------------ utils */

const $ = (selector, root = document) => root.querySelector(selector);

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(name, cls = '') {
  return `<svg class="${cls}"><use href="#${name}"/></svg>`;
}

function fmtInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtRel(iso) {
  if (!iso) return 'never';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const seconds = Math.max(0, (Date.now() - d) / 1000);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return fmtDate(iso);
}

function typeBadge(type) {
  const t = String(type || 'other');
  return `<span class="type-badge type-${esc(t)}"><span class="swatch"></span>${esc(t)}</span>`;
}

function reasonBadge(reason) {
  const label = REASON_LABELS[reason] || reason;
  return `<span class="reason ${esc(reason)}">${esc(label)}</span>`;
}

function highlight(text) {
  return esc(text).replace(/\[([^\]]*)\]/g, '<mark>$1</mark>');
}

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function copyText(text) {
  const done = () => toast('已复制到剪贴板');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => toast('复制失败', true));
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    done();
  } catch (err) {
    toast('复制失败', true);
  }
  area.remove();
}

let toastTimer = null;
function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('err', !!isError);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function emptyState(title, detail) {
  return `<div class="empty"><div class="big">${esc(title)}</div><div>${detail || ''}</div></div>`;
}

function loadingPanels() {
  return `
    <div class="grid kpi">
      ${[0, 1, 2, 3].map(() => `<div class="panel kpi-card"><div class="skeleton" style="width:56%"></div><div class="skeleton" style="width:38%;height:24px;margin-top:10px"></div></div>`).join('')}
    </div>
    <div class="panel" style="padding:16px"><div class="skeleton" style="width:30%"></div><div class="skeleton" style="width:100%;height:120px;margin-top:14px"></div></div>`;
}

/* -------------------------------------------------------------------- api */

function readToken() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('token');
  if (fromQuery) {
    sessionStorage.setItem('synapse.token', fromQuery);
    params.delete('token');
    const search = params.toString();
    history.replaceState(null, '', location.pathname + (search ? `?${search}` : '') + location.hash);
  }
  return sessionStorage.getItem('synapse.token') || '';
}

async function api(path, { params, method = 'GET', body } = {}) {
  const url = new URL(API + path, location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, value);
    }
  }
  const headers = { Authorization: `Bearer ${state.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    openTokenModal('令牌无效或已过期，请重新输入。');
    throw new Error('UNAUTHENTICATED');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (!res.ok) {
    const message = data && data.error && data.error.message
      ? data.error.message
      : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data;
}

/* ---------------------------------------------------------------- session */

async function connect() {
  setConnection('pending');
  try {
    const data = await api('/projects');
    state.projects = data.projects || [];
    setConnection('ok');
    fillProjectSelect();
    if (!state.projects.length) {
      renderOnboarding();
      return;
    }
    const saved = localStorage.getItem('synapse.project');
    const fallback = state.projects[0].id;
    state.projectId = state.projects.some((p) => p.id === saved) ? saved : fallback;
    localStorage.setItem('synapse.project', state.projectId);
    state.project = state.projects.find((p) => p.id === state.projectId) || null;
    syncProjectChrome();
    await onRoute();
  } catch (err) {
    if (err.message !== 'UNAUTHENTICATED') {
      setConnection('err');
      view.innerHTML = `<div class="error-box">无法连接本地 GUI API：${esc(err.message)}</div>`;
    }
  }
}

function setConnection(status) {
  connState.classList.remove('ok', 'err');
  if (status === 'ok') {
    connState.classList.add('ok');
    connText.textContent = 'LOCAL · CONNECTED';
  } else if (status === 'pending') {
    connText.textContent = 'CONNECTING…';
  } else {
    connState.classList.add('err');
    connText.textContent = 'DISCONNECTED';
  }
}

function fillProjectSelect() {
  projectSelect.innerHTML = state.projects
    .map((project) => `<option value="${esc(project.id)}">${esc(project.name)}</option>`)
    .join('');
  if (state.projectId) projectSelect.value = state.projectId;
}

function syncProjectChrome() {
  const project = state.project;
  if (!project) {
    projectMeta.textContent = '未选择项目';
    crumbProject.textContent = '—';
    return;
  }
  projectSelect.value = project.id;
  projectMeta.textContent = project.root_path;
  projectMeta.title = project.root_path;
  crumbProject.textContent = project.name;
  updateIndexPill();
}

function updateIndexPill() {
  const project = state.project;
  if (!project) {
    indexPill.className = 'pill none';
    indexPill.textContent = 'NO PROJECT';
    return;
  }
  const indexed = project.last_indexed_at;
  if (!indexed) {
    indexPill.className = 'pill none';
    indexPill.textContent = 'NOT INDEXED';
    indexPill.title = '运行 synapse index 建立知识库';
    return;
  }
  const ageHours = (Date.now() - new Date(indexed).getTime()) / 3600000;
  const stale = ageHours > 24;
  indexPill.className = `pill ${stale ? 'stale' : 'ready'}`;
  indexPill.textContent = `${stale ? 'STALE' : 'READY'} · ${fmtRel(indexed)}`;
  indexPill.title = `最近索引：${fmtDate(indexed)}`;
}

/* ----------------------------------------------------------------- router */

const ROUTES = {
  overview: { label: 'Overview', render: renderOverview },
  graph: { label: 'Knowledge Graph', render: renderGraph },
  search: { label: 'Search', render: renderSearch },
  memory: { label: 'Memory', render: renderMemory },
  context: { label: 'Context', render: renderContext },
  indexing: { label: 'Indexing', render: renderIndexing },
};

function currentRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const path = raw.split('?')[0];
  const name = path.split('/')[0];
  return ROUTES[name] ? name : 'overview';
}

function routeParams() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const index = raw.indexOf('?');
  return new URLSearchParams(index >= 0 ? raw.slice(index + 1) : '');
}

async function onRoute() {
  if (!state.projects.length) return;
  if (state.cleanup) {
    state.cleanup();
    state.cleanup = null;
  }
  closeInspector();
  state.route = currentRoute();
  view.classList.toggle('graph-view', state.route === 'graph');
  crumbView.textContent = ROUTES[state.route].label;
  for (const button of document.querySelectorAll('.nav-item')) {
    button.classList.toggle('active', button.dataset.route === state.route);
  }
  try {
    await ROUTES[state.route].render();
  } catch (err) {
    if (err.message === 'UNAUTHENTICATED') return;
    view.innerHTML = `<div class="error-box">加载失败：${esc(err.message)}</div>`;
  }
}

/* -------------------------------------------------------------- overview */

async function renderOverview() {
  const projectId = state.projectId;
  view.innerHTML = loadingPanels();
  const [overview, status] = await Promise.all([
    api(`/projects/${projectId}/overview`),
    api(`/projects/${projectId}/status`),
  ]);
  state.overview = overview;
  state.project = { ...state.project, ...overview.project };
  syncProjectChrome();

  const stats = status.stats || {};
  const nodeTypes = Object.entries(stats.node_types || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxType = Math.max(1, ...nodeTypes.map(([, count]) => count));
  const run = overview.last_run;
  const tasks = overview.tasks || {};
  const techStack = overview.tech_stack || [];
  const modules = overview.top_modules || [];
  const decisions = overview.decisions || [];
  const changes = overview.recent_changes || [];

  view.innerHTML = `
    <div class="overview-head">
      <div>
        <h1>${esc(overview.project.name)}</h1>
        <div class="root">${esc(overview.project.root_path)}</div>
        <div class="meta-line">
          <span class="meta-item">last indexed <b>${esc(fmtRel(overview.project.last_indexed_at))}</b></span>
          <span class="meta-item">created <b>${esc(fmtDate(overview.project.created_at))}</b></span>
          <span class="meta-item">project id <b>${esc(overview.project.id)}</b></span>
        </div>
      </div>
      <div class="overview-aside">
        ${run ? `<span class="run-status ${esc(run.status)}"><span class="dot"></span>${esc(String(run.status).toUpperCase())}</span>` : '<span class="run-status"><span class="dot"></span>NEVER RUN</span>'}
        <div class="mono">${esc(run ? `${run.mode} · ${run.stats && run.stats.duration_ms != null ? run.stats.duration_ms : 0} ms` : 'no index run yet')}</div>
      </div>
    </div>

    <div class="grid kpi">
      <div class="panel kpi-card accent"><div class="kpi-label">KNOWLEDGE NODES</div><div class="kpi-value">${fmtInt(stats.nodes)}</div><div class="kpi-foot">${esc(nodeTypes.map(([t, c]) => `${t} ${c}`).slice(0, 3).join(' · '))}</div></div>
      <div class="panel kpi-card"><div class="kpi-label">GRAPH RELATIONS</div><div class="kpi-value">${fmtInt(stats.relations)}</div><div class="kpi-foot">CONTAINS · IMPORTS · CALLS · INHERITS · REFERENCES</div></div>
      <div class="panel kpi-card"><div class="kpi-label">INDEXED SOURCES</div><div class="kpi-value">${fmtInt(stats.sources)}</div><div class="kpi-foot">files and documents in the active set</div></div>
      <div class="panel kpi-card ${stats.unresolved_refs ? 'warn' : ''}"><div class="kpi-label">UNRESOLVED REFS</div><div class="kpi-value">${fmtInt(stats.unresolved_refs)}</div><div class="kpi-foot">kept for a later resolution pass</div></div>
    </div>

    <div class="grid two">
      <div class="panel">
        <div class="panel-head"><h3>Node composition</h3><span class="aside">${nodeTypes.length} types</span></div>
        <div class="panel-body">
          ${nodeTypes.length ? nodeTypes.map(([type, count]) => `
            <div class="bar-row">
              <span class="name">${esc(type)}</span>
              <span class="bar"><i style="width:${Math.max(2, (count / maxType) * 100)}%"></i></span>
              <span class="value">${fmtInt(count)}</span>
            </div>`).join('') : '<div class="empty">暂无节点，先运行索引。</div>'}
        </div>
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><h3>Tech stack</h3><span class="aside">detected</span></div>
          <div class="panel-body">
            ${techStack.length ? `<div class="chips">${techStack.map((item) => `<span class="chip mono">${esc(item)}</span>`).join('')}</div>` : '<div class="empty" style="padding:14px">未检测到依赖清单或构建配置。</div>'}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Index queue</h3><span class="aside">all runs</span></div>
          <div class="panel-body">
            <div class="stat-line"><span class="k">succeeded</span><span class="v">${fmtInt(tasks.succeeded)}</span></div>
            <div class="stat-line"><span class="k">queued</span><span class="v">${fmtInt(tasks.queued)}</span></div>
            <div class="stat-line"><span class="k">running</span><span class="v">${fmtInt(tasks.running)}</span></div>
            <div class="stat-line"><span class="k">failed</span><span class="v">${fmtInt(tasks.failed)}</span></div>
            <div class="stat-line"><span class="k">canceled</span><span class="v">${fmtInt(tasks.canceled)}</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid two" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><h3>Project skeleton</h3><span class="aside">one node per path</span></div>
        ${modules.length ? `<table class="table">
          <thead><tr><th>Module</th><th>Path</th><th>Why</th><th style="text-align:right">Salience</th></tr></thead>
          <tbody>
            ${modules.map((module) => `
              <tr class="clickable" data-node="${esc(module.node_id)}">
                <td class="title-cell"><span class="type-badge type-${esc(module.node_type)}" style="margin-right:7px">${esc(module.node_type)}</span>${esc(module.title)}</td>
                <td class="path">${esc(module.path || '—')}</td>
                <td>${reasonBadge(module.reason || 'salience')}</td>
                <td class="num">${Number(module.salience || 0).toFixed(2)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<div class="empty">暂无模块信息。</div>'}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Last index run</h3>${run ? `<span class="aside mono">${esc(truncate(run.id, 14))}</span>` : ''}</div>
        <div class="panel-body">
          ${run ? `
            <div class="stat-line"><span class="k">status</span><span class="v"><span class="run-status ${esc(run.status)}"><span class="dot"></span>${esc(run.status)}</span></span></div>
            <div class="stat-line"><span class="k">mode</span><span class="v">${esc(run.mode)}</span></div>
            <div class="stat-line"><span class="k">started</span><span class="v">${esc(fmtDate(run.started_at))}</span></div>
            <div class="stat-line"><span class="k">finished</span><span class="v">${esc(fmtDate(run.finished_at))}</span></div>
            <div class="stat-line"><span class="k">scanned / changed</span><span class="v">${fmtInt(run.stats && run.stats.scanned)} / ${fmtInt(run.stats && run.stats.changed)}</span></div>
            <div class="stat-line"><span class="k">nodes upserted</span><span class="v">${fmtInt(run.stats && run.stats.nodes_upserted)}</span></div>
            <div class="stat-line"><span class="k">relations upserted</span><span class="v">${fmtInt(run.stats && run.stats.relations_upserted)}</span></div>
            <div class="stat-line"><span class="k">resolved / unresolved</span><span class="v">${fmtInt(run.stats && run.stats.resolved)} / ${fmtInt(run.stats && run.stats.unresolved)}</span></div>
            <div class="stat-line"><span class="k">failed files</span><span class="v">${fmtInt(run.stats && run.stats.failed)}</span></div>
            ${run.error ? `<div class="error-box" style="margin-top:10px">${esc(truncate(run.error, 400))}</div>` : ''}
          ` : '<div class="empty">尚未运行索引。使用 CLI 执行 <code>synapse index</code>。</div>'}
        </div>
      </div>
    </div>

    <div class="grid two-even" style="margin-top:14px">
      <div class="panel">
        <div class="panel-head"><h3>Decisions</h3><span class="aside">memory_type = decision</span></div>
        ${decisions.length ? `<ul class="list">
          ${decisions.map((item) => `
            <li class="clickable-row" data-node="${esc(item.node_id)}" style="cursor:pointer">
              <span class="dot" style="background:rgba(255,255,255,0.55)"></span>
              <div class="li-main">
                <div class="li-title">${esc(item.title)}</div>
                <div class="li-sub">${esc(truncate(item.summary || '无摘要', 96))}</div>
              </div>
              <span class="li-end">${esc(fmtRel(item.updated_at || overview.project.last_indexed_at))}</span>
            </li>`).join('')}
        </ul>` : '<div class="empty">尚无决策记忆。使用 <code>synapse remember ... --type decision</code> 写入。</div>'}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Recent changes</h3><span class="aside">by file mtime</span></div>
        ${changes.length ? `<ul class="list">
          ${changes.map((change) => `
            <li>
              <span class="dot"></span>
              <div class="li-main">
                <div class="li-title mono" style="font-size:11px">${esc(change.path)}</div>
                <div class="li-sub">${esc(change.language || 'text')}</div>
              </div>
              <span class="li-end">${esc(fmtRel(change.updated_at))}</span>
            </li>`).join('')}
        </ul>` : '<div class="empty">暂无最近变更。</div>'}
      </div>
    </div>
  `;

  view.querySelectorAll('[data-node]').forEach((row) => {
    row.addEventListener('click', () => openNode(row.dataset.node));
  });
}

/* ----------------------------------------------------------------- graph */

class GraphView {
  constructor(canvas, tip, onSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tip = tip;
    this.onSelect = onSelect;
    this.nodes = [];
    this.edges = [];
    this.byId = new Map();
    this.transform = { x: 0, y: 0, k: 1 };
    this.alpha = 0;
    this.frame = null;
    this.ticks = 0;
    this.selected = null;
    this.hover = null;
    this.dragNode = null;
    this.pan = null;
    this.moved = false;
    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;
    this.onStats = null;
    this.bind();
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);
  }

  bind() {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => this.onDown(event));
    canvas.addEventListener('pointermove', (event) => this.onMove(event));
    canvas.addEventListener('pointerup', (event) => this.onUp(event));
    canvas.addEventListener('pointerleave', () => { this.hideTip(); });
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    canvas.addEventListener('dblclick', (event) => {
      if (!this.pick(event)) this.fit();
    });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(320, Math.round(rect.width));
    this.height = Math.max(360, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.draw();
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.observer) this.observer.disconnect();
  }

  setData(nodes, edges) {
    const previous = new Map(this.nodes.map((node) => [node.id, node]));
    this.nodes = nodes.map((node, index) => {
      const old = previous.get(node.id) || state.graphPositions[node.id];
      const angle = index * 2.399963229728653;
      const radius = 90 + Math.sqrt(index + 1) * 34;
      return {
        id: node.node_id,
        title: node.title,
        type: node.node_type,
        path: node.path,
        lines: node.start_line ? `${node.start_line}-${node.end_line || node.start_line}` : '',
        salience: Number(node.salience || 0.5),
        degree: 0,
        x: old ? old.x : Math.cos(angle) * radius,
        y: old ? old.y : Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    this.edges = edges
      .filter((edge) => this.byId.has(edge.from_node_id) && this.byId.has(edge.to_node_id))
      .map((edge) => ({
        from: edge.from_node_id,
        to: edge.to_node_id,
        type: edge.relation_type,
        confidence: Number(edge.confidence || 0.5),
      }));
    this.computeDegree();
    this.alpha = 1;
    this.ticks = 0;
    this.fit();
    this.start();
  }

  computeDegree() {
    for (const node of this.nodes) node.degree = 0;
    for (const edge of this.edges) {
      const a = this.byId.get(edge.from);
      const b = this.byId.get(edge.to);
      if (a) a.degree += 1;
      if (b) b.degree += 1;
    }
  }

  merge(payload) {
    const existing = new Set(this.nodes.map((node) => node.id));
    const anchor = this.byId.get(this.selected);
    let added = 0;
    (payload.nodes || []).forEach((node) => {
      if (existing.has(node.node_id)) return;
      const angle = Math.random() * Math.PI * 2;
      const radius = 55 + Math.random() * 60;
      this.nodes.push({
        id: node.node_id,
        title: node.title,
        type: node.node_type,
        path: node.path,
        lines: node.start_line ? `${node.start_line}-${node.end_line || node.start_line}` : '',
        salience: Number(node.salience || 0.5),
        degree: 0,
        x: (anchor ? anchor.x : 0) + Math.cos(angle) * radius,
        y: (anchor ? anchor.y : 0) + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      });
      existing.add(node.node_id);
      added += 1;
    });
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    const seen = new Set(this.edges.map((edge) => `${edge.from}|${edge.to}|${edge.type}`));
    for (const edge of payload.edges || []) {
      if (!this.byId.has(edge.from_node_id) || !this.byId.has(edge.to_node_id)) continue;
      const key = `${edge.from_node_id}|${edge.to_node_id}|${edge.relation_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.edges.push({
        from: edge.from_node_id,
        to: edge.to_node_id,
        type: edge.relation_type,
        confidence: Number(edge.confidence || 0.5),
      });
    }
    this.computeDegree();
    this.alpha = Math.max(this.alpha, 0.7);
    this.ticks = Math.max(0, this.ticks - 60);
    this.start();
    return added;
  }

  start() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => this.loop());
  }

  loop() {
    this.frame = null;
    const active = this.step();
    this.draw();
    if (active) {
      this.frame = requestAnimationFrame(() => this.loop());
    } else {
      for (const node of this.nodes) state.graphPositions[node.id] = { x: node.x, y: node.y };
      this.report();
    }
  }

  step() {
    const nodes = this.nodes;
    if (!nodes.length) return false;
    if (this.ticks > 260 || this.alpha < 0.015) {
      this.alpha = 0;
      return !!this.dragNode;
    }
    this.ticks += 1;
    this.alpha *= 0.986;
    const cx = 0;
    const cy = 0;
    const repulsion = 1500;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          dist2 = 1;
        }
        const force = repulsion / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force * this.alpha;
        const fy = (dy / dist) * force * this.alpha;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const edge of this.edges) {
      const a = this.byId.get(edge.from);
      const b = this.byId.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const rest = 68 + (1 - edge.confidence) * 34;
      const force = (dist - rest) * 0.012 * this.alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const node of nodes) {
      node.vx += (cx - node.x) * 0.0016;
      node.vy += (cy - node.y) * 0.0016;
      node.vx *= 0.86;
      node.vy *= 0.86;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 9) {
        node.vx = (node.vx / speed) * 9;
        node.vy = (node.vy / speed) * 9;
      }
      if (node !== this.dragNode) {
        node.x += node.vx;
        node.y += node.vy;
      }
    }
    return true;
  }

  draw() {
    const ctx = this.ctx;
    const { width, height, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(this.transform.x, this.transform.y);
    ctx.scale(this.transform.k, this.transform.k);

    const selected = this.selected;
    const hover = this.hover;
    const adjacent = new Set();
    if (selected) {
      for (const edge of this.edges) {
        if (edge.from === selected) adjacent.add(edge.to);
        if (edge.to === selected) adjacent.add(edge.from);
      }
    }

    for (const edge of this.edges) {
      const a = this.byId.get(edge.from);
      const b = this.byId.get(edge.to);
      if (!a || !b) continue;
      const active = selected && (edge.from === selected || edge.to === selected);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = active ? 'rgba(250, 250, 250, 0.5)' : 'rgba(161, 161, 170, 0.16)';
      ctx.lineWidth = active ? 1.3 : 0.8;
      ctx.stroke();
      if (active) {
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const tx = b.x - Math.cos(angle) * 9;
        const ty = b.y - Math.sin(angle) * 9;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - Math.cos(angle - 0.4) * 6, ty - Math.sin(angle - 0.4) * 6);
        ctx.lineTo(tx - Math.cos(angle + 0.4) * 6, ty - Math.sin(angle + 0.4) * 6);
        ctx.closePath();
        ctx.fillStyle = 'rgba(250, 250, 250, 0.7)';
        ctx.fill();
      }
    }

    const shape = (node, radius) => {
      ctx.beginPath();
      if (node.type === 'memory') {
        ctx.moveTo(node.x, node.y - radius);
        ctx.lineTo(node.x + radius, node.y);
        ctx.lineTo(node.x, node.y + radius);
        ctx.lineTo(node.x - radius, node.y);
        ctx.closePath();
      } else if (node.type === 'document' || node.type === 'doc_section') {
        ctx.roundRect(node.x - radius * 0.85, node.y - radius * 0.85, radius * 1.7, radius * 1.7, 2);
      } else if (node.type === 'class') {
        ctx.roundRect(node.x - radius * 0.92, node.y - radius * 0.92, radius * 1.84, radius * 1.84, radius * 0.42);
      } else {
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      }
    };

    for (const node of this.nodes) {
      const radius = 4.5 + node.salience * 8 + (node === hover ? 1.5 : 0);
      const color = NODE_COLORS[node.type] || '#a1a1aa';
      const dim = selected && !adjacent.has(node.id) && node.id !== selected;
      shape(node, radius);
      ctx.fillStyle = color;
      ctx.globalAlpha = dim ? 0.22 : 0.96;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (node.id === selected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(250, 250, 250, 0.85)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      } else if (!dim) {
        shape(node, radius);
        ctx.strokeStyle = 'rgba(9, 9, 11, 0.9)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }

    const showLabels = this.transform.k >= 0.75;
    for (const node of this.nodes) {
      const focused = node.id === selected || node === hover;
      const important = node.degree >= 7 && showLabels;
      if (!focused && !important) continue;
      const radius = 4.5 + node.salience * 8;
      ctx.font = focused ? '600 11px Geist, "Segoe UI", sans-serif' : '10px Geist, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = truncate(node.title, 28);
      const metrics = ctx.measureText(label);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
      ctx.fillRect(node.x - metrics.width / 2 - 3, node.y - radius - 17, metrics.width + 6, 14);
      ctx.fillStyle = focused ? '#fafafa' : 'rgba(228, 228, 231, 0.7)';
      ctx.fillText(label, node.x, node.y - radius - 5);
    }
    ctx.restore();
  }

  screen(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  world(point) {
    return {
      x: (point.x - this.transform.x) / this.transform.k,
      y: (point.y - this.transform.y) / this.transform.k,
    };
  }

  pick(event) {
    const point = this.world(this.screen(event));
    for (let i = this.nodes.length - 1; i >= 0; i -= 1) {
      const node = this.nodes[i];
      const radius = 4.5 + node.salience * 8 + 4;
      if (Math.hypot(node.x - point.x, node.y - point.y) <= radius) return node;
    }
    return null;
  }

  onDown(event) {
    const node = this.pick(event);
    this.moved = false;
    if (node) {
      this.dragNode = node;
      this.canvas.classList.add('dragging');
    } else {
      const point = this.screen(event);
      this.pan = { sx: point.x, sy: point.y, ox: this.transform.x, oy: this.transform.y };
    }
  }

  onMove(event) {
    const point = this.screen(event);
    if (this.dragNode) {
      const world = this.world(point);
      this.dragNode.x = world.x;
      this.dragNode.y = world.y;
      this.dragNode.vx = 0;
      this.dragNode.vy = 0;
      this.moved = true;
      this.alpha = Math.max(this.alpha, 0.25);
      this.draw();
      return;
    }
    if (this.pan) {
      this.transform.x = this.pan.ox + (point.x - this.pan.sx);
      this.transform.y = this.pan.oy + (point.y - this.pan.sy);
      if (Math.abs(point.x - this.pan.sx) + Math.abs(point.y - this.pan.sy) > 3) this.moved = true;
      this.draw();
      return;
    }
    const node = this.pick(event);
    if (node !== this.hover) {
      this.hover = node;
      this.draw();
    }
    if (node) {
      const world = this.world(point);
      this.tip.hidden = false;
      this.tip.innerHTML = `${esc(node.title)}<div class="sub">${esc(node.type)} · ${esc(node.path || '')}${node.lines ? `:${esc(node.lines)}` : ''}</div>`;
      const rect = this.canvas.getBoundingClientRect();
      const offset = this.canvas.parentElement.getBoundingClientRect();
      this.tip.style.left = `${point.x + rect.left - offset.left}px`;
      this.tip.style.top = `${(world.y * this.transform.k + this.transform.y) + rect.top - offset.top}px`;
    } else {
      this.hideTip();
    }
  }

  onUp(event) {
    if (this.dragNode) {
      const node = this.dragNode;
      this.dragNode = null;
      this.canvas.classList.remove('dragging');
      if (!this.moved) {
        this.select(node.id);
        this.onSelect(node.id);
      }
      return;
    }
    this.pan = null;
  }

  onWheel(event) {
    event.preventDefault();
    const point = this.screen(event);
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const next = Math.min(3, Math.max(0.25, this.transform.k * factor));
    const world = this.world(point);
    this.transform.k = next;
    this.transform.x = point.x - world.x * next;
    this.transform.y = point.y - world.y * next;
    this.draw();
  }

  hideTip() {
    this.tip.hidden = true;
    if (this.hover) {
      this.hover = null;
      this.draw();
    }
  }

  select(id) {
    this.selected = id;
    this.draw();
  }

  focusNode(id) {
    const node = this.byId.get(id);
    if (!node) return;
    this.selected = id;
    this.transform.k = Math.max(1.1, this.transform.k);
    this.transform.x = this.width / 2 - node.x * this.transform.k;
    this.transform.y = this.height / 2 - node.y * this.transform.k;
    this.draw();
  }

  fit() {
    if (!this.nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
    const width = Math.max(40, maxX - minX);
    const height = Math.max(40, maxY - minY);
    const k = Math.min(this.width / (width + 160), this.height / (height + 160), 1.7);
    this.transform.k = Math.max(0.25, k);
    this.transform.x = this.width / 2 - ((minX + maxX) / 2) * this.transform.k;
    this.transform.y = this.height / 2 - ((minY + maxY) / 2) * this.transform.k;
    this.draw();
  }

  report() {
    if (this.onStats) this.onStats({ nodes: this.nodes.length, edges: this.edges.length });
  }
}

async function renderGraph() {
  view.innerHTML = `
    <div class="graph-layout">
      <div class="panel graph-toolbar">
        <div class="group">
          <span class="group-label">NODES</span>
          <div class="chips" id="graph-types"></div>
        </div>
        <div class="group">
          <span class="group-label">RELATION</span>
          <select class="select" id="graph-relation">
            <option value="">all</option>
            ${RELATION_TYPES.map((type) => `<option value="${type}">${type}</option>`).join('')}
          </select>
        </div>
        <div class="group">
          <span class="group-label">LIMIT</span>
          <select class="select" id="graph-limit">
            ${[40, 80, 120, 200].map((value) => `<option value="${value}" ${value === state.graphFilter.maxNodes ? 'selected' : ''}>${value}</option>`).join('')}
          </select>
        </div>
        <div class="spacer"></div>
        <button class="btn ghost" id="graph-fit">Fit</button>
        <button class="btn ghost" id="graph-reload">Reload</button>
      </div>
      <div class="graph-stage" id="graph-stage">
        <canvas id="graph-canvas"></canvas>
        <div class="graph-hud">
          <div class="row"><span><b id="hud-nodes">0</b> nodes</span><span><b id="hud-edges">0</b> edges</span><span><b id="hud-zoom">100%</b> zoom</span></div>
          <div class="row"><span>seeds chosen by salience, edges by relation confidence</span></div>
        </div>
        <div class="graph-legend" id="graph-legend"></div>
        <div class="graph-truncated" id="graph-truncated" hidden><span class="pill stale">TRUNCATED</span></div>
        <div class="graph-tip" id="graph-tip" hidden></div>
      </div>
    </div>`;

  const typeChips = $('#graph-types');
  typeChips.innerHTML = NODE_TYPES.map((type) => `
    <span class="chip clickable ${state.graphFilter.types.has(type) ? 'active' : ''}" data-type="${type}">
      <span class="swatch" style="display:inline-block;width:6px;height:6px;border-radius:2px;background:${NODE_COLORS[type]}"></span>${type}
    </span>`).join('');

  typeChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-type]');
    if (!chip) return;
    const type = chip.dataset.type;
    if (state.graphFilter.types.has(type)) {
      if (state.graphFilter.types.size === 1) return;
      state.graphFilter.types.delete(type);
      chip.classList.remove('active');
    } else {
      state.graphFilter.types.add(type);
      chip.classList.add('active');
    }
    loadGraph();
  });

  $('#graph-relation').addEventListener('change', (event) => {
    state.graphFilter.relation = event.target.value;
    loadGraph();
  });
  $('#graph-limit').addEventListener('change', (event) => {
    state.graphFilter.maxNodes = Number(event.target.value);
    loadGraph();
  });
  $('#graph-fit').addEventListener('click', () => state.graph && state.graph.fit());
  $('#graph-reload').addEventListener('click', () => loadGraph());

  const canvas = $('#graph-canvas');
  const graph = new GraphView(canvas, $('#graph-tip'), (id) => openNode(id));
  graph.onStats = (stats) => {
    $('#hud-nodes').textContent = stats.nodes;
    $('#hud-edges').textContent = stats.edges;
  };
  state.graph = graph;
  state.cleanup = () => { graph.stop(); state.graph = null; };
  updateZoomHud(graph);
  const params = routeParams();
  if (params.get('node')) state.pendingFocus = params.get('node');
  await loadGraph();
}

function updateZoomHud(graph) {
  const hud = document.getElementById('hud-zoom');
  if (!hud || !graph) return;
  hud.textContent = `${Math.round(graph.transform.k * 100)}%`;
}

async function loadGraph() {
  const graph = state.graph;
  if (!graph) return;
  const types = [...state.graphFilter.types];
  if (!types.length) return;
  const data = await api(`/projects/${state.projectId}/graph/overview`, {
    params: {
      max_nodes: state.graphFilter.maxNodes,
      node_types: types.join(','),
      relation_types: state.graphFilter.relation || undefined,
    },
  });
  graph.setData(data.nodes || [], data.edges || []);
  $('#hud-nodes').textContent = graph.nodes.length;
  $('#hud-edges').textContent = graph.edges.length;
  $('#graph-truncated').hidden = !data.truncated;
  const counts = {};
  for (const node of graph.nodes) counts[node.type] = (counts[node.type] || 0) + 1;
  $('#graph-legend').innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `<span class="lg"><span class="sw" style="background:${NODE_COLORS[type] || '#a1a1aa'}"></span>${type} ${count}</span>`)
    .join('');
  if (state.pendingFocus) {
    const id = state.pendingFocus;
    state.pendingFocus = null;
    graph.focusNode(id);
    openNode(id);
  }
}

/* ----------------------------------------------------------------- search */

async function renderSearch() {
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Search</h1>
        <p class="page-sub">Lexical + graph ranking over one project. Semantic retrieval is not available in this phase.</p>
      </div>
    </div>
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-body">
        <form class="form-row" id="search-form">
          <label class="field" style="flex:2 1 320px"><span>QUERY</span><input class="input" id="search-q" placeholder="符号、关键词或自然语言描述" autocomplete="off" /></label>
          <label class="field narrow"><span>MODE</span>
            <select class="select" id="search-mode"><option value="hybrid">hybrid</option><option value="keyword">keyword</option></select>
          </label>
          <label class="field narrow"><span>TYPE</span>
            <select class="select" id="search-type"><option value="">all</option>${NODE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
          </label>
          <label class="field"><span>PATH PREFIX</span><input class="input" id="search-path" placeholder="src/synapse/" autocomplete="off" /></label>
          <button class="btn primary" type="submit">${icon('i-search')}<span>Search</span></button>
        </form>
      </div>
    </div>
    <div id="search-output"></div>`;

  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });
  if (state.search.last) {
    $('#search-q').value = state.search.last.q || '';
    renderSearchResults(state.search.last);
  } else {
    $('#search-output').innerHTML = emptyHint('输入关键词开始检索', '例如 <code>ContextBuilder</code>、<code>index_file</code> 或 <code>认证</code>。');
  }
  const params = routeParams();
  if (params.get('q')) {
    $('#search-q').value = params.get('q');
    if (params.get('mode')) $('#search-mode').value = params.get('mode');
    if (params.get('type')) $('#search-type').value = params.get('type');
    if (params.get('path')) $('#search-path').value = params.get('path');
    runSearch();
  }
}

function emptyHint(title, detail) {
  return `<div class="panel">${emptyState(title, detail || '')}</div>`;
}

async function runSearch() {
  const q = $('#search-q').value.trim();
  if (!q) return;
  const output = $('#search-output');
  output.innerHTML = `<div class="panel" style="padding:16px"><div class="skeleton" style="width:22%"></div><div class="skeleton" style="width:100%;height:60px;margin-top:12px"></div></div>`;
  try {
    const data = await api(`/projects/${state.projectId}/search`, {
      params: {
        q,
        mode: $('#search-mode').value,
        node_types: $('#search-type').value || undefined,
        path_prefix: $('#search-path').value.trim() || undefined,
        limit: 20,
      },
    });
    state.search.last = { q, data };
    renderSearchResults(state.search.last);
  } catch (err) {
    output.innerHTML = `<div class="error-box">检索失败：${esc(err.message)}</div>`;
  }
}

function renderSearchResults(cached) {
  const data = cached.data || {};
  const results = data.results || [];
  const meta = data.meta || {};
  const output = $('#search-output');
  if (!output) return;
  const degraded = (meta.degraded || []).includes('fts_unavailable');
  output.innerHTML = `
    <div class="panel">
      <div class="meta-strip">
        <span>${results.length} results</span>
        <span>mode ${esc(meta.mode || '—')}</span>
        <span>${meta.took_ms != null ? `${meta.took_ms} ms` : ''}</span>
        <span>${fmtInt(meta.candidates)} candidates</span>
        ${degraded ? '<span class="warn">fts unavailable · degraded</span>' : ''}
      </div>
      ${results.length ? results.map((item) => {
        const reasons = (item.reasons || []).map((reason) => `<span class="reason">${esc(reason)}</span>`).join('');
        const relations = (item.relations || []).length;
        return `
          <button class="result" data-node="${esc(item.node_id)}">
            <div class="result-head">
              ${typeBadge(item.node_type)}
              <span class="result-title">${esc(item.title)}</span>
              ${reasons}
            </div>
            <div class="result-path">${esc(item.path || '—')}${item.start_line ? `:${item.start_line}` : ''}</div>
            ${item.snippet ? `<div class="result-snippet">${highlight(item.snippet)}</div>` : ''}
            <div class="result-foot">
              <span class="score">score ${Number(item.score || 0).toFixed(3)}<span class="track"><i style="width:${Math.min(100, Number(item.score || 0) * 100)}%"></i></span></span>
              ${relations ? `<span class="relation-tag">${relations} relations</span>` : ''}
              ${item.confidence != null ? `<span class="relation-tag">confidence ${Number(item.confidence).toFixed(2)}</span>` : ''}
            </div>
          </button>`;
      }).join('') : emptyState('没有匹配结果', '尝试更短的查询、切换 keyword 模式或去掉路径前缀过滤。')}
    </div>`;
  output.querySelectorAll('[data-node]').forEach((button) => {
    button.addEventListener('click', () => openNode(button.dataset.node));
  });
}

/* ----------------------------------------------------------------- memory */

async function renderMemory() {
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Project Memory</h1>
        <p class="page-sub">Explicit, cross-session project knowledge. Read-only in this phase.</p>
      </div>
      <div class="chips" id="memory-types">
        <span class="chip clickable ${state.memory.type === '' ? 'active' : ''}" data-type="">all</span>
        ${MEMORY_TYPES.map((type) => `<span class="chip clickable ${state.memory.type === type ? 'active' : ''}" data-type="${type}">${MEMORY_LABELS[type]} · ${type}</span>`).join('')}
      </div>
    </div>
    <div class="memory-layout">
      <div class="panel">
        <div class="panel-head"><h3>Memories</h3><span class="aside" id="memory-count">—</span></div>
        <div class="panel-body" style="padding:0 12px 10px">
          <input class="input" id="memory-q" placeholder="在当前记忆中搜索…" autocomplete="off" style="margin:10px 0" />
        </div>
        <div class="readonly-note">${icon('i-memory')}<span><b>只读</b>：记忆的编辑与删除将在后续阶段提供，当前页面用于核对 Agent 可见的长期知识。</span></div>
        <div class="memory-list" id="memory-list"><div class="empty">加载中…</div></div>
      </div>
      <div class="panel memory-detail" id="memory-detail">
        <div class="empty">选择左侧记忆查看完整内容。</div>
      </div>
    </div>`;

  $('#memory-types').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-type]');
    if (!chip) return;
    state.memory.type = chip.dataset.type;
    state.memory.selected = null;
    for (const item of document.querySelectorAll('#memory-types .chip')) {
      item.classList.toggle('active', item.dataset.type === state.memory.type);
    }
    loadMemories();
  });

  let timer = null;
  $('#memory-q').addEventListener('input', (event) => {
    state.memory.q = event.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(() => loadMemories(), 260);
  });

  await loadMemories();
}

async function loadMemories() {
  const list = $('#memory-list');
  const count = $('#memory-count');
  if (!list) return;
  list.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await api(`/projects/${state.projectId}/memories`, {
      params: {
        memory_type: state.memory.type || undefined,
        q: state.memory.q || undefined,
        limit: 100,
      },
    });
    count.textContent = `${fmtInt(data.total)} total`;
    state.memory.rows = data.memories || [];
    if (!state.memory.rows.length) {
      list.innerHTML = emptyState('暂无记忆', 'Agent 或开发者可通过 <code>synapse remember</code> 写入项目决策与经验。');
      return;
    }
    list.innerHTML = state.memory.rows.map((item) => `
      <button class="memory-item ${state.memory.selected === item.node_id ? 'active' : ''}" data-node="${esc(item.node_id)}">
        <div class="memory-title">${esc(item.title)}</div>
        <div class="memory-sub">
          <span>${esc(item.memory_type || 'note')}</span>
          <span>${esc(fmtRel(item.updated_at))}</span>
          ${(item.tags || []).slice(0, 3).map((tag) => `<span>#${esc(tag)}</span>`).join('')}
        </div>
      </button>`).join('');
    list.querySelectorAll('[data-node]').forEach((button) => {
      button.addEventListener('click', () => selectMemory(button.dataset.node));
    });
    if (!state.memory.selected) {
      const first = state.memory.rows[0];
      if (first) selectMemory(first.node_id);
    } else {
      const exists = state.memory.rows.some((row) => row.node_id === state.memory.selected);
      if (exists) selectMemory(state.memory.selected);
    }
  } catch (err) {
    list.innerHTML = `<div class="empty">加载失败：${esc(err.message)}</div>`;
  }
}

async function selectMemory(nodeId) {
  state.memory.selected = nodeId;
  for (const item of document.querySelectorAll('.memory-item')) {
    item.classList.toggle('active', item.dataset.node === nodeId);
  }
  const detail = $('#memory-detail');
  if (!detail) return;
  detail.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const memory = await api(`/projects/${state.projectId}/memories/${nodeId}`);
    detail.innerHTML = `
      <div class="panel-head">
        <h3>Memory detail</h3>
        <span class="aside">${esc(memory.memory_type || 'note')}</span>
      </div>
      <div class="panel-body">
        <div class="chips" style="margin-bottom:10px">
          ${typeBadge(memory.node_type)}
          ${memory.memory_type ? `<span class="chip active">${esc(MEMORY_LABELS[memory.memory_type] || memory.memory_type)}</span>` : ''}
          <span class="chip">provenance ${esc(memory.provenance)}</span>
          <span class="chip">confidence ${Number(memory.confidence || 0).toFixed(2)}</span>
        </div>
        <h2 style="margin:2px 0 8px;font-size:16px">${esc(memory.title)}</h2>
        <div class="content">${esc(memory.content)}</div>
        ${(memory.tags || []).length ? `<div class="chips tags">${memory.tags.map((tag) => `<span class="chip">#${esc(tag)}</span>`).join('')}</div>` : ''}
        <div class="meta-line">
          <span class="meta-item">created <b>${esc(fmtDate(memory.created_at))}</b></span>
          <span class="meta-item">updated <b>${esc(fmtDate(memory.updated_at))}</b></span>
        </div>
        <div class="inspector-actions">
          <button class="btn ghost" id="memory-open-node">${icon('i-graph')}<span>在知识图谱中查看</span></button>
          <button class="btn ghost" id="memory-copy-id">${icon('i-key')}<span>复制 Node ID</span></button>
        </div>
      </div>`;
    $('#memory-open-node').addEventListener('click', () => {
      state.pendingFocus = nodeId;
      location.hash = '#/graph';
    });
    $('#memory-copy-id').addEventListener('click', () => copyText(nodeId));
  } catch (err) {
    detail.innerHTML = `<div class="error-box">加载失败：${esc(err.message)}</div>`;
  }
}

/* ---------------------------------------------------------------- context */

async function renderContext() {
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Context Inspection</h1>
        <p class="page-sub">The same structure an agent receives from <code>synapse_context</code>, with the token budget applied.</p>
      </div>
    </div>
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-body">
        <form class="form-row" id="context-form">
          <label class="field" style="flex:2 1 320px"><span>TASK QUERY (OPTIONAL)</span><input class="input" id="context-q" placeholder="例如：修改认证模块的令牌校验" autocomplete="off" /></label>
          <label class="field narrow"><span>MAX TOKENS</span><input class="input" id="context-tokens" type="number" min="100" max="20000" step="100" value="2000" /></label>
          <button class="btn primary" type="submit">${icon('i-context')}<span>Build</span></button>
        </form>
      </div>
    </div>
    <div id="context-output"><div class="panel">${emptyState('尚未构建上下文', '不填 query 时返回项目概览；填写后优先选择与任务相关的模块。')}</div></div>`;

  $('#context-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runContextInspection();
  });
  const params = routeParams();
  if (params.get('q') || params.get('max_tokens')) {
    if (params.get('q')) $('#context-q').value = params.get('q');
    if (params.get('max_tokens')) $('#context-tokens').value = params.get('max_tokens');
    runContextInspection();
  }
}

async function runContextInspection() {
  const output = $('#context-output');
  if (!output) return;
  output.innerHTML = `<div class="panel" style="padding:16px"><div class="skeleton" style="width:27%"></div><div class="skeleton" style="width:100%;height:90px;margin-top:12px"></div></div>`;
  try {
    const data = await api(`/projects/${state.projectId}/context`, {
      params: { q: $('#context-q').value.trim() || undefined, max_tokens: Number($('#context-tokens').value) || 2000 },
    });
    renderContextResult(data);
  } catch (err) {
    output.innerHTML = `<div class="error-box">构建失败：${esc(err.message)}</div>`;
  }
}

function renderContextResult(data) {
  const output = $('#context-output');
  const budget = Number($('#context-tokens').value) || 2000;
  const used = Number(data.token_estimate || 0);
  const modules = data.top_modules || [];
  const decisions = data.decisions || [];
  const changes = data.recent_changes || [];
  const stack = data.tech_stack || [];
  output.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Context payload</h3>
        <span class="token-meter">
          <span>${fmtInt(used)} / ${fmtInt(budget)} tokens</span>
          <span class="track"><i style="width:${Math.min(100, (used / Math.max(1, budget)) * 100)}%"></i></span>
          ${data.truncated ? '<span class="pill stale">TRUNCATED</span>' : '<span class="pill ready">COMPLETE</span>'}
        </span>
      </div>
      <div class="context-section">
        <div class="sec-head"><span>PROJECT</span><span>${esc(data.project.name)}</span></div>
        <div class="mono" style="font-size:10.5px;color:var(--dim)">${esc(data.project.root_path)}</div>
        <div class="meta-line">
          <span class="meta-item">nodes <b>${fmtInt(data.stats.nodes)}</b></span>
          <span class="meta-item">relations <b>${fmtInt(data.stats.relations)}</b></span>
          <span class="meta-item">sources <b>${fmtInt(data.stats.sources)}</b></span>
        </div>
      </div>
      <div class="context-section">
        <div class="sec-head"><span>TECH STACK</span><span>${stack.length}</span></div>
        ${stack.length ? `<div class="chips">${stack.map((item) => `<span class="chip mono">${esc(item)}</span>`).join('')}</div>` : '<div style="color:var(--dim);font-size:11px">empty</div>'}
      </div>
      <div class="context-section">
        <div class="sec-head"><span>TOP MODULES</span><span>${modules.length}</span></div>
        ${modules.length ? `<table class="table" style="margin:-4px -14px;width:calc(100% + 28px)">
          <thead><tr><th>Title</th><th>Path</th><th>Reason</th><th style="text-align:right">Salience</th></tr></thead>
          <tbody>${modules.map((module) => `
            <tr class="clickable" data-node="${esc(module.node_id)}">
              <td class="title-cell"><span class="type-badge type-${esc(module.node_type)}" style="margin-right:6px">${esc(module.node_type)}</span>${esc(module.title)}</td>
              <td class="path">${esc(module.path || '—')}</td>
              <td>${reasonBadge(module.reason)}</td>
              <td class="num">${Number(module.salience || 0).toFixed(2)}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<div style="color:var(--dim);font-size:11px">empty</div>'}
      </div>
      <div class="context-section">
        <div class="sec-head"><span>DECISIONS</span><span>${decisions.length}</span></div>
        ${decisions.length ? `<ul class="list" style="margin:-4px -14px">${decisions.map((item) => `
          <li class="clickable-row" data-node="${esc(item.node_id)}" style="cursor:pointer">
            <span class="dot" style="background:rgba(255,255,255,0.55)"></span>
            <div class="li-main"><div class="li-title">${esc(item.title)}</div><div class="li-sub">${esc(truncate(item.summary || '', 110))}</div></div>
          </li>`).join('')}</ul>` : '<div style="color:var(--dim);font-size:11px">empty</div>'}
      </div>
      <div class="context-section">
        <div class="sec-head"><span>RECENT CHANGES</span><span>${changes.length}</span></div>
        ${changes.length ? changes.map((change) => `<div class="stat-line"><span class="k mono" style="font-size:10.5px">${esc(change.path)}</span><span class="v">${esc(fmtRel(change.updated_at))}</span></div>`).join('') : '<div style="color:var(--dim);font-size:11px">empty</div>'}
      </div>
      <div class="context-section">
        <details class="raw"><summary>raw JSON payload</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>
      </div>
    </div>`;
  output.querySelectorAll('[data-node]').forEach((row) => {
    row.addEventListener('click', () => openNode(row.dataset.node));
  });
}

/* --------------------------------------------------------------- indexing */

async function renderIndexing() {
  const status = await api(`/projects/${state.projectId}/status`);
  const run = status.last_run;
  const stats = status.stats || {};
  const tasks = status.tasks || {};
  const project = status.project;
  const command = `synapse index ${project.slug}`;
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Indexing</h1>
        <p class="page-sub">Index runs are explicit and project-locked. This GUI never watches the filesystem.</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="pill ${run && run.status === 'succeeded' ? 'ready' : run ? 'stale' : 'none'}">${esc(run ? String(run.status).toUpperCase() : 'NO RUN')}</span>
        <button class="btn primary" id="index-run">${icon('i-refresh')}<span>Reindex</span></button>
      </div>
    </div>
    <div class="grid kpi">
      <div class="panel kpi-card"><div class="kpi-label">LAST INDEXED</div><div class="kpi-value" style="font-size:17px">${esc(fmtRel(project.last_indexed_at))}</div><div class="kpi-foot mono">${esc(fmtDate(project.last_indexed_at))}</div></div>
      <div class="panel kpi-card"><div class="kpi-label">ACTIVE SOURCES</div><div class="kpi-value">${fmtInt(stats.sources)}</div><div class="kpi-foot">files and documents</div></div>
      <div class="panel kpi-card"><div class="kpi-label">PENDING TASKS</div><div class="kpi-value">${fmtInt(Number(tasks.queued || 0) + Number(tasks.running || 0))}</div><div class="kpi-foot">queued + running</div></div>
      <div class="panel kpi-card"><div class="kpi-label">FAILED TASKS</div><div class="kpi-value ${tasks.failed ? 'warn' : ''}">${fmtInt(tasks.failed)}</div><div class="kpi-foot">retried up to max_attempts</div></div>
    </div>
    <div class="grid two">
      <div class="panel">
        <div class="panel-head"><h3>Last run</h3><span class="aside mono">${run ? esc(truncate(run.id, 18)) : ''}</span></div>
        <div class="panel-body">
          ${run ? `
            <div class="stat-line"><span class="k">status</span><span class="v"><span class="run-status ${esc(run.status)}"><span class="dot"></span>${esc(run.status)}</span></span></div>
            <div class="stat-line"><span class="k">mode</span><span class="v">${esc(run.mode)}</span></div>
            <div class="stat-line"><span class="k">started</span><span class="v">${esc(fmtDate(run.started_at))}</span></div>
            <div class="stat-line"><span class="k">finished</span><span class="v">${esc(fmtDate(run.finished_at))}</span></div>
            <div class="stat-line"><span class="k">duration</span><span class="v">${fmtInt(run.stats && run.stats.duration_ms)} ms</span></div>
            <div class="stat-line"><span class="k">scanned</span><span class="v">${fmtInt(run.stats && run.stats.scanned)}</span></div>
            <div class="stat-line"><span class="k">changed / unchanged</span><span class="v">${fmtInt(run.stats && run.stats.changed)} / ${fmtInt(run.stats && run.stats.unchanged)}</span></div>
            <div class="stat-line"><span class="k">deleted / renamed</span><span class="v">${fmtInt(run.stats && run.stats.deleted)} / ${fmtInt(run.stats && run.stats.renamed)}</span></div>
            <div class="stat-line"><span class="k">nodes upserted / removed</span><span class="v">${fmtInt(run.stats && run.stats.nodes_upserted)} / ${fmtInt(run.stats && run.stats.nodes_removed)}</span></div>
            <div class="stat-line"><span class="k">relations upserted</span><span class="v">${fmtInt(run.stats && run.stats.relations_upserted)}</span></div>
            <div class="stat-line"><span class="k">resolved / unresolved</span><span class="v">${fmtInt(run.stats && run.stats.resolved)} / ${fmtInt(run.stats && run.stats.unresolved)}</span></div>
            <div class="stat-line"><span class="k">failed files</span><span class="v">${fmtInt(run.stats && run.stats.failed)}</span></div>
            ${run.error ? `<div class="error-box" style="margin-top:10px">${esc(truncate(run.error, 500))}</div>` : ''}
          ` : `<div class="empty">该项目还没有索引记录。<br/>执行 <code>${esc(command)}</code>。</div>`}
        </div>
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><h3>Task queue</h3><span class="aside">all time</span></div>
          <div class="panel-body">
            ${['queued', 'running', 'succeeded', 'failed', 'canceled'].map((key) => `
              <div class="stat-line"><span class="k">${key}</span><span class="v">${fmtInt(tasks[key])}</span></div>`).join('')}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Manual refresh</h3><span class="aside">CLI</span></div>
          <div class="panel-body">
            <div class="field">
              <span>COMMAND</span>
              <div style="display:flex;gap:8px">
                <input class="input mono" id="index-command" value="${esc(command)}" readonly />
                <button class="btn ghost" id="index-copy">${icon('i-key')}<span>Copy</span></button>
              </div>
            </div>
            <p style="font-size:11px;color:var(--dim);margin:10px 0 0;line-height:1.6">
              同一项目同一时间只允许一个索引进程（项目级 FileLock）。索引完成后刷新本页即可看到新的统计。
            </p>
          </div>
        </div>
      </div>
    </div>`;
  $('#index-copy').addEventListener('click', () => copyText(command));
  $('#index-run').addEventListener('click', async () => {
    const button = $('#index-run');
    button.disabled = true;
    button.innerHTML = `${icon('i-refresh')}<span>Indexing…</span>`;
    try {
      const result = await api(`/projects/${state.projectId}/index`, { method: 'POST' });
      const stats = (result && result.stats) || {};
      toast(`索引完成：${fmtInt(stats.changed)} 个变更，${fmtInt(stats.nodes_upserted)} 个节点`);
      await connect();
    } catch (err) {
      toast(`索引失败：${err.message}`, true);
      button.disabled = false;
      button.innerHTML = `${icon('i-refresh')}<span>Reindex</span>`;
    }
  });
  view.querySelectorAll('[data-node]').forEach((row) => {
    row.addEventListener('click', () => openNode(row.dataset.node));
  });
}

/* --------------------------------------------------------------- inspector */

async function openNode(nodeId) {
  if (!nodeId) return;
  inspector.hidden = false;
  inspectorBody.innerHTML = `<div class="skeleton" style="width:40%"></div><div class="skeleton" style="width:80%;margin-top:12px"></div><div class="skeleton" style="height:100px;margin-top:18px"></div>`;
  try {
    const data = await api(`/projects/${state.projectId}/nodes/${nodeId}`);
    const node = data.node;
    let memory = null;
    if (node.node_type === 'memory' || node.node_type === 'note') {
      try {
        memory = await api(`/projects/${state.projectId}/memories/${nodeId}`);
      } catch (err) {
        memory = null;
      }
    }
    renderInspector(node, data.related || {}, memory);
  } catch (err) {
    inspectorBody.innerHTML = `<div class="error-box">节点加载失败：${esc(err.message)}</div>`;
  }
}

function renderInspector(node, related, memory) {
  const relationBuckets = Object.entries(related);
  const content = memory ? memory.content : node.content_preview;
  const truncated = memory ? false : node.content_truncated;
  const relatedHtml = relationBuckets
    .filter(([, items]) => items.length)
    .map(([bucket, items]) => `
      <div class="related-group">
        <span class="section-kicker">${esc(bucket)} · ${items.length}</span>
        ${items.map((item) => `
          <button class="related-item" data-node="${esc(item.node_id)}">
            ${typeBadge(item.node_type)}
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.title)}</span>
            <span class="rel">${esc(item.relation_type)}</span>
          </button>`).join('')}
      </div>`).join('');

  inspectorBody.innerHTML = `
    <div class="chips">
      ${typeBadge(node.node_type)}
      ${node.memory_type ? `<span class="chip active">${esc(MEMORY_LABELS[node.memory_type] || node.memory_type)}</span>` : ''}
      <span class="chip">v${esc(node.version)}</span>
    </div>
    <h2>${esc(node.title)}</h2>
    <div class="mono" style="font-size:10.5px;color:var(--dim);word-break:break-all">${esc(node.path || 'no path')}${node.start_line ? `:${node.start_line}-${node.end_line || node.start_line}` : ''}</div>
    <dl class="kv">
      <dt>language</dt><dd>${esc(node.language || '—')}</dd>
      <dt>salience</dt><dd>${Number(node.salience || 0).toFixed(2)}</dd>
      <dt>confidence</dt><dd>${Number(node.confidence || 0).toFixed(2)}</dd>
      <dt>provenance</dt><dd>${esc(node.provenance)}</dd>
      <dt>updated</dt><dd>${esc(fmtDate(node.updated_at))}</dd>
      <dt>node id</dt><dd>${esc(node.node_id)}</dd>
    </dl>
    ${node.summary ? `<span class="section-kicker">SUMMARY</span><div style="font-size:11.5px;color:var(--muted)">${esc(node.summary)}</div>` : ''}
    <span class="section-kicker">CONTENT ${truncated ? '· TRUNCATED' : ''}</span>
    <div class="preview">${esc(content || '（无内容）')}</div>
    ${(node.tags || []).length ? `<span class="section-kicker">TAGS</span><div class="chips">${node.tags.map((tag) => `<span class="chip">#${esc(tag)}</span>`).join('')}</div>` : ''}
    <div class="inspector-actions">
      <button class="btn primary" id="inspector-graph">${icon('i-graph')}<span>在图谱中查看</span></button>
      ${state.graph ? `<button class="btn ghost" id="inspector-expand">${icon('i-arrow')}<span>展开邻居</span></button>` : ''}
      <button class="btn ghost" id="inspector-copy">${icon('i-key')}<span>复制 ID</span></button>
    </div>
    <span class="section-kicker">RELATIONS</span>
    ${relatedHtml || '<div style="color:var(--dim);font-size:11px">该节点暂未解析出关系。</div>'}`;

  inspectorBody.querySelectorAll('[data-node]').forEach((button) => {
    button.addEventListener('click', () => openNode(button.dataset.node));
  });
  $('#inspector-copy').addEventListener('click', () => copyText(node.node_id));
  $('#inspector-graph').addEventListener('click', () => {
    state.pendingFocus = node.node_id;
    if (state.route === 'graph' && state.graph) {
      state.graph.focusNode(node.node_id);
    } else {
      location.hash = '#/graph';
    }
  });
  const expand = $('#inspector-expand');
  if (expand) {
    expand.addEventListener('click', async () => {
      if (!state.graph) return;
      try {
        const data = await api(`/projects/${state.projectId}/graph/${node.node_id}/neighbors`, { params: { depth: 1, direction: 'both', limit: 60 } });
        const added = state.graph.merge(data);
        state.graph.select(node.node_id);
        toast(added ? `已合并 ${added} 个相邻节点` : '没有新的相邻节点');
      } catch (err) {
        toast(`展开失败：${err.message}`, true);
      }
    });
  }
}

function closeInspector() {
  inspector.hidden = true;
  inspectorBody.innerHTML = '';
}

/* -------------------------------------------------------- token / onboarding */

function openTokenModal(message) {
  tokenModal.hidden = false;
  tokenInput.value = state.token || '';
  $('#token-hint').textContent = message || '令牌仅保存在当前浏览器会话（sessionStorage）。';
  setTimeout(() => tokenInput.focus(), 30);
}

function closeTokenModal() {
  tokenModal.hidden = true;
}

function renderOnboarding() {
  const missingToken = !state.token;
  view.innerHTML = `
    <div class="onboard">
      <h1>一个项目知识库，供所有 Agent 使用</h1>
      <p>Synapse 分析代码仓库，建立代码知识图谱与项目记忆，再通过 MCP、CLI 和这个 GUI 提供同一份项目上下文。</p>
      ${missingToken ? '<div class="error-box" style="margin-bottom:14px">尚未连接：请先在左下角输入访问令牌。</div>' : ''}
      <div class="panel" style="margin-bottom:14px">
        <div class="panel-head"><h3>Start here</h3><span class="aside">CLI</span></div>
        <div class="panel-body">
          <ol>
            <li>注册项目并建立索引</li>
          </ol>
          <pre>synapse projects register . --index</pre>
          <ol start="2">
            <li>写入第一条项目决策</li>
          </ol>
          <pre>synapse remember . "使用 SQLite FTS5 做本地检索" --type decision --title "检索选型"</pre>
          <p class="note">MCP、CLI 与 GUI 读取同一个 <code>SYNAPSE_HOME/synapse.db</code>。可用 <code>SYNAPSE_HOME</code> 指定数据目录。</p>
        </div>
      </div>
      <button class="btn primary" id="onboard-retry">${icon('i-refresh')}<span>重新连接</span></button>
    </div>`;
  setConnection('ok');
  const retry = $('#onboard-retry');
  if (retry) retry.addEventListener('click', () => connect());
}

/* -------------------------------------------------------------------- boot */

function wireChrome() {
  for (const button of document.querySelectorAll('.nav-item')) {
    button.addEventListener('click', () => { location.hash = `#/${button.dataset.route}`; });
  }
  projectSelect.addEventListener('change', () => {
    state.projectId = projectSelect.value;
    state.project = state.projects.find((project) => project.id === state.projectId) || null;
    localStorage.setItem('synapse.project', state.projectId);
    state.memory = { type: '', q: '', selected: null };
    state.search.last = null;
    syncProjectChrome();
    onRoute();
  });
  $('#refresh-btn').addEventListener('click', () => {
    if (!state.projects.length) connect();
    else onRoute();
  });
  $('#token-btn').addEventListener('click', () => openTokenModal());
  $('#inspector-close').addEventListener('click', closeInspector);
  $('#token-connect').addEventListener('click', async () => {
    const value = tokenInput.value.trim();
    if (!value) {
      $('#token-hint').textContent = '请输入令牌。';
      return;
    }
    state.token = value;
    sessionStorage.setItem('synapse.token', value);
    closeTokenModal();
    await connect();
  });
  tokenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('#token-connect').click();
  });
  tokenModal.addEventListener('click', (event) => {
    if (event.target === tokenModal) closeTokenModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeInspector();
      closeTokenModal();
    }
  });
  window.addEventListener('hashchange', () => {
    if (state.projects.length) onRoute();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateIndexPill();
  });
  const zoomObserver = new MutationObserver(() => {
    if (state.graph) updateZoomHud(state.graph);
  });
  zoomObserver.observe(document.body, { subtree: true, childList: true });
  setInterval(() => { if (state.graph) updateZoomHud(state.graph); }, 400);
}

function boot() {
  state.token = readToken();
  wireChrome();
  if (!state.token) {
    setConnection('err');
    renderOnboarding();
    openTokenModal();
    return;
  }
  connect();
}

document.addEventListener('DOMContentLoaded', boot);
