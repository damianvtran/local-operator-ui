#!/usr/bin/env bash
# usage: run6live.sh <scene> <pass> [window]
#
# run6.sh with the scripted provider's pacing exposed, so the fold scene's
# leave/re-enter can actually land MID-TURN (which is #490's own reproduction).
# Nothing else differs.
cd "$(dirname "$0")" || exit 1
R=$PWD
env -i HOME=$R/home PATH="$PATH" TERM=xterm-256color GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 TMPDIR=$R/tmp \
  PORT8080_LOCK=/Users/damian/.local-operator/sessions/15622aeab8ed/scratchpad/port8080.lock \
  STUB_FIRST_DELAY="${STUB_FIRST_DELAY:-1.8}" STUB_CHUNK_DELAY="${STUB_CHUNK_DELAY:-0.30}" \
  QA_CAP_CASES="${QA_CAP_CASES:-}" QA_SEED_TURNS="${QA_SEED_TURNS:-0}" QA_RUNS="${QA_RUNS:-0}" QA_ASIDE_FIRST="${QA_ASIDE_FIRST:-0}" \
  QA_UI_TREE=/Users/damian/local-operator-ui-worktrees/design482r6-cf5a12f95 \
  QA_BACKEND_TREE=/Users/damian/local-operator-worktrees/design482r6 \
  bash -c 'mkdir -p "$HOME" "$TMPDIR"; bash ./capture-r7.sh "$@"' _ "$@" > "$R/$2.out" 2>&1
echo "exit $?"
echo "PASS $(grep -c '^\[PASS\]' "$R/$2.out")  FAIL $(grep -c '^\[FAIL\]' "$R/$2.out")"
grep -n '^\[FAIL\]' "$R/$2.out" | head -40
