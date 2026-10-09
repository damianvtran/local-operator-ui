#!/bin/bash
# Stop the asks-open rig by exact pid (never by process name), then print what the fenced
# `security` stub recorded: an empty log is the evidence that no process under the scratch
# HOME ever tried to reach the keychain.
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
SCRATCH="${RIG_SCRATCH:-$RIG/run}"
for f in "$SCRATCH"/*.pid; do
  [ -f "$f" ] || continue
  name="$(basename "$f" .pid)"
  pid="$(cat "$f")"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  kill -KILL "$pid" 2>/dev/null || true
  echo "stopped $name ($pid)"
done
if [ -f "$SCRATCH/security-calls.log" ]; then
  echo "security calls recorded: $(grep -c . "$SCRATCH/security-calls.log" || true)"
  cat "$SCRATCH/security-calls.log"
fi
