'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const i18n = require('../../src/synapse/integrations/gui/static/i18n.js');
require('../../src/synapse/integrations/gui/static/graph_page.js');

const GRAPH_PAGE = path.join(
  __dirname,
  '../../src/synapse/integrations/gui/static/graph_page.js',
);

function createHud(value) {
  let writes = 0;
  return {
    value,
    get textContent() {
      return this.value;
    },
    set textContent(next) {
      writes += 1;
      this.value = next;
    },
    writes() {
      return writes;
    },
  };
}

test('every translation key used by the graph page exists', () => {
  const source = fs.readFileSync(GRAPH_PAGE, 'utf8');
  const keys = new Set([...source.matchAll(/\bT\('([^']+)'/g)].map((match) => match[1]));
  assert.ok(keys.size > 10);
  for (const key of keys) {
    assert.ok(i18n.MESSAGES[key], key + ' is missing from MESSAGES');
  }
});

test('updateZoomHud skips writing an unchanged zoom label', () => {
  const hud = createHud('100%');
  global.document = {
    getElementById(id) {
      return id === 'hud-zoom' ? hud : null;
    },
  };
  try {
    global.updateZoomHud({ transform: { k: 1 } });
    assert.equal(hud.writes(), 0);

    global.updateZoomHud({ transform: { k: 1.25 } });
    assert.equal(hud.value, '125%');
    assert.equal(hud.writes(), 1);

    global.updateZoomHud({ transform: { k: 1.25 } });
    assert.equal(hud.writes(), 1);
  } finally {
    delete global.document;
  }
});

test('updateZoomHud tolerates a missing graph or HUD', () => {
  global.document = {
    getElementById() {
      return null;
    },
  };
  try {
    assert.doesNotThrow(() => global.updateZoomHud(null));
    assert.doesNotThrow(() => global.updateZoomHud({ transform: { k: 1 } }));
  } finally {
    delete global.document;
  }
});
