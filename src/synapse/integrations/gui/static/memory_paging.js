'use strict';

(function (global) {
  const PAGE_SIZE = 20;
  const MAX_PAGE_SIZE = 200;

  function toInt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
  }

  function normalizeLimit(value) {
    return Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(value, PAGE_SIZE)));
  }

  function normalizeTotal(value) {
    return Math.max(0, toInt(value, 0));
  }

  function normalizeOffset(offset, total, limit) {
    const size = normalizeLimit(limit);
    const count = normalizeTotal(total);
    if (!count) return 0;
    const maxStart = Math.floor((count - 1) / size) * size;
    const raw = toInt(offset, 0);
    return Math.min(Math.max(0, Math.floor(raw / size) * size), maxStart);
  }

  function pageSummary(total, offset, limit) {
    const size = normalizeLimit(limit);
    const count = normalizeTotal(total);
    if (!count) {
      return {
        total: 0,
        offset: 0,
        limit: size,
        page: 0,
        pages: 0,
        start: 0,
        end: 0,
        hasPrev: false,
        hasNext: false,
      };
    }
    const safeOffset = normalizeOffset(offset, count, size);
    return {
      total: count,
      offset: safeOffset,
      limit: size,
      page: Math.floor(safeOffset / size) + 1,
      pages: Math.ceil(count / size),
      start: safeOffset + 1,
      end: Math.min(count, safeOffset + size),
      hasPrev: safeOffset > 0,
      hasNext: safeOffset + size < count,
    };
  }

  function previousOffset(total, offset, limit) {
    const summary = pageSummary(total, offset, limit);
    return summary.hasPrev ? Math.max(0, summary.offset - summary.limit) : null;
  }

  function nextOffset(total, offset, limit) {
    const summary = pageSummary(total, offset, limit);
    return summary.hasNext ? summary.offset + summary.limit : null;
  }

  function isCurrentRequest(request, current) {
    return Boolean(
      request
      && current
      && request.id === current.id
      && request.projectId === current.projectId
      && request.type === current.type
      && request.q === current.q,
    );
  }

  const api = {
    MAX_PAGE_SIZE,
    PAGE_SIZE,
    isCurrentRequest,
    nextOffset,
    normalizeLimit,
    normalizeOffset,
    normalizeTotal,
    pageSummary,
    previousOffset,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.SynapseMemoryPaging = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
