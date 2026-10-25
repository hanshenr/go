#!/usr/bin/env python3
"""Polite fetcher for Sensei's Library Beginner Exercises.

Downloads each exercise page, its /Solution page and every diagram SGF those
pages link to, caching everything under tools/cache/ so reruns never refetch.

Usage: python3 -I tools/fetch_sensei.py [first] [last]   (default 1 346)
"""
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://senseis.xmp.net/"
UA = "GoProblemsBundler/1.0 (personal offline problem collection; polite, cached)"
DELAY = 0.4
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")

_last = [0.0]


class Blocked(Exception):
    pass


def get(url):
    wait = DELAY - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": BASE})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            _last[0] = time.time()
            if b'<div id="captcha">' in data:
                raise Blocked(url)
            return data
        except urllib.error.HTTPError as e:
            _last[0] = time.time()
            if e.code == 404:
                return None
            time.sleep(2 + attempt * 3)
        except urllib.error.URLError:
            time.sleep(2 + attempt * 3)
    raise RuntimeError("failed: " + url)


def cached(path, url):
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    data = get(url)
    if data is None:
        data = b""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return data


def page(name):
    fname = name.replace("/", "__") + ".html"
    return cached(os.path.join(CACHE, "pages", fname),
                  BASE + "?" + urllib.parse.quote(name, safe=""))


DIAG_RE = re.compile(rb'href="diagrams/(\d+)/([0-9a-f]{32})\.sgf"')


def diagrams(html):
    for d, h in DIAG_RE.findall(html):
        d, h = d.decode(), h.decode()
        cached(os.path.join(CACHE, "diagrams", d, h + ".sgf"),
               "%sdiagrams/%s/%s.sgf" % (BASE, d, h))


def main():
    first = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    last = int(sys.argv[2]) if len(sys.argv) > 2 else 346
    for n in range(first, last + 1):
        name = "BeginnerExercise%d" % n
        try:
            html = page(name)
            diagrams(html)
            sol = page(name + "/Solution")
            diagrams(sol)
        except Blocked as e:
            print("BLOCKED at", e, file=sys.stderr)
            sys.exit(2)
        print(n, len(html), len(sol), flush=True)


if __name__ == "__main__":
    main()
