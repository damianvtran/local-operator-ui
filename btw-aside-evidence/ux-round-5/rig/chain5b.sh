#!/usr/bin/env bash
# The three rig corrections round 5 needs, then the three passes they change.
#
#  1. fix-a4-ux5.sh      A4's check read the TRANSCRIPT's streaming flag while the aside
#                        is what streams: unpassable as written, so it is corrected and
#                        the ux5narrow pass is re-run to get a real reading.
#  2. probe-band-ux5.sh  adds a read-only DOM-structure probe to 6a, and btw-ux3 is re-run
#                        to see whether the band's second line at cf5a12f95 reproduces.
#  3. patch-driver-ux5b  PASS B's scene fixed: a second conversation on an EXISTING cwd,
#                        r3msgs (not the non-existent r4msgs), and the current conversation
#                        read from the sidebar's aria-current row, because the app is served
#                        from file:// and `location.pathname` is the built file's path.
set -u
RIG=/Users/damian/.local-operator/sessions/bde1c5028625/scratchpad/ux5rig
TREE=/Users/damian/local-operator-ui-worktrees/ux482-r5-7c31f9
cd "$RIG" || exit 1
export UX5_UI_TREE=$TREE
export UX5_BACKEND_TREE=/Users/damian/local-operator-worktrees/ux482-r5-7c31f9

bash ./fix-a4-ux5.sh "$TREE" || exit 1
bash ./probe-band-ux5.sh "$TREE" || exit 1
bash ./patch-driver-ux5b.sh "$TREE" || exit 1

run() { echo "### pass $2 ($1) at $(date -u +%H:%M:%S)"; bash ./run-ux5.sh "$1" "$2" "$3" 2>&1 | tail -6; }
run btw-ux5  ux5narrowfix 800x900
run btw-ux3  ux5r3wide2   1380x900
run btw-ux5b ux5fold2     800x900
echo "### corrections done at $(date -u +%H:%M:%S)"
