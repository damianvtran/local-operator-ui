#!/bin/bash
# Stop the ask-other rig by EXACT PID (never by process name): the four pid files
# rig-up.sh wrote under the scratch root. Does not remove the scratch root, because the
# driver's report may still be wanted from it; the caller removes it.
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
SCRATCH="${RIG_SCRATCH:-}"
[ -n "$SCRATCH" ] && [ -d "$SCRATCH" ] || { echo "RIG_SCRATCH must name the scratch root rig-up.sh printed"; exit 1; }
for f in vite owner-a owner-c routes; do
  if [ -f "$SCRATCH/$f.pid" ]; then
    pid="$(cat "$SCRATCH/$f.pid")"
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -KILL "$pid" 2>/dev/null || true
    echo "stopped $f ($pid)"
  fi
done
