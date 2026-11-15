'use strict';

/**
 * Lightweight localization for the no-build GUI.
 *
 * - Structural labels are translated by exact match on rendered text nodes and
 *   on placeholder/title attributes, so page renderers stay untouched.
 * - Data values (node types, relation types, memory types, ids, paths) are NOT
 *   in the dictionaries and therefore never translated.
 */
(function (global) {
  var STORAGE_KEY = 'synapse.locale';
  var FALLBACK = 'zh-CN';

  var ZH = {
    // chrome / navigation
    'Projects': '项目',
    'Overview': '总览',
    'Knowledge Graph': '知识图谱',
    'Search': '搜索',
    'Memory': '记忆',
    'Context': '上下文',
    'Indexing': '索引',
    'Refresh': '刷新',
    'Access token': '访问令牌',
    'READY': '就绪',
    'STALE': '过期',
    'NOT INDEXED': '未索引',
    'NO PROJECT': '未选择项目',
    'CONNECTED': '已连接',
    'DISCONNECTED': '未连接',
    'LOCKED': '未连接',
    'LOCAL · CONNECTED': '本地 · 已连接',
    'ACCESS TOKEN': '访问令牌',
    'Connect': '连接',
    'PROJECT': '项目',
    'NODE': '节点',

    // graph workbench
    'Architecture': '架构',
    'Symbols': '符号',
    'Documentation': '文档',
    'TYPE': '类型',
    'RELATION': '关系',
    'LIMIT': '数量',
    'MEMORY': '记忆类型',
    'Fit': '适配',
    'Reload': '重载',
    'NODES': '节点',
    'RELATIONS': '关系',
    'VIEW': '视图',
    'nodes': '节点',
    'edges': '边',
    'Nothing loaded yet': '尚未加载节点',
    'Load failed': '加载失败',
    'Reload to retry.': '点击重载重试。',
    'TRUNCATED': '已截断',
    'one knowledge store · four lenses': '一个知识库 · 四个视角',
    'no relations in this view yet': '此视图暂无关系',
    'directory': '目录',

    // node detail
    'SUMMARY': '摘要',
    'CONTENT': '内容',
    'TAGS': '标签',
    'node id': '节点 ID',
    'node type': '节点类型',
    'file path': '文件路径',
    'lines': '行号',
    'language': '语言',
    'salience': '显著度',
    'confidence': '置信度',
    'provenance': '来源',
    'created': '创建时间',
    'updated': '更新时间',
    'parent': '父节点',
    'memory type': '记忆类型',
    'project id': '项目 ID',
    'files': '文件',
    'documents': '文档',
    'symbols': '符号',
    'sections': '章节',
    'grouping': '分组方式',

    // overview
    'KNOWLEDGE NODES': '知识节点',
    'GRAPH RELATIONS': '图谱关系',
    'INDEXED SOURCES': '已索引来源',
    'ACTIVE SOURCES': '活跃来源',
    'UNRESOLVED REFS': '未解析引用',
    'PENDING TASKS': '待处理任务',
    'FAILED TASKS': '失败任务',
    'DECISIONS': '决策',
    'TECH STACK': '技术栈',
    'TOP MODULES': '重要模块',
    'RECENT CHANGES': '最近变更',
    'LAST INDEXED': '最近索引',
    'NEVER RUN': '从未运行',
    'Last run': '最近运行',
    'Last index run': '最近索引运行',
    'Node composition': '节点构成',
    'Project skeleton': '项目骨架',
    'Module': '模块',
    'Reason': '原因',
    'Why': '原因',
    'Title': '标题',
    'Path': '路径',
    'Next': '下一页',
    'Previous': '上一页',
    'Copy': '复制',
    'Manual refresh': '手动刷新',
    'Reindex': '重新索引',
    'Start here': '从这里开始',
    'Decisions': '决策',
    'Recent changes': '最近变更',
    'Tech stack': '技术栈',
    'Memories': '记忆条目',
    'Memory detail': '记忆详情',
    'all': '全部',
    'all runs': '全部运行',
    'all time': '全部时间',
    'by file mtime': '按文件修改时间',
    'files and documents': '文件与文档',
    'Indexing…': '索引中…',
    'Index queue': '索引队列',
    'Task queue': '任务队列',
    'Context Inspection': '上下文检查',
    'Project Memory': '项目记忆',
    'MODE': '模式',
    'QUERY': '查询',
    'PATH PREFIX': '路径前缀',
    'MAX TOKENS': '最大 Token',
    'COMMAND': '命令',
    'Salience': '显著度',
    'status': '状态',
    'path': '路径',
    'mode': '模式',
    'sources': '来源',
    'empty': '空',

    // statuses / modes rendered as text
    'queued': '排队中',
    'running': '运行中',
    'succeeded': '成功',
    'failed': '失败',
    'canceled': '已取消',
    'interrupted': '已中断',
    'keyword': '关键词',
    'hybrid': '混合',

    // connection / chrome sentences
    'CONNECTING…': '连接中…',
    'One local SQLite knowledge base, shared by MCP, CLI and this GUI.':
      '一个本地 SQLite 知识库，由 MCP、CLI 和本 GUI 共享。',
    'Synapse — Knowledge Workspace': 'Synapse — 知识工作台',

    // overview tables / run details
    'zoom': '缩放',
    'last indexed': '最近索引',
    'files and documents in the active set': '活跃集中的文件与文档',
    'kept for a later resolution pass': '保留到后续解析阶段',
    'DETECTED': '已检测',
    'ONE NODE PER PATH': '每个路径一个节点',
    'types': '种',
    'started': '开始',
    'finished': '结束',
    'scanned / changed': '扫描 / 变更',
    'nodes upserted': '写入节点',
    'relations upserted': '写入关系',
    'nodes upserted / removed': '写入 / 移除节点',
    'resolved / unresolved': '已解析 / 未解析',
    'deleted / renamed': '删除 / 重命名',
    'failed files': '失败文件',
    'duration': '耗时',
    'incremental': '增量',
    'full': '全量',
    'SUCCEEDED': '成功',
    'FAILED': '失败',
    'RUNNING': '运行中',
    'CANCELED': '已取消',
    'INTERRUPTED': '已中断',
    'QUEUED': '排队中',
    'NO RUN': '未运行',

    // view hints
    'Project → directory → file. Expand a node to load only its direct children.':
      '项目 → 目录 → 文件。展开节点只加载下一层。',
    'Pick a file, then expand a class or function to load its real neighbours.':
      '先选文件，再展开类或函数，加载它的真实邻居。',
    'Documents first; expand one to read its section tree.':
      '先看文档；展开查看章节树。',
    'Durable project memory, filtered by type and keyword.':
      '长期项目记忆，可按类型与关键词筛选。',

    // page subtitles and memory controls
    'Lexical + graph ranking over one project. Semantic retrieval is not available in this phase.':
      '单项目上的词法 + 图排序检索；本阶段不提供语义检索。',
    'Explicit, cross-session project knowledge. Read-only in this phase.':
      '跨会话的显式项目知识；当前阶段只读。',
    'SQL FTS · keyword · not hybrid recall': 'SQL FTS · 关键词 · 非混合召回',
    'The same structure an agent receives from': 'Agent 从',
    ', with the token budget applied.': '，得到的同一份结构，已应用 token 预算。',
    'Index runs are explicit and project-locked. This GUI never watches the filesystem.':
      '索引由用户显式触发并按项目加锁；本 GUI 不监听文件系统。',
    'TASK QUERY (OPTIONAL)': '任务查询（可选）',
    'Build': '构建',
    'queued + running': '排队 + 运行中',
    'retried up to max_attempts': '最多重试 max_attempts 次',
    'scanned': '已扫描',
    'changed / unchanged': '变更 / 未变',
    '复制 Node ID': '复制节点 ID',
    'total': '条'
  };

  // English restores the strings this project originally shipped in Chinese.
  var EN = {
    '选择一个节点查看详情': 'Select a node to inspect it',
    '目录节点是视图层按真实 path 聚合的分组，不是 KnowledgeNode，也没有写入数据库。': 'Directories are view-only groups aggregated from real node paths; they are not KnowledgeNodes and are never written to the database.',
    '展开 / 折叠': 'Expand / collapse',
    '在 Symbols 中查看': 'Open in Symbols',
    '复制 ID': 'Copy ID',
    '该节点暂未解析出关系。': 'No relations have been resolved for this node.',
    '（无内容）': '(no content)',
    'no path': 'no path',
    '尚未加载节点': 'Nothing loaded yet',
    '此视图暂无关系': 'No relations in this view yet',
    '已截断': 'Truncated',
    '适配': 'Fit',
    '重载': 'Reload',
    '项目 ID': 'Project ID',
    '事实': 'Fact',
    '经验': 'Experience',
    '决策': 'Decision',
    '偏好': 'Preference',
    '摘要': 'Summary',
    '未连接': 'not connected',
    '未选择项目': 'no project selected',
    '令牌仅保存在当前浏览器会话（sessionStorage）。':
      'The token is only kept in this browser session (sessionStorage).',
    '连接本地 Synapse GUI': 'Connect to the local Synapse GUI',
    '请输入令牌。': 'Enter a token.',
    '重新连接': 'Reconnect',
    '一个项目知识库，供所有 Agent 使用': 'One project knowledge base, used by every agent',
    '尚未连接：请先在左下角输入访问令牌。':
      'Not connected: enter the access token in the lower-left rail first.',
    '搜索文件或目录': 'Search files or directories',
    '搜索类、函数或方法': 'Search classes, functions or methods',
    '搜索文档标题': 'Search document titles',
    '搜索记忆内容或关键词': 'Search memory content or keywords',
    '在当前记忆中搜索关键词…': 'Search memory keywords…',
    '只读': 'read-only',
    '：记忆的编辑与删除将在后续阶段提供，当前页面用于核对 Agent 可见的长期知识。':
      ': editing and deleting memories arrives in a later phase; this page audits the long-term knowledge agents can see.',
    '在知识图谱中查看': 'View in graph',
    '复制 Node ID': 'Copy Node ID',
    '尚未构建上下文': 'No context built yet',
    '不填 query 时返回项目概览；填写后优先选择与任务相关的模块。':
      'Leave query empty for the project overview; fill it to prefer task-relevant modules.',
    '没有匹配记忆': 'No matching memories',
    '暂无记忆': 'No memories yet',
    '加载中…': 'Loading…',
    '选择左侧记忆查看完整内容。': 'Select a memory on the left to read it in full.',
    '此视图暂无关系': 'No relations in this view yet'
  };

  var MESSAGES = {
    'graph.status.groups': { 'zh-CN': '{n} 个分组', en: '{n} derived groups' },
    'graph.status.memories': { 'zh-CN': '{n} 条记忆', en: '{n} memories total' },
    'graph.status.truncated': { 'zh-CN': '已按 LIMIT 截断', en: 'result truncated by LIMIT' },
    'memory.range': {
      'zh-CN': '显示 {start}–{end} / 共 {total} 条',
      en: 'Showing {start}–{end} of {total} memories'
    },
    'memory.page': { 'zh-CN': '第 {page} / {pages} 页', en: 'Page {page} of {pages}' },
    'time.now': { 'zh-CN': '刚刚', en: 'just now' },
    'time.minutes': { 'zh-CN': '{n} 分钟前', en: '{n} min ago' },
    'time.hours': { 'zh-CN': '{n} 小时前', en: '{n} h ago' },
    'time.days': { 'zh-CN': '{n} 天前', en: '{n} d ago' },
    'time.never': { 'zh-CN': '从未', en: 'never' }
  };

  var DICTS = { 'zh-CN': ZH, en: EN };

  function hasWindow() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  function fromQuery() {
    if (!hasWindow()) return null;
    try {
      var value = new URLSearchParams(global.location.search).get('lang');
      if (!value || !DICTS[value]) return null;
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, value);
      return value;
    } catch (error) {
      return null;
    }
  }

  function detect() {
    var fromUrl = fromQuery();
    if (fromUrl) return fromUrl;
    try {
      var saved = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (saved && DICTS[saved]) return saved;
    } catch (error) {
      // storage can be unavailable in private modes; fall through to detection
    }
    var language = '';
    if (hasWindow() && global.navigator && global.navigator.language) {
      language = String(global.navigator.language).toLowerCase();
    }
    return language.indexOf('zh') === 0 ? 'zh-CN' : FALLBACK;
  }

  var current = detect();

  function locale() {
    return current;
  }

  function dict(code) {
    return DICTS[code || current] || {};
  }

  function translate(text, code) {
    var raw = String(text);
    var trimmed = raw.trim();
    if (!trimmed) return raw;
    var hit = dict(code)[trimmed];
    if (!hit) return raw;
    return raw.replace(trimmed, hit);
  }

  function t(key, vars) {
    var entry = MESSAGES[key];
    if (!entry) return key;
    var template = entry[current] || entry['zh-CN'] || key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (_, name) {
      return vars[name] == null ? '' : String(vars[name]);
    });
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1 };

  function localizeElement(element) {
    if (!element || SKIP_TAGS[element.tagName]) return;
    ['placeholder', 'title', 'aria-label'].forEach(function (attr) {
      var value = element.getAttribute && element.getAttribute(attr);
      if (!value) return;
      var next = translate(value);
      if (next !== value) element.setAttribute(attr, next);
    });
  }

  function apply(root) {
    if (!hasWindow()) return 0;
    var start = root || document.body;
    if (!start) return 0;
    var map = dict();
    var changed = 0;
    var walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    var node = walker.currentNode;
    while (node) {
      if (node.nodeType === 3) {
        var value = node.nodeValue;
        var hit = value && map[value.trim()];
        if (hit) {
          node.nodeValue = value.replace(value.trim(), hit);
          changed += 1;
        }
      } else if (node.nodeType === 1) {
        localizeElement(node);
      }
      node = walker.nextNode();
    }
    if (document.title) {
      var titleHit = map[document.title.trim()];
      if (titleHit) {
        document.title = document.title.replace(document.title.trim(), titleHit);
        changed += 1;
      }
    }
    return changed;
  }

  function setLocale(next) {
    if (!DICTS[next]) return current;
    current = next;
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      // ignore storage failures
    }
    if (hasWindow()) {
      document.documentElement.lang = next;
      global.location.reload();
    }
    return current;
  }

  function toggle() {
    return setLocale(current === 'zh-CN' ? 'en' : 'zh-CN');
  }

  function observe() {
    if (!hasWindow() || typeof MutationObserver === 'undefined') return null;
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i += 1) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j += 1) {
          var node = added[j];
          if (node.nodeType === 1) apply(node);
          else if (node.nodeType === 3 && node.parentElement) apply(node.parentElement);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  var api = {
    DICTS: DICTS,
    MESSAGES: MESSAGES,
    apply: apply,
    locale: locale,
    observe: observe,
    setLocale: setLocale,
    t: t,
    toggle: toggle,
    translate: translate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.SynapseI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
