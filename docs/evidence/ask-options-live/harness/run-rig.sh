#!/usr/bin/env bash
# Stand the ask-options-live rig up, drive one press, tear it down.
#
#   bash docs/evidence/ask-options-live/harness/run-rig.sh \
#     <out-dir> <expect|-> <answer-delay-ms> <order|-> <resolution> \
#     [extra serve-gate.py args...]
#
# <expect>     silent | settled | moved-on | unknown | not-sent | card-refusal | -
# <order>      cleared-first | delivered-first | -
# <resolution> cleared | refused
#
# WHY THIS IS COMMITTED. The frames below are re-derivable from the repository or
# they are not evidence: an earlier round found the set could not be re-taken from
# what was in the tree, and the command that produced it lived in a scratch
# directory. Everything this script runs is in the tree — the harness, the Vite
# config and the driver — and the only thing it adds is the wiring and the
# teardown.
#
# Everything is headless and isolated: the DOCUMENTED scratch root (so the path
# painted in the frames is the one the README names), its own 32-byte token, an
# OS-assigned backend port, and a fixed dev-server port because Vite's harness
# needs one. Nothing addresses the operator's own backend on :1111, and the
# operator's config root is never read or written. Every process started here is
# killed by exact pid on exit.
set -euo pipefail

if [ "$#" -lt 5 ]; then
  sed -n '2,12p' "$0"
  exit 2
fi

OUT="$1"
EXPECT="$2"
DELAY="$3"
ORDER="$4"
RESOLUTION="$5"
shift 5
EXTRA=("$@")

WT="$(git rev-parse --show-toplevel)"
PY="${RIG_PYTHON:-$HOME/local-operator/.venv/bin/python}"
SCRATCH="${RIG_SCRATCH_DIR:-/tmp/ask-gate-rig}"
PORT="${RIG_PORT:-5301}"
SESSION="${RIG_SESSION:-a1a1a1a1a1a1}"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/logs"
LOG="$SCRATCH/logs"
BACKEND_PID=""
VITE_PID=""

cleanup() {
  set +e
  if [ -n "$VITE_PID" ]; then
    pkill -TERM -P "$VITE_PID" 2>/dev/null
    kill -TERM "$VITE_PID" 2>/dev/null
  fi
  [ -n "$BACKEND_PID" ] && kill -TERM "$BACKEND_PID" 2>/dev/null
  sleep 2
  if [ -n "$VITE_PID" ]; then
    pkill -KILL -P "$VITE_PID" 2>/dev/null
    kill -KILL "$VITE_PID" 2>/dev/null
  fi
  [ -n "$BACKEND_PID" ] && kill -KILL "$BACKEND_PID" 2>/dev/null
}
trap cleanup EXIT

cd "$WT"

# The dev-server port is fixed and a previous run's server can hold it for a few
# seconds after its teardown: wait for it rather than racing it, which is how a
# chained sweep hung on its third run.
for _ in $(seq 1 90); do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 1
done

nohup "$PY" docs/evidence/ask-options-live/harness/serve-gate.py \
  --scratch "$SCRATCH" \
  --session-id "$SESSION" \
  --token-file "$SCRATCH/token" \
  --result-file "$SCRATCH/owner-answer.json" \
  --answer-delay-ms "$DELAY" \
  --answer-log-file "$SCRATCH/answer-log.json" \
  "${EXTRA[@]+"${EXTRA[@]}"}" >"$LOG/backend.log" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 120); do
  [ -s "$SCRATCH/port" ] && break
  sleep 0.5
done
[ -s "$SCRATCH/port" ] || { echo "backend never reported a port"; tail -30 "$LOG/backend.log"; exit 1; }
BPORT="$(cat "$SCRATCH/port")"
echo "backend on $BPORT (scratch $SCRATCH)"

ASK_GATE_PORT="$PORT" \
VITE_LOCAL_OPERATOR_API_URL="http://localhost:$PORT" \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL="http://127.0.0.1:$BPORT" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$SCRATCH/token")" \
  nohup node_modules/.bin/vite --config docs/evidence/ask-options-live/harness/ask-gate.vite.mjs \
  >"$LOG/vite.log" 2>&1 &
VITE_PID=$!

for _ in $(seq 1 120); do
  curl -sf "http://localhost:$PORT/" -o /dev/null && break
  sleep 0.5
done
curl -sf "http://localhost:$PORT/" -o /dev/null || { echo "dev server never answered"; tail -30 "$LOG/vite.log"; exit 1; }
echo "dev server on $PORT"

set +e
CLICK_PROOF_EXPECT="$EXPECT" \
CLICK_PROOF_EXPECT_ORDER="$ORDER" \
CLICK_PROOF_RESOLUTION="$RESOLUTION" \
CLICK_PROOF_RIG_DIR="$SCRATCH" \
  node scripts/click-proof.mjs "http://localhost:$PORT" "$OUT" "$SESSION"
DRIVER_RC=$?
set -e

echo "driver rc=$DRIVER_RC"
echo "--- owner-answer.json ---"
cat "$SCRATCH/owner-answer.json" 2>/dev/null || echo "(the owner recorded no answer)"
echo "--- rig-state ---"
curl -sf "http://localhost:$PORT/rig-state" || echo "(no rig-state - the run killed the backend)"
echo
echo "--- answer log ---"
cat "$SCRATCH/answer-log.json" 2>/dev/null || echo "(no answer log)"
echo
echo "--- backend log (tail) ---"
tail -5 "$LOG/backend.log"
echo "RIG_SCRATCH=$SCRATCH"
exit "$DRIVER_RC"
