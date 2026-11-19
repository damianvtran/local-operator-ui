#!/usr/bin/env python3
"""Mechanical checks for the hi / ui.library delta audit (instance 5d845498f5c6).

Read-only over the frozen worktree. Reproduces, in one run, the mechanical lane
of the audit: expected-hash binding, JSON validity, key-set parity with English,
additions-only diff against the base, placeholder/ICU neutrality, invisible and
bidi character scan, and badge-slot width measurement.

Run:  python3 hi-ds-5d845498f5c6-check.py
Exit: 0 = every mechanical check passed; 1 = a check failed.
"""
import json
import hashlib
import subprocess
import sys
import unicodedata

WT = "/Users/damian/local-operator-ui/.worktrees/i18n-s8"
AUD = "/Users/damian/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23"
BASE = "0e12072d2b3"
NS = "ui.library"
LOCALE = "hi"

NEW_KEYS = [
    "ui.library.kind.audio", "ui.library.kind.code", "ui.library.kind.docx",
    "ui.library.kind.html", "ui.library.kind.image", "ui.library.kind.markdown",
    "ui.library.kind.other", "ui.library.kind.pdf", "ui.library.kind.pptx",
    "ui.library.kind.spreadsheet", "ui.library.kind.text", "ui.library.kind.video",
    "ui.library.tag_category.custom", "ui.library.tag_category.format",
    "ui.library.tag_category.project", "ui.library.tag_category.source",
    "ui.library.tag_category.status", "ui.library.tag_category.topic",
    "ui.library.tag_category.type",
    "ui.library.preview.unsupported_generic",
]

fails = []


def fail(msg):
    fails.append(msg)
    print("FAIL " + msg)


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def cells(text):
    """Wide-glyph cell length; Devanagari is narrow here, per the hi style guide."""
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in text)


# 1. hash binding -----------------------------------------------------------
exp = json.load(open(f"{AUD}/expected-hashes.json"))
if exp["head"] != "8a9ce1f808c266ebe9a0e924094344cea60c2c23":
    fail("expected-hashes.json head is not the frozen head")
pairs = {
    f"{LOCALE}/{NS}": f"{WT}/src/i18n/catalogues/{LOCALE}/{NS}.json",
    f"en/{NS}": f"{WT}/src/i18n/catalogues/en/{NS}.json",
    f"en/{NS}.context": f"{WT}/src/i18n/catalogues/en/{NS}.context.json",
}
print("== hash binding (recomputed here vs expected-hashes.json) ==")
for label, path in pairs.items():
    actual = sha(path)
    want = exp["hashes"].get(label)
    ok = actual == want
    print(f"{label:22s} {actual}  {'OK' if ok else 'MISMATCH (expected ' + str(want) + ')'}")
    if not ok:
        fail(f"{label} sha256 mismatch")
glossary = sha(f"{AUD}/glossary.md")
if glossary != "0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8":
    fail("binding glossary is not the 0eb34437 byte-copy")
print(f"glossary.md            {glossary}  (bound 0eb34437…)")

# 2. JSON validity and key-set parity --------------------------------------
print("== JSON validity and key-set parity ==")
en = json.load(open(pairs[f"en/{NS}"]))
hi = json.load(open(pairs[f"{LOCALE}/{NS}"]))
ctx = json.load(open(pairs[f"en/{NS}.context"]))
base = json.loads(subprocess.run(
    ["git", "-C", WT, "show", f"{BASE}:src/i18n/catalogues/{LOCALE}/{NS}.json"],
    capture_output=True, text=True, check=True).stdout)
print(f"en keys={len(en)} hi keys={len(hi)} context keys={len(ctx)} base hi keys={len(base)}")
if set(en) != set(hi):
    fail(f"key sets differ: missing={sorted(set(en) - set(hi))} extra={sorted(set(hi) - set(en))}")
if set(ctx) != set(en):
    fail("context sidecar key set differs from the English catalogue")
for k in NEW_KEYS:
    if k not in hi:
        fail(f"new key absent from hi: {k}")
    if k not in en:
        fail(f"new key absent from en: {k}")
added = set(hi) - set(base)
removed = set(base) - set(hi)
print(f"added vs {BASE}: {len(added)}  removed: {len(removed)}")
if added != set(NEW_KEYS) or removed:
    fail(f"delta is not exactly the 20 new keys: added_only={sorted(added - set(NEW_KEYS))} removed={sorted(removed)}")
changed = [k for k in base if k in hi and hi[k] != base[k]]
print(f"legacy values changed vs base: {len(changed)} {sorted(changed)}")
if changed:
    fail(f"legacy values changed: {sorted(changed)}")

# 3. placeholder / ICU neutrality and typography ----------------------------
print("== placeholder / ICU / typography ==")
for k in NEW_KEYS:
    v = hi[k]
    if "{" in v or "}" in v:
        fail(f"{k} carries a brace/placeholder it should not: {v!r}")
    if "'" in v or '"' in v or "\u201c" in v or "\u201d" in v:
        fail(f"{k} carries quotes: {v!r}")
    if k != "ui.library.preview.unsupported_generic" and v.rstrip()[-1:] in ("।", "."):
        fail(f"{k} is a label but ends with sentence punctuation: {v!r}")
print("no braces, no quotes; the only sentence-final danda is on unsupported_generic")

# 4. invisible / bidi / spacing characters ----------------------------------
print("== invisible, bidi and spacing characters ==")
BAD_CATS = ("Cf", "Zs", "Cc", "Zl", "Zp")
for k in NEW_KEYS:
    v = hi[k]
    hits = [f"U+{ord(c):04X} {unicodedata.name(c, '?')}" for c in v
            if unicodedata.category(c) in BAD_CATS and c != " "]
    if hits:
        fail(f"{k} has invisible/spacing characters: {hits}")
    if v != v.strip() or "  " in v:
        fail(f"{k} has stray whitespace: {v!r}")
    bidi = [f"U+{ord(c):04X}" for c in v if unicodedata.bidirectional(c) in ("R", "AL", "RLE", "LRE", "RLO", "LRO", "PDF", "RLI", "LRI", "FSI", "PDI")]
    if bidi:
        fail(f"{k} has bidi controls: {bidi}")
print("no NBSP, ZW*, bidi control or stray whitespace in any of the 20 values")

# 5. badge-slot width -------------------------------------------------------
print("== width (cells vs the ~12-cell badge/rail slot named in the context sidecar) ==")
for k in NEW_KEYS:
    if k == "ui.library.preview.unsupported_generic":
        continue
    n = cells(hi[k])
    flag = "OVER" if n > 12 else "ok"
    print(f"{k:42s} {hi[k]:14s} cells={n:2d} {flag}")
    if n > 12:
        fail(f"{k} exceeds the 12-cell slot: {n} cells")
print(f"unsupported_generic cells={cells(hi['ui.library.preview.unsupported_generic'])} "
      f"(en {len(en['ui.library.preview.unsupported_generic'])} chars)")

# 6. no kind name inside the standalone generic sentence -------------------
generic = hi["ui.library.preview.unsupported_generic"]
print("== standalone sentence names no kind ==")
for k in NEW_KEYS:
    if not k.startswith("ui.library.kind."):
        continue
    label = hi[k]
    if label and label in generic:
        fail(f"generic sentence names a kind via {k}: {generic!r}")
print(f"{generic!r} names no kind label")

print()
if fails:
    print(f"RESULT: {len(fails)} mechanical failure(s)")
    sys.exit(1)
print("RESULT: all mechanical checks passed")
sys.exit(0)
