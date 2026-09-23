#!/usr/bin/env bash
#
# Refuse a disk-image notarisation that SKIPPED instead of running, given the
# report it printed.
#
# WHY THIS EXISTS. `scripts/notarize-artifacts.mjs` treats a missing `NOTARIZE`
# flag, a missing `APPLE_*` credential and an empty `dist` alike as "nothing to
# do": each logs one line and exits 0. `scripts/require-report.sh` refuses a
# SILENT success, not a SKIPPED one - its check is emptiness, and a skip prints a
# line - so a step wrapped in it reads a skip as a pass. What refuses the
# unnotarised image is then the artifact verification one step LATER, and by then
# a whole two-pass macOS build has been spent: audit run 35846109424 printed
# `Skipping disk image notarization: NOTARIZE not set to true`, and the same run
# went on to answer `FAIL dmg-spctl` and `FAIL dmg-stapler` for both images, `4 of
# 101 artifact checks failed`, while every app-level check passed. This makes that
# failure land at the step that failed to do its job.
#
# WHY A FILE AND NOT A PIPE. The report has to be readable AFTER the wrapper has
# decided its own exit status, and the calling steps already `tee` it so a slow
# notarisation still streams. Keeping the two questions apart - "did the gate run
# at all?" (`require-report.sh`) and "did it notarise anything?" (this) - is what
# lets each failure name itself.
#
# Usage: require-notarized-dmg.sh <report-file>
#
# Exits 1 when the report shows a skip (or a short-circuit), when it shows no
# staple at all, or when it is missing or empty. Exits 2 when the helper itself
# was called wrong, which is a defect in the caller.
set -uo pipefail

if [ "$#" -ne 1 ]; then
	echo "::error title=require-notarized-dmg.sh misused::expected the path of the notarisation report to read, got $# argument(s). This is a defect in the calling step, not in the notarisation."
	exit 2
fi

report="$1"
if [ ! -s "$report" ]; then
	echo "::error title=No notarisation report::${report} is missing or empty, so nothing here can tell a skip from a run. Check the NOTARIZE/APPLE_* bindings on the calling step."
	exit 1
fi

# The three short-circuits the script can take, each a single line and exit 0: the
# flag, the credentials, and a `dist` with no image in it.
if skipped="$(grep -m1 -E '^(Skipping|No disk images)' "$report")"; then
	echo "::error title=Notarization skipped::${skipped} - the notarisation did not run. Check the NOTARIZE/APPLE_* bindings on the calling step: the artifact verification one step later refuses these images, after the whole build has been spent."
	exit 1
fi

if ! grep -q '^Disk image notarized and stapled: ' "$report"; then
	echo "::error title=No disk image was notarised::the report shows no 'Disk image notarized and stapled' line, so this step stapled nothing. Expected one per disk image the build produced."
	exit 1
fi
