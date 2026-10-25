/*
 * GoEngine — rules engine for the game of Go (baduk / weiqi).
 *
 * Classic script, no dependencies. Exposes `window.GoEngine` in the browser and
 * `module.exports` under node. See SPEC.md for the contract.
 *
 * Coordinates: x = column (0..size-1, left to right), y = row (0..size-1, top to
 * bottom), index i = y * size + x. Colors: 0 empty, 1 black, 2 white.
 * States are treated as immutable: every operation returns a new state.
 */
(function () {
  'use strict';

  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;
  var LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // ---------------------------------------------------------------------------
  // Geometry helpers (cached per board size)

  var neighborCache = {};

  function neighbors(size) {
    var table = neighborCache[size];
    if (table) return table;
    table = new Array(size * size);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var i = y * size + x;
        var list = [];
        if (x > 0) list.push(i - 1);
        if (x < size - 1) list.push(i + 1);
        if (y > 0) list.push(i - size);
        if (y < size - 1) list.push(i + size);
        table[i] = list;
      }
    }
    neighborCache[size] = table;
    return table;
  }

  function boardKey(board) {
    return board.join('');
  }

  function normalizeColor(c) {
    if (c === BLACK || c === 'B' || c === 'b' || c === 'black') return BLACK;
    if (c === WHITE || c === 'W' || c === 'w' || c === 'white') return WHITE;
    return 0;
  }

  function toIndex(p, size) {
    if (typeof p === 'string') return sgfToPoint(p, size);
    if (typeof p === 'number' && p >= 0 && p < size * size && p === Math.floor(p)) return p;
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      if (p.x < 0 || p.y < 0 || p.x >= size || p.y >= size) return -1;
      return p.y * size + p.x;
    }
    return -1;
  }

  function toSet(dead) {
    if (!dead) return new Set();
    if (dead instanceof Set) return dead;
    return new Set(dead);
  }

  // Stones and liberties of the chain containing `start` (which must be a stone).
  function scanGroup(board, size, start) {
    var nb = neighbors(size);
    var color = board[start];
    var seen = new Uint8Array(board.length);
    var stones = [];
    var liberties = [];
    var stack = [start];
    seen[start] = 1;
    while (stack.length) {
      var p = stack.pop();
      stones.push(p);
      var ns = nb[p];
      for (var k = 0; k < ns.length; k++) {
        var q = ns[k];
        if (seen[q]) continue;
        var c = board[q];
        if (c === color) {
          seen[q] = 1;
          stack.push(q);
        } else if (c === EMPTY) {
          seen[q] = 1;
          liberties.push(q);
        }
      }
    }
    return { stones: stones, liberties: liberties, color: color };
  }

  function fail(reason) {
    return { ok: false, reason: reason };
  }

  // ---------------------------------------------------------------------------
  // Game state

  function createGame(size, opts) {
    opts = opts || {};
    size = size | 0;
    if (size < 2 || size > 52) throw new RangeError('GoEngine: unsupported board size ' + size);
    var komi = opts.komi == null ? 6.5 : Number(opts.komi);
    var board = new Int8Array(size * size);

    var hc = (opts.handicap | 0) >= 2 ? handicapPoints(size, opts.handicap | 0) : [];
    for (var h = 0; h < hc.length; h++) board[hc[h]] = BLACK;

    var setup = opts.setup || {};
    var lists = [[setup.black, BLACK], [setup.white, WHITE]];
    for (var l = 0; l < lists.length; l++) {
      var pts = lists[l][0] || [];
      for (var s = 0; s < pts.length; s++) {
        var i = toIndex(pts[s], size);
        if (i >= 0) board[i] = lists[l][1];
      }
    }

    var toPlay = normalizeColor(opts.toPlay) || (hc.length ? WHITE : BLACK);

    var initial = { black: [], white: [], toPlay: toPlay };
    for (var j = 0; j < board.length; j++) {
      if (board[j] === BLACK) initial.black.push(j);
      else if (board[j] === WHITE) initial.white.push(j);
    }

    return {
      size: size,
      komi: komi,
      board: board,
      toPlay: toPlay,
      captures: { 1: 0, 2: 0 },
      ko: -1,
      lastMove: -1,
      moveNumber: 0,
      consecutivePasses: 0,
      positions: new Set([boardKey(board)]),
      moves: [],
      // Extras beyond the SPEC state shape, used by toSGF.
      handicap: hc.length,
      initial: initial
    };
  }

  function withChanges(state, changes) {
    var next = {};
    for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) next[k] = state[k];
    for (var c in changes) if (Object.prototype.hasOwnProperty.call(changes, c)) next[c] = changes[c];
    return next;
  }

  // Place a stone of `color` at index i. When color differs from state.toPlay
  // (e.g. SGF records with consecutive same-color moves) simple ko is not applied.
  function playAt(state, i, color) {
    var size = state.size;
    if (!(i >= 0 && i < size * size)) return fail('offboard');
    if (state.board[i] !== EMPTY) return fail('occupied');
    if (i === state.ko && color === state.toPlay) return fail('ko');

    var nb = neighbors(size)[i];
    var opp = 3 - color;
    var b = new Int8Array(state.board);
    b[i] = color;

    var captured = [];
    for (var k = 0; k < nb.length; k++) {
      var n = nb[k];
      if (b[n] !== opp) continue;
      var g = scanGroup(b, size, n);
      if (g.liberties.length === 0) {
        for (var s = 0; s < g.stones.length; s++) {
          b[g.stones[s]] = EMPTY;
          captured.push(g.stones[s]);
        }
      }
    }

    var own = scanGroup(b, size, i);
    if (own.liberties.length === 0) return fail('suicide');

    var key = boardKey(b);
    if (state.positions.has(key)) return fail('ko'); // positional superko

    var ko = -1;
    if (captured.length === 1 && own.stones.length === 1 && own.liberties.length === 1) ko = captured[0];

    var captures = { 1: state.captures[1], 2: state.captures[2] };
    captures[color] += captured.length;
    var positions = new Set(state.positions);
    positions.add(key);

    var next = withChanges(state, {
      board: b,
      toPlay: opp,
      captures: captures,
      ko: ko,
      lastMove: i,
      moveNumber: state.moveNumber + 1,
      consecutivePasses: 0,
      positions: positions,
      moves: state.moves.concat([{ color: color, i: i }])
    });
    return { ok: true, state: next, captured: captured };
  }

  function play(state, x, y) {
    var size = state.size;
    if (typeof x !== 'number' || typeof y !== 'number' || x !== Math.floor(x) || y !== Math.floor(y) ||
        x < 0 || y < 0 || x >= size || y >= size) {
      return fail('offboard');
    }
    return playAt(state, y * size + x, state.toPlay);
  }

  function pass(state) {
    return withChanges(state, {
      toPlay: 3 - state.toPlay,
      ko: -1,
      lastMove: 'pass',
      moveNumber: state.moveNumber + 1,
      consecutivePasses: state.consecutivePasses + 1,
      moves: state.moves.concat([{ color: state.toPlay, pass: true }])
    });
  }

  function isLegal(state, x, y) {
    return play(state, x, y).ok;
  }

  // Accepts {x,y}, {i} or {pass:true}; {resign:true} and illegal moves are skipped.
  function replay(baseState, moves) {
    var state = baseState;
    if (!moves) return state;
    for (var k = 0; k < moves.length; k++) {
      var m = moves[k];
      if (!m || m.resign) continue;
      if (m.pass) {
        state = pass(state);
        continue;
      }
      var r = null;
      if (typeof m.x === 'number' && typeof m.y === 'number') r = play(state, m.x, m.y);
      else if (typeof m.i === 'number') r = playAt(state, m.i, state.toPlay);
      if (r && r.ok) state = r.state;
    }
    return state;
  }

  function groupAt(state, i) {
    if (!(i >= 0 && i < state.board.length) || state.board[i] === EMPTY) {
      return { stones: [], liberties: [], color: EMPTY };
    }
    return scanGroup(state.board, state.size, i);
  }

  // ---------------------------------------------------------------------------
  // Scoring (Japanese: territory + prisoners, white adds komi)

  function score(state, dead) {
    var size = state.size;
    var N = size * size;
    var nb = neighbors(size);
    var board = new Int8Array(state.board);
    var deadSet = toSet(dead);
    var deadCount = { 1: 0, 2: 0 };
    deadSet.forEach(function (i) {
      if (i >= 0 && i < N && board[i] !== EMPTY) {
        deadCount[board[i]]++;
        board[i] = EMPTY;
      }
    });

    var territory = new Int8Array(N);
    var seen = new Uint8Array(N);
    var count = { 1: 0, 2: 0 };
    for (var start = 0; start < N; start++) {
      if (board[start] !== EMPTY || seen[start]) continue;
      var region = [];
      var border = 0; // bit 1 = touches black, bit 2 = touches white
      var stack = [start];
      seen[start] = 1;
      while (stack.length) {
        var p = stack.pop();
        region.push(p);
        var ns = nb[p];
        for (var k = 0; k < ns.length; k++) {
          var q = ns[k];
          var c = board[q];
          if (c === EMPTY) {
            if (!seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
          } else {
            border |= c;
          }
        }
      }
      if (border === BLACK || border === WHITE) {
        for (var r = 0; r < region.length; r++) territory[region[r]] = border;
        count[border] += region.length;
      }
    }

    var black = count[1] + state.captures[1] + deadCount[2];
    var white = count[2] + state.captures[2] + deadCount[1] + state.komi;
    var winner = black > white ? BLACK : white > black ? WHITE : 0;
    return {
      black: black,
      white: white,
      territory: territory,
      winner: winner,
      margin: Math.abs(black - white),
      // Extra: per-side breakdown for display.
      breakdown: {
        black: { territory: count[1], captures: state.captures[1], dead: deadCount[2] },
        white: { territory: count[2], captures: state.captures[2], dead: deadCount[1], komi: state.komi }
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Dead stone estimate (static, deterministic, a starting suggestion only).
  // Each empty region is "owned" by a color when that color has at least twice as
  // many stones bordering it. Chains of a color are linked through the regions
  // that color owns (eyes/territory). A linked group is suggested dead when it
  // touches no neutral region (only its own or the opponent's) and its own
  // regions can't make two eyes (fewer than two of them, under three points total).

  function estimateDead(state) {
    var size = state.size;
    var N = size * size;
    var board = state.board;
    var nb = neighbors(size);
    var dead = new Set();

    var regionOf = new Int32Array(N).fill(-1);
    var stamp = new Int32Array(N).fill(-1);
    var regions = []; // { size, owner, chains: [chainId] }
    for (var start = 0; start < N; start++) {
      if (board[start] !== EMPTY || regionOf[start] >= 0) continue;
      var id = regions.length;
      var adj = { 1: 0, 2: 0 };
      var count = 0;
      var stack = [start];
      regionOf[start] = id;
      while (stack.length) {
        var p = stack.pop();
        count++;
        var ns = nb[p];
        for (var k = 0; k < ns.length; k++) {
          var q = ns[k];
          if (board[q] === EMPTY) {
            if (regionOf[q] < 0) {
              regionOf[q] = id;
              stack.push(q);
            }
          } else if (stamp[q] !== id) {
            stamp[q] = id;
            adj[board[q]]++;
          }
        }
      }
      var owner = adj[1] > 0 && adj[1] >= 2 * adj[2] ? BLACK : adj[2] > 0 && adj[2] >= 2 * adj[1] ? WHITE : EMPTY;
      regions.push({ size: count, owner: owner, chains: [] });
    }

    var chainOf = new Int32Array(N).fill(-1);
    var chains = []; // { color, stones, regions: [regionId] }
    for (var s = 0; s < N; s++) {
      if (board[s] === EMPTY || chainOf[s] >= 0) continue;
      var g = scanGroup(board, size, s);
      var cid = chains.length;
      var touched = [];
      for (var a = 0; a < g.stones.length; a++) chainOf[g.stones[a]] = cid;
      for (var b = 0; b < g.liberties.length; b++) {
        var r = regionOf[g.liberties[b]];
        if (touched.indexOf(r) < 0) {
          touched.push(r);
          regions[r].chains.push(cid);
        }
      }
      chains.push({ color: g.color, stones: g.stones, regions: touched });
    }

    // Union chains of the same color that share a region their color owns.
    var parent = chains.map(function (_, i) { return i; });
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    regions.forEach(function (reg) {
      if (!reg.owner) return;
      var first = -1;
      reg.chains.forEach(function (c) {
        if (chains[c].color !== reg.owner) return;
        if (first < 0) first = find(c);
        else parent[find(c)] = first;
      });
    });

    var groups = {}; // root -> { ownRegions: [ids], touchesNeutral }
    chains.forEach(function (ch, c) {
      var root = find(c);
      var grp = groups[root] || (groups[root] = { ownRegions: [], touchesNeutral: false });
      ch.regions.forEach(function (r) {
        var owner = regions[r].owner;
        if (owner === ch.color) {
          if (grp.ownRegions.indexOf(r) < 0) grp.ownRegions.push(r);
        } else if (owner === EMPTY) {
          grp.touchesNeutral = true;
        }
      });
    });

    chains.forEach(function (ch, c) {
      var grp = groups[find(c)];
      var ownSize = 0;
      grp.ownRegions.forEach(function (r) { ownSize += regions[r].size; });
      if (!grp.touchesNeutral && grp.ownRegions.length < 2 && ownSize < 3) {
        ch.stones.forEach(function (i) { dead.add(i); });
      }
    });
    return dead;
  }

  // ---------------------------------------------------------------------------
  // Star points and handicap placement

  function starPoints(size) {
    var coords;
    if (size === 19) {
      coords = [];
      var lines = [3, 9, 15];
      for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) coords.push([lines[b], lines[a]]);
    } else if (size === 13) {
      coords = [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]];
    } else if (size === 9) {
      coords = [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]];
    } else if (size >= 7) {
      var lo = size >= 13 ? 3 : 2;
      var hi = size - 1 - lo;
      coords = [[lo, lo], [hi, lo], [lo, hi], [hi, hi]];
      if (size % 2 === 1) coords.push([(size - 1) / 2, (size - 1) / 2]);
    } else {
      coords = [];
    }
    return coords.map(function (c) { return c[1] * size + c[0]; });
  }

  // Standard order: 2 = top-right + bottom-left, 3 adds bottom-right, 4 top-left,
  // odd counts from 5 add the center, 6+ add left/right sides, 8+ top/bottom sides.
  function handicapPoints(size, n) {
    n = Math.min(n | 0, 9);
    if (n < 2 || size < 7) return [];
    var lo = size >= 13 ? 3 : 2;
    var hi = size - 1 - lo;
    var odd = size % 2 === 1;
    var mid = (size - 1) / 2;
    if (!odd) n = Math.min(n, 4);
    var coords = [[hi, lo], [lo, hi]];
    if (n >= 3) coords.push([hi, hi]);
    if (n >= 4) coords.push([lo, lo]);
    if (n >= 6) coords.push([lo, mid], [hi, mid]);
    if (n >= 8) coords.push([mid, lo], [mid, hi]);
    if (n >= 5 && n % 2 === 1) coords.push([mid, mid]);
    return coords.map(function (c) { return c[1] * size + c[0]; });
  }

  // ---------------------------------------------------------------------------
  // SGF

  function sgfToPoint(str, size) {
    if (!str || str.length < 2) return -1;
    if (str === 'tt' && size <= 19) return -1; // FF[3] pass
    var x = LETTERS.indexOf(str.charAt(0));
    var y = LETTERS.indexOf(str.charAt(1));
    if (x < 0 || y < 0 || x >= size || y >= size) return -1;
    return y * size + x;
  }

  function pointToSgf(i, size) {
    if (!(i >= 0 && i < size * size)) return '';
    return LETTERS.charAt(i % size) + LETTERS.charAt(Math.floor(i / size));
  }

  // Properties whose values are point lists and may use "aa:cc" rectangles.
  var POINT_LIST_PROPS = {
    AB: 1, AW: 1, AE: 1, TR: 1, SQ: 1, CR: 1, MA: 1, SL: 1, DD: 1, TB: 1, TW: 1, VW: 1
  };

  function expandRect(value) {
    var m = /^([a-zA-Z])([a-zA-Z]):([a-zA-Z])([a-zA-Z])$/.exec(value);
    if (!m) return [value];
    var x1 = LETTERS.indexOf(m[1]);
    var y1 = LETTERS.indexOf(m[2]);
    var x2 = LETTERS.indexOf(m[3]);
    var y2 = LETTERS.indexOf(m[4]);
    var out = [];
    for (var y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      for (var x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        out.push(LETTERS.charAt(x) + LETTERS.charAt(y));
      }
    }
    return out;
  }

  function isSpace(ch) {
    return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\v';
  }

  // Returns the root node of the first game tree: { props: {KEY: [values]}, children: [node] }.
  function parseSGF(text) {
    text = String(text == null ? '' : text);
    var n = text.length;
    var pos = text.indexOf('(');
    if (pos < 0) throw new Error('SGF: no game tree found');

    var root = null;
    var cur = null;
    var stack = [];

    function readNode() {
      var node = { props: {}, children: [] };
      for (;;) {
        while (pos < n && isSpace(text.charAt(pos))) pos++;
        if (pos >= n) break;
        var ch = text.charAt(pos);
        if (ch === ';' || ch === '(' || ch === ')') break;
        var identStart = pos;
        while (pos < n && /[A-Za-z]/.test(text.charAt(pos))) pos++;
        // FF[3] allowed lowercase letters inside identifiers (e.g. "AddBlack"); keep the capitals.
        var ident = text.slice(identStart, pos).replace(/[a-z]/g, '');
        while (pos < n && isSpace(text.charAt(pos))) pos++;
        if (pos >= n || text.charAt(pos) !== '[') {
          if (pos === identStart) pos++; // skip stray junk
          continue;
        }
        var values = [];
        while (pos < n && text.charAt(pos) === '[') {
          pos++;
          var val = '';
          while (pos < n && text.charAt(pos) !== ']') {
            var c = text.charAt(pos);
            if (c === '\\' && pos + 1 < n) {
              var next = text.charAt(pos + 1);
              pos += 2;
              if (next === '\r') {
                if (text.charAt(pos) === '\n') pos++; // soft line break
              } else if (next === '\n') {
                if (text.charAt(pos) === '\r') pos++;
              } else {
                val += next;
              }
            } else {
              val += c;
              pos++;
            }
          }
          pos++; // closing ]
          values.push(val);
          while (pos < n && isSpace(text.charAt(pos))) pos++;
        }
        if (!ident) continue;
        if (POINT_LIST_PROPS[ident]) {
          var expanded = [];
          for (var v = 0; v < values.length; v++) expanded = expanded.concat(expandRect(values[v]));
          values = expanded;
        }
        node.props[ident] = (node.props[ident] || []).concat(values);
      }
      return node;
    }

    while (pos < n) {
      var ch = text.charAt(pos);
      if (ch === '(') {
        stack.push(cur);
        pos++;
      } else if (ch === ')') {
        pos++;
        cur = stack.pop();
        if (!stack.length) break; // end of first game tree
      } else if (ch === ';') {
        pos++;
        var node = readNode();
        if (cur) cur.children.push(node);
        else if (!root) root = node;
        cur = node;
      } else {
        pos++;
      }
    }
    if (!root) throw new Error('SGF: empty game tree');
    return root;
  }

  function escapeSgf(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/]/g, '\\]');
  }

  // meta: { black, white, result, date, event, gameName, comment, rules }
  function toSGF(state, meta) {
    meta = meta || {};
    var size = state.size;
    var out = '(;GM[1]FF[4]CA[UTF-8]AP[GoEngine:1]';
    out += 'SZ[' + size + ']KM[' + state.komi + ']';
    if (state.handicap) out += 'HA[' + state.handicap + ']';
    out += 'RU[' + escapeSgf(meta.rules || 'Japanese') + ']';
    var info = [['PB', meta.black], ['PW', meta.white], ['RE', meta.result], ['DT', meta.date],
      ['EV', meta.event], ['GN', meta.gameName], ['C', meta.comment]];
    for (var k = 0; k < info.length; k++) {
      if (info[k][1] != null && info[k][1] !== '') out += info[k][0] + '[' + escapeSgf(info[k][1]) + ']';
    }
    var initial = state.initial;
    if (initial) {
      if (initial.black.length) {
        out += 'AB' + initial.black.map(function (i) { return '[' + pointToSgf(i, size) + ']'; }).join('');
      }
      if (initial.white.length) {
        out += 'AW' + initial.white.map(function (i) { return '[' + pointToSgf(i, size) + ']'; }).join('');
      }
      out += 'PL[' + (initial.toPlay === WHITE ? 'W' : 'B') + ']';
    }
    for (var m = 0; m < state.moves.length; m++) {
      var mv = state.moves[m];
      if (m % 12 === 0) out += '\n';
      out += ';' + (mv.color === WHITE ? 'W' : 'B') + '[' + (mv.pass ? '' : pointToSgf(mv.i, size)) + ']';
    }
    return out + ')\n';
  }

  // Extra (not in SPEC): build a state from SGF text or a parsed root, following
  // the main line. Returns { state, meta, root }.
  function fromSGF(input) {
    var root = typeof input === 'string' ? parseSGF(input) : input;
    var props = root.props;
    function first(key) {
      return props[key] && props[key].length ? props[key][0] : undefined;
    }
    var size = parseInt(first('SZ'), 10) || 19;
    var komi = parseFloat(first('KM'));
    if (isNaN(komi)) komi = 0;
    var handicap = parseInt(first('HA'), 10) || 0;
    var setup = { black: props.AB || [], white: props.AW || [] };

    var mainLine = [];
    for (var node = root; node; node = node.children[0]) mainLine.push(node);

    var toPlay = normalizeColor(first('PL'));
    if (!toPlay) {
      for (var f = 0; f < mainLine.length && !toPlay; f++) {
        if (mainLine[f].props.B) toPlay = BLACK;
        else if (mainLine[f].props.W) toPlay = WHITE;
      }
    }
    if (!toPlay) toPlay = handicap >= 2 && setup.black.length ? WHITE : BLACK;

    var state = createGame(size, { komi: komi, setup: setup, toPlay: toPlay });
    state.handicap = handicap;

    for (var k = 0; k < mainLine.length; k++) {
      var p = mainLine[k].props;
      var color = p.B ? BLACK : p.W ? WHITE : 0;
      if (!color) continue;
      var i = sgfToPoint((p.B || p.W)[0], size);
      if (i < 0) {
        state = pass(color === state.toPlay ? state : withChanges(state, { toPlay: color }));
      } else {
        var r = playAt(state, i, color);
        if (r.ok) state = r.state;
      }
    }

    var meta = {
      black: first('PB'),
      white: first('PW'),
      result: first('RE'),
      date: first('DT'),
      event: first('EV'),
      gameName: first('GN'),
      comment: first('C')
    };
    return { state: state, meta: meta, root: root };
  }

  var GoEngine = {
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    createGame: createGame,
    play: play,
    pass: pass,
    replay: replay,
    isLegal: isLegal,
    groupAt: groupAt,
    score: score,
    estimateDead: estimateDead,
    handicapPoints: handicapPoints,
    starPoints: starPoints,
    sgfToPoint: sgfToPoint,
    pointToSgf: pointToSgf,
    parseSGF: parseSGF,
    toSGF: toSGF,
    fromSGF: fromSGF
  };

  if (typeof module === 'object' && module && module.exports) module.exports = GoEngine;
  if (typeof window !== 'undefined') window.GoEngine = GoEngine;
})();
