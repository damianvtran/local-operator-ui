#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")" || exit 1
run() { echo "##### PASS $1 $2 $(date +%H:%M:%S)"; D5_CASES="$3" ./run-d5.sh "$1" "$2" "$4"; echo "##### DONE $2 $(date +%H:%M:%S)"; }
run btw-d5 narrow-d5-staged2 "staged" 800x900
run btw-d5 wide-d5-staged2 "staged" 1380x900
echo "##### CHAIN 5C COMPLETE $(date +%H:%M:%S)"
