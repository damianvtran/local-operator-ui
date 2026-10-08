#!/bin/bash
# The four passes this set is captured in: one rig lifetime per (arm, palette).
#
# WHY FOUR STAND-UPS AND NOT ONE. Two of the cases WRITE to the rig's backend - the
# draft-admission case is admitted as a new conversation and the borrow case raises a
# pending ask - so a second palette driven over the same backend would photograph a
# sidebar with one more conversation in it, or a queue with one more ask, and the two
# stills for one case would then differ by something that is not the theme. The same
# argument `drive-slot.mjs`'s header makes for the two arms, one axis over.
# `rig-up.sh` wipes and restarts the whole rig, so every pass starts clean.
#
# ONE SELF-CONTAINED COMMAND, AND NOTHING RESIDENT WHEN IT RETURNS. The whole pass -
# the daemon, the owners, the one Vite, the Chrome, the drive and the probe - happens
# inside this invocation, and an EXIT trap reaps every pid it started and removes its
# own scratch root, so a pass that fails, is interrupted or is killed leaves no
# server and no profile behind (the fleet's disk lane asked for exactly this on
# 2026-10-08, at the abort floor). Nothing here is started `nohup`-style in the
# background for a later step to use.
#
# WHY ONE PASS PER INVOCATION RATHER THAN A LOOP OVER ALL FOUR. Each stand-up is a
# routes daemon, two owner processes and two Vite dev servers, and a browser on top:
# looping the four in one shell holds that whole set inside ONE process group, which
# this machine's per-command memory ceiling then kills mid-pass (measured: the
# four-pass loop was killed at 3.3 GB during its first drive, having written no
# frames). So the script runs ONE pass, named by its arguments, and the README's
# four commands are four invocations - each of which tears its rig down before it
# returns.
#
# Usage:
#   bash run-passes.sh <frames-dir> <records-dir> after|before localOperatorDark
#   bash run-passes.sh <frames-dir> <records-dir> before localOperatorLight
#   ...
#
# `SLOT_RIG_BEFORE_REPO` must name a checkout of `origin/main` for the `before`
# passes (the `after` passes do not need it: with it unset, `rig-up.sh` starts only
# the after Vite).
set -eu
RIG="$(cd "$(dirname "$0")" && pwd)"
FRAMES="${1:?frames output dir}"
RECORDS="${2:?records output dir}"
ARM="${3:?arm: after or before}"
PALETTE="${4:?palette, e.g. localOperatorDark}"
AFTER_PORT="${SLOT_RIG_PORT:-5321}"
BEFORE_PORT="${SLOT_RIG_BEFORE_PORT:-5322}"

case "$ARM" in
  after) URL="http://localhost:$AFTER_PORT" ;;
  before) URL="http://localhost:$BEFORE_PORT" ;;
  *) echo "arm must be after or before" >&2; exit 2 ;;
esac

mkdir -p "$FRAMES" "$RECORDS"
# Wipe only this pass's own frames, so the four passes accumulate in one directory
# without a stale still surviving a rename.
rm -f "$FRAMES"/*/"$ARM"/"$PALETTE".webp

SCRATCH="$(mktemp -d "${LOCAL_OPERATOR_SCRATCHPAD:-${TMPDIR:-/tmp}}/slot-pass.XXXXXX")"
echo "pass: $ARM / $PALETTE -> $URL   (scratch $SCRATCH)"

reaped=0
cleanup() {
  [ "$reaped" = "1" ] && return 0
  reaped=1
  SLOT_RIG_SCRATCH="$SCRATCH" bash "$RIG/rig-down.sh" \
    >>"$RECORDS/rig-down-$ARM-$PALETTE.log" 2>&1 || true
  cp "$SCRATCH/security-calls.log" "$RECORDS/security-calls-$ARM-$PALETTE.log" 2>/dev/null || true
  rm -rf "$SCRATCH"
}
trap cleanup EXIT INT TERM

# Only the arm this pass drives gets a dev server (see `rig-up.sh`'s note on the
# memory ceiling): the other arm's Vite would hold this app's whole module graph for
# nothing.
NO_AFTER=""; [ "$ARM" = "before" ] && NO_AFTER=1
NO_BEFORE=""; [ "$ARM" = "after" ] && NO_BEFORE=1
SLOT_RIG_SCRATCH="$SCRATCH" \
SLOT_RIG_NO_AFTER="$NO_AFTER" SLOT_RIG_NO_BEFORE="$NO_BEFORE" \
SLOT_RIG_PORT="$AFTER_PORT" SLOT_RIG_BEFORE_PORT="$BEFORE_PORT" \
  bash "$RIG/rig-up.sh" >"$RECORDS/rig-up-$ARM-$PALETTE.log" 2>&1

node "$RIG/drive-slot.mjs" "--$ARM" "$URL" --scratch "$SCRATCH" \
  --out "$FRAMES" --theme "$PALETTE" \
  >"$RECORDS/drive-$ARM-$PALETTE.log" 2>&1

node "$RIG/probe-hop.mjs" "--$ARM" "$URL" --scratch "$SCRATCH" \
  --theme "$PALETTE" --out "$RECORDS/probe-hop-$ARM-$PALETTE.json" \
  >"$RECORDS/probe-hop-$ARM-$PALETTE.log" 2>&1

echo "pass done: $ARM / $PALETTE"
