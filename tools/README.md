# tools/ — building `site/problems.js`

`site/problems.js` holds the first 300 usable problems of Sensei's Library
**Beginner Exercises** series (https://senseis.xmp.net/?BeginnerExercises,
pages `BeginnerExercise1` … `BeginnerExercise346`), baked in as
`window.GO_PROBLEMS` in the format described in `SPEC.md`.

```sh
python3 -I tools/fetch_sensei.py 1 346   # polite download into tools/cache/ (skips cached files)
python3 -I tools/build_problems.py       # cache -> site/problems.js + tools/build_report.json
node tools/validate_problems.js          # independent check (uses site/go-engine.js when present)
```

## Fetching (`fetch_sensei.py`)
- Sequential requests, 0.4 s apart, custom User-Agent, retries with back-off; stops if
  Sensei's ever answers with its captcha / access-blocked page.
- For each exercise it downloads the exercise page, its `/Solution` sub-page and every
  diagram's SGF (`diagrams/NN/<hash>.sgf`: every rendered diagram has one). Those SGFs
  already place the stones on the full board and list the numbered moves with `MN[]`,
  so no ASCII-diagram parsing is needed.
- Everything is cached in `tools/cache/` (git-ignored, ~13 MB). Downloaded content is
  only parsed with regexes, never executed.

## Converting (`build_problems.py`)
- **Position**: the exercise page's (single) diagram: `AB`/`AW` stones, `PL` = side to
  play, `SZ` = board size (all 19 in this series; fragments are already placed in the
  right corner by Sensei's). If the problem diagram itself shows numbered moves (e.g.
  "How should Black respond to W1?"), they are applied to the position.
- **Prompt**: the diagram caption, prefixed with "Black/White to play" when the caption
  names no colour, plus the first goal-like sentence from the page text when the
  caption has no goal.
- **Solution tree**: every diagram on the `/Solution` page is a candidate line.
  A diagram is attached where its setup stones equal a known position (the problem, or a
  position reached by an earlier line) with the right side to move, compared inside the
  problem area (bounding box + 2). Its numbered moves are replayed (captures, suicide and
  simple ko checked); the line is cut at a colour/numbering gap ("4 at 1", "B3 elsewhere").
  Diagrams with a different (hypothetical) setup are ignored.
- **Labels** (correct / wrong), in priority order:
  1. the diagram caption ("Solution", "Correct", "Failure", "Wrong", "Black kills",
     "White lives", "Alternative" …; who succeeds decides it);
  2. the section header (`== Solution ==`, `== Failure ==` …), unless the diagram's
     text says it fails;
  3. text words such as "fails", "mistake", "not enough", "doesn't work";
  4. a later static diagram captioned e.g. "Failure" labels the line it shows the end of;
  5. continuation diagrams inherit the label of the line they continue;
  6. if nothing on the page is labelled correct, the first line from the problem
     position is taken as the answer;
  7. unlabelled lines that leave a correct line at an *opponent* move become
     alternative opponent replies (correct).
  Unlabelled lines that branch at a player move are dropped.
- **Tree**: correct lines first (so the opponent's auto-reply, the first child, follows
  the main solution); leaves of correct lines get `ok: 1`. Wrong lines are kept only if
  they branch off at a player move (a wrong line that branches at an opponent move would
  contradict a correct line, and nothing is hung below an `ok` leaf). `c` = caption +
  the text after the diagram, ≤200 chars.
- Each problem is validated (on-board, no overlap, all moves legal, at least one reachable
  `ok` leaf when the opponent always plays the first child). Failing problems are skipped
  and the next exercise in the series is used.

## Result
- **300 problems** = Beginner Exercises 1–325 minus 25 skipped exercises; ids 1..300 follow the series order.
- Skipped (25):
  - 6, 13, 190: the exercise page holds several sub-problems.
  - 19, 101, 103, 104, 108, 110, 121, 134, 168, 174, 184, 187, 201, 212, 227, 235, 241, 249, 252, 320: no move answer could be identified (status-only answers such as "White is dead as it stands", trick questions whose answer is "no", problems asking what should have been played instead of a move already shown, or solution pages that open with a failure and never label a solution).
  - 313, 323: no /Solution page exists.
- 36 problems rely on the "first line shown is the answer" fallback (no caption/header names a solution): exercises 1, 9, 17, 24, 25, 30, 32, 59, 64, 67, 88, 94, 102, 106, 114, 115, 117, 118, 123, 142, 144, 162, 181, 200, 205, 207, 217, 222, 224, 234, 260, 280, 293, 307, 308, 321. These were spot-checked but are the least certain.
- Caveats: only moves drawn in diagrams are in the tree. When the text mentions an alternative ("B1 at a also works"), that alternative counts as wrong. Some lines end where a diagram stops numbering ("W9 at W1"). Prompts and comments may mention diagram letters (a, b) or marked stones. Those marks are exported in an optional `marks` field (`circle`/`square`/`triangle`/`cross` point lists, `labels` {point: text}) for the UI to draw if it wants. The full per-run list is in `tools/build_report.json`.
