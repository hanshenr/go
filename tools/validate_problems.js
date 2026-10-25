#!/usr/bin/env node
// Validates site/problems.js against the SPEC: ids, coords, no overlapping
// stones, every solution move legal when replayed, and at least one reachable
// ok line when the opponent auto-responds with the first child.
// Uses site/go-engine.js when it exists, otherwise a small built-in board.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'site', 'problems.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
const problems = sandbox.window.GO_PROBLEMS;

let Engine = null;
try { Engine = require('../site/go-engine.js'); } catch (e) { Engine = null; }

function miniPlay(board, size, color, p) {
  const at = (x, y) => board[y * size + x];
  const x0 = p.charCodeAt(0) - 97, y0 = p.charCodeAt(1) - 97;
  if (x0 < 0 || y0 < 0 || x0 >= size || y0 >= size) return null;
  if (at(x0, y0)) return null;
  const b = board.slice();
  b[y0 * size + x0] = color;
  const nb = (i) => {
    const x = i % size, y = (i - x) / size, out = [];
    if (x > 0) out.push(i - 1); if (x < size - 1) out.push(i + 1);
    if (y > 0) out.push(i - size); if (y < size - 1) out.push(i + size);
    return out;
  };
  const group = (i) => {
    const c = b[i], seen = new Set([i]), st = [i]; let libs = 0;
    while (st.length) { const q = st.pop(); for (const r of nb(q)) { if (!b[r]) libs++; else if (b[r] === c && !seen.has(r)) { seen.add(r); st.push(r); } } }
    return { stones: [...seen], libs };
  };
  const i0 = y0 * size + x0;
  for (const r of nb(i0)) if (b[r] === 3 - color) { const g = group(r); if (!g.libs) g.stones.forEach((s) => { b[s] = 0; }); }
  if (!group(i0).libs) return null;
  return b;
}

function makeStart(p) {
  const idx = (s) => (s.charCodeAt(1) - 97) * p.size + (s.charCodeAt(0) - 97);
  const toPlay = p.toPlay === 'B' ? 1 : 2;
  if (Engine) {
    const st = Engine.createGame(p.size, { komi: 0, setup: { black: p.black.map(idx), white: p.white.map(idx) }, toPlay });
    return {
      st,
      play(state, m) {
        const r = Engine.play(state, m.charCodeAt(0) - 97, m.charCodeAt(1) - 97);
        return r.ok ? r.state : null;
      },
    };
  }
  const b = new Array(p.size * p.size).fill(0);
  p.black.forEach((s) => { b[idx(s)] = 1; });
  p.white.forEach((s) => { b[idx(s)] = 2; });
  return {
    st: { b, color: toPlay },
    play(state, m) {
      const nb = miniPlay(state.b, p.size, state.color, m);
      return nb ? { b: nb, color: 3 - state.color } : null;
    },
  };
}

const errors = [];
const okCoord = (s, size) => typeof s === 'string' && /^[a-s]{2}$/.test(s) &&
  s.charCodeAt(0) - 97 < size && s.charCodeAt(1) - 97 < size;

if (!Array.isArray(problems) || problems.length !== 300) errors.push('expected 300 problems, got ' + (problems && problems.length));
let bytes = fs.statSync(file).size;
problems.forEach((p, k) => {
  const tag = '#' + p.id + ' ' + p.title + ': ';
  if (p.id !== k + 1) errors.push(tag + 'bad id');
  for (const f of ['title', 'source', 'url', 'level', 'prompt']) if (typeof p[f] !== 'string' || !p[f]) errors.push(tag + 'missing ' + f);
  if (![9, 13, 19].includes(p.size) && !(p.size >= 5 && p.size <= 19)) errors.push(tag + 'bad size');
  if (p.toPlay !== 'B' && p.toPlay !== 'W') errors.push(tag + 'bad toPlay');
  const all = p.black.concat(p.white);
  if (all.some((s) => !okCoord(s, p.size))) errors.push(tag + 'stone off board');
  if (new Set(all).size !== all.length) errors.push(tag + 'overlapping stones');
  if (!all.length) errors.push(tag + 'no stones');
  const eng = makeStart(p);
  let anyOk = false;
  const walk = (nodes, state, depth) => {
    for (const n of nodes) {
      if (!okCoord(n.m, p.size)) { errors.push(tag + 'bad move ' + n.m); return; }
      const s2 = eng.play(state, n.m);
      if (!s2) { errors.push(tag + 'illegal move ' + n.m + ' at depth ' + depth); return; }
      if (n.ok) anyOk = true;
      if (n.c && n.c.length > 200) errors.push(tag + 'comment too long');
      walk(n.children || [], s2, depth + 1);
    }
  };
  walk(p.solution, eng.st, 0);
  if (!anyOk) errors.push(tag + 'no ok line');
  // the player can reach success when the opponent always answers with the first child
  const reach = (n, playerNode) => {
    const kids = n.children || [];
    if (!kids.length) return !!n.ok;
    return playerNode ? reach(kids[0], false) : kids.some((k) => reach(k, true));
  };
  if (!p.solution.some((n) => reach(n, true))) errors.push(tag + 'no reachable success');
});

console.log('engine:', Engine ? 'site/go-engine.js' : 'built-in');
console.log('problems:', problems.length, 'file bytes:', bytes);
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('all valid');
