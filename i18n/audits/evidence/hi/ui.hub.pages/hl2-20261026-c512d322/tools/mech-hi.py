#!/usr/bin/env python3
"""Mechanical digest for the hi agents-literals-2 audit (read-only).

Quotes what it measures; prints a compact digest for the receipt's machine_checks.
"""
import json
import re
import subprocess
import hashlib
import sys

REPO = "/Users/damian/local-operator-ui/.worktrees/i18n-agents-literals-2"
NS = [
    "ui.agents.pages",
    "ui.agents.config",
    "ui.agents.detail",
    "ui.agents.upload",
    "ui.hub.pages",
    "ui.hub.teams",
    "ui.common.actions",
]
PARENT = "73af0b6855"


def load(path, root=REPO):
    with open(f"{root}/{path}", "rb") as fh:
        raw = fh.read()
    return json.loads(raw), raw


def icu_args(s):
    """Top-level ICU argument names -> type/categories, plus body order."""
    out, cats = [], {}
    depth = 0
    start = 0
    for i, c in enumerate(s):
        if c == "{":
            if depth == 0:
                start = i + 1
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                body = s[start:i]
                name = body.split(",")[0].strip()
                out.append(name)
                m = re.match(r"^[^,]+,\s*(plural|select|selectordinal)\s*,(.*)$", body, re.S)
                if m:
                    cats[name] = (
                        m.group(1),
                        tuple(sorted(re.findall(r"(?:^|[\s}])(zero|one|two|few|many|other)\s*\{", m.group(2)))),
                    )
    return out, cats


fails = []
lines = []

# 1. key set and order
for ns in NS:
    en, _ = load(f"src/i18n/catalogues/en/{ns}.json")
    hi, _ = load(f"src/i18n/catalogues/hi/{ns}.json")
    same_set = set(en) == set(hi)
    same_order = list(en) == list(hi)
    lines.append(
        f"  {ns:18} keys en={len(en):3} hi={len(hi):3} set_equal={same_set} order_equal={same_order}"
    )
    if not (same_set and same_order):
        fails.append(f"{ns}: key set/order differs from en")

# 2. placeholders + ICU categories + empties
ph_bad, empty_bad = [], []
plural_report = []
for ns in NS:
    en, _ = load(f"src/i18n/catalogues/en/{ns}.json")
    hi, _ = load(f"src/i18n/catalogues/hi/{ns}.json")
    for k, v in en.items():
        (ae, ce), (ah, ch) = icu_args(v), icu_args(hi[k])
        if sorted(ae) != sorted(ah) or ce != ch:
            ph_bad.append((ns, k, ae, ah, ce, ch))
    for k, v in hi.items():
        if not isinstance(v, str) or not v.strip():
            empty_bad.append((ns, k))
        if ", plural" in v:
            cats = tuple(sorted(set(re.findall(r"(zero|one|two|few|many|other)\s*\{", v))))
            plural_report.append((ns, k, cats))
lines.append(f"  placeholder multiset mismatches: {len(ph_bad)}  (args compared as multisets; ICU type+categories compared per name)")
lines.append(f"  empty values: {len(empty_bad)}")
for ns, k, cats in plural_report:
    lines.append(f"  hi plural {k}: categories={list(cats)}")
    if not {"one", "other"} <= set(cats):
        fails.append(f"{k}: hi CLDR categories missing one/other")
if ph_bad:
    fails.append(f"placeholder mismatches: {ph_bad}")
if empty_bad:
    fails.append(f"empty values: {empty_bad}")

# 3. typography on the 25 new keys
keys25 = json.load(open(f"{REPO}/agents-literals-2-keys.json"))["keys"]
new = {k["key"] for k in keys25}
typ_bad, legacy = [], {"ascii_quote": 0, "three_dots": 0}
for ns in NS:
    hi, _ = load(f"src/i18n/catalogues/hi/{ns}.json")
    for k, v in hi.items():
        if '"' in v:
            legacy["ascii_quote"] += 1
        if "..." in v:
            legacy["three_dots"] += 1
        if k in new:
            probs = []
            if '"' in v:
                probs.append("ASCII double quote")
            if "'" in v:
                probs.append("ASCII apostrophe")
            if "..." in v:
                probs.append("ASCII three dots")
            if probs:
                typ_bad.append((k, probs, v))
lines.append(f"  25 new keys: typography breaches = {len(typ_bad)} (ASCII \" / ASCII ' / ... ; U+2026 and “ ” required)")
lines.append(
    f"  legacy breaches still present in these 7 files (pre-existing, byte-identical to {PARENT}): "
    f"{legacy['ascii_quote']} value(s) with ASCII double quote, {legacy['three_dots']} with '...'"
)
if typ_bad:
    fails.append(f"new-key typography: {typ_bad}")

# 4. pre-existing values byte-equal to the parent commit
changed, newkeys, total, missing_parent = [], 0, 0, []
for ns in NS:
    path = f"src/i18n/catalogues/hi/{ns}.json"
    old = subprocess.run(
        ["git", "-C", REPO, "show", f"{PARENT}:{path}"], capture_output=True, text=True
    )
    if old.returncode != 0:
        missing_parent.append(path)
        continue
    o = json.loads(old.stdout)
    hi, _ = load(path)
    for k, v in hi.items():
        total += 1
        if k not in o:
            newkeys += 1
        elif o[k] != v:
            changed.append(k)
    for k in o:
        if k not in hi:
            changed.append(f"removed:{k}")
lines.append(
    f"  vs parent {PARENT}: keys now={total}, new={newkeys}, pre-existing changed/removed={len(changed)}"
)
if changed:
    fails.append(f"pre-existing values changed: {changed}")
if missing_parent:
    fails.append(f"parent file missing: {missing_parent}")
if newkeys != len(new):
    fails.append(f"new-key count {newkeys} != sidecar 25 ({len(new)})")

print("MECHANICAL DIGEST (hi, 7 namespaces, 25 new keys)")
print("\n".join(lines))
print()
print("FAILS:", fails if fails else "none")
sys.exit(1 if fails else 0)
