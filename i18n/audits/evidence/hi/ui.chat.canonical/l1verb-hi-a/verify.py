#!/usr/bin/env python3
"""Independent mechanical verification for the hi tool-row verb batch (L1).

Read-only: reads the staged batch (keys.json = English source + context/notes,
hi.json = translation) and the shipped hi catalogue, and prints one check per
line. Written by the auditor (i18n-auditor, l1-au-hi-A) so the audit.log beside
it can be regenerated instead of trusted.
"""
import json, os, re, sys, unicodedata

BASE = os.path.expanduser("~/local-operator-ui/.worktrees/_l1-prep")
WT = os.path.expanduser("~/local-operator-ui/.worktrees/i18n-l1-tool-verbs")
keys = json.load(open(f"{BASE}/keys.json"))
hi = json.load(open(f"{BASE}/hi.json"))
en_cat = json.load(open(f"{WT}/src/i18n/catalogues/en/ui.chat.canonical.json"))
hi_cat = json.load(open(f"{WT}/src/i18n/catalogues/hi/ui.chat.canonical.json"))

ok = True
def check(name, cond, detail=""):
    global ok
    ok = ok and bool(cond)
    print(f"[{'PASS' if cond else 'FAIL'}] {name}{(': ' + detail) if detail else ''}")

check("key count 182", len(keys) == 182, str(len(keys)))
check("key set equal", set(keys) == set(hi))
check("key order equal", list(keys) == list(hi))
check("no empty/whitespace-only values", all(str(v).strip() for v in hi.values()))
check("no leading/trailing space or double space", all(v == v.strip() and "  " not in v for v in hi.values()))
check("no terminal punctuation", not any(re.search(r"[.!?।,;:]", v) for v in hi.values()))
check("no placeholders in source or target",
      not any(re.search(r"[{}]", v) for v in hi.values()) and
      not any(re.search(r"[{}]", v.get("en", "")) for v in keys.values()))
check("no bidi/zero-width controls", not any(re.search(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b\u200c\u200d]", v) for v in hi.values()))
latin = [(k, re.findall(r"[A-Za-z][A-Za-z0-9_.\-]*", v)) for k, v in hi.items() if re.search(r"[A-Za-z]", v)]
check("Latin only as the technology name Python", all(t == ["Python"] for _, t in latin), str([(k.split("verb.")[1], t) for k, t in latin]))
dups = {}
for k, v in hi.items():
    dups.setdefault(v, set()).add(keys[k]["en"])
collide = {v: e for v, e in dups.items() if len(e) > 1}
check("no identical hi value for two different English", not collide, str(collide))
check("all values 1-4 words", all(1 <= len(v.split()) <= 4 for v in hi.values()),
      str(sorted({len(v.split()) for v in hi.values()})))
check("source English matches the merged en catalogue",
      all(en_cat.get(k) == keys[k]["en"] for k in keys))

# already-shipped copies the batch must agree with
mesh, proj, canvas, tour = (json.load(open(f"{WT}/src/i18n/catalogues/hi/{f}")) for f in
                            ["ui.mesh.json", "ui.projects.json", "ui.canvas.json", "ui.onboarding.tour.json"])
def uses(cat, term):
    return sum(1 for v in cat.values() if isinstance(v, str) and term in v)
print("\n-- shipped-term evidence (ha, informational) --")
for term, cat, nm in [("पीयर", mesh, "ui.mesh"), ("साथी", mesh, "ui.mesh"),
                      ("माइलस्टोन", proj, "ui.projects"), ("पड़ाव", proj, "ui.projects"),
                      ("वेरिएबल", canvas, "ui.canvas"), ("चर", canvas, "ui.canvas"),
                      ("स्क्रीनशॉट", tour, "ui.onboarding.tour")]:
    print(f"   {nm}: {term} -> {uses(cat, term)} values")

print("\n-- running forms (must be complete present progressive) --")
run = {k.split("tool_row.verb.")[1]: v for k, v in hi.items() if k.endswith(".running")}
no_hai = {k: v for k, v in run.items() if "है" not in v}
bare_te = {k: v for k, v in no_hai.items() if v.strip().endswith("ते")}
print(f"   running keys: {len(run)}")
print(f"   without है: {len(no_hai)}  (bare -ते: {len(bare_te)}, dangling रहा: {len(no_hai) - len(bare_te)})")
print(f"   shipped bridge.verb running forms carrying है: "
      f"{sum(1 for k, v in hi_cat.items() if 'bridge.verb' in k and k.endswith('.running') and 'है' in v)}/"
      f"{sum(1 for k, v in hi_cat.items() if 'bridge.verb' in k and k.endswith('.running'))}")

print("\n-- width estimate (base glyphs; combining matras counted 0) --")
MARKS = set(range(0x0900, 0x0904)) | set(range(0x093A, 0x0941)) | set(range(0x0944, 0x0949)) | \
        set(range(0x094D, 0x0950)) | set(range(0x0951, 0x0958)) | {0x0962, 0x0963}
def cells(s):
    return sum(1 for c in s if ord(c) not in MARKS and not unicodedata.combining(c))
top = sorted(((cells(v), k, v) for k, v in hi.items()), reverse=True)[:5]
for c, k, v in top:
    print(f"   {c:3d} {k.split('tool_row.verb.')[1]:32s} {v}")
print(f"   shipped max (bridge verbs): {max(cells(v) for k, v in hi_cat.items() if 'bridge.verb' in k)}")

print("\nRESULT:", "mechanical checks passed" if ok else "mechanical checks FAILED")
sys.exit(0 if ok else 1)
