#!/usr/bin/env bash
# usage: run-ux4.sh <scene> <pass> [window]
cd "$(dirname "$0")"
R=$PWD
env -i HOME=$R/home PATH="$PATH" TERM=xterm-256color GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 TMPDIR=$R/tmp \
  PORT8080_LOCK=/Users/damian/.local-operator/sessions/15622aeab8ed/scratchpad/port8080.lock \
  QA_UI_TREE="$UX4_UI_TREE" QA_BACKEND_TREE="$UX4_BACKEND_TREE" \
  bash -c 'mkdir -p "$HOME" "$TMPDIR"; bash ./capture-ux4.sh "$@"' _ "$@" > "$2.out" 2>&1
echo "exit $?"
echo "PASS $(grep -c '^\[PASS\]' "$2.out")  FAIL $(grep -c '^\[FAIL\]' "$2.out")"
grep -n '^\[FAIL\]\|Error\|released\|driver exit\|refusing\|never' "$2.out" | head -30
ls -d /Users/damian/.local-operator/sessions/15622aeab8ed/scratchpad/port8080.lock 2>&1 | tail -1
