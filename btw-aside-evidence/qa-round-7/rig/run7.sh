#!/usr/bin/env bash
# usage: run7.sh <scene> <pass> [window] [old-daemon]
cd "$(dirname "$0")"
R=$PWD
rm -rf "$R/port8080.mine"
env -i HOME=$R/home PATH="$PATH" TERM=xterm-256color GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 TMPDIR=$R/tmp \
  PORT8080_LOCK=/Users/damian/.local-operator/sessions/15622aeab8ed/scratchpad/port8080.lock \
  QA_CAP_CASES="${QA_CAP_CASES:-}" QA_SEED_TURNS="${QA_SEED_TURNS:-0}" QA_RUNS="${QA_RUNS:-0}" QA_ASIDE_FIRST="${QA_ASIDE_FIRST:-0}" \
  QA_UI_TREE=/Users/damian/local-operator-ui-worktrees/qa-482-r7 \
  QA_BACKEND_TREE=/Users/damian/local-operator-worktrees/qa482-r7 \
  bash -c 'mkdir -p "$HOME" "$TMPDIR"; bash ./capture-r7.sh "$@"' _ "$@" > "$2.out" 2>&1
echo "exit $?"
echo "PASS $(grep -c '^\[PASS\]' "$2.out")  FAIL $(grep -c '^\[FAIL\]' "$2.out")"
grep -n '^\[FAIL\]' "$2.out" | head -40
