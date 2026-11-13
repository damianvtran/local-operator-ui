#!/usr/bin/env python3
"""Round-2 (delta) mechanical checks for the Urdu L1 tool-row verb slice.

Reads the prep artefacts only (keys.json, ur.json, ur.v2.json) and the shipped
ur catalogue as a reference corpus. Writes no file and edits no translation.

Run with the repo's rich-capable interpreter so cell widths are real
`rich.cells.cell_len` measurements (the ur style guide's one-cell-per-character
rule), not code-point counts:

    ~/local-operator/.venv/bin/python checks.py

Exit 0 when every mechanical assertion holds; 1 otherwise. The script asserts
what it prints, so a green line is a measured result, not a claim.
"""

import json
import re
import sys
import unicodedata
from glob import glob
from pathlib import Path

from rich.cells import cell_len

PREP = Path.home() / "local-operator-ui/.worktrees/_l1-prep"
SHIPPED = Path.home() / "local-operator-ui/.worktrees/i18n-l1-tool-verbs/src/i18n/catalogues/ur"
P = "ui.chat.canonical.tool_row.verb."

keys = json.loads((PREP / "keys.json").read_text())
v1 = json.loads((PREP / "ur.json").read_text())
v2 = json.loads((PREP / "ur.v2.json").read_text())

failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


# 1. Set and order against the English source.
check("182 keys", len(v2) == 182, f"{len(v2)}")
check("key set identical to en source", set(v2) == set(keys))
check("key order identical to en source", list(v2) == list(keys))
check("values are strings", all(isinstance(v, str) for v in v2.values()))

# 2. Empties, whitespace hygiene, NFC.
check("no empty/blank values", all(v.strip() for v in v2.values()))
check(
    "no leading/trailing/double spaces",
    all(v == v.strip() and "  " not in v for v in v2.values()),
    [k for k, v in v2.items() if v != v.strip() or "  " in v],
)
check(
    "NFC-normalised",
    all(unicodedata.normalize("NFC", v) == v for v in v2.values()),
)

# 3. Placeholders / ICU: this namespace declares none in English.
en_tokens = {m for v in keys.values() for m in re.findall(r"\{[^}]*\}", v["en"])}
check("en declares no placeholders/ICU", not en_tokens, sorted(en_tokens))
check("no braces in any ur value", not [k for k, v in v2.items() if "{" in v or "}" in v])

# 4. Manual bidi controls and other invisible/control characters.
banned = (
    set(range(0x00, 0x20))
    | {0x7F, 0x061C, 0xFEFF}
    | set(range(0x200B, 0x2010))
    | set(range(0x202A, 0x202F))
    | set(range(0x2066, 0x206A))
)
bad_ctrl = [k for k, v in v2.items() if any(ord(c) in banned for c in v)]
check("no manual bidi controls / control chars", not bad_ctrl, bad_ctrl)

# 5. Script inventory: only Arabic-script letters, spaces and the allowed
#    technology name `Python`.
allowed_latin = set("Python")
other = {}
for v in v2.values():
    for c in v:
        if "\u0600" <= c <= "\u06FF" or c == " ":
            continue
        if c in allowed_latin:
            continue
        other[c] = other.get(c, 0) + 1
check("Latin/other characters limited to `Python`", not other, other)

# 6. English-identical values (the two Python rows keep the product name only).
identical = [k for k in keys if v2[k] == keys[k]["en"]]
check("no English-identical values", not identical, identical)

# 7. Unchanged vs changed accounting (delta scope).
changed = [k for k in keys if v1[k] != v2[k]]
check("changed keys = 76", len(changed) == 76, len(changed))

# 8. Running family is a genuine progressive except the one recorded جاری.
running = [k for k in keys if k.endswith(".running")]
not_raha = [k for k in running if not v2[k].rstrip().endswith(("رہا", "رہیں", "رہی"))]
check("91 running keys", len(running) == 91, len(running))
print(f"INFO  running keys not ending رہا/رہیں: {[(k.replace(P, ''), v2[k]) for k in not_raha]}")
check(
    "only searched_the_web.running keeps a جاری status",
    [k.replace(P, "") for k in not_raha] == ["searched_the_web.running"],
)

# 9. No گنوانا forms remain; the recorded imperative homograph is gone apart
#    from the one new دکھائیں.
print(f"INFO  گنوانا forms in v1/v2: {sum('گنو' in v for v in v1.values())}/"
      f"{sum('گنو' in v for v in v2.values())}")
check("no گنوانا left", not [k for k, v in v2.items() if "گنو" in v])
imperative = [k for k, v in v2.items() if v.rstrip().endswith("دکھائیں")]
print(f"INFO  values ending دکھائیں (2nd-person imperative form): "
      f"{[(k.replace(P, ''), v2[k]) for k in imperative]}")
check("dکھائیں imperative homograph absent", not imperative)

# 10. Width: cell_len per the ur guide, plus the brief's 5-word / 32-cell marks.
rows = [(cell_len(v), len(v.split()), k, v) for k, v in v2.items()]
en_widths = {k: cell_len(keys[k]["en"]) for k in keys}
print(f"INFO  ur cells max={max(r[0] for r in rows)} (en max={max(en_widths.values())}); "
      f"labels over 5 words={sum(1 for r in rows if r[1] > 5)}; "
      f"labels over 32 cells={sum(1 for r in rows if r[0] > 32)}; "
      f"labels over the sidecar's 1-4 words={sum(1 for r in rows if r[1] > 4)}/182")
check("no value exceeds 32 cells", max(r[0] for r in rows) <= 32)
for cells, words, k, v in sorted(rows, reverse=True)[:6]:
    print(f"      {cells:3d} cells {words}w {k.replace(P, '')} = {v}")

# 11. Shipped-corpus counts the disposition table relies on (re-verified here,
#     strings containing the term, across src/i18n/catalogues/ur/*.json).
corpus = []
for f in glob(str(SHIPPED / "*.json")):
    for k, v in json.loads(Path(f).read_text()).items():
        if isinstance(v, str):
            corpus.append(v)
for term in ("ری سیٹ", "بحال", "اپ ڈیٹ", "تازہ", "جابز", "جاب",
             "کاموں کی فہرست", "ساتھی", "کنسول", "سنگ میل", "راز", "متغیر",
             "کال جاری", "تلاش جاری", "ڈیوائسز", "پروجیکٹس", "نیٹ ورکس",
             "علامت", "ہنگامی", "تعریف", "کلیدیں"):
    print(f"INFO  shipped ur strings containing {term}: {sum(term in v for v in corpus)}")

# 12. Shipped bridge running family and the 6-word فہرست precedent.
bridge = {k: v for k, v in json.loads(
    (SHIPPED / "ui.chat.canonical.json").read_text()).items()
    if ".bridge.verb." in k and k.endswith(".running")}
check("17 shipped bridge running keys", len(bridge) == 17, len(bridge))
check("all shipped bridge running forms end رہا",
      all(v.rstrip().endswith("رہا") for v in bridge.values()))
print(f"INFO  widest shipped bridge running form: "
      f"{max(bridge.values(), key=cell_len)} ({max(cell_len(v) for v in bridge.values())} cells)")

print()
print(f"RESULT: {len(failures)} failed assertion(s): {failures}")
sys.exit(1 if failures else 0)
