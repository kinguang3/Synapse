'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const i18n = require('../../src/synapse/integrations/gui/static/i18n.js');

const DATA_VALUES = [
  // NodeType
  'project', 'file', 'class', 'function', 'method', 'document', 'doc_section', 'note', 'memory',
  // RelationType
  'CONTAINS', 'IMPORTS', 'CALLS', 'INHERITS', 'REFERENCES', 'EXPLAINS', 'DEPENDS_ON',
  'RELATED_TO', 'DERIVED_FROM', 'SOLVES', 'CONTRADICTS', 'MENTIONS',
  // MemoryType
  'fact', 'experience', 'decision', 'preference', 'summary',
];

test('defaults to zh-CN without a browser', () => {
  assert.equal(i18n.locale(), 'zh-CN');
});

test('translates structural labels and keeps surrounding whitespace', () => {
  assert.equal(i18n.translate('Overview'), '总览');
  assert.equal(i18n.translate('Knowledge Graph'), '知识图谱');
  assert.equal(i18n.translate('  Reload  '), '  重载  ');
  assert.equal(i18n.translate('NODES'), '节点');
});

test('never translates knowledge data values', () => {
  for (const value of DATA_VALUES) {
    assert.equal(i18n.DICTS['zh-CN'][value], undefined, value + ' must stay untranslated');
    assert.equal(i18n.translate(value), value, value + ' must pass through');
  }
});

test('falls back to the input for unknown or empty text', () => {
  assert.equal(i18n.translate('a1b2c3'), 'a1b2c3');
  assert.equal(i18n.translate(''), '');
  assert.equal(i18n.translate('   '), '   ');
});

test('english dictionary restores Chinese strings authored in the UI', () => {
  assert.equal(i18n.translate('选择一个节点查看详情', 'en'), 'Select a node to inspect it');
  assert.equal(i18n.translate('展开 / 折叠', 'en'), 'Expand / collapse');
  assert.equal(i18n.translate('搜索文件或目录', 'en'), 'Search files or directories');
  assert.equal(i18n.translate('Overview', 'en'), 'Overview');
});

test('parameterized messages interpolate and keep unknown keys', () => {
  assert.equal(i18n.t('graph.status.groups', { n: 3 }), '3 个分组');
  assert.equal(i18n.t('graph.status.memories', { n: 12 }), '12 条记忆');
  assert.equal(i18n.t('graph.status.truncated'), '已按 LIMIT 截断');
  assert.equal(i18n.t('missing.key'), 'missing.key');
  assert.equal(i18n.t('graph.status.groups', {}), ' 个分组');
});

test('apply is a no-op without a DOM', () => {
  assert.equal(i18n.apply(), 0);
  assert.equal(i18n.observe(), null);
});

test('both dictionaries are populated with non-empty strings', () => {
  for (const code of ['zh-CN', 'en']) {
    const map = i18n.DICTS[code];
    assert.ok(Object.keys(map).length > 20, code + ' dictionary is too small');
    for (const [key, value] of Object.entries(map)) {
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0);
      assert.ok(key.trim().length > 0);
      assert.equal(key, key.trim(), 'keys must not carry padding');
    }
  }
});

test('every message has a translation for both locales', () => {
  for (const [key, entry] of Object.entries(i18n.MESSAGES)) {
    assert.equal(typeof entry['zh-CN'], 'string', key);
    assert.equal(typeof entry.en, 'string', key);
  }
});
