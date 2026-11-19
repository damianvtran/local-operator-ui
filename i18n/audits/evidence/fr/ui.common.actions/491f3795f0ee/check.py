#!/usr/bin/env python3
"""Mechanical checks for the fr delta audit of ui.common.actions.actions_for_name.

Read-only: opens files, runs `git`/`shasum` as subprocesses, writes nothing.
Every check prints its actual result; the script exits non-zero only if a
hard mechanical invariant fails (hash, key set, placeholder, JSON).

Run from the read-only worktree root:
  python3 fr-ds-491f3795f0ee-check.py
"""

import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

REPO = Path.home() / "local-operator-ui/.worktrees/i18n-s8"
EXPECTED = Path.home() / (
    "local-operator-ui/.worktrees/_s12-audits/"
    "b8f0fc3aa922b99c6fad9c32edd36515fbd24e5a/expected-hashes.json"
)
HEAD_EXPECTED = "b8f0fc3aa922b99c6fad9c32edd36515fbd24e5a"
PRIOR_HEAD = "e5fb4310dab638f9cf428779d62539ec039a8990"
NS = "ui.common.actions"
KEY = "ui.common.actions.actions_for_name"
EN = REPO / f"src/i18n/catalogues/en/{NS}.json"
FR = REPO / f"src/i18n/catalogues/fr/{NS}.json"
CTX = REPO / f"src/i18n/catalogues/en/{NS}.context.json"

failures = []


def run(cmd):
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, check=False)


def fail(msg):
    failures.append(msg)
    print(f"  FAIL {msg}")


def ok(msg):
    print(f"  ok   {msg}")


print("1. Head")
head = run(["git", "rev-parse", "HEAD"]).stdout.strip()
print(f"  HEAD = {head}")
if head != HEAD_EXPECTED:
    fail(f"head {head} != frozen {HEAD_EXPECTED}")
else:
    ok("head matches the frozen head in the brief")
st = run(["git", "status", "--porcelain"]).stdout
ok("worktree clean (git status --porcelain empty)") if not st.strip() else fail(
    f"worktree dirty: {st!r}"
)

print("2. sha256 vs manager expected-hashes.json")
expected = json.loads(EXPECTED.read_text())["hashes"]
for rel, path in (
    (f"en/{NS}", EN),
    (f"fr/{NS}", FR),
    (f"en/{NS}.context", CTX),
):
    got = run(["shasum", "-a", "256", str(path)]).stdout.split()[0]
    want = expected.get(rel)
    print(f"  {rel}: {got} (expected {want})")
    if got != want:
        fail(f"hash mismatch for {rel}")
    else:
        ok(f"{rel} hash matches expected-hashes.json")

print("3. JSON validity + key-set parity")
en = json.loads(EN.read_text())
fr = json.loads(FR.read_text())
ctx = json.loads(CTX.read_text())
ok(f"both files parse as JSON ({len(en)} en keys, {len(fr)} fr keys)")
if set(en) != set(fr):
    fail(f"key sets differ: {sorted(set(en) ^ set(fr))}")
else:
    ok("fr key set == en key set")
if KEY not in fr:
    fail(f"{KEY} missing from fr")
if KEY not in ctx:
    fail(f"{KEY} missing from context sidecar")
else:
    ok("key present in both files and in the context sidecar")

print("4. The delta is exactly one line (git diff prior head..HEAD)")
diff = run(
    ["git", "diff", "--unified=0", f"{PRIOR_HEAD}..HEAD", "--", str(FR)]
).stdout
changed = [l for l in diff.splitlines() if l.startswith(("-", "+")) and not l.startswith(("---", "+++"))]
print("  changed lines:")
for line in changed:
    print(f"    {line}")
if len(changed) != 2:
    fail(f"expected exactly one removed and one added line, saw {len(changed)}")
else:
    ok("exactly one value changed, nothing else in the file")
en_diff = run(["git", "diff", "--unified=0", f"{PRIOR_HEAD}..HEAD", "--", str(EN), str(CTX)]).stdout
ok("English catalogue and context sidecar unchanged since prior head") if not en_diff.strip() else fail(
    "English source or context sidecar moved since the prior head"
)

print("5. Placeholder parity and grammar-safety of the inserted string")
src = en[KEY]
val = fr[KEY]
ph = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
en_args = ph.findall(src)
fr_args = ph.findall(val)
print(f"  en={src!r} placeholders={en_args}")
print(f"  fr={val!r} placeholders={fr_args}")
if en_args != fr_args:
    fail(f"placeholder parity broken: {en_args} vs {fr_args}")
elif val.count("{name}") != 1:
    fail("{name} must appear exactly once")
else:
    ok("placeholder names, order and count identical; {name} byte-exact once")
if re.search(r"\{\s*(name|\w+)\s*,\s*(plural|select)", val):
    fail("ICU plural/select present where the English has none")
else:
    ok("no ICU plural/select structure (English has none; CLDR categories not applicable)")

print("6. Invisible / bidi / spacing characters in the value")
invisible = [
    (f"U+{ord(c):04X} {unicodedata.name(c, '?')}")
    for c in val
    if unicodedata.category(c) == "Cf" or c in "\u00a0\u202f\u200b\u200e\u200f\u2066\u2067\u2068\u2069"
]
if invisible:
    fail(f"invisible characters in value: {invisible}")
else:
    ok(f"no invisible, bidi or non-breaking-space characters (all ASCII: {val.isascii()})")
print(f"  length = {len(val)} chars; trailing punctuation/whitespace = {val != val.rstrip(' .:;,!?')!r}")
if val != val.rstrip():
    fail("trailing whitespace")
else:
    ok("no trailing whitespace or punctuation")

print("7. Corpus consistency: how this English sentence is rendered elsewhere in fr")
cat = REPO / "src/i18n/catalogues"
same_sentence = []
for en_file in sorted((cat / "en").glob("*.json")):
    fr_file = cat / "fr" / en_file.name
    if not fr_file.exists():
        continue
    e = json.loads(en_file.read_text())
    f = json.loads(fr_file.read_text())
    for k, v in e.items():
        if v == "Actions for {name}" and k in f:
            same_sentence.append((k, f[k]))
for k, v in same_sentence:
    marker = "pour" if v.startswith("Actions pour {name}") else "OTHER"
    print(f"  [{marker}] {k} = {v!r}")
pour = sum(1 for _, v in same_sentence if v == "Actions pour {name}")
print(f"  {pour}/{len(same_sentence)} renderings of \"Actions for {{name}}\" are exactly 'Actions pour {{name}}'")
if pour != len(same_sentence):
    fail("the corpus is not unanimous on 'Actions pour {name}'")
else:
    ok("unanimous: every shipped rendering of this English sentence is 'Actions pour {name}'")

print("8. 'sur' vs 'pour' split in the fr corpus")
sur_ph = re.compile(r"sur \{")
all_vals = []
for fr_file in sorted((cat / "fr").glob("*.json")):
    f = json.loads(fr_file.read_text())
    for k, v in f.items():
        if isinstance(v, str) and sur_ph.search(v):
            all_vals.append((fr_file.name, k, v))
print(f"  'sur {{placeholder}}' occurrences: {len(all_vals)}")
for name, k, v in all_vals[:8]:
    print(f"    {name}: {k} = {v!r}")
print("  'Actions sur …' (article-bearing generic labels):")
for fr_file in sorted((cat / "fr").glob("*.json")):
    f = json.loads(fr_file.read_text())
    for k, v in f.items():
        if isinstance(v, str) and v.startswith("Actions sur"):
            print(f"    {fr_file.name}: {k} = {v!r}")

print("9. Style-guide and glossary identity")
for p in (
    Path.home() / "local-operator/i18n/style-guides/fr.md",
    Path.home()
    / "local-operator-ui/.worktrees/_s12-audits/"
    "b8f0fc3aa922b99c6fad9c32edd36515fbd24e5a/glossary.md",
    Path.home() / "local-operator/i18n/glossary.md",
):
    print(f"  {run(['shasum', '-a', '256', str(p)]).stdout.strip()}")

print()
if failures:
    print(f"RESULT: {len(failures)} mechanical failure(s)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("RESULT: all mechanical checks passed")
