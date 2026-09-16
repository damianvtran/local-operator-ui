#!/usr/bin/env bash
# One chat-sidebar selection capture pass against the BUILT app from the tree named.
#
#   COMPARISON=1 bash run.sh <tree> <label> <theme>
#
# THE ISOLATION IS NOT THIS FILE'S. `docs/evidence/window-mode/harness/run.sh`
# owns it — a backend on a port this run checked nobody else owns, HOME and the
# config dir under /tmp, the seeded store, the `headless` window-mode assertions
# (including the second-instance launch and the frontmost sampler) — and this
# wrapper adds what THIS set needs on top: the dev driver armed, so the theme can
# be set through the app's own action and the frames come from the app's own
# `capturePage()`, this set's seed and drive scripts, and a teardown that stops
# the app BY PID. The mode is named explicitly (`headless`) rather than left to
# the default even though the app now assumes it for an agent launch.
#
# It is a wrapper rather than a copy because the guards in that file are the
# expensive part to re-derive (the CDP-port ownership check exists because a
# collision once drove and photographed a PEER's app) and a second copy of them
# would drift from the first.
#
# The ports are deliberately not the harness's defaults: several agent sessions
# run that harness on this laptop, and a port already LISTENING fails the run
# loudly rather than attaching to somebody else's window. Consecutive passes of
# this set must therefore be given different ports, or spaced far enough apart
# that the previous app has exited — the port check runs before the launch and
# does not care that the listener is your own previous run.
set -euo pipefail

TREE="$(cd "${1:?tree}" && pwd)"
LABEL="${2:?label}"
THEME="${3:?theme}"
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export SCRATCH="${SCRATCH:-/tmp/chat-sidebar-selection/$LABEL-$THEME}"
export BACKEND_PORT="${BACKEND_PORT:-14411}"
export CDP_PORT="${CDP_PORT:-9491}"
export EXTRA_SEED="$HARNESS/seed.mjs"
export DRIVE_SCRIPT="$HARNESS/drive.mjs"
export SIDEBAR_PREFIX="$LABEL"
export SIDEBAR_THEME="$THEME"
export LOCAL_OPERATOR_UI_DEV_DRIVER=1
# Created by seed.mjs, not here: the harness removes the scratch root between
# this line and the seeding pass, so a directory made now would be gone before
# the app could write into it.
export LOCAL_OPERATOR_UI_DEV_DRIVER_OUT="$SCRATCH/frames"

# The TREE'S OWN Electron, never `npx electron`. The harness's default resolves
# through npx, which — with no electron binary in the tree's node_modules —
# downloads the CURRENT release into the scratch HOME and runs the app on it;
# `out/main/index.jsc` is V8 bytecode for the pinned runtime, so the app then
# dies at load with `cachedDataRejected` and the run produces no frames at all.
# The pin is `optionalDependencies.electron` in package.json, and the frames are
# only reproducible on the runtime that produced them.
SIDEBAR_ELECTRON="$TREE/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
export SIDEBAR_ELECTRON
if [ ! -x "$SIDEBAR_ELECTRON" ]; then
  echo "FAIL: $SIDEBAR_ELECTRON is missing - run pnpm install in $TREE, or the run would silently fall back to a downloaded Electron" >&2
  exit 1
fi

# Launched through a one-line `exec` wrapper so the pid this run records is the
# app's OWN pid rather than a shim's; see `electron-pid.sh` and
# `docs/agent-driver.md` § "The app's lifecycle". Without it this harness leaves
# orphaned Electron processes behind: eight of them, holding devtools ports,
# survived the first passes of this very set.
#
# The pid file lives BESIDE the scratch root, not inside it, and that is
# load-bearing: the harness deletes and re-creates the scratch root on every
# pass, so a pid recorded inside it would be gone by the time a later run needed
# to reap the app of a run that died.
mkdir -p "$(dirname "$SCRATCH")"
export SIDEBAR_PID_FILE="$(dirname "$SCRATCH")/$LABEL-$THEME.pid"
if [ ! -x "$HARNESS/electron-pid.sh" ]; then
  echo "FAIL: $HARNESS/electron-pid.sh is missing or not executable (chmod +x)" >&2
  exit 1
fi
export ELECTRON_BIN="$HARNESS/electron-pid.sh"

# Stop one recorded app: SIGTERM, then SIGKILL if it is still there, waiting for
# each — never a pattern-matched kill, so the operator's own app and a peer's run
# cannot be hit by this. `stop` is silent about a pid that is already gone.
#
# The WAIT is as load-bearing as the signal. Electron unwinds asynchronously, and
# a launcher that signals and exits is what left the eight orphans reported on
# this set: the app was mid-shutdown when the next run's port check looked at the
# socket. `stop` does not return until the pid is gone.
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
  kill -0 "$pid" 2>/dev/null && echo "WARN: app pid $pid ignored SIGTERM and SIGKILL" >&2
  return 0
}

# Every pid this run's wrapper recorded, in launch order (the harness boots the
# app twice; see `electron-pid.sh` for why the file is appended to).
stop_all() {
  [ -f "$SIDEBAR_PID_FILE" ] || return 0
  while read -r pid; do
    [ -n "$pid" ] && stop "$pid"
  done < "$SIDEBAR_PID_FILE"
}

# A previous pass of this set that died before its own cleanup left an app
# holding the CDP port, and the harness then refuses to start (correctly — a port
# already listening may belong to a PEER's app). Reap exactly the app THAT pass
# recorded, by pid, and only if its command line still names this set's scratch
# root, so a recycled pid cannot be signalled by mistake.
if [ -f "$SIDEBAR_PID_FILE" ]; then
  if [ -s "$SIDEBAR_PID_FILE" ]; then
    echo "== reaping the app(s) of a previous pass: $(tr '\n' ' ' < "$SIDEBAR_PID_FILE")"
  fi
  stop_all
  rm -f "$SIDEBAR_PID_FILE"
fi

if [ -n "$(pgrep -f "$SCRATCH/" 2>/dev/null || true)" ]; then
  echo "FAIL: something carrying this run's scratch path is still running, and it is not the app this set recorded; refusing to drive a window this run does not own" >&2
  pgrep -fl "$SCRATCH/" >&2 || true
  exit 1
fi

echo "== chat-sidebar-selection: label=$LABEL theme=$THEME tree=$TREE scratch=$SCRATCH"

# Stop the app this run started, by the pid it recorded, and then MEASURE that
# nothing carrying this run's own scratch path survived. The window-mode
# harness's own trap still runs its pattern-matched kill first; this is what
# makes the outcome a fact rather than a hope, which is the property
# `docs/agent-driver.md` asks for and the one the first passes of this set failed
# (eight apps re-parented to launchd, holding their devtools ports).
teardown() {
  stop_all
  rm -f "$SIDEBAR_PID_FILE"
  local left
  left="$(pgrep -f "$SCRATCH/" 2>/dev/null | tr '\n' ' ' || true)"
  if [ -n "$left" ]; then
    echo "FAIL: an app from this run survived teardown (pids: $left) - it holds its profile and its devtools port" >&2
    exit 1
  fi
  echo "== teardown: no process from $SCRATCH survived"
}
trap teardown EXIT

# The window's SIZE comes from the caller, because the rail this set photographs
# has two layouts and the step between them is a viewport query:
# `(min-width: 1040px)` labels the rows, and below it the rail is a 48px column of
# icon-only rows. A 1000x900 launch is a different STATE of the same panel rather
# than a different frame of the same one, and this set carries it because below
# that step the ground is the only signal the current row has (round 2, D6).
export SIDEBAR_SIZE="${SIDEBAR_SIZE:-1380x900}"

bash "$HARNESS/../../window-mode/harness/run.sh" \
  "$TREE" "$LABEL-$THEME" headless "$SIDEBAR_SIZE" "#/chat/b3b3b3b3b3b3"
