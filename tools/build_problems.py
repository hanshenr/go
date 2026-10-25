#!/usr/bin/env python3
"""Convert cached Sensei's Library Beginner Exercises into site/problems.js.

Reads only tools/cache/ (run fetch_sensei.py first). Downloaded pages are
treated as untrusted data: they are parsed with regexes, never executed.

Usage: python3 -I tools/build_problems.py [--count 300] [--debug N]
"""
import html as htmllib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "..", "site", "problems.js")
REPORT = os.path.join(HERE, "build_report.json")
SERIES_MAX = 346

OTHER = {"B": "W", "W": "B"}


# ---------------------------------------------------------------- SGF

def sgf_unescape(v):
    return re.sub(r"\\(.)", r"\1", v, flags=re.S)


def parse_sgf(text):
    """Parse the flat SGF Sensei's emits for diagrams: one root, a main line."""
    nodes = []
    i, n = 0, len(text)
    cur = None
    while i < n:
        ch = text[i]
        if ch == ";":
            cur = {}
            nodes.append(cur)
            i += 1
        elif ch.isupper():
            m = re.compile(r"[A-Z]+").match(text, i)
            key = m.group(0)
            i = m.end()
            vals = []
            while True:
                while i < n and text[i] in " \t\r\n":
                    i += 1
                if i < n and text[i] == "[":
                    j = i + 1
                    buf = []
                    while j < n and text[j] != "]":
                        if text[j] == "\\" and j + 1 < n:
                            buf.append(text[j:j + 2])
                            j += 2
                        else:
                            buf.append(text[j])
                            j += 1
                    vals.append(sgf_unescape("".join(buf)))
                    i = j + 1
                else:
                    break
            if cur is not None:
                cur.setdefault(key, []).extend(vals)
        else:
            i += 1
    return nodes


def marks_of(root, size):
    ok = lambda p: len(p) == 2 and all(0 <= ord(ch) - 97 < size for ch in p)
    out = {}
    for key, name in (("CR", "circle"), ("SQ", "square"), ("TR", "triangle"), ("MA", "cross")):
        pts = sorted(p for p in root.get(key, []) if ok(p))
        if pts:
            out[name] = pts
    labels = {}
    for v in root.get("LB", []):
        p, _, t = v.partition(":")
        if ok(p) and t.strip():
            labels[p] = t.strip()[:3]
    if labels:
        out["labels"] = labels
    return out


def load_diagram(rel):
    path = os.path.join(CACHE, "diagrams", rel + ".sgf")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as f:
        nodes = parse_sgf(f.read())
    if not nodes:
        return None
    root = nodes[0]
    size = int(root.get("SZ", ["19"])[0].split(":")[0])
    moves = []
    for nd in nodes[1:]:
        for c in ("B", "W"):
            if c in nd:
                mn = int(nd["MN"][0]) if "MN" in nd and nd["MN"][0].isdigit() else None
                moves.append((c, nd[c][0], mn))
    return {
        "size": size,
        "pl": (root.get("PL") or [None])[0],
        "B": [p for p in root.get("AB", []) if len(p) == 2],
        "W": [p for p in root.get("AW", []) if len(p) == 2],
        "moves": moves,
        "marks": marks_of(root, size),
        "gn": re.sub(r"\[([^\]|]*\|)?([^\]]*)\]", r"\2", (root.get("GN") or [""])[0]).strip(),
    }


# ---------------------------------------------------------------- board

class Board:
    def __init__(self, size, stones=None, ko=None):
        self.size = size
        self.s = dict(stones or {})
        self.ko = ko  # point the next player may not play (simple ko)

    def copy(self):
        return Board(self.size, self.s, self.ko)

    def key(self, region=None):
        return "".join(sorted(p + c for p, c in self.s.items()
                              if region is None or p in region))

    def on(self, p):
        return (len(p) == 2 and 0 <= ord(p[0]) - 97 < self.size
                and 0 <= ord(p[1]) - 97 < self.size)

    def nbrs(self, p):
        x, y = ord(p[0]) - 97, ord(p[1]) - 97
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < self.size and 0 <= ny < self.size:
                yield chr(97 + nx) + chr(97 + ny)

    def group(self, p):
        c = self.s[p]
        seen, stack, libs = {p}, [p], set()
        while stack:
            q = stack.pop()
            for r in self.nbrs(q):
                v = self.s.get(r)
                if v is None:
                    libs.add(r)
                elif v == c and r not in seen:
                    seen.add(r)
                    stack.append(r)
        return seen, libs

    def play(self, c, p):
        """Return the captured stones, or None if the move is illegal."""
        if not self.on(p) or p in self.s or p == self.ko:
            return None
        self.s[p] = c
        dead = []
        for r in self.nbrs(p):
            if self.s.get(r) == OTHER[c]:
                g, libs = self.group(r)
                if not libs:
                    dead.extend(g)
        for q in set(dead):
            del self.s[q]
        g, libs = self.group(p)
        if not libs:
            del self.s[p]
            return None
        dead = sorted(set(dead))
        self.ko = dead[0] if len(dead) == 1 and len(g) == 1 and len(libs) == 1 else None
        return dead


def board_from(d):
    st = {p: "B" for p in d["B"]}
    st.update({p: "W" for p in d["W"]})
    return Board(d["size"], st)


# ---------------------------------------------------------------- HTML

def text_of(fragment):
    s = re.sub(r"<img[^>]*alt='([^']*)'[^>]*>", lambda m: " " + clean_alt(m.group(1)) + " ", fragment)
    s = re.sub(r"</?(?:a|em|strong|b|i|span|small|u|tt|code)\b[^>]*>", "", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = htmllib.unescape(s)
    s = re.sub(r"\[\s*edit\s*\]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r" ([,.;:!?)])", r"\1", s)
    s = re.sub(r"\( ", "(", s)
    return s


def clean_alt(alt):
    # stone icons: 'B1', 'W2', 'black+square', 'circle' ...
    m = re.match(r"^([BW])(\d+)$", alt)
    if m:
        return alt
    if re.search(r"circle|square|triangle|cross|mark", alt):
        return "marked"
    return "(" + alt.replace("+", " ") + ")"


TOKEN_RE = re.compile(
    r"(?P<h><h(?P<lvl>[2-6])>(?P<htext>.*?)</h(?P=lvl)>)"
    r"|(?P<d><div class='diagram'.*?</div>)", re.S)


def parse_page(raw):
    """-> list of ('h', level, text) and ('d', diagram_rel, caption, text_after)."""
    start = raw.find('<div id="pageheaders">')
    start = raw.find('<div class="contentsize">', start if start >= 0 else 0)
    end = raw.find('<br clear="all">', start)
    body = raw[start:end if end > 0 else len(raw)]
    # drop the footer navigation ("Back to Beginner Exercises / Go to ...")
    body = re.sub(r"<ul><li>\s*<strong>Back to.*", "", body, flags=re.S)
    events = []
    pos = 0
    for m in TOKEN_RE.finditer(body):
        between = text_of(body[pos:m.start()])
        if between and events and events[-1][0] == "d" and not events[-1][3]:
            events[-1] = events[-1][:3] + (between,)
        pos = m.end()
        if m.group("h"):
            events.append(("h", int(m.group("lvl")), text_of(m.group("htext"))))
        else:
            dm = re.search(r'href="diagrams/(\d+)/([0-9a-f]{32})\.sgf"', m.group("d"))
            if not dm:
                continue
            cm = re.search(r"<form[^>]*>(.*?)<input", m.group("d"), re.S)
            cap = text_of(cm.group(1)) if cm else ""
            events.append(("d", dm.group(1) + "/" + dm.group(2), cap, ""))
    tail = text_of(body[pos:])
    if tail and events and events[-1][0] == "d" and not events[-1][3]:
        events[-1] = events[-1][:3] + (tail,)
    return events


def read_page(name):
    path = os.path.join(CACHE, "pages", name.replace("/", "__") + ".html")
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return f.read().decode("latin-1")


# ---------------------------------------------------------------- classification

WRONG_RE = re.compile(
    r"\b(fail\w*|wrong|incorrect|mistakes?|mistaken|bad|refut\w*|not work|doesn'?t work|"
    r"does not work|won'?t work|not enough|too slow|insufficient|misguided|unsuccessful|"
    r"error|blunder|tempting|trap|not the (?:answer|solution)|no good|not good|misstep|greedy|"
    r"premature|overplay|hasty|careless|naive|useless|pointless|futile|defeated|does not help|doesn'?t help)\b", re.I)
CORRECT_RE = re.compile(
    r"\b(solution|solved|correct|right|success\w*|answer|best|proper|kills?|lives?|"
    r"captures?|connects?|escapes?|wins?)\b", re.I)
NEUTRAL_HDR_RE = re.compile(
    r"\b(discussion|additional|comment|note|question|introduction|analysis|"
    r"background|aside|other ways|appendix|see also)\b", re.I)
STRONG_CORRECT_RE = re.compile(r"\b(solution|solved|correct|right|success\w*|answer)\b", re.I)
ALT_RE = re.compile(r"\b(alternative|also (?:correct|works|kills|lives)|another (?:solution|way))\b", re.I)


def classify_caption(cap, to_play):
    if not cap:
        return None
    me = "Black" if to_play == "B" else "White"
    opp = "White" if to_play == "B" else "Black"
    good = r"(?:kills?|lives?|captures?|wins?|escapes?|connects?|succeeds?|is alive|survives?)"
    bad = r"(?:fails?|dies|is dead|is captured|is killed|loses?)"
    # who succeeds decides it: "White dies" in a Black problem is a success for Black
    if re.search(r"\b%s (?:(?:still|also|simply|just|now|then|easily|unconditionally|can) )?%s\b" % (opp, bad), cap, re.I) or \
            re.search(r"\b%s (?:(?:still|also|simply|just|now|then|easily|unconditionally|can) )?%s\b" % (me, good), cap, re.I):
        if not WRONG_RE.search(re.sub(r"\b%s (?:(?:still|also|simply|just|now|then|easily|unconditionally|can) )?%s\b" % (opp, bad), "", cap, flags=re.I)):
            return "correct"
    if re.search(r"\b%s (?:(?:still|also|simply|just|now|then|easily|unconditionally|can) )?%s\b" % (opp, good), cap, re.I) or \
            re.search(r"\b%s (?:(?:still|also|simply|just|now|then|easily|unconditionally|can) )?%s\b" % (me, bad), cap, re.I):
        return "wrong"
    if WRONG_RE.search(cap):
        return "wrong"
    if STRONG_CORRECT_RE.search(cap) or ALT_RE.search(cap):
        return "correct"
    return None


def classify_header(h):
    if not h:
        return None
    w, c = bool(WRONG_RE.search(h)), bool(STRONG_CORRECT_RE.search(h))
    if w and not c:
        return "wrong"
    if c and not w:
        return "correct"
    if NEUTRAL_HDR_RE.search(h):
        return "neutral"
    return None


def classify_text(t, to_play):
    if not t:
        return None
    first = re.split(r"(?<=[.!?])\s", t, maxsplit=3)
    head = " ".join(first[:3])
    if WRONG_RE.search(head) or re.match(r"No\b[.,!]", t):
        return "wrong"
    me = "Black" if to_play == "B" else "White"
    opp = "White" if to_play == "B" else "Black"
    if re.search(r"\b(?:so |and |then )?%s (?:still |simply |easily )?(?:lives|escapes|survives|is alive)\b" % opp,
                 first[0]) or \
            re.search(r"\b%s (?:dies|is dead|fails)\b" % me, first[0]):
        return "wrong"
    return None


# ---------------------------------------------------------------- tree

def _ancestors(n):
    out = []
    while n is not None:
        out.append(n)
        n = n.parent
    return out


class Node:
    __slots__ = ("m", "color", "children", "parent", "board", "c", "labels", "depth")

    def __init__(self, m, color, parent, board):
        self.m, self.color, self.parent, self.board = m, color, parent, board
        self.children = []
        self.c = None
        self.labels = set()
        self.depth = parent.depth + 1 if parent is not None else 0

    def path(self):
        out, n = [], self
        while n.parent is not None:
            out.append(n)
            n = n.parent
        return out[::-1]


def trim(s, limit=200):
    s = s.strip()
    if len(s) <= limit:
        return s
    cut = s[:limit]
    k = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if k >= 60:
        return cut[:k + 1]
    return cut[:limit - 1].rstrip() + "…"


def clean_line_moves(moves):
    """Keep the prefix with alternating colours and consecutive move numbers."""
    out = []
    for i, (c, p, mn) in enumerate(moves):
        if not p or p == "tt":
            break
        if out:
            pc, _, pmn = out[-1]
            if c == pc:
                break
            if mn is not None and pmn is not None and mn != pmn + 1:
                break
        out.append((c, p, mn))
    return out


def build_problem(n):
    name = "BeginnerExercise%d" % n
    praw, sraw = read_page(name), read_page(name + "/Solution")
    if not praw:
        return None, "problem page missing"
    if not sraw:
        return None, "solution page missing"
    pev = [e for e in parse_page(praw) if e[0] == "d"]
    if not pev:
        return None, "no problem diagram"
    pd = load_diagram(pev[0][1])
    if pd is None:
        return None, "problem diagram sgf missing"
    keys = set()
    for e in pev:
        d = load_diagram(e[1])
        if d and (d["B"] or d["W"]):
            keys.add(board_from(d).key())
    if len(keys) > 1:
        return None, "problem page has several distinct positions"
    board = board_from(pd)
    if not board.s:
        return None, "empty problem diagram"
    to_play = pd["pl"]
    cap = pev[0][2] or pd["gn"]
    # the caption wins when it names the mover and disagrees with the diagram header
    m = re.match(r"\s*(Black|White) (?:to (?:play|move|live|kill|capture|save|connect|cut|win)|first|plays)\b",
                 cap, re.I)
    if m:
        to_play = m.group(1)[0].upper()
    elif to_play not in ("B", "W"):
        to_play = "B"
    # A problem diagram may already show some moves ("How should Black answer W1?").
    # Solution diagrams then usually repeat them from the bare position, so keep the
    # bare position as a pre-root whose only path leads through those moves to the root.
    # Solution diagrams sometimes carry unrelated stones elsewhere on the board, so
    # positions are compared only inside the problem's area (bounding box + 2).
    pts = list(board.s) + [p for _, p, _ in clean_line_moves(pd["moves"])]
    xs = [ord(p[0]) - 97 for p in pts]
    ys = [ord(p[1]) - 97 for p in pts]
    region = {chr(97 + x) + chr(97 + y)
              for x in range(max(0, min(xs) - 2), min(board.size, max(xs) + 3))
              for y in range(max(0, min(ys) - 2), min(board.size, max(ys) + 3))}
    pre = Node(None, None, None, board)
    index = {}
    node = pre
    for c, p, _ in clean_line_moves(pd["moves"]):
        index.setdefault((node.board.key(region), c), node)
        b2 = node.board.copy()
        if b2.play(c, p) is None:
            return None, "problem diagram moves illegal"
        nxt = Node(p, c, node, b2)
        node.children.append(nxt)
        node = nxt
        to_play = OTHER[c]
    root = node
    root.parent = None
    board = root.board
    index[(board.key(region), to_play)] = root
    prompt = make_prompt(cap, pev[0][3], to_play)
    lines = []         # (end_node, label, origin)
    statics = []       # (node, label)
    headers = {}
    events = parse_page(sraw)
    for ev in events:
        if ev[0] == "h":
            lvl = ev[1]
            headers = {k: v for k, v in headers.items() if k < lvl}
            headers[lvl] = ev[2]
            continue
        _, rel, cap_html, text = ev
        d = load_diagram(rel)
        if d is None or d["size"] != board.size:
            continue
        caption = cap_html or d["gn"]
        hdr = None
        for lvl in sorted(headers, reverse=True):
            hdr = classify_header(headers[lvl])
            if hdr:
                break
        lab_cap = classify_caption(caption, to_play)
        lab_txt = classify_text(text, to_play)
        setup = board_from(d)
        moves = clean_line_moves(d["moves"])
        if not moves:
            start = index.get((setup.key(region), to_play)) or index.get((setup.key(region), OTHER[to_play]))
            if start is not None and start is not root and lab_cap:
                statics.append((start, lab_cap))
            continue
        start = index.get((setup.key(region), moves[0][0]))
        if start is None:
            continue
        mn0 = moves[0][2]
        if mn0 not in (None, 1, start.depth + 1):
            continue  # numbering skips moves (e.g. "B3 and W4 elsewhere")
        node = start
        b = start.board
        for c, p, _ in moves:
            if p not in region:
                break
            nxt = next((ch for ch in node.children if ch.m == p), None)
            if nxt is None:
                b2 = b.copy()
                if b2.play(c, p) is None:
                    break
                nxt = Node(p, c, node, b2)
                node.children.append(nxt)
                index.setdefault((b2.key(region), OTHER[c]), nxt)
            node, b = nxt, nxt.board
        if node is start or root not in _ancestors(node):
            continue
        comment = trim(": ".join(x for x in (caption, text) if x)) or None
        if comment and node.c is None:
            node.c = comment
        lines.append({"end": node, "start": start, "cap": lab_cap, "hdr": hdr,
                      "txt": lab_txt, "caption": caption})

    # ---- label lines
    for ln in lines:
        lab = ln["cap"]
        if lab is None and ln["hdr"] in ("correct", "wrong"):
            lab = ln["hdr"]
            if lab == "correct" and ln["txt"] == "wrong":
                lab = None   # header says solution, text says it fails
        if lab is None and ln["hdr"] != "neutral" and ln["txt"] == "wrong":
            lab = "wrong"
        ln["label"] = lab
    # a static diagram captioned failure/correct labels the line ending there
    for node, lab in statics:
        for ln in lines:
            if ln["end"] is node and ln["label"] is None:
                ln["label"] = lab
    # unlabelled continuations inherit from the line they continue
    for ln in lines:
        if ln["label"] is None and ln["start"] is not root:
            for prev in lines:
                if prev is ln:
                    break
                if prev["label"] and ln["start"] in prev["end"].path():
                    ln["label"] = prev["label"]
                    break
    if not any(ln["label"] == "correct" for ln in lines):
        # fall back: first line from the root (not explicitly wrong) is the answer
        # (only when that is the first line shown at all: if the page opens with a
        # failure and never names a solution, the answer is too unclear to use)
        first = next((ln for ln in lines if ln["start"] is root), None)
        if first is not None and first["label"] is None:
            first["label"] = "correct"
    # unlabelled lines that leave the correct paths at an opponent move show the
    # opponent's alternative replies to the correct answer
    changed = True
    while changed:
        changed = False
        on_c = set()
        for ln in lines:
            if ln["label"] == "correct":
                on_c.update(ln["end"].path())
        for ln in lines:
            if ln["label"] is None:
                p = ln["end"].path()
                div = next((x for x in p if x not in on_c), None)
                if (div is not None and div.color != to_play and div.parent in on_c
                        and any(ch in on_c for ch in div.parent.children)):
                    ln["label"] = "correct"
                    changed = True
    correct = [ln for ln in lines if ln["label"] == "correct"]
    if not correct:
        return None, "no correct line found"

    # ---- assemble the final tree
    on_correct = set()
    ok_leaves = set()
    for ln in correct:
        p = ln["end"].path()
        on_correct.update(p)
    for ln in correct:
        end = ln["end"]
        if not any(ch in on_correct for ch in end.children):
            ok_leaves.add(end)
    keep = set(on_correct)
    for ln in lines:
        if ln["label"] != "wrong":
            continue
        p = ln["end"].path()
        div = next((i for i, x in enumerate(p) if x not in on_correct), None)
        if div is None:
            continue
        d0 = p[div]
        if d0.color != to_play:
            continue  # opponent refutes a "correct" line: contradictory, skip
        parent = d0.parent
        if parent in ok_leaves:
            continue
        keep.update(p[div:])

    def emit(node):
        kids = [ch for ch in node.children if ch in keep]
        kids.sort(key=lambda ch: 0 if ch in on_correct else 1)
        out = {"m": node.m}
        if node in ok_leaves and not [k for k in kids if k in on_correct]:
            out["ok"] = 1
        if node.c:
            out["c"] = node.c
        ch = [emit(k) for k in kids]
        if ch:
            out["children"] = ch
        return out

    solution = [emit(ch) for ch in sorted([c for c in root.children if c in keep],
                                          key=lambda ch: 0 if ch in on_correct else 1)]
    black = sorted(p for p, c in board.s.items() if c == "B")
    white = sorted(p for p, c in board.s.items() if c == "W")
    prob = {
        "title": "Beginner Exercise %d" % n,
        "source": "Sensei's Library",
        "url": "https://senseis.xmp.net/?" + name,
        "level": "beginner",
        "size": board.size,
        "toPlay": to_play,
        "black": black,
        "white": white,
        "prompt": prompt,
        "solution": solution,
    }
    if pd["marks"]:
        prob["marks"] = pd["marks"]  # optional extra: markup shown on the source diagram
    stats = {"lines": len(lines), "correct": len(correct),
             "wrong": sum(1 for ln in lines if ln["label"] == "wrong"),
             "dropped": sum(1 for ln in lines if ln["label"] is None),
             "fallback": not any(ln["cap"] == "correct" or ln["hdr"] == "correct" for ln in correct)}
    return (prob, stats), None


GOAL_RE = re.compile(r"\b(live|lives|living|kill|kills|capture|save|rescue|connect|cut|escape|"
                     r"seki|ko|result|status|best|win|semeai|race|eye|eyes|dead|death|alive|"
                     r"atari|ladder|net|separate|prevent|attack|defend|tesuji)\b", re.I)


def make_prompt(cap, text, to_play):
    who = "Black" if to_play == "B" else "White"
    cap = (cap or "").strip().rstrip(".")
    if not cap:
        cap = who + " to play"
    elif not re.search(r"\b(black|white)\b", cap, re.I):
        cap = who + " to play. " + cap
    sep = " " if cap[-1] in "?!:" else ". "
    if not GOAL_RE.search(cap) and text:
        for sent in re.split(r"(?<=[.!?])\s+", text):
            sent = sent.strip()
            sent = re.sub(r"^[^A-Za-z]*(?:\w{0,3}\)+\s*)?", "", sent)
            if (sent and GOAL_RE.search(sent) and len(sent) <= 120
                    and (sent.endswith("?") or re.match(
                        r"(Kill|Live|Save|Capture|Connect|Cut|Find|Make|Rescue|Escape|Win|Can|How|What)\b",
                        sent))
                    and not re.match(r"(Knowledge|Hint|See|Solution|Source|Note)", sent, re.I)
                    and "/Solution" not in sent):
                return cap + sep + sent
    return cap


# ---------------------------------------------------------------- main

def validate(p):
    """Replay the whole tree; returns an error string or None."""
    b = Board(p["size"], {**{x: "B" for x in p["black"]}, **{x: "W" for x in p["white"]}})
    if len(b.s) != len(p["black"]) + len(p["white"]):
        return "overlapping stones"
    if any(not b.on(x) for x in b.s):
        return "stone off board"
    found_ok = [False]

    def walk(nodes, board, color, depth):
        for i, nd in enumerate(nodes):
            b2 = board.copy()
            if b2.play(color, nd["m"]) is None:
                return "illegal move %s by %s" % (nd["m"], color)
            if nd.get("ok"):
                found_ok[0] = True
            err = walk(nd.get("children", []), b2, OTHER[color], depth + 1)
            if err:
                return err
        return None

    err = walk(p["solution"], b, p["toPlay"], 0)
    if err:
        return err
    if not found_ok[0]:
        return "no ok line"
    # following the auto-response (first child) from every correct first move must
    # be able to reach an ok terminal
    def reachable(nd, player_node):
        kids = nd.get("children", [])
        if not kids:
            return bool(nd.get("ok"))
        if player_node:
            return reachable(kids[0], False)
        return any(reachable(k, True) for k in kids)
    if not any(reachable(nd, True) for nd in p["solution"]):
        return "no reachable success"
    return None


def main():
    count = 300
    debug = None
    args = sys.argv[1:]
    if "--count" in args:
        count = int(args[args.index("--count") + 1])
    if "--debug" in args:
        debug = int(args[args.index("--debug") + 1])
    if debug:
        res, why = build_problem(debug)
        print(json.dumps(res[0] if res else why, indent=1))
        if res:
            print(res[1], validate(res[0]))
        return
    probs, skipped, stats = [], [], {}
    for n in range(1, SERIES_MAX + 1):
        if len(probs) >= count:
            break
        res, why = build_problem(n)
        if res:
            err = validate(res[0])
            if err:
                why = "validation: " + err
                res = None
        if not res:
            skipped.append({"n": n, "reason": why})
            continue
        p, st = res
        p = {"id": len(probs) + 1, **p}
        probs.append(p)
        stats[n] = st
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/build_problems.py from Sensei's Library Beginner Exercises\n")
        f.write("// (https://senseis.xmp.net/?BeginnerExercises). Do not edit by hand.\n")
        f.write("window.GO_PROBLEMS = [\n")
        f.write(",\n".join(json.dumps(p, ensure_ascii=False, separators=(",", ":")) for p in probs))
        f.write("\n];\n")
    with open(REPORT, "w") as f:
        json.dump({"count": len(probs), "last_exercise": max(stats) if stats else None,
                   "skipped": skipped,
                   "fallback_answer": [n for n, s in stats.items() if s["fallback"]]},
                  f, indent=1)
    print("problems:", len(probs), "skipped:", len(skipped))
    for s in skipped:
        print("  skip", s["n"], s["reason"])


if __name__ == "__main__":
    main()
