/* Go — UI, local play, problems and online play over window.superset.storage. */
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
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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
  function colorNum(l) { return l === 'W' ? 2 : 1; }
  function fmtNum(n) { return (Math.round(n * 10) / 10).toString(); }
  function pointName(i, size) {
    var x = i % size, y = (i - x) / size;
    return LETTERS[x] + (size - y);
  }
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
  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    var eq = true;
    a.forEach(function (v) { if (!b.has(v)) eq = false; });
    return eq;
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

  // Replay a move list onto a base state, stopping at the first illegal move
  // (GoEngine.replay skips illegal moves, which would desync colours).
  function replayStrict(base, moves) {
    var st = base;
    for (var k = 0; k < moves.length; k++) {
      var m = moves[k];
      if (m.pass) { st = E.pass(st); continue; }
      var r = E.play(st, m.x, m.y);
      if (!r.ok) break;
      st = r.state;
    }
    return st;
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

  // ------------------------------------------------------------------ local game

  var Local = {
    history: [], phase: 'play', dead: new Set(), result: null, params: null, label: '',
    init: function () {
      var self = this;
      this.board = makeBoard($('board-local'), {
        onPlay: function (i) { self.play(i); },
        onMark: function (i) { self.mark(i); }
      });
      $('new-local').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target;
        self.start({
          size: Number(radioValue(f, 'lo-size')), komi: Number(f.komi.value), handicap: Number(f.handicap.value)
        });
        $('new-local-wrap').open = false;
      });
      wireHandicapKomi($('new-local'));
      var saved = ls.get('local', null);
      if (saved && saved.params) {
        try {
          this.start(saved.params, saved.label, true);
          var base = this.history[0];
          var st = base;
          (saved.moves || []).forEach(function (m) {
            var nx = m.pass ? E.pass(st) : (E.play(st, m.x, m.y).state || null);
            if (nx) { st = nx; self.history.push(st); }
          });
          this.phase = saved.phase === 'done' ? 'done' : (st.consecutivePasses >= 2 ? 'scoring' : 'play');
          if (this.phase !== 'play') this.dead = new Set(saved.dead || []);
          this.result = saved.result || null;
          this.render(false);
          return;
        } catch (e) { /* fall through to a fresh game */ }
      }
      this.start({ size: 19, komi: 6.5, handicap: 0 });
    },
    get state() { return this.history[this.history.length - 1]; },
    start: function (params, label, silent) {
      this.params = params;
      this.label = label || '';
      this.history = [gameSetupState(params)];
      this.phase = 'play';
      this.dead = new Set();
      this.result = null;
      this.board.prevBoard = null;
      if (!silent) { this.save(); this.render(false); }
    },
    save: function () {
      var st = this.state, size = st.size;
      var moves = (st.moves || []).map(function (m) {
        return m.pass ? { pass: true } : { x: m.i % size, y: Math.floor(m.i / size) };
      });
      ls.set('local', { params: this.params, label: this.label, moves: moves, phase: this.phase, dead: Array.from(this.dead), result: this.result });
    },
    play: function (i) {
      if (this.phase !== 'play') return;
      var st = this.state, x = i % st.size, y = Math.floor(i / st.size);
      var r = E.play(st, x, y);
      if (!r.ok) { toast(illegalText(r.reason)); return; }
      this.history.push(r.state);
      this.after();
    },
    pass: function () {
      if (this.phase !== 'play') return;
      this.history.push(E.pass(this.state));
      this.after();
    },
    after: function () {
      if (this.state.consecutivePasses >= 2) {
        this.phase = 'scoring';
        this.dead = safeEstimateDead(this.state);
      }
      this.save();
      this.render(true);
    },
    undo: function () {
      if (this.history.length <= 1) return;
      if (this.phase === 'done' && this.result && this.result.resigned) { this.phase = 'play'; this.result = null; }
      else {
        this.history.pop();
        this.phase = 'play';
        this.result = null;
        this.dead = new Set();
      }
      this.save();
      this.render(true);
    },
    resign: function () {
      if (this.phase !== 'play') return;
      this.result = { resigned: this.state.toPlay };
      this.phase = 'done';
      this.save();
      this.render(false);
    },
    mark: function (i) {
      if (this.phase !== 'scoring') return;
      this.dead = toggleGroup(this.state, this.dead, i);
      this.save();
      this.render(false);
    },
    acceptScore: function () {
      var sc = E.score(this.state, this.dead);
      this.result = { winner: sc.winner, margin: sc.margin, black: sc.black, white: sc.white };
      this.phase = 'done';
      this.save();
      this.render(false);
    },
    render: function (animate) {
      var self = this, st = this.state;
      var scoring = this.phase === 'scoring' || (this.phase === 'done' && this.result && !this.result.resigned);
      var sc = scoring ? E.score(st, this.dead) : null;
      this.board.render({
        board: st.board, size: st.size, lastMove: st.lastMove,
        mode: this.phase === 'play' ? 'play' : this.phase === 'scoring' ? 'mark' : 'none',
        ghostColor: st.toPlay,
        isLegal: function (i) { return E.isLegal(st, i % st.size, Math.floor(i / st.size)); },
        dead: scoring ? this.dead : null, territory: sc ? sc.territory : null, animate: animate
      });
      var p = this.params;
      $('local-meta').textContent = (this.label ? this.label + ' · ' : '') + p.size + '×' + p.size + ' · komi ' + fmtNum(p.komi) +
        (p.handicap ? ' · handicap ' + p.handicap : '') + ' · move ' + (st.moves ? st.moves.length : 0);
      renderPlayers($('local-players'), {
        names: { 1: 'Black', 2: 'White' }, you: 0, toMove: this.phase === 'play' ? st.toPlay : 0, captures: st.captures,
        extra: sc ? { 1: fmtNum(sc.black) + ' pts', 2: fmtNum(sc.white) + ' pts' } : null
      });
      var status = $('local-status');
      clear(status);
      if (this.phase === 'play') {
        var lastPass = st.lastMove === 'pass';
        append(status, [h('strong', { text: colorName(st.toPlay) }), ' to play', lastPass ? ' — ' + colorName(3 - st.toPlay) + ' passed' : '']);
      } else if (this.phase === 'scoring') {
        append(status, ['Both passed. Tap groups to mark them dead, then accept. ', h('span', { class: 'muted', text: scoreLine(sc, st.komi) })]);
      } else {
        append(status, h('span', { class: 'result', text: resultText(this.result) }));
      }
      var c1 = clear($('local-controls')), c2 = clear($('local-controls-2'));
      if (this.phase === 'play') {
        c1.appendChild(h('button', { class: 'btn', text: 'Pass', onclick: function () { self.pass(); } }));
        c1.appendChild(h('button', { class: 'btn', text: 'Undo', disabled: this.history.length <= 1, onclick: function () { self.undo(); } }));
        c1.appendChild(confirmButton('Resign', colorName(st.toPlay) + ' resigns?', function () { self.resign(); }, 'danger'));
      } else if (this.phase === 'scoring') {
        c1.appendChild(h('button', { class: 'btn primary', text: 'Accept score', onclick: function () { self.acceptScore(); } }));
        c1.appendChild(h('button', { class: 'btn', text: 'Resume play', onclick: function () { self.undo(); } }));
      } else {
        c1.appendChild(h('button', { class: 'btn', text: 'Undo', onclick: function () { self.undo(); } }));
      }
      c2.appendChild(h('button', { class: 'btn ghost small', text: 'Export SGF', onclick: function () {
        exportSGF(st, { black: 'Black', white: 'White', result: resultSGF(self.result), date: today(), gameName: self.label || undefined }, 'go-local-' + today());
      } }));
    }
  };

  function illegalText(reason) {
    return ({ occupied: 'That point is taken.', suicide: 'Suicide is not allowed.', ko: 'Ko — play elsewhere first.', offboard: 'Off the board.' })[reason] || 'Illegal move.';
  }
  function safeEstimateDead(st) {
    try { return new Set(E.estimateDead(st) || []); } catch (e) { return new Set(); }
  }
  function wireHandicapKomi(form) {
    form.handicap.addEventListener('change', function () {
      if (Number(form.handicap.value) >= 2 && form.komi.value === '6.5') form.komi.value = '0.5';
      if (Number(form.handicap.value) === 0 && form.komi.value === '0.5') form.komi.value = '6.5';
    });
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
      $('p-play-local').addEventListener('click', function () { self.playFrom('local'); });
      $('p-play-online').addEventListener('click', function () { self.playFrom('online'); });
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
    playFrom: function (where) {
      var s = this.setup;
      var params = { size: s.size, komi: 6.5, handicap: 0, setup: { black: s.black.slice(), white: s.white.slice() }, toPlay: s.toPlay };
      var label = 'Problem ' + this.p.id;
      if (where === 'local') {
        Local.start(params, label);
        selectTab('local');
        toast('Started a local game from ' + label);
      } else {
        Online.prefill(params, label);
        selectTab('online');
      }
    }
  };
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ------------------------------------------------------------------ storage layer

  function makeMockStore(user) {
    // Two tabs with ?mockstore=alice and ?mockstore=bob simulate two people.
    var uid = 'mock-' + user, name = cap(user), PFX = 'go.mockstore:';
    var subs = {};
    var flaky = PARAMS.has('mockflaky');
    function read(key) { try { return JSON.parse(localStorage.getItem(PFX + key)) || {}; } catch (e) { return {}; } }
    function records(key) { var all = read(key); return Object.keys(all).map(function (k) { return all[k]; }); }
    function fail() {
      if (flaky && Math.random() < 0.3) { var e = new Error('rate limited (mock)'); e.code = 'rate_limited'; throw e; }
    }
    function notify(key) { (subs[key] || []).slice().forEach(function (cb) { cb(records(key)); }); }
    window.addEventListener('storage', function (e) {
      if (e.key && e.key.indexOf(PFX) === 0) notify(e.key.slice(PFX.length));
    });
    return {
      ready: Promise.resolve(true),
      viewer: { userId: uid, name: name },
      writable: true,
      author: user === 'alice',
      get: function (key) { return sleep(20).then(function () { fail(); var r = read(key)[uid]; return r ? r.value : null; }); },
      getAll: function (key) { return sleep(40).then(function () { fail(); return records(key); }); },
      set: function (key, value) {
        return sleep(40).then(function () {
          fail();
          var json = JSON.stringify(value);
          if (json.length > 65536) { var e = new Error('too big'); e.code = 'invalid'; throw e; }
          var all = read(key);
          all[uid] = { userId: uid, name: name, value: JSON.parse(json), updatedAt: Date.now() };
          localStorage.setItem(PFX + key, JSON.stringify(all));
          setTimeout(function () { notify(key); }, 0);
        });
      },
      remove: function (key) {
        return sleep(20).then(function () {
          var all = read(key); delete all[uid];
          localStorage.setItem(PFX + key, JSON.stringify(all));
          setTimeout(function () { notify(key); }, 0);
        });
      },
      subscribe: function (key, cb) {
        (subs[key] = subs[key] || []).push(cb);
        return function () { subs[key] = (subs[key] || []).filter(function (f) { return f !== cb; }); };
      }
    };
  }


  // ------------------------------------------------------------------ peer-to-peer store
  // Same interface as window.superset.storage, synced over PeerJS in a star around a host tab.

  var P2P_SITE = 'https://hanshenr.github.io/go/';

  function p2pIdentity() {
    var id = ls.get('p2p.id', null);
    if (!id || !/^[a-z0-9]{8,32}$/.test(id)) {
      id = (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, '');
      ls.set('p2p.id', id);
    }
    var name = ls.get('p2p.name', null);
    if (!name) { name = 'Guest ' + (1000 + Math.floor(Math.random() * 9000)); ls.set('p2p.name', name); }
    return { userId: id, name: name };
  }

  function makeP2PStore() {
    var me = p2pIdentity();
    var myPeerId = 'go-' + me.userId;
    var room = PARAMS.get('room');
    if (room && !/^go-[a-z0-9]{8,32}$/.test(room)) room = null;
    var isHost = !room || room === myPeerId;
    var roomId = isHost ? myPeerId : room;
    var saveKey = 'p2p.room.' + roomId;
    var data = ls.get(saveKey, {}) || {};
    var subs = {}, conns = {}, statusFns = [];
    var info = { role: isHost ? 'host' : 'guest', roomId: roomId, state: isHost ? 'waiting' : 'connecting', peers: [], hostName: '', synced: isHost, everConnected: false };
    var peer = null, hostConn = null, retryDelay = 1000, retryTimer = 0, saveTimer = 0, dead = false;

    function emitStatus() {
      info.peers = Object.keys(conns).map(function (k) { return { userId: conns[k].userId, name: conns[k].name }; })
        .filter(function (x) { return x.userId; });
      statusFns.slice().forEach(function (fn) { try { fn(info); } catch (e) { /* ignore */ } });
    }
    function records(key) {
      var m = data[key] || {};
      return Object.keys(m).map(function (k) { return m[k]; }).filter(function (r) { return r && r.value != null; });
    }
    function notify(key) {
      setTimeout(function () {
        var recs = records(key);
        (subs[key] || []).slice().forEach(function (cb) { try { cb(recs); } catch (e) { /* ignore */ } });
      }, 0);
    }
    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { ls.set(saveKey, data); }, 250);
    }
    function mergeRec(key, rec) {
      if (typeof key !== 'string' || !rec || typeof rec.userId !== 'string' || typeof rec.updatedAt !== 'number') return false;
      var m = data[key] = data[key] || {};
      var cur = m[rec.userId];
      if (cur && cur.updatedAt >= rec.updatedAt) return false;
      m[rec.userId] = { userId: rec.userId, name: String(rec.name || 'Guest').slice(0, 40), value: rec.value, updatedAt: rec.updatedAt };
      return true;
    }
    function send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* dropped */ } }
    function broadcast(msg, except) { for (var k in conns) if (k !== except) send(conns[k].conn, msg); }
    function applyChanges(changed, fromPeer) {
      if (!changed.length) return;
      var keys = {};
      changed.forEach(function (kr) {
        keys[kr[0]] = 1;
        if (isHost) broadcast({ t: 'put', key: kr[0], rec: kr[1] }, fromPeer);
      });
      save();
      Object.keys(keys).forEach(notify);
    }
    function onData(peerId, msg) {
      var c = conns[peerId];
      if (!c || !msg || typeof msg !== 'object') return;
      c.lastSeen = Date.now();
      if (msg.t === 'hello') {
        c.userId = String(msg.userId || '');
        c.name = String(msg.name || 'Guest').slice(0, 40);
        if (!isHost) { info.hostName = c.name; info.synced = true; info.state = 'connected'; info.everConnected = true; retryDelay = 1000; }
        var changed = [], dump = msg.dump || {};
        for (var key in dump) for (var u in dump[key]) if (mergeRec(key, dump[key][u])) changed.push([key, data[key][u]]);
        applyChanges(changed, peerId);
        emitStatus();
      } else if (msg.t === 'put') {
        if (mergeRec(msg.key, msg.rec)) applyChanges([[msg.key, data[msg.key][msg.rec.userId]]], peerId);
      } else if (msg.t === 'name') {
        c.name = String(msg.name || '').slice(0, 40);
        emitStatus();
      }
    }
    function attach(conn) {
      var id = conn.peer, closed = false;
      var gone = function () {
        if (closed) return;
        closed = true;
        if (conns[id] && conns[id].conn === conn) delete conns[id];
        if (isHost) info.state = Object.keys(conns).length ? 'connected' : (info.everConnected ? 'lost' : 'waiting');
        else if (conn === hostConn) { hostConn = null; info.state = info.everConnected ? 'lost' : 'nohost'; scheduleConnect(); }
        emitStatus();
      };
      conn.on('open', function () {
        conns[id] = { conn: conn, userId: null, name: '', lastSeen: Date.now(), gone: gone };
        send(conn, { t: 'hello', userId: me.userId, name: me.name, dump: data });
        if (isHost) { info.state = 'connected'; info.everConnected = true; }
        emitStatus();
      });
      conn.on('data', function (msg) { onData(id, msg); });
      conn.on('close', gone);
      conn.on('error', gone);
    }
    function connectHost() {
      retryTimer = 0;
      if (dead || isHost || !peer || peer.destroyed || hostConn) return;
      if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* retry below */ } scheduleConnect(); return; }
      var c = peer.connect(roomId, { reliable: true });
      hostConn = c;
      attach(c);
      setTimeout(function () {
        if (hostConn === c && !c.open) { hostConn = null; try { c.close(); } catch (e) { /* ignore */ } info.state = info.everConnected ? 'lost' : 'nohost'; emitStatus(); scheduleConnect(); }
      }, 12000);
    }
    function scheduleConnect() {
      if (dead || isHost || retryTimer) return;
      retryTimer = setTimeout(connectHost, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    }
    // Heartbeat: drop links that went silent so the guest reconnects.
    setInterval(function () {
      var now = Date.now();
      for (var k in conns) {
        var c = conns[k];
        send(c.conn, { t: 'ping' });
        if (now - c.lastSeen > 15000) { try { c.conn.close(); } catch (e) { /* ignore */ } c.gone(); }
      }
    }, 4000);

    var ready = new Promise(function (resolve) {
      var settled = false, attempts = 0;
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      // A Content-Security-Policy that blocks the signalling socket means P2P can't work here.
      document.addEventListener('securitypolicyviolation', function (e) {
        if (!settled && /peerjs|wss?:/.test(String(e.blockedURI) + ' ' + e.violatedDirective)) { info.blocked = true; done(false); }
      });
      setTimeout(function () { done(false); }, 10000);
      function open() {
        if (dead) return;
        attempts++;
        var p;
        try { p = new window.Peer(myPeerId, { debug: 0 }); } catch (e) { done(false); return; }
        peer = p;
        p.on('open', function () {
          done(true);
          if (info.state === 'busy') info.state = isHost ? (Object.keys(conns).length ? 'connected' : 'waiting') : 'connecting';
          if (!isHost) connectHost();
          emitStatus();
        });
        p.on('connection', function (conn) {
          if (!isHost) { conn.on('open', function () { conn.close(); }); return; }
          attach(conn);
        });
        p.on('disconnected', function () {
          setTimeout(function () { try { if (p === peer && p.disconnected && !p.destroyed) p.reconnect(); } catch (e) { /* retry later */ } }, 2000);
        });
        p.on('error', function (err) {
          var type = err && err.type;
          if (type === 'unavailable-id') {
            // The id is still held by a previous session (reload) or another tab: retry.
            done(true);
            if (attempts >= 3) { info.state = 'busy'; emitStatus(); }
            try { p.destroy(); } catch (e) { /* ignore */ }
            setTimeout(open, Math.min(1500 * attempts, 8000));
          } else if (type === 'peer-unavailable') {
            if (hostConn && !hostConn.open) { hostConn = null; info.state = info.everConnected ? 'lost' : 'nohost'; emitStatus(); scheduleConnect(); }
          } else if (type === 'browser-incompatible' || type === 'ssl-unavailable') {
            done(false);
          } else if (!settled && (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed')) {
            done(false);
          } else if (type === 'network' || type === 'socket-error' || type === 'socket-closed' || type === 'server-error') {
            setTimeout(function () { try { if (p === peer && p.disconnected && !p.destroyed) p.reconnect(); } catch (e) { /* ignore */ } }, 3000);
          }
        });
      }
      open();
    });

    function setMine(key, value) {
      var cur = data[key] && data[key][me.userId];
      var rec = { userId: me.userId, name: me.name, value: value, updatedAt: Math.max(Date.now(), cur ? cur.updatedAt + 1 : 0) };
      (data[key] = data[key] || {})[me.userId] = rec;
      save();
      broadcast({ t: 'put', key: key, rec: rec });
      notify(key);
    }

    return {
      ready: ready,
      viewer: me,
      writable: true,
      author: isHost,
      p2p: info,
      onStatus: function (fn) { statusFns.push(fn); },
      inviteLink: function (gameId) {
        return location.origin + location.pathname + '?room=' + encodeURIComponent(roomId) + (gameId ? '&game=' + encodeURIComponent(gameId) : '');
      },
      setName: function (name) {
        me.name = name;
        ls.set('p2p.name', name);
        for (var key in data) {
          var r = data[key][me.userId];
          if (r && r.value != null) setMine(key, r.value);
        }
        broadcast({ t: 'name', name: name });
        emitStatus();
      },
      destroy: function () { dead = true; try { if (peer) peer.destroy(); } catch (e) { /* ignore */ } },
      get: function (key) { var r = data[key] && data[key][me.userId]; return Promise.resolve(r ? r.value : null); },
      getAll: function (key) { return Promise.resolve(records(key)); },
      set: function (key, value) {
        var json = JSON.stringify(value);
        if (json.length > 65536) { var e = new Error('too big'); e.code = 'invalid'; return Promise.reject(e); }
        setMine(key, JSON.parse(json));
        return Promise.resolve();
      },
      remove: function (key) { setMine(key, null); return Promise.resolve(); },
      subscribe: function (key, cb) {
        (subs[key] = subs[key] || []).push(cb);
        return function () { subs[key] = (subs[key] || []).filter(function (f) { return f !== cb; }); };
      }
    };
  }

  var Net = {
    store: null, ok: false, revoked: false, reason: '', me: null,
    cache: {},       // key -> records from server
    local: {},       // key -> { value, json, settledAt } my optimistic slot
    pending: {},     // key -> value queued for write
    inflight: {},
    listeners: {},   // key -> [fn]
    unsubs: {},

    init: function () {
      var self = this;
      var mock = PARAMS.get('mockstore');
      var ss = mock ? makeMockStore(mock.replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'guest') : (window.superset && window.superset.storage);
      var first = ss ? Promise.resolve(ss.ready).then(function (r) { return r ? ss : null; }, function () { return null; }) : Promise.resolve(null);
      return first.then(function (store) {
        if (store || mock) return store;
        self.reason = ss ? 'notready' : 'absent';
        // Superset pages forbid outbound connections; fall back to peer-to-peer everywhere else.
        var onSuperset = !!window.superset || /supersetusercontent\.com$/.test(location.hostname);
        if (onSuperset || !window.Peer || PARAMS.has('nop2p')) return null;
        var p2p = makeP2PStore();
        return p2p.ready.then(function (ok) {
          if (ok) return p2p;
          p2p.destroy();
          self.reason = p2p.p2p.blocked ? 'p2p-blocked' : 'p2p-unreachable';
          return null;
        });
      }).then(function (store) {
        if (!store) return false;
        self.store = store;
        self.p2p = store.p2p || null;
        self.me = store.viewer || null;
        if (!self.me || !self.me.userId) { self.reason = 'noviewer'; return false; }
        self.writable = store.writable !== false;
        self.ok = true;
        return true;
      }, function () { self.reason = self.reason || 'notready'; return false; });
    },

    call: function (fn) {
      var self = this, delay = 600, attempt = 0;
      function run() {
        if (self.revoked) { var e = new Error('revoked'); e.code = 'revoked'; return Promise.reject(e); }
        return Promise.resolve().then(function () { return fn(self.store); }).catch(function (err) {
          var code = err && err.code;
          if (code === 'revoked') { self.onRevoked(); throw err; }
          if ((code === 'rate_limited' || code === 'unavailable') && attempt < 7) {
            attempt++;
            var wait = delay + Math.random() * delay * 0.5;
            delay = Math.min(delay * 2, 10000);
            return sleep(wait).then(run);
          }
          throw err;
        });
      }
      return run();
    },

    onRevoked: function () {
      if (this.revoked) return;
      this.revoked = true;
      for (var k in this.unsubs) { try { this.unsubs[k](); } catch (e) { /* ignore */ } }
      this.unsubs = {};
      showBanner('Access to shared storage was revoked for this page. Online play has stopped; reload to try again.');
      Online.render();
    },

    errorText: function (err) {
      var code = err && err.code;
      return ({
        quota_exceeded: 'Storage is full for this page.',
        rate_limited: 'Too many requests — try again in a moment.',
        unauthenticated: 'You need to be signed in to play online.',
        invalid: 'That update was rejected (too large or malformed).',
        unavailable: 'Shared storage is unavailable right now.',
        revoked: 'Access to shared storage was revoked.'
      })[code] || ('Something went wrong' + (err && err.message ? ': ' + err.message : '.'));
    },

    records: function (key) {
      var recs = (this.cache[key] || []).slice();
      var loc = this.local[key], me = this.me && this.me.userId;
      if (loc && me) {
        var found = false;
        recs = recs.map(function (r) {
          if (r.userId !== me) return r;
          found = true;
          return { userId: r.userId, name: r.name, value: loc.value, updatedAt: Date.now() };
        });
        if (!found && loc.value != null) recs.push({ userId: me, name: this.me.name, value: loc.value, updatedAt: Date.now() });
      }
      return recs;
    },
    mine: function (key) {
      var me = this.me && this.me.userId;
      var r = this.records(key).filter(function (x) { return x.userId === me; })[0];
      return r ? r.value : null;
    },

    ingest: function (key, recs) {
      if (!Array.isArray(recs)) return;
      this.cache[key] = recs;
      var loc = this.local[key], me = this.me && this.me.userId;
      if (loc && !this.pending.hasOwnProperty(key) && !this.inflight[key]) {
        var server = recs.filter(function (r) { return r.userId === me; })[0];
        var sj = server ? JSON.stringify(server.value) : null;
        if (sj === loc.json || (loc.settledAt && Date.now() - loc.settledAt > 5000)) delete this.local[key];
      }
      this.emit(key);
    },
    emit: function (key) { (this.listeners[key] || []).slice().forEach(function (fn) { fn(); }); },

    load: function (key) {
      var self = this;
      return this.call(function (s) { return s.getAll(key); }).then(function (recs) { self.ingest(key, recs || []); return self.records(key); });
    },

    watch: function (key, fn) {
      var self = this;
      (this.listeners[key] = this.listeners[key] || []).push(fn);
      if (!this.unsubs[key] && !this.revoked) {
        try {
          var un = this.store.subscribe(key, function (recs) {
            if (Array.isArray(recs)) self.ingest(key, recs);
            else self.load(key).catch(function () {});
          });
          this.unsubs[key] = typeof un === 'function' ? un : function () { };
        } catch (e) { this.unsubs[key] = function () { }; }
      }
      var retry = function () {
        self.load(key).catch(function (err) {
          if (err && err.code === 'revoked') return;
          toast(self.errorText(err));
          setTimeout(function () { if ((self.listeners[key] || []).length && !self.cache[key]) retry(); }, 5000);
        });
      };
      retry();
      return function () {
        self.listeners[key] = (self.listeners[key] || []).filter(function (f) { return f !== fn; });
        if (!self.listeners[key].length && self.unsubs[key]) {
          try { self.unsubs[key](); } catch (e) { /* ignore */ }
          delete self.unsubs[key];
        }
      };
    },

    // Writes my slot. Coalesces bursts: only the latest value per key is sent.
    write: function (key, value) {
      var json = JSON.stringify(value);
      this.local[key] = { value: JSON.parse(json), json: json, settledAt: 0 };
      this.pending[key] = value;
      this.emit(key);
      return this.flush(key);
    },
    flush: function (key) {
      var self = this;
      if (this.inflight[key]) return this.inflight[key];
      var p = (function loop() {
        if (!self.pending.hasOwnProperty(key)) return Promise.resolve();
        var v = self.pending[key];
        delete self.pending[key];
        return self.call(function (s) { return s.set(key, v); }).then(loop, function (err) {
          if (!(err && err.code === 'revoked')) toast(self.errorText(err), 5000);
          delete self.local[key];
          self.emit(key);
          throw err;
        });
      })();
      this.inflight[key] = p;
      var done = function () {
        delete self.inflight[key];
        if (self.local[key]) self.local[key].settledAt = Date.now();
        if (self.pending.hasOwnProperty(key) && !self.revoked) self.flush(key).catch(function () {});
      };
      p.then(done, done);
      return p;
    }
  };

  function showBanner(text) {
    var b = $('banner');
    b.textContent = text;
    b.hidden = false;
  }

  // ------------------------------------------------------------------ online play

  var STATUS_RANK = { open: 0, playing: 1, done: 2 };

  function connInfo() {
    var p = Net.p2p;
    if (!p) return { text: '', cls: '' };
    var names = p.peers.map(function (x) { return x.name; }).filter(Boolean);
    if (p.state === 'busy') return { text: 'This game room is already open in another tab of this browser.', cls: 'warn' };
    if (p.role === 'host') {
      if (names.length) return { text: 'Connected to ' + names.join(', '), cls: 'ok' };
      if (p.state === 'lost') return { text: 'Opponent disconnected \u2014 waiting for them to reconnect\u2026', cls: 'warn' };
      return { text: 'Waiting for opponent\u2026 Keep this tab open.', cls: '' };
    }
    if (p.state === 'connected') return { text: 'Connected to ' + (p.hostName || 'host'), cls: 'ok' };
    if (p.state === 'lost') return { text: 'Opponent disconnected \u2014 reconnecting\u2026', cls: 'warn' };
    if (p.state === 'nohost') return { text: 'Can\u2019t reach the host \u2014 their tab may be closed. Retrying\u2026', cls: 'warn' };
    return { text: 'Connecting to the host\u2026', cls: 'warn' };
  }

  function copyText(text, input) {
    var done = function () { toast('Link copied'); };
    var fallback = function () {
      var ta = input || h('textarea', { style: 'position:fixed;opacity:0' });
      if (!input) { ta.value = text; document.body.appendChild(ta); }
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Select the link and copy it'); }
      if (!input) ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* Game slot (key game:<id>), one per participant:
     { color, joinedAt, moves: [{x,y}|{pass}|{resign}], dead, deadAt, scoreAt, acceptScore,
       undoRequest, undoId, undoAccept, undoAcceptId, undoDecline }
     All shared state is derived from both seated players' slots. */

  function seatsFor(game, recs) {
    var creatorColor = game.creatorColor || 'B';
    var other = creatorColor === 'B' ? 'W' : 'B';
    var seats = { B: null, W: null };
    var owner = recs.filter(function (r) { return r.userId === game.owner; })[0];
    seats[creatorColor] = {
      userId: game.owner, name: (owner && owner.name) || game.ownerName || 'Creator',
      value: (owner && owner.value && owner.value.color === creatorColor) ? owner.value : { color: creatorColor, moves: [] }
    };
    var cands = recs.filter(function (r) { return r.userId !== game.owner && r.value && r.value.color === other; });
    cands.sort(function (a, b) {
      return ((a.value.joinedAt || 0) - (b.value.joinedAt || 0)) || (a.userId < b.userId ? -1 : 1);
    });
    seats[other] = cands[0] || null;
    return seats;
  }

  function deriveGame(game, recs) {
    var base = gameSetupState(game);
    var seats = seatsFor(game, recs);
    var slot = { 1: seats.B ? seats.B.value : null, 2: seats.W ? seats.W.value : null };
    var moves = { 1: (slot[1] && slot[1].moves) || [], 2: (slot[2] && slot[2].moves) || [] };

    // An undo is in effect when one side's request id matches the other's accept id.
    var truncateTo = null, undoBy = 0;
    [1, 2].forEach(function (c) {
      var a = slot[c], b = slot[3 - c];
      if (a && b && a.undoId && a.undoRequest != null && b.undoAcceptId === a.undoId && b.undoAccept === a.undoRequest) {
        truncateTo = a.undoRequest; undoBy = c;
      }
    });

    var st = base, used = { 1: 0, 2: 0 }, seq = [], resigned = 0, bad = false;
    var lastIndexOf = { 1: -1, 2: -1 };
    for (;;) {
      if (truncateTo != null && seq.length >= truncateTo) break;
      var c = st.toPlay, o = 3 - c;
      var mc = moves[c][used[c]], mo = moves[o][used[o]];
      if (mc && mc.resign) { resigned = c; break; }
      if (mo && mo.resign) { resigned = o; break; }
      if (!mc) break;
      if (mc.pass) st = E.pass(st);
      else {
        var r = E.play(st, mc.x, mc.y);
        if (!r.ok) { bad = true; break; }
        st = r.state;
      }
      lastIndexOf[c] = seq.length;
      used[c]++;
      seq.push({ color: c, m: mc });
      if (st.consecutivePasses >= 2) break;
    }

    var phase = 'play';
    if (resigned) phase = 'done';
    else if (st.consecutivePasses >= 2) phase = 'scoring';
    if (!seats.B || !seats.W) phase = phase === 'play' && !seq.length ? 'waiting' : phase;

    var d = {
      game: game, base: base, state: st, seats: seats, slot: slot, used: used, seq: seq,
      resigned: resigned, phase: phase, bad: bad, truncateTo: truncateTo, undoBy: undoBy, lastIndexOf: lastIndexOf
    };

    if (phase === 'scoring') {
      var n = seq.length, best = null;
      [1, 2].forEach(function (c) {
        var s = slot[c];
        if (s && s.scoreAt === n && Array.isArray(s.dead)) {
          if (!best || (s.deadAt || 0) > (best.deadAt || 0)) best = s;
        }
      });
      d.dead = best ? new Set(best.dead) : safeEstimateDead(st);
      var acc = [1, 2].map(function (c) {
        var s = slot[c];
        return !!(s && s.acceptScore && s.scoreAt === n && Array.isArray(s.dead) && setsEqual(new Set(s.dead), d.dead));
      });
      d.accepted = { 1: acc[0], 2: acc[1] };
      if (acc[0] && acc[1]) {
        d.phase = 'done';
        var sc = E.score(st, d.dead);
        d.result = { winner: sc.winner, margin: sc.margin, black: sc.black, white: sc.white };
        d.score = sc;
      }
    }
    if (resigned) d.result = { resigned: resigned };
    d.status = d.phase === 'done' ? 'done' : (seats.B && seats.W ? 'playing' : 'open');
    return d;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  var Online = {
    view: 'lobby', gameId: null, prefillParams: null, prefillLabel: '', started: false, withdrawn: {},
    init: function () {
      var self = this;
      this.board = makeBoard($('board-online'), {
        onPlay: function (i) { self.play(i); },
        onMark: function (i) { self.mark(i); }
      });
      wireHandicapKomi($('new-online'));
      $('new-online').addEventListener('submit', function (e) { e.preventDefault(); self.create(); });
      $('online-back').addEventListener('click', function () { self.openLobby(); });
      window.addEventListener('hashchange', function () { self.fromHash(); });

      var wait = $('online-unavailable');
      wait.hidden = false;
      append(clear(wait), h('p', { class: 'muted', text: 'Connecting\u2026' }));
      Net.init().then(function (ok) {
        self.started = true;
        if (!ok) { self.render(); return; }
        if (Net.p2p) self.initP2P();
        Net.watch('lobby', function () { self.onLobby(); });
        var pg = PARAMS.get('game');
        if (pg && /^[\w-]{1,40}$/.test(pg)) {
          self.autoJoin = pg;
          self.openGame(pg, true);
          selectTab('online');
        } else self.fromHash();
        self.render();
      });
    },
    initP2P: function () {
      var self = this, input = $('p2p-name');
      $('p2p-bar').hidden = false;
      input.value = Net.me.name;
      var commit = function () {
        var v = input.value.trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!v) { input.value = Net.me.name; return; }
        if (v !== Net.me.name) { Net.store.setName(v); self.render(); }
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { commit(); input.blur(); } });
      Net.store.onStatus(function () { self.render(); });
    },
    fromHash: function () {
      var m = /^#game=([\w-]+)/.exec(location.hash);
      if (m && Net.ok) { this.openGame(m[1], true); if (activeTab !== 'online') selectTab('online'); }
      else if (!m && this.view === 'game') this.openLobby(true);
    },

    // ---- lobby data
    lobbyGames: function () {
      var recs = Net.records('lobby');
      var games = {}, joins = {};
      recs.forEach(function (r) {
        var v = r.value || {};
        (v.games || []).forEach(function (g) {
          if (!g || !g.id) return;
          var copy = Object.assign({}, g, { owner: r.userId, ownerName: r.name });
          games[g.id] = copy;
        });
        (v.joined || []).forEach(function (j) {
          if (!j || !j.id) return;
          (joins[j.id] = joins[j.id] || []).push({ userId: r.userId, name: r.name, status: j.status, color: j.color, at: j.at || 0 });
        });
      });
      Object.keys(games).forEach(function (id) {
        var g = games[id], js = (joins[id] || []).filter(function (j) { return j.userId !== g.owner; });
        js.sort(function (a, b) { return a.at - b.at; });
        g.joiner = js[0] || null;
        var st = g.status || 'open';
        js.forEach(function (j) { if ((STATUS_RANK[j.status] || 0) > (STATUS_RANK[st] || 0)) st = j.status; });
        if (st === 'open' && g.joiner) st = 'playing';
        g.status = st;
      });
      return Object.keys(games).map(function (k) { return games[k]; }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    },
    myLobby: function () {
      var v = Net.mine('lobby') || {};
      return { games: (v.games || []).slice(), joined: (v.joined || []).slice() };
    },
    writeLobby: function (lob) {
      // Keep the slot well under 64 KiB: drop the oldest finished games first.
      var trim = function (arr) {
        while (JSON.stringify(lob).length > 48000 && arr.some(function (g) { return g.status === 'done'; })) {
          var k = arr.map(function (g) { return g.status; }).lastIndexOf('done');
          arr.splice(k, 1);
        }
      };
      lob.games.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      lob.joined.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      trim(lob.games); trim(lob.joined);
      lob.games = lob.games.slice(0, 60);
      lob.joined = lob.joined.slice(0, 60);
      return Net.write('lobby', lob);
    },

    onLobby: function () {
      if (this.view === 'game' && this.gameId) {
        var g = this.findGame(this.gameId);
        if (g && !this.game) { this.game = g; this.subscribeGame(); }
        else if (g) this.game = Object.assign(this.game, g);
      }
      this.render();
    },
    findGame: function (id) { return this.lobbyGames().filter(function (g) { return g.id === id; })[0] || null; },

    // ---- actions
    prefill: function (params, label) {
      this.prefillParams = params;
      this.prefillLabel = label;
      this.openLobby();
      this.renderPrefill();
    },
    renderPrefill: function () {
      var self = this, box = $('new-online').querySelector('.from-position');
      var form = $('new-online');
      if (!this.prefillParams) { box.hidden = true; form.querySelector('.seg').parentNode.hidden = false; form.handicap.disabled = false; return; }
      box.hidden = false;
      clear(box);
      append(box, [h('span', null, 'Starting from ', h('strong', { text: this.prefillLabel }), ' · ' + (this.prefillParams.toPlay === 2 ? 'White' : 'Black') + ' to play'),
        h('button', { type: 'button', class: 'link', text: 'Clear', onclick: function () { self.prefillParams = null; self.renderPrefill(); } })]);
      form.querySelector('.seg').parentNode.hidden = true;
      form.handicap.value = '0';
      form.handicap.disabled = true;
      form.komi.value = '6.5';
    },
    create: function () {
      if (!Net.ok || !Net.writable) return;
      if (!Net.cache.lobby) { toast('Still connecting — try again in a moment.'); return; }
      var f = $('new-online');
      var color = f.color.value;
      if (color === 'R') color = Math.random() < 0.5 ? 'B' : 'W';
      var g = {
        id: newId(), size: Number(radioValue(f, 'on-size')), komi: Number(f.komi.value), handicap: Number(f.handicap.value),
        createdAt: Date.now(), status: 'open', creatorColor: color
      };
      if (this.prefillParams) {
        g.size = this.prefillParams.size;
        g.handicap = 0;
        g.setup = this.prefillParams.setup;
        g.toPlay = this.prefillParams.toPlay;
        g.title = this.prefillLabel;
      }
      var lob = this.myLobby();
      lob.games.unshift(g);
      var self = this;
      this.prefillParams = null;
      this.renderPrefill();
      Promise.all([
        this.writeLobby(lob),
        Net.write('game:' + g.id, { color: color, joinedAt: Date.now(), moves: [] })
      ]).catch(function () {});
      self.openGame(g.id);
    },
    join: function (g) {
      if (!Net.ok || !Net.writable) return;
      if (!Net.cache.lobby) { toast('Still connecting — try again in a moment.'); return; }
      var color = (g.creatorColor || 'B') === 'B' ? 'W' : 'B';
      var lob = this.myLobby();
      lob.joined = lob.joined.filter(function (j) { return j.id !== g.id; });
      lob.joined.unshift({ id: g.id, owner: g.owner, color: color, status: 'playing', at: Date.now() });
      this.writeLobby(lob).catch(function () {});
      Net.write('game:' + g.id, { color: color, joinedAt: Date.now(), moves: [] }).catch(function () {});
      this.openGame(g.id);
    },
    cancel: function (g) {
      var lob = this.myLobby();
      lob.games = lob.games.filter(function (x) { return x.id !== g.id; });
      this.writeLobby(lob).catch(function () {});
    },

    openLobby: function (fromHash) {
      if (this.unwatchGame) { this.unwatchGame(); this.unwatchGame = null; }
      this.view = 'lobby';
      this.gameId = null;
      this.game = null;
      this.d = null;
      var sp = new URLSearchParams(location.search);
      if (!fromHash && (/^#game=/.test(location.hash) || sp.has('game'))) {
        sp.delete('game');
        var q = sp.toString();
        history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
      }
      this.render();
    },
    openGame: function (id, fromHash) {
      if (this.gameId === id && this.view === 'game') return;
      if (this.unwatchGame) { this.unwatchGame(); this.unwatchGame = null; }
      this.view = 'game';
      this.gameId = id;
      this.game = this.findGame(id);
      this.d = null;
      this.board.prevBoard = null;
      this.lastSeq = -1;
      if (!fromHash) history.replaceState(null, '', '#game=' + id);
      if (this.game) this.subscribeGame();
      this.render();
    },
    subscribeGame: function () {
      var self = this, key = 'game:' + this.gameId;
      if (this.unwatchGame) return;
      this.unwatchGame = Net.watch(key, function () { self.onGame(); });
    },

    onGame: function () {
      if (this.view !== 'game' || !this.game) return;
      var key = 'game:' + this.game.id;
      var d = deriveGame(this.game, Net.records(key));
      this.d = d;
      this.reconcile(d);
      if (this.autoJoin === d.game.id && (!Net.p2p || Net.p2p.synced)) {
        this.autoJoin = null;
        var seatOpen = !d.seats.B || !d.seats.W;
        if (seatOpen && !this.myColor(d) && d.game.owner !== Net.me.userId && Net.writable) { this.join(d.game); return; }
      }
      this.render();
    },

    myColor: function (d) {
      var me = Net.me && Net.me.userId;
      if (d.seats.B && d.seats.B.userId === me) return 1;
      if (d.seats.W && d.seats.W.userId === me) return 2;
      return 0;
    },

    // Housekeeping my own slots in response to derived state.
    reconcile: function (d) {
      var me = Net.me.userId, key = 'game:' + d.game.id;
      var mine = Net.mine(key);
      var my = this.myColor(d);
      var g = d.game;
      // Lost the race for a seat: withdraw the claim quietly.
      if (!my && mine && mine.color && g.owner !== me && !this.withdrawn[g.id]) {
        this.withdrawn[g.id] = true;
        Net.call(function (s) { return s.remove ? s.remove(key) : s.set(key, null); }).catch(function () {});
        delete Net.local[key];
        var lob0 = this.myLobby();
        if (lob0.joined.some(function (j) { return j.id === g.id; })) {
          lob0.joined = lob0.joined.filter(function (j) { return j.id !== g.id; });
          this.writeLobby(lob0).catch(function () {});
        }
        toast('Someone else took that seat — you are watching.');
        return;
      }
      if (!my) return;
      // My undo request was accepted: drop my retracted moves and clear the request.
      if (d.undoBy === my && mine && mine.undoId) {
        var next = Object.assign({}, mine, { moves: (mine.moves || []).slice(0, d.used[my]) });
        delete next.undoRequest; delete next.undoId;
        Net.write(key, next).catch(function () {});
      }
      // My request was declined.
      var opp = d.slot[3 - my];
      if (mine && mine.undoId && opp && opp.undoDecline === mine.undoId) {
        var n2 = Object.assign({}, mine);
        delete n2.undoRequest; delete n2.undoId;
        Net.write(key, n2).catch(function () {});
        toast('Undo request declined.');
      }
      // Keep the lobby status current (creator owns the game entry, joiner owns a joined entry).
      var lob = this.myLobby(), changed = false;
      if (g.owner === me) {
        lob.games.forEach(function (x) { if (x.id === g.id && x.status !== d.status && STATUS_RANK[d.status] >= STATUS_RANK[x.status || 'open']) { x.status = d.status; changed = true; } });
      } else {
        lob.joined.forEach(function (x) { if (x.id === g.id && x.status !== d.status && d.status !== 'open') { x.status = d.status; changed = true; } });
      }
      if (changed) this.writeLobby(lob).catch(function () {});
    },

    mySlot: function () {
      var key = 'game:' + this.game.id;
      return Object.assign({ moves: [] }, Net.mine(key) || {});
    },
    writeSlot: function (v) { return Net.write('game:' + this.game.id, v).catch(function () {}); },

    canAct: function () {
      var d = this.d;
      return d && Net.ok && !Net.revoked && Net.writable && this.myColor(d) && d.seats.B && d.seats.W;
    },
    play: function (i) {
      var d = this.d; if (!this.canAct() || d.phase !== 'play') return;
      var my = this.myColor(d), st = d.state;
      if (st.toPlay !== my) return;
      var x = i % st.size, y = Math.floor(i / st.size);
      var r = E.play(st, x, y);
      if (!r.ok) { toast(illegalText(r.reason)); return; }
      this.pushMove({ x: x, y: y });
    },
    pass: function () {
      var d = this.d; if (!this.canAct() || d.phase !== 'play' || d.state.toPlay !== this.myColor(d)) return;
      this.pushMove({ pass: true });
    },
    pushMove: function (m) {
      var d = this.d, my = this.myColor(d);
      var s = this.mySlot();
      s.color = colorLetter(my);
      s.moves = (s.moves || []).slice(0, d.used[my]).concat([m]);
      delete s.undoRequest; delete s.undoId;
      s.acceptScore = false;
      this.writeSlot(s);
    },
    resign: function () {
      var d = this.d; if (!this.canAct() || d.phase === 'done') return;
      var my = this.myColor(d), s = this.mySlot();
      s.moves = (s.moves || []).slice(0, d.used[my]).concat([{ resign: true }]);
      this.writeSlot(s);
    },
    requestUndo: function () {
      var d = this.d; if (!this.canAct() || d.phase === 'done') return;
      var my = this.myColor(d), n = d.lastIndexOf[my];
      if (n < 0) return;
      var s = this.mySlot();
      s.undoRequest = n;
      s.undoId = newId();
      this.writeSlot(s);
    },
    cancelUndo: function () {
      var s = this.mySlot();
      delete s.undoRequest; delete s.undoId;
      this.writeSlot(s);
    },
    answerUndo: function (accept) {
      var d = this.d; if (!this.canAct()) return;
      var my = this.myColor(d), req = d.slot[3 - my];
      if (!req || !req.undoId) return;
      var s = this.mySlot();
      if (accept) {
        // Keep only my moves that come before the retracted point.
        var keep = 0;
        d.seq.forEach(function (e, k) { if (k < req.undoRequest && e.color === my) keep++; });
        s.moves = (s.moves || []).slice(0, keep);
        s.undoAccept = req.undoRequest;
        s.undoAcceptId = req.undoId;
        s.acceptScore = false;
      } else {
        s.undoDecline = req.undoId;
      }
      this.writeSlot(s);
    },
    mark: function (i) {
      var d = this.d; if (!this.canAct() || d.phase !== 'scoring') return;
      var next = toggleGroup(d.state, d.dead, i);
      var s = this.mySlot();
      s.dead = Array.from(next);
      s.deadAt = Date.now();
      s.scoreAt = d.seq.length;
      s.acceptScore = false;
      this.writeSlot(s);
    },
    acceptScore: function () {
      var d = this.d; if (!this.canAct() || d.phase !== 'scoring') return;
      var s = this.mySlot();
      var had = s.scoreAt === d.seq.length && Array.isArray(s.dead) && setsEqual(new Set(s.dead), d.dead);
      s.dead = Array.from(d.dead);
      if (!had) s.deadAt = 0; // agreeing should not outrank the opponent's latest marking
      s.scoreAt = d.seq.length;
      s.acceptScore = true;
      this.writeSlot(s);
    },

    // ---- rendering
    render: function () {
      if (!this.started) return;
      var unavailable = $('online-unavailable');
      if (!Net.ok || Net.revoked) {
        $('lobby').hidden = true;
        $('online-game').hidden = true;
        unavailable.hidden = false;
        clear(unavailable);
        var why = Net.revoked ? 'Access to shared storage was revoked while this page was open. Reload to reconnect.'
          : Net.reason === 'absent' ? 'Online games are stored in the page’s shared storage, which is only available when this page is opened from its Superset link.'
          : Net.reason === 'noviewer' ? 'Shared storage did not identify you. Sign in to play online.'
          : Net.reason === 'p2p-blocked' ? 'This copy of the page can\u2019t open direct connections. Sign in to play here, or use the public copy to play without an account.'
          : Net.reason === 'p2p-unreachable' ? 'Couldn\u2019t reach the connection server for peer-to-peer play. Check your network and reload.'
          : 'Shared storage is not available for this viewer — you may need to sign in to the page’s organization.';
        append(unavailable, [
          h('h2', { text: 'Online play is unavailable here' }),
          h('p', { text: why }),
          location.hostname === 'hanshenr.github.io' ? null
            : h('a', { class: 'btn primary', href: P2P_SITE, target: '_blank', rel: 'noopener', text: 'Play online without signing in' }),
          h('p', { text: 'Local games and problems work fully.' }),
          h('div', { class: 'controls' },
            h('button', { class: 'btn', text: 'Play locally', onclick: function () { selectTab('local'); } }),
            h('button', { class: 'btn', text: 'Problems', onclick: function () { selectTab('problems'); } }))
        ]);
        return;
      }
      unavailable.hidden = true;
      $('new-online').querySelector('button[type=submit]').disabled = !Net.writable;
      if (this.view === 'game') {
        $('lobby').hidden = true;
        $('online-game').hidden = false;
        this.renderGame();
      } else {
        $('online-game').hidden = true;
        $('lobby').hidden = false;
        this.renderLobby();
      }
      updateYourMove();
    },

    renderLobby: function () {
      var self = this, me = Net.me.userId;
      var games = this.lobbyGames();
      var mine = [], open = [], live = [], done = [];
      if (Net.p2p) {
        var ps = $('p2p-status'), ct = connInfo();
        ps.textContent = ct.text;
        ps.className = 'conn small ' + ct.cls;
        if (document.activeElement !== $('p2p-name')) $('p2p-name').value = Net.me.name;
      }
      var intro = document.querySelector('.lobby-intro .muted');
      intro.textContent = Net.p2p ? 'No sign-in needed. Create a game and send the invite link to a friend \u2014 your browser hosts the game, so keep this tab open.'
        : Net.writable ? 'Anyone with this page\u2019s link can join. Create a game, or join one below.'
        : 'You have read-only access to this page, so you can watch games but not create or join them.';
      games.forEach(function (g) {
        var isMine = g.owner === me || (g.joiner && g.joiner.userId === me);
        if (isMine && g.status !== 'done') mine.push(g);
        else if (g.status === 'done') done.push(g);
        else if (g.status === 'open') open.push(g);
        else live.push(g);
      });
      var desc = function (g) {
        return g.size + '×' + g.size + ' · komi ' + fmtNum(g.komi) + (g.handicap ? ' · H' + g.handicap : '') + (g.title ? ' · ' + g.title : '');
      };
      var names = function (g) {
        var cc = g.creatorColor || 'B';
        var ownerN = g.owner === me ? 'You' : g.ownerName;
        var joinN = g.joiner ? (g.joiner.userId === me ? 'You' : g.joiner.name) : '…';
        return cc === 'B' ? ownerN + ' (B) vs ' + joinN + ' (W)' : joinN + ' (B) vs ' + ownerN + ' (W)';
      };
      var item = function (title, sub, actions) {
        return h('li', { class: 'item' }, h('div', { class: 'gi-main' }, h('div', { class: 'gi-title', text: title }), h('div', { class: 'gi-sub' }, sub)), actions);
      };
      var fill = function (ul, arr, empty, make) {
        clear(ul);
        if (!arr.length) ul.appendChild(h('li', { class: 'empty', text: empty }));
        arr.forEach(function (g) { ul.appendChild(make(g)); });
      };
      this.peekMine(mine);
      fill($('list-mine'), mine, 'No games yet.', function (g) {
        var waiting = g.status === 'open';
        var sub = desc(g), turn = self.turnHint(g);
        if (turn) sub = [h('span', { class: 'turn', text: turn }), ' · ' + sub];
        return item(waiting ? 'Waiting for an opponent' : names(g), sub, [
          h('button', { class: 'btn small', text: waiting ? 'Open' : 'Resume', onclick: function () { self.openGame(g.id); } }),
          waiting && g.owner === me ? confirmButton('Remove', 'Remove?', function () { self.cancel(g); }, 'ghost small') : null
        ]);
      });
      fill($('list-open'), open, 'No open games. Create one and share the link.', function (g) {
        var color = (g.creatorColor || 'B') === 'B' ? 'White' : 'Black';
        return item(g.ownerName + (g.title ? ' — ' + g.title : ''), desc(g) + ' · you play ' + color, [
          h('button', { class: 'btn small primary', text: 'Join', disabled: !Net.writable, onclick: function () { self.join(g); } }),
          h('button', { class: 'btn ghost small', text: 'Watch', onclick: function () { self.openGame(g.id); } })
        ]);
      });
      fill($('list-live'), live.slice(0, 20), 'Nothing in progress.', function (g) {
        return item(names(g), desc(g), h('button', { class: 'btn small', text: 'Watch', onclick: function () { self.openGame(g.id); } }));
      });
      fill($('list-done'), done.slice(0, 10), 'None yet.', function (g) {
        return item(names(g), desc(g), h('button', { class: 'btn ghost small', text: 'Review', onclick: function () { self.openGame(g.id); } }));
      });
    },

    // One-off reads of my active games so the lobby can say whose move it is.
    peekMine: function (games) {
      var now = Date.now(), self = this;
      this.peeked = this.peeked || {};
      games.slice(0, 8).forEach(function (g) {
        if (g.status !== 'playing') return;
        var key = 'game:' + g.id;
        if (self.peeked[key] && now - self.peeked[key] < 20000) return;
        self.peeked[key] = now;
        Net.load(key).then(function () { if (self.view === 'lobby') self.renderLobby(); }, function () { });
      });
    },
    turnHint: function (g) {
      var key = 'game:' + g.id;
      if (!Net.cache[key]) return '';
      var d = deriveGame(g, Net.records(key)), my = this.myColor(d);
      if (!my || !d.seats.B || !d.seats.W) return '';
      if (d.phase === 'scoring') return 'Scoring';
      if (d.phase === 'play' && d.state.toPlay === my) return 'Your move';
      return '';
    },

    renderGame: function () {
      var self = this;
      if (!this.game) {
        $('online-title').textContent = 'Loading game…';
        $('online-meta').textContent = '';
        clear($('online-players')); clear($('online-controls')); clear($('online-controls-2'));
        $('online-request').hidden = true;
        $('online-invite').hidden = true;
        this.renderConn();
        $('online-status').textContent = Net.p2p && !Net.p2p.synced ? 'Connecting to the host\u2026'
          : Net.cache.lobby ? 'This game could not be found. It may have been removed.' : '';
        return;
      }
      var key = 'game:' + this.game.id;
      if (!Net.cache[key]) {
        $('online-title').textContent = 'Loading game…';
        clear($('online-players')); clear($('online-controls')); clear($('online-controls-2'));
        clear($('online-status'));
        $('online-request').hidden = true;
        return;
      }
      var d = this.d = deriveGame(this.game, Net.records(key));
      var g = this.game, st = d.state, my = this.myColor(d);
      this.renderConn();
      this.renderInvite(d, my);
      var players = Net.ok && d.seats;
      var seatName = function (c) {
        var s = d.seats[c === 1 ? 'B' : 'W'];
        return s ? s.name : 'Waiting…';
      };
      $('online-title').textContent = g.title ? g.title : (my ? 'Your game' : 'Watching');
      $('online-meta').textContent = g.size + '×' + g.size + ' · komi ' + fmtNum(g.komi) + (g.handicap ? ' · handicap ' + g.handicap : '') + ' · move ' + d.seq.length;

      var scoring = d.phase === 'scoring' || (d.phase === 'done' && !d.resigned);
      var sc = scoring ? (d.score || E.score(st, d.dead)) : null;
      var myTurn = d.phase === 'play' && my && st.toPlay === my && players.B && players.W;
      var undoPending = this.undoPendingFor(d, my);
      var seqLen = d.seq.length;
      this.board.render({
        board: st.board, size: st.size, lastMove: st.lastMove,
        mode: myTurn && !undoPending ? 'play' : (d.phase === 'scoring' && my ? 'mark' : 'none'),
        ghostColor: my,
        isLegal: function (i) { return E.isLegal(st, i % st.size, Math.floor(i / st.size)); },
        dead: scoring ? d.dead : null, territory: sc ? sc.territory : null,
        animate: this.lastSeq >= 0 && seqLen === this.lastSeq + 1
      });
      this.lastSeq = seqLen;

      renderPlayers($('online-players'), {
        names: { 1: seatName(1), 2: seatName(2) }, you: my, toMove: d.phase === 'play' && d.seats.W && d.seats.B ? st.toPlay : 0,
        captures: st.captures,
        extra: sc ? { 1: fmtNum(sc.black) + ' pts', 2: fmtNum(sc.white) + ' pts' }
          : d.phase === 'scoring' ? null : null
      });

      var status = clear($('online-status'));
      if (!d.seats.B || !d.seats.W) {
        append(status, !my ? 'Waiting for an opponent.' : Net.p2p ? 'Waiting for your opponent to open the link.'
          : 'Waiting for an opponent. Anyone who opens this page can join from the lobby.');
        if (!my && Net.writable) {
          append(status, [' ', h('button', { class: 'btn small primary', text: 'Take the empty seat', onclick: function () { self.join(g); } })]);
        }
      } else if (d.phase === 'play') {
        if (myTurn) append(status, [h('span', { class: 'pulse', 'aria-hidden': 'true' }), h('span', { class: 'your-move', text: 'Your move' })]);
        else append(status, [h('strong', { text: seatName(st.toPlay) }), ' to play' + (my ? '' : ' (' + colorName(st.toPlay) + ')')]);
        if (st.lastMove === 'pass') append(status, h('span', { class: 'muted', text: ' — ' + colorName(3 - st.toPlay) + ' passed' }));
      } else if (d.phase === 'scoring') {
        append(status, my ? 'Both passed. Tap groups to mark dead, then accept. ' : 'Players are agreeing on dead stones. ');
        append(status, h('span', { class: 'muted', text: scoreLine(sc, st.komi) }));
        var acc = d.accepted || {};
        var who = [1, 2].filter(function (c) { return acc[c]; }).map(function (c) { return my === c ? 'You' : seatName(c); });
        if (who.length) append(status, h('div', { class: 'muted small', text: who.join(' and ') + ' accepted this result.' }));
      } else if (d.phase === 'done') {
        append(status, h('span', { class: 'result', text: resultText(d.result) }));
        if (sc) append(status, h('div', { class: 'muted small', text: scoreLine(sc, st.komi) }));
      }
      if (d.bad) append(status, h('div', { class: 'muted small', text: 'Part of the record could not be replayed.' }));

      // Undo requests
      var reqBox = clear($('online-request'));
      reqBox.hidden = true;
      if (my && d.phase !== 'done') {
        var oppSlot = d.slot[3 - my], mySlot = d.slot[my];
        if (oppSlot && oppSlot.undoId && oppSlot.undoRequest != null && d.undoBy !== 3 - my && oppSlot.undoId !== (mySlot && mySlot.undoDecline)) {
          reqBox.hidden = false;
          append(reqBox, [h('div', null, h('strong', { text: seatName(3 - my) }), ' asks to take back their last move.'),
            h('div', { class: 'controls' },
              h('button', { class: 'btn small primary', text: 'Allow', onclick: function () { self.answerUndo(true); } }),
              h('button', { class: 'btn small', text: 'Decline', onclick: function () { self.answerUndo(false); } }))]);
        } else if (undoPending) {
          reqBox.hidden = false;
          append(reqBox, [h('div', { text: 'Undo requested — waiting for ' + seatName(3 - my) + '.' }),
            h('div', { class: 'controls' }, h('button', { class: 'btn small', text: 'Cancel request', onclick: function () { self.cancelUndo(); } }))]);
        }
      }

      var c1 = clear($('online-controls')), c2 = clear($('online-controls-2'));
      var bothSeated = d.seats.B && d.seats.W;
      if (my && bothSeated && Net.writable && !Net.revoked) {
        if (d.phase === 'play') {
          c1.appendChild(h('button', { class: 'btn', text: 'Pass', disabled: !myTurn || undoPending, onclick: function () { self.pass(); } }));
          c1.appendChild(h('button', { class: 'btn', text: 'Request undo', disabled: d.lastIndexOf[my] < 0 || undoPending, onclick: function () { self.requestUndo(); } }));
          c1.appendChild(confirmButton('Resign', 'Confirm resign', function () { self.resign(); }, 'danger'));
        } else if (d.phase === 'scoring') {
          var iAccepted = d.accepted && d.accepted[my];
          c1.appendChild(h('button', { class: 'btn primary', text: iAccepted ? 'Accepted' : 'Accept score', disabled: iAccepted, onclick: function () { self.acceptScore(); } }));
          c1.appendChild(h('button', { class: 'btn', text: 'Request undo', disabled: undoPending, onclick: function () { self.requestUndo(); } }));
          c1.appendChild(confirmButton('Resign', 'Confirm resign', function () { self.resign(); }, 'danger'));
        }
      }
      c2.appendChild(h('button', { class: 'btn ghost small', text: 'Export SGF', onclick: function () {
        exportSGF(st, { black: seatName(1), white: seatName(2), result: resultSGF(d.result), date: today(), gameName: g.title }, 'go-' + g.id);
      } }));
      if (Net.p2p && $('online-invite').hidden) {
        c2.appendChild(h('button', { class: 'btn ghost small', text: 'Copy game link', onclick: function () { copyText(Net.store.inviteLink(g.id)); } }));
      }
      if (!my) c2.appendChild(h('span', { class: 'muted small', text: 'You are watching.' }));
    },
    renderConn: function () {
      var el = $('online-conn');
      if (!Net.p2p) { el.hidden = true; return; }
      var ct = connInfo();
      el.hidden = false;
      el.textContent = ct.text;
      el.className = 'conn small ' + ct.cls;
    },
    renderInvite: function (d, my) {
      var box = $('online-invite');
      var open = !d.seats.B || !d.seats.W;
      if (!Net.p2p || !open || !my) { box.hidden = true; return; }
      var link = Net.store.inviteLink(d.game.id);
      if (!box.hidden && box.getAttribute('data-link') === link) return; // keep selection / focus stable
      box.hidden = false;
      box.setAttribute('data-link', link);
      var input = h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Invite link', onfocus: function () { input.select(); } });
      append(clear(box), [
        h('h3', { text: 'Send this link to your opponent' }),
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', text: 'Copy', onclick: function () { copyText(link, input); } })),
        h('p', { text: 'They open it and take the empty seat \u2014 no sign-in. Keep this tab open: your browser hosts the game.' })
      ]);
    },
    undoPendingFor: function (d, my) {
      if (!my) return false;
      var s = d.slot[my], opp = d.slot[3 - my];
      if (!s || !s.undoId || s.undoRequest == null) return false;
      if (opp && opp.undoDecline === s.undoId) return false;
      return d.undoBy !== my;
    },
    isMyTurn: function () {
      var d = this.d;
      if (this.view !== 'game' || !d || !Net.ok) return false;
      var my = this.myColor(d);
      if (!my || !d.seats.B || !d.seats.W) return false;
      if (d.phase === 'play') return d.state.toPlay === my;
      return false;
    }
  };

  function updateYourMove() {
    var mine = Online.isMyTurn();
    document.title = mine ? '● Your move — Go' : 'Go';
    var tab = $('tab-online'), dot = tab.querySelector('.dot');
    if (mine && activeTab !== 'online' && !dot) tab.appendChild(h('span', { class: 'dot', 'aria-label': 'your move' }));
    if ((!mine || activeTab === 'online') && dot) dot.remove();
  }

  // ------------------------------------------------------------------ tabs, keys, boot

  var activeTab = null;
  function selectTab(name) {
    activeTab = name;
    ls.set('tab', name);
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    ['online', 'local', 'problems'].forEach(function (t) { $('view-' + t).hidden = t !== name; });
    if (name === 'problems') Problems.markCurrent();
    updateYourMove();
  }

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) selectTab(b.getAttribute('data-tab'));
  });
  document.querySelector('.tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var order = ['online', 'local', 'problems'];
    var k = (order.indexOf(activeTab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
    selectTab(order[k]);
    $('tab-' + order[k]).focus();
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ($('sgf-dialog').open) return;
    var k = e.key.toLowerCase();
    if (activeTab === 'local') {
      if (k === 'p') { Local.pass(); e.preventDefault(); }
      else if (k === 'u') { Local.undo(); e.preventDefault(); }
    } else if (activeTab === 'online') {
      if (k === 'p' && Online.view === 'game') { Online.pass(); e.preventDefault(); }
    } else if (activeTab === 'problems') {
      if (e.key === 'ArrowLeft') { Problems.step(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { Problems.step(1); e.preventDefault(); }
    }
  });

  var coordsBox = $('coords-toggle');
  coordsBox.checked = showCoords;
  coordsBox.addEventListener('change', function () {
    showCoords = coordsBox.checked;
    ls.set('coords', showCoords);
    Local.render(false);
    Problems.p && Problems.render(false);
    if (Online.view === 'game' && Online.game) Online.render();
  });

  if (!E) {
    showBanner('The game engine failed to load. Please reload the page.');
    return;
  }

  Local.init();
  Problems.init();
  Online.init();
  var wantTab = /^#game=/.test(location.hash) || PARAMS.has('game') ? 'online' : ls.get('tab', 'online');
  selectTab(['online', 'local', 'problems'].indexOf(wantTab) >= 0 ? wantTab : 'online');

  // Expose a small hook for debugging and tests.
  window.GoApp = { Local: Local, Problems: Problems, Online: Online, Net: Net, deriveGame: deriveGame };
})();
