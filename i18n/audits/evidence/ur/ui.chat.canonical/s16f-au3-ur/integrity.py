#!/usr/bin/env python3
"""Integrity proof for s16f-au3-ur.

Claim under test: the merged ur/ui.chat.canonical.json differs from
origin/main's bytes ONLY by the 10 PR-added keys, each of which must equal the
previously audited PR value at 107ff1dd, plus the 5 main-added keys that must
equal main. Every other key must be byte-identical to origin/main.
"""
import hashlib
import json
import subprocess

PR_KEYS = [
    "ui.chat.canonical.media.image_label",
    "ui.chat.canonical.media.sound_label",
    "ui.chat.canonical.sound.batch.item_status",
    "ui.chat.canonical.sound.batch.latest_update",
    "ui.chat.canonical.sound.batch.summary",
    "ui.chat.canonical.sound.cost.batch_unknown",
    "ui.chat.canonical.sound.cost.estimated_zero",
    "ui.chat.canonical.sound.cost.no_charge",
    "ui.chat.canonical.sound.cost.unknown",
    "ui.chat.canonical.supplement.sound_fallback_label",
]
MAIN_KEYS = [
    "ui.chat.canonical.loading.cold",
    "ui.chat.canonical.loading.older",
    "ui.chat.canonical.loading.region_label",
    "ui.chat.canonical.loading.remote",
    "ui.chat.canonical.loading.revalidating",
]
DELETED = [
    "ui.chat.canonical.older_history.loading",
    "ui.chat.canonical.placeholder.loading",
    "ui.chat.canonical.placeholder.region_label",
    "ui.chat.canonical.transcript.stale_caption",
]

PATH = "src/i18n/catalogues/ur/ui.chat.canonical.json"
PREMERGE = "107ff1dd0bddd0dbefa60e27cb179ee636d923a1"


def load(ref):
    out = subprocess.run(
        ["git", "show", f"{ref}:{PATH}"], capture_output=True, text=True, check=True
    ).stdout
    return json.loads(out)


disk = json.load(open(PATH))
main = load("origin/main")
pre = load(PREMERGE)

print(f"keys: disk={len(disk)} origin/main={len(main)} premerge={len(pre)}")
print("union check: 457 (main) + 10 (PR) = 467:", len(main) + 10 == len(disk))
print("only in disk vs main:", sorted(set(disk) - set(main)))
print("only in main vs disk:", sorted(set(main) - set(disk)))

diff_main = [k for k in disk if k in main and disk[k] != main[k]]
print(f"\nkeys whose value differs from origin/main: {len(diff_main)}")
for k in diff_main:
    print("   ", k)

bad_pr = [k for k in PR_KEYS if disk.get(k) != pre.get(k)]
print(f"PR-added keys whose disk value != premerge {PREMERGE[:8]}: {len(bad_pr)} {bad_pr}")
print("main-added 5 present and equal to origin/main:",
      all(disk.get(k) == main.get(k) for k in MAIN_KEYS))
print("main's deleted keys absent from disk:",
      all(k not in disk for k in DELETED))
print("PR key set == disk keys not in main:",
      sorted(PR_KEYS) == sorted(set(disk) - set(main)))

other = [k for k in disk if k not in set(PR_KEYS) | set(MAIN_KEYS)]
print(f"\nunchanged-elsewhere count: {len(other)} keys; "
      f"all byte-identical to origin/main: {all(disk[k] == main[k] for k in other)}")

for label, p in [
    ("ur", PATH),
    ("en", "src/i18n/catalogues/en/ui.chat.canonical.json"),
    ("context", "src/i18n/catalogues/en/ui.chat.canonical.context.json"),
]:
    print(f"sha256 {label}: {hashlib.sha256(open(p, 'rb').read()).hexdigest()}")
