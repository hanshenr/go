# Go — spec shared by all three builders

A Go board game published as a **Superset page** (directory publish of `site/`).
Two people open the same page link and play each other. Also local hot-seat play
and ~300 Sensei's Library problems that can be solved or used as a starting position.

## Hosting constraints (Superset page CSP — hard rules)
- No `fetch`/XHR/WebSocket. No `eval`/`new Function`. No remote `<script src>`.
- Directory publish: `site/index.html` is the page; `site/*.js`, `site/*.css` load by relative path.
- Plain browser JS, no build step, no modules (`<script src="x.js">` classic scripts; expose globals).
- Fonts: Google Fonts `<link>` is allowed.
- Shared multiplayer state: `window.superset.storage` (see "Online play"). It may be absent
  (file:// preview) — the page must still work for local + problems.

## Files and owners
| File | Owner |
| --- | --- |
| `site/go-engine.js` | Agent ENGINE |
| `site/test/engine.test.js` (node) | Agent ENGINE |
| `site/problems.js` (+ any scripts in `tools/`) | Agent PROBLEMS |
| `site/index.html`, `site/app.js`, `site/style.css` | Agent UI |

Do not edit files you don't own. If you need something from another owner, code
against the API below exactly.

## `site/go-engine.js` — exposes `window.GoEngine` (and `module.exports` under node)
Coordinates: `x` = column 0..size-1 left→right, `y` = row 0..size-1 top→bottom.
Index `i = y*size + x`. Colors: `0` empty, `1` black, `2` white. SGF point "ab" = x=0 ('a'), y=1 ('b').

```js
GoEngine.createGame(size, { komi = 6.5, handicap = 0, setup = { black: [i...], white: [i...] }, toPlay = 1 } = {})
  -> state
// state (treat as immutable; every op returns a new one):
// { size, komi, board: Int8Array(size*size), toPlay: 1|2, captures: {1: n, 2: n},
//   ko: index|-1, lastMove: index|-1|'pass', moveNumber, consecutivePasses, positions: Set<string> (for superko),
//   moves: [{color, i}|{color, pass:true}] }
GoEngine.play(state, x, y)      -> { ok: true, state, captured: [i...] } | { ok: false, reason: 'occupied'|'suicide'|'ko'|'offboard' }
GoEngine.pass(state)            -> state
GoEngine.replay(baseState, moves) -> state   // moves: [{x,y}|{pass:true}], illegal moves are skipped
GoEngine.isLegal(state, x, y)   -> boolean
GoEngine.groupAt(state, i)      -> { stones: [i...], liberties: [i...], color }
GoEngine.score(state, dead = new Set()) -> { black, white, territory: Int8Array /*0 none,1 B,2 W*/, winner: 1|2|0, margin }
  // Japanese-style territory scoring: territory + captures + dead stones captured; white gets komi.
GoEngine.estimateDead(state)    -> Set<i>  // simple heuristic (groups with <=1 liberty-region / weak groups); fine to be naive
GoEngine.handicapPoints(size, n) -> [i...]  // standard star-point handicap placement (n 2..9)
GoEngine.starPoints(size)       -> [i...]  // hoshi for 9/13/19
GoEngine.sgfToPoint(str, size) -> i ; GoEngine.pointToSgf(i, size) -> "pd"
GoEngine.parseSGF(text)         -> root node { props: {KEY: [values]}, children: [node] }
GoEngine.toSGF(state, meta)     -> string  // export a game record
```
Rules: captures, suicide illegal, simple ko + positional superko via `positions`.

## `site/problems.js` — `window.GO_PROBLEMS = [ ... ]` (300 entries, ordered)
```js
{
  id: 1,                       // 1..300 in order
  title: "Beginner Exercise 1",
  source: "Sensei's Library",
  url: "https://senseis.xmp.net/?BeginnerExercise1",
  level: "beginner",          // beginner | intermediate | ... as the source labels it
  size: 19,                    // board size the diagram lives on (diagram fragments → place in a corner of 19x19 or use the diagram's own size if it is a full small board)
  toPlay: "B" | "W",
  black: ["pd", ...],          // SGF coords of initial stones
  white: ["qc", ...],
  prompt: "Black to play and live",   // short text from the source
  solution: [                  // tree; first level are moves by toPlay
    { m: "qb", ok: 1, c: "Correct — ...", children: [ { m: "rb", children: [...] } ] },
    { m: "ra", c: "Wrong — white captures", children: [ ... ] }
  ]
}
```
Solution semantics: player plays `toPlay`; opponent auto-responds with the first child.
A line ends in success when it reaches a node with `ok: 1` that has no player-move children left
(i.e. `ok` marks a correct terminal). Reaching a leaf without `ok`, or playing a move not in
the tree, = wrong. Every problem must have at least one `ok` line. `c` is optional commentary.

## UI (`index.html`, `app.js`, `style.css`)
Modes (tabs or a segmented control at the top):
1. **Play online** (needs `window.superset.storage`) — lobby + games.
2. **Play local** — hot-seat on one device.
3. **Problems** — browse/search the 300, solve them, or "Play from this position" (local or online).

Board: 9×9, 13×13, 19×19 selectable on new game. Komi default 6.5 (selectable), optional handicap.
Rendered with SVG or canvas, wooden board, star points, coordinates, last-move marker,
hover ghost stone, captures count, pass, resign, undo (local), scoring with click-to-toggle dead stones.
Problems: crop the view to the problem's bounding region (+2 margin, snap to edges).

### Online play via `window.superset.storage` (one slot per person per key)
`store.set(key, value)` writes MY slot; `store.getAll(key)` → `[{userId, name, value, updatedAt}]`;
`store.subscribe(key, cb)`; `store.viewer = {userId, name}`. Values JSON ≤ 64 KiB.

- Key `lobby`: each user's slot = `{ games: [{ id, size, komi, handicap, setup?, createdAt, status: 'open'|'playing'|'done' }] }`
  (games that user created). Lobby view = union over `getAll('lobby')`.
- Key `game:<id>`: each participant's slot =
  `{ color: 'B'|'W', moves: [{x,y}|{pass:true}|{resign:true}], dead: [i...], acceptScore: boolean, undoRequest?: n, undoAccept?: n, chat?: [...] }`
  Creator writes color 'B' at creation (game params live in the lobby entry; may let creator choose to be W).
  Joiner writes the other color. First joiner wins the seat; others spectate.
- The game record is DERIVED: black's moves are moves 0,2,4…, white's are 1,3,5… (for handicap
  games white moves first — use `toPlay` from the state). It's my turn iff the merged length says so.
  Never store a running counter; always recompute from both slots.
- Game over on two consecutive passes (→ scoring phase: each side toggles dead stones, both press Accept
  with identical `dead` sets → final) or resign.
- Must render read-only and explain itself when storage is unavailable.
