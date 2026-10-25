// Run with: node site/test/engine.test.js
'use strict';

var assert = require('assert');
var path = require('path');
var G = require(path.join(__dirname, '..', 'site', 'go-engine.js'));

var passed = 0;
var failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + (e && e.stack || e));
  }
}

// Build a game from an ASCII diagram: X black, O white, anything else empty.
function diagram(rows, opts) {
  opts = opts || {};
  var size = rows.length;
  var black = [];
  var white = [];
  rows.forEach(function (row, y) {
    row.replace(/\s+/g, '').split('').forEach(function (ch, x) {
      if (ch === 'X') black.push(y * size + x);
      else if (ch === 'O') white.push(y * size + x);
    });
  });
  return G.createGame(size, {
    komi: opts.komi == null ? 6.5 : opts.komi,
    setup: { black: black, white: white },
    toPlay: opts.toPlay || 1
  });
}

function at(state, x, y) {
  return state.board[y * state.size + x];
}

function mustPlay(state, x, y) {
  var r = G.play(state, x, y);
  assert.ok(r.ok, 'expected legal move at ' + x + ',' + y + ' but got ' + r.reason);
  return r;
}

test('createGame defaults', function () {
  var s = G.createGame(19);
  assert.strictEqual(s.size, 19);
  assert.strictEqual(s.komi, 6.5);
  assert.ok(s.board instanceof Int8Array);
  assert.strictEqual(s.board.length, 361);
  assert.strictEqual(s.toPlay, 1);
  assert.deepStrictEqual(s.captures, { 1: 0, 2: 0 });
  assert.strictEqual(s.ko, -1);
  assert.strictEqual(s.lastMove, -1);
  assert.strictEqual(s.moveNumber, 0);
  assert.strictEqual(s.consecutivePasses, 0);
  assert.ok(s.positions instanceof Set && s.positions.size === 1);
  assert.deepStrictEqual(s.moves, []);
});

test('play alternates, is immutable, rejects occupied/offboard', function () {
  var s0 = G.createGame(9);
  var r = mustPlay(s0, 2, 3);
  assert.strictEqual(at(s0, 2, 3), 0, 'original state untouched');
  assert.strictEqual(at(r.state, 2, 3), 1);
  assert.strictEqual(r.state.toPlay, 2);
  assert.strictEqual(r.state.lastMove, 3 * 9 + 2);
  assert.strictEqual(r.state.moveNumber, 1);
  assert.deepStrictEqual(r.state.moves, [{ color: 1, i: 29 }]);
  assert.deepStrictEqual(r.captured, []);
  assert.deepStrictEqual(G.play(r.state, 2, 3), { ok: false, reason: 'occupied' });
  assert.strictEqual(G.play(r.state, 9, 0).reason, 'offboard');
  assert.strictEqual(G.play(r.state, -1, 0).reason, 'offboard');
  assert.strictEqual(G.play(r.state, 1.5, 0).reason, 'offboard');
});

test('single stone capture', function () {
  var s = diagram([
    'O X . . .',
    '. . . . .',
    '. . . . .',
    '. . . . .',
    '. . . . .'
  ]);
  var r = mustPlay(s, 0, 1);
  assert.deepStrictEqual(r.captured, [0]);
  assert.strictEqual(at(r.state, 0, 0), 0);
  assert.strictEqual(r.state.captures[1], 1);
  assert.strictEqual(r.state.captures[2], 0);
});

test('multi-stone capture (two groups at once)', function () {
  // Black at (2,0) removes the two-stone chains (0,0)-(1,0) and (2,1)-(3,1).
  var s = diagram([
    'O O . X .',
    'X X O O X',
    '. . X X .',
    '. . . . .',
    '. . . . .'
  ]);
  var r = mustPlay(s, 2, 0);
  assert.deepStrictEqual(r.captured.slice().sort(function (a, b) { return a - b; }), [0, 1, 7, 8]);
  assert.strictEqual(r.state.captures[1], 4);
  [0, 1, 7, 8].forEach(function (i) { assert.strictEqual(r.state.board[i], 0); });
});

test('suicide is illegal', function () {
  var s = diagram([
    '. X . . .',
    'X . . . .',
    '. . . . .',
    '. . . . .',
    '. . . . .'
  ], { toPlay: 2 });
  assert.deepStrictEqual(G.play(s, 0, 0), { ok: false, reason: 'suicide' });
  assert.strictEqual(G.isLegal(s, 0, 0), false);
  // multi-stone suicide
  var s2 = diagram([
    'O . X . .',
    'X X . . .',
    '. . . . .',
    '. . . . .',
    '. . . . .'
  ], { toPlay: 2 });
  assert.strictEqual(G.play(s2, 1, 0).reason, 'suicide');
});

test('capture is not suicide', function () {
  var s = diagram([
    '. X O . .',
    'X O . . .',
    'O . . . .',
    '. . . . .',
    '. . . . .'
  ], { toPlay: 2 });
  // White at (0,0) has no liberties itself but captures (1,0) and (0,1).
  assert.ok(G.isLegal(s, 0, 0));
  var r = mustPlay(s, 0, 0);
  assert.deepStrictEqual(r.captured.slice().sort(function (a, b) { return a - b; }), [1, 5]);
  assert.strictEqual(r.state.captures[2], 2);
});

test('simple ko', function () {
  var s = diagram([
    '. X O . .',
    'X O . O .',
    '. X O . .',
    '. . . . .',
    '. . . . .'
  ]);
  var r = mustPlay(s, 2, 1);
  assert.deepStrictEqual(r.captured, [6]);
  assert.strictEqual(r.state.ko, 6);
  // immediate recapture forbidden
  assert.deepStrictEqual(G.play(r.state, 1, 1), { ok: false, reason: 'ko' });
  assert.strictEqual(G.isLegal(r.state, 1, 1), false);
  // after a ko threat exchange it is legal again
  var s2 = mustPlay(r.state, 4, 4).state;
  assert.strictEqual(s2.ko, -1);
  s2 = mustPlay(s2, 4, 3).state;
  var r3 = mustPlay(s2, 1, 1);
  assert.deepStrictEqual(r3.captured, [7]);
  assert.strictEqual(r3.state.ko, 7);
});

test('positional superko catches repetition even without the simple ko marker', function () {
  var s = diagram([
    '. X O . .',
    'X O . O .',
    '. X O . .',
    '. . . . .',
    '. . . . .'
  ]);
  var r = mustPlay(s, 2, 1);
  assert.ok(r.state.positions.size === 2);
  var noKo = Object.assign({}, r.state, { ko: -1 });
  assert.strictEqual(G.play(noKo, 1, 1).reason, 'ko');
  // positions grow with each board change but not with passes
  assert.strictEqual(G.pass(r.state).positions.size, 2);
});

test('pass and two consecutive passes', function () {
  var s = G.createGame(9);
  s = G.pass(s);
  assert.strictEqual(s.toPlay, 2);
  assert.strictEqual(s.lastMove, 'pass');
  assert.strictEqual(s.consecutivePasses, 1);
  assert.strictEqual(s.moveNumber, 1);
  assert.deepStrictEqual(s.moves, [{ color: 1, pass: true }]);
  var s2 = mustPlay(s, 4, 4).state;
  assert.strictEqual(s2.consecutivePasses, 0);
  s2 = G.pass(G.pass(s2));
  assert.strictEqual(s2.consecutivePasses, 2);
  assert.strictEqual(s2.toPlay, 1);
  assert.strictEqual(s2.moveNumber, 4);
  assert.deepStrictEqual(s2.moves.slice(-2), [{ color: 1, pass: true }, { color: 2, pass: true }]);
});

test('pass clears ko', function () {
  var s = diagram([
    '. X O . .',
    'X O . O .',
    '. X O . .',
    '. . . . .',
    '. . . . .'
  ]);
  var r = mustPlay(s, 2, 1);
  assert.strictEqual(G.pass(r.state).ko, -1);
});

test('replay skips illegal moves and ignores resign', function () {
  var base = G.createGame(9);
  var s = G.replay(base, [
    { x: 4, y: 4 }, { x: 4, y: 4 }, // second is illegal (occupied) and skipped
    { x: 3, y: 3 }, { pass: true }, { resign: true }, { x: 99, y: 0 }, { x: 5, y: 5 }
  ]);
  assert.strictEqual(s.moves.length, 4);
  assert.strictEqual(at(s, 4, 4), 1);
  assert.strictEqual(at(s, 3, 3), 2);
  assert.strictEqual(at(s, 5, 5), 2);
  assert.strictEqual(s.toPlay, 1);
  assert.strictEqual(base.moves.length, 0);
});

test('groupAt', function () {
  var s = diagram([
    'X X . . .',
    'X O . . .',
    '. . . . .',
    '. . . . .',
    '. . . . .'
  ]);
  var g = G.groupAt(s, 0);
  assert.strictEqual(g.color, 1);
  assert.deepStrictEqual(g.stones.slice().sort(function (a, b) { return a - b; }), [0, 1, 5]);
  assert.deepStrictEqual(g.liberties.slice().sort(function (a, b) { return a - b; }), [2, 10]);
  assert.deepStrictEqual(G.groupAt(s, 24), { stones: [], liberties: [], color: 0 });
});

test('star points', function () {
  var p19 = G.starPoints(19);
  assert.strictEqual(p19.length, 9);
  assert.ok(p19.indexOf(3 * 19 + 3) >= 0 && p19.indexOf(9 * 19 + 9) >= 0 && p19.indexOf(15 * 19 + 15) >= 0);
  assert.deepStrictEqual(G.starPoints(13).sort(function (a, b) { return a - b; }),
    [3 * 13 + 3, 3 * 13 + 9, 6 * 13 + 6, 9 * 13 + 3, 9 * 13 + 9]);
  assert.deepStrictEqual(G.starPoints(9).sort(function (a, b) { return a - b; }),
    [2 * 9 + 2, 2 * 9 + 6, 4 * 9 + 4, 6 * 9 + 2, 6 * 9 + 6]);
});

test('handicap points and handicap games', function () {
  var sgf = function (n) { return G.handicapPoints(19, n).map(function (i) { return G.pointToSgf(i, 19); }); };
  assert.deepStrictEqual(sgf(2), ['pd', 'dp']);
  assert.deepStrictEqual(sgf(3), ['pd', 'dp', 'pp']);
  assert.deepStrictEqual(sgf(4), ['pd', 'dp', 'pp', 'dd']);
  assert.deepStrictEqual(sgf(5).sort(), ['dd', 'dp', 'jj', 'pd', 'pp']);
  assert.deepStrictEqual(sgf(6).sort(), ['dd', 'dj', 'dp', 'pd', 'pj', 'pp']);
  assert.deepStrictEqual(sgf(7).sort(), ['dd', 'dj', 'dp', 'jj', 'pd', 'pj', 'pp']);
  assert.deepStrictEqual(sgf(8).sort(), ['dd', 'dj', 'dp', 'jd', 'jp', 'pd', 'pj', 'pp']);
  assert.deepStrictEqual(sgf(9).sort(), ['dd', 'dj', 'dp', 'jd', 'jj', 'jp', 'pd', 'pj', 'pp']);
  assert.deepStrictEqual(G.handicapPoints(19, 1), []);
  assert.strictEqual(G.handicapPoints(13, 5).length, 5);
  assert.ok(G.handicapPoints(13, 5).indexOf(6 * 13 + 6) >= 0);
  assert.deepStrictEqual(G.handicapPoints(9, 2).map(function (i) { return G.pointToSgf(i, 9); }), ['gc', 'cg']);

  var s = G.createGame(19, { handicap: 4, komi: 0.5 });
  assert.strictEqual(s.toPlay, 2, 'white moves first in handicap games');
  assert.strictEqual(s.komi, 0.5, 'komi is not overridden');
  assert.strictEqual(s.board.reduce(function (a, c) { return a + (c === 1 ? 1 : 0); }, 0), 4);
  G.handicapPoints(19, 4).forEach(function (i) { assert.strictEqual(s.board[i], 1); });
  var r = mustPlay(s, 10, 10);
  assert.strictEqual(at(r.state, 10, 10), 2);
  // explicit toPlay wins
  assert.strictEqual(G.createGame(19, { handicap: 2, toPlay: 1 }).toPlay, 1);
});

test('setup accepts indices and SGF strings, toPlay accepts B/W', function () {
  var s = G.createGame(19, { setup: { black: ['pd', 0], white: ['dp'] }, toPlay: 'W' });
  assert.strictEqual(s.board[G.sgfToPoint('pd', 19)], 1);
  assert.strictEqual(s.board[0], 1);
  assert.strictEqual(s.board[G.sgfToPoint('dp', 19)], 2);
  assert.strictEqual(s.toPlay, 2);
});

test('sgf point conversion', function () {
  assert.strictEqual(G.sgfToPoint('ab', 19), 19);
  assert.strictEqual(G.pointToSgf(19, 19), 'ab');
  assert.strictEqual(G.sgfToPoint('pd', 19), 3 * 19 + 15);
  assert.strictEqual(G.pointToSgf(3 * 19 + 15, 19), 'pd');
  assert.strictEqual(G.sgfToPoint('tt', 19), -1);
  assert.strictEqual(G.sgfToPoint('', 19), -1);
  assert.strictEqual(G.sgfToPoint('jj', 9), -1);
});

// Finished 9x9: black wall on column 3, white wall on column 5, dame on column 4,
// one dead white stone at (1,1) inside black's area.
var FINISHED = [
  '. . . X . O . . .',
  '. O . X . O . . .',
  '. . . X . O . . .',
  '. . . X . O . . .',
  '. . . X . O . . .',
  '. . . X . O . . .',
  '. . . X . O . . .',
  '. . . X . O . . .',
  '. . . X . O . . .'
];

test('score: finished 9x9 with a dead stone', function () {
  var s = diagram(FINISHED, { komi: 6.5 });
  var dead = new Set([1 * 9 + 1]);
  var sc = G.score(s, dead);
  // Black: 27 points of area (26 empty + the dead stone's point) + 1 prisoner.
  assert.strictEqual(sc.black, 28);
  // White: 27 territory + 6.5 komi.
  assert.strictEqual(sc.white, 33.5);
  assert.strictEqual(sc.winner, 2);
  assert.strictEqual(sc.margin, 5.5);
  assert.strictEqual(sc.territory[1 * 9 + 1], 1);
  assert.strictEqual(sc.territory[0], 1);
  assert.strictEqual(sc.territory[4], 0, 'dame is neutral');
  assert.strictEqual(sc.territory[8], 2);
  assert.deepStrictEqual(sc.breakdown.black, { territory: 27, captures: 0, dead: 1 });

  // Without marking the stone dead, black's region touches white and is neutral.
  var sc2 = G.score(s);
  assert.strictEqual(sc2.black, 0);
  assert.strictEqual(sc2.white, 33.5);

  // Captures count; dead may be passed as an array.
  var withCaps = Object.assign({}, s, { captures: { 1: 3, 2: 1 } });
  var sc3 = G.score(withCaps, [10]);
  assert.strictEqual(sc3.black, 31);
  assert.strictEqual(sc3.white, 34.5);

  // Equal score -> jigo.
  var even = Object.assign({}, s, { komi: 1 });
  var sc4 = G.score(even, dead);
  assert.strictEqual(sc4.winner, 0);
  assert.strictEqual(sc4.margin, 0);
});

test('estimateDead finds the dead stone and keeps the walls alive', function () {
  var s = diagram(FINISHED, { komi: 6.5 });
  var dead = G.estimateDead(s);
  assert.deepStrictEqual(Array.from(dead), [10]);
  assert.strictEqual(G.estimateDead(G.createGame(9)).size, 0);
});

test('estimateDead: invasion stones inside a 13x13 framework', function () {
  var s = diagram([
    '. . . . . . X O . . . . .',
    '. . . . . . X O . . . . .',
    '. . O . . . X O . . . . .',
    '. . O O . . X O . . X . .',
    '. . . . . . X O . . . . .',
    '. . . . . . X O . . . . .',
    'X X X X X X X O . . . . .',
    'O O O O O O O O . . . . .',
    '. . . . . . . . . . . . .',
    '. . . . . . . . . . . . .',
    '. . . . . . . . . . . . .',
    '. . . . . . . . . . . . .',
    '. . . . . . . . . . . . .'
  ]);
  var dead = G.estimateDead(s);
  var expected = ['cc', 'cd', 'dd', 'kd'].map(function (p) { return G.sgfToPoint(p, 13); }).sort(function (a, b) { return a - b; });
  assert.deepStrictEqual(Array.from(dead).sort(function (a, b) { return a - b; }), expected);
});

test('estimateDead: two-eyed group lives, one-eyed and lone stones die', function () {
  var s = diagram([
    '. . . . O . O . .', // white group with two eyes (5,0) and (7,0)-(8,0): alive
    '. . . . O O O O O',
    'X X X X X X X X X',
    '. . . . . . . . .',
    '. . . . . O . . .', // lone white stone in black's area: dead
    '. . . . . . . . .',
    'X X X . . . . . .',
    'O O X . . . . . .', // one-eyed white corner group: dead
    '. O X . . . . . .'
  ]);
  var dead = Array.from(G.estimateDead(s)).sort(function (a, b) { return a - b; });
  var expected = [4 * 9 + 5, 7 * 9 + 0, 7 * 9 + 1, 8 * 9 + 1];
  assert.deepStrictEqual(dead, expected);
});

test('estimateDead leaves an open mid-game position alone', function () {
  var s = G.replay(G.createGame(19), [{ x: 3, y: 3 }, { x: 15, y: 15 }, { x: 15, y: 3 }, { x: 3, y: 15 }, { x: 9, y: 9 }]);
  assert.strictEqual(G.estimateDead(s).size, 0);
});

test('parseSGF: whitespace, escapes, multi-values, compressed lists, variations', function () {
  var text = '  (;GM[1]FF[4] SZ[9]\n  AB[aa:bb][cc]\n AW [ee]\n C[a \\] b \\\\ c]\n' +
    '  (;B[dd]C[main];W[ef]\n(;B[gg])(;B[hh]))\n  (;B[ff]))\n(;SZ[19])';
  var root = G.parseSGF(text);
  assert.deepStrictEqual(root.props.GM, ['1']);
  assert.deepStrictEqual(root.props.SZ, ['9']);
  assert.deepStrictEqual(root.props.AB, ['aa', 'ba', 'ab', 'bb', 'cc']);
  assert.deepStrictEqual(root.props.AW, ['ee']);
  assert.deepStrictEqual(root.props.C, ['a ] b \\ c']);
  assert.strictEqual(root.children.length, 2);
  var main = root.children[0];
  assert.deepStrictEqual(main.props.B, ['dd']);
  assert.deepStrictEqual(main.props.C, ['main']);
  assert.strictEqual(main.children.length, 1);
  var w = main.children[0];
  assert.deepStrictEqual(w.props.W, ['ef']);
  assert.strictEqual(w.children.length, 2);
  assert.deepStrictEqual(w.children[0].props.B, ['gg']);
  assert.deepStrictEqual(w.children[1].props.B, ['hh']);
  assert.deepStrictEqual(root.children[1].props.B, ['ff']);
  assert.strictEqual(root.children[1].children.length, 0);
});

test('parseSGF: FF3 long identifiers, soft line breaks, errors', function () {
  var root = G.parseSGF('(;AddBlack[aa][bb]Comment[line\\\none];B[cc])');
  assert.deepStrictEqual(root.props.AB, ['aa', 'bb']);
  assert.deepStrictEqual(root.props.C, ['lineone']);
  assert.deepStrictEqual(root.children[0].props.B, ['cc']);
  assert.throws(function () { G.parseSGF('no tree here'); });
});

test('toSGF round-trip', function () {
  var s = G.createGame(9, { handicap: 2, komi: 0.5 });
  s = G.replay(s, [
    { x: 4, y: 4 }, { x: 3, y: 4 }, { x: 5, y: 5 }, { x: 4, y: 3 }, { x: 4, y: 5 },
    { x: 5, y: 4 }, { x: 0, y: 0 }, { pass: true }, { x: 1, y: 1 }
  ]);
  var meta = { black: 'Alice', white: 'Bob [3d]', result: 'W+R', date: '2026-10-25' };
  var text = G.toSGF(s, meta);
  var root = G.parseSGF(text);
  assert.deepStrictEqual(root.props.SZ, ['9']);
  assert.deepStrictEqual(root.props.KM, ['0.5']);
  assert.deepStrictEqual(root.props.HA, ['2']);
  assert.deepStrictEqual(root.props.AB.slice().sort(), ['cg', 'gc']);
  assert.deepStrictEqual(root.props.PB, ['Alice']);
  assert.deepStrictEqual(root.props.PW, ['Bob [3d]']);
  assert.deepStrictEqual(root.props.RE, ['W+R']);
  assert.deepStrictEqual(root.props.PL, ['W']);
  assert.deepStrictEqual(root.children[0].props.W, ['ee']);

  var back = G.fromSGF(text);
  assert.deepStrictEqual(Array.from(back.state.board), Array.from(s.board));
  assert.deepStrictEqual(back.state.moves, s.moves);
  assert.deepStrictEqual(back.state.captures, s.captures);
  assert.strictEqual(back.state.toPlay, s.toPlay);
  assert.strictEqual(back.state.komi, 0.5);
  assert.strictEqual(back.state.handicap, 2);
  assert.strictEqual(back.meta.black, 'Alice');
  assert.strictEqual(back.meta.white, 'Bob [3d]');
  // and a second export is identical
  assert.strictEqual(G.toSGF(back.state, meta), text);
});

test('toSGF for a problem-style setup position', function () {
  var s = G.createGame(19, { setup: { black: ['pd', 'qc'], white: ['qd'] }, toPlay: 'W' });
  var root = G.parseSGF(G.toSGF(s));
  assert.deepStrictEqual(root.props.AB.slice().sort(), ['pd', 'qc']);
  assert.deepStrictEqual(root.props.AW, ['qd']);
  assert.deepStrictEqual(root.props.PL, ['W']);
  assert.strictEqual(root.props.HA, undefined);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
