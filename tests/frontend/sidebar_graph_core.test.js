'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const graph = require('../../hosts/shared/sidebar/sidebar_graph_core.js');

function node(id, type, extra) {
  return Object.assign({ node_id: id, node_type: type, title: id }, extra || {});
}

function edge(from, to, type) {
  return { from_node_id: from, to_node_id: to, relation_type: type, confidence: 0.9 };
}

test('exposes the same four knowledge lenses as the GUI workbench', () => {
  assert.deepEqual(graph.VIEW_ORDER, ['architecture', 'symbols', 'documentation', 'memory']);
  assert.deepEqual([...graph.VIEWS.symbols.nodeTypes], ['file', 'class', 'function', 'method']);
  assert.deepEqual([...graph.VIEWS.documentation.nodeTypes], ['document', 'doc_section']);
  assert.deepEqual([...graph.VIEWS.memory.nodeTypes], ['memory', 'note']);
  for (const id of graph.VIEW_ORDER) {
    assert.equal(typeof graph.VIEWS[id].hint, 'string');
    assert.ok(graph.VIEWS[id].hint.length > 0);
  }
});

test('deduplicates payloads and drops edges with missing endpoints', () => {
  const store = graph.createStore('architecture');
  const first = graph.addPayload(store, {
    nodes: [node('a', 'file'), node('b', 'class')],
    edges: [edge('a', 'b', 'CONTAINS'), edge('a', 'ghost', 'CALLS')],
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
});

test('tracks synthetic groups and collapses their descendants', () => {
  const store = graph.createStore('architecture');
  graph.addSyntheticGroup(store, {
    id: 'dir:src',
    title: 'src',
    path: 'src',
    count: 2,
    meta: { files: 2 },
  });
  graph.addPayload(store, { nodes: [node('f1', 'file'), node('f2', 'file')] }, { parentId: 'dir:src' });
  graph.addPayload(store, { nodes: [node('c1', 'class')] }, { parentId: 'f1' });
  assert.equal(graph.stats(store).nodes, 4);
  assert.equal(graph.stats(store).synthetic, 1);
  assert.equal(store.nodes.get('dir:src').kind, 'group');
  assert.equal(graph.collapseNode(store, 'dir:src'), 3);
  assert.equal(graph.stats(store).nodes, 1);
});

test('filters relations by view and loaded/project counts', () => {
  const project = { CONTAINS: 12, IMPORTS: 4, CALLS: 0, REFERENCES: 2, EXPLAINS: 1 };
  assert.deepEqual(graph.relationOptions('architecture', project, {}), ['CONTAINS', 'IMPORTS', 'REFERENCES']);
  assert.deepEqual(graph.relationOptions('symbols', project, { CALLS: 2 }), [
    'CONTAINS',
    'CALLS',
    'REFERENCES',
    'IMPORTS',
  ]);
  assert.deepEqual(graph.relationOptions('memory', project, {}), ['EXPLAINS', 'REFERENCES']);
  assert.equal(graph.filterEdges([{ relation_type: 'CALLS' }], new Set()).length, 1);
});

test('guards stale view requests and resets all scoped maps', () => {
  const token = { epoch: 3, view: 'symbols' };
  assert.equal(graph.isCurrent(token, { epoch: 3, view: 'symbols' }), true);
  assert.equal(graph.isCurrent(token, { epoch: 4, view: 'symbols' }), false);
  assert.equal(graph.isCurrent(token, { epoch: 3, view: 'memory' }), false);

  const store = graph.createStore('symbols');
  graph.addPayload(store, { nodes: [node('a', 'class')] });
  graph.reset(store);
  assert.equal(graph.stats(store).nodes, 0);
  assert.equal(store.children.size, 0);
});
