'use strict';

/**
 * Pure view-model helpers for the Knowledge Graph workbench.
 * No DOM access: the same file is loaded by the GUI and by node --test.
 */
(function (global) {
  const VIEWS = {
    architecture: {
      id: 'architecture',
      label: 'Architecture',
      nodeTypes: ['file', 'document'],
      searchTypes: ['file', 'document'],
      relationTypes: ['CONTAINS', 'IMPORTS', 'REFERENCES'],
      hint: 'Project → directory → file. Expand a node to load only its direct children.',
      hintKey: 'graph.hint.architecture',
    },
    symbols: {
      id: 'symbols',
      label: 'Symbols',
      // Files are the entry points of this view; the symbols themselves are
      // class/function/method. Directories and files are loaded lazily first,
      // then a file expansion reveals its real symbols.
      nodeTypes: ['file', 'class', 'function', 'method'],
      searchTypes: ['class', 'function', 'method'],
      relationTypes: ['CONTAINS', 'CALLS', 'REFERENCES', 'IMPORTS', 'INHERITS'],
      hint: 'Start from a directory, expand a file, then expand a class or function.',
      hintKey: 'graph.hint.symbols',
    },
    documentation: {
      id: 'documentation',
      label: 'Documentation',
      nodeTypes: ['document', 'doc_section'],
      searchTypes: ['document'],
      relationTypes: ['CONTAINS', 'REFERENCES'],
      hint: 'Documents first; expand one to read its section tree.',
      hintKey: 'graph.hint.documentation',
    },
    memory: {
      id: 'memory',
      label: 'Memory',
      nodeTypes: ['memory', 'note'],
      searchTypes: ['memory', 'note'],
      relationTypes: ['EXPLAINS', 'REFERENCES', 'RELATED_TO', 'DERIVED_FROM'],
      hint: 'Durable project memory, filtered by type and keyword.',
      hintKey: 'graph.hint.memory',
    },
  };

  const VIEW_ORDER = ['architecture', 'symbols', 'documentation', 'memory'];

  const NODE_COLORS = {
    project: '#f8fafc',
    directory: '#a78bfa',
    file: '#60a5fa',
    class: '#fbbf24',
    function: '#34d399',
    method: '#2dd4bf',
    document: '#fb7185',
    doc_section: '#f472b6',
    memory: '#c084fc',
    note: '#facc15',
    requirement: '#fb923c',
  };

  const RELATION_COLORS = {
    CONTAINS: '#94a3b8',
    IMPORTS: '#38bdf8',
    CALLS: '#34d399',
    REFERENCES: '#fbbf24',
    INHERITS: '#c084fc',
    EXPLAINS: '#fb7185',
    RELATED_TO: '#22d3ee',
    DERIVED_FROM: '#a3e635',
    DEPENDS_ON: '#f97316',
    SOLVES: '#2dd4bf',
    CONTRADICTS: '#ef4444',
    MENTIONS: '#e879f9',
    DEFINES: '#60a5fa',
    OVERRIDES: '#f59e0b',
    USES: '#f472b6',
  };

  const GRAPH_DISTANCE_MIN = 40;
  const GRAPH_DISTANCE_MAX = 200;
  const DEFAULT_GRAPH_SETTINGS = { nodeDistance: 68 };

  function hashString(value) {
    const text = String(value == null ? '' : value);
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function typeColor(type) {
    return NODE_COLORS[String(type || '')] || '#a1a1aa';
  }

  function nodeColor(node) {
    const type = String((node && node.type) || '');
    if (type === 'file') {
      const key = String((node && (node.path || node.title || node.id)) || '');
      if (!key) return typeColor(type);
      const hue = 195 + (hashString(key) % 55);
      return 'hsl(' + hue + ', 78%, 64%)';
    }
    return typeColor(type);
  }

  function relationColor(type) {
    const key = String(type || '').toUpperCase();
    return RELATION_COLORS[key] || 'hsl(' + (hashString(key) % 360) + ', 72%, 64%)';
  }

  function normalizeGraphSettings(raw) {
    const rawValue = raw && raw.nodeDistance;
    const value = Number(rawValue);
    const valid = rawValue !== undefined && rawValue !== null && rawValue !== '' &&
      Number.isFinite(value);
    const nodeDistance = valid
      ? Math.min(GRAPH_DISTANCE_MAX, Math.max(GRAPH_DISTANCE_MIN, value))
      : DEFAULT_GRAPH_SETTINGS.nodeDistance;
    return { nodeDistance };
  }

  // Node types that can be expanded into their own children.
  const EXPANDABLE_TYPES = new Set([
    'file',
    'document',
    'class',
    'function',
    'method',
    'doc_section',
    'memory',
    'note',
    'directory',
  ]);

  function viewFor(id) {
    return VIEWS[id] || VIEWS.architecture;
  }

  function isCurrent(token, current) {
    return Boolean(token && current && token.epoch === current.epoch && token.view === current.view);
  }

  function createStore(viewId) {
    return {
      view: viewFor(viewId).id,
      nodes: new Map(),
      edges: new Map(),
      parents: new Map(),
      children: new Map(),
      expanded: new Set(),
      loading: new Set(),
      errors: new Map(),
    };
  }

  function reset(store) {
    store.nodes.clear();
    store.edges.clear();
    store.parents.clear();
    store.children.clear();
    store.expanded.clear();
    store.loading.clear();
    store.errors.clear();
    return store;
  }

  function countOf(node) {
    const value = Number(node && node.count);
    return Number.isFinite(value) ? value : 0;
  }

  function normalizeNode(raw) {
    const type = String(raw.node_type || raw.type || 'file');
    return {
      id: String(raw.node_id || raw.id),
      node_type: type,
      title: String(raw.title || raw.node_id || ''),
      path: raw.path || null,
      start_line: raw.start_line || null,
      end_line: raw.end_line || null,
      salience: Number(raw.salience == null ? 0.5 : raw.salience),
      synthetic: Boolean(raw.synthetic),
      kind: raw.synthetic ? 'group' : 'node',
      expandable: raw.expandable == null ? EXPANDABLE_TYPES.has(type) : Boolean(raw.expandable),
      expanded: false,
      count: countOf(raw),
      meta: raw.meta || null,
    };
  }

  function addNodes(store, raws) {
    let added = 0;
    for (const raw of raws || []) {
      if (!raw) continue;
      const id = String(raw.node_id || raw.id || '');
      if (!id || store.nodes.has(id)) continue;
      store.nodes.set(id, normalizeNode(raw));
      added += 1;
    }
    return added;
  }

  function edgeKey(edge) {
    return String(edge.from_node_id) + '|' + String(edge.to_node_id) + '|' + String(edge.relation_type);
  }

  function addEdges(store, raws) {
    let added = 0;
    for (const raw of raws || []) {
      if (!raw) continue;
      if (!store.nodes.has(String(raw.from_node_id)) || !store.nodes.has(String(raw.to_node_id))) continue;
      const key = edgeKey(raw);
      if (store.edges.has(key)) continue;
      store.edges.set(key, {
        id: key,
        from: String(raw.from_node_id),
        to: String(raw.to_node_id),
        relation_type: String(raw.relation_type || 'CONTAINS'),
        confidence: Number(raw.confidence == null ? 0.5 : raw.confidence),
        synthetic: Boolean(raw.synthetic),
      });
      added += 1;
    }
    return added;
  }

  function linkParent(store, parentId, childIds) {
    if (!parentId) return;
    let bucket = store.children.get(parentId);
    if (!bucket) {
      bucket = new Set();
      store.children.set(parentId, bucket);
    }
    for (const id of childIds) {
      if (id === parentId) continue;
      bucket.add(id);
      store.parents.set(id, parentId);
    }
  }

  function addPayload(store, payload, options) {
    const parentId = options && options.parentId ? options.parentId : null;
    const before = store.nodes.size;
    addNodes(store, (payload && payload.nodes) || []);
    const childIds = [];
    for (const raw of (payload && payload.nodes) || []) {
      const id = String((raw && (raw.node_id || raw.id)) || '');
      if (id) childIds.push(id);
    }
    linkParent(store, parentId, childIds);
    const edgesAdded = addEdges(store, (payload && payload.edges) || []);
    if (parentId && store.nodes.has(parentId)) {
      store.expanded.add(parentId);
      const node = store.nodes.get(parentId);
      if (node) node.expanded = true;
    }
    return { nodes: store.nodes.size - before, edges: edgesAdded, childIds };
  }

  function addSyntheticGroup(store, group, parentId) {
    const id = String(group.id);
    if (!store.nodes.has(id)) {
      store.nodes.set(id, normalizeNode({
        node_id: id,
        node_type: 'directory',
        title: group.title || group.path || id,
        path: group.path || null,
        salience: 0.75,
        synthetic: true,
        expandable: true,
        count: group.count || 0,
        meta: group.meta || null,
      }));
    }
    if (parentId) {
      linkParent(store, parentId, [id]);
      addEdges(store, [{
        from_node_id: parentId,
        to_node_id: id,
        relation_type: 'CONTAINS',
        confidence: 1,
        synthetic: true,
      }]);
    }
    return id;
  }

  function descendants(store, id) {
    const out = new Set();
    const stack = [id];
    while (stack.length) {
      const current = stack.pop();
      const bucket = store.children.get(current);
      if (!bucket) continue;
      for (const child of bucket) {
        if (child === id || out.has(child)) continue;
        out.add(child);
        stack.push(child);
      }
    }
    return out;
  }

  function removeNodes(store, ids) {
    let removed = 0;
    for (const id of ids) {
      if (!store.nodes.delete(id)) continue;
      removed += 1;
      store.expanded.delete(id);
      store.parents.delete(id);
      store.children.delete(id);
    }
    for (const [key, edge] of [...store.edges]) {
      if (ids.has(edge.from) || ids.has(edge.to)) store.edges.delete(key);
    }
    for (const bucket of store.children.values()) {
      for (const id of ids) bucket.delete(id);
    }
    return removed;
  }

  function collapseNode(store, id) {
    const doomed = descendants(store, id);
    if (!doomed.size) return 0;
    doomed.delete(id);
    const removed = removeNodes(store, doomed);
    store.expanded.delete(id);
    const node = store.nodes.get(id);
    if (node) node.expanded = false;
    return removed;
  }

  function toggleExpand(store, id) {
    const node = store.nodes.get(id);
    if (!node || !node.expandable) return { action: 'none' };
    if (store.expanded.has(id)) {
      return { action: 'collapse', removed: collapseNode(store, id) };
    }
    return { action: 'expand' };
  }

  function visibleNodes(store) {
    return [...store.nodes.values()];
  }

  function visibleEdges(store) {
    return [...store.edges.values()];
  }

  function stats(store) {
    const counts = { nodes: store.nodes.size, edges: store.edges.size, byType: {}, synthetic: 0 };
    for (const node of store.nodes.values()) {
      counts.byType[node.node_type] = (counts.byType[node.node_type] || 0) + 1;
      if (node.synthetic) counts.synthetic += 1;
    }
    return counts;
  }

  function relationCounts(store) {
    const counts = {};
    for (const edge of store.edges.values()) {
      counts[edge.relation_type] = (counts[edge.relation_type] || 0) + 1;
    }
    return counts;
  }

  // Only offer relation filters the current view can actually produce and
  // that exist in the project's real relation data.
  function relationOptions(viewId, projectCounts, storeCounts) {
    const view = viewFor(viewId);
    const project = projectCounts || {};
    const loaded = storeCounts || {};
    return view.relationTypes.filter((type) => {
      if (loaded[type]) return true;
      return Number(project[type] || 0) > 0;
    });
  }

  function filterEdges(edges, allowedTypes) {
    if (!allowedTypes || !allowedTypes.size) return edges;
    return edges.filter((edge) => allowedTypes.has(edge.relation_type));
  }

  function emptyStateFor(viewId, capabilities) {
    const view = viewFor(viewId);
    const counts = (capabilities && capabilities.views && capabilities.views[viewId]) || null;
    return {
      title: 'Nothing loaded yet',
      detail: view.hint,
      nodeCount: counts ? Number(counts.node_count || 0) : null,
    };
  }

  const api = {
    VIEWS,
    VIEW_ORDER,
    EXPANDABLE_TYPES,
    NODE_COLORS,
    RELATION_COLORS,
    GRAPH_DISTANCE_MIN,
    GRAPH_DISTANCE_MAX,
    DEFAULT_GRAPH_SETTINGS,
    addEdges,
    addNodes,
    addPayload,
    addSyntheticGroup,
    collapseNode,
    createStore,
    descendants,
    emptyStateFor,
    filterEdges,
    hashString,
    isCurrent,
    nodeColor,
    normalizeGraphSettings,
    relationColor,
    relationCounts,
    relationOptions,
    removeNodes,
    reset,
    stats,
    toggleExpand,
    typeColor,
    viewFor,
    visibleEdges,
    visibleNodes,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.SynapseGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
