#!/usr/bin/env python3
"""Executed checks for the ur delta audit of ui.chat.audio.position_label.

Read-only against ~/local-operator-ui/.worktrees/i18n-s8. Prints every
measurement the receipt cites; no repository writes.
"""
import json, re, pathlib, unicodedata, hashlib

WT = pathlib.Path.home() / "local-operator-ui/.worktrees/i18n-s8"
CAT = WT / "src/i18n/catalogues"
KEY = "ui.chat.audio.position_label"
NS = "ui.chat"

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

en = load(CAT / "en" / f"{NS}.json")
ur = load(CAT / "ur" / f"{NS}.json")

print("== key set parity ==")
print("en keys:", len(en), "ur keys:", len(ur))
print("sets equal:", set(en) == set(ur))
print("en-only:", sorted(set(en) - set(ur)))
print("ur-only:", sorted(set(ur) - set(en)))

PH = re.compile(r"\{([A-Za-z0-9_]+)\}")
src, tgt = en[KEY], ur[KEY]
print("\n== changed key ==")
print("EN:", repr(src))
print("UR:", repr(tgt))
print("EN placeholders:", PH.findall(src))
print("UR placeholders:", PH.findall(tgt))
print("placeholder multiset identical:", sorted(PH.findall(src)) == sorted(PH.findall(tgt)))
print("ICU plural/select in EN:", bool(re.search(r",\s*(plural|select|selectordinal)\s*,", src)))
print("ICU plural/select in UR:", bool(re.search(r",\s*(plural|select|selectordinal)\s*,", tgt)))
for name, val in (("EN", src), ("UR", tgt)):
    bad = [(hex(ord(c)), unicodedata.category(c), unicodedata.name(c, "?"))
           for c in val if unicodedata.category(c) in ("Cf", "Zs", "Mn", "Co") and c != " "]
    print(f"{name} invisible/control/combining chars:", bad or "none")
print("UR codepoints:", " ".join(f"U+{ord(c):04X}" for c in tgt))
print("UR cell width (1 cell/char, FSI/PDI cost 0):", len(tgt))
print("UR word count:", len(tgt.split()))

print("\n== context sidecar entry ==")
ctx = load(CAT / "en" / f"{NS}.context.json")
print(json.dumps(ctx.get(KEY), ensure_ascii=False, indent=1))

print("\n== sibling audio keys (register/term consistency) ==")
for k in sorted(en):
    if k.startswith("ui.chat.audio."):
        print(f"{k}\n  EN: {en[k]!r}\n  UR: {ur[k]!r}")

print("\n== 'position'-family values elsewhere in the ur catalogue ==")
bare = re.compile(r"مقام(?!ی|ات)")
posz = re.compile(r"پوزیشن")
hits = []
for f in sorted((CAT / "ur").glob("*.json")):
    d = load(f)
    ed = load(CAT / "en" / f.name) if (CAT / "en" / f.name).exists() else {}
    for k, v in d.items():
        if isinstance(v, str) and (bare.search(v) or posz.search(v)):
            hits.append((f.name, k, v, ed.get(k)))
for f, k, v, e in hits:
    tag = "POSITION-LOANWORD" if posz.search(v) else "maqam"
    print(f"[{tag}] {f} {k}\n   EN: {e!r}\n   UR: {v!r}")
print("bare-مقام value count:", sum(1 for h in hits if not posz.search(h[2])))
print("پوزیشن value count:", sum(1 for h in hits if posz.search(h[2])))

print("\n== hashes ==")
def sha(p):
    h = hashlib.sha256()
    h.update(pathlib.Path(p).read_bytes())
    return h.hexdigest()
for rel in (f"src/i18n/catalogues/en/{NS}.json",
            f"src/i18n/catalogues/ur/{NS}.json",
            f"src/i18n/catalogues/en/{NS}.context.json"):
    print(sha(WT / rel), rel)

print("\n== call site of the key (source, read-only) ==")
for rel in ("src/renderer/src/features/chat/components/supplement/sound-player.tsx",
            "src/renderer/src/features/chat/components/message-item/audio-attachment.tsx"):
    p = WT / rel
    if not p.exists():
        print("missing:", rel)
        continue
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if "position_label" in line or "playback_position" in line:
            print(f"{rel}:{i}: {line.strip()}")
