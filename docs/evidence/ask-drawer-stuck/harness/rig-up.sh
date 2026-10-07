#!/bin/bash
# The launcher: `--mode routes` for the serve daemon, `--mode owner` for ONE
# session's owner process (the shape tests/e2e/test_desktop_sessions.py builds
# in-process). Leaves everything running; pids land in <scratch>/{routes,owner-a,owner-b}.pid.
#
# THE SCRATCH ROOT IS OUTSIDE THE REPOSITORY BY DEFAULT and is PRINTED: the owner
# processes write a config root and a runtime record there, which must never land
# in the tree that is being photographed. Pass the printed path (or the same
# RIG_SCRATCH) to rig-down.sh to stop the rig by exact pid.
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
# The repository this rig serves: derived from THIS script's location, overridable
# for a worktree that keeps its harness elsewhere (RIG_REPO=...).
WT="${RIG_REPO:-$(cd "$(dirname "$0")/../../../.." && pwd)}"
# The RUNTIME the owner processes assemble in-process (the installed `lop`
# generation's interpreter); override with RIG_PY for another install.
PY="${RIG_PY:-$HOME/.local/share/lop/current/tools/local-operator/bin/python}"
SCRATCH="${RIG_SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/ask-drawer-stuck-rig.XXXXXX")}"
LOG="$SCRATCH/logs"
echo "scratch: $SCRATCH"

# Kill any previous instance (pid files only, exact pids; never by name).
for f in routes owner-a owner-b vite; do
  if [ -f "$SCRATCH/$f.pid" ]; then
    kill -TERM "$(cat "$SCRATCH/$f.pid")" 2>/dev/null || true
  fi
done
sleep 1
rm -rf "$SCRATCH"
mkdir -p "$LOG"

start() {
  local name="$1"; shift
  nohup "$PY" "$RIG/serve-asks.py" --scratch "$SCRATCH" "$@" \
    >"$LOG/$name.log" 2>&1 </dev/null &
  echo $! > "$SCRATCH/$name.pid"
  disown 2>/dev/null || true
}

start routes --mode routes
for _ in $(seq 1 240); do [ -s "$SCRATCH/routes-port" ] && break; sleep 0.5; done
[ -s "$SCRATCH/routes-port" ] || { echo "routes never started"; tail -20 "$LOG/routes.log"; exit 1; }

start owner-a --mode owner --session-id aaaa11112222 --title "Deploy checklist" --ask
start owner-b --mode owner --session-id bbbb11112222 --title "Notes"

for _ in $(seq 1 240); do
  [ -s "$SCRATCH/owner-aaaa11112222-ready" ] && [ -s "$SCRATCH/owner-bbbb11112222-ready" ] && break
  sleep 0.5
done

# The Vite dev server: the shipped renderer, served for a browser, with the
# desktop bridge over /__desktop and the daemon as the proxied backend.
VITEPORT="${ASKS_RIG_PORT:-5311}"
for _ in $(seq 1 180); do
  lsof -nP -iTCP:"$VITEPORT" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 1
done
if lsof -nP -iTCP:"$VITEPORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $VITEPORT already held:"; lsof -nP -iTCP:"$VITEPORT" -sTCP:LISTEN; exit 1
fi
cd "$WT"
ASKS_RIG_PORT="$VITEPORT" \
VITE_LOCAL_OPERATOR_API_URL="http://localhost:$VITEPORT" \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL="http://127.0.0.1:$(cat "$SCRATCH/routes-port")" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$SCRATCH/token")" \
  nohup node_modules/.bin/vite --strictPort --config "$RIG/asks-rig.vite.mjs" \
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
echo "records:"; ls "$SCRATCH/config/run/mobile/" 2>/dev/null || echo "  none yet"
echo "owners:"; for f in owner-a owner-b vite; do echo "  $f pid $(cat "$SCRATCH/$f.pid" 2>/dev/null)"; done
echo "vite: http://localhost:$VITEPORT"
