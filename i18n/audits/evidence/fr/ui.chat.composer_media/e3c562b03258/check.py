#!/usr/bin/env python3
"""Read-only mechanical checks for the fr s12 delta audit (PR #1842 @ e5fb431).

Run from the read-only worktree root. Writes nothing. Prints a digest that the
audit.log records verbatim.
"""

import hashlib
import json
import re
import subprocess
import unicodedata

ROOT = "/Users/damian/local-operator-ui/.worktrees/i18n-s8"
EXPECTED = (
    "/Users/damian/local-operator-ui/.worktrees/_s12-audits/"
    "e5fb4310dab638f9cf428779d62539ec039a8990/expected-hashes.json"
)
GLOSSARY_COPY = (
    "/Users/damian/local-operator-ui/.worktrees/_s12-audits/"
    "e5fb4310dab638f9cf428779d62539ec039a8990/glossary.md"
)
STYLE = "/Users/damian/local-operator/i18n/style-guides/fr.md"
NAMESPACES = ["ui.chat", "ui.chat.composer_media", "ui.common.actions"]
NEW_KEYS = {
    "ui.chat.composer_media.pasted_image": "ui.chat.composer_media",
    "ui.chat.image_actions.actions": "ui.chat",
    "ui.chat.audio.position_label": "ui.chat",
    "ui.common.actions.actions_for_name": "ui.common.actions",
}
PLACEHOLDER = re.compile(r"\{[^}]*\}")
INVISIBLE = {0x00A0, 0x202F, 0x2009, 0x2007, 0x200B, 0x200C, 0x200D,
             0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
             0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF, 0x00AD}


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def rel(namespace):
    return f"src/i18n/catalogues/%s/{namespace}.json"


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    print("HEAD:", subprocess.run(
        ["git", "-C", ROOT, "rev-parse", "HEAD"], capture_output=True,
        text=True, check=True).stdout.strip())
    dirty = subprocess.run(
        ["git", "-C", ROOT, "status", "--porcelain"], capture_output=True,
        text=True, check=True).stdout.strip()
    print("worktree dirty:", bool(dirty))

    expected = json.load(open(EXPECTED, encoding="utf-8"))["hashes"]
    mismatches = []
    for ns in NAMESPACES:
        pairs = [(f"en/{ns}", rel(ns) % "en"),
                 (f"fr/{ns}", rel(ns) % "fr"),
                 (f"en/{ns}.context",
                  "src/i18n/catalogues/en/%s.context.json" % ns)]
        for label, path in pairs:
            actual = sha(f"{ROOT}/{path}")
            ok = actual == expected[label]
            print(f"hash {label}: {actual} {'OK' if ok else 'MISMATCH'}")
            if not ok:
                mismatches.append({"label": label, "actual": actual,
                                   "expected": expected[label]})
    print("hash mismatches:", len(mismatches))

    for ns in NAMESPACES:
        en = load(f"{ROOT}/{rel(ns) % 'en'}")
        fr = load(f"{ROOT}/{rel(ns) % 'fr'}")
        ctx = load(f"{ROOT}/src/i18n/catalogues/en/{ns}.context.json")
        print(f"{ns}: en={len(en)} fr={len(fr)} "
              f"keyset_equal={set(en) == set(fr)} "
              f"order_equal={list(en) == list(fr)} "
              f"context={len(ctx)}")
        for key in NEW_KEYS:
            if key not in en:
                continue
            c = ctx.get(key, {})
            print(f"  {key}")
            print(f"    en={en[key]!r}")
            print(f"    fr={fr[key]!r}")
            print(f"    ctx role={c.get('role')!r} maxCells={c.get('maxCells')!r}")
            pe, pf = PLACEHOLDER.findall(en[key]), PLACEHOLDER.findall(fr[key])
            print(f"    placeholders en={pe} fr={pf} equal={pe == pf}")
            for token in pe:
                assert token in fr[key], f"{key}: {token} missing byte-exact"
            odd = [(hex(ord(ch)), unicodedata.name(ch, "?"))
                   for ch in fr[key]
                   if ord(ch) in INVISIBLE
                   or (unicodedata.category(ch) == "Cf")]
            print(f"    invisible/format chars={odd}")
            print(f"    length={len(fr[key])} trailing_punct="
                  f"{fr[key][-1] in '.;:!?…'}")
            print("    icu_structure="
                  f"{'plural/select present' if 'plural,' in fr[key] or 'select,' in fr[key] else 'none (plain mustaches only)'}")

    # key delta versus origin/main, per namespace file
    for ns in NAMESPACES:
        for loc in ("en", "fr"):
            path = rel(ns) % loc
            old = subprocess.run(
                ["git", "-C", ROOT, "show", f"origin/main:{path}"],
                capture_output=True, text=True, check=True).stdout
            old = json.loads(old)
            new = load(f"{ROOT}/{path}")
            print(f"delta {loc}/{ns}: added={sorted(set(new) - set(old))} "
                  f"removed={sorted(set(old) - set(new))} "
                  f"changed={sorted(k for k in set(old) & set(new) if old[k] != new[k])}")

    print("glossary copy sha256:", sha(GLOSSARY_COPY))
    print("glossary original sha256:",
          sha("/Users/damian/local-operator/i18n/glossary.md"))
    print("style guide sha256:", sha(STYLE))


if __name__ == "__main__":
    main()
