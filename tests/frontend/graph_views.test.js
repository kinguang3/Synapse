'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const graph = require('../../src/synapse/integrations/gui/static/graph_views.js');

function node(id, type, extra) {
  return Object.assign({ node_id: id, node_type: type, title: id }, extra || {});
}

function edge(from, to, type) {
  return { from_node_id: from, to_node_id: to, relation_type: type, confidence: 0.9 };
}

test('every view exposes a translation key for its hint', () => {
  for (const id of graph.VIEW_ORDER) {
    assert.match(graph.VIEWS[id].hintKey, /^graph\.hint\./);
  }
});

test('keeps the four knowledge views on separate layers', () => {
  const arch = new Set(graph.VIEWS.architecture.nodeTypes);
  const symbols = new Set(graph.VIEWS.symbols.nodeTypes);
  const docs = new Set(graph.VIEWS.documentation.nodeTypes);
  const memory = new Set(graph.VIEWS.memory.nodeTypes);

  // Architecture shows repository files (a markdown file is still a file there).
  assert.ok(arch.has('file'));
  assert.equal(arch.has('memory'), false);
  assert.equal(arch.has('class'), false);

  // Symbols never shows documents or memory; files are its entry points.
  assert.deepEqual([...symbols], ['file', 'class', 'function', 'method']);
  assert.deepEqual([...graph.VIEWS.symbols.searchTypes], ['class', 'function', 'method']);

  // Documentation never shows code symbols or plain files.
  assert.deepEqual([...docs], ['document', 'doc_section']);

  // Memory never shows code or files.
  assert.deepEqual([...memory], ['memory', 'note']);

  // No node type is shared between the three specialised views.
  for (const type of symbols) {
    assert.equal(docs.has(type), false);
    assert.equal(memory.has(type), false);
  }
  for (const type of docs) {
    assert.equal(memory.has(type), false);
  }
});

test('deduplicates nodes and edges from repeated payloads', () => {
  const store = graph.createStore('architecture');
  const first = graph.addPayload(store, {
    nodes: [node('a', 'file'), node('b', 'class')],
    edges: [edge('a', 'b', 'CONTAINS')],
  });
  assert.equal(first.nodes, 2);
  assert.equal(first.edges, 1);
  const second = graph.addPayload(store, {
    nodes: [node('a', 'file'), node('b', 'class')],
    edges: [edge('a', 'b', 'CONTAINS')],
  });
  assert.equal(second.nodes, 0);
  assert.equal(second.edges, 0);
  assert.equal(graph.stats(store).nodes, 2);
  assert.equal(graph.stats(store).edges, 1);
});

test('drops edges whose endpoints are not loaded', () => {
  const store = graph.createStore('symbols');
  graph.addPayload(store, { nodes: [node('a', 'class')], edges: [edge('a', 'ghost', 'CALLS')] });
  assert.equal(graph.stats(store).edges, 0);
});

test('records parent/child links and collapses a whole subtree', () => {
  const store = graph.createStore('architecture');
  graph.addPayload(store, { nodes: [node('dir', 'file')] });
  graph.addPayload(store, { nodes: [node('f1', 'file'), node('f2', 'file')] }, { parentId: 'dir' });
  graph.addPayload(store, { nodes: [node('c1', 'class')] }, { parentId: 'f1' });
  assert.equal(graph.stats(store).nodes, 4);
  assert.ok(store.expanded.has('dir'));

  const removed = graph.collapseNode(store, 'dir');
  assert.equal(removed, 3);
  assert.equal(graph.stats(store).nodes, 1);
  assert.equal(store.expanded.has('dir'), false);
  assert.equal(store.nodes.get('dir').expanded, false);
});

test('survives cyclic containment without looping forever', () => {
  const store = graph.createStore('symbols');
  graph.addPayload(store, { nodes: [node('a', 'class'), node('b', 'class')] });
  graph.addPayload(store, { nodes: [node('b', 'class')] }, { parentId: 'a' });
  graph.addPayload(store, { nodes: [node('a', 'class')] }, { parentId: 'b' });
  const doomed = graph.descendants(store, 'a');
  assert.deepEqual([...doomed], ['b']);
  assert.equal(graph.collapseNode(store, 'a'), 1);
});

test('toggleExpand collapses an expanded node and expands a fresh one', () => {
  const store = graph.createStore('architecture');
  graph.addPayload(store, { nodes: [node('f', 'file'), node('c', 'class')] }, { parentId: 'f' });
  const collapsed = graph.toggleExpand(store, 'f');
  assert.equal(collapsed.action, 'collapse');
  const again = graph.toggleExpand(store, 'f');
  assert.equal(again.action, 'expand');
});

test('refuses to expand nodes that cannot have children', () => {
  const store = graph.createStore('memory');
  graph.addPayload(store, { nodes: [node('m', 'memory')] });
  store.nodes.get('m').expandable = false;
  assert.equal(graph.toggleExpand(store, 'm').action, 'none');
});

test('request guards reject stale view tokens', () => {
  const token = { epoch: 3, view: 'symbols' };
  assert.equal(graph.isCurrent(token, { epoch: 3, view: 'symbols' }), true);
  assert.equal(graph.isCurrent(token, { epoch: 4, view: 'symbols' }), false);
  assert.equal(graph.isCurrent(token, { epoch: 3, view: 'memory' }), false);
  assert.equal(graph.isCurrent(null, { epoch: 3, view: 'memory' }), false);
});

test('relation options only expose types the view and data support', () => {
  const project = { CONTAINS: 12, IMPORTS: 4, CALLS: 0, REFERENCES: 2, EXPLAINS: 1 };
  assert.deepEqual(graph.relationOptions('architecture', project, {}), ['CONTAINS', 'IMPORTS', 'REFERENCES']);
  assert.deepEqual(graph.relationOptions('symbols', project, { CALLS: 2 }), ['CONTAINS', 'CALLS', 'REFERENCES', 'IMPORTS']);
  assert.deepEqual(graph.relationOptions('memory', project, {}), ['EXPLAINS', 'REFERENCES']);
  assert.deepEqual(graph.relationOptions('documentation', { CONTAINS: 1, CALLS: 9 }, {}), ['CONTAINS']);
});

test('edge filtering keeps every edge when no filter is set', () => {
  const edges = [
    { relation_type: 'CONTAINS' },
    { relation_type: 'CALLS' },
  ];
  assert.equal(graph.filterEdges(edges, new Set()).length, 2);
  assert.deepEqual(
    graph.filterEdges(edges, new Set(['CALLS'])).map((item) => item.relation_type),
    ['CALLS'],
  );
});

test('synthetic directory groups carry derived counts', () => {
  const store = graph.createStore('architecture');
  const id = graph.addSyntheticGroup(
    store,
    { id: 'dir:src', title: 'src', path: 'src', count: 4, meta: { files: 2, symbols: 2 } },
    null,
  );
  assert.equal(id, 'dir:src');
  const stored = store.nodes.get('dir:src');
  assert.equal(stored.synthetic, true);
  assert.equal(stored.kind, 'group');
  assert.equal(stored.node_type, 'directory');
  assert.equal(stored.expandable, true);
  assert.equal(graph.stats(store).synthetic, 1);
});

test('reset clears every view-scoped structure', () => {
  const store = graph.createStore('symbols');
  graph.addPayload(store, { nodes: [node('a', 'class'), node('b', 'method')] }, { parentId: 'a' });
  graph.reset(store);
  assert.equal(graph.stats(store).nodes, 0);
  assert.equal(store.children.size, 0);
  assert.equal(store.expanded.size, 0);
});

test('assigns distinct node and relation colors', () => {
  assert.notEqual(graph.typeColor('file'), graph.typeColor('document'));
  assert.notEqual(graph.typeColor('class'), graph.typeColor('function'));
  assert.notEqual(graph.typeColor('function'), graph.typeColor('method'));

  const first = graph.nodeColor({ type: 'file', path: 'src/a.py' });
  const second = graph.nodeColor({ type: 'file', path: 'src/b.py' });
  assert.match(first, /^hsl\(/);
  assert.notEqual(first, second);

  assert.notEqual(graph.relationColor('CONTAINS'), graph.relationColor('IMPORTS'));
  assert.equal(graph.relationColor('calls'), graph.RELATION_COLORS.CALLS);
  assert.match(graph.relationColor('CUSTOM_RELATION'), /^hsl\(/);
});

test('normalizes graph distance settings into the supported range', () => {
  assert.equal(graph.normalizeGraphSettings(null).nodeDistance, 68);
  assert.equal(graph.normalizeGraphSettings({ nodeDistance: '96' }).nodeDistance, 96);
  assert.equal(graph.normalizeGraphSettings({ nodeDistance: 1 }).nodeDistance, 40);
  assert.equal(graph.normalizeGraphSettings({ nodeDistance: 999 }).nodeDistance, 200);
  assert.equal(graph.normalizeGraphSettings({ nodeDistance: 'nope' }).nodeDistance, 68);
});
