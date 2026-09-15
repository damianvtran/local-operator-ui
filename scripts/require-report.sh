#!/usr/bin/env bash
#
# Run a gate command and refuse to let a SILENT success read as a pass.
#
# WHY THIS EXISTS. Every consumer of the gate scripts in `.github/workflows/`
# reads their EXIT STATUS, and to the runner "the gate ran and had nothing to
# complain about" and "the gate never ran" are the same two facts: exit 0 with
# nothing on the stream. That is not hypothetical in this repository. The gate
# scripts resolved their own entry point lexically, so invoking one through a
# symlinked spelling (`node /tmp/<checkout>/scripts/...`, which is how they get
# run by hand on macOS, where `/tmp` is a link to `private/tmp`) loaded the file,
# ran nothing, printed nothing and exited 0 — and QA reproduced a genuinely
# FAILING gate (`check-packaged-closure.mjs`, `verify-macos-artifacts.mjs`)
# becoming a PASSING one through that spelling. `scripts/entry-point.mjs` removes
# the cause inside the scripts; this removes the class in the steps that call
# them, so the next way a gate can fail to run — a truncation, a future script
# that never reaches its own main, an exit path nobody thought about — is red
# rather than green-and-empty.
#
# WHY A HELPER AND NOT THE SAME FIVE LINES IN EVERY STEP. This repository keeps
# re-finding defects that were written once per call site: `release-push-guard.mjs`
# had this class fixed alone while the eight scripts beside it, in the same `run:`
# blocks, kept it. "Did the gate actually answer?" has one implementation for the
# same reason.
#
# WHY `tee` AND NOT A COMMAND SUBSTITUTION. The output still streams as it is
# produced, so a slow step (DMG notarization) does not go dark until it finishes,
# while the file that decides emptiness is the same bytes the reader saw.
#
# WHY THE STATUS IS CAPTURED RATHER THAN LEFT TO `set -e`. GitHub's default shell
# for a `run:` step with no `defaults.run.shell` is `bash -e {0}`. Under `-e` a
# bare `out="$(cmd)"` aborts the step AT the substitution, so the reason never
# reaches the log — the diagnostics regression the version-bump-guard step in
# `.github/workflows/version-bump-guard.yml` shipped in review round 1 of #210.
# `|| status=$?` keeps `-e` from firing while still recording the code.
#
# Usage: require-report.sh <gate name> <command> [args...]
#
# Exits with the command's own status. Exits 1 when the command succeeded and
# printed nothing, naming that case rather than letting it read as a pass. Exits 2
# when the helper itself was called wrong, which is a defect in the caller.
set -uo pipefail

if [ "$#" -lt 2 ]; then
	echo "::error title=require-report.sh misused::expected a gate name and a command to run, got $# argument(s): $*. This is a defect in the calling step, not in the gate."
	exit 2
fi

label="$1"
shift

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

status=0
"$@" 2>&1 | tee "$log" || status=$?

if [ "$status" -eq 0 ] && [ ! -s "$log" ]; then
	echo "::error title=${label} produced no report::${label} exited 0 without printing anything, so it passed without having checked anything. This is the shape a gate that never ran takes - including one reached through a path spelling it could not resolve - and it is refused rather than read as a pass."
	exit 1
fi

exit "$status"
