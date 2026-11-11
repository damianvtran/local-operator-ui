#!/usr/bin/env python3
"""Round-2 independent verification for the hi tool-row verb batch (L1).

Read-only. Reads:
  _l1-prep/keys.json     English source + context/notes
  _l1-prep/hi.json       round-1 translation (v1)
  _l1-prep/hi.v2.json    revised translation under audit (v2)
  _l1-prep/hi.v2-changes.md   disposition table
  shipped hi catalogues in the worktree (precedent + evidence re-verification)

Run with ~/local-operator/.venv/bin/python so rich.cells.cell_len is the same
width function the TUI budgets with.
"""
import json, os, re, sys, unicodedata
from rich.cells import cell_len

BASE = os.path.expanduser("~/local-operator-ui/.worktrees/_l1-prep")
WT = os.path.expanduser("~/local-operator-ui/.worktrees/i18n-l1-tool-verbs")
keys = json.load(open(f"{BASE}/keys.json"))
v1 = json.load(open(f"{BASE}/hi.json"))
v2 = json.load(open(f"{BASE}/hi.v2.json"))
en_cat = json.load(open(f"{WT}/src/i18n/catalogues/en/ui.chat.canonical.json"))
CAT = f"{WT}/src/i18n/catalogues/hi"
def cat(name):
    return json.load(open(f"{CAT}/{name}.json"))

ok = True
def check(name, cond, detail=""):
    global ok
    ok = ok and bool(cond)
    print(f"[{'PASS' if cond else 'FAIL'}] {name}{(': ' + detail) if detail else ''}")

print("== A. structure ==")
check("key count 182", len(v2) == 182, str(len(v2)))
check("key set equal to keys.json", set(v2) == set(keys))
check("key order equal to keys.json", list(v2) == list(keys))
check("no empty/whitespace-only values", all(str(v).strip() for v in v2.values()))
check("no leading/trailing/double space", all(v == v.strip() and "  " not in v for v in v2.values()))
check("no terminal punctuation", not any(re.search(r"[.!?।,;:]\s*$", v) for v in v2.values()))
check("no placeholders in source or target",
      not any(re.search(r"[{}%]", v) for v in v2.values()) and
      not any(re.search(r"[{}%]", v.get("en", "")) for v in keys.values()))
check("no bidi/zero-width controls",
      not any(re.search(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b\u200c\u200d\ufeff]", v) for v in v2.values()))
latin = {k: re.findall(r"[A-Za-z][A-Za-z0-9_.\-]*", v) for k, v in v2.items() if re.search(r"[A-Za-z]", v)}
check("Latin only as the technology name Python",
      all(t == ["Python"] for t in latin.values()), str(latin))
check("source English matches merged en catalogue", all(en_cat.get(k) == keys[k]["en"] for k in keys))
# raw-text duplicate-key scan (check-duplicates.mjs premise: JSON.parse hides them)
def dup_keys(raw):
    stack, out, i = [], [], 0
    keypat = re.compile(r'"((?:[^"\\]|\\.)*)"\s*:')
    depth = 0
    for m in re.finditer(r'"(?:[^"\\]|\\.)*"|[{}]', raw):
        tok = m.group(0)
        if tok == "{": depth += 1; stack.append(set())
        elif tok == "}": depth -= 1; stack.pop()
        elif depth and raw[m.end():].lstrip().startswith(":"):
            k = tok[1:-1]
            if k in stack[-1]: out.append(k)
            stack[-1].add(k)
    return out
for f in ("hi.json", "hi.v2.json"):
    raw = open(f"{BASE}/{f}", encoding="utf-8").read()
    check(f"{f}: no duplicate keys in raw text", not dup_keys(raw), str(dup_keys(raw)))
    check(f"{f}: valid JSON", bool(json.loads(raw)))

print("\n== B. settled/running pairs ==")
suf = lambda k: k.split("tool_row.verb.")[1]
pairs = {}
for k in v2:
    base, form = suf(k).rsplit(".", 1)
    pairs.setdefault(base, {})[form] = v2[k]
check("91 pairs, every base has both forms",
      len(pairs) == 91 and all(set(d) == {"settled", "running"} for d in pairs.values()),
      f"{len(pairs)} bases")
no_hai = {b: d["running"] for b, d in pairs.items() if not d["running"].rstrip().endswith("है")}
check("every running form is a complete present progressive (ends है)", not no_hai, str(no_hai))
bare_te = {b: d["running"] for b, d in pairs.items() if d["running"].rstrip().endswith("ते")}
check("no bare -ते participle running form", not bare_te, str(bare_te))
# same verb root in both halves.
# HEURISTIC, stated as such: Hindi perfective and imperfective of one verb differ
# in ending (चलाया / चला रहा है), so exact word equality is the wrong test. This
# compares 2-character word prefixes: it catches a genuine stem mismatch (one
# half about deleting, the other about reading) and cannot prove sharedness.
def words(s):
    return [w for w in re.findall(r"[\u0900-\u097F]+", s)]
suspicious = []
for b, d in pairs.items():
    st, ru = d["settled"], d["running"]
    if not any(a[:2] == c[:2] for a in words(st) for c in words(ru)):
        suspicious.append((b, st, ru))
check("every pair shares a verb root (2-char word prefix, heuristic)", not suspicious, str(suspicious))

print("\n== C. same concept, one name ==")
groups = {
    "list/सूचीबद्ध": [k for k in v2 if "listed" in suf(k)],
    "secret": [k for k in v2 if "secret" in suf(k)],
    "console": [k for k in v2 if "console" in suf(k)],
    "network": [k for k in v2 if "network" in suf(k)],
    "session": [k for k in v2 if "session" in suf(k)],
    "agent": [k for k in v2 if "agent" in suf(k)],
    "team": [k for k in v2 if "team" in suf(k)],
    "project": [k for k in v2 if "project" in suf(k)],
    "todos": [k for k in v2 if "todos" in suf(k)],
    "job": [k for k in v2 if "job" in suf(k)],
    "wake": [k for k in v2 if "wake" in suf(k)],
    "variable": [k for k in v2 if "variable" in suf(k)],
    "milestone": [k for k in v2 if "milestone" in suf(k)],
    "device": [k for k in v2 if "device" in suf(k)],
    "symbol/definition/reference": [k for k in v2 if re.search(r"symbol|definition|reference", suf(k))],
}
for g, ks in groups.items():
    print(f"  -- {g} ({len(ks)})")
    for k in ks:
        print(f"     {suf(k):34s} {v2[k]}")

print("\n== D. width (rich.cells.cell_len; verb column shrink-0, never truncates) ==")
rows = sorted(((cell_len(v), len(v.split()), suf(k), v) for k, v in v2.items()), reverse=True)
for c, w, k, v in rows[:12]:
    print(f"   {c:3d}c {w}w {k:34s} {v}")
print(f"   over 32 cells: {[ (k,v) for c,w,k,v in rows if c>32 ]}")
print(f"   over 5 words: {[ (k,v) for c,w,k,v in rows if w>5 ]}")
bridge = {k: v for k, v in cat("ui.chat.canonical").items() if "bridge.verb" in k}
print(f"   shipped bridge verb max cells: {max(cell_len(v) for v in bridge.values())} "
      f"({max(bridge.values(), key=cell_len)!r})")
print(f"   v2 max cells: {rows[0][0]}  ({rows[0][3]!r})")
print(f"   v2 median/mean: {sorted(c for c,*_ in rows)[len(rows)//2]} / {sum(c for c,*_ in rows)/len(rows):.1f}")

print("\n== E. shipped-term evidence (re-verified here, not taken from the note) ==")
def uses(c, term):
    return [(k, v) for k, v in c.items() if isinstance(v, str) and term in v]
for term, name in [("पीयर", "ui.mesh"), ("साथी", "ui.mesh"),
                   ("माइलस्टोन", "ui.projects"), ("पड़ाव", "ui.projects"),
                   ("वेरिएबल", "ui.canvas"), ("चर", "ui.canvas"),
                   ("स्क्रीनशॉट", "ui.onboarding.tour"), ("छवि", "ui.onboarding.tour"),
                   ("नाम-बदलाव", "ui.chat.canonical"), ("नाम-परिवर्तन", "ui.chat.canonical"),
                   ("निदान", "ui.chat.canonical"), ("पैनिक", "ui.chat.canonical"),
                   ("आपात", "ui.chat.canonical"), ("जॉब्स", "ui.chat.canonical"),
                   ("सूचीबद्ध", "ui.chat.canonical"), ("जागृतियाँ", "ui.chat.canonical"),
                   ("उप-एजेंट", "ui.chat.canonical")]:
    hits = uses(cat(name), term)
    print(f"   {name}: {term} -> {len(hits)} values {[k for k,_ in hits][:4]}")
# shipped exact-concept strings cited by the note
for name, key in [("ui.chat.canonical", "fold.count.secret")]:
    c = cat(name)
    hit = {k: v for k, v in c.items() if key in k}
    print(f"   {name} *{key}*: {hit}")
# जॉब्स precedents across ALL shipped hi catalogues
import glob
hits = []
for p in glob.glob(f"{CAT}/*.json"):
    d = json.load(open(p))
    for k, v in d.items():
        if isinstance(v, str) and "जॉब्स" in v:
            hits.append((os.path.basename(p), k, v))
print(f"   जॉब्स precedents across shipped hi catalogues: {len(hits)} {hits}")
br = {k: v for k, v in cat("ui.chat.canonical").items() if "bridge.verb" in k and k.endswith(".running")}
print(f"   bridge.verb.*.running: {len(br)} strings, ends-है {sum(1 for v in br.values() if v.rstrip().endswith('है'))}")
print(f"   shipped janky obliques in chat canon: टीमों ->{len(uses(cat('ui.chat.canonical'),'टीमों'))} "
      f"प्रोजेक्टों ->{len(uses(cat('ui.chat.canonical'),'प्रोजेक्टों'))} "
      f"सत्रों ->{len(uses(cat('ui.chat.canonical'),'सत्रों'))}")
print("\nRESULT:", "mechanical checks passed" if ok else "mechanical checks FAILED")
sys.exit(0 if ok else 1)
