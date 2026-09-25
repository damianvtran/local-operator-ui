#!/usr/bin/env bash
# Re-run round 3's scene (6a's reproducibility) and PASS B, with the probe helper RESTORED.
#
# The order matters and cost a pass: `patch-driver-ux5b.sh` replaces PASS B by truncating the
# driver at PASS B's banner, and the probe helper was appended AFTER that banner, so applying
# the probe first meant the replace deleted it and 6a threw `ux5bBandShape is not defined`.
# The replace goes first here, then the helper is appended.
set -u
RIG=/Users/damian/.local-operator/sessions/bde1c5028625/scratchpad/ux5rig
TREE=/Users/damian/local-operator-ui-worktrees/ux482-r5-7c31f9
cd "$RIG" || exit 1
export UX5_UI_TREE=$TREE
export UX5_BACKEND_TREE=/Users/damian/local-operator-worktrees/ux482-r5-7c31f9

bash ./patch-driver-ux5b.sh "$TREE" || exit 1
bash ./probe-band-ux5.sh "$TREE" || exit 1
grep -c "function ux5bBandShape" "$TREE/scripts/renderer-driver-ux5.mjs"

run() { echo "### pass $2 ($1) at $(date -u +%H:%M:%S)"; bash ./run-ux5.sh "$1" "$2" "$3" 2>&1 | tail -6; }
run btw-ux3  ux5r3wide3 1380x900
run btw-ux5b ux5fold3   800x900
echo "### chain5c done at $(date -u +%H:%M:%S)"
