#!/bin/bash
# Second independent i18n audit (S16e) — actual command log.
# Every block below is re-executed NOW and its real stdout/stderr captured,
# so this file is execution output, not notes about execution.
set -u
cd /Users/damian/.local-operator/sessions/cc045047b39e/scratchpad/s16e-audit2 || exit 1
W=/Users/damian/local-operator-ui/.worktrees/i18n-s16e

run () { echo; echo "\$ $*"; eval "$@" 2>&1; echo "[exit $?]"; }

echo "== second independent i18n audit — S16e — command log =="
run "node --version; python3 --version"
run "git -C $W rev-parse HEAD"
run "shasum -a 256 $W/src/i18n/catalogues/en/ui.chat.canonical.json $W/src/i18n/catalogues/en/ui.chat.canonical.context.json"
run "shasum -a 256 /Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e-brief.json /Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/manifest.json"
run "shasum -a 256 /Users/damian/local-operator/i18n/glossary.md"
run "for f in /Users/damian/local-operator/i18n/style-guides/*.md; do shasum -a 256 \"\$f\"; done"
run "for l in fr es ru vi zh-CN hi ur; do shasum -a 256 $W/src/i18n/catalogues/\$l/ui.chat.canonical.json; shasum -a 256 /Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/\$l/draft-\$l-s16e.json; done"
run "node mech.mjs"
run "node typography.mjs"
run "python3 evidence.py"
run "ls -l"
