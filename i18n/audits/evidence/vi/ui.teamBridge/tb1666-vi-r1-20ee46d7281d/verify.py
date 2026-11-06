#!/usr/bin/env python3
"""Independent re-verification for the vi/ui.teamBridge VI-R1 key-level re-audit.

Derives every hash from the bytes on disk (never from the author's precomputed
claim), proves the delta is exactly one value, and proves the other 398 pairs are
byte-identical to the previously audited parent. Read-only: writes nothing.
The stdout of this script is the audit.log evidence for record
tb1666-vi-r1-20ee46d7281d.
"""

import hashlib
import json
import os
import re
import subprocess
import unicodedata

REPO = "/Users/damian/local-operator-ui/.worktrees/d1-d2-vi-r1"
KEY = "ui.teamBridge.builtin.general_topic"
PARENT_COMMIT = "ed33e22c23b"  # bytes audited by cb9d33604d15-pr1693-r1-vi
EXPECT_EN = "cea7787980b2d37643b0be8f8d1b0ab268dc7de71b268e18f5c2e6d65d7696a0"
EXPECT_VI = "bf8089bab58648ac2463194754d025acf8a376fbd5c14ac00549a6ec5fae68e9"
EXPECT_CTX = "a53286f062f4480c18963a6e4dfab55d3f528a9ac4c09e6642a920d00160030a"

os.chdir(REPO)
sha = lambda b: hashlib.sha256(b).hexdigest()
read = lambda p: open(p, "rb").read()
git = lambda spec: subprocess.run(["git", "show", spec], capture_output=True, check=True).stdout

en_b = read("src/i18n/catalogues/en/ui.teamBridge.json")
vi_b = read("src/i18n/catalogues/vi/ui.teamBridge.json")
ctx_b = read("src/i18n/catalogues/en/ui.teamBridge.context.json")
par_b = git(PARENT_COMMIT + ":src/i18n/catalogues/vi/ui.teamBridge.json")
par_en_b = git(PARENT_COMMIT + ":src/i18n/catalogues/en/ui.teamBridge.json")
par_ctx_b = git(PARENT_COMMIT + ":src/i18n/catalogues/en/ui.teamBridge.context.json")

en, vi, par = json.loads(en_b), json.loads(vi_b), json.loads(par_b)

print("== inputs re-hashed from disk ==")
print("en      %s  matches author claim: %s" % (sha(en_b), sha(en_b) == EXPECT_EN))
print("vi      %s  matches author claim: %s" % (sha(vi_b), sha(vi_b) == EXPECT_VI))
print("context %s  matches author claim: %s" % (sha(ctx_b), sha(ctx_b) == EXPECT_CTX))

print("")
print("== delta versus the previously audited parent (%s) ==" % PARENT_COMMIT)
print("parent target sha256 %s" % sha(par_b))
print("keys changed: %s" % [k for k in vi if vi[k] != par.get(k)])
print("keys added:   %s" % [k for k in vi if k not in par])
print("keys removed: %s" % [k for k in par if k not in vi])
print("key order identical: %s" % (list(vi) == list(par)))
print("en catalogue unchanged vs parent: %s" % (sha(en_b) == sha(par_en_b)))
print("en context unchanged vs parent:   %s" % (sha(ctx_b) == sha(par_ctx_b)))
print("key count target/en: %d/%d  set equal: %s" % (len(vi), len(en), sorted(vi) == sorted(en)))

proj = {k: v for k, v in vi.items() if k != KEY}
proj_b = json.dumps(proj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
print("unchanged-pair projection sha256: %s  (pairs: %d)" % (sha(proj_b), len(proj)))

s = vi[KEY]
print("")
print("== the audited value ==")
print("EN : %s" % en[KEY])
print("VI : %s" % s)
print("previous VI : %s" % par[KEY])
print("chars %d -> %d" % (len(par[KEY]), len(s)))
print("NFC (file): %s   NFC (value): %s" % (unicodedata.is_normalized("NFC", vi_b.decode()),
                                            unicodedata.normalize("NFC", s) == s))
print("format/bidi controls: %s" % [hex(ord(c)) for c in s if unicodedata.category(c) == "Cf"])
print("brace placeholders: %s" % re.findall(r"[{}]", s))
print("em/en dash present: %s" % bool(re.search("[\u2014\u2013]", s)))
print("term 'tác nhân' occurrences: %d" % len(re.findall("tác nhân", s, re.I)))

print("")
print("== namespace precedent for the '... mà tác nhân ...' construction ==")
n = 0
for k, v in vi.items():
    c = len(re.findall("tác nhân", v, re.I))
    if c >= 3:
        n += 1
print("values repeating 'tác nhân' 3+ times: %d" % n)
for k, v in vi.items():
    if "các luồng mà tác nhân" in v:
        print("same construction in: %s" % k)
