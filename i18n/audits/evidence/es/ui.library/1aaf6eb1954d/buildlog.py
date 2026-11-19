#!/usr/bin/env python3
"""Builds es-ds-1aaf6eb1954d.audit.log from REAL command output.

Every block under EXECUTED is a command this auditor ran, with its stdout
captured verbatim (exit code included). Nothing under EXECUTED is typed by
hand. The READ section lists files opened for judgement; it is not command
output.
"""
import hashlib
import os
import subprocess

REPO = os.path.expanduser("~/local-operator-ui/.worktrees/i18n-s8")
AUD = os.path.expanduser(
    "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23"
)
SCRATCH = os.environ["LOCAL_OPERATOR_SCRATCHPAD"]
LOG = os.path.join(SCRATCH, "es-ds-1aaf6eb1954d.audit.log")

def run(shell, timeout=180):
    p = subprocess.run(shell, shell=True, cwd=REPO, capture_output=True,
                       text=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr).rstrip()

BLOCKS = []

def block(title, shell, timeout=180):
    rc, out = run(shell, timeout)
    BLOCKS.append(f"$ {shell}\n[exit {rc}]\n{out}\n")
    return rc, out

block("head identity", "git rev-parse HEAD && git rev-parse --abbrev-ref HEAD")
block("read-only worktree proof", "git status --porcelain | head -5; echo '(empty above = clean tree)'")
block("binding hashes of the three audited inputs",
      "shasum -a 256 src/i18n/catalogues/en/ui.library.json "
      "src/i18n/catalogues/en/ui.library.context.json src/i18n/catalogues/es/ui.library.json")
block("binding hashes of the policy files",
      "shasum -a 256 ~/local-operator/i18n/glossary.md "
      f"{AUD}/glossary.md ~/local-operator/i18n/style-guides/es.md")
block("delta shape vs origin/main",
      "git diff --stat 0e12072d2b3..HEAD -- src/i18n/catalogues/es/ui.library.json")
block("delta diff (es)",
      "git diff 0e12072d2b3..HEAD -- src/i18n/catalogues/es/ui.library.json")
block("mechanical verifier (authored + executed here)",
      f"python3 {SCRATCH}/es-ds-1aaf6eb1954d-check.py")
block("repo gate: generator freshness", "timeout 150 node scripts/i18n/generate.mjs --check")
block("repo gate: duplicate keys", "timeout 150 node scripts/i18n/check-duplicates.mjs")
block("repo gate: context sidecar parity", "timeout 150 node scripts/i18n/context-parity.mjs")
block("repo gate: translation ledger (pre-audit state)",
      "timeout 150 node scripts/i18n/ledger-check.mjs 2>&1 | grep -E "
      "'^ledger-check: (es|en)/|^ledger-check: FAILED'")

READ = f"""
READ (judgement inputs, not command output)
---------------------------------------------------------------
English source + metadata:
  src/i18n/catalogues/en/ui.library.json            (179 keys)
  src/i18n/catalogues/en/ui.library.context.json    (179 entries)
  {AUD}/keys20.json
    (sha256 ce4bc7b57e25baa9f4d292f11f6a0ae722e076ff5b41957d125d7cdb88b58a5e)
Policy:
  ~/local-operator/i18n/style-guides/es.md
  {AUD}/glossary.md   (manager-owned byte-copy of ~/local-operator/i18n/glossary.md)
  {AUD}/expected-hashes.json
Target:
  src/i18n/catalogues/es/ui.library.json
Neighbour vocabulary (grep + json.load inside src/i18n/catalogues/es/):
  ui.library.json (category/filter/sort/preview/origin/status), ui.canvas.json
  (files.*, file_rows.*), ui.chat.tag_groups.json, ui.chat.tag_mode.json,
  ui.chat.tag_dialogs.json, ui.chat.tags.json, ui.teamBridge.json,
  ui.notifications.json, ui.agents.teams.json, ui.agents.skills.json,
  ui.projects.json, ui.settings.appearance.editor.json, ui.common.errors.json
Render sites read (source only, nothing rendered or built):
  src/renderer/src/features/library/library-model.ts      (KIND_LABEL_KEYS 344-355,
      TAG_CATEGORY_LABEL_KEYS 359-366, libraryKindLabel 370-378,
      tagCategoryLabel 380-385, LIBRARY_SORTS 79-90)
  src/renderer/src/features/library/components/library-card.tsx   (KindLabel 221,
      LibraryCard caption 245-252, LibraryRow cluster 365-374)
  src/renderer/src/features/library/components/library-preview.tsx (Badge 494)
  src/renderer/src/features/library/components/library-filter-rail.tsx
      (Section h3 91-97, TagCategoryLabel 102-105)
  src/renderer/src/features/library/components/library-viewers.tsx
      (Unsupported 98-114: kind === "other" ? unsupported_generic : unsupported)
  all seven manifests under i18n/ (renderer-blind-spots, census-five-key-second,
      highlights-withheld-1652, owner-audit-download-actions, s3-attachment-cards,
      u1-file-cards, and the hi/ui.chat evidence manifest): searched by script for
      the artifact the kind.other context note points at ("see manifest") — none of
      them mentions the Library, kind.other or unsupported_generic
Schema model read (no content judged from it):
  ~/local-operator-ui/.worktrees/_s12-audits/e5fb4310dab638f9cf428779d62539ec039a8990/
    fr-ds-e3c562b03258.json and .record.json
Not read on purpose: other sessions' directories under ~/.local-operator/sessions/
(guardrail), this locale's translator session, and the previous es audit receipts
in _s12-audits/es-ds-* (independence).
"""

header = f"""es / ui.library delta audit — execution log
auditor: i18n-auditor, instance 1aaf6eb1954d, session 1aaf6eb1954d
served model: deepseek/deepseek-flash (session header; no switch, no fallback)
head: 8a9ce1f808c266ebe9a0e924094344cea60c2c23 (PR damianvtran/local-operator-ui #1851)
worktree: {REPO} (read-only for this audit; no file in the repo was written)
date: 2026-11-10
scope: 20 new keys in ui.library (12 kind.*, 7 tag_category.*, preview.unsupported_generic)

EXECUTED (commands and their actual output)
===========================================================
"""

with open(LOG, "w", encoding="utf-8") as fh:
    fh.write(header)
    for b in BLOCKS:
        fh.write(b)
        fh.write("\n")
    fh.write("=" * 59 + "\n")
    fh.write(READ)

print("wrote", LOG, os.path.getsize(LOG), "bytes")
print(hashlib.sha256(open(LOG, "rb").read()).hexdigest())
