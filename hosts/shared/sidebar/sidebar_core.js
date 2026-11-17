(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SynapseSidebarCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CONNECTION_LABELS = {
    connected: '已连接',
    offline: '服务未启动',
    'auth-required': '需要访问令牌',
    connecting: '连接中',
    error: '连接失败',
  };

  function createState() {
    return {
      connection: 'connecting',
      connectionMessage: '',
      projects: [],
      projectId: '',
      status: null,
      results: [],
      memories: [],
      memoryTotal: 0,
      memoryOffset: 0,
      memoryLimit: 20,
      context: null,
    };
  }

  function connectionLabel(status) {
    return CONNECTION_LABELS[status] || String(status || '');
  }

  function pickProjectId(projects, preferred) {
    var items = Array.isArray(projects) ? projects : [];
    if (!items.length) return '';
    var wanted = String(preferred || '');
    for (var index = 0; index < items.length; index += 1) {
      if (String(items[index].id) === wanted) return wanted;
    }
    return String(items[0].id);
  }

  function projectLabel(project) {
    if (!project) return '';
    var name = String(project.name || project.slug || project.id || '');
    var root = String(project.root_path || '');
    return root && root !== name ? name + ' — ' + root : name;
  }

  function formatLocation(item) {
    if (!item) return '';
    var path = String(item.path || '');
    if (!path) return '';
    var start = Number(item.start_line || 0);
    var end = Number(item.end_line || 0);
    if (start && end && end !== start) return path + ':' + start + '-' + end;
    if (start) return path + ':' + start;
    return path;
  }

  function formatScore(value) {
    var score = Number(value);
    if (!Number.isFinite(score)) return '';
    return score.toFixed(2);
  }

  function memoryRange(offset, limit, total) {
    var start = Number(offset || 0);
    var size = Number(limit || 0);
    var count = Number(total || 0);
    if (!count) return '0 / 0';
    var first = start + 1;
    var last = Math.min(start + size, count);
    return first + '-' + last + ' / ' + count;
  }

  function canPage(offset, limit, total, direction) {
    var start = Number(offset || 0);
    var size = Number(limit || 0);
    var count = Number(total || 0);
    if (direction === 'prev') return start > 0;
    if (direction === 'next') return start + size < count;
    return false;
  }

  function errorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error.message) return String(error.message);
    return String(error);
  }

  function prettyContext(context) {
    if (context === null || context === undefined) return '';
    try {
      return JSON.stringify(context, null, 2);
    } catch (error) {
      return String(context);
    }
  }

  function tabFromHash(hash) {
    var value = String(hash || '').replace(/^#\/?/, '').split('?')[0];
    if (value === 'memory' || value === 'context' || value === 'search') return value;
    return 'search';
  }

  return {
    CONNECTION_LABELS: CONNECTION_LABELS,
    canPage: canPage,
    connectionLabel: connectionLabel,
    createState: createState,
    errorMessage: errorMessage,
    formatLocation: formatLocation,
    formatScore: formatScore,
    memoryRange: memoryRange,
    pickProjectId: pickProjectId,
    prettyContext: prettyContext,
    projectLabel: projectLabel,
    tabFromHash: tabFromHash,
  };
});
