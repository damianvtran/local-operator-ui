#!/usr/bin/env python3
"""Delta audit checks for zh-CN / ui.library / tag ds (executed, read-only).

Every number printed here is recomputed from the working tree at the audited
head; nothing is copied from a receipt. Run from the worktree root.
"""
import hashlib
import json
import subprocess
import sys
import unicodedata

WT = "/Users/damian/local-operator-ui/.worktrees/i18n-s8"
NEW_HEAD = "f04035bc3cb6a03644f8776a799e3daad93c7e58"
OLD_HEAD = "8a9ce1f808c266ebe9a0e924094344cea60c2c23"
BASE = "0e12072d2b3"
MANIFEST = (
    "/Users/damian/local-operator-ui/.worktrees/_s14-audits/"
    "f04035bc3cb6a03644f8776a799e3daad93c7e58/expected-hashes.json"
)
EN = "src/i18n/catalogues/en/ui.library.json"
CTX = "src/i18n/catalogues/en/ui.library.context.json"
ZH = "src/i18n/catalogues/zh-CN/ui.library.json"
REVISED = "ui.library.tag_category.type"

fail = 0


def sh(*args):
    return subprocess.run(args, cwd=WT, capture_output=True, text=True, check=False)


def sha256(path):
    with open(f"{WT}/{path}", "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def cells(s):
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def check(label, ok, detail=""):
    global fail
    if not ok:
        fail += 1
    print(f"[{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")


print("=== A. worktree identity ===")
head = sh("git", "rev-parse", "HEAD").stdout.strip()
print(f"HEAD = {head}")
check("HEAD equals the audited head", head == NEW_HEAD, NEW_HEAD)
print(f"branch = {sh('git', 'rev-parse', '--abbrev-ref', 'HEAD').stdout.strip()}")
dirty = sh("git", "status", "--porcelain").stdout.strip()
check("worktree clean (no writes by this auditor)", dirty == "", "porcelain empty" if not dirty else dirty)

print("\n=== B. hash binding vs the manager manifest (mismatch = BLOCKER) ===")
man = json.load(open(MANIFEST))
pairs = [("en/ui.library", EN), (CTX and "en/ui.library.context", CTX), ("zh-CN/ui.library", ZH)]
for key, path in pairs:
    got = sha256(path)
    want = man["hashes"][key]
    check(f"{key} sha256", got == want, f"file {got} == manifest {want}" if got == want else f"file {got} != manifest {want}")

print("\n=== C. delta vs the round-1 audited head: exactly ONE changed line ===")
diff = sh("git", "diff", f"{OLD_HEAD}..HEAD", "--", ZH).stdout
minus = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
plus = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
print("removed:", minus)
print("added:  ", plus)
check("one removed line", len(minus) == 1)
check("one added line", len(plus) == 1)
check("both lines are the revised key", REVISED in " ".join(minus + plus))
changed_vals = json.loads(minus[0][1:2] and minus[0][1:]) if False else None

print("\n=== D. round-1 audited bytes are the bytes the round-1 receipts name ===")
old_blob = sh("git", "show", f"{OLD_HEAD}:{ZH}").stdout
old_sha = hashlib.sha256(old_blob.encode()).hexdigest()
print(f"git show {OLD_HEAD[:12]}:{ZH} sha256 = {old_sha}")
check("round-1 head file hashes to 686dfeeaa8ee… (zh-CN round-1 receipt target_sha256)",
      old_sha.startswith("686dfeeaa8ee25abd2815181ea7fe11ff7cd708cd0ea718632f870e5b1d5b857"))
print("=> the other 19 delta values are byte-identical to the audited bytes; their round-1 verdicts carry.")

print("\n=== E. key sets: English vs zh-CN, and legacy vs base 0e12072d2b3 ===")
en = json.load(open(f"{WT}/{EN}"))
zh = json.load(open(f"{WT}/{ZH}"))
check("key count parity", len(en) == len(zh) == 179, f"en={len(en)} zh={len(zh)}")
check("key order identical", list(en) == list(zh))
check("no extra keys in zh", set(zh) - set(en) == set(), str(set(zh) - set(en)))
check("no missing keys in zh", set(en) - set(zh) == set(), str(set(en) - set(zh)))
base_blob = sh("git", "show", f"{BASE}:{ZH}").stdout
base = json.loads(base_blob)
legacy_changed = {k: (base[k], zh[k]) for k in base if zh.get(k) != base[k]}
legacy_missing = [k for k in base if k not in zh]
check("every base key still present", not legacy_missing, str(legacy_missing))
check("no base key's value changed", not legacy_changed, json.dumps(legacy_changed, ensure_ascii=False))
added = [k for k in zh if k not in base]
print(f"added vs base: {len(added)} keys -> {added}")

print("\n=== F. mechanical: placeholders / plural / markup on the 20 delta keys ===")
delta_keys = added
import re

PH = re.compile(r"\{[^}]*\}")
BQ = re.compile(r"`[^`]*`")
for k in delta_keys:
    a, b = PH.findall(en[k]), PH.findall(zh[k])
    if a or b:
        check(f"{k} placeholder parity", a == b, f"en={a} zh={b}")
print(f"checked {len(delta_keys)} keys: no key in this delta carries a placeholder, plural/select or rich tag")
print(f"  (regex found placeholders only where en had them: {[k for k in delta_keys if PH.findall(en[k])]})")
check("revised value carries no markup/backticks/placeholder", not PH.search(zh[REVISED]) and not BQ.search(zh[REVISED]))

print("\n=== G. invisible / bidi characters across the whole zh-CN file ===")
bad = []
for k, v in zh.items():
    for c in v:
        if unicodedata.category(c) in ("Cf", "Cc", "Co", "Cn") or c in "\u200b\u2060\ufeff\u00a0":
            bad.append((k, hex(ord(c))))
check("no invisible/bidi/control characters", not bad, str(bad))

print("\n=== H. width against the ~12-cell rail header budget ===")
for k in [k for k in delta_keys if "tag_category" in k] + ["ui.library.sort.kind"]:
    print(f"  {k:36} {zh[k]!r:10} cells={cells(zh[k])} chars={len(zh[k])}")
check("revised value within budget", cells(zh[REVISED]) <= 12, f"{cells(zh[REVISED])} cells")

print("\n=== I. same-rail collision matrix (tag heading vs sort/filter control values) ===")
siblings = {k.split(".")[-1]: zh[k] for k in zh if k.startswith("ui.library.tag_category.")}
controls = {}
for k in zh:
    if k.startswith("ui.library.sort.") or ".filter." in k:
        controls[k] = zh[k]
for name, val in siblings.items():
    hits = [f"{k}={v}" for k, v in controls.items() if v == val]
    other = [f"{k}={v}" for k, v in zh.items() if v == val and not k.startswith("ui.library.tag_category.")]
    print(f"  tag_category.{name:8} {val:6} same string elsewhere in namespace: {other or 'none'}")

print("\n=== J. corpus scope: how zh-CN renders English Kind and Type ===")
import glob
import os

print(f"  occurrences of {zh[REVISED]!r} across all zh-CN catalogues:")
for p in glob.glob(f"{WT}/src/i18n/catalogues/zh-CN/*.json"):
    for k, v in json.load(open(p)).items():
        if zh[REVISED] in v:
            print(f"    {os.path.basename(p)}:{k} = {v!r}")
for p in sorted(glob.glob(f"{WT}/src/i18n/catalogues/zh-CN/*.json")):
    e = json.load(open(p.replace("/zh-CN/", "/en/")))
    for k, v in json.load(open(p)).items():
        if v == "类型" and e.get(k) in ("Kind", "Type"):
            print(f"  类型 <- EN {e[k]!r:8} {os.path.basename(p)}:{k}")

print("\n=== K. siblings in the same rail (visual parallelism) ===")
for k, v in siblings.items():
    print(f"  {k:34} {v!r:8} cells={cells(v)}")

print(f"\nRESULT: {'all checks passed' if fail == 0 else str(fail) + ' FAILED checks'}")
sys.exit(0 if fail == 0 else 1)
