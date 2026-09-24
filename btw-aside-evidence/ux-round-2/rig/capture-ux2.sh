#!/usr/bin/env bash
# ux-482-r2: one capture pass. stub + real daemon on OS-chosen ports (boot.sh), a
# plain unbuffered proxy on 8080 taken under the shared lock, the headless driver,
# then reap every pid by exact pid and release the lock before returning.
#   usage: capture-ux2.sh <label> <window-size>
set -uo pipefail
SP="$LOCAL_OPERATOR_SCRATCHPAD"; RIG="$SP/rig"; TAG=$(cat "$SP/tag")
UI=~/local-operator-ui-worktrees/$TAG; BE=~/local-operator-worktrees/$TAG
LABEL="$1"; SIZE="$2"; OUT="$RIG/frames/$LABEL"
LOCK=/Users/damian/.local-operator/sessions/15622aeab8ed/scratchpad/port8080.lock
LOCKED=0; PX=""; DRV=""
cleanup() {
  [[ -n "$DRV" ]] && kill "$DRV" 2>/dev/null
  [[ -n "$PX" ]] && kill "$PX" 2>/dev/null
  for f in "$RIG/server.pid" "$RIG/stub.pid"; do [[ -f $f ]] && { p=$(cat $f); pkill -TERM -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; }; done
  sleep 2
  for f in "$RIG/server.pid" "$RIG/stub.pid"; do [[ -f $f ]] && { p=$(cat $f); pkill -9 -P "$p" 2>/dev/null; kill -9 "$p" 2>/dev/null; rm -f $f; }; done
  [[ -n "$PX" ]] && kill -9 "$PX" 2>/dev/null
  if [[ "$LOCKED" == 1 ]]; then
    if [[ -z "$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t 2>/dev/null)" ]]; then echo "8080 released before this command returned"; else echo "WARNING 8080 still bound"; fi
    rmdir "$LOCK" 2>/dev/null && echo "port8080.lock released"
  fi
}
trap cleanup EXIT INT TERM
BTW_RUN_ROOT="$RIG/run" bash "$RIG/boot.sh" "$BE" > "$SP/boot-$LABEL.log" 2>&1 || { echo "boot failed"; tail -20 "$SP/boot-$LABEL.log"; exit 1; }
source "$RIG/info.env"
until mkdir "$LOCK" 2>/dev/null; do echo "lock held; waiting 30s ($(date +%H:%M:%S))"; sleep 30; done
LOCKED=1; echo "port8080.lock taken"
if [[ -n "$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t 2>/dev/null)" ]]; then echo "8080 busy; abort"; exit 9; fi
node "$RIG/d2-proxy.mjs" "$BTW_BASE_URL" "$BTW_RECORD" "$RIG/mirror" > "$SP/proxy-$LABEL.log" 2>&1 &
PX=$!
for _ in $(seq 1 50); do curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1 && break; sleep 0.2; done
[[ "$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t | head -1)" == "$PX" ]] || { echo "8080 not ours"; exit 3; }
echo "rig up: proxy $PX -> $BTW_BASE_URL; stub $BTW_STUB_PORT; 1111 untouched"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$UI"
ISO=$(mktemp -d "$SP/iso.XXXX")
env -i HOME="$ISO" LOCAL_OPERATOR_CONFIG_DIR="$ISO/.local-operator" PATH="$PATH" TERM=xterm-256color \
  GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 LOCAL_OPERATOR_DESKTOP_TOKEN="$BTW_TOKEN" \
  node scripts/renderer-driver-ux2.mjs --scene "${SCENE:-btw-ux2}" --backend http://127.0.0.1:8080 \
    --backend-records "$RIG/mirror" --seed-onboarding-complete \
    --window-size "$SIZE" --run-label "$LABEL" --out "$OUT" --clean \
    > "$SP/drive-$LABEL.log" 2>&1 &
DRV=$!
wait $DRV; RC=$?; DRV=""
echo "driver exit $RC"
grep -c "^\[PASS\]" "$SP/drive-$LABEL.log"; grep "^\[FAIL\]" "$SP/drive-$LABEL.log" | head
cp "$RIG/run/requests.jsonl" "$SP/requests-$LABEL.jsonl" 2>/dev/null
grep -E "POST .*/asides" "$RIG/run/server.log" | tail -30 > "$SP/asides-$LABEL.log" 2>/dev/null
rm -rf "$ISO" "$RIG/mirror"
