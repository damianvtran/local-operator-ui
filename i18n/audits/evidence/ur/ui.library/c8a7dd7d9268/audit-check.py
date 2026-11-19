#!/usr/bin/env python3
"""Read-only mechanical checks for the ur delta audit (ui.library, 20 new keys).

Derives, without trusting the translator or the manager's manifest:
  - base-vs-head key deltas for en, ur and the en context sidecar (additions only?)
  - key-set parity en vs ur
  - placeholder tokens identical to source
  - ICU plural/select categories (ur = one/other) and structural validity
  - invisible / bidi / format characters in the new values
  - value lengths and non-Latin script, for the ~12-char badge slot
Writes nothing.
"""
import json
import re
import subprocess
import sys

REPO = "/Users/damian/local-operator-ui/.worktrees/i18n-s8"
BASE = "0e12072d2b3"
KEYS = [
    "ui.library.kind.audio", "ui.library.kind.code", "ui.library.kind.docx",
    "ui.library.kind.html", "ui.library.kind.image", "ui.library.kind.markdown",
    "ui.library.kind.other", "ui.library.kind.pdf", "ui.library.kind.pptx",
    "ui.library.kind.spreadsheet", "ui.library.kind.text", "ui.library.kind.video",
    "ui.library.tag_category.custom", "ui.library.tag_category.format",
    "ui.library.tag_category.project", "ui.library.tag_category.source",
    "ui.library.tag_category.status", "ui.library.tag_category.topic",
    "ui.library.tag_category.type", "ui.library.preview.unsupported_generic",
]
FILES = {
    "en": "src/i18n/catalogues/en/ui.library.json",
    "ur": "src/i18n/catalogues/ur/ui.library.json",
    "context": "src/i18n/catalogues/en/ui.library.context.json",
}


def load(path):
    with open(f"{REPO}/{path}", encoding="utf-8") as fh:
        return json.load(fh)


def load_base(path):
    out = subprocess.run(
        ["git", "-C", REPO, "show", f"{BASE}:{path}"],
        capture_output=True, check=True,
    )
    return json.loads(out.stdout.decode("utf-8"))


def main():
    head = {k: load(p) for k, p in FILES.items()}
    base = {k: load_base(p) for k, p in FILES.items()}

    print("== head ==")
    for k, v in head.items():
        print(f"  {k}: {len(v)} keys")
    print("== base ==")
    for k, v in base.items():
        print(f"  {k}: {len(v)} keys")

    print("\n== base -> head deltas (additions only expected) ==")
    for name in ("en", "ur", "context"):
        added = sorted(set(head[name]) - set(base[name]))
        removed = sorted(set(base[name]) - set(head[name]))
        changed = sorted(
            k for k in set(base[name]) & set(head[name])
            if base[name][k] != head[name][k]
        )
        print(f"  {name}: +{len(added)} -{len(removed)} ~{len(changed)}")
        if removed:
            print(f"    REMOVED: {removed}")
        if changed:
            print(f"    CHANGED: {changed}")
        missing = [k for k in KEYS if k not in added]
        if missing:
            print(f"    NEW-KEYS-NOT-ADDED-VS-BASE: {missing}")

    print("\n== key-set parity en vs ur ==")
    print(f"  equal={set(head['en']) == set(head['ur'])}, "
          f"en={len(head['en'])}, ur={len(head['ur'])}")
    print(f"  context covers en: {set(head['en']) == set(head['context'])}")

    PH = re.compile(r"\{[a-zA-Z0-9_]+\}")
    ICU = re.compile(r"\{\s*([a-zA-Z0-9_]+)\s*,(plural|select|selectordinal)\s*,")
    INVISIBLE = {
        0x00A0: "NBSP", 0x202F: "NNBSP", 0x200B: "ZWSP", 0x200C: "ZWNJ",
        0x200D: "ZWJ", 0x200E: "LRM", 0x200F: "RLM", 0x2066: "LRI",
        0x2067: "RLI", 0x2068: "FSI", 0x2069: "PDI", 0x061C: "ALM",
        0x00AD: "SHY", 0x202A: "LRE", 0x202B: "RLE", 0x202C: "PDF",
        0x202D: "LRO", 0x202E: "RLO", 0x2060: "WJ", 0xFEFF: "BOM",
    }
    ARABIC = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")

    print("\n== per-key mechanical checks ==")
    problems = []
    for key in KEYS:
        en, ur = head["en"][key], head["ur"][key]
        ph_e, ph_u = sorted(PH.findall(en)), sorted(PH.findall(ur))
        icu_e, icu_u = ICU.findall(en), ICU.findall(ur)
        invis = [
            f"U+{ord(ch):04X} {INVISIBLE[ord(ch)]}"
            for ch in ur if ord(ch) in INVISIBLE
        ]
        cats_u = sorted(set(re.findall(
            r"\{\s*[a-zA-Z0-9_]+\s*,\s*(?:plural|select)\s*,([^}]*)\}", ur)))
        arabic = bool(ARABIC.search(ur))
        latin = bool(re.search(r"[A-Za-z]", ur))
        note = []
        if ph_e != ph_u:
            note.append(f"PLACEHOLDER-DIFF {ph_e} != {ph_u}")
        if bool(icu_e) != bool(icu_u):
            note.append(f"ICU-DIFF {icu_e} vs {icu_u}")
        if invis:
            note.append(f"INVISIBLE {invis}")
        if not ur.strip():
            note.append("EMPTY")
        if len(ur) > 12:
            note.append(f"OVER-12 ({len(ur)})")
        problems += [f"{key}: {n}" for n in note]
        print(
            f"  {key:44s} len(en)={len(en):2d} len(ur)={len(ur):2d} "
            f"ph={ph_u or '-'} arabic={arabic} latin={latin} "
            f"icu={'yes' if icu_u else 'no'}"
            + ("  <<< " + "; ".join(note) if note else "")
        )

    print("\n== ur values that stay Latin (retained tokens) ==")
    for key in KEYS:
        ur = head["ur"][key]
        if ur and not ARABIC.search(ur):
            print(f"  {key}: {ur!r}")

    print("\n== trailing punctuation ==")
    for key in KEYS:
        en, ur = head["en"][key], head["ur"][key]
        if en.rstrip()[-1:] in ".!?" or ur.rstrip()[-1:] in ".!?۔؟":
            print(f"  {key}: en={en!r} ur={ur!r}")

    print("\n== PROBLEMS ==")
    print("  none" if not problems else "\n".join(f"  {p}" for p in problems))
    return 0


if __name__ == "__main__":
    sys.exit(main())
