#!/usr/bin/env bash
# usage: run-d5.sh <scene> <pass> [window] [old-daemon 0|1]
#
# One pass of the design-round-5 rig. `env -i` (scratch HOME/TMPDIR, system
# gitconfig off, no CMUX_*/LOP_*), the shared 8080 lock handed to the capture
# script, and every listener reaped by exact pid inside it.
cd "$(dirname "$0")" || exit 1
R=$PWD
env -i HOME=$R/home PATH="$PATH" TERM=xterm-256color GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 TMPDIR=$R/tmp \
  PORT8080_LOCK=/Users/damian/.local-operator/sessions/15622aeab8ed/scratchpad/port8080.lock \
  D5_CASES="${D5_CASES:-}" D5_THEME="${D5_THEME:-}" UI_PORT="${UI_PORT:-8080}" \
  QA_UI_TREE=/Users/damian/local-operator-ui-worktrees/design482r5-d5a1c9 \
  QA_BACKEND_TREE=/Users/damian/local-operator-worktrees/qa482-r6 \
  bash -c 'mkdir -p "$HOME" "$TMPDIR"; bash ./capture-d5.sh "$@"' _ "$@" > "$R/$2.out" 2>&1
echo "exit $?"
echo "PASS $(grep -c '^\[PASS\]' "$R/$2.out")  FAIL $(grep -c '^\[FAIL\]' "$R/$2.out")"
grep -n '^\[FAIL\]\|Error\|released\|driver exit\|refusing\|never\|port8080' "$R/$2.out" | head -30
