/* Go — two-player online play over PeerJS, plus problems. */
(function () {
  'use strict';

  var E = window.GoEngine;
  var PROBLEMS = Array.isArray(window.GO_PROBLEMS) ? window.GO_PROBLEMS : [];
  var SVGNS = 'http://www.w3.org/2000/svg';
  var LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  var PARAMS = new URLSearchParams(location.search);

  // ------------------------------------------------------------------ utils

  function $(id) { return document.getElementById(id); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function sv(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  var ls = {
    get: function (k, d) {
      try { var v = localStorage.getItem('go.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('go.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  };

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }

  function colorName(c) { return c === 1 ? 'Black' : 'White'; }
  function colorLetter(c) { return c === 1 ? 'B' : 'W'; }
  function fmtNum(n) { return (Math.round(n * 10) / 10).toString(); }
  function resultText(res) {
    if (!res) return '';
    if (res.resigned) return colorName(3 - res.resigned) + ' wins by resignation';
    if (res.winner === 0) return 'Jigo — a draw';
    return colorName(res.winner) + ' wins by ' + fmtNum(res.margin);
  }
  function resultSGF(res) {
    if (!res) return '';
    if (res.resigned) return colorLetter(3 - res.resigned) + '+R';
    if (res.winner === 0) return '0';
    return colorLetter(res.winner) + '+' + fmtNum(res.margin);
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function stoneIcon(c) { return h('span', { class: 'stone-icon ' + (c === 1 ? 'b' : 'w'), 'aria-hidden': 'true' }); }
  // Sandboxed frames block window.confirm, so destructive buttons arm on first click.
  function confirmButton(label, armedLabel, action, cls) {
    var armed = false, timer = 0;
    var b = h('button', { class: 'btn ' + (cls || ''), text: label, onclick: function () {
      if (!armed) {
        armed = true;
        b.textContent = armedLabel;
        b.classList.add('armed');
        timer = setTimeout(function () { armed = false; b.textContent = label; b.classList.remove('armed'); }, 3500);
        return;
      }
      clearTimeout(timer);
      action();
    } });
    return b;
  }
  function radioValue(form, name) {
    var r = form.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : null;
  }


  function gameSetupState(p) {
    // p: { size, komi, handicap, setup, toPlay }
    var opts = { komi: Number(p.komi), handicap: Number(p.handicap) || 0 };
    if (p.setup) opts.setup = { black: p.setup.black || [], white: p.setup.white || [] };
    if (p.toPlay) opts.toPlay = p.toPlay;
    return E.createGame(Number(p.size), opts);
  }

  // ------------------------------------------------------------------ SGF export dialog

  var sgfUrl = null;
  function showSGF(text, name) {
    var dlg = $('sgf-dialog');
    $('sgf-text').value = text;
    if (sgfUrl) URL.revokeObjectURL(sgfUrl);
    sgfUrl = URL.createObjectURL(new Blob([text], { type: 'application/x-go-sgf' }));
    var a = $('sgf-download');
    a.href = sgfUrl;
    a.setAttribute('download', (name || 'game') + '.sgf');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  $('sgf-copy').addEventListener('click', function () {
    var ta = $('sgf-text');
    var done = function () { toast('Copied to clipboard'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); document.execCommand('copy'); done(); });
    } else { ta.select(); document.execCommand('copy'); done(); }
  });

  function exportSGF(state, meta, name) {
    var text;
    try { text = E.toSGF(state, meta); }
    catch (e) { toast('Could not export: ' + e.message); return; }
    showSGF(text, name);
  }

  // ------------------------------------------------------------------ board view (SVG)

  var boardSeq = 0;
  var showCoords = ls.get('coords', false);

  function BoardView(host, handlers) {
    this.host = host;
    this.handlers = handlers || {};
    this.uid = 'bv' + (++boardSeq);
    this.size = 0;
    this.prevBoard = null;
    this.opts = null;
    this.hover = -1;
    this.pending = -1; // touch: first tap previews, second confirms
    this.build();
  }

  BoardView.prototype.build = function () {
    var u = this.uid;
    var svg = sv('svg', { xmlns: SVGNS, role: 'img', 'aria-label': 'Go board' });
    var defs = sv('defs', {});
    defs.innerHTML =
      '<radialGradient id="' + u + 'b" cx="0.36" cy="0.32" r="0.72" fx="0.33" fy="0.28">' +
        '<stop offset="0" stop-color="#6b6b6b"/><stop offset="0.28" stop-color="#2e2e2e"/>' +
        '<stop offset="0.85" stop-color="#0c0c0c"/><stop offset="1" stop-color="#050505"/></radialGradient>' +
      '<radialGradient id="' + u + 'w" cx="0.38" cy="0.34" r="0.74" fx="0.34" fy="0.28">' +
        '<stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f1eee6"/>' +
        '<stop offset="0.9" stop-color="#d3cdc0"/><stop offset="1" stop-color="#bcb5a6"/></radialGradient>' +
      '<filter id="' + u + 'blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.045"/></filter>' +
      '<mask id="' + u + 'gm" maskUnits="userSpaceOnUse" x="-3" y="-3" width="60" height="60">' +
        '<rect x="-3" y="-3" width="60" height="60" fill="#fff"/><g></g></mask>';
    svg.appendChild(defs);
    this.gridHoles = defs.querySelector('mask g');
    this.gGrid = sv('g', { mask: 'url(#' + u + 'gm)' });
    this.gTerr = sv('g', {});
    this.gShadow = sv('g', { filter: 'url(#' + u + 'blur)', opacity: '0.42' });
    this.gStones = sv('g', {});
    this.gGone = sv('g', {});
    this.gMarks = sv('g', {});
    this.gGhost = sv('g', {});
    [this.gGrid, this.gTerr, this.gShadow, this.gStones, this.gGone, this.gMarks, this.gGhost].forEach(function (g) { svg.appendChild(g); });
    this.svg = svg;
    this.host.appendChild(svg);

    var self = this;
    svg.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      self.setHover(self.pointAt(e));
    });
    svg.addEventListener('pointerleave', function () { self.setHover(-1); });
    svg.addEventListener('click', function (e) {
      var i = self.pointAt(e);
      if (i < 0 || !self.opts) return;
      var mode = self.opts.mode;
      if (mode === 'play') {
        if (!self.legal(i)) return;
        var small = self.cellPx() < 26;
        if (self.lastPointerType === 'touch' && small && self.pending !== i) {
          self.pending = i;
          self.drawGhost(i, true);
          return;
        }
        self.pending = -1;
        self.drawGhost(-1);
        if (self.handlers.onPlay) self.handlers.onPlay(i);
      } else if (mode === 'mark') {
        if (self.opts.board[i] && self.handlers.onMark) self.handlers.onMark(i);
      }
    });
    svg.addEventListener('pointerdown', function (e) { self.lastPointerType = e.pointerType; });
  };

  BoardView.prototype.cellPx = function () {
    var r = this.svg.getBoundingClientRect();
    return this.vb ? r.width / this.vb[2] : 0;
  };

  BoardView.prototype.pointAt = function (e) {
    if (!this.size || !this.vb) return -1;
    var r = this.svg.getBoundingClientRect();
    if (!r.width) return -1;
    var vb = this.vb;
    // preserveAspectRatio meet: viewBox fits inside and is centred.
    var scale = Math.min(r.width / vb[2], r.height / vb[3]);
    var ox = r.left + (r.width - vb[2] * scale) / 2;
    var oy = r.top + (r.height - vb[3] * scale) / 2;
    var ux = (e.clientX - ox) / scale + vb[0];
    var uy = (e.clientY - oy) / scale + vb[1];
    var x = Math.round(ux), y = Math.round(uy);
    var c = this.crop;
    if (x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1) return -1;
    if (Math.abs(ux - x) > 0.5 || Math.abs(uy - y) > 0.5) return -1;
    return y * this.size + x;
  };

  BoardView.prototype.legal = function (i) {
    var o = this.opts;
    if (!o || o.mode !== 'play' || o.board[i]) return false;
    return o.isLegal ? o.isLegal(i) : true;
  };

  BoardView.prototype.setHover = function (i) {
    if (i === this.hover) return;
    this.hover = i;
    if (this.pending >= 0) return;
    this.drawGhost(i >= 0 && this.legal(i) ? i : -1);
  };

  BoardView.prototype.drawGhost = function (i, confirm) {
    clear(this.gGhost);
    this.host.classList.toggle('playable', !!(this.opts && this.opts.mode !== 'none'));
    if (i < 0 || !this.opts || !this.opts.ghostColor) return;
    var x = i % this.size, y = (i - x) / this.size;
    var c = this.opts.ghostColor;
    this.gGhost.appendChild(sv('circle', {
      cx: x, cy: y, r: 0.47, class: 'bv-ghost' + (confirm ? ' confirm' : ''),
      fill: 'url(#' + this.uid + (c === 1 ? 'b' : 'w') + ')'
    }));
  };

  // Lay out grid / coordinates when size, crop or coordinate setting changes.
  BoardView.prototype.layout = function (size, crop, coords) {
    crop = crop || { x0: 0, y0: 0, x1: size - 1, y1: size - 1 };
    var key = [size, crop.x0, crop.y0, crop.x1, crop.y1, coords].join(',');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.size = size;
    this.crop = crop;
    this.prevBoard = null;
    var g = clear(this.gGrid);

    var edgeM = coords ? 1.15 : 0.7, openM = coords ? 1.15 : 0.55;
    var mL = crop.x0 === 0 ? edgeM : openM, mT = crop.y0 === 0 ? edgeM : openM;
    var mR = crop.x1 === size - 1 ? (coords ? 0.7 : edgeM) : 0.55;
    var mB = crop.y1 === size - 1 ? (coords ? 0.7 : edgeM) : 0.55;
    var vb = [crop.x0 - mL, crop.y0 - mT, crop.x1 - crop.x0 + mL + mR, crop.y1 - crop.y0 + mT + mB];
    this.vb = vb;
    this.svg.setAttribute('viewBox', vb.join(' '));

    var lw = 1; // CSS px; lines use non-scaling-stroke so they stay fine at any board size
    var ext = function (lo, hi, a, b) { return [a === 0 ? 0 : lo, b === size - 1 ? size - 1 : hi]; };
    var xr = ext(vb[0], vb[0] + vb[2], crop.x0, crop.x1);
    var yr = ext(vb[1], vb[1] + vb[3], crop.y0, crop.y1);
    for (var k = 0; k < size; k++) {
      var edge = k === 0 || k === size - 1;
      if (k >= crop.y0 - 1 && k <= crop.y1 + 1)
        g.appendChild(sv('line', { x1: xr[0], y1: k, x2: xr[1], y2: k, class: 'bv-line', 'stroke-width': edge ? lw * 1.8 : lw }));
      if (k >= crop.x0 - 1 && k <= crop.x1 + 1)
        g.appendChild(sv('line', { x1: k, y1: yr[0], x2: k, y2: yr[1], class: 'bv-line', 'stroke-width': edge ? lw * 1.8 : lw }));
    }
    var stars = [];
    try { stars = E.starPoints(size) || []; } catch (e) { stars = []; }
    stars.forEach(function (i) {
      var x = i % size, y = (i - x) / size;
      g.appendChild(sv('circle', { cx: x, cy: y, r: size >= 19 ? 0.1 : size >= 13 ? 0.09 : 0.075, fill: '#3b2a14' }));
    });
    if (coords) {
      for (var x = crop.x0; x <= crop.x1; x++) {
        var t = sv('text', { x: x, y: vb[1] + 0.45, class: 'bv-coord', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        t.textContent = LETTERS[x];
        g.appendChild(t);
      }
      for (var y = crop.y0; y <= crop.y1; y++) {
        var t2 = sv('text', { x: vb[0] + 0.45, y: y, class: 'bv-coord', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        t2.textContent = String(size - y);
        g.appendChild(t2);
      }
    }
    // Keep the board inside the viewport height; aspect follows the crop.
    var ratio = vb[2] / vb[3];
    this.host.style.aspectRatio = vb[2] + ' / ' + vb[3];
    // Cropped problem views would otherwise blow up to enormous stones.
    var capPx = (crop.x1 - crop.x0 < size - 1 || crop.y1 - crop.y0 < size - 1) ? Math.round(vb[2] * 58) + 'px' : '100%';
    this.host.style.maxWidth = 'min(' + capPx + ', max(240px, calc((100vh - 130px) * ' + ratio.toFixed(4) + ')))';
  };

  /* opts: { board, size, crop, lastMove, mode: 'play'|'mark'|'none', ghostColor, isLegal(i),
             dead: Set, territory: Int8Array, labels: {i: text}, animate } */
  BoardView.prototype.render = function (opts) {
    this.layout(opts.size, opts.crop, showCoords);
    this.opts = opts;
    this.pending = -1;
    var size = opts.size, board = opts.board, u = this.uid;
    var prev = this.prevBoard;
    var animate = opts.animate !== false && prev && prev.length === board.length;
    clear(this.gShadow); clear(this.gStones); clear(this.gMarks); clear(this.gTerr); clear(this.gridHoles);
    var dead = opts.dead || null;

    for (var i = 0; i < board.length; i++) {
      var c = board[i];
      var x = i % size, y = (i - x) / size;
      if (opts.territory && opts.territory[i] && (!c || (dead && dead.has(i)))) {
        var tc = opts.territory[i];
        this.gTerr.appendChild(sv('rect', {
          x: x - 0.15, y: y - 0.15, width: 0.3, height: 0.3, rx: 0.03,
          fill: tc === 1 ? '#151515' : '#f4f1ea', stroke: tc === 1 ? 'none' : 'rgba(0,0,0,.35)', 'stroke-width': 0.02
        }));
      }
      if (!c) {
        if (animate && prev[i]) this.fadeOut(i, prev[i]);
        continue;
      }
      var isDead = dead && dead.has(i);
      var fresh = animate && !prev[i];
      if (!isDead) {
        this.gShadow.appendChild(sv('circle', { cx: x + 0.06, cy: y + 0.09, r: 0.47, fill: '#000', class: fresh ? 'bv-shadow drop' : null }));
      }
      this.gStones.appendChild(sv('circle', {
        cx: x, cy: y, r: 0.475,
        fill: 'url(#' + u + (c === 1 ? 'b' : 'w') + ')',
        class: 'bv-stone' + (fresh ? ' drop' : '') + (isDead ? ' bv-dead' : '')
      }));
      if (isDead && opts.territory) {
        var owner = 3 - c;
        this.gMarks.appendChild(sv('rect', {
          x: x - 0.15, y: y - 0.15, width: 0.3, height: 0.3, rx: 0.03,
          fill: owner === 1 ? '#151515' : '#f4f1ea', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 0.02
        }));
      }
    }

    var lm = opts.lastMove;
    if (typeof lm === 'number' && lm >= 0 && board[lm]) {
      var lx = lm % size, ly = (lm - lx) / size;
      this.gMarks.appendChild(sv('circle', {
        cx: lx, cy: ly, r: 0.2, fill: 'none',
        stroke: board[lm] === 1 ? '#e9866b' : '#a8432a', 'stroke-width': 0.065
      }));
    }
    if (opts.marks) {
      for (var mk in opts.marks) {
        var mi = Number(mk);
        if (opts.labels && opts.labels[mi] != null) continue;
        this.drawMark(mi, opts.marks[mk], board[mi]);
      }
    }
    if (opts.labels) {
      for (var key in opts.labels) {
        var li = Number(key), lxx = li % size, lyy = (li - lxx) / size;
        var t = sv('text', { x: lxx, y: lyy + 0.02, class: 'bv-label', fill: board[li] === 1 ? '#f4f1ea' : '#1b1b1b' });
        if (String(opts.labels[key]).length > 2) t.setAttribute('style', 'font-size:0.38px');
        t.textContent = opts.labels[key];
        this.gMarks.appendChild(t);
      }
    }
    this.prevBoard = Int8Array.from(board);
    this.drawGhost(this.hover >= 0 && this.legal(this.hover) ? this.hover : -1);
  };

  // Problem diagram marks: shapes on stones or empty points, letters on a cleared patch of wood.
  BoardView.prototype.drawMark = function (i, mark, c) {
    var x = i % this.size, y = (i - x) / this.size, g = this.gMarks;
    var ink = c === 1 ? '#f4f1ea' : c === 2 ? '#1b1b1b' : '#2b1a07';
    var line = { fill: 'none', stroke: ink, 'stroke-width': 0.07, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
    var shape = function (tag, attrs) { g.appendChild(sv(tag, Object.assign({}, line, attrs))); };
    if (mark.shape === 'circle') shape('circle', { cx: x, cy: y, r: 0.23 });
    else if (mark.shape === 'square') shape('rect', { x: x - 0.19, y: y - 0.19, width: 0.38, height: 0.38 });
    else if (mark.shape === 'triangle') {
      shape('polygon', { points: x + ',' + (y - 0.25) + ' ' + (x + 0.23) + ',' + (y + 0.15) + ' ' + (x - 0.23) + ',' + (y + 0.15) });
    } else if (mark.shape === 'cross') {
      shape('path', { d: 'M' + (x - 0.17) + ' ' + (y - 0.17) + 'L' + (x + 0.17) + ' ' + (y + 0.17) + 'M' + (x + 0.17) + ' ' + (y - 0.17) + 'L' + (x - 0.17) + ' ' + (y + 0.17) });
    }
    if (mark.label != null) {
      if (!c) this.gridHoles.appendChild(sv('circle', { cx: x, cy: y, r: 0.34, fill: '#000' }));
      var t = sv('text', { x: x, y: y + 0.02, class: 'bv-label bv-mark-label', fill: ink });
      t.textContent = mark.label;
      g.appendChild(t);
    }
  };

  BoardView.prototype.fadeOut = function (i, c) {
    var x = i % this.size, y = (i - x) / this.size;
    var el = sv('circle', { cx: x, cy: y, r: 0.475, fill: 'url(#' + this.uid + (c === 1 ? 'b' : 'w') + ')', class: 'bv-gone' });
    this.gGone.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
  };

  var boards = [];
  function makeBoard(host, handlers) { var b = new BoardView(host, handlers); boards.push(b); return b; }

  // ------------------------------------------------------------------ shared panel pieces

  function renderPlayers(host, info) {
    // info: { names: {1,2}, you: 1|2|0, toMove: 1|2|0, captures: {1,2}, extra: {1,2} }
    clear(host);
    [1, 2].forEach(function (c) {
      var row = h('div', { class: 'player' + (info.toMove === c ? ' to-move' : '') + (info.you === c ? ' mine' : '') },
        stoneIcon(c),
        h('span', { class: 'pname' }, info.names[c] || colorName(c), info.you === c ? h('span', { class: 'you', text: '(you)' }) : null),
        h('span', { class: 'pcap', text: (info.extra && info.extra[c]) || (info.captures[c] + ' captured') })
      );
      host.appendChild(row);
    });
  }

  function scoreLine(sc, komi) {
    var b = sc.breakdown;
    if (b && b.black && b.white) {
      var part = function (x) {
        var pr = (x.captures || 0) + (x.dead || 0);
        return fmtNum(x.territory || 0) + ' territory + ' + fmtNum(pr) + (pr === 1 ? ' prisoner' : ' prisoners');
      };
      return 'Black ' + fmtNum(sc.black) + ' (' + part(b.black) + ') · White ' + fmtNum(sc.white) + ' (' + part(b.white) +
        (b.white.komi ? ' + ' + fmtNum(b.white.komi) + ' komi' : '') + ')';
    }
    return 'Black ' + fmtNum(sc.black) + ' · White ' + fmtNum(sc.white) + (komi ? ' (incl. komi ' + fmtNum(komi) + ')' : '');
  }

  function toggleGroup(state, dead, i) {
    var next = new Set(dead);
    var g = E.groupAt(state, i);
    var stones = (g && g.stones) || [i];
    var isDead = next.has(i);
    stones.forEach(function (s) { if (isDead) next.delete(s); else next.add(s); });
    return next;
  }

  function illegalText(reason) {
    return ({ occupied: 'That point is taken.', suicide: 'Suicide is not allowed.', ko: 'Ko — play elsewhere first.', offboard: 'Off the board.' })[reason] || 'Illegal move.';
  }
  function safeEstimateDead(st) {
    try { return new Set(E.estimateDead(st) || []); } catch (e) { return new Set(); }
  }

  // ------------------------------------------------------------------ problems

  var Problems = {
    idx: 0, solved: new Set(ls.get('solved', [])), filtered: [],
    init: function () {
      var self = this;
      this.board = makeBoard($('board-problem'), { onPlay: function (i) { self.play(i); } });
      var levels = [];
      PROBLEMS.forEach(function (p) { if (p.level && levels.indexOf(p.level) < 0) levels.push(p.level); });
      levels.forEach(function (l) { $('p-level').appendChild(h('option', { value: l, text: cap(l) })); });
      $('p-search').addEventListener('input', function () { self.renderList(); });
      $('p-level').addEventListener('change', function () { self.renderList(); });
      $('p-unsolved').addEventListener('change', function () { self.renderList(); });
      $('p-retry').addEventListener('click', function () { self.load(self.idx); });
      $('p-prev').addEventListener('click', function () { self.step(-1); });
      $('p-next').addEventListener('click', function () { self.step(1); });
      $('p-solution').addEventListener('click', function () { self.showSolution(); });
      $('p-step-fwd').addEventListener('click', function () { self.solStep(1); });
      $('p-step-back').addEventListener('click', function () { self.solStep(-1); });
      $('p-step-exit').addEventListener('click', function () { self.load(self.idx); });
      $('p-play').addEventListener('click', function () { self.playFrom(); });
      if (!PROBLEMS.length) {
        $('p-title').textContent = 'Problems unavailable';
        $('p-prompt').textContent = 'The problem collection did not load.';
        return;
      }
      var start = Math.max(0, Math.min(PROBLEMS.length - 1, ls.get('problem', 0)));
      this.renderList();
      this.load(start);
    },
    renderList: function () {
      var q = $('p-search').value.trim().toLowerCase();
      var lvl = $('p-level').value, unsolved = $('p-unsolved').checked;
      var self = this, list = clear($('p-list'));
      var num = /^\d+$/.test(q) ? Number(q) : null;
      this.filtered = [];
      PROBLEMS.forEach(function (p, k) {
        if (lvl && p.level !== lvl) return;
        if (unsolved && self.solved.has(p.id)) return;
        if (q) {
          var hay = (p.title + ' ' + (p.prompt || '') + ' ' + (p.level || '')).toLowerCase();
          if (!(num != null && (p.id === num || String(p.id).indexOf(q) === 0)) && hay.indexOf(q) < 0) return;
        }
        self.filtered.push(k);
      });
      var frag = document.createDocumentFragment();
      this.filtered.forEach(function (k) {
        var p = PROBLEMS[k];
        frag.appendChild(h('li', null, h('button', {
          'data-k': k, 'aria-current': k === self.idx ? 'true' : 'false',
          onclick: function () { self.load(k); }
        },
          h('span', { class: 'pn', text: String(p.id) }),
          h('span', { class: 'pt' }, p.title, h('small', { text: cap(p.level || '') + ' · ' + (p.toPlay === 'W' ? 'White' : 'Black') + ' to play' })),
          h('span', { class: 'ps' + (self.solved.has(p.id) ? ' solved' : ''), title: self.solved.has(p.id) ? 'Solved' : '' })
        )));
      });
      list.appendChild(frag);
      $('p-count').textContent = this.filtered.length + ' of ' + PROBLEMS.length + ' · ' + this.solved.size + ' solved';
    },
    markCurrent: function () {
      var self = this;
      Array.prototype.forEach.call($('p-list').querySelectorAll('button[data-k]'), function (b) {
        var cur = Number(b.getAttribute('data-k')) === self.idx;
        b.setAttribute('aria-current', cur ? 'true' : 'false');
        if (cur && activeTab === 'problems') {
          var list = $('p-list'), lr = list.getBoundingClientRect(), br = b.getBoundingClientRect();
          if (br.top < lr.top) list.scrollTop -= lr.top - br.top + 8;
          else if (br.bottom > lr.bottom) list.scrollTop += br.bottom - lr.bottom + 8;
        }
      });
    },
    step: function (d) {
      if (!PROBLEMS.length) return;
      var pos = this.filtered.indexOf(this.idx);
      var next;
      if (pos >= 0 && this.filtered.length) next = this.filtered[Math.max(0, Math.min(this.filtered.length - 1, pos + d))];
      else next = Math.max(0, Math.min(PROBLEMS.length - 1, this.idx + d));
      if (next !== this.idx) this.load(next);
    },
    setupFor: function (p) {
      var size = p.size || 19;
      var black = (p.black || []).map(function (s) { return E.sgfToPoint(s, size); }).filter(function (i) { return i >= 0; });
      var white = (p.white || []).map(function (s) { return E.sgfToPoint(s, size); }).filter(function (i) { return i >= 0; });
      return { size: size, black: black, white: white, toPlay: p.toPlay === 'W' ? 2 : 1 };
    },
    marksFor: function (p, size) {
      var out = {}, m = p.marks;
      if (!m) return out;
      ['circle', 'square', 'triangle', 'cross'].forEach(function (shape) {
        (m[shape] || []).forEach(function (s) { var i = E.sgfToPoint(s, size); if (i >= 0) out[i] = { shape: shape }; });
      });
      Object.keys(m.labels || {}).forEach(function (s) {
        var i = E.sgfToPoint(s, size);
        if (i >= 0) out[i] = Object.assign(out[i] || {}, { label: String(m.labels[s]) });
      });
      return out;
    },
    // Marks describe the initial diagram, so a point loses its mark once play changes it.
    visibleMarks: function () {
      var out = {}, st = this.state.board, b0 = this.base.board;
      for (var k in this.marks) if (st[k] === b0[k]) out[k] = this.marks[k];
      return out;
    },
    computeCrop: function (p, setup) {
      var size = setup.size, pts = setup.black.concat(setup.white);
      Object.keys(this.marksFor(p, size)).forEach(function (k) { pts.push(Number(k)); });
      (function walk(nodes) {
        (nodes || []).forEach(function (n) {
          if (n.m && n.m !== 'tt') { var i = E.sgfToPoint(n.m, size); if (i >= 0) pts.push(i); }
          walk(n.children);
        });
      })(p.solution);
      if (!pts.length) return null;
      var x0 = size, y0 = size, x1 = -1, y1 = -1;
      pts.forEach(function (i) {
        var x = i % size, y = Math.floor(i / size);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      });
      var M = 2, MIN = 7;
      x0 -= M; y0 -= M; x1 += M; y1 += M;
      // grow tiny regions so the view keeps some context
      while (x1 - x0 + 1 < MIN) { x0--; x1++; }
      while (y1 - y0 + 1 < MIN) { y0--; y1++; }
      var snap = function (lo, hi) {
        if (lo <= 2) lo = 0;
        if (hi >= size - 3) hi = size - 1;
        if (lo < 0) lo = 0;
        if (hi > size - 1) hi = size - 1;
        return [lo, hi];
      };
      var xs = snap(x0, x1), ys = snap(y0, y1);
      return { x0: xs[0], x1: xs[1], y0: ys[0], y1: ys[1] };
    },
    load: function (k) {
      if (!PROBLEMS[k]) return;
      clearTimeout(this.timer);
      this.idx = k;
      ls.set('problem', k);
      var p = PROBLEMS[k];
      this.p = p;
      this.setup = this.setupFor(p);
      this.crop = this.computeCrop(p, this.setup);
      this.marks = this.marksFor(p, this.setup.size);
      this.base = E.createGame(this.setup.size, { komi: 0, setup: { black: this.setup.black, white: this.setup.white }, toPlay: this.setup.toPlay });
      this.state = this.base;
      this.node = { children: p.solution || [] };
      this.status = 'solving'; // solving | waiting | correct | wrong | solution
      this.comment = '';
      this.board.prevBoard = null;
      $('p-eyebrow').textContent = 'Problem ' + p.id + (p.level ? ' · ' + cap(p.level) : '');
      $('p-title').textContent = p.title || ('Problem ' + p.id);
      $('p-prompt').textContent = p.prompt || ((p.toPlay === 'W' ? 'White' : 'Black') + ' to play');
      var src = clear($('p-source'));
      if (p.url) append(src, ['Source: ', h('a', { href: p.url, target: '_blank', rel: 'noopener', text: p.source || 'link' })]);
      else if (p.source) src.textContent = 'Source: ' + p.source;
      $('p-prev').disabled = this.filtered.indexOf(k) === 0 || k === 0;
      $('p-next').disabled = k === PROBLEMS.length - 1 || (this.filtered.length && this.filtered.indexOf(k) === this.filtered.length - 1);
      $('p-steps').hidden = true;
      $('p-controls').hidden = false;
      this.markCurrent();
      this.render(false);
    },
    toPlayColor: function () { return this.setup.toPlay; },
    play: function (i) {
      if (this.status !== 'solving') return;
      var st = this.state, size = st.size;
      if (st.toPlay !== this.toPlayColor()) return;
      var r = E.play(st, i % size, Math.floor(i / size));
      if (!r.ok) { toast(illegalText(r.reason)); return; }
      this.state = r.state;
      var sgf = E.pointToSgf(i, size);
      var child = (this.node.children || []).filter(function (n) { return n.m === sgf; })[0];
      if (!child) {
        this.finish('wrong', 'That move is not part of the solution.');
        return;
      }
      this.node = child;
      this.comment = child.c || '';
      this.advance(child, null);
    },
    advance: function (playerNode, parentOk) {
      var self = this;
      var kids = playerNode.children || [];
      if (!kids.length) {
        if (playerNode.ok || parentOk) this.finish('correct', playerNode.c);
        else this.finish('wrong', playerNode.c);
        return;
      }
      this.status = 'waiting';
      this.render(true);
      this.timer = setTimeout(function () {
        var resp = kids[0];
        var st = self.state, size = st.size;
        if (!resp.m || resp.m === 'tt' || (size <= 19 && resp.m === '')) st = E.pass(st);
        else {
          var i = E.sgfToPoint(resp.m, size);
          var r = i >= 0 ? E.play(st, i % size, Math.floor(i / size)) : { ok: false };
          if (!r.ok) {
            self.finish(playerNode.ok ? 'correct' : 'wrong', playerNode.c);
            return;
          }
          st = r.state;
        }
        self.state = st;
        self.node = resp;
        if (resp.c) self.comment = resp.c;
        if (!resp.children || !resp.children.length) {
          if (resp.ok || playerNode.ok) self.finish('correct', resp.c || playerNode.c);
          else self.finish('wrong', resp.c || playerNode.c);
          return;
        }
        self.status = 'solving';
        self.render(true);
      }, 420);
    },
    finish: function (verdict, comment) {
      this.status = verdict;
      if (comment) this.comment = comment;
      if (verdict === 'correct' && this.peeked !== this.p.id) {
        this.solved.add(this.p.id);
        ls.set('solved', Array.from(this.solved));
        this.renderList();
        this.markCurrent();
      }
      this.render(true);
    },
    mainLine: function () {
      // At player levels prefer a child whose subtree reaches ok; opponent levels take the first child.
      function hasOk(n) { return !!n.ok || (n.children || []).some(hasOk); }
      var line = [], nodes = this.p.solution || [], player = true;
      while (nodes && nodes.length) {
        var pick = player ? (nodes.filter(function (n) { return n.ok; })[0] || nodes.filter(hasOk)[0] || nodes[0]) : nodes[0];
        line.push(pick);
        nodes = pick.children;
        player = !player;
      }
      return line;
    },
    showSolution: function () {
      clearTimeout(this.timer);
      this.peeked = this.p.id;
      this.line = this.mainLine();
      this.solPos = 0;
      this.status = 'solution';
      $('p-steps').hidden = false;
      $('p-controls').hidden = true;
      this.solStep(0);
    },
    solStep: function (d) {
      this.solPos = Math.max(0, Math.min(this.line.length, this.solPos + d));
      var st = this.base, size = st.size, labels = {};
      for (var k = 0; k < this.solPos; k++) {
        var m = this.line[k].m;
        if (!m || m === 'tt') { st = E.pass(st); continue; }
        var i = E.sgfToPoint(m, size);
        var r = E.play(st, i % size, Math.floor(i / size));
        if (r.ok) { st = r.state; labels[i] = String(k + 1); }
      }
      this.state = st;
      this.solLabels = labels;
      var cur = this.line[this.solPos - 1];
      this.comment = cur ? (cur.c || '') : '';
      $('p-step-back').disabled = this.solPos === 0;
      $('p-step-fwd').disabled = this.solPos >= this.line.length;
      this.render(d !== 0);
    },
    render: function (animate) {
      var st = this.state, self = this;
      var solving = this.status === 'solving';
      this.board.render({
        board: st.board, size: st.size, crop: this.crop, lastMove: this.status === 'solution' ? -1 : st.lastMove,
        mode: solving ? 'play' : 'none', ghostColor: this.toPlayColor(),
        isLegal: function (i) { return E.isLegal(st, i % st.size, Math.floor(i / st.size)); },
        labels: this.status === 'solution' ? this.solLabels : null, marks: this.visibleMarks(), animate: animate
      });
      var fb = clear($('p-feedback'));
      if (this.status === 'correct') fb.appendChild(h('div', { class: 'verdict ok', text: 'Correct' }));
      else if (this.status === 'wrong') fb.appendChild(h('div', { class: 'verdict bad', text: 'Not quite' }));
      else if (this.status === 'solution') {
        fb.appendChild(h('div', { class: 'comment dim', text: 'Solution · move ' + this.solPos + ' of ' + this.line.length }));
      } else if (this.status === 'waiting') {
        fb.appendChild(h('div', { class: 'comment dim', text: colorName(3 - self.toPlayColor()) + ' is responding…' }));
      } else if (!this.comment) {
        fb.appendChild(h('div', { class: 'comment dim', text: (this.solved.has(this.p.id) ? 'Solved before. ' : '') + 'You play ' + colorName(this.toPlayColor()) + '.' }));
      }
      if (this.comment) fb.appendChild(h('div', { class: 'comment', text: this.comment }));
      $('p-retry').textContent = this.status === 'wrong' || this.status === 'correct' ? 'Try again' : 'Reset';
    },
    playFrom: function () {
      var s = this.setup;
      Play.newGame({
        size: s.size, color: s.toPlay === 2 ? 'W' : 'B', setup: { black: s.black.slice(), white: s.white.slice() },
        toPlay: s.toPlay, title: 'Problem ' + this.p.id
      });
      toast('New game from Problem ' + this.p.id + ' \u2014 you play ' + colorName(s.toPlay));
    }
  };
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ------------------------------------------------------------------ two-player room over PeerJS
  // Both players open the same URL. The first tab claims peer id A and waits; the second
  // finds A taken, takes B and dials A. If A vanishes, B tries to become A itself.

  var PUBLIC_URL = 'https://hanshenr.github.io/go/';
  var ROOM = (PARAMS.get('room') || '7f3k').replace(/[^a-z0-9]/gi, '').slice(0, 16) || '7f3k';
  var PEER_IDS = ['hanshenr-go-' + ROOM + '-a', 'hanshenr-go-' + ROOM + '-b'];

  function showBanner(text) {
    var b = $('banner');
    b.textContent = text;
    b.hidden = false;
  }

  var me = (function () {
    var id = ls.get('me.id', null);
    if (!id || !/^[a-z0-9]{8,24}$/.test(id)) {
      id = (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, '');
      ls.set('me.id', id);
    }
    var name = ls.get('me.name', null);
    if (!name) { name = 'Guest ' + (1000 + Math.floor(Math.random() * 9000)); ls.set('me.name', name); }
    return { id: id, name: name };
  })();

  function cleanUser(u) {
    if (!u || typeof u.id !== 'string') return null;
    return { id: u.id.slice(0, 24), name: String(u.name || 'Guest').slice(0, 40) };
  }

  var Room = {
    peer: null, conn: null, role: '', state: 'connecting', opponent: null, reason: '',
    retryTimer: 0, everOpen: false, netFails: 0, lastSeen: 0,

    start: function () {
      var self = this;
      if (!window.Peer) { this.fail('nopeer'); return; }
      // A Content-Security-Policy that blocks the signalling socket (e.g. the Superset page) means no P2P here.
      document.addEventListener('securitypolicyviolation', function (e) {
        if (/peerjs|wss?:/.test(String(e.blockedURI) + ' ' + e.violatedDirective)) self.fail('blocked');
      });
      setInterval(function () { self.heartbeat(); }, 4000);
      this.claim(0);
    },
    emit: function () { Play.render(); },
    fail: function (why) {
      if (this.state === 'failed') return;
      this.state = 'failed';
      this.reason = why;
      clearTimeout(this.retryTimer);
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
      this.emit();
    },
    retry: function (k, delay) {
      if (this.state === 'failed') return;
      var self = this;
      clearTimeout(this.retryTimer);
      if (this.state !== 'offline') this.state = 'connecting';
      this.retryTimer = setTimeout(function () { self.claim(k); }, delay);
      this.emit();
    },
    claim: function (k) {
      if (this.state === 'failed') return;
      var self = this;
      clearTimeout(this.retryTimer);
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
      this.conn = null;
      this.opponent = null;
      var p;
      try { p = new window.Peer(PEER_IDS[k], { debug: 0 }); } catch (e) { this.fail('nopeer'); return; }
      this.peer = p;
      p.on('open', function () {
        if (p !== self.peer) return;
        self.everOpen = true;
        self.netFails = 0;
        self.role = k ? 'b' : 'a';
        self.state = 'waiting';
        self.emit();
        if (k === 1) self.dial();
      });
      p.on('connection', function (c) {
        if (p !== self.peer || self.role !== 'a') { c.on('open', function () { c.close(); }); return; }
        if (self.conn && self.conn !== c) { var old = self.conn; self.conn = null; try { old.close(); } catch (e) { /* ignore */ } }
        self.attach(c);
      });
      p.on('disconnected', function () {
        setTimeout(function () { try { if (p === self.peer && p.disconnected && !p.destroyed) p.reconnect(); } catch (e) { /* ignore */ } }, 2000);
      });
      p.on('error', function (err) {
        if (p !== self.peer) return;
        var t = err && err.type;
        if (t === 'unavailable-id') self.retry(k === 0 ? 1 : 0, k === 0 ? 0 : 2500);
        else if (t === 'peer-unavailable') self.retry(0, 1500);
        else if (t === 'browser-incompatible' || t === 'ssl-unavailable') self.fail('incompatible');
        else if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
          self.netFails++;
          if (self.netFails >= 2) self.state = 'offline';
          self.retry(k, Math.min(2000 * self.netFails, 10000));
        } else self.retry(0, 3000);
      });
    },
    dial: function () {
      var self = this, p = this.peer;
      var c = p.connect(PEER_IDS[0], { reliable: true });
      this.attach(c);
      setTimeout(function () { if (self.conn === c && !c.open && p === self.peer) self.retry(0, 0); }, 10000);
    },
    attach: function (c) {
      var self = this;
      this.conn = c;
      c.on('open', function () {
        if (self.conn !== c) return;
        self.lastSeen = Date.now();
        self.send({ t: 'hello', user: me, game: Play.game });
      });
      c.on('data', function (m) {
        if (self.conn !== c || !m || typeof m !== 'object') return;
        self.lastSeen = Date.now();
        if (m.t === 'hello' || m.t === 'name') {
          self.opponent = cleanUser(m.user);
          self.state = 'connected';
        }
        if (m.game) Play.receive(m.game, m.t === 'game');
        if (m.t === 'hello' || m.t === 'name') { Play.seatCheck(); self.emit(); }
      });
      var gone = function () {
        if (self.conn !== c) return;
        self.conn = null;
        self.opponent = null;
        if (self.state !== 'failed') self.state = 'waiting';
        self.emit();
        if (self.role === 'b') self.retry(0, 1000);
      };
      c._gone = gone;
      c.on('close', gone);
      c.on('error', gone);
    },
    heartbeat: function () {
      var c = this.conn;
      if (!c || !c.open) return;
      this.send({ t: 'ping' });
      if (Date.now() - this.lastSeen > 15000) { try { c.close(); } catch (e) { /* ignore */ } c._gone(); }
    },
    send: function (m) { try { if (this.conn && this.conn.open) this.conn.send(m); } catch (e) { /* dropped */ } }
  };

  // ------------------------------------------------------------------ the shared game
  /* One current game, kept whole on both sides; the higher version wins.
     { v, ts, by, id, size, komi, setup?, toPlay?, title?, players: {1: user|null, 2: user|null},
       moves: [{x,y}|{pass}|{resign, c}], dead: [i], accept: {userId: true}, undo: {by, n}|null } */

  function newerGame(a, b) {
    if (!b) return true;
    if (a.v !== b.v) return a.v > b.v;
    if (a.ts !== b.ts) return a.ts > b.ts;
    return String(a.by) > String(b.by);
  }
  function validGame(g) {
    return g && typeof g === 'object' && typeof g.v === 'number' && [9, 13, 19].indexOf(g.size) >= 0 &&
      Array.isArray(g.moves) && g.players && typeof g.players === 'object';
  }

  var Play = {
    game: null, d: null,
    init: function () {
      var self = this;
      this.board = makeBoard($('board-play'), {
        onPlay: function (i) { self.play(i); },
        onMark: function (i) { self.mark(i); }
      });
      var saved = ls.get('game', null);
      if (validGame(saved)) this.game = saved;
      $('new-game').addEventListener('submit', function (e) { e.preventDefault(); });
      $('new-game-btn').addEventListener('click', function () { self.newFromForm(); });
      var input = $('my-name');
      input.value = me.name;
      var commitName = function () {
        var v = input.value.trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!v) { input.value = me.name; return; }
        if (v === me.name) return;
        me.name = v;
        ls.set('me.name', v);
        Room.send({ t: 'name', user: me });
        if (self.game && self.seatOf(me.id)) self.commit(function (g) { g.players[self.seatOf(me.id)].name = v; });
        else self.render();
      };
      input.addEventListener('change', commitName);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { commitName(); input.blur(); } });
      this.render();
    },

    seatOf: function (id, g) {
      g = g || this.game;
      if (!g) return 0;
      if (g.players[1] && g.players[1].id === id) return 1;
      if (g.players[2] && g.players[2].id === id) return 2;
      return 0;
    },
    nameOf: function (c) {
      var p = this.game && this.game.players[c];
      if (!p) return '';
      if (p.id === me.id) return me.name;
      if (Room.opponent && Room.opponent.id === p.id) return Room.opponent.name;
      return p.name;
    },

    receive: function (g, isUpdate) {
      if (!validGame(g)) return;
      if (newerGame(g, this.game)) {
        var prevId = this.game && this.game.id;
        this.game = g;
        ls.set('game', g);
        if (g.id !== prevId) this.board.prevBoard = null;
        this.seatCheck();
        this.render();
      } else if (isUpdate && this.game && this.game !== g && newerGame(this.game, g)) {
        Room.send({ t: 'game', game: this.game }); // we hold a newer record: converge on it
      }
    },
    // Once both people are here, make sure each of them has a seat in the current game.
    seatCheck: function () {
      var g = this.game, opp = Room.opponent;
      if (!g || !opp) return;
      var mine = this.seatOf(me.id), theirs = this.seatOf(opp.id);
      if (mine && theirs) return;
      this.commit(function (x) {
        if (!mine) {
          // take a seat the opponent doesn't hold, preferring an empty one
          var free = [1, 2].filter(function (c) { return !x.players[c] || x.players[c].id !== opp.id; });
          mine = free.filter(function (c) { return !x.players[c]; })[0] || free[0];
          x.players[mine] = { id: me.id, name: me.name };
        }
        if (!theirs) x.players[3 - mine] = { id: opp.id, name: opp.name };
      });
    },
    commit: function (mut) {
      var g = JSON.parse(JSON.stringify(this.game));
      mut(g);
      g.v = (this.game.v || 0) + 1;
      g.ts = Date.now();
      g.by = me.id;
      this.game = g;
      ls.set('game', g);
      Room.send({ t: 'game', game: g });
      this.render();
    },

    newGame: function (opts) {
      var color = opts.color === 'R' ? (Math.random() < 0.5 ? 1 : 2) : opts.color === 'W' ? 2 : 1;
      var prev = this.game;
      var other = Room.opponent || (prev && [prev.players[1], prev.players[2]].filter(function (p) { return p && p.id !== me.id; })[0]) || null;
      var players = {};
      players[color] = { id: me.id, name: me.name };
      players[3 - color] = other ? { id: other.id, name: other.name } : null;
      var g = {
        v: (prev ? prev.v : 0) + 1, ts: Date.now(), by: me.id,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        size: opts.size, komi: opts.komi != null ? opts.komi : 6.5, players: players,
        moves: [], dead: [], accept: {}, undo: null
      };
      if (opts.setup) { g.setup = opts.setup; g.toPlay = opts.toPlay; g.title = opts.title; }
      this.game = g;
      this.board.prevBoard = null;
      ls.set('game', g);
      Room.send({ t: 'game', game: g });
      selectTab('play');
      this.render();
    },
    newFromForm: function () {
      var f = $('new-game');
      this.newGame({ size: Number(radioValue(f, 'size')), color: f.color.value });
    },

    derive: function () {
      var g = this.game;
      var base = gameSetupState(g), st = base, resigned = 0, bad = false;
      for (var k = 0; k < g.moves.length; k++) {
        var m = g.moves[k];
        if (m.resign) { resigned = m.c === 2 ? 2 : 1; break; }
        if (m.pass) { st = E.pass(st); continue; }
        var r = E.play(st, m.x, m.y);
        if (!r.ok) { bad = true; break; }
        st = r.state;
      }
      var d = { state: st, resigned: resigned, bad: bad, phase: 'play', dead: new Set(g.dead || []) };
      var p1 = g.players[1], p2 = g.players[2];
      if (resigned) { d.phase = 'done'; d.result = { resigned: resigned }; }
      else if (st.consecutivePasses >= 2) {
        var acc = g.accept || {};
        if (p1 && p2 && acc[p1.id] && acc[p2.id]) {
          d.phase = 'done';
          var sc = E.score(st, d.dead);
          d.result = { winner: sc.winner, margin: sc.margin };
        } else d.phase = 'scoring';
      }
      return d;
    },
    myColor: function () { return this.seatOf(me.id); },
    canMove: function () {
      var d = this.d, my = this.myColor();
      return d && my && d.phase === 'play' && d.state.toPlay === my && this.game.players[3 - my] && !this.game.undo;
    },
    push: function (m, extra) {
      this.commit(function (g) {
        g.moves.push(m);
        g.undo = null;
        if (extra) extra(g);
      });
    },
    play: function (i) {
      if (!this.canMove()) return;
      var st = this.d.state, x = i % st.size, y = Math.floor(i / st.size);
      var r = E.play(st, x, y);
      if (!r.ok) { toast(illegalText(r.reason)); return; }
      this.push({ x: x, y: y });
    },
    pass: function () {
      if (!this.canMove()) return;
      var after = E.pass(this.d.state);
      this.push({ pass: true }, function (g) {
        if (after.consecutivePasses >= 2) { g.dead = Array.from(safeEstimateDead(after)); g.accept = {}; }
      });
    },
    resign: function () {
      var my = this.myColor();
      if (!my || !this.d || this.d.phase === 'done') return;
      this.push({ resign: true, c: my });
    },
    requestUndo: function () {
      var my = this.myColor(), d = this.d;
      if (!my || !d || d.phase === 'done') return;
      var n = -1;
      // index of my last move in the record
      var st = gameSetupState(this.game), toPlay = st.toPlay;
      this.game.moves.forEach(function (m, k) { if (!m.resign) { if (toPlay === my) n = k; toPlay = 3 - toPlay; } });
      if (n < 0) return;
      this.commit(function (g) { g.undo = { by: me.id, n: n }; });
    },
    answerUndo: function (yes) {
      var u = this.game.undo;
      if (!u || u.by === me.id) return;
      this.commit(function (g) {
        if (yes) { g.moves = g.moves.slice(0, u.n); g.dead = []; g.accept = {}; }
        g.undo = null;
      });
    },
    cancelUndo: function () { this.commit(function (g) { g.undo = null; }); },
    mark: function (i) {
      if (!this.d || this.d.phase !== 'scoring' || !this.myColor()) return;
      var next = toggleGroup(this.d.state, this.d.dead, i);
      this.commit(function (g) { g.dead = Array.from(next); g.accept = {}; });
    },
    acceptScore: function () {
      if (!this.d || this.d.phase !== 'scoring' || !this.myColor()) return;
      this.commit(function (g) { g.accept = g.accept || {}; g.accept[me.id] = true; });
    },

    connText: function () {
      if (Room.state === 'failed') return { text: 'Offline', cls: 'warn' };
      if (Room.state === 'connected' && Room.opponent) return { text: 'Opponent connected — ' + Room.opponent.name, cls: 'ok' };
      if (Room.state === 'offline') return { text: 'Can’t reach the connection server — retrying…', cls: 'warn' };
      if (Room.state === 'waiting') return { text: 'Waiting for opponent…', cls: '' };
      return { text: 'Connecting…', cls: 'warn' };
    },

    render: function () {
      if (!this.board) return;
      var self = this, g = this.game;
      var ct = this.connText(), conn = $('conn');
      conn.textContent = ct.text;
      conn.className = 'conn small ' + ct.cls;
      var off = $('offline');
      if (Room.state === 'failed') {
        off.hidden = false;
        clear(off);
        var why = Room.reason === 'blocked' ? 'This copy of the page can’t open direct connections, so online play won’t work here.'
          : Room.reason === 'incompatible' ? 'This browser can’t make peer-to-peer connections.'
          : 'The connection library failed to load.';
        append(off, [h('p', { text: why }),
          location.hostname === 'hanshenr.github.io' ? null
            : h('a', { class: 'btn primary', href: PUBLIC_URL, target: '_blank', rel: 'noopener', text: 'Play online without signing in' })]);
      } else off.hidden = true;

      var c1 = clear($('play-controls')), c2 = clear($('play-controls-2')), req = clear($('play-request'));
      req.hidden = true;
      var status = clear($('play-status'));
      if (!g) {
        this.d = null;
        this.board.render({ board: new Int8Array(361), size: 19, lastMove: -1, mode: 'none' });
        $('play-title').textContent = 'Go';
        $('play-meta').textContent = '';
        clear($('play-players'));
        append(status, 'No game yet. Pick a board size and start one — it appears for both of you.');
        updateYourMove();
        return;
      }
      var d = this.d = this.derive(), st = d.state, my = this.myColor();
      var scoring = d.phase === 'scoring' || (d.phase === 'done' && !d.resigned);
      var sc = scoring ? E.score(st, d.dead) : null;
      var canMove = this.canMove();
      this.board.render({
        board: st.board, size: st.size, lastMove: st.lastMove,
        mode: canMove ? 'play' : (d.phase === 'scoring' && my ? 'mark' : 'none'),
        ghostColor: my,
        isLegal: function (i) { return E.isLegal(st, i % st.size, Math.floor(i / st.size)); },
        dead: scoring ? d.dead : null, territory: sc ? sc.territory : null
      });
      $('play-title').textContent = g.title || (my ? 'Your game' : 'Current game');
      $('play-meta').textContent = g.size + '×' + g.size + ' · komi ' + fmtNum(g.komi) + ' · move ' + g.moves.filter(function (m) { return !m.resign; }).length;
      renderPlayers($('play-players'), {
        names: { 1: this.nameOf(1) || 'Waiting…', 2: this.nameOf(2) || 'Waiting…' }, you: my,
        toMove: d.phase === 'play' ? st.toPlay : 0, captures: st.captures,
        extra: sc ? { 1: fmtNum(sc.black) + ' pts', 2: fmtNum(sc.white) + ' pts' } : null
      });

      var opp = my ? g.players[3 - my] : null;
      if (d.phase === 'play') {
        if (my && !opp) append(status, 'Waiting for your opponent to open the page.');
        else if (canMove) append(status, [h('span', { class: 'pulse', 'aria-hidden': 'true' }), h('span', { class: 'your-move', text: 'Your move' })]);
        else append(status, [h('strong', { text: this.nameOf(st.toPlay) || colorName(st.toPlay) }), ' to play']);
        if (st.lastMove === 'pass') append(status, h('span', { class: 'muted', text: ' — ' + colorName(3 - st.toPlay) + ' passed' }));
      } else if (d.phase === 'scoring') {
        append(status, 'Both passed. Tap groups to mark them dead, then accept. ');
        append(status, h('span', { class: 'muted', text: scoreLine(sc, st.komi) }));
        var acc = g.accept || {};
        var who = [1, 2].filter(function (c) { return g.players[c] && acc[g.players[c].id]; })
          .map(function (c) { return c === my ? 'You' : self.nameOf(c); });
        if (who.length) append(status, h('div', { class: 'muted small', text: who.join(' and ') + ' accepted.' }));
      } else {
        append(status, h('span', { class: 'result', text: resultText(d.result) }));
        if (sc) append(status, h('div', { class: 'muted small', text: scoreLine(sc, st.komi) }));
      }
      if (d.bad) append(status, h('div', { class: 'muted small', text: 'Part of the record could not be replayed.' }));

      if (g.undo && my && d.phase !== 'done') {
        req.hidden = false;
        if (g.undo.by === me.id) {
          append(req, [h('div', { text: 'Undo requested — waiting for your opponent.' }),
            h('div', { class: 'controls' }, h('button', { class: 'btn small', text: 'Cancel', onclick: function () { self.cancelUndo(); } }))]);
        } else {
          append(req, [h('div', null, h('strong', { text: this.nameOf(3 - my) || 'Your opponent' }), ' asks to take back their last move.'),
            h('div', { class: 'controls' },
              h('button', { class: 'btn small primary', text: 'Allow', onclick: function () { self.answerUndo(true); } }),
              h('button', { class: 'btn small', text: 'Decline', onclick: function () { self.answerUndo(false); } }))]);
        }
      }

      if (my && opp) {
        if (d.phase === 'play') {
          c1.appendChild(h('button', { class: 'btn', text: 'Pass', disabled: !canMove, onclick: function () { self.pass(); } }));
          c1.appendChild(h('button', { class: 'btn', text: 'Undo', disabled: !!g.undo || !g.moves.length, onclick: function () { self.requestUndo(); } }));
          c1.appendChild(confirmButton('Resign', 'Confirm resign', function () { self.resign(); }, 'danger'));
        } else if (d.phase === 'scoring') {
          var mine = (g.accept || {})[me.id];
          c1.appendChild(h('button', { class: 'btn primary', text: mine ? 'Accepted' : 'Accept score', disabled: !!mine, onclick: function () { self.acceptScore(); } }));
          c1.appendChild(h('button', { class: 'btn', text: 'Undo', disabled: !!g.undo, onclick: function () { self.requestUndo(); } }));
        }
      }
      c2.appendChild(h('button', { class: 'btn ghost small', text: 'Export SGF', onclick: function () {
        exportSGF(st, { black: self.nameOf(1), white: self.nameOf(2), result: resultSGF(d.result), date: today(), gameName: g.title }, 'go-' + today());
      } }));
      updateYourMove();
    }
  };

  function updateYourMove() {
    var mine = Play.canMove();
    document.title = mine ? '● Your move — Go' : 'Go';
    var tab = $('tab-play'), dot = tab.querySelector('.dot');
    if (mine && activeTab !== 'play' && !dot) tab.appendChild(h('span', { class: 'dot', 'aria-label': 'your move' }));
    if ((!mine || activeTab === 'play') && dot) dot.remove();
  }

  // ------------------------------------------------------------------ tabs, keys, boot

  var activeTab = null;
  var TABS = ['play', 'problems'];
  function selectTab(name) {
    activeTab = name;
    ls.set('tab', name);
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    TABS.forEach(function (t) { $('view-' + t).hidden = t !== name; });
    if (name === 'problems') Problems.markCurrent();
    updateYourMove();
  }

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) selectTab(b.getAttribute('data-tab'));
  });
  document.querySelector('.tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var next = TABS[(TABS.indexOf(activeTab) + 1) % TABS.length];
    selectTab(next);
    $('tab-' + next).focus();
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ($('sgf-dialog').open) return;
    if (activeTab === 'play' && e.key.toLowerCase() === 'p') { Play.pass(); e.preventDefault(); }
    else if (activeTab === 'problems') {
      if (e.key === 'ArrowLeft') { Problems.step(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { Problems.step(1); e.preventDefault(); }
    }
  });

  var coordsBox = $('coords-toggle');
  coordsBox.checked = showCoords;
  coordsBox.addEventListener('change', function () {
    showCoords = coordsBox.checked;
    ls.set('coords', showCoords);
    Play.render();
    if (Problems.p) Problems.render(false);
  });

  if (!E) {
    showBanner('The game engine failed to load. Please reload the page.');
    return;
  }

  Play.init();
  Problems.init();
  selectTab(ls.get('tab', 'play') === 'problems' ? 'problems' : 'play');
  Room.start();

  // Small hook for debugging and tests.
  window.GoApp = { Play: Play, Problems: Problems, Room: Room, me: me };
})();
