#!/bin/bash
# The launcher for the asks-on-rail frames (#896). Derived from
# `docs/evidence/right-slot-memory/harness/rig-up.sh`; what differs, and why:
#
#   * TWO owner processes, and that is the whole cast. The unit under test is the
#     ASKS DOOR - where it lives (header before #896, panel rail after) and what it
#     opens - so the rig needs exactly two conversations that are plainly different:
#     A with no ask engine at all (the door must be OFFERED nowhere on it), and B
#     with a live queued-ask engine, where the pending ask is raised mid-view
#     through the command channel. Every case drives one of those two, or a draft.
#   * TWO Vite servers over ONE backend, so ONE rig-up can serve either arm - but
#     DRIVE ONLY ONE ARM PER RIG-UP. The before arm is `origin/main`
#     (`SLOT_RIG_BEFORE_REPO`, a checkout of that commit), the after arm is this
#     checkout, and both read the SAME routes daemon and the SAME owners, which is
#     what makes the only difference between the two renderers the renderer tree.
#     An ask case ENQUEUES onto B's queue, so an arm driven second over the same
#     rig would photograph a queue the first arm already wrote (and the fleet
#     drawer lists every session's outstanding asks); `drive-asks.mjs` refuses
#     both arms in one invocation. This script wipes and restarts the whole rig on
#     every run, so the next arm starts from a clean one.
#   * THE PYTHON CHILDREN RUN UNDER A SCRATCH `HOME` WITH A FENCED `security`. The
#     operator's rule for a rig is an isolated HOME (the cache and the agent home
#     derive from it independently of LOCAL_OPERATOR_CONFIG_DIR), and a scratch
#     HOME has no login keychain, so any process that reaches Keychain Services
#     under it makes macOS offer to CREATE one - a dialog on the operator's screen.
#     Nothing here should reach it, and "should" is not measured, so `security` is
#     shadowed on the children's PATH by a stub that logs its argv and answers
#     "not found" (exit 44); `rig-down.sh` prints the log. An empty log is the
#     evidence that nothing tried.
#
# THE SCRATCH ROOT IS OUTSIDE THE REPOSITORY and is PRINTED: the owners write a
# config root and runtime records there, which must never land in the tree being
# photographed. Pass the printed path (or the same RIG_SCRATCH) to rig-down.sh to
# stop the rig by exact pid.
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
# The checkout this rig serves as the AFTER arm: derived from THIS script's location.
WT="${SLOT_RIG_REPO:-$(cd "$(dirname "$0")/../../../.." && pwd)}"
# The BEFORE arm's checkout. Optional: without it only the after Vite starts.
BEFORE="${SLOT_RIG_BEFORE_REPO:-}"
# The RUNTIME the owner processes assemble in-process: the installed `lop`
# generation's interpreter, PINNED to the generation directory at start so a
# `lop-update` that flips `current` mid-run cannot change the runtime half way
# through a matrix.
GEN="$(readlink "$HOME/.local/share/lop/current")"
PY="${SLOT_RIG_PY:-$HOME/.local/share/lop/current/tools/local-operator/bin/python}"
SCRATCH="${SLOT_RIG_SCRATCH:-$(mktemp -d "${LOCAL_OPERATOR_SCRATCHPAD:-${TMPDIR:-/tmp}}/asks-rig.XXXXXX")}"
LOG="$SCRATCH/logs"
AFTER_PORT="${SLOT_RIG_PORT:-5341}"
BEFORE_PORT="${SLOT_RIG_BEFORE_PORT:-5342}"
echo "scratch: $SCRATCH"
echo "runtime: $PY ($GEN)"

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

# The children's whole environment, named rather than inherited: a parent `lop`
# exports CMUX_* (renames the operator's real cmux workspaces) and LOP_* (picks a
# child runtime's provider and model), and an inherited XPC_FLAGS breaks DNS for
# children. `env -i` drops all of it; the names below are the ones the runtime
# needs to start.
start() {
  local name="$1"; shift
  nohup env -i \
    HOME="$SCRATCH/home" \
    TMPDIR="$SCRATCH/tmp" \
    PATH="$SCRATCH/shim:/usr/bin:/bin" \
    LANG="en_US.UTF-8" \
    PYTHONDONTWRITEBYTECODE=1 \
    "$PY" "$RIG/serve-asks.py" --scratch "$SCRATCH" "$@" \
    >"$LOG/$name.log" 2>&1 </dev/null &
  echo $! > "$SCRATCH/$name.pid"
  disown 2>/dev/null || true
}

start routes --mode routes
for _ in $(seq 1 240); do [ -s "$SCRATCH/routes-port" ] && break; sleep 0.5; done
[ -s "$SCRATCH/routes-port" ] || { echo "routes never started"; tail -20 "$LOG/routes.log"; exit 1; }

# A: no ask engine (the ordinary conversation). B: a live queued-ask engine, so the
# drawer can be opened by hand over a conversation that also remembers a panel.
start owner-aaaa11112222 --mode owner --session-id aaaa11112222 --title "Deploy checklist"
start owner-bbbb11112222 --mode owner --session-id bbbb11112222 --title "Review notes" --ask

OWNERS="aaaa11112222 bbbb11112222"
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

# One Vite per tree. `--strictPort` so a busy port FAILS rather than silently
# serving on another one and photographing a surface nobody drove.
serve_tree() {
  local tree="$1" port="$2" name="$3" config="$4"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port already held:"; lsof -nP -iTCP:"$port" -sTCP:LISTEN; exit 1
  fi
  # `cd` is its OWN statement: `cd x && VAR=1 cmd &` backgrounds the whole AND-list
  # as a subshell, so `$!` would name the subshell and not vite, and the listener
  # check below would (correctly) refuse a port answered by a pid that is not the
  # one recorded.
  ( cd "$tree" || exit 1
    SLOT_RIG_PORT="$port" \
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

# ONE VITE PER PASS is the normal case: a pass drives exactly one arm, and two dev
# servers (each holding this app's whole module graph) plus a daemon, two owners and a
# browser is what this machine's per-command memory ceiling kills (measured: the
# before pass died at 3.5 GB with both Vites up). `SLOT_RIG_NO_AFTER=1` starts only
# the before arm's server.
if [ "${SLOT_RIG_NO_AFTER:-}" = "1" ]; then
  echo "skipping the after Vite (SLOT_RIG_NO_AFTER=1)"
else
  serve_tree "$WT" "$AFTER_PORT" vite-after "$RIG/asks-rig.vite.mjs"
fi
if [ -z "$BEFORE" ] || [ "${SLOT_RIG_NO_BEFORE:-}" = "1" ]; then
  [ -n "$BEFORE" ] && echo "skipping the before Vite (SLOT_RIG_NO_BEFORE=1)"
elif [ -n "$BEFORE" ]; then
  # The Vite config derives its repository root from ITS OWN location, so the before
  # arm runs the same harness from inside the before checkout (copied in, untracked
  # there: a throwaway worktree of `origin/main`).
  mkdir -p "$BEFORE/docs/evidence/asks-on-rail"
  rm -rf "$BEFORE/docs/evidence/asks-on-rail/harness"
  cp -R "$RIG" "$BEFORE/docs/evidence/asks-on-rail/harness"
  serve_tree "$BEFORE" "$BEFORE_PORT" vite-before \
    "$BEFORE/docs/evidence/asks-on-rail/harness/asks-rig.vite.mjs"
fi

echo "routes port: $(cat "$SCRATCH/routes-port")"
echo "records:"; ls "$SCRATCH/config/run/mobile/" 2>/dev/null || echo "  none yet"
echo "pids:"; for f in "$SCRATCH"/*.pid; do echo "  $(basename "$f" .pid) $(cat "$f")"; done
echo "after:  http://localhost:$AFTER_PORT"
[ -n "$BEFORE" ] && echo "before: http://localhost:$BEFORE_PORT"
echo "SLOT_RIG_SCRATCH=$SCRATCH"
