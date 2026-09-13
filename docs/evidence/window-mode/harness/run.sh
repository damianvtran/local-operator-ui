#!/usr/bin/env bash
# One window-mode measurement against the built app from the tree named.
#
#   bash run.sh <tree> <label> <mode> <WxH> [hash-route]
#
# Isolated the way a QA rig is: a backend on a port this script owns, and
# LOCAL_OPERATOR_CONFIG_DIR / LOCAL_OPERATOR_HOME / HOME under /tmp, so
# ~/.local-operator is never touched. HOME is load-bearing and not tidiness: the
# model catalogue's cache resolves from it (`local_operator/model/catalogue.py`
# `default_cache_dir()` -> `~/.local-operator/cache`), NOT from the config dir,
# so an inherited HOME writes a run's synthetic listings into the operator's real
# cache — which then lists models that do not exist until something refreshes it.
# An earlier version of this file isolated the two LOCAL_OPERATOR_* variables
# only, while this header claimed otherwise (QA round 2, Q3).
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
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH" "$SCRATCH/home"

# An inherited CMUX_* variable has renamed a real workspace from an earlier
# headless test in this repository, so clear them before anything boots.
for name in $(env | sed -n 's/^\(CMUX_[A-Z_]*\)=.*/\1/p'); do unset "$name"; done
unset LOCAL_OPERATOR_CONFIG_DIR LOCAL_OPERATOR_HOME LOCAL_OPERATOR_DESKTOP_TOKEN 2>/dev/null || true

# A port that is already LISTENING is not a free one: the CDP driver attaches to
# whatever answers on it, and if that is another agent's app the frames are of
# THEIR window and the input events go to their session. This happened on
# 2026-09-13: a run whose CDP port collided with a peer's drove the operator's
# own config (282 chats on screen) and photographed it, because nothing checked
# who owned the socket before typing into it. Fail before launching instead of
# measuring somebody else's app.
if lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FAIL: something is already listening on the CDP port $CDP_PORT - refusing to drive a window this run does not own (set CDP_PORT=)" >&2
  exit 1
fi
if lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FAIL: something is already listening on the backend port $BACKEND_PORT - refusing to attach to a backend this run did not start (set BACKEND_PORT=)" >&2
  exit 1
fi

node "$HARNESS/seed.mjs" "$SCRATCH" >/dev/null
# Optional second seeding pass, for a specialised driver that needs a different
# STARTING STATE (a configured model, a credential, a longer transcript) rather
# than a different measurement. Runs with the same scratch root, after the
# standard seed, and is a separate script so this harness keeps one seed shape.
if [ -n "${EXTRA_SEED:-}" ]; then node "$EXTRA_SEED" "$SCRATCH" >/dev/null; fi
TOKEN=$(openssl rand -hex 32)

echo "== $LABEL: tree=$TREE mode=$MODE window=$SIZE scratch=$SCRATCH"
LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" \
LOCAL_OPERATOR_HOME="$SCRATCH/home" \
HOME="$SCRATCH/home" \
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
#
# The app is launched from $SCRATCH and handed $TREE as its app path, and that
# is load-bearing rather than tidy: `src/main/backend/config.ts` loads `.env`
# with `dotenvConfig({ path: join(process.cwd(), ".env"), override: true })`,
# so a launch whose cwd is the tree reads the TREE's `.env` — whatever another
# agent left there — and `override: true` means it beats the
# `VITE_LOCAL_OPERATOR_API_URL` exported below. QA measured exactly that: a
# checked-out tree carrying `VITE_LOCAL_OPERATOR_API_URL` silently pointed the
# run at the live backend on 127.0.0.1:1111 instead of the isolated one on
# $BACKEND_PORT, so the frames would have been of the operator's real
# conversation. Launching from the scratch root leaves no `.env` for dotenv to
# find, which is why the isolated URL below is the one the app uses.
ELECTRON_BIN="${ELECTRON_BIN:-npx electron}"
( cd "$SCRATCH"
  VITE_DISABLE_BACKEND_MANAGER="true" \
  VITE_LOCAL_OPERATOR_API_URL="http://127.0.0.1:$BACKEND_PORT" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" \
  LOCAL_OPERATOR_HOME="$SCRATCH/home" \
  HOME="$SCRATCH/home" \
  LOCAL_OPERATOR_UI_WINDOW_MODE="$MODE" \
    nohup $ELECTRON_BIN "$TREE" --remote-debugging-port="$CDP_PORT" \
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

# And once more with the app up: the socket must belong to THIS run's Electron.
# A second instance that loses the single-instance lock exits, so the listener
# can only be ours — but the check is what makes that a fact rather than a hope.
CDP_OWNER=$(lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$CDP_OWNER" ]; then
  echo "FAIL: no process is listening on the CDP port $CDP_PORT - the app did not start" >&2
  exit 1
fi
if [ "$CDP_OWNER" != "$(app_main_pid)" ]; then
  echo "FAIL: the CDP port $CDP_PORT belongs to pid $CDP_OWNER, not this run's app ($(app_main_pid)) - refusing to drive it" >&2
  exit 1
fi

LOG="$SCRATCH/frontmost.log"; : > "$LOG"
( for _ in $(seq 1 120); do
    echo "$(date +%s.%N) $(frontmost) ours=$(app_main_pid)" >> "$LOG"
    sleep 0.3
  done ) &
SAMPLER=$!

node "${DRIVE_SCRIPT:-$HARNESS/drive.mjs}" "$CDP_PORT" "$SCRATCH" "$ROUTE" | tee "$SCRATCH/drive.out"

# A second launch, while the sampler is still running. The single-instance lock
# hands it to this process as `second-instance`, which is the other path that can
# raise a window — the one a rig hits when it starts a run twice. The second
# process quits on the lock.
( cd "$SCRATCH"
  nohup "$ELECTRON_BIN" "$TREE" "--user-data-dir=$SCRATCH/profile" \
    >"$SCRATCH/electron-second.log" 2>&1 & )
sleep 5

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

# A run that says it was launched in one mode at one size, but reports another,
# would otherwise produce frames and a scratch log that both look like the
# requested values. Assert what the app emitted against what was asked for, so
# this harness cannot quietly measure something other than its arguments.
STATE="$(grep -h "\[window-mode\] state:" "$SCRATCH/electron.log" | tail -1)"
MODE_LINE="$(grep -h "\[window-mode\] window mode" "$SCRATCH/electron.log" | tail -1)"

# The plan clamps the request to the verified 800x600 floor and the 16384
# ceiling, and reports the clamp. Compute the size the app should have ended up
# with from those same two numbers, so the clamped case is checked against the
# contract rather than exempted from it.
IFS=x read -r REQ_W REQ_H <<< "$SIZE"
clamp() { if [ "$1" -lt "$2" ]; then echo "$2"; elif [ "$1" -gt "$3" ]; then echo "$3"; else echo "$1"; fi; }
EXPECT_W="$(clamp "$REQ_W" 800 16384)"
EXPECT_H="$(clamp "$REQ_H" 600 16384)"
EXPECT_SIZE="${EXPECT_W}x${EXPECT_H}"

grep -q "window mode $MODE: $EXPECT_SIZE," <<<"$MODE_LINE" \
  || { echo "FAIL: asked for mode=$MODE size=$SIZE (expected $EXPECT_SIZE), the app reported ${MODE_LINE:-nothing}" >&2; exit 1; }
if [ "$EXPECT_SIZE" != "$SIZE" ]; then
  grep -q "window size $SIZE clamped to $EXPECT_SIZE" "$SCRATCH/electron.log" \
    || { echo "FAIL: $SIZE was clamped to $EXPECT_SIZE without saying so" >&2; exit 1; }
fi
if [ "$MODE" = "normal" ]; then
  [ -z "$STATE" ] || { echo "FAIL: normal must print no state line, got: $STATE" >&2; exit 1; }
else
  case "$MODE" in
    headless) grep -q "state: visible=false" <<<"$STATE" || { echo "FAIL: headless must report visible=false, got: ${STATE:-nothing}" >&2; exit 1; } ;;
    inactive) grep -q "state: visible=true" <<<"$STATE" || { echo "FAIL: inactive must report visible=true, got: ${STATE:-nothing}" >&2; exit 1; } ;;
  esac
fi
echo "== the app reported the mode and size it was asked for"
