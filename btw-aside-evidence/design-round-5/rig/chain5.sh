#!/usr/bin/env bash
# Design round 5's passes, one at a time, in priority order. Each line is one
# `capture-d5.sh` run: scene, pass label, window size, cases, theme.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
chain() { echo "##### PASS $1 $2 $(date +%H:%M:%S)"; D5_CASES="$3" D5_THEME="$4" ./run-d5.sh "$1" "$2" "$5"; echo "##### DONE $2 $(date +%H:%M:%S)"; }

chain btw-d5 narrow-d5 "cap,gutter,d10" "" 800x900
chain btw-d5 wide-d5 "cap,gutter,d10" "" 1380x900
chain btw-d5 wide-d5-light "cap,gutter" localOperatorLight 1380x900
chain btw-d4 narrow-d4r5 "para,quotes,wrap,followup" "" 800x900
chain btw-d4 wide-d4r5 "para,quotes,wrap,followup" "" 1380x900
chain btw-r3design narrow-r3d5 "" "" 800x900
chain btw-r4 wide-qad5 "" "" 1380x900
echo "##### CHAIN 5 COMPLETE $(date +%H:%M:%S)"
