#!/usr/bin/env python3
"""Read-only mechanical checks for the vi delta audit (4 new keys, 3 namespaces).

Run from the pinned worktree root:
  python3 <this file>
Writes nothing; prints a digest. Judgement is the auditor's, not this script's.
"""

import json
import re
import subprocess
import unicodedata
from pathlib import Path

ROOT = Path("/Users/damian/local-operator-ui/.worktrees/i18n-s8")
NS = ["ui.chat", "ui.chat.composer_media", "ui.common.actions"]
LOC = "vi"
EN = "en"

NEW_KEYS = {
    "ui.chat.composer_media": ["ui.chat.composer_media.pasted_image"],
    "ui.chat": [
        "ui.chat.image_actions.actions",
        "ui.chat.audio.position_label",
    ],
    "ui.common.actions": ["ui.common.actions.actions_for_name"],
}

PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
INVISIBLE = {
    0x00A0: "NBSP",
    0x202F: "NARROW NBSP",
    0x2007: "FIGURE SPACE",
    0x200B: "ZWSP",
    0x200C: "ZWNJ",
    0x200D: "ZWJ",
    0xFEFF: "BOM/ZWNBSP",
    0x200E: "LRM",
    0x200F: "RLM",
    0x202A: "LRE",
    0x202B: "RLE",
    0x202C: "PDF",
    0x202D: "LRO",
    0x202E: "RLO",
    0x2066: "LRI",
    0x2067: "RLI",
    0x2068: "FSI",
    0x2069: "PDI",
    0x00AD: "SHY",
}


def load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> None:
    out = []

    def say(s: str = "") -> None:
        out.append(s)
        print(s)

    say("== JSON parse + key-set parity with English ==")
    en_keys: dict[str, set[str]] = {}
    for ns in NS:
        en = load(ROOT / f"src/i18n/catalogues/{EN}/{ns}.json")
        tgt = load(ROOT / f"src/i18n/catalogues/{LOC}/{ns}.json")
        en_keys[ns] = set(en)
        missing = sorted(set(en) - set(tgt))
        extra = sorted(set(tgt) - set(en))
        say(
            f"{ns}: en={len(en)} vi={len(tgt)} missing_in_vi={len(missing)} "
            f"extra_in_vi={len(extra)}"
        )
        for k in missing:
            say(f"  MISSING {k}")
        for k in extra:
            say(f"  EXTRA   {k}")

    say()
    say("== Changed keys vs origin/main (should be additions only) ==")
    files = [
        f"src/i18n/catalogues/{LOC}/{ns}.json" for ns in NS
    ] + [f"src/i18n/catalogues/{EN}/{ns}.json" for ns in NS]
    diff = subprocess.run(
        ["git", "diff", "--unified=0", "origin/main", "HEAD", "--", *files],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    for line in diff.splitlines():
        if line.startswith(("+++", "---", "@@")):
            continue
        if line.startswith(("+", "-")):
            say(line)

    say()
    say("== Per-key mechanical checks ==")
    findings = 0
    for ns, keys in NEW_KEYS.items():
        en = load(ROOT / f"src/i18n/catalogues/{EN}/{ns}.json")
        tgt = load(ROOT / f"src/i18n/catalogues/{LOC}/{ns}.json")
        ctx = load(ROOT / f"src/i18n/catalogues/{EN}/{ns}.context.json")
        for k in keys:
            src = en[k]
            cur = tgt.get(k)
            say(f"\n-- {k}")
            say(f"   en : {src!r}")
            say(f"   vi : {cur!r}")
            if cur is None:
                say("   FAIL key absent")
                findings += 1
                continue
            sp = PLACEHOLDER_RE.findall(src)
            tp = PLACEHOLDER_RE.findall(cur)
            ok = sorted(sp) == sorted(tp) and len(sp) == len(tp)
            say(f"   placeholders en={sp} vi={tp} match={ok}")
            if not ok:
                findings += 1
            # unbalanced or malformed braces
            for name in tp:
                if f"{{{name}}}" not in cur:
                    say("   FAIL placeholder not plain")
                    findings += 1
            if src.count("{") != cur.count("{") or src.count("}") != cur.count("}"):
                say("   FAIL brace count differs from source")
                findings += 1
            # ICU structure (none of the four uses ICU, so any would be suspicious)
            for marker in ("plural", "select", "selectordinal", "number", "number,"):
                if marker in cur and marker not in src:
                    say(f"   FLAG unexpected ICU marker {marker!r} not in source")
                    findings += 1
            # invisible characters
            inv = [
                (f"U+{ord(ch):04X}", INVISIBLE[ord(ch)])
                for ch in cur
                if ord(ch) in INVISIBLE
            ]
            say(f"   invisible/bidi: {inv or 'none'}")
            # non-ASCII review
            nonascii = sorted({ch for ch in cur if ord(ch) > 127})
            say(
                "   non-ASCII: "
                + ", ".join(f"{ch!r}(U+{ord(ch):04X})" for ch in nonascii)
                if nonascii
                else "   non-ASCII: none"
            )
            nfc = unicodedata.normalize("NFC", cur) == cur
            say(f"   NFC precomposed: {nfc}")
            if not nfc:
                findings += 1
            # trailing punctuation / stray whitespace
            say(
                f"   starts/ends with space: {cur != cur.strip()}  "
                f"trailing punct: {cur.rstrip()[-1] in '.:;!?'}"
            )
            # length
            say(
                f"   len chars={len(cur)} cells~={sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in cur)}"
            )
            say(f"   context role: {ctx[k]['role']!r}")
            say(f"   context maxCells: {ctx[k].get('maxCells')!r}")

    say()
    say(f"== mechanical failures counted by this script: {findings} ==")
    return out


if __name__ == "__main__":
    main()
