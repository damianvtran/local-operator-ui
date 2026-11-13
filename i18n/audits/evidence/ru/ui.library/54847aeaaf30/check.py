#!/usr/bin/env python3
"""Independent mechanical checks for the ru ui.library delta audit (PR #1851).

Read-only. Re-derives, from the frozen worktree, everything the audit claims to
have measured: hash binding, key-set parity, placeholder parity, ICU plural
completeness for ru's four CLDR categories, invisible/bidi characters, and
display-cell widths of the 20 audited values. No translation/MT service is used;
this script only compares bytes and counts.

Run: python3 ru-ds-54847aeaaf30-check.py
"""
import hashlib
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.expanduser("~/local-operator-ui/.worktrees/i18n-s8")
AUDIT = os.path.expanduser(
    "~/local-operator-ui/.worktrees/_s14-audits/"
    "8a9ce1f808c266ebe9a0e924094344cea60c2c23"
)
NS = "ui.library"
LOCALE = "ru"

EN = f"{ROOT}/src/i18n/catalogues/en/{NS}.json"
CTX = f"{ROOT}/src/i18n/catalogues/en/{NS}.context.json"
TGT = f"{ROOT}/src/i18n/catalogues/{LOCALE}/{NS}.json"

NEW_PREFIXES = ("ui.library.kind.", "ui.library.tag_category.")
NEW_EXTRA = {"ui.library.preview.unsupported_generic"}


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def cells(text):
    """Display cells: combining marks are zero-width, wide/fullwidth are 2."""
    n = 0
    for ch in text:
        if unicodedata.combining(ch):
            continue
        n += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return n


def placeholders(text):
    return set(re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)[,}]", text))


def icu_blocks(text):
    """Yield (variable, kind, [top-level categories]) for each ICU plural/select."""
    for m in re.finditer(r"\{(\w+),\s*(plural|selectordinal|select)\b", text):
        depth, i = 1, m.end()
        while i < len(text) and depth > 0:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        body = text[m.end(): i - 1]
        yield m.group(1), m.group(2), re.findall(r"(\w+)\s*\{", body)


INVISIBLE = {
    "\u00a0": "NBSP", "\u202f": "NARROW-NBSP", "\u200b": "ZWSP",
    "\u200c": "ZWNJ", "\u200d": "ZWJ", "\u2060": "WORD-JOINER",
    "\ufeff": "BOM", "\u200e": "LRM", "\u200f": "RLM",
    "\u202a": "LRE", "\u202b": "RLE", "\u202c": "PDF", "\u202d": "LRO",
    "\u202e": "RLO", "\u2066": "LRI", "\u2067": "RLI", "\u2068": "FSI",
    "\u2069": "PDI",
}

failures = []


def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{': ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


print(f"# worktree HEAD (must be the frozen head): ", end="")
head = os.popen(f"git -C {ROOT} rev-parse HEAD").read().strip()
print(head)
check("head matches frozen 8a9ce1f", head == "8a9ce1f808c266ebe9a0e924094344cea60c2c23", head)

expected = json.load(open(f"{AUDIT}/expected-hashes.json"))["hashes"]
for label, path, key in (
    ("en", EN, "en/ui.library"),
    ("context", CTX, "en/ui.library.context"),
    ("ru", TGT, f"{LOCALE}/ui.library"),
):
    got = sha(path)
    check(f"sha256 {label}", got == expected[key], f"{got[:16]}… vs expected {expected[key][:16]}…")

en = json.load(open(EN))
ru = json.load(open(TGT))
ctx = json.load(open(CTX))

check("JSON parses (en, ru, context)", True, f"en={len(en)} ru={len(ru)} ctx={len(ctx)}")
check("key sets identical", set(en) == set(ru),
      f"missing={sorted(set(en) - set(ru))} extra={sorted(set(ru) - set(en))}")

mismatch = [k for k in en if placeholders(en[k]) != placeholders(ru[k])]
check("placeholder parity, whole namespace", not mismatch, str(mismatch))

new_keys = sorted(
    k for k in en if k.startswith(NEW_PREFIXES) or k in NEW_EXTRA
)
check("20 new keys present", len(new_keys) == 20, f"{len(new_keys)} found")

# ru CLDR categories for plural: one / few / many / other
NEEDED = {"one", "few", "many", "other"}
bad_icu = []
for k in sorted(ru):
    for var, kind, cats in icu_blocks(ru[k]):
        if kind.startswith("plural") and not NEEDED <= set(cats):
            bad_icu.append((k, kind, sorted(NEEDED - set(cats))))
check("ru ICU plural categories complete (legacy namespace)", not bad_icu, str(bad_icu))

unbalanced = [k for k in ru if ru[k].count("{") != ru[k].count("}")]
check("ICU braces balanced (whole namespace)", not unbalanced, str(unbalanced))

hits = []
for k, v in ru.items():
    for ch, label in INVISIBLE.items():
        if ch in v:
            hits.append((k, label))
new_hits = [h for h in hits if h[0] in set(new_keys)]
check("no invisible/bidi characters in the 20 new values", not new_hits, str(new_hits))
print(f"  (whole-namespace invisible-char scan: {len(hits)} occurrence(s) — {hits})")

print("\n# audited values: length, display cells, hygiene")
for k in new_keys:
    v = ru[k]
    flags = []
    if v != v.strip():
        flags.append("LEAD/TRAIL SPACE")
    if "  " in v:
        flags.append("DOUBLE SPACE")
    if "`" in v or "<" in v or ">" in v:
        flags.append("MARKUP")
    if placeholders(v):
        flags.append(f"PLACEHOLDER {sorted(placeholders(v))}")
    print(f"  {k:42s} len={len(v):2d} cells={cells(v):2d} {' '.join(flags) or 'clean'}  {v!r}")
    if flags:
        failures.append(f"hygiene {k}")

print("\n# term-consistency evidence (read, not asserted): en -> ru")
for pair in (
    ("ui.library.sort.kind", "ui.library"),
    ("ui.library.category.sounds", "ui.library"),
    ("ui.library.category.images", "ui.library"),
    ("ui.library.category.spreadsheets", "ui.library"),
    ("ui.library.category.video", "ui.library"),
    ("ui.library.category.other", "ui.library"),
    ("ui.library.category.code", "ui.library"),
    ("ui.agents.pages.scope.custom", "ui.agents.pages"),
    ("ui.settings.appearance.editor.custom_group", "ui.settings.appearance.editor"),
    ("ui.canvas.files.kind", "ui.canvas"),
    ("ui.canvas.files.audio", "ui.canvas"),
    ("ui.canvas.create_file_dialog.file_type", "ui.canvas"),
    ("ui.shell.menubar.view", "ui.shell.menubar"),
    ("ui.teamBridge.fileCard.kind", "ui.teamBridge"),
):
    key, namespace = pair
    e = json.load(open(f"{ROOT}/src/i18n/catalogues/en/{namespace}.json")).get(key)
    r = json.load(open(f"{ROOT}/src/i18n/catalogues/{LOCALE}/{namespace}.json")).get(key)
    print(f"  {key:48s} en={e!r:22s} ru={r!r}")

print(f"\nSUMMARY: {'all mechanical checks passed' if not failures else 'FAILURES: ' + str(failures)}")
sys.exit(1 if failures else 0)
