#!/usr/bin/env bash
# The BEHAVIOUR half of the About-panel evidence, and it is headless-only.
#
#   bash run.sh <tree> <label>
#
# The claim: in `headless` the app's About action does nothing - it logs a line
# and raises no panel. That is the half that matters most, because the panel this
# change removes is a window on the OPERATOR's screen: an agent run must not be
# able to produce one at all.
#
# Why this rig never launches another mode. The base tree has no gate, so driving
# it from here would raise a real panel on the operator's desktop, which is the
# noise this whole change exists to remove - so the rig refuses to start unless
# the tree it is pointed at carries the gate (checked in src/main/index.ts, where
# the About item's handler lives). Nothing this rig does is visible: the mode is hardcoded, the window is never shown, and no capture is attempted.
#
# What it measures, and how:
#   * the app's own resolved mode, from its `[window-mode]` line;
#   * the suppression line the action writes, which is the app saying what it did
#     rather than the rig inferring it from an absence;
#   * the window server's census for the run's pid, before and after, on screen
#     only - a panel that appeared would be a new window id there;
#   * which application is frontmost, by pid, while the action runs.
set -euo pipefail

TREE_ARG="${1:?tree}"
LABEL="${2:?label}"

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HARNESS/lib.sh"

USER_ARG="$TREE_ARG"
about_init "$USER_ARG" "$LABEL" "headless" "1380x900"

# Refuse to drive a tree without the gate: see the header. The marker is the
# decision function the menu handler calls, so a tree that renamed the helper and
# kept the behaviour still passes this check on its own source.
if ! grep -q "resolveAboutPanelAction" "$TREE/src/main/index.ts"; then
	echo "FAIL: $TREE has no About gate in src/main/index.ts - driving it would raise a real panel on the operator's desktop. This rig only measures trees that suppress it." >&2
	exit 1
fi

trap 'about_stop_sampler; about_reap || echo "FAIL: this run left processes behind (see the count above)" >&2' EXIT

about_launch
about_start_sampler

about_wait_for_window
about_census >"$SCRATCH/windows-before.json"
BEFORE_IDS="$(about_window_ids)"
echo "== windows owned by this app BEFORE the action (the window server's own list; its onscreen flag is its answer per window):"
if [ -n "$BEFORE_IDS" ]; then sed 's/^/   /' "$SCRATCH/windows-before.json"; else echo "   (none)"; fi

node "$HARNESS/drive.mjs" "$INSPECT_PORT" "$SCRATCH" "headless" "$APP_PID" action | tee "$SCRATCH/drive.out"

# The panel is ordered front asynchronously, so the census is read after the
# action has had time to produce one - an immediate read would miss it and read
# as "suppressed" whatever the app did.
sleep 3
about_stop_sampler

about_census >"$SCRATCH/windows-after.json"
AFTER_IDS="$(about_window_ids)"
NEW_IDS="$(comm -13 <(echo "$BEFORE_IDS") <(echo "$AFTER_IDS") | tr '\n' ' ')"

echo "== windows owned by this app AFTER the action:"
if [ -n "$AFTER_IDS" ]; then sed 's/^/   /' "$SCRATCH/windows-after.json"; else echo "   (none)"; fi
# The window server's on-screen set for this pid, reported separately: it is empty
# for a background app while the display is asleep, so it is evidence about the
# screen rather than the thing the difference above is computed from.
ONSCREEN="$(about_onscreen_ids | tr '\n' ' ')"
echo "== the window server's ON-SCREEN set for this pid: ${ONSCREEN:-(none)}"

FAILED=0
if [ -n "$NEW_IDS" ]; then
	echo "FAIL: the action created window(s) $NEW_IDS in headless mode - a panel reached the operator's screen" >&2
	FAILED=1
else
	echo "== the action created no window: nothing reached the screen"
fi

if grep -q "\[about-panel\]" "$SCRATCH/electron.log"; then
	echo "== the app's own line about the action:"
	grep -h "\[about-panel\]" "$SCRATCH/electron.log" | sed 's/^/   /'
else
	echo "FAIL: the app wrote no [about-panel] line, so 'it did nothing' is indistinguishable from 'it never ran'" >&2
	FAILED=1
fi

about_frontmost_summary
echo "== the app's lines about the launch:"
about_app_lines

[ "$FAILED" = "0" ] || exit 1
