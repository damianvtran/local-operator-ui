#!/usr/bin/env bash
# The IDENTITY half of the About-panel evidence: what the panel renders.
#
#   ABOUT_PANEL_VISIBLE_CAPTURE=1 timeout 120 bash identity.sh <tree> <label>
#
# Why this is the only rig here that shows anything. The About panel is AppKit's
# window, not a `BrowserWindow`, so nothing inside the app can photograph it and
# there is no way to render it off screen: the pixels only exist while the panel
# is ordered front. Everything else about this change is measured headless
# (`run.sh`); this rig exists for the one fact that needs the surface rendered,
# and it is deliberately awkward to run:
#
#   * opt-in - it refuses unless ABOUT_PANEL_VISIBLE_CAPTURE=1, so no sweep, no
#     suite and no later step can raise a panel by pointing at it;
#   * one instance - launch, invoke, capture and reap happen in this one
#     command, and the EXIT trap reaps on every path out, including a failure;
#   * `inactive`, never `normal`: the window is shown with `showInactive()`, so
#     the app is never activated and never takes the operator's focus. The
#     frontmost sampler at the end is the check on that, not the claim;
#   * window-only capture - `screencapture -l <id>` photographs one named window,
#     so the operator's screen is never in the file.
#
# It runs against a tree WITH or WITHOUT the gate, because the pair is the
# evidence: the base tree's panel reads Electron's own bundle identity, and the
# fixed tree's reads the app's. Use a label that says which one this is.
set -euo pipefail

TREE_ARG="${1:?tree}"
LABEL="${2:?label}"

if [ "${ABOUT_PANEL_VISIBLE_CAPTURE:-0}" != "1" ]; then
	echo "refusing: this rig puts the About panel on the operator's screen. Set ABOUT_PANEL_VISIBLE_CAPTURE=1 for the one capture per tree." >&2
	exit 1
fi

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HARNESS/lib.sh"

about_init "$TREE_ARG" "$LABEL" "inactive" "800x600"

trap 'about_stop_sampler; about_reap || echo "FAIL: this run left processes behind (see the count above)" >&2' EXIT

about_launch
about_start_sampler

about_wait_for_window
about_census --onscreen-only >"$SCRATCH/windows-before.json"
BEFORE_IDS="$(about_window_ids)"
echo "== windows owned by this app BEFORE the action:"
if [ -n "$BEFORE_IDS" ]; then sed 's/^/   /' "$SCRATCH/windows-before.json"; else echo "   (none)"; fi

node "$HARNESS/drive.mjs" "$INSPECT_PORT" "$SCRATCH" "inactive" "$APP_PID" panel | tee "$SCRATCH/drive.out"

sleep 3
about_stop_sampler

about_census --onscreen-only >"$SCRATCH/windows-after.json"
AFTER_IDS="$(about_window_ids)"
NEW_IDS="$(comm -13 <(echo "$BEFORE_IDS") <(echo "$AFTER_IDS") | tr '\n' ' ')"
echo "== windows owned by this app AFTER the action:"
if [ -n "$AFTER_IDS" ]; then sed 's/^/   /' "$SCRATCH/windows-after.json"; else echo "   (none)"; fi

if [ -z "$NEW_IDS" ]; then
	echo "FAIL: the action created no window, so there is no panel to photograph - the app was probably not ready yet (see $SCRATCH/electron.log)" >&2
	exit 1
fi

INDEX=0
for id in $NEW_IDS; do
	INDEX=$((INDEX + 1))
	# The first surface the action created is the one under test and gets the
	# stable name the evidence set is cited by.
	NAME="$LABEL"
	[ "$INDEX" -gt 1 ] && NAME="$LABEL-$INDEX"
	WINDOW="$SCRATCH/frames/$NAME.png"
	screencapture -x -o -l "$id" "$WINDOW"
	echo "== captured the window this action created (id $id) to $WINDOW"
done

about_frontmost_summary
echo "== the app's own lines about the launch and this action:"
about_app_lines
