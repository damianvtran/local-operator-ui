#!/bin/bash
# Stop the asks-stuck rig by exact pid (never by process name).
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
SCRATCH="${RIG_SCRATCH:-$RIG/run}"
for f in routes owner-a owner-b vite; do
  if [ -f "$SCRATCH/$f.pid" ]; then
    pid="$(cat "$SCRATCH/$f.pid")"
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -KILL "$pid" 2>/dev/null || true
    echo "stopped $f ($pid)"
  fi
done
