#!/bin/bash
# The launcher for the asks-open-by-default frames. Derived from the ask-drawer-stuck
# set's `rig-up.sh`; what differs, and why:
#
#   * SEVEN owner processes, one per queue shape the open policy has to tell apart
#     (see serve-open.py): pending, live-but-empty, settled, a second pending one (the
#     dismissal path mutates its queue, so it cannot share the first), a runtime with
#     no queued-ask engine at all, and two more that the dismissal-record cases (s15, s16)
#     write to so that no other case's frame can read what they leave behind.
#   * TWO Vite servers over ONE backend, so ONE rig-up can serve either arm - but DRIVE
#     ONLY ONE ARM PER RIG-UP. The before arm is the base the branch sits on
#     (`RIG_BEFORE_REPO`, a checkout of that commit), the after arm is this checkout, and
#     both read the SAME routes daemon and the SAME owners, which is what makes the only
#     difference between the two renderers the renderer tree - PROVIDED NEITHER ARM HAS
#     WRITTEN TO THE BACKEND BEFORE THE OTHER IS PHOTOGRAPHED. The before arm's `s5` sends
#     a chat message into conversation A, so an after arm driven second over the same
#     rig photographs A with that exchange already in it (`drive-open.mjs` refuses both
#     arms in one invocation for this reason). This script wipes and restarts the whole
#     rig on every run, so the next arm starts from a clean one.
#   * THE PYTHON CHILDREN RUN UNDER A SCRATCH `HOME` WITH A FENCED `security`. The
#     operator's rule for a rig is an isolated HOME (the cache and the agent home derive
#     from it independently of LOCAL_OPERATOR_CONFIG_DIR), and a scratch HOME has no login
#     keychain, so any process that reaches Keychain Services under it makes macOS offer
#     to CREATE one - a dialog on the operator's screen. Nothing here should reach it, and
#     "should" is not measured, so `security` is shadowed on the children's PATH by a stub
#     that logs its argv and answers "not found" (exit 44); `rig-down.sh` prints the log.
#     An empty log is the evidence that nothing tried.
#
# THE SCRATCH ROOT IS OUTSIDE THE REPOSITORY and is PRINTED: the owners write a config
# root and runtime records there, which must never land in the tree being photographed.
# Pass the printed path (or the same RIG_SCRATCH) to rig-down.sh to stop the rig by exact pid.
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
# The checkout this rig serves as the AFTER arm: derived from THIS script's location.
WT="${RIG_REPO:-$(cd "$(dirname "$0")/../../../.." && pwd)}"
# The BEFORE arm's checkout. Optional: without it only the after Vite starts.
BEFORE="${RIG_BEFORE_REPO:-}"
# The RUNTIME the owner processes assemble in-process: the installed `lop` generation's
# interpreter, PINNED to the generation directory at start so a `lop-update` that flips
# `current` mid-run cannot change the runtime half way through a matrix.
GEN="$(readlink "$HOME/.local/share/lop/current")"
PY="${RIG_PY:-$GEN/tools/local-operator/bin/python}"
SCRATCH="${RIG_SCRATCH:-$(mktemp -d "${LOCAL_OPERATOR_SCRATCHPAD:-${TMPDIR:-/tmp}}/ask-open-rig.XXXXXX")}"
LOG="$SCRATCH/logs"
AFTER_PORT="${ASKS_RIG_PORT:-5391}"
BEFORE_PORT="${ASKS_RIG_BEFORE_PORT:-5392}"
echo "scratch: $SCRATCH"
echo "runtime: $PY"

# Kill any previous instance (pid files only, exact pids; never by name).
for f in "$SCRATCH"/*.pid; do
  [ -f "$f" ] && kill -TERM "$(cat "$f")" 2>/dev/null || true
done
sleep 1
rm -rf "$SCRATCH"
mkdir -p "$LOG" "$SCRATCH/home" "$SCRATCH/tmp" "$SCRATCH/shim"

# The fenced `security`: log the call, answer "item not found", never reach the keychain.
cat > "$SCRATCH/shim/security" <<EOF
#!/bin/sh
echo "\$(date +%s) security \$*" >> "$SCRATCH/security-calls.log"
exit 44
EOF
chmod +x "$SCRATCH/shim/security"
: > "$SCRATCH/security-calls.log"

# The children's whole environment, named rather than inherited: a parent `lop` exports
# CMUX_* (renames the operator's real cmux workspaces) and LOP_* (picks a child runtime's
# provider and model), and an inherited XPC_FLAGS breaks DNS for children. `env -i` drops
# all of it; the names below are the ones the runtime needs to start.
start() {
  local name="$1"; shift
  nohup env -i \
    HOME="$SCRATCH/home" \
    TMPDIR="$SCRATCH/tmp" \
    PATH="$SCRATCH/shim:/usr/bin:/bin" \
    LANG="en_US.UTF-8" \
    PYTHONDONTWRITEBYTECODE=1 \
    "$PY" "$RIG/serve-open.py" --scratch "$SCRATCH" "$@" \
    >"$LOG/$name.log" 2>&1 </dev/null &
  echo $! > "$SCRATCH/$name.pid"
  disown 2>/dev/null || true
}

start routes --mode routes
for _ in $(seq 1 240); do [ -s "$SCRATCH/routes-port" ] && break; sleep 0.5; done
[ -s "$SCRATCH/routes-port" ] || { echo "routes never started"; tail -20 "$LOG/routes.log"; exit 1; }

start owner-aaaa11112222 --mode owner --session-id aaaa11112222 --title "Deploy checklist" --seed pending
start owner-bbbb11112222 --mode owner --session-id bbbb11112222 --title "Notes" --seed empty
start owner-cccc11112222 --mode owner --session-id cccc11112222 --title "Invoice export" --seed settled
start owner-dddd11112222 --mode owner --session-id dddd11112222 --title "Release notes" --seed pending
start owner-eeee11112222 --mode owner --session-id eeee11112222 --title "Legacy runtime" --seed none
# The two the dismissal-record cases write to, so that nothing else's frame can read what
# they leave behind: F is a second pending conversation (s15 answers and queues asks on it),
# G starts live-but-empty and is filled past the wire's text budget (s16).
start owner-ffff11112222 --mode owner --session-id ffff11112222 --title "Staging rollout" --seed pending
start owner-abcd11112222 --mode owner --session-id abcd11112222 --title "Backlog triage" --seed empty

OWNERS="aaaa11112222 bbbb11112222 cccc11112222 dddd11112222 eeee11112222 ffff11112222 abcd11112222"
for _ in $(seq 1 240); do
  ready=1
  for id in $OWNERS; do
    [ -s "$SCRATCH/owner-$id-ready" ] || ready=0
  done
  [ "$ready" = 1 ] && break
  sleep 0.5
done
for id in $OWNERS; do
  [ -s "$SCRATCH/owner-$id-ready" ] || { echo "owner $id never became ready"; tail -20 "$LOG/owner-$id.log"; exit 1; }
done

# One Vite per tree. `--strictPort` so a busy port FAILS rather than silently serving on
# another one and photographing a surface nobody drove.
serve_tree() {
  local tree="$1" port="$2" name="$3" config="$4"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port already held:"; lsof -nP -iTCP:"$port" -sTCP:LISTEN; exit 1
  fi
  # `cd` is its OWN statement: `cd x && VAR=1 cmd &` backgrounds the whole AND-list as a
  # subshell, so `$!` would name the subshell and not vite, and the listener check below
  # would (correctly) refuse a port answered by a pid that is not the one recorded.
  ( cd "$tree" || exit 1
    ASKS_RIG_PORT="$port" \
    VITE_LOCAL_OPERATOR_API_URL="http://localhost:$port" \
    LOCAL_OPERATOR_DESKTOP_BACKEND_URL="http://127.0.0.1:$(cat "$SCRATCH/routes-port")" \
    LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$SCRATCH/token")" \
      nohup node_modules/.bin/vite --strictPort --config "$config" \
      >"$LOG/$name.log" 2>&1 </dev/null &
    echo $! > "$SCRATCH/$name.pid" )
  local pid; pid="$(cat "$SCRATCH/$name.pid")"
  for _ in $(seq 1 240); do curl -sf "http://localhost:$port/" -o /dev/null && break; sleep 0.5; done
  curl -sf "http://localhost:$port/" -o /dev/null || { echo "$name never answered"; tail -20 "$LOG/$name.log"; exit 1; }
  local listener; listener="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | head -1)"
  if [ "$listener" != "$pid" ]; then
    echo "port $port answered by pid ${listener:-none}, not our $name ($pid)"; exit 1
  fi
}

serve_tree "$WT" "$AFTER_PORT" vite-after "$RIG/asks-rig.vite.mjs"
if [ -n "$BEFORE" ]; then
  # The Vite config derives its repository root from ITS OWN location, so the before arm
  # runs the same harness from inside the before checkout (copied in, untracked there).
  mkdir -p "$BEFORE/docs/evidence/ask-open-default"
  rm -rf "$BEFORE/docs/evidence/ask-open-default/harness"
  cp -R "$RIG" "$BEFORE/docs/evidence/ask-open-default/harness"
  serve_tree "$BEFORE" "$BEFORE_PORT" vite-before \
    "$BEFORE/docs/evidence/ask-open-default/harness/asks-rig.vite.mjs"
fi

echo "routes port: $(cat "$SCRATCH/routes-port")"
echo "records:"; ls "$SCRATCH/config/run/mobile/" 2>/dev/null || echo "  none yet"
echo "pids:"; for f in "$SCRATCH"/*.pid; do echo "  $(basename "$f" .pid) $(cat "$f")"; done
echo "after:  http://localhost:$AFTER_PORT"
[ -n "$BEFORE" ] && echo "before: http://localhost:$BEFORE_PORT"
echo "RIG_SCRATCH=$SCRATCH"
