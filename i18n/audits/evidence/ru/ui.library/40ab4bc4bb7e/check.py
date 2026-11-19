#!/usr/bin/env python3
"""Mechanical delta checks for ru/ui.library at head f04035bc3c (round-2 delta audit).

Read-only: opens catalogue files in the read-only worktree, computes width /
invisible-character / key-parity / hash-binding facts. Writes nothing.
"""
import hashlib
import json
import os
import subprocess
import unicodedata

WT = os.path.expanduser("~/local-operator-ui/.worktrees/i18n-s8")
AUD = os.path.expanduser(
    "~/local-operator-ui/.worktrees/_s14-audits/f04035bc3cb6a03644f8776a799e3daad93c7e58"
)
PREV = "8a9ce1f808c266ebe9a0e924094344cea60c2c23"
BASE = "0e12072d2b3"
KEYS_ADDED = 20
REVISED = "ui.library.tag_category.custom"

failures = []


def jload(rel):
    with open(os.path.join(WT, rel), encoding="utf-8") as fh:
        return json.load(fh)


def sha(rel):
    with open(os.path.join(WT, rel), "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def cells(s):
    """Display cells: combining marks 0, East-Asian W/F 2, else 1."""
    n = 0
    for ch in s:
        if unicodedata.combining(ch):
            continue
        n += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return n


print("== 1. worktree head ==")
head = subprocess.check_output(["git", "-C", WT, "rev-parse", "HEAD"], text=True).strip()
print("git rev-parse HEAD:", head)
if head != os.path.basename(AUD):
    failures.append("head mismatch: worktree %s vs audit dir %s" % (head, os.path.basename(AUD)))

print("\n== 2. delta vs previous audited head %s ==" % PREV[:12])
diff = subprocess.check_output(
    ["git", "-C", WT, "diff", "--numstat", PREV + "..HEAD", "--",
     "src/i18n/catalogues/ru/ui.library.json"], text=True).strip()
print("numstat ru/ui.library.json:", diff)
add, dele = (int(x) for x in diff.split("\t")[:2]) if diff else (0, 0)
if (add, dele) != (1, 1):
    failures.append("ru delta is not exactly one changed line (%d+/%d-)" % (add, dele))

print("\n== 3. the one changed line ==")
patch = subprocess.check_output(
    ["git", "-C", WT, "diff", PREV + "..HEAD", "--",
     "src/i18n/catalogues/ru/ui.library.json"], text=True)
print("\n".join(l for l in patch.splitlines() if l[:1] in "+-" and not l.startswith(("+++", "---"))))

print("\n== 4. revised value (current bytes) ==")
en = jload("src/i18n/catalogues/en/ui.library.json")
ru = jload("src/i18n/catalogues/ru/ui.library.json")
ctx = jload("src/i18n/catalogues/en/ui.library.context.json")
val = ru[REVISED]
print("en  :", json.dumps(en[REVISED], ensure_ascii=False))
print("ru  :", json.dumps(val, ensure_ascii=False))
print("codepoints:", " ".join("U+%04X" % ord(c) for c in val))
print("len chars:", len(val), "| cells:", cells(val))
print("hint:", json.dumps(ctx[REVISED]["length"], ensure_ascii=False))
print("note:", json.dumps(ctx[REVISED]["note"], ensure_ascii=False))

print("\n== 5. placeholder / markup / code parity ==")
import re
BRACES = re.compile(r"[{}]")
TAGS = re.compile(r"</?[A-Za-z]")
for name, s in (("en", en[REVISED]), ("ru", val)):
    print(name, "braces:", BRACES.findall(s), "tags:", TAGS.findall(s),
          "backtick:", s.count("`"), "digits:", [c for c in s if c.isdigit()])
if BRACES.search(val) or TAGS.search(val) or "`" in val:
    failures.append("placeholder/markup present in a value whose English source has none")

print("\n== 6. invisible / bidi characters, revised value and whole ru namespace ==")
SUSPECT = {
    0x00A0: "NBSP", 0x202F: "NNBSP", 0x200B: "ZWSP", 0x200C: "ZWNJ", 0x200D: "ZWJ",
    0xFEFF: "BOM", 0x200E: "LRM", 0x200F: "RLM", 0x202A: "LRE", 0x202B: "RLE",
    0x202C: "PDF", 0x202D: "LRO", 0x202E: "RLO", 0x2066: "LRI", 0x2067: "RLI",
    0x2068: "FSI", 0x2069: "PDI", 0x061C: "ALM", 0x00AD: "SHY",
}
print("revised value:", [SUSPECT[ord(c)] for c in val if ord(c) in SUSPECT] or "none")
hits = {}
for k, v in ru.items():
    if isinstance(v, str):
        found = [SUSPECT[ord(c)] for c in v if ord(c) in SUSPECT]
        if found:
            hits[k] = found
print("whole ru/ui.library:", hits or "none")

print("\n== 7. key-set parity ==")
print("en keys:", len(en), "ru keys:", len(ru), "identical set:", set(en) == set(ru),
      "identical order:", list(en) == list(ru))
if set(en) != set(ru):
    failures.append("key set differs from English")

print("\n== 8. legacy values vs origin base %s ==" % BASE)
base = json.loads(subprocess.check_output(
    ["git", "-C", WT, "show", BASE + ":src/i18n/catalogues/ru/ui.library.json"], text=True))
added = [k for k in ru if k not in base]
removed = [k for k in base if k not in ru]
changed = [k for k in base if k in ru and base[k] != ru[k]]
print("base keys:", len(base), "head keys:", len(ru))
print("added:", len(added), "| removed:", removed, "| legacy values changed:", changed)
if len(added) != KEYS_ADDED or removed or changed:
    failures.append("key delta vs base is not %d additions / 0 removals / 0 value changes" % KEYS_ADDED)

print("\n== 9. the other 19 new keys: byte-identity to the round-1 audited head ==")
prev_ru = json.loads(subprocess.check_output(
    ["git", "-C", WT, "show", PREV + ":src/i18n/catalogues/ru/ui.library.json"], text=True))
added_prev = [k for k in prev_ru if k not in base]
differ = [k for k in added_prev if prev_ru.get(k) != ru.get(k)]
print("new keys at previous head:", len(added_prev))
print("differing at new head:", differ)
if differ != [REVISED]:
    failures.append("expected exactly %s to differ; got %r" % (REVISED, differ))
others = [k for k in added_prev if k != REVISED]
print("other %d keys byte-identical: %s" % (len(others), all(prev_ru[k] == ru[k] for k in others)))

print("\n== 10. hash binding vs expected-hashes.json ==")
exp = json.load(open(os.path.join(AUD, "expected-hashes.json"), encoding="utf-8"))
paths = {
    "en/ui.library": "src/i18n/catalogues/en/ui.library.json",
    "en/ui.library.context": "src/i18n/catalogues/en/ui.library.context.json",
    "ru/ui.library": "src/i18n/catalogues/ru/ui.library.json",
}
for key, rel in paths.items():
    got = sha(rel)
    want = exp["hashes"][key]
    ok = got == want
    print(("%-26s %s %s" % (key, got, "MATCH" if ok else "MISMATCH exp " + want)))
    if not ok:
        failures.append("hash mismatch %s" % key)
print("all three matched:", not any(f.startswith("hash mismatch") for f in failures))

print("\n== 11. collision scan: the revised heading vs every other ru value in the same rail ==")
rail = ("format", "project", "source", "status", "topic", "type")
for sib in rail:
    k = "ui.library.tag_category." + sib
    print("%-34s %-14s %s" % (k, ru[k], "== REVISED" if ru[k] == val else ""))
for k in ("ui.library.sort.kind", "ui.library.page.sort", "ui.library.filter.tags",
          "ui.library.filter.categories", "ui.library.filter.source", "ui.library.filter.status"):
    print("%-34s %-14s %s" % (k, ru[k], "== REVISED" if ru[k] == val else ""))
same = [k for k, v in ru.items() if v == val and k != REVISED]
print("other values in ru/ui.library equal to %r:" % val, same or "none")
import glob
elsewhere = []
for f in sorted(glob.glob(os.path.join(WT, "src/i18n/catalogues/ru/*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    for k, v in d.items():
        if isinstance(v, str) and "Произвольн" in v:
            elsewhere.append((os.path.basename(f), k, v))
print("'Произвольн' anywhere in ru catalogues:", elsewhere or "none")

print("\n== 12. corpus rendering of English 'Custom' (consistency evidence) ==")
for ns in ("ui.agents.pages", "ui.agents.skills", "ui.settings.appearance.editor"):
    e = jload("src/i18n/catalogues/en/%s.json" % ns)
    r = jload("src/i18n/catalogues/ru/%s.json" % ns)
    for k, v in e.items():
        if isinstance(v, str) and v.strip().lower() in ("custom", "local"):
            print("%-44s en=%-8r ru=%r" % (k, v, r.get(k)))

print("\n== RESULT ==")
print("FAILURES:", failures or "none")
print("all mechanical checks PASS" if not failures else "MECHANICAL FAIL")
