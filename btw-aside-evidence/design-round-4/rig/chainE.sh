#!/usr/bin/env bash
# The remaining passes for design round 4, one at a time, in priority order.
set -uo pipefail
cd "$(dirname "$0")"
chain() { echo "##### PASS $1 $2 $(date +%H:%M:%S)"; D4_CASES="$3" D4_THEME="$4" D4_BLOCK_MARKERS="$6" ./run-d4.sh "$1" "$2" "$5"; echo "##### DONE $2 $(date +%H:%M:%S)"; }
MARKERS="LISTEDGE2:l2,LISTEDGE3:l3,LISTEDGE6:l6,HEADEDGE2:h2,HEADEDGE4:h4,HEADEDGE5:h5,CODEEDGE2:c2,CODEEDGE4:c4,CODEEDGE5:c5"
chain btw-d4 wide-d4b "wrap,blocks,followup,jump" "" 1380x900 "$MARKERS"
chain btw-d4 narrow-d4b "wrap,blocks,followup,jump" "" 800x900 "$MARKERS"
chain btw-r3design narrow-r3design "" "" 800x900 ""
chain btw-d4 wide-d4-light "para,quotes" localOperatorLight 1380x900 ""
echo "##### CHAIN E COMPLETE $(date +%H:%M:%S)"
