#!/usr/bin/env bash
# QA round 3 rig (from round 2's) for PR #482: boot the scripted provider, the REAL daemon from the
# companion worktree, and my own instrumented proxy on 8080; run the QA scene; reap
# every listener by exact pid before this command returns.
#
#   usage: capture-r2.sh <scene> <pass-label> [window-size] [old-daemon 0|1]
#
# Hard rules this script keeps: 1111 is never bound (it is the operator's own
# backend); the stub and the daemon bind OS-chosen ports; 8080 is checked free
# immediately before the bind and refused if not; every pid is recorded and
# signalled in the EXIT trap; the proxy's own counters are printed at the end.
set -uo pipefail

SCENE="${1:?usage: capture-r2.sh <scene> <pass-label> [window-size] [old-daemon 0|1]}"
PASS="${2:?usage: capture-r2.sh <scene> <pass-label> [window-size] [old-daemon 0|1]}"
WINDOW="${3:-}"
OLD_DAEMON="${4:-0}"
LOCK=${PORT8080_LOCK:?set the shared 8080 lock dir}
LOCKED=0
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$HERE/run-$PASS"
OUT="$HERE/frames/$PASS"
TREE="${QA_UI_TREE:?UI worktree at the PR head}"
BACKEND_WT="${QA_BACKEND_TREE:?local-operator worktree with its own .venv}"
PY="$BACKEND_WT/.venv/bin/python"
UI_PORT=8080
DESK_STAMP="qa482r6-$(uuidgen | tr A-Z a-z)"

CONFIG="$RUN/config"; WORKSPACE="$RUN/workspace"; RECORDS="$RUN/records"
STATS="$RUN/proxy-stats.json"
STUB_PID=""; DESK_PID=""; PROXY_PID=""

reap() {
  for pid in "$PROXY_PID" "$DESK_PID" "$STUB_PID"; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null || true
  done
  sleep 0.4
  for pid in "$PROXY_PID" "$DESK_PID" "$STUB_PID"; do
    [[ -n "$pid" ]] || continue
    kill -9 "$pid" 2>/dev/null || true
  done
  if [[ -n "$PROXY_PID" ]]; then
    held="$(lsof -nP -iTCP:"$UI_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    if [[ -n "$held" ]]; then
      echo "WARNING: something still listens on $UI_PORT (pid ${held:-none})" >&2
    else
      echo "8080 released before this command returned"
    fi
  fi
  if [[ "$LOCKED" == 1 ]]; then rmdir "$LOCK" && echo "port8080.lock released"; fi
  [[ -f "$STATS" ]] && { echo "--- proxy counters ($STATS) ---"; cat "$STATS"; echo "--- end counters ---"; }
}
trap reap EXIT INT TERM

[[ -x "$PY" ]] || { echo "no venv python at $PY" >&2; exit 1; }
[[ -d "$TREE/out/renderer" ]] || { echo "no built renderer in $TREE" >&2; exit 1; }


rm -rf "$RUN"; mkdir -p "$CONFIG" "$WORKSPACE" "$RECORDS" "$RUN/logs" "$OUT"
printf '# workspace\n\nScratch cwd for the /btw aside QA rig.\n' > "$WORKSPACE/README.md"
cd "$RUN" || exit 1
"$PY" -c "import local_operator; assert local_operator.__file__.startswith('$BACKEND_WT'), local_operator.__file__" \
  || { echo "the venv does not resolve to the aside-guard worktree" >&2; exit 1; }

# --- the scripted provider (OS-chosen port) ---------------------------------
: > "$RUN/requests.jsonl"
env -i HOME="$RUN" LOCAL_OPERATOR_HOME="$RUN" LOCAL_OPERATOR_CONFIG_DIR="$CONFIG" \
  PATH="$PATH" TERM=xterm-256color GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 \
  STUB_PORT=0 STUB_PORT_FILE="$RUN/stub.port" STUB_LOG="$RUN/requests.jsonl" \
  STUB_FIRST_DELAY=1.8 STUB_CHUNK_DELAY=0.30 \
  nohup "$PY" "$HERE/stub_provider.py" > "$RUN/logs/stub.log" 2>&1 &
STUB_PID=$!
for _ in $(seq 1 100); do [[ -s "$RUN/stub.port" ]] && break; sleep 0.1; done
STUB_PORT="$(cat "$RUN/stub.port" 2>/dev/null || true)"
[[ -n "$STUB_PORT" ]] || { echo "the stub never reported a port" >&2; exit 1; }

cat > "$CONFIG/config.yml" <<YAML
version: "0.0.0"
metadata:
  created_at: "2026-09-23T00:00:00Z"
  last_modified: "2026-09-23T00:00:00Z"
  description: "isolated /btw aside QA rig"
values:
  hosting: openai-compatible
  model_name: btw-stub
  providers:
    openai-compatible:
      base_url: http://127.0.0.1:$STUB_PORT/v1
YAML

# --- the real daemon (OS-chosen port) ----------------------------------------
env -i HOME="$RUN" LOCAL_OPERATOR_HOME="$RUN" LOCAL_OPERATOR_CONFIG_DIR="$CONFIG" \
  PATH="$PATH" TERM=xterm-256color GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$DESK_STAMP" \
  nohup "$PY" -m local_operator.cli serve --host 127.0.0.1 --port 0 \
  > "$RUN/logs/server.log" 2>&1 &
DESK_PID=$!
RECORD=""
for _ in $(seq 1 300); do
  RECORD="$(ls "$CONFIG"/run/serve/*.json 2>/dev/null | head -1 || true)"
  [[ -n "$RECORD" ]] && break
  sleep 0.1
done
[[ -n "$RECORD" ]] || { echo "the daemon never published a serve record" >&2; exit 1; }
DESK_PORT="$("$PY" -c "import json; print(json.load(open('$RECORD'))['port'])")"
curl -fsS "http://127.0.0.1:$DESK_PORT/health" >/dev/null \
  || { echo "the daemon never answered /health on $DESK_PORT" >&2; exit 1; }

# --- my instrumented proxy, on the one port the page allows -------------------
#
# FAULT_ID is 32 hex digits on purpose: the backend's own pattern is
# ``^[a-f0-9]{32}$``, so a 16-digit id is a 422 ("The request has invalid fields")
# rather than the stale-id case this round is testing. NO COMMENT MAY SIT INSIDE THE
# ENV LIST BELOW: measured here, a comment line terminates the command and the proxy
# starts with no BACKEND_PORT, which is how two passes refused to bind.
# Round 4: a peer rig has been binding 8080 WITHOUT the lock, so wait for BOTH the lock
# and the port to be free, take the lock, then re-check the port (refuse if it moved).
for _ in $(seq 1 120); do
  if ! lsof -nP -iTCP:"$UI_PORT" -sTCP:LISTEN -t >/dev/null 2>&1 && mkdir "$LOCK" 2>/dev/null; then GOT=1; break; fi
  echo "8080 or its lock is held by a peer; retrying in 30s ($(date +%H:%M:%S))"; sleep 30
done
[[ "${GOT:-0}" == 1 ]] || { echo "never got 8080" >&2; exit 3; }
LOCKED=1
echo "port8080.lock taken"
if lsof -nP -iTCP:"$UI_PORT" -sTCP:LISTEN -t 2>/dev/null | grep -q .; then
  echo "8080 became occupied between the check and the bind; refusing" >&2
  exit 3
fi
PROXY_PORT="$UI_PORT" BACKEND_HOST=127.0.0.1 BACKEND_PORT="$DESK_PORT" \
  RECORD_SRC="$RECORD" RECORDS_OUT="$RECORDS" PROXY_LOG="$RUN/logs/proxy.log" \
  STATS_OUT="$STATS" OLD_DAEMON="$OLD_DAEMON" HOLD_MS="${HOLD_MS:-10000}" \
  nohup node "$HERE/proxy-r6.mjs" > "$RUN/logs/proxy.stdout" 2>&1 &
PROXY_PID=$!
for _ in $(seq 1 100); do
  lsof -nP -iTCP:"$UI_PORT" -sTCP:LISTEN -t 2>/dev/null | grep -q . && break
  sleep 0.1
done
[[ "$(lsof -nP -iTCP:"$UI_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)" == "$PROXY_PID" ]] || {
  echo "8080 is not held by our proxy ($PROXY_PID); refusing" >&2; exit 3; }
curl -fsS "http://127.0.0.1:$UI_PORT/health" >/dev/null || { echo "the proxy never answered /health" >&2; exit 1; }
echo "rig up: proxy $PROXY_PID on 8080 -> daemon $DESK_PID on $DESK_PORT, stub $STUB_PORT; 1111 untouched"

# --- the scene ---------------------------------------------------------------
export LOCAL_OPERATOR_DESKTOP_TOKEN="$DESK_STAMP"
cd "$TREE" || exit 1
echo "== $PASS ($SCENE) at $(date -u +%H:%M:%S) =="
env -u LOCAL_OPERATOR_CONFIG_DIR QA_PROXY_STATS="$STATS" QA_SEED_TURNS="${QA_SEED_TURNS:-0}" QA_RUNS="${QA_RUNS:-0}" QA_ASIDE_FIRST="${QA_ASIDE_FIRST:-0}" QA_CAP_CASES="${QA_CAP_CASES:-}" node scripts/renderer-driver-qa6.mjs \
  --scene "$SCENE" \
  ${WINDOW:+--window-size "$WINDOW"} \
  --run-label "$PASS" \
  --backend "http://127.0.0.1:$UI_PORT" \
  --backend-records "$RECORDS" \
  --seed-onboarding-complete \
  --out "$OUT" \
  --clean 2>&1 | tee "$RUN/driver.log"
echo "== $PASS driver exit: ${PIPESTATUS[0]} =="
ls -la "$OUT"
