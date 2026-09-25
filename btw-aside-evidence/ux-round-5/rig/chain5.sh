#!/usr/bin/env bash
# UX round 5's passes at cf5a12f95, one after another. Each capture takes and
# releases the private-port lock itself, so these cannot overlap by construction;
# the order is importance-first in case this chain is cut (the host's network
# outage killed the previous attempt at this round).
set -u
RIG=/Users/damian/.local-operator/sessions/bde1c5028625/scratchpad/ux5rig
cd "$RIG" || exit 1
export UX5_UI_TREE=/Users/damian/local-operator-ui-worktrees/ux482-r5-7c31f9
export UX5_BACKEND_TREE=/Users/damian/local-operator-worktrees/ux482-r5-7c31f9
run() { echo "### pass $2 ($1) at $(date -u +%H:%M:%S)"; bash ./run-ux5.sh "$1" "$2" "$3" 2>&1 | tail -8; }
run btw-ux5  ux5narrow   800x900
run btw-ux4  ux5wide     1380x900
run btw-ux4b ux5narrow2  800x900
run btw-ux3  ux5r3wide   1380x900
run btw-ux5b ux5fold     800x900
run btw-ux4c ux5diag     1380x900
run btw-ux4d ux5settle   800x900
run btw-ux3b ux5r3narrow 800x900
run btw-ux3d ux5r3diag   1380x900
echo "### all passes done at $(date -u +%H:%M:%S)"
