#!/bin/bash
# QA r6 PR 490: run each scenario on the given label/tree, serially (host memory).
# Scope any kill to pids this script created; nothing here kills by name.
S="$LOCAL_OPERATOR_SCRATCHPAD/r6"
cd "$S" || exit 2
label=$1; shift
case $label in
  head) T="$HOME/local-operator-ui-worktrees/qa490r6-head-e740e5"; PORT=46711;;
  # Both trees are BUILT against the stub URL 46711 (VITE_LOCAL_OPERATOR_API_URL is
  # read at build time), so both run on that port. The matrix is serial.
  prev) T="$HOME/local-operator-ui-worktrees/qa490r6-prev-e740e5"; PORT=46711;;
  *) echo "usage: run-matrix.sh <head|prev> <scenario...>"; exit 2;;
esac
mkdir -p "$S/out" "$S/console"
for s in "$@"; do
  echo "# $label $s start $(date +%H:%M:%S)"
  env -u XPC_FLAGS node "$S/rig.mjs" --tree "$T" --label "$label" --scen "$S/scen3/$s.json" --out "$S/out" --port "$PORT" >> "$S/console/console-$label.jsonl" 2>&1
  echo "# $label $s rc=$? $(date +%H:%M:%S)"
done
