#!/bin/bash
# runlo.sh — the worktree's `lop` CLI under an isolated rig root.
# usage: runlo.sh A|B <cli args...>
# A = this device (origin/main core); B = the peer (pre-#1994 core).
# Isolation: env -i with a per-root HOME and LOCAL_OPERATOR_CONFIG_DIR, so
# nothing here can read or write the operator's real ~/.local-operator.
set -euo pipefail
ROOT_NAME="$1"; shift
RIG="$HOME/workspace/read-ack-skew-rig"
case "$ROOT_NAME" in
  A) WT="$RIG/wt/lo" ;;
  B) WT="$RIG/wt/lo" ;;  # upgraded 2026-10-05 20:53: B now runs origin/main (dispatches net_session_receipt)
  *) echo "usage: runlo.sh A|B ..." >&2; exit 2 ;;
esac
PY="$HOME/local-operator/.venv/bin/python"
cd "$WT"
exec env -i HOME="$RIG/home$ROOT_NAME" \
  LOCAL_OPERATOR_CONFIG_DIR="$RIG/home$ROOT_NAME/.local-operator" \
  PATH="$PATH" TERM=xterm-256color LOP_NETWORK_TEST_MODE=1 \
  PYTHONUNBUFFERED=1 \
  "$PY" -c 'import sys; from local_operator.cli import main; sys.exit(main())' "$@"
