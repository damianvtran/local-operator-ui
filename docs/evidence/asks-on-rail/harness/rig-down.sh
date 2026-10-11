#!/bin/bash
# Stop one pass's rig, by EXACT pid, and prove the scratch HOME never reached
# Keychain Services.
#
# WHY THE DESCENDANTS AND NOT JUST THE RECORDED PID. `node_modules/.bin/vite` is a
# shim: the pid `rig-up.sh` records answers the port (the listener check asserts that),
# but it also spawns an esbuild service, and a rig that killed only the recorded pid
# left that service resident (measured 2026-10-08: the fleet flagged a live vite plus
# its esbuild as a disk contributor). So each recorded pid is reaped as a TREE - first
# the children, then the pid itself - which stays scoped to pids this rig created
# (never a match on a program name).
#
# WHAT IS DELIBERATELY NOT HERE. Nothing sweeps Chrome globally, and nothing touches
# another lane's profile: the two scoped sweeps below name artifacts THIS rig made -
# its own pid files, and Chrome profiles under this machine's temp dir whose name
# carries this rig's own `asks-rig-chrome-` prefix.
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
SCRATCH="${SLOT_RIG_SCRATCH:-$RIG/run}"

reap() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    reap "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  kill -KILL "$pid" 2>/dev/null || true
}

for f in "$SCRATCH"/*.pid; do
  [ -f "$f" ] || continue
  pid="$(cat "$f")"
  [ -n "$pid" ] || continue
  reap "$pid"
  echo "stopped $(basename "$f" .pid) ($pid)"
done

# Chrome launched by this rig's drivers: the profile path is this repository's own
# naming (`asks-rig-chrome-` under the temp dir), so the match is scoped to an
# artifact this set made rather than to a program name.
if [ "${SLOT_RIG_REAP_CHROME:-1}" = "1" ]; then
  tmp="${TMPDIR:-/tmp}"
  tmp="${tmp%/}"
  for pid in $(pgrep -f -- "user-data-dir=$tmp/asks-rig-chrome-" 2>/dev/null || true); do
    reap "$pid"
    echo "stopped chrome ($pid)"
  done
fi

if [ -f "$SCRATCH/security-calls.log" ]; then
  calls="$(wc -l < "$SCRATCH/security-calls.log" | tr -d ' ')"
  echo "security calls under the scratch HOME: $calls"
  [ "$calls" != "0" ] && cat "$SCRATCH/security-calls.log"
fi
exit 0
