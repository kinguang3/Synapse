'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../../hosts/shared/sidebar/sidebar_core.js');

test('creates an empty state with connection-first defaults', () => {
  const state = core.createState();
  assert.equal(state.connection, 'connecting');
  assert.deepEqual(state.projects, []);
  assert.equal(state.memoryLimit, 20);
});

test('keeps a valid saved project and falls back to the first project', () => {
  const projects = [
    { id: 'a', name: 'Alpha', root_path: 'C:\\alpha' },
    { id: 'b', name: 'Beta', root_path: 'C:\\beta' },
  ];
  assert.equal(core.pickProjectId(projects, 'b'), 'b');
  assert.equal(core.pickProjectId(projects, 'missing'), 'a');
  assert.equal(core.pickProjectId([], 'b'), '');
});

test('renders project and location labels without hiding knowledge data', () => {
  assert.equal(
    core.projectLabel({ id: 'a', name: 'Synapse', root_path: 'D:\\Synapse' }),
    'Synapse — D:\\Synapse',
  );
  assert.equal(core.projectLabel({ id: 'a', name: 'Synapse' }), 'Synapse');
  assert.equal(
    core.formatLocation({ path: 'src/main.py', start_line: 4, end_line: 9 }),
    'src/main.py:4-9',
  );
  assert.equal(core.formatLocation({ path: 'src/main.py', start_line: 4 }), 'src/main.py:4');
  assert.equal(core.formatLocation({ path: 'README.md' }), 'README.md');
});

test('paginates with zero-safe ranges and boundary checks', () => {
  assert.equal(core.memoryRange(0, 20, 45), '1-20 / 45');
  assert.equal(core.memoryRange(40, 20, 45), '41-45 / 45');
  assert.equal(core.memoryRange(0, 20, 0), '0 / 0');
  assert.equal(core.canPage(0, 20, 45, 'prev'), false);
  assert.equal(core.canPage(0, 20, 45, 'next'), true);
  assert.equal(core.canPage(40, 20, 45, 'next'), false);
  assert.equal(core.canPage(40, 20, 45, 'prev'), true);
});

test('normalizes connection, error and tab values', () => {
  assert.equal(core.connectionLabel('connected'), '已连接');
  assert.equal(core.connectionLabel('auth-required'), '需要访问令牌');
  assert.equal(core.connectionLabel('unexpected'), 'unexpected');
  assert.equal(core.errorMessage({ message: 'boom' }), 'boom');
  assert.equal(core.errorMessage('plain'), 'plain');
  assert.equal(core.errorMessage(null), '未知错误');
  assert.equal(core.tabFromHash('#memory'), 'memory');
  assert.equal(core.tabFromHash('#/context?x=1'), 'context');
  assert.equal(core.tabFromHash('#unknown'), 'search');
});

test('formats scores and JSON context without throwing on cycles', () => {
  assert.equal(core.formatScore(0.12345), '0.12');
  assert.equal(core.formatScore('nope'), '');
  assert.equal(core.prettyContext({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(core.prettyContext(null), '');
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(core.prettyContext(cyclic), '[object Object]');
});
