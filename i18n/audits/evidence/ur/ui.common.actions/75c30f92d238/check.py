#!/usr/bin/env python3
"""Read-only mechanical checks for the ur audit of PR #1842 @ e5fb4310.

Every check reads files under the pinned worktree
~/local-operator-ui/.worktrees/i18n-s8 (frozen head) and the manager-owned
glossary byte-copy. Nothing here writes to the repository.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import unicodedata

ROOT = pathlib.Path.home() / "local-operator-ui/.worktrees/i18n-s8"
AUD = pathlib.Path.home() / "local-operator-ui/.worktrees/_s12-audits/e5fb4310dab638f9cf428779d62539ec039a8990"
CAT = ROOT / "src/i18n/catalogues"

NEW = {
    "ui.chat": ["ui.chat.image_actions.actions", "ui.chat.audio.position_label"],
    "ui.chat.composer_media": ["ui.chat.composer_media.pasted_image"],
    "ui.common.actions": ["ui.common.actions.actions_for_name"],
}


def sha(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


def visible(s):
    return "".join(c if unicodedata.category(c) != "Cf" else f"<{unicodedata.name(c)}>" for c in s)


print("== head ==")
print(subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip())
print(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or "(clean)")

print("\n== input hashes vs expected-hashes.json ==")
expected = json.loads((AUD / "expected-hashes.json").read_text())["hashes"]
ok = True
inputs = {}
for ns in NEW:
    for loc, kind in (("en", "cat"), ("ur", "cat")):
        p = CAT / loc / f"{ns}.json"
        h = sha(p)
        inputs[(loc, ns)] = h
        match = h == expected[f"{loc}/{ns}"]
        ok &= match
        print(f"{loc}/{ns}: {h} {'MATCH' if match else 'MISMATCH expected ' + expected[f'{loc}/{ns}']}")
    p = CAT / "en" / f"{ns}.context.json"
    h = sha(p)
    inputs[("context", ns)] = h
    match = h == expected[f"en/{ns}.context"]
    ok &= match
    print(f"en/{ns}.context: {h} {'MATCH' if match else 'MISMATCH expected ' + expected[f'en/{ns}.context']}")
print("ALL HASHES MATCH" if ok else "HASH MISMATCH PRESENT")

print("\n== glossary byte-copy ==")
g = AUD / "glossary.md"
print("copy", sha(g), "source", sha(pathlib.Path.home() / "local-operator/i18n/glossary.md"), "lines", len(g.read_text().splitlines()))

print("\n== per-namespace structural checks ==")
for ns, keys in NEW.items():
    en = json.loads((CAT / "en" / f"{ns}.json").read_text())
    ur = json.loads((CAT / "ur" / f"{ns}.json").read_text())
    print(f"{ns}: json ok; en keys={len(en)} ur keys={len(ur)} same_set={set(en) == set(ur)}")
    missing = set(en) - set(ur)
    extra = set(ur) - set(en)
    print(f"  missing={sorted(missing)} extra={sorted(extra)}")
    d = subprocess.run(["git", "diff", "--numstat", "origin/main", "HEAD", "--", f"src/i18n/catalogues/ur/{ns}.json"],
                       cwd=ROOT, capture_output=True, text=True).stdout.strip()
    print(f"  git diff --numstat origin/main HEAD: {d}")

print("\n== the four audited values ==")
for ns, keys in NEW.items():
    en = json.loads((CAT / "en" / f"{ns}.json").read_text())
    ur = json.loads((CAT / "ur" / f"{ns}.json").read_text())
    ctx = json.loads((CAT / "en" / f"{ns}.context.json").read_text())
    for k in keys:
        src, tgt = en[k], ur[k]
        phs = sorted(re.findall(r"\{[^}]*\}", src))
        pht = sorted(re.findall(r"\{[^}]*\}", tgt))
        ctrl = [(hex(ord(c)), unicodedata.name(c, "?")) for c in tgt
                if unicodedata.category(c) in ("Cf", "Zs") and c != " "]
        print(f"\n{k}")
        print(f"  EN  {src!r}")
        print(f"  UR  {tgt!r}")
        print(f"  role={ctx.get(k, {}).get('role')!r} maxCells={ctx.get(k, {}).get('maxCells')}")
        print(f"  placeholders en={phs} ur={pht} identical={phs == pht}")
        print(f"  invisible/space-control chars: {ctrl or 'none'}")
        print(f"  codepoints: {' '.join(f'U+{ord(c):04X}' for c in tgt)}")
        print(f"  chars={len(tgt)} words={len(tgt.split())}")

print("\n== term usage across the whole ur catalogue ==")
ur_files = sorted((CAT / "ur").glob("*.json"))
for term in ["اعمال", "اقدامات", "پوزیشن", "مقام"]:
    n = sum(p.read_text().count(term) for p in ur_files)
    files = [p.name for p in ur_files if term in p.read_text()]
    print(f"  {term}: {n} occurrence(s) in {len(files)} file(s): {files if n and n < 6 else files[:6]}")

print("\n== citations: existing sibling values ==")
sibs = {
    ("ui.chat.composer_media", "ui.chat.composer_media.pasted_file"),
    ("ui.chat.composer_media", "ui.chat.composer_media.pasted_type"),
    ("ui.chat.attachments", "ui.chat.attachments.playback_position"),
    ("ui.chat", "ui.chat.image_actions.copy_image"),
    ("ui.chat", "ui.chat.audio.play_label"),
    ("ui.chat", "ui.chat.audio.pause_label"),
    ("ui.common.actions", "ui.common.actions.file_actions_menu.file_actions"),
    ("ui.settings.integrations", "ui.settings.integrations.integration_row.more_actions_for_name"),
    ("ui.projects", "ui.projects.project_updates.file_actions_for_name"),
}
for ns, k in sorted(sibs):
    v = json.loads((CAT / "ur" / f"{ns}.json").read_text())[k]
    print(f"  {k} = {v!r}")

print("\n== bidi / zero-width scan over every ur catalogue file ==")
bad = {"\u200e", "\u200f", "\u2066", "\u2067", "\u2068", "\u2069", "\u200b", "\u200c", "\u200d", "\u00a0", "\u202f", "\ufeff"}
hits = [(p.name, hex(ord(c))) for p in ur_files for c in p.read_text() if c in bad]
print(f"  {len(hits)} hit(s)")
