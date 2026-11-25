'use strict';

/**
 * Knowledge Graph page for the Synapse Sidebar.
 * Mirrors the standalone GUI workbench while adapting the detail pane to a
 * narrow editor sidebar. All data access goes through the host RPC bridge.
 */
(function (global) {
  var CORE = global.SynapseGraphCore;
  var ROOT_ID = 'group:root';
  var LIMITS = [40, 80, 120, 200];
  var MEMORY_FILTERS = [
    { value: '', label: 'all' },
    { value: 'decision', label: 'decision' },
    { value: 'fact', label: 'fact' },
    { value: 'experience', label: 'experience' },
    { value: 'preference', label: 'preference' },
    { value: 'summary', label: 'summary' }
  ];
  var EDGE_DASHES = {
    active: [6, 4],
    synthetic: [2, 6],
    crossFile: [3, 7],
    normal: [4, 6]
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(value, max) {
    var text = String(value || '');
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  function safeClass(value) {
    return String(value || '').replace(/[^a-z0-9_-]/gi, '');
  }

  function setText(element, value) {
    var next = String(value == null ? '' : value);
    if (element && element.textContent !== next) element.textContent = next;
  }

  function fmtDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function planFor(node) {
    var type = node.node_type;
    if (type === 'file' || type === 'document' || type === 'class' || type === 'doc_section') {
      return { direction: 'out', relations: 'CONTAINS' };
    }
    if (type === 'function' || type === 'method') {
      return { direction: 'both', relations: 'CALLS,REFERENCES,IMPORTS,INHERITS' };
    }
    if (type === 'memory' || type === 'note') {
      return { direction: 'both', relations: '' };
    }
    return null;
  }

  function SidebarGraphView(canvas, tip, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tip = tip;
    this.callbacks = callbacks || {};
    this.nodes = [];
    this.edges = [];
    this.byId = new Map();
    this.positions = new Map();
    this.childIds = new Map();
    this.edgeGroups = new Map();
    this.activeEdges = [];
    this.transform = { x: 0, y: 0, k: 1 };
    this.alpha = 0;
    this.frame = null;
    this.drawFrame = null;
    this.ticks = 0;
    this.edgeFlow = 0;
    this.settled = false;
    this.nodeDistance = CORE.DEFAULT_GRAPH_SETTINGS.nodeDistance;
    this.selected = null;
    this.adjacent = new Set();
    this.hover = null;
    this.dragNode = null;
    this.dragIds = new Set();
    this.dragAlpha = 0;
    this.dragSettled = true;
    this.dragOffsets = new Map();
    this.dragFollowParent = { x: 0, y: 0 };
    this.dragFollowFrame = null;
    this.dragReleasePending = false;
    this.pan = null;
    this.moved = false;
    this.cameraFrame = null;
    this.motionQuery = typeof global.matchMedia === 'function'
      ? global.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    this.reducedMotion = Boolean(this.motionQuery && this.motionQuery.matches);
    this.visibilityHandler = null;
    this.motionHandler = null;
    this.dpr = Math.min(2, global.devicePixelRatio || 1);
    this.width = 0;
    this.height = 0;
    this.bind();
    this.resize();
    this.observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize())
      : null;
    if (this.observer) this.observer.observe(canvas.parentElement);
  }

  SidebarGraphView.prototype.bind = function bind() {
    var self = this;
    this.canvas.addEventListener('pointerdown', function (event) { self.onDown(event); });
    this.canvas.addEventListener('pointermove', function (event) { self.onMove(event); });
    this.canvas.addEventListener('pointerup', function (event) { self.onUp(event); });
    this.canvas.addEventListener('pointercancel', function (event) { self.onUp(event, true); });
    this.canvas.addEventListener('pointerleave', function () { self.hideTip(); });
    this.canvas.addEventListener('wheel', function (event) { self.onWheel(event); }, { passive: false });
    this.canvas.addEventListener('dblclick', function (event) {
      var node = self.pick(event);
      if (node && node.expandable && self.callbacks.onExpand) {
        self.callbacks.onExpand(node.id);
        return;
      }
      if (!node) self.fit();
    });
    this.visibilityHandler = function () { self.handleVisibility(); };
    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    this.motionHandler = function (event) {
      self.reducedMotion = Boolean(event && event.matches);
      if (self.reducedMotion) self.cancelCamera();
      self.requestDraw();
      if (!self.reducedMotion && self.selected && self.adjacent.size) self.start();
    };
    if (this.motionQuery) {
      if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', this.motionHandler);
      else if (this.motionQuery.addListener) this.motionQuery.addListener(this.motionHandler);
    }
    if (global.document && global.document.fonts && global.document.fonts.ready) {
      global.document.fonts.ready.then(function () { self.requestDraw(); });
    }
  };

  SidebarGraphView.prototype.handleVisibility = function handleVisibility() {
    if (!global.document) return;
    if (global.document.hidden) {
      if (this.frame) global.cancelAnimationFrame(this.frame);
      if (this.drawFrame) global.cancelAnimationFrame(this.drawFrame);
      if (this.dragFollowFrame) global.cancelAnimationFrame(this.dragFollowFrame);
      this.frame = null;
      this.drawFrame = null;
      this.dragFollowFrame = null;
      return;
    }
    if (this.dragOffsets.size && !this.dragNode) this.startDragFollow();
    else if (this.alpha > 0 || (!this.reducedMotion && this.selected && this.adjacent.size)) this.start();
    else this.requestDraw();
  };

  SidebarGraphView.prototype.cancelCamera = function cancelCamera() {
    if (this.cameraFrame) global.cancelAnimationFrame(this.cameraFrame);
    this.cameraFrame = null;
  };

  SidebarGraphView.prototype.setTransform = function setTransform(target, options) {
    if (!target) return;
    var opts = options || {};
    var k = Math.max(0.25, Math.min(3, Number(target.k)));
    var x = Number(target && target.x);
    var y = Number(target && target.y);
    if (!Number.isFinite(k) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.cancelCamera();
    var instant = opts.instant === true || this.reducedMotion ||
      Boolean(global.document && global.document.hidden);
    if (instant) {
      this.transform = { x: x, y: y, k: k };
      this.draw();
      return;
    }
    var start = { x: this.transform.x, y: this.transform.y, k: this.transform.k };
    var self = this;
    var duration = Math.max(120, Math.min(520, Number(opts.duration) || 260));
    var startedAt = 0;
    var step = function step(timestamp) {
      self.cameraFrame = null;
      if (!startedAt) startedAt = timestamp;
      var fraction = Math.max(0, Math.min(1, (timestamp - startedAt) / duration));
      var eased = 1 - Math.pow(1 - fraction, 3);
      self.transform.k = start.k + (k - start.k) * eased;
      self.transform.x = start.x + (x - start.x) * eased;
      self.transform.y = start.y + (y - start.y) * eased;
      self.draw();
      if (fraction < 1) {
        self.cameraFrame = global.requestAnimationFrame(step);
      } else {
        self.transform = { x: x, y: y, k: k };
        self.draw();
      }
    };
    this.cameraFrame = global.requestAnimationFrame(step);
  };

  SidebarGraphView.prototype.resize = function resize() {
    var rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(240, Math.round(rect.width));
    this.height = Math.max(220, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.cancelCamera();
    this.draw();
  };

  SidebarGraphView.prototype.stop = function stop() {
    if (this.frame) global.cancelAnimationFrame(this.frame);
    if (this.drawFrame) global.cancelAnimationFrame(this.drawFrame);
    if (this.dragFollowFrame) global.cancelAnimationFrame(this.dragFollowFrame);
    this.cancelCamera();
    this.frame = null;
    this.drawFrame = null;
    this.dragFollowFrame = null;
    if (this.visibilityHandler && global.document && global.document.removeEventListener) {
      global.document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (this.motionHandler && this.motionQuery) {
      if (this.motionQuery.removeEventListener) this.motionQuery.removeEventListener('change', this.motionHandler);
      else if (this.motionQuery.removeListener) this.motionQuery.removeListener(this.motionHandler);
    }
    this.visibilityHandler = null;
    this.motionHandler = null;
    if (this.observer) this.observer.disconnect();
  };

  SidebarGraphView.prototype.setData = function setData(nodes, edges, options) {
    this.cancelCamera();
    var opts = options || {};
    var incremental = this.nodes.length > 0 && opts.incremental !== false;
    var previous = new Map(this.nodes.map(function (node) { return [node.id, node]; }));
    var added = 0;
    var nextNodes = (nodes || []).map(function (node, index) {
      var old = previous.get(node.id) || this.positions.get(node.id);
      if (!old) added += 1;
      return {
        id: node.id,
        title: node.title,
        label: truncate(node.title, 28),
        type: node.type,
        kind: node.kind || 'node',
        synthetic: Boolean(node.synthetic),
        path: node.path,
        lines: node.lines || '',
        parentId: node.parentId || null,
        salience: Number(node.salience == null ? 0.5 : node.salience),
        expandable: Boolean(node.expandable),
        expanded: Boolean(node.expanded),
        degree: 0,
        index: index,
        x: old ? old.x : 0,
        y: old ? old.y : 0,
        vx: 0,
        vy: 0,
        fixed: incremental && Boolean(old)
      };
    }, this);
    this.nodes = nextNodes;
    for (var c = 0; c < this.nodes.length; c += 1) {
      var currentNode = this.nodes[c];
      currentNode.color = CORE.nodeColor(currentNode);
      currentNode.baseRadius = currentNode.kind === 'group'
        ? 8 + currentNode.salience * 5
        : 4.5 + currentNode.salience * 8;
    }
    this.byId = new Map(this.nodes.map(function (node) { return [node.id, node]; }, this));
    if (this.selected && !this.byId.has(this.selected)) this.selected = null;
    if (this.hover && !this.byId.has(this.hover.id)) this.hover = null;
    this.edges = (edges || [])
      .filter(function (edge) { return this.byId.has(edge.from) && this.byId.has(edge.to); }, this)
      .map(function (edge) {
        return {
          from: edge.from,
          to: edge.to,
          type: edge.type,
          confidence: Number(edge.confidence == null ? 0.5 : edge.confidence),
          synthetic: Boolean(edge.synthetic)
        };
      });
    for (var ec = 0; ec < this.edges.length; ec += 1) {
      var currentEdge = this.edges[ec];
      var fromNode = this.byId.get(currentEdge.from);
      var toNode = this.byId.get(currentEdge.to);
      currentEdge.a = fromNode;
      currentEdge.b = toNode;
      currentEdge.crossFile = Boolean(!currentEdge.synthetic && fromNode.path && toNode.path &&
        fromNode.path !== toNode.path);
      currentEdge.color = CORE.relationColor(currentEdge.type);
      var edgeKind = currentEdge.synthetic ? 's' : currentEdge.crossFile ? 'c' : 'n';
      currentEdge.groupKey = edgeKind + currentEdge.color;
      currentEdge.dash = edgeKind === 's' ? EDGE_DASHES.synthetic
        : edgeKind === 'c' ? EDGE_DASHES.crossFile : EDGE_DASHES.normal;
      currentEdge.alpha = edgeKind === 's' ? 0.18 : edgeKind === 'c' ? 0.14 : 0.28;
      currentEdge.width = edgeKind === 'c' ? 0.55 : 0.7;
    }
    this.updateAdjacent();
    this.childIds = new Map();
    for (var i = 0; i < this.nodes.length; i += 1) {
      var current = this.nodes[i];
      if (!current.parentId) continue;
      var bucket = this.childIds.get(current.parentId);
      if (!bucket) {
        bucket = [];
        this.childIds.set(current.parentId, bucket);
      }
      bucket.push(current.id);
    }
    if (this.dragNode) {
      var dragId = this.dragNode.id;
      this.dragNode = this.byId.get(dragId) || null;
      this.dragIds = this.dragNode ? this.descendantsOf(dragId) : new Set();
      this.dragAlpha = this.alpha;
      this.dragSettled = this.settled;
      if (!this.dragNode) this.canvas.classList.remove('dragging');
    }

    if (incremental && added) this.placeAddedNodes(previous);
    if (!incremental) {
      for (var j = 0; j < this.nodes.length; j += 1) {
        var node = this.nodes[j];
        if (previous.has(node.id) || this.positions.has(node.id)) continue;
        var angle = node.index * 2.399963229728653;
        var radius = 90 + Math.sqrt(node.index + 1) * 34;
        node.x = Math.cos(angle) * radius;
        node.y = Math.sin(angle) * radius;
      }
    }

    this.computeDegree();
    if (incremental) {
      if (added) {
        this.alpha = Math.max(this.alpha, 0.32);
        this.ticks = 0;
        this.settled = false;
      } else if (this.settled) {
        this.alpha = 0;
        this.ticks = 0;
      }
    } else {
      this.alpha = 1;
      this.ticks = 0;
      this.settled = false;
    }
    if (opts.fit !== false) this.fit();
    this.start();
  };

  SidebarGraphView.prototype.placeAddedNodes = function placeAddedNodes(previous) {
    var placed = new Set();
    function existingPoint() {
      var sx = 0;
      var sy = 0;
      var count = 0;
      for (var i = 0; i < this.nodes.length; i += 1) {
        var node = this.nodes[i];
        if (node.fixed || previous.has(node.id) || placed.has(node.id)) {
          sx += node.x;
          sy += node.y;
          count += 1;
        }
      }
      return count ? { x: sx / count, y: sy / count } : { x: 0, y: 0 };
    }
    var anchor = null;
    var index = 0;
    function placeNode(node, visiting) {
      if (node.fixed || placed.has(node.id) || previous.has(node.id)) return;
      if (visiting.has(node.id)) return;
      visiting.add(node.id);
      if (!anchor) anchor = existingPoint.call(this);
      var parent = node.parentId ? this.byId.get(node.parentId) : null;
      if (parent && !parent.fixed && previous.has(parent.id) === false && !placed.has(parent.id)) {
        placeNode.call(this, parent, visiting);
      }
      var base = parent && (parent.fixed || previous.has(parent.id) || placed.has(parent.id))
        ? parent
        : anchor;
      var step = index * 2.399963229728653;
      var radius = this.nodeDistance * (0.62 + (index % 4) * 0.07);
      node.x = base.x + Math.cos(step) * radius;
      node.y = base.y + Math.sin(step) * radius;
      placed.add(node.id);
      index += 1;
    }
    for (var i = 0; i < this.nodes.length; i += 1) {
      placeNode.call(this, this.nodes[i], new Set());
    }
  };

  SidebarGraphView.prototype.setNodeDistance = function setNodeDistance(value) {
    var next = CORE.normalizeGraphSettings({ nodeDistance: value }).nodeDistance;
    if (next === this.nodeDistance) return;
    this.nodeDistance = next;
    for (var i = 0; i < this.nodes.length; i += 1) this.nodes[i].fixed = false;
    this.alpha = Math.max(this.alpha, 0.45);
    this.ticks = 0;
    this.settled = false;
    this.start();
    this.draw();
  };

  SidebarGraphView.prototype.updateAdjacent = function updateAdjacent() {
    this.adjacent = new Set();
    if (!this.selected) return;
    for (var i = 0; i < this.edges.length; i += 1) {
      var edge = this.edges[i];
      if (edge.from === this.selected) this.adjacent.add(edge.to);
      if (edge.to === this.selected) this.adjacent.add(edge.from);
    }
  };

  SidebarGraphView.prototype.clearSelection = function clearSelection() {
    this.selected = null;
    this.updateAdjacent();
    this.draw();
  };

  SidebarGraphView.prototype.computeDegree = function computeDegree() {
    for (var i = 0; i < this.nodes.length; i += 1) this.nodes[i].degree = 0;
    for (var j = 0; j < this.edges.length; j += 1) {
      var a = this.byId.get(this.edges[j].from);
      var b = this.byId.get(this.edges[j].to);
      if (a) a.degree += 1;
      if (b) b.degree += 1;
    }
  };

  SidebarGraphView.prototype.start = function start() {
    if (this.frame || (global.document && global.document.hidden)) return;
    var self = this;
    this.frame = global.requestAnimationFrame(function () { self.loop(); });
  };

  SidebarGraphView.prototype.requestDraw = function requestDraw() {
    if (this.drawFrame || (global.document && global.document.hidden)) return;
    var self = this;
    this.drawFrame = global.requestAnimationFrame(function () {
      self.drawFrame = null;
      self.draw();
    });
  };

  SidebarGraphView.prototype.startDragFollow = function startDragFollow() {
    if (this.dragFollowFrame || (global.document && global.document.hidden)) return;
    var self = this;
    this.dragFollowFrame = global.requestAnimationFrame(function () { self.followDrag(); });
  };

  SidebarGraphView.prototype.followDrag = function followDrag() {
    this.dragFollowFrame = null;
    if (!this.dragOffsets.size) {
      this.finishDragFollow();
      return;
    }
    var base = this.dragFollowParent;
    var settled = true;
    var self = this;
    this.dragOffsets.forEach(function (offset, id) {
      var child = self.byId.get(id);
      if (!child) return;
      var tx = base.x + offset.x;
      var ty = base.y + offset.y;
      var dx = tx - child.x;
      var dy = ty - child.y;
      if (Math.abs(dx) > 0.35 || Math.abs(dy) > 0.35) {
        var factor = Math.max(0.14, 0.3 - ((offset.depth || 1) - 1) * 0.04);
        child.x += dx * factor;
        child.y += dy * factor;
        child.vx = 0;
        child.vy = 0;
        settled = false;
      } else {
        child.x = tx;
        child.y = ty;
      }
    });
    this.draw();
    if (!settled) {
      this.startDragFollow();
      return;
    }
    this.finishDragFollow();
  };

  SidebarGraphView.prototype.finishDragFollow = function finishDragFollow() {
    if (this.dragNode || !this.dragReleasePending) return;
    this.dragReleasePending = false;
    for (var i = 0; i < this.nodes.length; i += 1) this.nodes[i].fixed = false;
    this.savePositions();
    this.settled = true;
    this.dragOffsets = new Map();
    if (this.selected && this.adjacent.size) this.start();
  };

  SidebarGraphView.prototype.cancelDragFollow = function cancelDragFollow(save) {
    if (this.dragFollowFrame) global.cancelAnimationFrame(this.dragFollowFrame);
    this.dragFollowFrame = null;
    this.dragReleasePending = false;
    if (save) {
      for (var i = 0; i < this.nodes.length; i += 1) this.nodes[i].fixed = false;
      this.savePositions();
      this.settled = true;
    }
    this.dragOffsets = new Map();
  };

  SidebarGraphView.prototype.savePositions = function savePositions() {
    for (var i = 0; i < this.nodes.length; i += 1) {
      var node = this.nodes[i];
      this.positions.set(node.id, { x: node.x, y: node.y });
    }
  };

  SidebarGraphView.prototype.clearPositions = function clearPositions() {
    this.positions.clear();
    this.adjacent = new Set();
  };

  SidebarGraphView.prototype.loop = function loop() {
    this.frame = null;
    if (global.document && global.document.hidden) return;
    var animateFlow = !this.reducedMotion;
    if (animateFlow) this.edgeFlow = (this.edgeFlow + 0.55) % 60;
    var active = this.step();
    this.draw();
    if (!active && !this.settled && !this.dragNode && !this.dragReleasePending) {
      this.settled = true;
      for (var i = 0; i < this.nodes.length; i += 1) this.nodes[i].fixed = false;
      this.savePositions();
      if (this.callbacks.onStats) {
        this.callbacks.onStats({ nodes: this.nodes.length, edges: this.edges.length });
      }
    }
    if (!this.dragNode && !this.dragReleasePending &&
        (active || (animateFlow && this.selected && this.adjacent.size))) {
      var self = this;
      this.frame = global.requestAnimationFrame(function () { self.loop(); });
    }
  };

  SidebarGraphView.prototype.step = function step() {
    var nodes = this.nodes;
    if (!nodes.length || this.dragReleasePending) return false;
    if (this.ticks > 260 || this.alpha < 0.015) {
      this.alpha = 0;
      return false;
    }
    this.ticks += 1;
    this.alpha *= 0.986;
    var repulsion = 1500;
    var movable = [];
    for (var m = 0; m < nodes.length; m += 1) {
      if (!nodes[m].fixed) movable.push(nodes[m]);
    }
    for (var i = 0; i < movable.length; i += 1) {
      var a = movable[i];
      for (var j = 0; j < nodes.length; j += 1) {
        var b = nodes[j];
        if (a === b || (!b.fixed && b.index < a.index)) continue;
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        var dist2 = dx * dx + dy * dy;
        if (dist2 < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          dist2 = 1;
        }
        var force = repulsion / dist2;
        var dist = Math.sqrt(dist2);
        var fx = (dx / dist) * force * this.alpha;
        var fy = (dy / dist) * force * this.alpha;
        a.vx += fx;
        a.vy += fy;
        if (!b.fixed) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }
    }
    for (var k = 0; k < this.edges.length; k += 1) {
      var edge = this.edges[k];
      var start = this.byId.get(edge.from);
      var end = this.byId.get(edge.to);
      if (!start || !end || (start.fixed && end.fixed)) continue;
      var ex = end.x - start.x;
      var ey = end.y - start.y;
      var length = Math.max(1, Math.sqrt(ex * ex + ey * ey));
      var rest = this.nodeDistance + (1 - edge.confidence) * 34;
      var pull = (length - rest) * 0.012 * this.alpha;
      var px = (ex / length) * pull;
      var py = (ey / length) * pull;
      if (!start.fixed) {
        start.vx += px;
        start.vy += py;
      }
      if (!end.fixed) {
        end.vx -= px;
        end.vy -= py;
      }
    }
    for (var n = 0; n < movable.length; n += 1) {
      var node = movable[n];
      node.vx += (0 - node.x) * 0.0016;
      node.vy += (0 - node.y) * 0.0016;
      node.vx *= 0.86;
      node.vy *= 0.86;
      var speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > 9) {
        node.vx = (node.vx / speed) * 9;
        node.vy = (node.vy / speed) * 9;
      }
      if (node !== this.dragNode) {
        node.x += node.vx;
        node.y += node.vy;
      }
    }
    return true;
  };

  SidebarGraphView.prototype.draw = function draw() {
    var ctx = this.ctx;
    var width = this.width;
    var height = this.height;
    var dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(this.transform.x, this.transform.y);
    ctx.scale(this.transform.k, this.transform.k);

    var selected = this.selected;
    var hover = this.hover;
    var adjacent = this.adjacent;
    var k = this.transform.k;
    var pad = 40 / k;
    var minX = -this.transform.x / k - pad;
    var minY = -this.transform.y / k - pad;
    var maxX = (width - this.transform.x) / k + pad;
    var maxY = (height - this.transform.y) / k + pad;
    var activeEdges = this.activeEdges;
    var activeCount = 0;
    var groups = this.edgeGroups;
    groups.forEach(function (group) { group.segments.length = 0; });

    for (var e = 0; e < this.edges.length; e += 1) {
      var edge = this.edges[e];
      var a = edge.a || this.byId.get(edge.from);
      var b = edge.b || this.byId.get(edge.to);
      if (!a || !b) continue;
      if ((a.x < minX && b.x < minX) || (a.x > maxX && b.x > maxX) ||
          (a.y < minY && b.y < minY) || (a.y > maxY && b.y > maxY)) continue;
      var active = selected && (edge.from === selected || edge.to === selected);
      if (active) {
        var slot = activeEdges[activeCount];
        if (!slot) {
          slot = {};
          activeEdges[activeCount] = slot;
        }
        slot.ax = a.x;
        slot.ay = a.y;
        slot.bx = b.x;
        slot.by = b.y;
        slot.color = edge.color;
        activeCount += 1;
        continue;
      }
      var group = groups.get(edge.groupKey);
      if (!group) {
        group = { color: '', dash: null, alpha: 0, width: 0, segments: [] };
        groups.set(edge.groupKey, group);
      }
      if (!group.segments.length) {
        group.color = edge.color;
        group.dash = edge.dash;
        group.alpha = selected ? 0.04 : edge.alpha;
        group.width = edge.width;
      }
      group.segments.push(a.x, a.y, b.x, b.y);
    }
    if (activeEdges.length > activeCount) activeEdges.length = activeCount;

    groups.forEach(function (group) {
      var segments = group.segments;
      if (!segments.length) return;
      ctx.setLineDash(group.dash);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = group.color;
      ctx.globalAlpha = group.alpha;
      ctx.lineWidth = group.width;
      ctx.beginPath();
      for (var s = 0; s < segments.length; s += 4) {
        ctx.moveTo(segments[s], segments[s + 1]);
        ctx.lineTo(segments[s + 2], segments[s + 3]);
      }
      ctx.stroke();
    });

    for (var ae = 0; ae < activeCount; ae += 1) {
      var activeEdge = activeEdges[ae];
      var ax = activeEdge.ax;
      var ay = activeEdge.ay;
      var bx = activeEdge.bx;
      var by = activeEdge.by;
      ctx.setLineDash(EDGE_DASHES.active);
      ctx.lineDashOffset = -this.edgeFlow;
      ctx.strokeStyle = activeEdge.color;
      ctx.globalAlpha = 0.92;
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      var angle = Math.atan2(by - ay, bx - ax);
      var tx = bx - Math.cos(angle) * 9;
      var ty = by - Math.sin(angle) * 9;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.cos(angle - 0.4) * 6, ty - Math.sin(angle - 0.4) * 6);
      ctx.lineTo(tx - Math.cos(angle + 0.4) * 6, ty - Math.sin(angle + 0.4) * 6);
      ctx.closePath();
      ctx.fillStyle = activeEdge.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    function shape(node, radius) {
      ctx.beginPath();
      if (node.kind === 'group') {
        ctx.roundRect(node.x - radius * 1.4, node.y - radius, radius * 2.8, radius * 2, 5);
      } else if (node.type === 'memory') {
        ctx.moveTo(node.x, node.y - radius);
        ctx.lineTo(node.x + radius, node.y);
        ctx.lineTo(node.x, node.y + radius);
        ctx.lineTo(node.x - radius, node.y);
        ctx.closePath();
      } else if (node.type === 'document' || node.type === 'doc_section') {
        ctx.roundRect(node.x - radius * 0.85, node.y - radius * 0.85, radius * 1.7, radius * 1.7, 2);
      } else if (node.type === 'class') {
        ctx.roundRect(node.x - radius * 0.92, node.y - radius * 0.92, radius * 1.84, radius * 1.84, radius * 0.42);
      } else {
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      }
    }

    for (var j = 0; j < this.nodes.length; j += 1) {
      var node = this.nodes[j];
      var radius = node.kind === 'group'
        ? node.baseRadius
        : node.baseRadius + (node === hover ? 1.5 : 0);
      if (node.x + radius < minX || node.x - radius > maxX ||
          node.y + radius < minY || node.y - radius > maxY) continue;
      var color = node.color;
      var dim = selected && !adjacent.has(node.id) && node.id !== selected;
      shape(node, radius);
      ctx.fillStyle = color;
      ctx.globalAlpha = dim ? 0.22 : 0.96;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (node.expandable && node.kind !== 'group') {
        ctx.beginPath();
        ctx.arc(node.x + radius + 3, node.y - radius - 1, 2, 0, Math.PI * 2);
        ctx.fillStyle = node.expanded ? 'rgba(228, 228, 231, 0.85)' : 'rgba(161, 161, 170, 0.55)';
        ctx.fill();
      }
      if (node.id === selected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(250, 250, 250, 0.85)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      } else if (!dim) {
        shape(node, radius);
        ctx.strokeStyle = 'rgba(9, 9, 11, 0.9)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }

    var showLabels = this.transform.k >= 0.75;
    var fontsSettled = !global.document || !global.document.fonts || global.document.fonts.status === 'loaded';
    for (var l = 0; l < this.nodes.length; l += 1) {
      var current = this.nodes[l];
      var focused = current.id === selected || current === hover;
      var important = current.degree >= 7 && showLabels;
      var always = showLabels && (current.kind === 'group' || this.nodes.length <= 40);
      if (!focused && !important && !always) continue;
      if (current.x < minX || current.x > maxX || current.y < minY || current.y > maxY) continue;
      var labelRadius = current.baseRadius;
      ctx.font = focused ? '600 11px Geist, "Segoe UI", sans-serif' : '10px Geist, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      var label = current.label;
      var widthKey = focused ? 'focusedLabelWidth' : 'labelWidth';
      var labelWidth = current[widthKey];
      if (labelWidth == null || !fontsSettled) {
        labelWidth = ctx.measureText(label).width;
        if (fontsSettled) current[widthKey] = labelWidth;
      }
      ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
      ctx.fillRect(current.x - labelWidth / 2 - 3, current.y - labelRadius - 17, labelWidth + 6, 14);
      ctx.fillStyle = focused ? '#fafafa' : 'rgba(228, 228, 231, 0.7)';
      ctx.fillText(label, current.x, current.y - labelRadius - 5);
    }
    ctx.restore();
    if (this.callbacks.onZoom) this.callbacks.onZoom(this.transform.k);
  };

  SidebarGraphView.prototype.screen = function screen(event) {
    var rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  SidebarGraphView.prototype.world = function world(point) {
    return {
      x: (point.x - this.transform.x) / this.transform.k,
      y: (point.y - this.transform.y) / this.transform.k
    };
  };

  SidebarGraphView.prototype.pick = function pick(event) {
    var point = this.world(this.screen(event));
    for (var i = this.nodes.length - 1; i >= 0; i -= 1) {
      var node = this.nodes[i];
      var radius = node.kind === 'group' ? node.baseRadius + 8 : node.baseRadius + 4;
      var dx = node.x - point.x;
      var dy = node.y - point.y;
      if (dx * dx + dy * dy <= radius * radius) return node;
    }
    return null;
  };

  SidebarGraphView.prototype.descendantsOf = function descendantsOf(id) {
    var out = new Set();
    var stack = [id];
    while (stack.length) {
      var bucket = this.childIds.get(stack.pop());
      if (!bucket) continue;
      for (var i = 0; i < bucket.length; i += 1) {
        var child = bucket[i];
        if (child === id || out.has(child)) continue;
        out.add(child);
        stack.push(child);
      }
    }
    return out;
  };

  SidebarGraphView.prototype.onDown = function onDown(event) {
    this.cancelCamera();
    var node = this.pick(event);
    this.moved = false;
    if (event.pointerId != null && this.canvas.setPointerCapture) {
      try { this.canvas.setPointerCapture(event.pointerId); } catch (error) {}
    }
    if (!this.dragNode && (this.dragFollowFrame || this.dragReleasePending)) {
      this.cancelDragFollow(true);
    }
    if (node) {
      var self = this;
      this.dragNode = node;
      this.dragIds = this.descendantsOf(node.id);
      this.dragOffsets = new Map();
      var queue = [{ id: node.id, depth: 0 }];
      var seen = new Set([node.id]);
      while (queue.length) {
        var item = queue.shift();
        var kids = this.childIds.get(item.id) || [];
        for (var k = 0; k < kids.length; k += 1) {
          var id = kids[k];
          if (seen.has(id)) continue;
          seen.add(id);
          var child = self.byId.get(id);
          if (!child) continue;
          this.dragOffsets.set(id, {
            x: child.x - node.x,
            y: child.y - node.y,
            depth: item.depth + 1
          });
          queue.push({ id: id, depth: item.depth + 1 });
        }
      }
      this.dragFollowParent = { x: node.x, y: node.y };
      this.dragAlpha = this.alpha;
      this.dragSettled = this.settled;
      this.alpha = 0;
      this.canvas.classList.add('dragging');
    } else {
      var point = this.screen(event);
      this.pan = {
        sx: point.x,
        sy: point.y,
        ox: this.transform.x,
        oy: this.transform.y
      };
    }
  };

  SidebarGraphView.prototype.onMove = function onMove(event) {
    var point = this.screen(event);
    if (this.dragNode) {
      var world = this.world(point);
      this.dragNode.x = world.x;
      this.dragNode.y = world.y;
      this.dragNode.vx = 0;
      this.dragNode.vy = 0;
      this.dragFollowParent = { x: world.x, y: world.y };
      this.moved = true;
      if (this.dragOffsets.size) this.startDragFollow();
      else this.requestDraw();
      return;
    }
    if (this.pan) {
      this.transform.x = this.pan.ox + (point.x - this.pan.sx);
      this.transform.y = this.pan.oy + (point.y - this.pan.sy);
      if (Math.abs(point.x - this.pan.sx) + Math.abs(point.y - this.pan.sy) > 3) this.moved = true;
      this.requestDraw();
      return;
    }
    var node = this.pick(event);
    if (node !== this.hover) {
      this.hover = node;
      this.requestDraw();
      if (node) {
        this.tip.innerHTML = esc(node.title) + '<div class="sg-tip-sub">' + esc(node.type) +
          ' · ' + esc(node.path || '') + (node.lines ? ':' + esc(node.lines) : '') + '</div>';
      } else {
        this.hideTip();
        return;
      }
    }
    if (node) {
      this.tip.hidden = false;
      this.tip.style.left = point.x + 'px';
      this.tip.style.top = point.y + 'px';
    }
  };

  SidebarGraphView.prototype.onUp = function onUp(event, cancelled) {
    if (event && event.pointerId != null && this.canvas.releasePointerCapture) {
      try { this.canvas.releasePointerCapture(event.pointerId); } catch (error) {}
    }
    if (this.dragNode) {
      var node = this.dragNode;
      this.dragNode = null;
      this.dragIds = new Set();
      this.canvas.classList.remove('dragging');
      if (this.moved) {
        this.dragFollowParent = { x: node.x, y: node.y };
        this.dragReleasePending = true;
        if (this.dragOffsets.size) this.startDragFollow();
        else this.finishDragFollow();
      } else {
        this.cancelDragFollow(false);
        this.alpha = this.dragAlpha;
        this.settled = this.dragSettled;
        if (!cancelled) {
          this.select(node.id);
          if (this.callbacks.onSelect) this.callbacks.onSelect(node.id);
        }
      }
      return;
    }
    this.pan = null;
  };

  SidebarGraphView.prototype.onWheel = function onWheel(event) {
    event.preventDefault();
    this.cancelCamera();
    var point = this.screen(event);
    var factor = event.deltaY < 0 ? 1.12 : 0.89;
    var next = Math.min(3, Math.max(0.25, this.transform.k * factor));
    var world = this.world(point);
    this.transform.k = next;
    this.transform.x = point.x - world.x * next;
    this.transform.y = point.y - world.y * next;
    this.requestDraw();
  };

  SidebarGraphView.prototype.hideTip = function hideTip() {
    this.tip.hidden = true;
    if (this.hover) {
      this.hover = null;
      this.requestDraw();
    }
  };

  SidebarGraphView.prototype.select = function select(id) {
    this.selected = id;
    this.updateAdjacent();
    this.draw();
    if (this.alpha > 0 || (!this.reducedMotion && id && this.adjacent.size)) this.start();
  };

  SidebarGraphView.prototype.focusNode = function focusNode(id) {
    var node = this.byId.get(id);
    if (!node) return;
    this.selected = id;
    this.updateAdjacent();
    var k = Math.max(1.1, this.transform.k);
    this.setTransform({
      k: k,
      x: this.width / 2 - node.x * k,
      y: this.height / 2 - node.y * k
    }, { duration: 240 });
    if (this.alpha > 0 || (!this.reducedMotion && this.adjacent.size)) this.start();
  };

  SidebarGraphView.prototype.fit = function fit() {
    if (!this.nodes.length) return;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < this.nodes.length; i += 1) {
      var node = this.nodes[i];
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }
    var width = Math.max(40, maxX - minX);
    var height = Math.max(40, maxY - minY);
    var k = Math.max(0.25, Math.min(this.width / (width + 160), this.height / (height + 160), 1.7));
    this.setTransform({
      k: k,
      x: this.width / 2 - ((minX + maxX) / 2) * k,
      y: this.height / 2 - ((minY + maxY) / 2) * k
    }, { duration: 260 });
  };

  function shellHtml() {
    var lensButtons = CORE.VIEW_ORDER.map(function (id) {
      return '<button class="sg-lens' + (id === 'architecture' ? ' is-active' : '') +
        '" type="button" role="tab" data-lens="' + esc(id) + '" aria-selected="' +
        (id === 'architecture' ? 'true' : 'false') + '">' + esc(CORE.VIEWS[id].label) + '</button>';
    }).join('');
    var limitOptions = LIMITS.map(function (value) {
      return '<option value="' + value + '"' + (value === 80 ? ' selected' : '') + '>' + value + '</option>';
    }).join('');
    var memoryChips = MEMORY_FILTERS.map(function (item) {
      return '<button class="sg-chip' + (item.value === '' ? ' is-active' : '') +
        '" type="button" data-memory-type="' + esc(item.value) + '">' + esc(item.label) + '</button>';
    }).join('');
    return '<div class="sg-layout">' +
      '<div class="sg-lenses" role="tablist" aria-label="Graph lenses">' + lensButtons + '</div>' +
      '<div class="sg-toolbar">' +
        '<form class="sg-search" id="sg-search-form">' +
          '<span class="sg-search-glyph" aria-hidden="true">⌕</span>' +
          '<input id="sg-q" type="search" autocomplete="off" spellcheck="false" placeholder="搜索图谱节点">' +
        '</form>' +
        '<div class="sg-memory" id="sg-memory" hidden><span class="sg-kicker">MEMORY</span>' +
          '<div class="sg-chips">' + memoryChips + '</div></div>' +
        '<div class="sg-filter"><span class="sg-kicker">TYPE</span><div class="sg-chips" id="sg-types"></div></div>' +
        '<div class="sg-filter"><span class="sg-kicker">RELATION</span><div class="sg-chips" id="sg-relations"></div></div>' +
        '<div class="sg-tools">' +
          '<label class="sg-limit"><span class="sg-kicker">LIMIT</span>' +
            '<select id="sg-limit">' + limitOptions + '</select></label>' +
          '<button class="sg-action" type="button" id="sg-fit">Fit</button>' +
          '<button class="sg-action" type="button" id="sg-reload">Reload</button>' +
        '</div>' +
      '</div>' +
      '<div class="sg-stage" id="sg-stage">' +
        '<canvas id="sg-canvas"></canvas>' +
        '<div class="sg-hud">' +
          '<div class="sg-hud-row"><span><b id="sg-hud-nodes">0</b> nodes</span>' +
            '<span><b id="sg-hud-edges">0</b> edges</span>' +
            '<span><b id="sg-hud-zoom">100%</b> zoom</span></div>' +
          '<div class="sg-hint" id="sg-hint"></div>' +
        '</div>' +
        '<div class="sg-legend" id="sg-legend"></div>' +
        '<div class="sg-empty" id="sg-empty" hidden><div class="sg-empty-title"></div>' +
          '<div class="sg-empty-detail"></div></div>' +
        '<div class="sg-truncated" id="sg-truncated" hidden><span>TRUNCATED</span></div>' +
        '<div class="sg-tip" id="sg-tip" hidden></div>' +
        '<aside class="sg-detail" id="sg-detail" hidden aria-label="节点详情"></aside>' +
      '</div>' +
      '<div class="sg-statusbar">' +
        '<span>NODES <b id="sg-node-count">0</b></span>' +
        '<span>RELATIONS <b id="sg-edge-count">0</b></span>' +
        '<span>VIEW <b id="sg-view-count">Architecture</b></span>' +
        '<span class="sg-status-note" id="sg-status-note"></span>' +
      '</div>' +
      '</div>';
  }

  function create(context) {
    var ctx = context || {};
    var state = {
      initialized: false,
      active: false,
      projectId: '',
      capabilities: null,
      capabilitiesProject: '',
      view: 'architecture',
      stores: {},
      detailId: null,
      epoch: 0,
      detailEpoch: 0,
      focusId: null,
      settings: CORE.normalizeGraphSettings(ctx.getGraphSettings ? ctx.getGraphSettings() : null),
      graph: null
    };
    var elements = {};
    var graph = null;

    function setSettings(settings) {
      state.settings = CORE.normalizeGraphSettings(settings);
      if (graph) graph.setNodeDistance(state.settings.nodeDistance);
    }

    function projectId() {
      return String(ctx.getProjectId ? ctx.getProjectId() : '');
    }

    function project() {
      return ctx.getProject ? ctx.getProject() : null;
    }

    function notify(message, level) {
      if (ctx.notify) ctx.notify(message, level);
    }

    function currentView() {
      return CORE.VIEWS[state.view] ? state.view : 'architecture';
    }

    function cfgFor(viewId) {
      if (!state.stores[viewId]) {
        var view = CORE.viewFor(viewId);
        state.stores[viewId] = {
          store: CORE.createStore(viewId),
          types: new Set(view.nodeTypes),
          relations: new Set(),
          maxNodes: 80,
          search: '',
          memoryType: '',
          loaded: false,
          loading: false,
          truncated: false,
          capabilities: null,
          total: null
        };
      }
      return state.stores[viewId];
    }

    function setBusy(value) {
      if (elements.stage) elements.stage.classList.toggle('is-busy', Boolean(value));
    }

    function showEmpty(title, detail) {
      if (!elements.empty) return;
      elements.empty.hidden = false;
      setText(elements.empty.querySelector('.sg-empty-title'), title);
      setText(elements.empty.querySelector('.sg-empty-detail'), detail || '');
    }

    function hideEmpty() {
      if (elements.empty) elements.empty.hidden = true;
    }

    function renderChrome() {
      var cfg = cfgFor(currentView());
      var stats = CORE.stats(cfg.store);
      setText(elements.hudNodes, stats.nodes);
      setText(elements.hudEdges, stats.edges);
      setText(elements.nodeCount, stats.nodes);
      setText(elements.edgeCount, stats.edges);
      setText(elements.viewCount, CORE.viewFor(currentView()).label);
      setText(elements.hint, CORE.viewFor(currentView()).hint);

      if (elements.legend) {
        var types = Object.keys(stats.byType).sort(function (a, b) {
          return stats.byType[b] - stats.byType[a];
        });
        elements.legend.innerHTML = types.map(function (type) {
          return '<span class="sg-legend-item"><span class="sg-swatch is-' + safeClass(type) +
            '" style="background:' + CORE.typeColor(type) + '"></span>' + esc(type) + ' ' +
            stats.byType[type] + '</span>';
        }).join('');
      }

      if (!stats.nodes) {
        showEmpty('Nothing loaded yet', CORE.viewFor(currentView()).hint);
      } else {
        hideEmpty();
      }

      if (elements.truncated) elements.truncated.hidden = !cfg.truncated;
      var bits = [];
      if (stats.synthetic) bits.push(stats.synthetic + ' derived groups');
      if (cfg.total != null) bits.push(cfg.total + ' memories total');
      if (cfg.truncated) bits.push('result truncated by LIMIT');
      setText(elements.statusNote, bits.join(' · '));
    }

    function syncControls() {
      var cfg = cfgFor(currentView());
      var view = CORE.viewFor(currentView());
      var caps = cfg.capabilities || state.capabilities || {};
      var nodeCounts = caps.node_counts || {};

      if (elements.memory) elements.memory.hidden = currentView() !== 'memory';
      if (elements.search) elements.search.placeholder = '搜索' + view.label + '节点';

      if (elements.types) {
        elements.types.innerHTML = view.nodeTypes.map(function (type) {
          var active = cfg.types.has(type);
          var count = Number(nodeCounts[type] || 0);
          return '<button class="sg-chip' + (active ? ' is-active' : '') +
            '" type="button" data-type="' + esc(type) + '">' +
            '<span class="sg-swatch is-' + safeClass(type) + '" style="background:' +
            CORE.typeColor(type) + '"></span>' + esc(type) +
            ' <b>' + count + '</b></button>';
        }).join('');
      }

      if (elements.relations) {
        var options = CORE.relationOptions(currentView(), caps.relation_counts || {}, CORE.relationCounts(cfg.store));
        if (!options.length) {
          elements.relations.innerHTML = '<span class="sg-inline-note">no relations in this view yet</span>';
        } else {
          elements.relations.innerHTML = options.map(function (type) {
            var active = cfg.relations.has(type);
            var count = Number((caps.relation_counts || {})[type] || 0);
            return '<button class="sg-chip' + (active ? ' is-active' : '') +
              '" type="button" data-relation="' + esc(type) + '">' +
              '<span class="sg-swatch" style="background:' + CORE.relationColor(type) + '"></span>' +
              esc(type) + ' <b>' + count + '</b></button>';
          }).join('');
        }
      }

      if (elements.search && elements.search.value !== cfg.search) elements.search.value = cfg.search;
      if (elements.limit) elements.limit.value = String(cfg.maxNodes);
      if (elements.memory) {
        var chips = elements.memory.querySelectorAll('[data-memory-type]');
        for (var i = 0; i < chips.length; i += 1) {
          chips[i].classList.toggle('is-active', chips[i].dataset.memoryType === cfg.memoryType);
        }
      }
      if (elements.lenses) {
        for (var j = 0; j < elements.lenses.length; j += 1) {
          var activeLens = elements.lenses[j].dataset.lens === currentView();
          elements.lenses[j].classList.toggle('is-active', activeLens);
          elements.lenses[j].setAttribute('aria-selected', activeLens ? 'true' : 'false');
        }
      }
      renderChrome();
    }

    function toRenderNode(node, cfg) {
      return {
        id: node.id,
        title: node.title,
        type: node.node_type,
        kind: node.kind,
        synthetic: node.synthetic,
        path: node.path,
        lines: node.start_line ? node.start_line + '-' + (node.end_line || node.start_line) : '',
        parentId: cfg.store.parents.get(node.id) || null,
        salience: node.salience,
        expandable: Boolean(node.expandable),
        expanded: cfg.store.expanded.has(node.id)
      };
    }

    function paint(options) {
      var opts = options || {};
      var cfg = cfgFor(currentView());
      if (!graph) return;
      var visible = new Set();
      cfg.store.nodes.forEach(function (node) {
        if (node.synthetic || cfg.types.has(node.node_type) || node.id === graph.selected) {
          visible.add(node.id);
        }
      });
      var nodes = [];
      visible.forEach(function (id) {
        var node = cfg.store.nodes.get(id);
        if (node) nodes.push(toRenderNode(node, cfg));
      });
      var edges = CORE.filterEdges(Array.from(cfg.store.edges.values()), cfg.relations)
        .filter(function (edge) {
          return visible.has(edge.from) && visible.has(edge.to);
        })
        .map(function (edge) {
          return {
            from: edge.from,
            to: edge.to,
            type: edge.relation_type,
            confidence: edge.confidence,
            synthetic: edge.synthetic
          };
        });
      var first = graph.nodes.length === 0;
      graph.setData(nodes, edges, { fit: first && opts.fit !== false, incremental: !first });
      renderChrome();
    }

    async function capabilities(force) {
      if (!force && state.capabilities && state.capabilitiesProject === state.projectId) {
        return state.capabilities;
      }
      var data = await ctx.rpc('graphCapabilities', { projectId: state.projectId });
      state.capabilities = data;
      state.capabilitiesProject = state.projectId;
      return data;
    }

    function absorbStructure(store, payload, parentId, includeDocuments) {
      (payload.directories || []).forEach(function (dir) {
        if (!includeDocuments && Number(dir.files || 0) + Number(dir.symbols || 0) === 0) return;
        CORE.addSyntheticGroup(store, {
          id: 'dir:' + dir.path,
          title: dir.name,
          path: dir.path,
          count: Number(dir.files || 0) + Number(dir.documents || 0),
          meta: {
            kind: 'directory',
            files: dir.files,
            documents: dir.documents,
            symbols: dir.symbols,
            sections: dir.sections
          }
        }, parentId);
      });
      (payload.files || []).forEach(function (file) {
        var childId = file.node_id;
        if (!childId) return;
        if (!includeDocuments && file.node_type === 'document') return;
        var expandable = Number(file.symbols || 0) + Number(file.sections || 0) > 0;
        CORE.addPayload(store, {
          nodes: [{
            node_id: childId,
            node_type: file.node_type,
            title: file.title,
            path: file.path,
            salience: 0.5,
            expandable: expandable,
            meta: { symbols: file.symbols, sections: file.sections }
          }],
          edges: []
        }, { parentId: parentId });
        CORE.addEdges(store, [{
          from_node_id: parentId,
          to_node_id: childId,
          relation_type: 'CONTAINS',
          confidence: 1,
          synthetic: true
        }]);
      });
      if (parentId) {
        store.expanded.add(parentId);
        var parent = store.nodes.get(parentId);
        if (parent) parent.expanded = true;
      }
    }

    async function seedStructure(cfg, epoch, includeDocuments) {
      var data = await ctx.rpc('graphStructure', {
        projectId: state.projectId,
        limit: cfg.maxNodes
      });
      if (epoch !== state.epoch) return;
      var info = project() || {};
      var meta = data.meta || {};
      CORE.addSyntheticGroup(cfg.store, {
        id: ROOT_ID,
        title: info.name || info.slug || 'project',
        path: '',
        count: Number(meta.file_count || 0),
        meta: {
          kind: 'project',
          files: meta.file_count,
          directories: meta.directory_count,
          root: info.root_path
        }
      }, null);
      absorbStructure(cfg.store, data, ROOT_ID, includeDocuments);
      cfg.truncated = Boolean(data.truncated);
    }

    async function seedDocumentation(cfg, epoch) {
      var data = await ctx.rpc('graphOverview', {
        projectId: state.projectId,
        nodeTypes: 'document',
        maxNodes: cfg.maxNodes
      });
      if (epoch !== state.epoch) return;
      CORE.addPayload(cfg.store, { nodes: data.nodes || [], edges: data.edges || [] }, {});
      cfg.truncated = Boolean(data.truncated);
    }

    async function seedMemory(cfg, epoch) {
      var params = {
        projectId: state.projectId,
        query: cfg.search,
        memoryType: cfg.memoryType,
        limit: cfg.maxNodes,
        offset: 0
      };
      var data = await ctx.rpc('memories', params);
      if (epoch !== state.epoch) return;
      CORE.addNodes(cfg.store, (data.memories || []).map(function (item) {
        return {
          node_id: item.node_id,
          node_type: item.node_type || 'memory',
          title: item.title,
          path: null,
          salience: 0.7,
          expandable: false,
          meta: { memory_type: item.memory_type, summary: item.summary }
        };
      }));
      cfg.total = Number(data.total || 0);
      cfg.truncated = (data.memories || []).length < Number(data.total || 0);
    }

    async function applyFocus(epoch) {
      var id = state.focusId;
      if (!id) return;
      state.focusId = null;
      var cfg = cfgFor(currentView());
      if (!cfg.store.nodes.has(id)) {
        try {
          var data = await ctx.rpc('node', { projectId: state.projectId, nodeId: id });
          if (epoch !== state.epoch) return;
          CORE.addPayload(cfg.store, { nodes: [data.node], edges: [] }, {});
          paint({ fit: false });
        } catch (error) {
          return;
        }
      }
      if (graph) graph.focusNode(id);
      await selectNode(id);
      var node = cfg.store.nodes.get(id);
      if (node && node.expandable && !cfg.store.expanded.has(id)) {
        await expandNode(id);
      }
    }

    async function loadRoot(viewId) {
      var cfg = cfgFor(viewId);
      var epoch = state.epoch + 1;
      state.epoch = epoch;
      CORE.reset(cfg.store);
      cfg.loaded = false;
      cfg.loading = true;
      cfg.truncated = false;
      cfg.total = null;
      state.detailId = null;
      closeDetail();
      if (graph) graph.clearSelection();
      setBusy(true);
      showEmpty('Loading…', CORE.viewFor(viewId).hint);
      try {
        var caps = await capabilities();
        if (epoch !== state.epoch || viewId !== state.view) return;
        cfg.capabilities = caps;
        if (viewId === 'architecture') await seedStructure(cfg, epoch, true);
        else if (viewId === 'symbols') await seedStructure(cfg, epoch, false);
        else if (viewId === 'documentation') await seedDocumentation(cfg, epoch);
        else await seedMemory(cfg, epoch);
        if (epoch !== state.epoch || viewId !== state.view) return;
        cfg.loaded = true;
        syncControls();
        paint({ fit: true });
        await applyFocus(epoch);
      } catch (error) {
        if (epoch !== state.epoch || viewId !== state.view) return;
        showEmpty('Load failed', String((error && error.message) || error));
        notify(String((error && error.message) || error), 'error');
      } finally {
        cfg.loading = false;
        if (epoch === state.epoch && viewId === state.view) setBusy(false);
      }
    }

    async function switchView(viewId) {
      if (!CORE.VIEWS[viewId] || viewId === state.view) return;
      state.view = viewId;
      state.detailId = null;
      state.epoch += 1;
      closeDetail();
      if (graph) {
        graph.clearSelection();
        graph.setData([], [], { fit: false });
      }
      syncControls();
      var cfg = cfgFor(viewId);
      if (!cfg.loaded) await loadRoot(viewId);
      else {
        paint({ fit: false });
        setBusy(false);
      }
    }

    async function runSearch() {
      var cfg = cfgFor(currentView());
      cfg.search = elements.search ? elements.search.value.trim() : '';
      if (currentView() === 'memory') {
        await loadRoot('memory');
        return;
      }
      if (!cfg.search) {
        await loadRoot(currentView());
        return;
      }
      var epoch = state.epoch + 1;
      state.epoch = epoch;
      setBusy(true);
      try {
        var data = await ctx.rpc('graphSearch', {
          projectId: state.projectId,
          query: cfg.search,
          nodeTypes: CORE.viewFor(currentView()).searchTypes.join(','),
          limit: 20
        });
        if (epoch !== state.epoch) return;
        var results = data.results || [];
        CORE.addPayload(cfg.store, {
          nodes: results.map(function (item) {
            return {
              node_id: item.node_id,
              node_type: item.node_type,
              title: item.title,
              path: item.path,
              salience: Math.min(1, Number(item.score || 0.6)),
              expandable: true
            };
          }),
          edges: []
        }, {});
        syncControls();
        paint({ fit: false });
        if (results.length) {
          if (graph) graph.focusNode(results[0].node_id);
          await selectNode(results[0].node_id);
        } else {
          notify('没有匹配的图谱节点');
        }
      } catch (error) {
        if (epoch === state.epoch) notify(String((error && error.message) || error), 'error');
      } finally {
        if (epoch === state.epoch) setBusy(false);
      }
    }

    async function expandNode(nodeId) {
      var cfg = cfgFor(currentView());
      var node = cfg.store.nodes.get(nodeId);
      if (!node || !graph) return;
      if (cfg.store.expanded.has(nodeId)) {
        var removed = CORE.collapseNode(cfg.store, nodeId);
        syncControls();
        paint({ fit: false });
        notify(removed ? '已折叠 ' + removed + ' 个节点' : '已折叠');
        return;
      }
      if (!node.expandable) {
        notify('该节点没有可展开的子节点');
        return;
      }
      if (cfg.store.loading.has(nodeId)) return;
      cfg.store.loading.add(nodeId);
      setBusy(true);
      try {
        var found = 0;
        var added = 0;
        if (node.synthetic) {
          var data = await ctx.rpc('graphStructure', {
            projectId: state.projectId,
            pathPrefix: node.path,
            limit: cfg.maxNodes
          });
          absorbStructure(cfg.store, data, node.id, true);
          found = (data.directories || []).length + (data.files || []).length;
          added = found;
        } else {
          var plan = planFor(node);
          if (!plan) {
            node.expandable = false;
            notify('该节点类型暂不支持展开');
            return;
          }
          var params = {
            projectId: state.projectId,
            nodeId: nodeId,
            depth: 1,
            direction: plan.direction,
            limit: 80
          };
          if (plan.relations) params.relationTypes = plan.relations;
          var payload = await ctx.rpc('graphNeighbors', params);
          var result = CORE.addPayload(cfg.store, payload, { parentId: nodeId });
          found = (payload.nodes || []).length + (payload.edges || []).length;
          added = result.nodes + result.edges;
          if (found) {
            cfg.store.expanded.add(nodeId);
            node.expanded = true;
          }
        }
        if (!found) {
          node.expandable = false;
          notify('没有可见的子节点');
        } else if (!added) {
          notify('相邻节点已经在图谱中');
        }
        syncControls();
        paint({ fit: false });
        if (nodeId === state.detailId) await selectNode(nodeId, { keep: true });
      } catch (error) {
        notify(String((error && error.message) || error), 'error');
      } finally {
        cfg.store.loading.delete(nodeId);
        setBusy(false);
      }
    }

    function rows(items) {
      return items.filter(function (item) {
        return item[1] != null && item[1] !== '';
      }).map(function (item) {
        return '<dt>' + esc(item[0]) + '</dt><dd>' + esc(item[1]) + '</dd>';
      }).join('');
    }

    function groupDetailHtml(node) {
      var meta = node.meta || {};
      return '<div class="sg-detail-head"><span class="sg-badge">directory</span>' +
        '<button class="sg-icon-button" type="button" data-detail-close aria-label="关闭">×</button></div>' +
        '<h2 class="sg-detail-title">' + esc(node.title) + '</h2>' +
        '<div class="sg-mono sg-detail-path">' + esc(node.path || '/') + '</div>' +
        '<dl class="sg-kv">' + rows([
          ['files', meta.files],
          ['documents', meta.documents],
          ['symbols', meta.symbols],
          ['sections', meta.sections],
          ['grouping', 'derived from indexed paths']
        ]) + '</dl>' +
        '<div class="sg-detail-note">目录节点由已索引文件路径生成，可展开查看下一层。</div>' +
        '<div class="sg-detail-actions"><button class="sg-primary" type="button" data-action="expand">展开</button></div>';
    }

    function nodeDetailHtml(node, related, memory, storeNode) {
      var content = memory ? memory.content : node.content_preview;
      var truncated = memory ? false : node.content_truncated;
      var buckets = Object.keys(related || {});
      var relatedHtml = buckets.filter(function (key) {
        return (related[key] || []).length;
      }).map(function (key) {
        var items = related[key].map(function (item) {
          return '<button class="sg-related" type="button" data-node="' + esc(item.node_id) + '">' +
            '<span class="sg-badge">' + esc(item.node_type) + '</span>' +
            '<span class="sg-related-title">' + esc(item.title) + '</span>' +
            '<span class="sg-related-type">' + esc(item.relation_type) + '</span></button>';
        }).join('');
        return '<div class="sg-related-group"><span class="sg-kicker">' + esc(key) + ' · ' +
          related[key].length + '</span>' + items + '</div>';
      }).join('');
      var isMemory = node.node_type === 'memory' || node.node_type === 'note';
      var base = rows([
        ['node type', node.node_type],
        ['node id', node.node_id],
        ['project id', node.project_id],
        ['parent', storeNode && storeNode.meta ? storeNode.meta.parent : null],
        ['file path', node.path],
        ['lines', node.start_line ? node.start_line + '-' + (node.end_line || node.start_line) : null],
        ['language', node.language],
        ['memory type', node.memory_type],
        ['salience', Number(node.salience || 0).toFixed(2)],
        ['confidence', Number(node.confidence || 0).toFixed(2)],
        ['provenance', node.provenance],
        ['created', fmtDate(node.created_at)],
        ['updated', fmtDate(node.updated_at)]
      ]);
      var expandable = storeNode && storeNode.expandable;
      var actions = '<div class="sg-detail-actions">' +
        (expandable ? '<button class="sg-primary" type="button" data-action="expand">展开/折叠</button>' : '') +
        (node.path ? '<button class="sg-action" type="button" data-action="open">打开文件</button>' : '') +
        (node.node_type === 'file' || node.node_type === 'document'
          ? '<button class="sg-action" type="button" data-action="symbols">查看符号</button>' : '') +
        '<button class="sg-action" type="button" data-action="copy">复制 ID</button></div>';
      return '<div class="sg-detail-head"><span class="sg-badge type-' + safeClass(node.node_type) + '">' +
        esc(node.node_type) + '</span>' +
        (isMemory && node.memory_type ? '<span class="sg-chip is-active">' + esc(node.memory_type) + '</span>' : '') +
        '<button class="sg-icon-button" type="button" data-detail-close aria-label="关闭">×</button></div>' +
        '<h2 class="sg-detail-title">' + esc(node.title) + '</h2>' +
        '<div class="sg-mono sg-detail-path">' + esc(node.path || 'no path') +
        (node.start_line ? ':' + node.start_line + '-' + (node.end_line || node.start_line) : '') + '</div>' +
        '<dl class="sg-kv">' + base + '</dl>' +
        (node.summary ? '<span class="sg-kicker">SUMMARY</span><div class="sg-detail-text">' + esc(node.summary) + '</div>' : '') +
        (isMemory && (node.tags || []).length
          ? '<span class="sg-kicker">TAGS</span><div class="sg-chips">' + node.tags.map(function (tag) {
            return '<span class="sg-chip">#' + esc(tag) + '</span>';
          }).join('') + '</div>'
          : '') +
        '<span class="sg-kicker">CONTENT' + (truncated ? ' · TRUNCATED' : '') + '</span>' +
        '<div class="sg-preview">' + esc(content || 'no content') + '</div>' +
        actions +
        '<span class="sg-kicker">RELATIONS</span>' +
        (relatedHtml || '<div class="sg-detail-text">no related nodes</div>');
    }

    function closeDetail() {
      state.detailId = null;
      if (!elements.detail) return;
      elements.detail.hidden = true;
      elements.detail.innerHTML = '';
      if (graph) graph.clearSelection();
    }

    async function ensureNode(id) {
      var cfg = cfgFor(currentView());
      if (cfg.store.nodes.has(id)) return cfg.store.nodes.get(id);
      var data = await ctx.rpc('node', { projectId: state.projectId, nodeId: id });
      CORE.addPayload(cfg.store, { nodes: [data.node], edges: [] }, {});
      paint({ fit: false });
      return cfg.store.nodes.get(id);
    }

    async function selectNode(nodeId, options) {
      var opts = options || {};
      var cfg = cfgFor(currentView());
      var node = cfg.store.nodes.get(nodeId);
      if (!elements.detail) return;
      state.detailId = nodeId;
      if (!node) {
        try {
          node = await ensureNode(nodeId);
        } catch (error) {
          elements.detail.hidden = false;
          elements.detail.innerHTML = '<div class="sg-error">' +
            esc(String((error && error.message) || error)) + '</div>';
          return;
        }
      }
      if (graph) graph.select(nodeId);
      elements.detail.hidden = false;
      if (node.synthetic) {
        elements.detail.innerHTML = groupDetailHtml(node);
        wireDetail(node, null);
        return;
      }
      if (opts.keep !== true) {
        elements.detail.innerHTML = '<div class="sg-skeleton"></div><div class="sg-skeleton wide"></div>' +
          '<div class="sg-skeleton tall"></div>';
      }
      var token = state.detailEpoch + 1;
      state.detailEpoch = token;
      try {
        var data = await ctx.rpc('node', { projectId: state.projectId, nodeId: nodeId });
        if (token !== state.detailEpoch) return;
        var memory = null;
        if (node.node_type === 'memory' || node.node_type === 'note') {
          try {
            var memoryData = await ctx.rpc('memory', { projectId: state.projectId, nodeId: nodeId });
            memory = memoryData && memoryData.memory ? memoryData.memory : memoryData;
          } catch (error) {
            memory = null;
          }
          if (token !== state.detailEpoch) return;
        }
        elements.detail.innerHTML = nodeDetailHtml(data.node, data.related || {}, memory, node);
        wireDetail(node, data.node);
      } catch (error) {
        if (token !== state.detailEpoch) return;
        elements.detail.innerHTML = '<div class="sg-error">' +
          esc(String((error && error.message) || error)) + '</div>';
      }
    }

    function wireDetail(storeNode, detail) {
      if (!elements.detail) return;
      var closeButton = elements.detail.querySelector('[data-detail-close]');
      if (closeButton) closeButton.addEventListener('click', closeDetail);
      var actions = elements.detail.querySelectorAll('[data-action]');
      for (var i = 0; i < actions.length; i += 1) {
        actions[i].addEventListener('click', function (event) {
          var action = event.currentTarget.dataset.action;
          if (action === 'expand') expandNode(storeNode.id);
          else if (action === 'copy' && ctx.copy) ctx.copy(storeNode.id);
          else if (action === 'symbols') openIn('symbols', storeNode.id);
          else if (action === 'open' && detail && detail.path && ctx.openPath) {
            ctx.openPath(detail.path, detail.start_line || 1);
          }
        });
      }
      var related = elements.detail.querySelectorAll('[data-node]');
      for (var j = 0; j < related.length; j += 1) {
        related[j].addEventListener('click', function (event) {
          var id = event.currentTarget.dataset.node;
          var cfg = cfgFor(currentView());
          if (!cfg.store.nodes.has(id)) {
            ctx.rpc('node', { projectId: state.projectId, nodeId: id })
              .then(function (data) {
                CORE.addPayload(cfg.store, { nodes: [data.node], edges: [] }, {});
                paint({ fit: false });
                if (graph) graph.focusNode(id);
                selectNode(id);
              })
              .catch(function (error) {
                notify(String((error && error.message) || error), 'error');
              });
            return;
          }
          if (graph) graph.focusNode(id);
          selectNode(id);
        });
      }
    }

    async function openIn(viewId, nodeId) {
      state.focusId = nodeId;
      await switchView(viewId);
    }

    function updateZoom(value) {
      setText(elements.hudZoom, Math.round(Number(value || 1) * 100) + '%');
    }

    function bindEvents() {
      if (elements.lenses) {
        for (var i = 0; i < elements.lenses.length; i += 1) {
          elements.lenses[i].addEventListener('click', function (event) {
            switchView(event.currentTarget.dataset.lens);
          });
        }
      }
      elements.searchForm.addEventListener('submit', function (event) {
        event.preventDefault();
        runSearch();
      });
      elements.limit.addEventListener('change', function () {
        var cfg = cfgFor(currentView());
        cfg.maxNodes = Number(elements.limit.value) || 80;
        loadRoot(currentView());
      });
      elements.fit.addEventListener('click', function () {
        if (graph) graph.fit();
      });
      elements.reload.addEventListener('click', function () {
        state.capabilities = null;
        state.capabilitiesProject = '';
        loadRoot(currentView());
      });
      elements.types.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-type]');
        if (!chip) return;
        var cfg = cfgFor(currentView());
        var type = chip.dataset.type;
        if (cfg.types.has(type)) cfg.types.delete(type);
        else cfg.types.add(type);
        if (!cfg.types.size) cfg.types.add(type);
        syncControls();
        paint({ fit: false });
      });
      elements.relations.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-relation]');
        if (!chip) return;
        var cfg = cfgFor(currentView());
        var type = chip.dataset.relation;
        if (cfg.relations.has(type)) cfg.relations.delete(type);
        else cfg.relations.add(type);
        syncControls();
        paint({ fit: false });
      });
      elements.memory.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-memory-type]');
        if (!chip) return;
        var cfg = cfgFor(currentView());
        cfg.memoryType = chip.dataset.memoryType;
        syncControls();
        loadRoot('memory');
      });
    }

    function init() {
      if (state.initialized) return true;
      var root = document.getElementById('graph-root');
      if (!root) return false;
      root.innerHTML = shellHtml();
      elements = {
        root: root,
        lenses: root.querySelectorAll('[data-lens]'),
        searchForm: root.querySelector('#sg-search-form'),
        search: root.querySelector('#sg-q'),
        memory: root.querySelector('#sg-memory'),
        types: root.querySelector('#sg-types'),
        relations: root.querySelector('#sg-relations'),
        limit: root.querySelector('#sg-limit'),
        fit: root.querySelector('#sg-fit'),
        reload: root.querySelector('#sg-reload'),
        stage: root.querySelector('#sg-stage'),
        canvas: root.querySelector('#sg-canvas'),
        hudNodes: root.querySelector('#sg-hud-nodes'),
        hudEdges: root.querySelector('#sg-hud-edges'),
        hudZoom: root.querySelector('#sg-hud-zoom'),
        hint: root.querySelector('#sg-hint'),
        legend: root.querySelector('#sg-legend'),
        empty: root.querySelector('#sg-empty'),
        truncated: root.querySelector('#sg-truncated'),
        detail: root.querySelector('#sg-detail'),
        tip: root.querySelector('#sg-tip'),
        nodeCount: root.querySelector('#sg-node-count'),
        edgeCount: root.querySelector('#sg-edge-count'),
        viewCount: root.querySelector('#sg-view-count'),
        statusNote: root.querySelector('#sg-status-note')
      };
      graph = new SidebarGraphView(elements.canvas, elements.tip, {
        onSelect: function (id) { selectNode(id); },
        onExpand: function (id) { expandNode(id); },
        onZoom: updateZoom,
        onStats: renderChrome
      });
      graph.setNodeDistance(state.settings.nodeDistance);
      state.graph = graph;
      bindEvents();
      state.initialized = true;
      return true;
    }

    async function activate() {
      if (!init()) return;
      state.active = true;
      var currentProjectId = projectId();
      if (currentProjectId !== state.projectId) {
        state.projectId = currentProjectId;
        state.capabilities = null;
        state.capabilitiesProject = '';
        state.stores = {};
        state.epoch += 1;
        state.detailId = null;
        closeDetail();
      if (graph) {
        graph.clearSelection();
        graph.setData([], [], { fit: false });
        graph.clearPositions();
      }
      }
      if (!state.projectId) {
        showEmpty('请选择项目', '连接本地服务并选择项目后加载知识图谱。');
        syncControls();
        return;
      }
      if (graph) graph.resize();
      var cfg = cfgFor(currentView());
      if (!cfg.loaded && !cfg.loading) {
        await loadRoot(currentView());
      } else if (cfg.loaded) {
        setBusy(false);
        syncControls();
        paint({ fit: false });
      }
    }

    function reset() {
      state.projectId = projectId();
      state.capabilities = null;
      state.capabilitiesProject = '';
      state.stores = {};
      state.epoch += 1;
      state.detailId = null;
      state.focusId = null;
      closeDetail();
      if (graph) {
        graph.clearSelection();
        graph.setData([], [], { fit: false });
      }
      if (state.initialized) {
        syncControls();
        showEmpty(state.projectId ? '切换到图谱加载' : '请选择项目',
          state.projectId ? '点击上方项目或 Reload 加载当前视图。' : '连接本地服务并选择项目后加载知识图谱。');
      }
    }

    return {
      init: init,
      activate: activate,
      reset: reset,
      setSettings: setSettings
    };
  }

  global.SynapseSidebarGraph = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
