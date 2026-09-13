#!/usr/bin/env bash
# One window-mode measurement against the built app from the tree named.
#
#   bash run.sh <tree> <label> <mode> <WxH> [hash-route]
#
# Isolated the way a QA rig is: a backend on a port this script owns, and
# LOCAL_OPERATOR_CONFIG_DIR / LOCAL_OPERATOR_HOME under /tmp, so ~/.local-operator
# is never touched.
#
# While the app runs it samples the OS for one fact: WHICH process is frontmost.
# That is the fact the change is about, and it is measured with pids rather than
# names, because other agents run Electron instances on the same machine and
# "an app called Electron was frontmost" says nothing about this one.
#
# The window's own state is not sampled from outside on purpose: `System Events`
# reports no windows for a process without Accessibility permission, and none
# for a background process even with it, so the app states its own window state
# in its log instead (`[window-mode] state: visible=... focused=...`).
set -euo pipefail

TREE="$(cd "${1:?tree}" && pwd)"
LABEL="${2:?label}"
MODE="${3:?mode}"
SIZE="${4:?WxH}"
ROUTE="${5:-#/chat/a1a1a1a1a1a1}"

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRATCH="${SCRATCH:-/tmp/window-mode/$LABEL}"
BACKEND_PORT="${BACKEND_PORT:-14381}"
CDP_PORT="${CDP_PORT:-9471}"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"

# An inherited CMUX_* variable has renamed a real workspace from an earlier
# headless test in this repository, so clear them before anything boots.
for name in $(env | sed -n 's/^\(CMUX_[A-Z_]*\)=.*/\1/p'); do unset "$name"; done
unset LOCAL_OPERATOR_CONFIG_DIR LOCAL_OPERATOR_HOME LOCAL_OPERATOR_DESKTOP_TOKEN 2>/dev/null || true

node "$HARNESS/seed.mjs" "$SCRATCH" >/dev/null
TOKEN=$(openssl rand -hex 32)

echo "== $LABEL: tree=$TREE mode=$MODE window=$SIZE scratch=$SCRATCH"
LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" \
LOCAL_OPERATOR_HOME="$SCRATCH/home" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  nohup local-operator serve --host 127.0.0.1 --port "$BACKEND_PORT" \
  >"$SCRATCH/backend.log" 2>&1 &
BACKEND_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$BACKEND_PORT/v1/desktop/sessions" \
    -H "Authorization: Bearer $TOKEN" >/dev/null && break
  sleep 1
done

app_main_pid() {
  # The browser process is the one running the Electron executable itself: the
  # node shim (`node_modules/.bin/electron` -> cli.js) is not in the window
  # server's process list at all, and helpers carry `--type=`.
  for pid in $(pgrep -f -- "$SCRATCH/profile" 2>/dev/null || true); do
    ps -o command= -p "$pid" 2>/dev/null | grep -q "dist/Electron.app" || continue
    ps -o command= -p "$pid" 2>/dev/null | grep -q -- "--type=" && continue
    echo "$pid"; return
  done
}
frontmost() {
  # One round trip, both facts, because a System Events call costs about a
  # second under load and a slower sampler would miss the launch entirely.
  osascript -e 'tell application "System Events"
    set f to first application process whose frontmost is true
    return ((unix id of f) as text) & "|" & (name of f)
  end tell' 2>/dev/null || echo "-|-"
}

BEFORE="$(frontmost)"

# ELECTRON_BIN lets the caller point at a working Electron when the tree's own
# install has no binary; the app under test is still the one built in $TREE.
ELECTRON_BIN="${ELECTRON_BIN:-npx electron}"
( cd "$TREE"
  VITE_DISABLE_BACKEND_MANAGER="true" \
  VITE_LOCAL_OPERATOR_API_URL="http://127.0.0.1:$BACKEND_PORT" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" \
  LOCAL_OPERATOR_HOME="$SCRATCH/home" \
  LOCAL_OPERATOR_UI_WINDOW_MODE="$MODE" \
    nohup $ELECTRON_BIN . --remote-debugging-port="$CDP_PORT" \
    "--user-data-dir=$SCRATCH/profile" "--window-size=$SIZE" \
    >"$SCRATCH/electron.log" 2>&1 & )

cleanup() {
  for pid in $(pgrep -f -- "$SCRATCH/profile" 2>/dev/null || true); do kill "$pid" 2>/dev/null || true; done
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null && break
  sleep 2
done

LOG="$SCRATCH/frontmost.log"; : > "$LOG"
( for _ in $(seq 1 120); do
    echo "$(date +%s.%N) $(frontmost) ours=$(app_main_pid)" >> "$LOG"
    sleep 0.3
  done ) &
SAMPLER=$!

node "$HARNESS/drive.mjs" "$CDP_PORT" "$SCRATCH" "$ROUTE" | tee "$SCRATCH/drive.out"
sleep 1
kill "$SAMPLER" 2>/dev/null || true

OUR_PID="$(app_main_pid)"
TOTAL=$(wc -l < "$LOG" | tr -d ' ')
STOLE=$(awk -F'[| ]' -v pid="${OUR_PID:-none}" '$2 == pid' "$LOG" | wc -l | tr -d ' ')
echo "== frontmost before this run: $BEFORE"
echo "== this app was the frontmost application in $STOLE of $TOTAL samples (pid ${OUR_PID:-none})"
echo "== window-mode log lines:"
grep -h "\[window-mode\]" "$SCRATCH/electron.log" | sed 's/^/   /' || echo "   (none)"
echo "== renderer errors in the run: $(grep -c '"level":3' "$SCRATCH/electron.log" 2>/dev/null || echo 0)"
