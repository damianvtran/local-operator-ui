#!/usr/bin/env bash
# One scenario: Xvfb (group leader) + rig, reaped by exact pid before return.
# usage: run.sh <mode> <name> [size] ; env ASKCMD_REMOTE/ASKCMD_TARGET/ASKCMD_COMMAND/R1_THEME/R1_N pass through
set -u
S=$LOCAL_OPERATOR_SCRATCHPAD/r1
MODE=$1; NAME=$2; SIZE=${3:-1380x900}
OUT=$S/out/$NAME; rm -rf "$OUT"; mkdir -p "$OUT"
DISP=:$((180 + RANDOM % 15))
set -m
Xvfb $DISP -screen 0 1600x1100x24 -nolisten tcp >"$OUT/xvfb.log" 2>&1 &
XPID=$!
sleep 1
cd "$S/app"
env -u XPC_FLAGS $(env | cut -d= -f1 | grep -E '^(CMUX_|LOP_)' | sed 's/^/-u /') \
  DISPLAY=$DISP R1_OUT="$OUT" R1_MODE="$MODE" R1_SIZE="$SIZE" R1_RIG="$S/rig" R1_PORT=$((18900 + RANDOM % 90)) SHELL=/bin/bash \
  ASKCMD_COMMAND="${ASKCMD_COMMAND:-echo ASKCMD-\$((40+2)) | tee -a qa-side.log}" ASKCMD_TARGET="${ASKCMD_TARGET:-agent}" ASKCMD_REMOTE="${ASKCMD_REMOTE:-0}" ASKCMD_LANG="${ASKCMD_LANG:-}" \
  timeout 600 node "$S/rig/r1-rig.mjs" >"$OUT/rig.out" 2>&1 &
RPID=$!
wait $RPID; RC=$?
APID=$(cat "$OUT/app.pid" 2>/dev/null || echo)
if [ -n "$APID" ] && kill -0 "$APID" 2>/dev/null; then kill -- -"$APID" 2>/dev/null || kill "$APID"; sleep 1; fi
[ -n "$APID" ] && { kill -0 "$APID" 2>/dev/null && echo "APP ALIVE $APID" || echo "app $APID reaped"; }
kill -0 $RPID 2>/dev/null && kill -- -$RPID
kill -- -$XPID 2>/dev/null; sleep 0.5
kill -0 $XPID 2>/dev/null && echo "XVFB ALIVE $XPID" || echo "xvfb $XPID reaped"
echo "$NAME rc=$RC"
grep -h '^CHECK\|^error\|^latency\|^sample\|^fleet sample' "$OUT/rig.out" | cut -c1-600
