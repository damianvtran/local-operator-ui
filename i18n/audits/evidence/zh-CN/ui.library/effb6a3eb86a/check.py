#!/usr/bin/env python3
"""Re-derive, from the read-only worktree, every mechanical claim in the
zh-CN / ui.library delta audit (instance effb6a3eb86a).

Nothing here writes to the repository. Run from the worktree root:
    python3 <this file>
Prints one digest block per concern (a)-(i).
"""
import hashlib
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path.cwd()
EN = ROOT / "src/i18n/catalogues/en/ui.library.json"
ZH = ROOT / "src/i18n/catalogues/zh-CN/ui.library.json"
CTX = ROOT / "src/i18n/catalogues/en/ui.library.context.json"
EXPECTED = Path(
    "/Users/damian/local-operator-ui/.worktrees/_s14-audits/"
    "8a9ce1f808c266ebe9a0e924094344cea60c2c23/expected-hashes.json"
)

NEW = [f"ui.library.kind.{k}" for k in
       "audio code docx html image markdown other pdf pptx spreadsheet text video".split()] + \
      [f"ui.library.tag_category.{k}" for k in
       "custom format project source status topic type".split()] + \
      ["ui.library.preview.unsupported_generic"]

INVISIBLE = {0x00A0, 0x202F, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF,
             0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
             0x2066, 0x2067, 0x2068, 0x2069}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def cells(s):
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in s)


en = json.loads(EN.read_text())
zh = json.loads(ZH.read_text())
ctx = json.loads(CTX.read_text())

print("== (i) hash binding ==")
exp = json.loads(EXPECTED.read_text())["hashes"]
checks = {"en/ui.library": EN, "zh-CN/ui.library": ZH, "en/ui.library.context": CTX}
mism = 0
for k, p in checks.items():
    got = sha(p)
    ok = got == exp[k]
    mism += 0 if ok else 1
    print(f"  {k:24s} {got} {'MATCH' if ok else 'MISMATCH (expected ' + exp[k] + ')'}")
print(f"  head in manifest: {json.loads(EXPECTED.read_text())['head']}")
print(f"  mismatches: {mism}")

print("\n== (g) key set parity, whole namespace ==")
print(f"  en keys={len(en)} zh keys={len(zh)}")
print(f"  missing in target: {sorted(set(en) - set(zh)) or 'none'}")
print(f"  extra in target:   {sorted(set(zh) - set(en)) or 'none'}")
print(f"  delta keys present in target: {sum(1 for k in NEW if k in zh)}/{len(NEW)}")

print("\n== (a)(d)(f) mechanical per delta key ==")
hdr = f"  {'key':44s} {'len':>3} {'cells':>5}  placeholders      invisible"
print(hdr)
for k in NEW:
    v = zh[k]
    ph = re.findall(r"\{[^}]*\}", v)
    # same placeholder multiset as English?
    ph_ok = sorted(ph) == sorted(re.findall(r"\{[^}]*\}", en[k]))
    inv = [f"U+{ord(c):04X}" for c in v if ord(c) in INVISIBLE]
    print(f"  {k:44s} {len(v):3d} {cells(v):5d}  {'ok' if ph_ok else 'MISMATCH':16s} {inv or 'none'}")
print("  ICU plural/select in delta:",
      any(re.search(r"\{[^}]*,\s*(plural|select)", zh[k]) for k in NEW))

print("\n== (c) retained Latin tokens: existing-usage precedent ==")
allfiles = sorted((ROOT / "src/i18n/catalogues/zh-CN").glob("*.json"))
for tok in ["DOCX", "HTML", "PDF", "PPTX", "Markdown"]:
    hits = [f.name for f in allfiles if tok in f.read_text()]
    print(f"  {tok:9s} appears in: {', '.join(hits) if hits else 'NOTHING ELSE'}")

print("\n== (b) word-family / collision check against existing vocabulary ==")
for k in ["ui.library.sort.kind", "ui.library.filter.categories",
          "ui.library.category.spreadsheets", "ui.library.preview.sheet_unreadable",
          "ui.library.filter.source", "ui.library.filter.status"]:
    print(f"  {k:40s} en={en[k]!r} zh={zh[k]!r}")
print("  delta collisions (target value == an existing value of a DIFFERENT concept):")
existing = {v: k for k, v in zh.items() if k not in NEW}
for k in NEW:
    if zh[k] in existing:
        print(f"    {k} = {zh[k]!r}  also used by {existing[zh[k]]}")

print("\n== (e) badge-slot width (budget ~12) ==")
badges = NEW[:19]
worst = max(badges, key=lambda k: (len(zh[k]), cells(zh[k])))
print(f"  longest badge: {worst} = {zh[worst]!r} len={len(zh[worst])} cells={cells(zh[worst])}")
print(f"  over 12 chars: {[k for k in badges if len(zh[k]) > 12] or 'none'}")
print(f"  standalone sentence: len={len(zh['ui.library.preview.unsupported_generic'])}"
      f" cells={cells(zh['ui.library.preview.unsupported_generic'])}"
      f" names-a-kind={any(x in zh['ui.library.preview.unsupported_generic'] for x in ['图片','代码','文本','表格','视频','音频','其他','PDF','HTML','Markdown','DOCX','PPTX'])}")

print("\n== (h) context sidecar coverage of the delta ==")
missing = [k for k in NEW if k not in ctx]
print(f"  delta keys with a context entry: {len(NEW) - len(missing)}/{len(NEW)}")
print(f"  missing: {missing or 'none'}")
for k in ["ui.library.kind.audio", "ui.library.tag_category.topic",
          "ui.library.preview.unsupported_generic"]:
    print(f"  {k}: role={ctx[k]['role']!r}")

print("\n== legacy integrity (not recertified) ==")
changed = [k for k in zh if k in en and zh[k] == en[k]]
print(f"  keys whose target value is byte-identical to English: {len(changed)}")
print(f"  files parsed as JSON: en ok, zh ok, context ok")
