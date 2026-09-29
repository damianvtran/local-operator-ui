#!/usr/bin/env bash
# One ack/selection capture pass against the BUILT app from the tree named.
#
#   bash run.sh <tree> <label>
#
# The isolation and the guards are this set's own but follow the two committed
# harnesses it borrows from — `docs/evidence/window-mode/harness/run.sh` (a
# backend on a port this run checked nobody else owns, HOME / config dir / log
# dir under a scratch root, the app launched OUT of that root so no repo `.env`
# can point it at the operator's backend) and
# `docs/evidence/chat-sidebar-selection/harness/run.sh` (the dev driver armed,
# teardown by EXACT PID with the pid recorded from the app's own binary, a
# post-teardown check that nothing carrying this run's scratch path survived).
#
# WHY A THIRD COPY RATHER THAN A WRAPPER around the window-mode harness: this
# set needs a fact that harness cannot give it — the backend's BEARER TOKEN and
# URL in the drive script's environment, because the receipt scenes read the
# conversation's attention state from the backend itself (the ground truth the
# UI's mark is a rendering of) and send the turns that produce completions.
# The window-mode harness generates its token internally and shares it with
# nobody, so a wrapper cannot reach it. Everything else is copied deliberately
# rather than quietly reinvented, with the same checks spelled the same way.
#
# Ports are deliberately not any other set's defaults: several agent sessions
# run these harnesses on one laptop, and a port already LISTENING fails the run
# loudly rather than attaching to somebody else's window or backend.
set -euo pipefail

TREE="$(cd "${1:?tree}" && pwd)"
LABEL="${2:?label}"
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SCRATCH="${SCRATCH:-/tmp/chat-sidebar-ack-and-selection/$LABEL}"
BACKEND_PORT="${BACKEND_PORT:-14641}"
CDP_PORT="${CDP_PORT:-9511}"
export SCRATCH BACKEND_PORT CDP_PORT ACK_PREFIX="$LABEL"
export ACK_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"

rm -rf "$SCRATCH"; mkdir -p "$SCRATCH/home"

# An inherited CMUX_* variable has renamed a real workspace from an earlier
# headless test in this repository, so clear them before anything boots.
for name in $(env | sed -n 's/^\(CMUX_[A-Z_]*\)=.*/\1/p'); do unset "$name"; done
unset LOCAL_OPERATOR_CONFIG_DIR LOCAL_OPERATOR_HOME LOCAL_OPERATOR_DESKTOP_TOKEN 2>/dev/null || true

# A port that is already LISTENING is not a free one. The CDP driver attaches
# to whatever answers on its port, and the receipt scenes talk to whatever
# answers on the backend port with a bearer this run minted — both must be
# ours from the first connection.
if lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FAIL: something is already listening on the CDP port $CDP_PORT - refusing to drive a window this run does not own (set CDP_PORT=)" >&2
  exit 1
fi
if lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FAIL: something is already listening on the backend port $BACKEND_PORT - refusing to attach to a backend this run did not start (set BACKEND_PORT=)" >&2
  exit 1
fi

# The app under test is the one built in $TREE, on the Electron that tree
# pins. Spawned by its own binary rather than the node shim, so the pid this
# run records IS the app's main process (see `docs/agent-driver.md` § "The
# app's lifecycle" for why the shim's pid is the wrong one to signal).
ELECTRON_BIN="$TREE/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$ELECTRON_BIN" ]; then
  echo "FAIL: $ELECTRON_BIN is missing - run pnpm install in $TREE" >&2
  exit 1
fi
if [ ! -f "$TREE/out/main/index.js" ]; then
  echo "FAIL: $TREE has no build (out/main/index.js missing) - run pnpm build there first" >&2
  exit 1
fi

node "${ACK_SEED:-$HARNESS/seed.mjs}" "$SCRATCH" >/dev/null
TOKEN=$(openssl rand -hex 32)
export LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN"

echo "== chat-sidebar-ack-and-selection: label=$LABEL tree=$TREE scratch=$SCRATCH"

# The backend: the installed runtime this machine ships (`local-operator`), on
# this run's port, under this run's config root. LOG dir and HOME are scratch
# because the app's logger resolves from Electron's `home` and this machine's
# own log directory is the operator's.
LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" \
LOCAL_OPERATOR_HOME="$SCRATCH/home" \
LOCAL_OPERATOR_LOG_DIR="$SCRATCH/logs" \
HOME="$SCRATCH/home" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
LOCAL_OPERATOR_NO_NOTIFICATIONS=1 \
LOCAL_OPERATOR_NO_AIDA="${ACK_NO_AIDA:-1}" \
  nohup local-operator serve --host 127.0.0.1 --port "$BACKEND_PORT" \
  >"$SCRATCH/backend.log" 2>&1 &
BACKEND_PID=$!
READY=0
for _ in $(seq 1 90); do
  if curl -sf "$ACK_BACKEND_URL/v1/desktop/sessions" \
    -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "FAIL: the isolated backend never answered on $ACK_BACKEND_URL" >&2
  tail -20 "$SCRATCH/backend.log" >&2 || true
  exit 1
fi

# The app. Launched from $SCRATCH so `dotenv` in `src/main/backend/config.ts`
# finds no repo `.env` (`override: true` would otherwise beat the launch), and
# with the dev driver armed through the LAUNCH environment — the gate reads the
# pre-dotenv snapshot, so this cannot be armed by a file.
( cd "$SCRATCH"
  VITE_DISABLE_BACKEND_MANAGER="true" \
  VITE_LOCAL_OPERATOR_API_URL="$ACK_BACKEND_URL" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" \
  LOCAL_OPERATOR_HOME="$SCRATCH/home" \
  LOCAL_OPERATOR_LOG_DIR="$SCRATCH/logs" \
  HOME="$SCRATCH/home" \
  LOCAL_OPERATOR_UI_WINDOW_MODE=headless \
  LOCAL_OPERATOR_UI_DEV_DRIVER=1 \
  LOCAL_OPERATOR_UI_DEV_DRIVER_OUT="$SCRATCH/frames" \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 \
  LOCAL_OPERATOR_NO_AIDA="${ACK_NO_AIDA:-1}" \
    nohup "$ELECTRON_BIN" "$TREE" --window-mode=headless \
      --remote-debugging-port="$CDP_PORT" \
      "--user-data-dir=$SCRATCH/profile" "--window-size=1380x900" \
      >"$SCRATCH/electron.log" 2>&1 & echo $! > "$SCRATCH/app.pid" )
APP_PID="$(cat "$SCRATCH/app.pid")"

stop() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  kill -KILL "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  kill -0 "$pid" 2>/dev/null && echo "WARN: pid $pid ignored SIGTERM and SIGKILL" >&2
  return 0
}

teardown() {
  stop "$APP_PID"
  stop "$BACKEND_PID"
  rm -f "$SCRATCH/app.pid"
  local left
  left="$(pgrep -f "$SCRATCH/" 2>/dev/null | tr '\n' ' ' || true)"
  if [ -n "$left" ]; then
    echo "FAIL: a process from this run survived teardown (pids: $left)" >&2
    exit 1
  fi
  echo "== teardown: no process from $SCRATCH survived"
}
trap teardown EXIT

for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  sleep 1
done
CDP_OWNER=$(lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$CDP_OWNER" ]; then
  echo "FAIL: no process is listening on the CDP port $CDP_PORT - the app did not start" >&2
  tail -20 "$SCRATCH/electron.log" >&2 || true
  exit 1
fi
if [ "$CDP_OWNER" != "$APP_PID" ]; then
  echo "FAIL: the CDP port $CDP_PORT belongs to pid $CDP_OWNER, not this run's app ($APP_PID) - refusing to drive it" >&2
  exit 1
fi

# The app must have resolved the mode it was launched with, and must say the
# window was never shown. A run that quietly raised a window would still
# produce frames that look identical, so the log is checked before driving.
# The `state:` line is emitted 1500 ms after `ready-to-show` (src/main/index.ts),
# so it is POLLED rather than read once: reading it hot is a race with the app's
# own boot, not a statement about the window.
MODE_LINE="$(grep -h "\[window-mode\] window mode" "$SCRATCH/electron.log" | tail -1 || true)"
grep -q "window mode headless: 1380x900," <<<"$MODE_LINE" \
  || { echo "FAIL: the app did not report a headless 1380x900 launch: ${MODE_LINE:-nothing}" >&2; exit 1; }
STATE=""
for _ in $(seq 1 60); do
  STATE="$(grep -h "\[window-mode\] state:" "$SCRATCH/electron.log" | tail -1 || true)"
  grep -q "state: visible=false" <<<"$STATE" && break
  sleep 0.5
done
grep -q "state: visible=false" <<<"$STATE" \
  || { echo "FAIL: headless must report visible=false, got: ${STATE:-nothing}" >&2; exit 1; }
echo "== the app reported the mode it was asked for, window never shown"

set +e
node "${ACK_DRIVE:-$HARNESS/drive.mjs}" "$CDP_PORT" "$SCRATCH" | tee "$SCRATCH/drive.out"
DRIVE_EXIT=${PIPESTATUS[0]}
set -e
echo "== drive exit: $DRIVE_EXIT"

echo "== backend log line count: $(wc -l < "$SCRATCH/backend.log" | tr -d ' ')"
if [ "$DRIVE_EXIT" != "0" ]; then
  echo "== DRIVE FAILED (exit $DRIVE_EXIT) - see $SCRATCH/drive.out and the frames in $SCRATCH/frames"
fi
exit "$DRIVE_EXIT"
