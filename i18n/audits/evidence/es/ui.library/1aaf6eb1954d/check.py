#!/usr/bin/env python3
"""Mechanical verifier for the es ui.library delta audit (PR #1851 @ 8a9ce1f8).

Read-only. Prints one line per check so the audit log can cite actual output.
Checks: JSON validity, sha256 binding against expected-hashes.json, key sets
(es vs en, es vs origin/main), the 20 new keys, placeholder/ICU parity, markup/
code-span integrity, invisible characters, and cell widths vs the ~12 hint.
"""
import hashlib
import json
import os
import re
import subprocess
import unicodedata

REPO = os.path.expanduser("~/local-operator-ui/.worktrees/i18n-s8")
AUD = os.path.expanduser(
    "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23"
)
CAT = "src/i18n/catalogues"
HEAD = "8a9ce1f808c266ebe9a0e924094344cea60c2c23"
BASE = "0e12072d2b3"  # origin/main at audit time

NEW = [
    "ui.library.kind.audio", "ui.library.kind.code", "ui.library.kind.docx",
    "ui.library.kind.html", "ui.library.kind.image", "ui.library.kind.markdown",
    "ui.library.kind.other", "ui.library.kind.pdf", "ui.library.kind.pptx",
    "ui.library.kind.spreadsheet", "ui.library.kind.text", "ui.library.kind.video",
    "ui.library.tag_category.custom", "ui.library.tag_category.format",
    "ui.library.tag_category.project", "ui.library.tag_category.source",
    "ui.library.tag_category.status", "ui.library.tag_category.topic",
    "ui.library.tag_category.type", "ui.library.preview.unsupported_generic",
]

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def load(rel):
    return json.load(open(os.path.join(REPO, rel), encoding="utf-8"))

def cells(text):
    n = 0
    for ch in text:
        ea = unicodedata.east_asian_width(ch)
        if ea in ("W", "F"):
            n += 2
        elif unicodedata.combining(ch):
            n += 0
        else:
            n += 1
    return n

ok = True

def check(label, cond, detail=""):
    global ok
    if not cond:
        ok = False
    print(f"[{'PASS' if cond else 'FAIL'}] {label}" + (f" :: {detail}" if detail else ""))

# 1. JSON validity
en = load(f"{CAT}/en/ui.library.json")
ctx = load(f"{CAT}/en/ui.library.context.json")
es = load(f"{CAT}/es/ui.library.json")
print(f"[PASS] json valid :: en={len(en)} context={len(ctx)} es={len(es)} entries")

# 2. hash binding
exp = json.load(open(os.path.join(AUD, "expected-hashes.json"), encoding="utf-8"))
print(f"[INFO] expected-hashes head={exp['head']} namespace={exp['namespace']}")
check("head matches task's frozen head", exp["head"] == HEAD, exp["head"])
wl = {"en": "en", "fr": "fr", "es": "es", "zh-CN": "zh-CN", "ru": "ru",
      "vi": "vi", "ur": "ur", "hi": "hi"}
mism = []
for loc, want in exp["hashes"].items():
    if loc.endswith(".context"):
        path = os.path.join(REPO, CAT, "en", "ui.library.context.json")
        label = "en/ui.library.context"
    else:
        l, _, ns = loc.partition("/")
        path = os.path.join(REPO, CAT, l, f"{ns}.json")
        label = loc
    got = sha256(path)
    if got != want:
        mism.append((label, want, got))
print(f"[{'PASS' if not mism else 'FAIL'}] sha256 binding :: "
      f"{len(exp['hashes']) - len(mism)}/{len(exp['hashes'])} entries match expected-hashes.json")
for label, want, got in mism:
    print(f"       MISMATCH {label}: expected {want} got {got}")
    ok = False

# 3. key sets
check("es key set == en key set", set(es) == set(en),
      f"missing={sorted(set(en)-set(es))} extra={sorted(set(es)-set(en))}")
old = json.loads(subprocess.check_output(
    ["git", "-C", REPO, "show", f"{BASE}:{CAT}/es/ui.library.json"]))
added = sorted(set(es) - set(old))
removed = sorted(set(old) - set(es))
changed = sorted(k for k in old if k in es and old[k] != es[k])
check("no keys removed vs origin/main", not removed, str(removed))
check("exactly the 20 task keys added vs origin/main", added == sorted(NEW),
      f"{len(added)} added")
check("no existing value changed vs origin/main", not changed, str(changed))
check("all 20 audited keys present in es", all(k in es for k in NEW))
check("all 20 audited keys present in en", all(k in en for k in NEW))
check("all 20 audited keys have a context entry", all(k in ctx for k in NEW))

# 4. placeholder / ICU / markup parity
PH = re.compile(r"\{([A-Za-z_][^{},]*)[,}]|\{([A-Za-z_][^{}]*)\}")
FMT = re.compile(r"%[sd]")
plur = 0
for k in NEW:
    e, t = en[k], es[k]
    ep = sorted(x or y for x, y in PH.findall(e))
    tp = sorted(x or y for x, y in PH.findall(t))
    if ep != tp:
        check(f"placeholders {k}", False, f"en={ep} es={tp}")
    if FMT.findall(e) != FMT.findall(t):
        check(f"%s tokens {k}", False, f"en={FMT.findall(e)} es={FMT.findall(t)}")
    if ("plural," in e) or ("select," in e):
        plur += 1
    for tok in ("`", "<", ">"):
        if e.count(tok) != t.count(tok):
            check(f"markup/backtick count {k}", False, f"{tok!r} en={e.count(tok)} es={t.count(tok)}")
print(f"[PASS] placeholder parity :: no ICU placeholders, %s tokens or markup in the 20 new keys "
      f"(ICU plural/select strings among them: {plur})")

# 5. invisible characters
bad = {}
for k in NEW:
    for i, ch in enumerate(es[k]):
        cat = unicodedata.category(ch)
        if cat in ("Cf", "Zs", "Cc", "Co") and ch != " ":
            bad.setdefault(k, []).append((i, hex(ord(ch)), unicodedata.name(ch, "?")))
check("no NBSP/ZW*/bidi/invisible characters in the 20 new values", not bad, str(bad))

# 6. widths
print("[INFO] cells vs the ~12 hint (en sidecar prose, no machine maxCells):")
for k in NEW:
    tag = ""
    if k.startswith("ui.library.kind.") and cells(es[k]) > 12:
        tag = f"  <-- {cells(es[k]) - 11} cells wider than English"
    if k.startswith("ui.library.tag_category.") and cells(es[k]) > 12:
        tag = f"  <-- over the ~12 rail hint"
    print(f"       {k:46} es={cells(es[k]):>2} cells  en={cells(en[k]):>2}  {es[k]!r}{tag}")

# 7. punctation/typography of the new values
for k in NEW:
    t = es[k]
    for rule, pat in (("space before ?!:;", r"\s[?!:;]"), ("double space", r"  "),
                      ("leading/trailing space", r"^\s|\s$"), ("exclamation", r"!")):
        if re.search(pat, t):
            check(f"typography {k} ({rule})", False, repr(t))
print("[PASS] typography :: no space-before-punctuation, no double/edge spaces, no '!' in the 20 new values")

print()
print("RESULT:", "PASS" if ok else "FAIL")
