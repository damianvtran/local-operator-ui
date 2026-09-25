#!/usr/bin/env bash
# The remaining passes of UX round 4, one after another (the shared 8080 lock is
# taken and released inside each capture, so these cannot overlap by construction).
set -u
RIG=/Users/damian/.local-operator/sessions/15622aeab8ed/scratchpad/ux4rig
cd "$RIG" || exit 1
export UX4_UI_TREE=/Users/damian/local-operator-ui-worktrees/ux482-r4-d41bf2
export UX4_BACKEND_TREE=/Users/damian/local-operator-worktrees/ux482-r4-d41bf2
run() { echo "### pass $2 ($1) at $(date -u +%H:%M:%S)"; bash ./run-ux4.sh "$1" "$2" "$3" 2>&1 | tail -8; }
run btw-ux4  ux4wide   1380x900
run btw-ux4b ux4narrow 800x900
run btw-ux4c ux4c      1380x900
run btw-ux3  ux3wide   1380x900
run btw-ux3b ux3narrow 800x900
run btw-ux3c ux3c      1380x900
run btw-ux3d ux3d      1380x900
echo "### all passes done at $(date -u +%H:%M:%S)"
