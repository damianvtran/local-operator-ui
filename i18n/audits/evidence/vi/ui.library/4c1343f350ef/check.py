#!/usr/bin/env python3
"""Read-only mechanical checks for the vi / ui.library delta audit (tag ds) — v2.

v2 fixes three artifacts of v1 that would have produced FALSE findings:
  (a) placeholder parity compared raw regex hits, so an ICU NESTED {count} counted
      as a second placeholder -> now compares the SET of placeholder names;
  (b) plural-category extraction rebuilt a brace the regex had already consumed;
  (c) the ~12-cell badge/rail budget was applied to the preview sentence, which is
      body copy, not a badge. Budget now scoped to the 19 badge/heading labels.

Reads only the frozen worktree + the manager's expected-hashes.json. Writes nothing.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import unicodedata

HOME = pathlib.Path.home()
WT = HOME / "local-operator-ui/.worktrees/i18n-s8"
AU = HOME / "local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23"
HEAD = "8a9ce1f808c266ebe9a0e924094344cea60c2c23"
BASE = "0e12072d2b3"
NS = "ui.library"
NEW = [f"{NS}.kind.{k}" for k in "audio code docx html image markdown other pdf pptx spreadsheet text video".split()]
NEW += [f"{NS}.tag_category.{k}" for k in "custom format project source status topic type".split()]
NEW += [f"{NS}.preview.unsupported_generic"]
BADGE = [k for k in NEW if k != f"{NS}.preview.unsupported_generic"]


def sh(*a):
    return subprocess.run(a, cwd=WT, capture_output=True, text=True).stdout.strip()


def sha(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


def flat(d, p=""):
    out = {}
    for k, v in d.items():
        kk = f"{p}.{k}" if p else k
        if isinstance(v, dict):
            out.update(flat(v, kk))
        else:
            out[kk] = v
    return out


en = flat(json.loads((WT / f"src/i18n/catalogues/en/{NS}.json").read_text()))
vi = flat(json.loads((WT / f"src/i18n/catalogues/vi/{NS}.json").read_text()))
ctx_file = json.loads((WT / f"src/i18n/catalogues/en/{NS}.context.json").read_text())

print("### 1. hash binding vs expected-hashes.json")
exp = json.loads((AU / "expected-hashes.json").read_text())["hashes"]
ok_all = True
for label, path in [("en/" + NS, WT / f"src/i18n/catalogues/en/{NS}.json"),
                    ("vi/" + NS, WT / f"src/i18n/catalogues/vi/{NS}.json"),
                    ("en/" + NS + ".context", WT / f"src/i18n/catalogues/en/{NS}.context.json")]:
    got, want = sha(path), exp[label]
    ok_all &= got == want
    print(f"{label:28s} {got} {'OK' if got == want else 'MISMATCH exp ' + want}")
print("hash binding:", "PASS" if ok_all else "BLOCKER")

print("\n### 2. JSON validity + key-set parity")
print("HEAD:", sh("git", "rev-parse", "HEAD"), "match:", sh("git", "rev-parse", "HEAD") == HEAD,
      "| worktree dirty:", bool(sh("git", "status", "--porcelain")))
print("en keys:", len(en), "vi keys:", len(vi),
      "| missing in vi:", sorted(set(en) - set(vi)) or "none",
      "| extra in vi:", sorted(set(vi) - set(en)) or "none")
print("key ORDER equal en vs vi:",
      list(json.loads((WT / f"src/i18n/catalogues/en/{NS}.json").read_text())) ==
      list(json.loads((WT / f"src/i18n/catalogues/vi/{NS}.json").read_text())))
print("context sidecar top-level entries:", len(ctx_file),
      "| covers every en key:", set(ctx_file) == set(en),
      "| covers the 20:", all(k in ctx_file for k in NEW))
print("context entry field sets:", sorted({tuple(sorted(v)) for v in ctx_file.values()}))

print("\n### 3. delta vs base: additions only, no existing value changed")
raw = sh("git", "diff", f"{BASE}..HEAD", "--", f"src/i18n/catalogues/vi/{NS}.json")
added = re.findall(r'^\+\t"([^"]+)":', raw, re.M)
removed = re.findall(r'^-\t"([^"]+)":', raw, re.M)
base = flat(json.loads(sh("git", "show", f"{BASE}:src/i18n/catalogues/vi/{NS}.json")))
print("added key lines:", len(added), "| removed key lines:", len(removed), "|", removed)
print("removed line is the pre-existing last key, value identical after (comma rewrite):",
      all(base.get(k) == vi.get(k) for k in removed))
print("NEW keys added:", len(set(added) & set(NEW)), "of", len(NEW),
      "| unexplained additions:", sorted(set(added) - set(NEW) - set(removed)) or "none")
print("existing values changed vs base:", [k for k in set(base) & set(vi) if base[k] != vi[k]] or "none")
print("keys dropped vs base:", sorted(set(base) - set(vi)) or "none")

print("\n### 4. placeholder parity, namespace-wide (names as SETS; type/branch text excluded)")
PH = re.compile(r"\{([A-Za-z_][\w]*)\s*[,}]")
mism = []
for k in en:
    a, b = set(PH.findall(en[k])), set(PH.findall(vi[k]))
    if a != b:
        mism.append((k, sorted(a), sorted(b)))
print("placeholder name-set mismatches:", mism or "none")
print("printf %s/%d tokens en vs vi:", [(k, re.findall(r"%[sd]", en[k]), re.findall(r"%[sd]", vi[k]))
                                        for k in en if re.search(r"%[sd]", en[k])] or "none")
print("new keys declare placeholders:", {k: PH.findall(en[k]) for k in NEW if PH.findall(en[k])} or "none")

print("\n### 5. ICU plural categories (glossary §3: vi is `other`-only)")
def cats(flatmap):
    out = set()
    for v in flatmap.values():
        for m in re.finditer(r"plural,\s*((?:\w+\s*\{)|(?:=\d+\s*\{)|(?:\w+\s*,?\s*))+", v):
            out |= set(re.findall(r"(\w+)\s*\{", m.group(0)))
    return out
ce, cv = cats(en), cats(vi)
print("en categories:", sorted(ce), "| vi categories:", sorted(cv))
print("vi uses only `other`:", cv <= {"other"}, "| same categories as en:", cv == ce)
print("ICU constructs in the 20 new keys:",
      [k for k in NEW if re.search(r"plural|select", vi[k])] or "none (none present in en either)")
print("vi plural keys count:", sum(1 for v in vi.values() if "plural" in v),
      "| any one/few/many/ZERO/OTHER branch in vi:",
      sorted(c for c in cv if c not in ("other",)) or "none")

print("\n### 6. markup, backticks, tags, flags in the 20 new keys")
print([(k, re.findall(r"`[^`]+`|\{[^}]*\}", v)) for k, v in ((k, en[k]) for k in NEW)
       if re.search(r"`|\{|<[A-Za-z/]", v)] or "none in en")
print([(k, re.findall(r"`[^`]+`|<[A-Za-z/][^>]*>|--?[a-z][\w-]*|%[sd]", v))
       for k, v in ((k, vi[k]) for k in NEW) if re.search(r"`|<[A-Za-z/]|--?[a-z]|%[sd]", v)] or "none in vi")

print("\n### 7. invisible / bidi / combining / NFC (the 20 new keys)")
INV = {"00A0": "NBSP", "202F": "NARROW-NBSP", "200B": "ZWSP", "200C": "ZWNJ", "200D": "ZWJ",
       "200E": "LRM", "200F": "RLM", "2066": "LRI", "2067": "RLI", "2068": "FSI", "2069": "PDI",
       "202A": "LRE", "202B": "RLE", "202C": "PDF", "202D": "LRO", "202E": "RLO",
       "00AD": "SOFT-HYPHEN", "FEFF": "BOM", "2028": "LSEP", "2029": "PSEP"}
anybad = False
for k in NEW:
    v = vi[k]
    hits = [INV[c] for c in (f"{ord(ch):04X}" for ch in v) if c in INV]
    nfc = unicodedata.normalize("NFC", v) == v
    comb = [f"U+{ord(ch):04X}" for ch in v if unicodedata.combining(ch)]
    if hits or not nfc or comb:
        anybad = True
        print(f"{k:42s} invis={hits} nfc={nfc} combining={comb}")
print("invisible/combining/NFC offenders:", "NONE (all 20 NFC, no ZW*/bidi/NBSP/combining)" if not anybad else "see above")

print("\n### 8. width: ~12-cell badge slot for the 19 labels, body copy for the sentence")
def cells(s):
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in s)
over = [(k, cells(vi[k])) for k in BADGE if cells(vi[k]) > 12]
for k in BADGE:
    print(f"{k:42s} cells={cells(vi[k]):2d} {'OVER 12' if cells(vi[k]) > 12 else 'fits'}")
print("over-budget badge labels:", over or "none")
print("widest kind:", max((cells(vi[f'{NS}.kind.{k}']), k) for k in "audio code docx html image markdown other pdf pptx spreadsheet text video".split()),
      "| widest heading:", max((cells(vi[f'{NS}.tag_category.{k}']), k) for k in "custom format project source status topic type".split()))
print("sentence cells:", cells(vi[f"{NS}.preview.unsupported_generic"]),
      "| existing unsupported cells:", cells(vi[f"{NS}.preview.unsupported"]),
      "| delta:", cells(vi[f"{NS}.preview.unsupported_generic"]) - cells(vi[f"{NS}.preview.unsupported"]))

print("\n### 9. terminology cross-check inside the SAME locale (values quoted from disk)")
for a, b in [("kind.code", "category.code"), ("kind.image", "category.images"),
             ("kind.audio", "category.sounds"), ("kind.spreadsheet", "category.spreadsheets"),
             ("kind.video", "category.video"), ("kind.other", "category.other")]:
    print(f"  {a:22s}={vi[f'{NS}.{a}']!r:12s} {b:22s}={vi[f'{NS}.{b}']!r:12s} equal={vi[f'{NS}.{a}'] == vi[f'{NS}.{b}']}")
for a, b in [("tag_category.source", "filter.source"), ("tag_category.status", "filter.status"),
             ("tag_category.type", "sort.kind")]:
    print(f"  {a:22s}={vi[f'{NS}.{a}']!r:12s} {b:22s}={vi[f'{NS}.{b}']!r:12s} collision={vi[f'{NS}.{a}'] == vi[f'{NS}.{b}']}")
print("  unsupported         =", repr(vi[f"{NS}.preview.unsupported"]))
print("  unsupported_generic =", repr(vi[f"{NS}.preview.unsupported_generic"]))
print("  generic names no kind and no placeholder:",
      not re.search(r"\{|\bkind\b", vi[f"{NS}.preview.unsupported_generic"]))
print("  generic == unsupported with the {kind} clause replaced by 'này' (same frame):",
      vi[f"{NS}.preview.unsupported"].replace("Tệp {kind} ", "Tệp này ") == vi[f"{NS}.preview.unsupported_generic"])

print("\n### 10. punctuation/typography of the 20 values")
for k in NEW:
    v = vi[k]
    print(f"{k:42s} last={v[-1]!r} ascii_quote={chr(34) in v} dblspace={'  ' in v} "
          f"ellipsis_ascii={'...' in v}")
