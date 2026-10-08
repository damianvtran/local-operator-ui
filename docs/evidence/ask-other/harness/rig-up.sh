#!/bin/bash
# The launcher: the real routes daemon, ONE owner process per session, and the Vite
# server that serves the SHIPPED renderer of the tree under test. Leaves everything
# running; pids land in <scratch>/{routes,owner-a,owner-c,vite}.pid.
#
# It is the `ask-drawer-stuck` rig (the committed shape this set reuses) with this
# set's backend shim, and it serves WHICHEVER TREE `RIG_REPO` names - which is how one
# harness photographs both `origin/main` and the branch:
#
#   RIG_REPO=<main checkout>   RIG_SCRATCH=<dir> ASKS_RIG_PORT=5321 bash rig-up.sh   # BEFORE
#   RIG_REPO=<this checkout>   RIG_SCRATCH=<dir> ASKS_RIG_PORT=5322 bash rig-up.sh   # AFTER
#
# The Vite config is the tree's OWN copy of `ask-drawer-stuck/harness/asks-rig.vite.mjs`
# (it derives the repository root from its own location), so each run serves that tree's
# `src/` through that tree's `node_modules`, not one tree's code under the other's.
#
# THE SCRATCH ROOT IS UNDER $TMPDIR, NOT A SCRATCHPAD: the runtime opens a unix socket
# beneath it, and macOS caps a socket path at ~104 bytes, which a session scratchpad's
# path already spends. Name it session-uniquely (the default does) and remove it with
# rig-down.sh's printed hint.
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
WT="${RIG_REPO:-$(cd "$RIG/../../../.." && pwd)}"
PY="${RIG_PY:-$HOME/.local/share/lop/current/tools/local-operator/bin/python}"
SCRATCH="${RIG_SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/ask-other-rig.XXXXXX")}"
LOG="$SCRATCH/logs"
VITE_CONFIG="$WT/docs/evidence/ask-drawer-stuck/harness/asks-rig.vite.mjs"
mkdir -p "$LOG" "$SCRATCH/triggers"
echo "scratch: $SCRATCH"
echo "serving: $WT"
[ -f "$VITE_CONFIG" ] || { echo "no Vite config at $VITE_CONFIG"; exit 1; }

start() {
  local name="$1"; shift
  nohup "$PY" "$RIG/serve-other.py" --scratch "$SCRATCH" "$@" \
    >"$LOG/$name.log" 2>&1 </dev/null &
  echo $! > "$SCRATCH/$name.pid"
  disown 2>/dev/null || true
}

start routes --mode routes
for _ in $(seq 1 240); do [ -s "$SCRATCH/routes-port" ] && break; sleep 0.5; done
[ -s "$SCRATCH/routes-port" ] || { echo "routes never started"; tail -20 "$LOG/routes.log"; exit 1; }

start owner-a --mode owner --role asks --session-id aaaa11112222 --title "Release planning"
start owner-c --mode owner --role gate --session-id cccc11112222 --title "Extension pairing"
for _ in $(seq 1 240); do
  [ -s "$SCRATCH/owner-aaaa11112222-ready" ] && [ -s "$SCRATCH/owner-cccc11112222-ready" ] && break
  sleep 0.5
done
[ -s "$SCRATCH/owner-aaaa11112222-ready" ] || { echo "owner-a never ready"; tail -20 "$LOG/owner-a.log"; exit 1; }
[ -s "$SCRATCH/owner-cccc11112222-ready" ] || { echo "owner-c never ready"; tail -20 "$LOG/owner-c.log"; exit 1; }

VITEPORT="${ASKS_RIG_PORT:-5321}"
if lsof -nP -iTCP:"$VITEPORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $VITEPORT already held:"; lsof -nP -iTCP:"$VITEPORT" -sTCP:LISTEN; exit 1
fi
cd "$WT"
ASKS_RIG_PORT="$VITEPORT" \
VITE_LOCAL_OPERATOR_API_URL="http://localhost:$VITEPORT" \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL="http://127.0.0.1:$(cat "$SCRATCH/routes-port")" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$SCRATCH/token")" \
  nohup node_modules/.bin/vite --strictPort --config "$VITE_CONFIG" \
  >"$LOG/vite.log" 2>&1 </dev/null &
VITE_PID=$!
echo "$VITE_PID" > "$SCRATCH/vite.pid"
disown 2>/dev/null || true
for _ in $(seq 1 240); do curl -sf "http://localhost:$VITEPORT/" -o /dev/null && break; sleep 0.5; done
curl -sf "http://localhost:$VITEPORT/" -o /dev/null || { echo "vite never answered"; tail -20 "$LOG/vite.log"; exit 1; }
LISTENER_PID="$(lsof -nP -iTCP:"$VITEPORT" -sTCP:LISTEN -t | head -1)"
if [ "$LISTENER_PID" != "$VITE_PID" ]; then
  echo "port $VITEPORT answered by pid ${LISTENER_PID:-none}, not our vite ($VITE_PID)"; exit 1
fi

echo "routes port: $(cat "$SCRATCH/routes-port")"
echo "pids:"; for f in routes owner-a owner-c vite; do echo "  $f $(cat "$SCRATCH/$f.pid" 2>/dev/null)"; done
echo "vite: http://localhost:$VITEPORT"
echo "stop it: RIG_SCRATCH=$SCRATCH bash $RIG/rig-down.sh   (then rm -rf the scratch root)"
