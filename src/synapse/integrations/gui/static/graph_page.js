'use strict';

/**
 * Knowledge Graph workbench: four lenses over one knowledge store.
 * Loaded before app.js; only touches app globals when its functions run.
 */
(function (global) {
  var ROOT_ID = 'group:root';
  var LIMITS = [40, 80, 120, 200];
  var MEMORY_FILTERS = [
    { value: '', label: 'all' },
    { value: 'decision', label: 'decision' },
    { value: 'fact', label: 'fact' },
    { value: 'experience', label: 'experience' },
    { value: 'preference', label: 'preference' },
    { value: 'summary', label: 'summary' }
  ];

  function G() {
    return global.SynapseGraph;
  }

  function ensureStores() {
    if (!state.graphStores || state.graphProject !== state.projectId) {
      state.graphStores = {};
      state.graphProject = state.projectId;
      state.graphView = 'architecture';
      state.graphDetailId = null;
    }
    return state.graphStores;
  }

  function cfgFor(viewId) {
    var stores = ensureStores();
    if (!stores[viewId]) {
      var view = G().viewFor(viewId);
      stores[viewId] = {
        store: G().createStore(viewId),
        types: new Set(view.nodeTypes),
        relations: new Set(),
        maxNodes: 80,
        search: '',
        memoryType: '',
        loaded: false,
        truncated: false,
        capabilities: null,
        total: null
      };
    }
    return stores[viewId];
  }

  function currentView() {
    return G().VIEWS[state.graphView] ? state.graphView : 'architecture';
  }

  /* ------------------------------------------------------------- rendering */

  function placeholder(viewId) {
    if (viewId === 'memory') return '搜索记忆内容或关键词';
    if (viewId === 'documentation') return '搜索文档标题';
    if (viewId === 'symbols') return '搜索类、函数或方法';
    return '搜索文件或目录';
  }

  function memoryFilterHtml(cfg) {
    return '<div class="group"><span class="group-label">MEMORY</span><div class="chips" id="graph-memory-type">' +
      MEMORY_FILTERS.map(function (item) {
        return '<button class="chip clickable' + (cfg.memoryType === item.value ? ' active' : '') +
          '" data-memory-type="' + item.value + '">' + item.label + '</button>';
      }).join('') +
      '</div></div>';
  }

  function shellHtml(viewId, cfg) {
    var view = G().viewFor(viewId);
    var tabs = G().VIEW_ORDER.map(function (id) {
      return '<button class="graph-tab' + (id === viewId ? ' active' : '') + '" data-view="' +
        id + '" role="tab">' + esc(G().VIEWS[id].label) + '</button>';
    }).join('');
    var limitOptions = LIMITS.map(function (value) {
      return '<option value="' + value + '"' + (value === cfg.maxNodes ? ' selected' : '') + '>' + value + '</option>';
    }).join('');
    return '<div class="graph-layout">' +
      '<div class="graph-tabs" role="tablist">' + tabs +
        '<span class="graph-tabs-note">one knowledge store &middot; four lenses</span>' +
      '</div>' +
      '<div class="panel graph-toolbar">' +
        '<form class="graph-search" id="graph-search-form">' + icon('i-search') +
          '<input id="graph-q" placeholder="' + esc(placeholder(viewId)) + '" value="' + esc(cfg.search) +
          '" autocomplete="off" spellcheck="false" />' +
        '</form>' +
        (viewId === 'memory' ? memoryFilterHtml(cfg) : '') +
        '<div class="group"><span class="group-label">TYPE</span><div class="chips" id="graph-types"></div></div>' +
        '<div class="group"><span class="group-label">RELATION</span><div class="chips" id="graph-relations"></div></div>' +
        '<div class="group"><span class="group-label">LIMIT</span><select class="select" id="graph-limit">' +
          limitOptions + '</select></div>' +
        '<div class="spacer"></div>' +
        '<button class="btn ghost" id="graph-fit" type="button">Fit</button>' +
        '<button class="btn ghost" id="graph-reload" type="button">Reload</button>' +
      '</div>' +
      '<div class="graph-body">' +
        '<div class="graph-stage" id="graph-stage">' +
          '<canvas id="graph-canvas"></canvas>' +
          '<div class="graph-hud"><div class="row"><span><b id="hud-nodes">0</b> nodes</span>' +
            '<span><b id="hud-edges">0</b> edges</span><span><b id="hud-zoom">100%</b> zoom</span></div>' +
            '<div class="row" id="hud-hint">' + esc(view.hint) + '</div></div>' +
          '<div class="graph-legend" id="graph-legend"></div>' +
          '<div class="graph-empty" id="graph-empty" hidden></div>' +
          '<div class="graph-truncated" id="graph-truncated" hidden><span class="pill stale">TRUNCATED</span></div>' +
          '<div class="graph-tip" id="graph-tip" hidden></div>' +
        '</div>' +
        '<aside class="graph-detail" id="graph-detail"><div class="detail-empty">选择一个节点查看详情</div></aside>' +
      '</div>' +
      '<div class="graph-statusbar">' +
        '<span>NODES <b id="graph-node-count">0</b></span>' +
        '<span>RELATIONS <b id="graph-edge-count">0</b></span>' +
        '<span>VIEW <b>' + esc(view.label) + '</b></span>' +
        '<span class="spacer"></span>' +
        '<span class="graph-status-note" id="graph-status-note"></span>' +
      '</div>' +
      '</div>';
  }

  function applyRouteView() {
    var raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    var parts = raw.split('/');
    if (parts[0] === 'graph' && G().VIEWS[parts[1]]) {
      state.graphView = parts[1];
    }
    var params = routeParams();
    if (params.get('node')) state.pendingFocus = params.get('node');
  }

  async function render() {
    ensureStores();
    applyRouteView();
    var viewId = currentView();
    state.graphView = viewId;
    var cfg = cfgFor(viewId);
    view.innerHTML = shellHtml(viewId, cfg);
    var canvas = document.getElementById('graph-canvas');
    var tip = document.getElementById('graph-tip');
    var graph = new GraphView(canvas, tip, function (id) {
      selectNode(id);
    });
    graph.onExpand = function (id) {
      expandNode(id);
    };
    state.graph = graph;
    state.cleanup = function () {
      graph.stop();
      state.graph = null;
    };
    wireShell();
    syncControls();
    updateZoomHud(graph);
    if (!cfg.loaded) {
      await loadRoot(viewId);
    } else {
      syncControls();
      paint({});
      await applyPendingFocus(state.graphEpoch);
    }
    return undefined;
  }

  function toRenderNode(node, cfg) {
    return {
      id: node.id,
      title: node.title,
      type: node.node_type,
      kind: node.kind,
      synthetic: node.synthetic,
      path: node.path,
      lines: node.start_line ? node.start_line + '-' + (node.end_line || node.start_line) : '',
      salience: node.salience,
      expandable: Boolean(node.expandable),
      expanded: cfg.store.expanded.has(node.id)
    };
  }

  function paint(options) {
    var opts = options || {};
    var cfg = cfgFor(currentView());
    var graph = state.graph;
    if (!graph) return;
    var visible = new Set();
    cfg.store.nodes.forEach(function (node) {
      if (node.synthetic || cfg.types.has(node.node_type) || node.id === graph.selected) {
        visible.add(node.id);
      }
    });
    var nodes = [];
    visible.forEach(function (id) {
      var node = cfg.store.nodes.get(id);
      if (node) nodes.push(toRenderNode(node, cfg));
    });
    var edges = G().filterEdges(G().visibleEdges(cfg.store), cfg.relations)
      .filter(function (edge) {
        return visible.has(edge.from) && visible.has(edge.to);
      })
      .map(function (edge) {
        return {
          from: edge.from,
          to: edge.to,
          type: edge.relation_type,
          confidence: edge.confidence,
          synthetic: edge.synthetic
        };
      });
    var first = graph.nodes.length === 0;
    graph.setData(nodes, edges, { fit: first && opts.fit !== false });
    renderChrome();
  }

  function renderChrome() {
    var cfg = cfgFor(currentView());
    var stats = G().stats(cfg.store);
    setText('hud-nodes', stats.nodes);
    setText('hud-edges', stats.edges);
    setText('graph-node-count', stats.nodes);
    setText('graph-edge-count', stats.edges);
    var legend = Object.keys(stats.byType).sort(function (a, b) {
      return stats.byType[b] - stats.byType[a];
    }).map(function (type) {
      var color = type === 'directory' ? '#3f3f46' : NODE_COLORS[type] || '#a1a1aa';
      return '<span class="lg"><span class="sw" style="background:' + color + '"></span>' +
        esc(type) + ' ' + stats.byType[type] + '</span>';
    }).join('');
    var legendEl = document.getElementById('graph-legend');
    if (legendEl) legendEl.innerHTML = legend;
    var empty = document.getElementById('graph-empty');
    if (empty) {
      if (!stats.nodes) {
        empty.hidden = false;
        empty.innerHTML = '<div class="empty-title">Nothing loaded yet</div><div class="empty-detail">' +
          esc(G().viewFor(currentView()).hint) + '</div>';
      } else {
        empty.hidden = true;
      }
    }
    var truncated = document.getElementById('graph-truncated');
    if (truncated) truncated.hidden = !cfg.truncated;
    var note = document.getElementById('graph-status-note');
    if (note) {
      var bits = [];
      var i18n = global.SynapseI18n;
      if (stats.synthetic) {
        bits.push(i18n ? i18n.t('graph.status.groups', { n: stats.synthetic }) : stats.synthetic + ' derived groups');
      }
      if (cfg.total != null) {
        bits.push(i18n ? i18n.t('graph.status.memories', { n: cfg.total }) : cfg.total + ' memories total');
      }
      if (cfg.truncated) {
        bits.push(i18n ? i18n.t('graph.status.truncated') : 'result truncated by LIMIT');
      }
      note.textContent = bits.join(' · ');
    }
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }

  function syncControls() {
    var cfg = cfgFor(currentView());
    var stats = G().stats(cfg.store);
    var caps = cfg.capabilities || {};
    var nodeCounts = caps.node_counts || {};
    var typesEl = document.getElementById('graph-types');
    if (typesEl) {
      typesEl.innerHTML = G().viewFor(currentView()).nodeTypes.map(function (type) {
        var count = Number(nodeCounts[type] || 0);
        var active = cfg.types.has(type);
        return '<button class="chip clickable' + (active ? ' active' : '') + '" data-type="' + type + '"' +
          (count ? '' : ' title="该项目暂无此类节点"') + '>' +
          '<span class="swatch" style="background:' + (NODE_COLORS[type] || '#a1a1aa') + '"></span>' +
          type + ' <b>' + count + '</b></button>';
      }).join('');
    }
    var relationsEl = document.getElementById('graph-relations');
    if (relationsEl) {
      var options = G().relationOptions(currentView(), caps.relation_counts || {}, G().relationCounts(cfg.store));
      if (!options.length) {
        relationsEl.innerHTML = '<span class="graph-inline-note">no relations in this view yet</span>';
      } else {
        relationsEl.innerHTML = options.map(function (type) {
          var active = cfg.relations.has(type);
          var count = Number((caps.relation_counts || {})[type] || 0);
          return '<button class="chip clickable' + (active ? ' active' : '') + '" data-relation="' + type + '">' +
            type + ' <b>' + count + '</b></button>';
        }).join('');
      }
    }
    var search = document.getElementById('graph-q');
    if (search && search.value !== cfg.search) search.value = cfg.search;
    var limit = document.getElementById('graph-limit');
    if (limit) limit.value = String(cfg.maxNodes);
    var memoryChips = document.querySelectorAll('[data-memory-type]');
    for (var i = 0; i < memoryChips.length; i += 1) {
      memoryChips[i].classList.toggle('active', memoryChips[i].dataset.memoryType === cfg.memoryType);
    }
    if (stats.nodes === 0) renderChrome();
  }

  function wireShell() {
    var tabs = document.querySelectorAll('[data-view]');
    for (var i = 0; i < tabs.length; i += 1) {
      tabs[i].addEventListener('click', function (event) {
        switchView(event.currentTarget.dataset.view);
      });
    }
    document.getElementById('graph-types').addEventListener('click', function (event) {
      var chip = event.target.closest('[data-type]');
      if (!chip) return;
      var type = chip.dataset.type;
      var cfg = cfgFor(currentView());
      if (cfg.types.has(type)) cfg.types.delete(type);
      else cfg.types.add(type);
      if (!cfg.types.size) cfg.types.add(type);
      syncControls();
      paint({ fit: false });
    });
    document.getElementById('graph-relations').addEventListener('click', function (event) {
      var chip = event.target.closest('[data-relation]');
      if (!chip) return;
      var cfg = cfgFor(currentView());
      var type = chip.dataset.relation;
      if (cfg.relations.has(type)) cfg.relations.delete(type);
      else cfg.relations.add(type);
      syncControls();
      paint({ fit: false });
    });
    var memoryChips = document.querySelectorAll('[data-memory-type]');
    for (var j = 0; j < memoryChips.length; j += 1) {
      memoryChips[j].addEventListener('click', function (event) {
        var cfg = cfgFor(currentView());
        cfg.memoryType = event.currentTarget.dataset.memoryType;
        syncControls();
        loadRoot('memory');
      });
    }
    document.getElementById('graph-limit').addEventListener('change', function (event) {
      var cfg = cfgFor(currentView());
      cfg.maxNodes = Number(event.target.value) || 80;
      loadRoot(currentView());
    });
    document.getElementById('graph-search-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var input = document.getElementById('graph-q');
      var cfg = cfgFor(currentView());
      cfg.search = input ? input.value.trim() : '';
      runSearch();
    });
    document.getElementById('graph-fit').addEventListener('click', function () {
      if (state.graph) state.graph.fit();
    });
    document.getElementById('graph-reload').addEventListener('click', function () {
      loadRoot(currentView());
    });
    var stage = document.getElementById('graph-stage');
    if (stage) {
      stage.addEventListener('click', function (event) {
        if (event.target === stage || event.target.id === 'graph-canvas') return;
      });
    }
  }

  async function switchView(viewId) {
    if (!G().VIEWS[viewId] || viewId === state.graphView) return;
    state.graphView = viewId;
    if (location.hash.indexOf('#/graph/' + viewId) !== 0) {
      history.replaceState(null, '', '#/graph/' + viewId);
    }
    state.graphDetailId = null;
    state.graphEpoch = (state.graphEpoch || 0) + 1;
    var cfg = cfgFor(viewId);
    if (state.graph) {
      state.graph.clearSelection();
      state.graph.setData([], [], { fit: false });
    }
    var tabs = document.querySelectorAll('[data-view]');
    for (var i = 0; i < tabs.length; i += 1) {
      tabs[i].classList.toggle('active', tabs[i].dataset.view === viewId);
    }
    view.innerHTML = shellHtml(viewId, cfg);
    var canvas = document.getElementById('graph-canvas');
    var old = state.graph;
    if (old) old.stop();
    var graph = new GraphView(canvas, document.getElementById('graph-tip'), function (id) {
      selectNode(id);
    });
    graph.onExpand = function (id) {
      expandNode(id);
    };
    state.graph = graph;
    state.cleanup = function () {
      graph.stop();
      state.graph = null;
    };
    wireShell();
    syncControls();
    updateZoomHud(graph);
    if (!cfg.loaded) {
      await loadRoot(viewId);
    } else {
      paint({});
    }
  }

  /* ------------------------------------------------------------- data load */

  async function loadRoot(viewId) {
    var cfg = cfgFor(viewId);
    var epoch = (state.graphEpoch || 0) + 1;
    state.graphEpoch = epoch;
    G().reset(cfg.store);
    cfg.truncated = false;
    cfg.loaded = false;
    cfg.total = null;
    state.graphDetailId = null;
    closeDetail();
    if (state.graph) state.graph.clearSelection();
    setBusy(true);
    try {
      var caps = await api('/projects/' + state.projectId + '/graph/capabilities');
      if (epoch !== state.graphEpoch) return;
      cfg.capabilities = caps;
      if (viewId === 'architecture') await seedArchitecture(cfg, epoch);
      else if (viewId === 'symbols') await seedSymbols(cfg, epoch);
      else if (viewId === 'documentation') await seedDocumentation(cfg, epoch);
      else await seedMemory(cfg, epoch);
      if (epoch !== state.graphEpoch) return;
      cfg.loaded = true;
      syncControls();
      paint({ fit: true });
      await applyPendingFocus(epoch);
    } catch (err) {
      if (epoch !== state.graphEpoch) return;
      var empty = document.getElementById('graph-empty');
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = '<div class="empty-title">Load failed</div><div class="empty-detail">' +
          esc(err.message) + '</div><div class="empty-detail">Reload to retry.</div>';
      }
      toast('图谱加载失败：' + err.message, true);
    } finally {
      if (epoch === state.graphEpoch) setBusy(false);
    }
  }

  function setBusy(busy) {
    var stage = document.getElementById('graph-stage');
    if (stage) stage.classList.toggle('busy', Boolean(busy));
  }

  function markExpanded(store, id) {
    store.expanded.add(id);
    var node = store.nodes.get(id);
    if (node) node.expanded = true;
  }

  function absorbStructure(store, payload, parentId) {
    (payload.directories || []).forEach(function (dir) {
      var id = 'dir:' + dir.path;
      G().addSyntheticGroup(store, {
        id: id,
        title: dir.name,
        path: dir.path,
        count: Number(dir.files || 0) + Number(dir.documents || 0),
        meta: {
          kind: 'directory',
          files: dir.files,
          documents: dir.documents,
          symbols: dir.symbols,
          sections: dir.sections
        }
      }, parentId);
    });
    (payload.files || []).forEach(function (file) {
      var childId = file.node_id;
      if (!childId) return;
      var expandable = Number(file.symbols || 0) + Number(file.sections || 0) > 0;
      G().addPayload(store, {
        nodes: [{
          node_id: childId,
          node_type: file.node_type,
          title: file.title,
          path: file.path,
          salience: 0.5,
          expandable: expandable,
          meta: { symbols: file.symbols, sections: file.sections }
        }],
        edges: []
      }, { parentId: parentId });
      G().addEdges(store, [{
        from_node_id: parentId,
        to_node_id: childId,
        relation_type: 'CONTAINS',
        confidence: 1,
        synthetic: true
      }]);
    });
    if (parentId) markExpanded(store, parentId);
  }

  async function seedArchitecture(cfg, epoch) {
    var data = await api('/projects/' + state.projectId + '/graph/structure', {
      params: { limit: cfg.maxNodes }
    });
    if (epoch !== state.graphEpoch) return;
    var project = state.project || (state.projects || []).find(function (item) {
      return item.id === state.projectId;
    }) || {};
    var meta = data.meta || {};
    G().addSyntheticGroup(cfg.store, {
      id: ROOT_ID,
      title: project.name || 'project',
      path: '',
      count: Number(meta.file_count || 0),
      meta: {
        kind: 'project',
        files: meta.file_count,
        directories: meta.directory_count,
        root: project.root_path
      }
    }, null);
    absorbStructure(cfg.store, data, ROOT_ID);
    cfg.truncated = Boolean(data.truncated);
  }

  async function seedSymbols(cfg, epoch) {
    var data = await api('/projects/' + state.projectId + '/graph/overview', {
      params: { node_types: 'file', max_nodes: cfg.maxNodes }
    });
    if (epoch !== state.graphEpoch) return;
    G().addPayload(cfg.store, { nodes: data.nodes, edges: data.edges }, {});
    cfg.truncated = Boolean(data.truncated);
  }

  async function seedDocumentation(cfg, epoch) {
    var data = await api('/projects/' + state.projectId + '/graph/overview', {
      params: { node_types: 'document', max_nodes: cfg.maxNodes }
    });
    if (epoch !== state.graphEpoch) return;
    G().addPayload(cfg.store, { nodes: data.nodes, edges: data.edges }, {});
    cfg.truncated = Boolean(data.truncated);
  }

  async function seedMemory(cfg, epoch) {
    var params = { limit: cfg.maxNodes, offset: 0 };
    if (cfg.search) params.q = cfg.search;
    if (cfg.memoryType) params.memory_type = cfg.memoryType;
    var data = await api('/projects/' + state.projectId + '/memories', { params: params });
    if (epoch !== state.graphEpoch) return;
    G().addNodes(cfg.store, (data.memories || []).map(function (item) {
      return {
        node_id: item.node_id,
        node_type: item.node_type || 'memory',
        title: item.title,
        path: null,
        salience: 0.7,
        expandable: false,
        meta: { memory_type: item.memory_type, summary: item.summary }
      };
    }));
    cfg.total = Number(data.total || 0);
    cfg.truncated = (data.memories || []).length < Number(data.total || 0);
  }

  /* --------------------------------------------------------------- search */

  async function runSearch() {
    var viewId = currentView();
    var cfg = cfgFor(viewId);
    if (viewId === 'memory') {
      await loadRoot('memory');
      return;
    }
    var q = (cfg.search || '').trim();
    if (!q) {
      await loadRoot(viewId);
      return;
    }
    var types = (G().viewFor(viewId).searchTypes || G().viewFor(viewId).nodeTypes).join(',');
    var epoch = (state.graphEpoch || 0) + 1;
    state.graphEpoch = epoch;
    try {
      var data = await api('/projects/' + state.projectId + '/search', {
        params: { q: q, node_types: types, limit: 20 }
      });
      if (epoch !== state.graphEpoch) return;
      var results = data.results || [];
      G().addPayload(cfg.store, {
        nodes: results.map(function (item) {
          return {
            node_id: item.node_id,
            node_type: item.node_type,
            title: item.title,
            path: item.path,
            salience: Math.min(1, Number(item.score || 0.6)),
            expandable: true
          };
        }),
        edges: []
      }, {});
      paint({ fit: false });
      if (results.length) {
        state.graph.focusNode(results[0].node_id);
        selectNode(results[0].node_id);
      } else {
        toast('没有匹配的节点');
      }
    } catch (err) {
      toast('搜索失败：' + err.message, true);
    }
  }

  /* --------------------------------------------------------------- expand */

  function planFor(node) {
    var type = node.node_type;
    if (type === 'file' || type === 'document' || type === 'class' || type === 'doc_section') {
      return { direction: 'out', relations: 'CONTAINS' };
    }
    if (type === 'function' || type === 'method') {
      return { direction: 'both', relations: 'CALLS,REFERENCES,IMPORTS,INHERITS' };
    }
    if (type === 'memory' || type === 'note') {
      return { direction: 'both', relations: '' };
    }
    return null;
  }

  async function expandNode(nodeId) {
    var viewId = currentView();
    var cfg = cfgFor(viewId);
    var node = cfg.store.nodes.get(nodeId);
    if (!node || !state.graph) return;
    if (cfg.store.expanded.has(nodeId)) {
      var removed = G().collapseNode(cfg.store, nodeId);
      paint({ fit: false });
      toast(removed ? '已折叠 ' + removed + ' 个子节点' : '已折叠');
      return;
    }
    if (!node.expandable) {
      toast('该节点没有可展开的真实子节点');
      return;
    }
    if (cfg.store.loading.has(nodeId)) return;
    cfg.store.loading.add(nodeId);
    var stage = document.getElementById('graph-stage');
    if (stage) stage.classList.add('busy');
    try {
      var added = 0;
      var found = 0;
      if (node.synthetic) {
        var data = await api('/projects/' + state.projectId + '/graph/structure', {
          params: { path_prefix: node.path, limit: cfg.maxNodes }
        });
        absorbStructure(cfg.store, data, node.id);
        found = (data.directories || []).length + (data.files || []).length;
        added = found;
      } else {
        var plan = planFor(node);
        if (!plan) {
          node.expandable = false;
          toast('该节点类型不支持展开');
          return;
        }
        var params = { depth: 1, direction: plan.direction, limit: 80 };
        if (plan.relations) params.relation_types = plan.relations;
        var payload = await api('/projects/' + state.projectId + '/graph/' + nodeId + '/neighbors', {
          params: params
        });
        var result = G().addPayload(cfg.store, payload, { parentId: nodeId });
        found = (payload.nodes || []).length + (payload.edges || []).length;
        added = result.nodes + result.edges;
        if (found) markExpanded(cfg.store, nodeId);
      }
      if (!found) {
        node.expandable = false;
        toast('没有可展示的真实子节点');
      } else if (!added) {
        toast('相关节点已在图中');
      }
      paint({ fit: false });
      if (nodeId === state.graphDetailId) selectNode(nodeId, { keep: true });
    } catch (err) {
      toast('展开失败：' + err.message, true);
    } finally {
      cfg.store.loading.delete(nodeId);
      if (stage) stage.classList.remove('busy');
    }
  }

  async function openIn(viewId, nodeId) {
    state.graphView = viewId;
    state.graphFocusId = nodeId;
    await render();
  }

  async function applyPendingFocus(epoch) {
    var id = state.graphFocusId || state.pendingFocus;
    if (!id) return;
    state.graphFocusId = null;
    state.pendingFocus = null;
    var cfg = cfgFor(currentView());
    if (!cfg.store.nodes.has(id)) {
      try {
        var data = await api('/projects/' + state.projectId + '/nodes/' + id);
        if (epoch !== state.graphEpoch) return;
        G().addPayload(cfg.store, { nodes: [data.node], edges: [] }, {});
        paint({ fit: false });
      } catch (err) {
        return;
      }
    }
    if (state.graph) state.graph.focusNode(id);
    await selectNode(id);
    var node = cfg.store.nodes.get(id);
    if (node && node.expandable && !cfg.store.expanded.has(id)) {
      await expandNode(id);
    }
  }

  /* --------------------------------------------------------------- detail */

  function closeDetail() {
    var panel = document.getElementById('graph-detail');
    if (panel) {
      panel.classList.remove('has-node');
      panel.innerHTML = '<div class="detail-empty">选择一个节点查看详情</div>';
    }
    if (state.graph) state.graph.clearSelection();
  }

  function rows(items) {
    return items.filter(function (item) {
      return item[1] != null && item[1] !== '';
    }).map(function (item) {
      return '<dt>' + esc(item[0]) + '</dt><dd>' + esc(item[1]) + '</dd>';
    }).join('');
  }

  function groupDetailHtml(node) {
    var meta = node.meta || {};
    return '<div class="detail-head"><span class="type-badge type-directory">directory</span>' +
      '<button class="icon-btn" data-detail-close title="关闭">' + icon('i-close') + '</button></div>' +
      '<h2 class="detail-title">' + esc(node.title) + '</h2>' +
      '<div class="mono detail-path">' + esc(node.path || '/') + '</div>' +
      '<dl class="kv">' + rows([
        ['files', meta.files],
        ['documents', meta.documents],
        ['symbols', meta.symbols],
        ['sections', meta.sections],
        ['grouping', 'derived from node paths']
      ]) + '</dl>' +
      '<div class="detail-note">目录节点是视图层按真实 <code>path</code> 聚合的分组，不是 KnowledgeNode，也没有写入数据库。</div>' +
      '<div class="detail-actions">' +
        '<button class="btn primary" data-action="expand">' + icon('i-arrow') + '展开 / 折叠</button>' +
      '</div>';
  }

  function nodeDetailHtml(node, related, memory, storeNode) {
    var content = memory ? memory.content : node.content_preview;
    var truncatedFlag = memory ? false : node.content_truncated;
    var buckets = Object.keys(related || {});
    var relatedHtml = buckets.filter(function (key) {
      return (related[key] || []).length;
    }).map(function (key) {
      var items = related[key].map(function (item) {
        return '<button class="related-item" data-node="' + esc(item.node_id) + '">' +
          typeBadge(item.node_type) +
          '<span class="rel-title">' + esc(item.title) + '</span>' +
          '<span class="rel">' + esc(item.relation_type) + '</span></button>';
      }).join('');
      return '<div class="related-group"><span class="section-kicker">' + esc(key) + ' · ' +
        related[key].length + '</span>' + items + '</div>';
    }).join('');
    var isMemory = node.node_type === 'memory' || node.node_type === 'note';
    var base = rows([
      ['node type', node.node_type],
      ['node id', node.node_id],
      ['project id', node.project_id],
      ['parent', storeNode && storeNode.meta ? storeNode.meta.parent : null],
      ['file path', node.path],
      ['lines', node.start_line ? node.start_line + '-' + (node.end_line || node.start_line) : null],
      ['language', node.language],
      ['memory type', node.memory_type],
      ['salience', Number(node.salience || 0).toFixed(2)],
      ['confidence', Number(node.confidence || 0).toFixed(2)],
      ['provenance', node.provenance],
      ['created', fmtDate(node.created_at)],
      ['updated', fmtDate(node.updated_at)]
    ]);
    var expandable = storeNode && storeNode.expandable;
    var actions = '<div class="detail-actions">' +
      (expandable ? '<button class="btn primary" data-action="expand">' + icon('i-arrow') + '展开 / 折叠</button>' : '') +
      (node.node_type === 'file' || node.node_type === 'document'
        ? '<button class="btn ghost" data-action="symbols">在 Symbols 中查看</button>'
        : '') +
      '<button class="btn ghost" data-action="copy">' + icon('i-key') + '复制 ID</button>' +
      '</div>';
    return '<div class="detail-head"><span class="type-badge type-' + esc(node.node_type) + '">' +
      esc(node.node_type) + '</span>' +
      (isMemory && node.memory_type ? '<span class="chip active">' + esc(node.memory_type) + '</span>' : '') +
      '<button class="icon-btn" data-detail-close title="关闭">' + icon('i-close') + '</button></div>' +
      '<h2 class="detail-title">' + esc(node.title) + '</h2>' +
      '<div class="mono detail-path">' + esc(node.path || 'no path') +
        (node.start_line ? ':' + node.start_line + '-' + (node.end_line || node.start_line) : '') + '</div>' +
      '<dl class="kv">' + base + '</dl>' +
      (node.summary ? '<span class="section-kicker">SUMMARY</span><div class="detail-text">' + esc(node.summary) + '</div>' : '') +
      (isMemory && (node.tags || []).length
        ? '<span class="section-kicker">TAGS</span><div class="chips">' +
          node.tags.map(function (tag) {
            return '<span class="chip">#' + esc(tag) + '</span>';
          }).join('') + '</div>'
        : '') +
      '<span class="section-kicker">CONTENT' + (truncatedFlag ? ' · TRUNCATED' : '') + '</span>' +
      '<div class="preview">' + esc(content || '（无内容）') + '</div>' +
      actions +
      '<span class="section-kicker">RELATIONS</span>' +
      (relatedHtml || '<div class="detail-text">该节点暂未解析出关系。</div>');
  }

  async function ensureNode(id) {
    var cfg = cfgFor(currentView());
    if (cfg.store.nodes.has(id)) return cfg.store.nodes.get(id);
    var data = await api('/projects/' + state.projectId + '/nodes/' + id);
    G().addPayload(cfg.store, { nodes: [data.node], edges: [] }, {});
    paint({ fit: false });
    return cfg.store.nodes.get(id);
  }

  async function selectNode(nodeId, options) {
    var opts = options || {};
    var cfg = cfgFor(currentView());
    var node = cfg.store.nodes.get(nodeId);
    var panel = document.getElementById('graph-detail');
    state.graphDetailId = nodeId;
    if (!panel) return;
    if (!node) {
      try {
        node = await ensureNode(nodeId);
      } catch (err) {
        panel.classList.add('has-node');
        panel.innerHTML = '<div class="error-box">节点加载失败：' + esc(err.message) + '</div>';
        return;
      }
    }
    if (state.graph) state.graph.select(nodeId);
    panel.classList.add('has-node');
    if (node.synthetic) {
      panel.innerHTML = groupDetailHtml(node);
      wireDetail(panel, node, null);
      return;
    }
    if (opts.keep !== true) {
      panel.innerHTML = '<div class="skeleton" style="width:40%"></div>' +
        '<div class="skeleton" style="width:80%;margin-top:12px"></div>' +
        '<div class="skeleton" style="height:120px;margin-top:18px"></div>';
    }
    var token = (state.graphDetailEpoch || 0) + 1;
    state.graphDetailEpoch = token;
    try {
      var data = await api('/projects/' + state.projectId + '/nodes/' + nodeId);
      if (token !== state.graphDetailEpoch) return;
      var memory = null;
      if (node.node_type === 'memory' || node.node_type === 'note') {
        memory = await api('/projects/' + state.projectId + '/memories/' + nodeId).catch(function () {
          return null;
        });
        if (token !== state.graphDetailEpoch) return;
      }
      panel.innerHTML = nodeDetailHtml(data.node, data.related || {}, memory, node);
      wireDetail(panel, node, data.node);
    } catch (err) {
      if (token !== state.graphDetailEpoch) return;
      panel.innerHTML = '<div class="error-box">节点加载失败：' + esc(err.message) + '</div>';
    }
  }

  function wireDetail(panel, storeNode, detail) {
    var closeBtn = panel.querySelector('[data-detail-close]');
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
    var actions = panel.querySelectorAll('[data-action]');
    for (var i = 0; i < actions.length; i += 1) {
      actions[i].addEventListener('click', function (event) {
        var action = event.currentTarget.dataset.action;
        if (action === 'expand') expandNode(storeNode.id);
        else if (action === 'copy') copyText(storeNode.id);
        else if (action === 'symbols') openIn('symbols', storeNode.id);
      });
    }
    var related = panel.querySelectorAll('[data-node]');
    for (var j = 0; j < related.length; j += 1) {
      related[j].addEventListener('click', function (event) {
        var id = event.currentTarget.dataset.node;
        var cfg = cfgFor(currentView());
        if (!cfg.store.nodes.has(id)) {
          api('/projects/' + state.projectId + '/nodes/' + id).then(function (data) {
            G().addPayload(cfg.store, { nodes: [data.node], edges: [] }, {});
            paint({ fit: false });
            selectNode(id);
          }).catch(function (err) {
            toast('节点加载失败：' + err.message, true);
          });
          return;
        }
        if (state.graph) state.graph.focusNode(id);
        selectNode(id);
      });
    }
    if (detail) {
      var graphBtn = panel.querySelector('[data-action="graph"]');
      if (graphBtn) {
        graphBtn.addEventListener('click', function () {
          if (state.graph) state.graph.focusNode(detail.node_id);
        });
      }
    }
  }

  function updateZoomHud(graph) {
    var hud = document.getElementById('hud-zoom');
    if (!hud || !graph) return;
    var value = Math.round(graph.transform.k * 100) + '%';
    if (hud.textContent !== value) hud.textContent = value;
  }

  global.updateZoomHud = updateZoomHud;
  global.SynapseGraphPage = {
    render: render,
    select: selectNode,
    expand: expandNode,
    openIn: openIn,
    closeDetail: closeDetail
  };
})(typeof window !== 'undefined' ? window : globalThis);
