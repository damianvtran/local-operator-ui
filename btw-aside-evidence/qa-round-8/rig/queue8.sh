#!/usr/bin/env bash
# QA round 8 (PR #482) pass queue: every pass in one serial run, each one taking and
# releasing the shared 8080 lock inside capture-r8.sh.
set -uo pipefail
cd "$(dirname "$0")"
S=$PWD
echo "QUEUE START $(date -u +%H:%M:%S)"

run() {  # run <scene> <pass> [window] [old-daemon] [extra env as NAME=VAL ...]
  local scene="$1" pass="$2" win="${3:-800x900}" old="${4:-0}"; shift 4 || shift $#
  echo "=== QUEUE $pass ($scene $win old=$old) $(date -u +%H:%M:%S)"
  env "$@" bash run8.sh "$scene" "$pass" "$win" "$old"
  echo "=== QUEUE $pass done $(date -u +%H:%M:%S) free=$(df -g /System/Volumes/Data | tail -1 | awk '{print $4}')Gi"
}

run btw-r5-clip   r8clipnarrow   800x900
run btw-r5-clip   r8clipwide    1380x900
run btw-r6        r8narrow        800x900
run btw-r6        r8wide         1380x900
run btw-r5-adopt  r8adoptnarrow   800x900
run r3-479        r8479           800x900 0 QA_ASIDE_FIRST=1 QA_SEED_TURNS=2
run r3-479        r8479b          800x900 0 QA_ASIDE_FIRST=1 QA_SEED_TURNS=2
run btw-r2-compat r8compat        800x900 1
run btw-r8-band   r8band1600     1600x900
run btw-r8-band   r8band800       800x900
run btw-r8-band   r8band1380     1380x900
run btw-r8-band   r8band1440     1440x900

echo "QUEUE END $(date -u +%H:%M:%S)"
