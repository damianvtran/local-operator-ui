#!/usr/bin/env python3
"""Key-level i18n audit for the 8 ui.teamBridge keys added by PR #1735 (file save).

WHY a script instead of prose: every claim in the receipt has to be re-derivable
from the bytes on disk by whoever reads the record later. This prints the
hashes, the delta against the previously audited parent, and the per-value
checks the locale style guides make binding, so `audit.log` is execution output
rather than a description of one.

Run from the repository root:  python3 <this file>
"""

import hashlib
import json
import re
import subprocess
import sys
import unicodedata

LOCALE = "vi"
BASE = "cff518c3"  # merge-base of the PR branch and origin/main: the last audited parent
NS = "ui.teamBridge"
EN_PATH = "src/i18n/catalogues/en/%s.json" % NS
CTX_PATH = "src/i18n/catalogues/en/%s.context.json" % NS
TARGET_PATH = "src/i18n/catalogues/%s/%s.json" % (LOCALE, NS)

NEW_KEYS = [
    "ui.teamBridge.fileCard.save",
    "ui.teamBridge.fileCard.saving",
    "ui.teamBridge.fileCard.save_failed",
    "ui.teamBridge.fileCard.too_large",
    "ui.teamBridge.fileCard.expired",
    "ui.teamBridge.fileCard.unavailable",
    "ui.teamBridge.files.attached",
    "ui.teamBridge.files.not_uploaded",
]

# Sibling copy the new values have to agree with: the image tile this file card
# sits beside, the composer's upload statuses, and the settled save verb.
PRECEDENT_KEYS = [
    "ui.teamBridge.attachments.position",
    "ui.teamBridge.attachments.expired",
    "ui.teamBridge.attachments.unavailable",
    "ui.teamBridge.files.staged",
    "ui.teamBridge.files.uploading",
    "ui.teamBridge.files.failed",
]

# Declared shapes: which placeholder tokens the English carries, and whether the
# value is allowed an ellipsis (the zh-CN guide requires two marks, everything
# else one).
BASE_INPUT_HASHES = {
    "en": "d3916ef448133cbdf11c325b2119947a816315b829b9830f1915fc6ab3fd25f5",
    "context": "6f217e1196cffa0a63c9434e04601cd1b6fff429d10cb29348730e8dc8dc73f4",
    "target": "1c94f16426460e5b8c2068ddc8c00738487bd48fa616ef52ee950f9643b6d227",
}
PREVIOUS_ROW_TARGET = "bf8089bab58648ac2463194754d025acf8a376fbd5c14ac00549a6ec5fae68e9"
PREVIOUS_ROW_AUDITORS = ["20ee46d7281d-pr1666-vir1-vi"]

BIDI = re.compile("[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with open(path, "rb") as handle:
        return handle.read()


def git_show(ref, path):
    return subprocess.run(
        ["git", "show", "%s:%s" % (ref, path)],
        capture_output=True,
        check=True,
    ).stdout


def line(label, ok):
    print("%-52s %s" % (label, "True" if ok else "FALSE  <-- check failed"))


def main():
    en_bytes = read(EN_PATH)
    ctx_bytes = read(CTX_PATH)
    target_bytes = read(TARGET_PATH)
    en = json.loads(en_bytes)
    ctx = json.loads(ctx_bytes)
    target = json.loads(target_bytes)

    print("== inputs re-hashed from disk ==")
    for label, data, expected in (
        ("en", en_bytes, BASE_INPUT_HASHES["en"]),
        ("context", ctx_bytes, BASE_INPUT_HASHES["context"]),
        ("%s" % LOCALE, target_bytes, BASE_INPUT_HASHES["target"]),
    ):
        digest = sha256(data)
        print("%-9s %s  matches the receipt claim: %s" % (label, digest, digest == expected))
    print("")

    print("== delta versus the previously audited parent (%s) ==" % BASE)
    parent_bytes = git_show(BASE, TARGET_PATH)
    parent = json.loads(parent_bytes)
    parent_en = json.loads(git_show(BASE, EN_PATH))
    parent_ctx = json.loads(git_show(BASE, CTX_PATH))
    print("parent target sha256      %s" % sha256(parent_bytes))
    print("row auditor at the parent %s" % ", ".join(PREVIOUS_ROW_AUDITORS))
    changed = [k for k in parent if k in target and parent[k] != target[k]]
    added = [k for k in target if k not in parent]
    removed = [k for k in parent if k not in target]
    print("keys changed              %s" % changed)
    print("keys added                %d %s" % (len(added), added == NEW_KEYS))
    print("keys removed              %s" % removed)
    print("parent key order kept     %s" % ([k for k in target if k not in NEW_KEYS] == list(parent)))
    print("added keys sit in en order %s" % ([k for k in target if k in NEW_KEYS] == NEW_KEYS))
    line("key order is en's key order", list(target) == list(en))
    line("en adds exactly the 8 keys and changes nothing else",
         {k: v for k, v in en.items() if k not in NEW_KEYS} == parent_en)
    line("key count target/en equal", len(target) == len(en))
    line("key set equals English", sorted(target) == sorted(en))
    projection = json.dumps(
        {k: v for k, v in target.items() if k not in NEW_KEYS},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    print("unchanged-pair projection %s  (pairs: %d)" % (sha256(projection), len(target) - len(NEW_KEYS)))
    line(
        "every pre-existing value byte-identical to the audited parent",
        {k: v for k, v in target.items() if k not in NEW_KEYS} == parent,
    )
    # Textual diff, because "the same pairs" is not the same claim as "the same
    # file": one trailing comma moving is the only edit the parent's last line
    # may show.
    diff = [
        x
        for x in subprocess.run(
            ["git", "diff", "--no-color", "-U0", BASE, "--", TARGET_PATH],
            capture_output=True,
            check=True,
        ).stdout.decode().splitlines()
        if x[:1] in "+-" and not x.startswith(("+++", "---"))
    ]
    dropped = [x for x in diff if x.startswith("-")]
    gained = [x for x in diff if x.startswith("+")]
    print("textual diff              %d removed / %d added line(s)" % (len(dropped), len(gained)))
    line(
        "removed line(s) only regained a trailing comma",
        all(("+" + x[1:] + ",") in gained for x in dropped),
    )
    ctx_added = [k for k in ctx if k not in parent_ctx]
    ctx_changed = [k for k in parent_ctx if k in ctx and parent_ctx[k] != ctx[k]]
    print("context keys added        %d %s" % (len(ctx_added), sorted(ctx_added) == sorted(NEW_KEYS)))
    print("context keys reworded     %s" % ctx_changed)
    print("context keys removed      %s" % [k for k in parent_ctx if k not in ctx])
    for key in ctx_changed:
        old, new = parent_ctx[key], ctx[key]
        moved = [field for field in set(old) | set(new) if old.get(field) != new.get(field)]
        print("  %s: fields changed %s" % (key, moved))
        for field in moved:
            print("    %s old: %s" % (field, old.get(field)))
            print("    %s new: %s" % (field, new.get(field)))
    print("")

    print("== the eight added values ==")
    for key in NEW_KEYS:
        value = target[key]
        english = en[key]
        en_tokens = sorted(re.findall(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", english))
        tokens = sorted(re.findall(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", value))
        controls = [hex(ord(c)) for c in value if unicodedata.category(c) == "Cf"]
        print("")
        print("-- %s" % key)
        print("   en %s" % english)
        print("   %-3s %s" % (LOCALE, value))
        line("   placeholders preserved (%s)" % (",".join(en_tokens) or "none"),
             tokens == en_tokens)
        line("   NFC", unicodedata.normalize("NFC", value) == value)
        print("   format/bidi controls     %s" % (controls or "[]"))
        line("   no manual bidi controls", not BIDI.search(value))
        line("   no em/en dash", not re.search("[\u2014\u2013]", value))
        line("   no ASCII dots", "..." not in value)
        if "…" in value:
            if LOCALE == "zh-CN":
                line("   ellipsis is the two-mark form ……", "……" in value and "…" * 3 not in value)
            else:
                line("   ellipsis is one mark, no space before it",
                     "…" in value and " …" not in value)
        print("   context role             %s" % ctx.get(key, {}).get("role"))
        print("   context note             %s" % ctx.get(key, {}).get("note"))
    print("")

    print("== sibling copy in the same namespace (the register precedent) ==")
    for key in PRECEDENT_KEYS:
        print("   %s" % key)
        print("     en %s" % en[key])
        print("     %-3s %s" % (LOCALE, target[key]))
    print("")

    print("== whole-file invariants ==")
    whole = target_bytes.decode("utf-8")
    line("file is NFC", unicodedata.normalize("NFC", whole) == whole)
    line("no manual bidi controls anywhere in the file", not BIDI.search(whole))
    line("no ASCII dots anywhere in the file", "..." not in whole)
    line("no empty values", all(v.strip() for v in target.values()))
    line("no trailing/leading whitespace in any value",
         all(v == v.strip() for v in target.values()))
    print("")

    print("== git identity of the audited bytes ==")
    print(subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                         text=True).stdout.strip())
    status = subprocess.run(["git", "status", "--porcelain", "--", TARGET_PATH,
                             EN_PATH, CTX_PATH], capture_output=True, text=True).stdout
    print("git status for the three inputs: %r" % status)
    print("(empty above = the audited bytes are HEAD bytes)")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] != LOCALE:
        sys.exit("this bundle audits %s, not %s" % (LOCALE, sys.argv[1]))
    main()
