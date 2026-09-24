#!/usr/bin/env bash
# usage: run-d4.sh <scene> <pass> [window] [extra env...]
cd "$(dirname "$0")"
R=$PWD
S=$(cat ../sid)
env -i HOME=$R/home PATH="$PATH" TERM=xterm-256color GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 TMPDIR=$R/tmp \
  PORT8080_LOCK=$LOCAL_OPERATOR_SCRATCHPAD/d4/port8177.lock \
  D4_CASES="${D4_CASES:-}" D4_THEME="${D4_THEME:-}" D4_BLOCK_MARKERS="${D4_BLOCK_MARKERS:-}" UI_PORT="${UI_PORT:-8177}" \
  QA_UI_TREE=/Users/damian/local-operator-ui-worktrees/$S \
  QA_BACKEND_TREE=/Users/damian/local-operator-worktrees/$S \
  bash -c 'mkdir -p "$HOME" "$TMPDIR"; bash ./capture-d4.sh "$@"' _ "$@" > "$2.out" 2>&1
echo "exit $?"
echo "PASS $(grep -c '^\[PASS\]' "$2.out")  FAIL $(grep -c '^\[FAIL\]' "$2.out")"
grep -n '^\[FAIL\]\|Error\|released\|driver exit\|refusing\|never\|8080' "$2.out" | head -25
