#!/usr/bin/env python3
"""Independent mechanical check for fr/ui.library delta audit (PR #1851).

Read-only. Verifies structure, placeholder parity, ICU categories, invisible and
bidi characters, typography, key-set parity and hash binding for the 20 new keys
and the legacy remainder of src/i18n/catalogues/{en,fr}/ui.library.json.
Run from ~/local-operator-ui/.worktrees/i18n-s8.
"""
import hashlib
import json
import re
import subprocess
import sys

HEAD = "8a9ce1f808c266ebe9a0e924094344cea60c2c23"
BASE = "0e12072d2b3"
EN = "src/i18n/catalogues/en/ui.library.json"
FR = "src/i18n/catalogues/fr/ui.library.json"
CTX = "src/i18n/catalogues/en/ui.library.context.json"
EXPECTED = (
    "/Users/damian/local-operator-ui/.worktrees/_s14-audits/"
    "8a9ce1f808c266ebe9a0e924094344cea60c2c23/expected-hashes.json"
)

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


def check(cond, label, detail=""):
    print(("PASS  " if cond else "FAIL  ") + label + ((" :: " + detail) if detail else ""))
    if not cond:
        fails.append(label)


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, check=False)


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()


# 1. head + cleanliness
head = run("git", "rev-parse", "HEAD").stdout.strip()
check(head == HEAD, "HEAD matches frozen head", head)
status = run("git", "status", "--porcelain").stdout.strip()
check(status == "", "worktree clean", status or "(clean)")

# 2. hash binding
expected = json.load(open(EXPECTED))["hashes"]
for label, path, key in (
    ("en/ui.library", EN, "en/ui.library"),
    ("fr/ui.library", FR, "fr/ui.library"),
    ("en/ui.library.context", CTX, "en/ui.library.context"),
):
    got = sha(path)
    check(got == expected[key], f"sha256 {label}", got)

# 3. parse + key sets
en = json.load(open(EN))
fr = json.load(open(FR))
ctx = json.load(open(CTX))
check(isinstance(en, dict) and isinstance(fr, dict), "both catalogues parse as JSON objects")
check(set(en) == set(fr), "fr key set equals en key set",
      f"{len(en)} en / {len(fr)} fr; only-en={sorted(set(en) - set(fr))} only-fr={sorted(set(fr) - set(en))}")
check(fr == dict(sorted(fr.items())), "fr file keys are sorted (file is deterministic)")
check(all(k in en and k in fr for k in NEW_KEYS), "all 20 new keys present in en and fr",
      f"{sum(1 for k in NEW_KEYS if k in en)}/20 en, {sum(1 for k in NEW_KEYS if k in fr)}/20 fr")

# 4. additions only vs base
diff = run("git", "diff", "--unified=0", f"{BASE}..HEAD", "--", FR).stdout
removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
added = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
check(len(added) == 21, "21 added lines vs base (20 new keys + 1 re-added, comma only)", str(len(added)))
check(len(removed) == 1, "1 removed line vs base (comma-only)", str(len(removed)))
if removed and added:
    # the single removed line must be re-added byte-identical apart from the trailing comma
    def strip_comma(line):
        line = re.sub(r"\s*$", "", line[1:])
        return line[:-1] if line.endswith(",") else line

    twin = [a for a in added if strip_comma(a) == strip_comma(removed[0])]
    check(len(twin) == 1,
          "removed line is byte-identical apart from the added trailing comma",
          (twin or ["NO TWIN"])[0][:80])
    new_key_lines = [a for a in added if re.match(r'\+\s*"ui\.library\.(kind|tag_category)\.|\+\s*"ui\.library\.preview\.unsupported_generic"', a)]
    check(len(new_key_lines) == 20, "the other 20 added lines are the 20 new keys", str(len(new_key_lines)))

# 5. legacy values unchanged (compare against base bytes via git show)
base_fr = json.loads(run("git", "show", f"{BASE}:{FR}").stdout)
changed = [k for k in base_fr if k in fr and base_fr[k] != fr[k]]
check(changed == [], "no pre-existing value changed", str(changed))
check(set(fr) - set(base_fr) == set(NEW_KEYS), "the only new keys are the 20 audited ones",
      str(sorted(set(fr) - set(base_fr) - set(NEW_KEYS))))

# 6. placeholders + ICU parity over the WHOLE file, reported per new key
PH = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

def placeholders(v):
    return sorted(set(PH.findall(v)))

ph_bad = [k for k in en if placeholders(en[k]) != placeholders(fr[k])]
check(ph_bad == [], "placeholder name/type parity for every key in the file", str(ph_bad))

print("\n-- per-new-key placeholders / ICU --")
for k in NEW_KEYS:
    ph = placeholders(fr[k])
    icu = "," in fr[k] and "plural" in fr[k]
    print(f"{k}: placeholders={ph} icu_plural={icu}")

SEL = re.compile(r"\{\s*([a-zA-Z_][\w]*)\s*,\s*(plural|select|selectordinal)\s*,")
CAT = re.compile(r"(zero|one|two|few|many|other)\s*\{")
# fr CLDR categories (style guide 'Plurals'): one (0 and 1), many (exact 10^6 multiples), other.
FR_REQUIRED = {"one", "many", "other"}
icu_bad = []
for k in en:
    if SEL.search(en[k]) or SEL.search(fr[k]):
        en_cats = set(CAT.findall(en[k]))
        fr_cats = set(CAT.findall(fr[k]))
        # English's own categories must be covered, and fr must add exactly the
        # categories CLDR/fr requires - neither missing one nor inventing others.
        if not en_cats <= fr_cats or fr_cats != FR_REQUIRED:
            icu_bad.append((k, sorted(en_cats), sorted(fr_cats)))
check(icu_bad == [],
      "every plural key carries exactly fr's CLDR categories one/many/other and covers English's",
      str(icu_bad))
check(FR_REQUIRED == {"one", "many", "other"}, "fr required set per style guide 'Plurals' (one, many, other)")
fr_cats_all = sorted({c for k in fr for c in CAT.findall(fr[k])})
check("few" not in fr_cats_all, "no 'few' category anywhere in fr (style guide: not a French category)",
      str(fr_cats_all))
check(all(balance_ok for balance_ok in [fr[k].count("{") == fr[k].count("}") for k in en]),
      "braces balanced in every fr value")

# 7. invisible / bidi / typography on the 20 new keys
BAD_RANGES = [    ("U+00A0 NBSP", 0x00A0, 0x00A0), ("U+202F narrow NBSP", 0x202F, 0x202F),
    ("U+200B..U+200F ZW/bidi", 0x200B, 0x200F), ("U+202A..U+202E bidi", 0x202A, 0x202E),
    ("U+2060..U+2069 word-joiner/bidi", 0x2060, 0x2069), ("U+FEFF BOM", 0xFEFF, 0xFEFF),
]
print("\n-- per-new-key characters / width --")
for k in NEW_KEYS:
    v = fr[k]
    found = []
    for name, lo, hi in BAD_RANGES:
        if any(lo <= ord(ch) <= hi for ch in v):
            found.append(name)
    ctrl = [f"U+{ord(ch):04X}" for ch in v if ord(ch) < 0x20 or 0x7F <= ord(ch) <= 0x9F]
    quote = "U+0027 straight" if "'" in v else ("U+2019 curly" if "\u2019" in v else "none")
    print(f"{k}: len={len(v)} chars={[hex(ord(c)) for c in v if ord(c) > 0x7E]} "
          f"invisible={found or 'none'} ctrl={ctrl or 'none'} apostrophe={quote} "
          f"trailing_ws={v != v.rstrip()}")
    if found or ctrl:
        fails.append(f"invisible/control characters in {k}")
    if "'" in v:
        fails.append(f"straight apostrophe in {k} (style guide requires U+2019)")
    if v != v.rstrip() or v != v.lstrip():
        fails.append(f"leading/trailing whitespace in {k}")

check("few" not in [c for k in NEW_KEYS for c in CAT.findall(fr[k])], "new keys carry no ICU at all",
      str([k for k in NEW_KEYS if SEL.search(fr[k])]))

# 7b. encoding / normalisation (style guide: U+2019, NFC, no BOM)
import unicodedata
non_nfc = [k for k in NEW_KEYS if unicodedata.normalize("NFC", fr[k]) != fr[k]]
check(non_nfc == [], "all new values are NFC-normalised", str(non_nfc))
double_space = [k for k in NEW_KEYS if "  " in fr[k]]
check(double_space == [], "no double spaces in new values", str(double_space))
raw_fr = open(FR, "rb").read()
check(not raw_fr.startswith(b"\xef\xbb\xbf"), "fr catalogue has no UTF-8 BOM")
check(all(k in raw_fr.decode("utf-8") for k in NEW_KEYS), "fr catalogue decodes as UTF-8")

# 8. fit: longest new fr values
lengths = sorted(((len(fr[k]), k) for k in NEW_KEYS), reverse=True)
print("\n-- longest new fr values (chars) --")
for n, k in lengths[:6]:
    print(f"{n:>3}  {k} = {fr[k]!r}")
print("en max:", max(len(en[k]) for k in NEW_KEYS))

# 9. context sidecar coverage + machine fields
missing_ctx = [k for k in NEW_KEYS if k not in ctx]
check(missing_ctx == [], "context sidecar covers all 20 new keys", str(missing_ctx))
for k in NEW_KEYS:
    e = ctx.get(k, {})
    if not all(f in e for f in ("role", "tone", "note", "length")):
        fails.append(f"context entry missing a field for {k}")
check(all(all(f in ctx.get(k, {}) for f in ("role", "tone", "note", "length")) for k in NEW_KEYS),
      "every new context entry carries role/tone/note/length")
raw_ctx = open(CTX, encoding="utf-8").read()
check("maxCells" not in raw_ctx, "no machine maxCells field in the ui.library context sidecar",
      f"maxCells occurrences: {raw_ctx.count('maxCells')}")

print("\nRESULT:", "ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILURE(S): {fails}")
sys.exit(0 if not fails else 1)
