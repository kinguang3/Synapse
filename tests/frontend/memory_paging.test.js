'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const paging = require('../../src/synapse/integrations/gui/static/memory_paging.js');

test('uses a 20 item default and clamps page sizes', () => {
  assert.equal(paging.PAGE_SIZE, 20);
  assert.equal(paging.normalizeLimit(undefined), 20);
  assert.equal(paging.normalizeLimit(0), 1);
  assert.equal(paging.normalizeLimit(999), 200);
});

test('renders the first page range', () => {
  assert.deepEqual(paging.pageSummary(65, 0, 20), {
    total: 65,
    offset: 0,
    limit: 20,
    page: 1,
    pages: 4,
    start: 1,
    end: 20,
    hasPrev: false,
    hasNext: true,
  });
});

test('renders a middle page range', () => {
  assert.deepEqual(paging.pageSummary(65, 20, 20), {
    total: 65,
    offset: 20,
    limit: 20,
    page: 2,
    pages: 4,
    start: 21,
    end: 40,
    hasPrev: true,
    hasNext: true,
  });
});

test('renders the last page range', () => {
  assert.deepEqual(paging.pageSummary(65, 60, 20), {
    total: 65,
    offset: 60,
    limit: 20,
    page: 4,
    pages: 4,
    start: 61,
    end: 65,
    hasPrev: true,
    hasNext: false,
  });
});

test('hides page numbers for an empty result', () => {
  assert.deepEqual(paging.pageSummary(0, 80, 20), {
    total: 0,
    offset: 0,
    limit: 20,
    page: 0,
    pages: 0,
    start: 0,
    end: 0,
    hasPrev: false,
    hasNext: false,
  });
});

test('handles totals smaller than and equal to the page size', () => {
  const smaller = paging.pageSummary(5, 0, 20);
  assert.equal(smaller.page, 1);
  assert.equal(smaller.pages, 1);
  assert.equal(smaller.start, 1);
  assert.equal(smaller.end, 5);
  assert.equal(smaller.hasPrev, false);
  assert.equal(smaller.hasNext, false);

  const equal = paging.pageSummary(20, 0, 20);
  assert.equal(equal.page, 1);
  assert.equal(equal.pages, 1);
  assert.equal(equal.end, 20);
  assert.equal(equal.hasNext, false);
});

test('handles an exact multiple of the page size', () => {
  const last = paging.pageSummary(40, 20, 20);
  assert.equal(last.page, 2);
  assert.equal(last.pages, 2);
  assert.equal(last.start, 21);
  assert.equal(last.end, 40);
  assert.equal(last.hasNext, false);
});

test('clamps an out-of-range offset to the last valid page', () => {
  assert.equal(paging.normalizeOffset(80, 65, 20), 60);
  assert.equal(paging.normalizeOffset(500, 65, 20), 60);
  assert.equal(paging.normalizeOffset(60, 40, 20), 20);
  assert.equal(paging.normalizeOffset(40, 0, 20), 0);
  assert.equal(paging.normalizeOffset(-10, 65, 20), 0);
});

test('computes previous and next offsets without leaving the range', () => {
  assert.equal(paging.previousOffset(65, 0, 20), null);
  assert.equal(paging.previousOffset(65, 20, 20), 0);
  assert.equal(paging.previousOffset(65, 60, 20), 40);
  assert.equal(paging.nextOffset(65, 0, 20), 20);
  assert.equal(paging.nextOffset(65, 40, 20), 60);
  assert.equal(paging.nextOffset(65, 60, 20), null);
});

test('accepts only the current request id and query context', () => {
  const request = { id: 4, projectId: 'p1', type: 'fact', q: 'widget' };
  assert.equal(paging.isCurrentRequest(request, { ...request }), true);
  assert.equal(paging.isCurrentRequest(request, { ...request, id: 3 }), false);
  assert.equal(paging.isCurrentRequest(request, { ...request, projectId: 'p2' }), false);
  assert.equal(paging.isCurrentRequest(request, { ...request, type: 'decision' }), false);
  assert.equal(paging.isCurrentRequest(request, { ...request, q: 'other' }), false);
  assert.equal(paging.isCurrentRequest(null, request), false);
});
