#!/bin/bash
# rundesk.sh — desktop API server for rig root A, on scratch port 41241.
set -euo pipefail
RIG="$HOME/workspace/read-ack-skew-rig"
cd "$RIG/wt/lo"
exec env -i HOME="$RIG/homeA" \
  LOCAL_OPERATOR_CONFIG_DIR="$RIG/homeA/.local-operator" \
  PATH="$PATH" TERM=xterm-256color PYTHONPATH="$RIG/wt/lo" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/desktop.token")" \
  PYTHONUNBUFFERED=1 \
  "$HOME/local-operator/.venv/bin/python" -c 'import sys; from local_operator.cli import main; sys.exit(main())' serve --port 41241
