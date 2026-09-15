#!/usr/bin/env bash
#
# Before/after for the notification kill switch the desktop suite now hands its
# children.
#
# WHY A SHIM. The claim under test is "a test run cannot reach the operator's
# real Notification Center", and the one way to check it that is NOT allowed to
# fail is to actually try. So `osascript` is replaced on PATH by a script that
# records the argv it was handed and exits 0. A run that WOULD have bannered is
# one line in a log, and the operator's Notification Center is touched either
# way. What the shim prints is the real notification command, verbatim.
#
# WHAT IT DRIVES, so the evidence is about the shipped path rather than about
# this script: the real backend entry point
# (`local_operator/tui/notify.py::detached_notify`, the leg
# `session/runtime/serving.py::_announce_pending` calls when a session parks on
# a gate), and — for the after case — the real suite runner
# (`scripts/run-desktop-tests.mjs`), so the environment under test is the one
# `pnpm test:desktop` builds, not one this script sets by hand.
#
# THE TWO CASES, and the second one is why the first is believable:
#   1. the same call with the switch ABSENT, which is the pre-fix environment:
#      one osascript invocation, carrying the banner that used to arrive;
#   2. the same call under the runner's own environment: zero invocations, and
#      the control beside it (the switch removed from the runner's env) still
#      produces one — so the silence is the gate, not a broken shim, a missing
#      interpreter or a typo'd PATH.
#
# Usage: docs/evidence/desktop-notifications-off/harness/run.sh
#
#   LO_PYTHON   A python that can import `local_operator`, editable from source.
#               Defaults to ~/local-operator/.venv/bin/python.
#
# Everything is scratch: HOME, the config dir and the log are under a mktemp
# tree that is removed on exit, and nothing here opens, focuses or writes to the
# operator's own profile or Notification Center.

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
LO_PYTHON=${LO_PYTHON:-$HOME/local-operator/.venv/bin/python}

SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/lo-notifications-off.XXXXXX")
if [ -n "${LO_KEEP:-}" ]; then
	echo "scratch kept: $SCRATCH"
else
	trap 'rm -rf "$SCRATCH"' EXIT
fi

mkdir -p "$SCRATCH/bin" "$SCRATCH/home" "$SCRATCH/config"
# THE IDENTITY BUNDLE IS PINNED CLOSED FOR THIS RUN, and it is not a detail.
# `notify.py` prefers a small app bundle it builds into the config dir, and only
# falls back to `osascript` while that bundle is not ready — a build is one
# clang invocation, so it can finish BETWEEN the two cases below. The bundle
# bypasses PATH entirely, so a run that reached it would post a REAL banner
# under our own identity while the shim counted nothing, and the evidence would
# be measuring the wrong leg. A read-only `notifier` dir makes
# `_build_in_background`'s `O_EXCL` open fail, which leaves `ensure_bundle`
# answering None for the whole run — the state a cold machine is in, and the
# state the incident happened in.
mkdir -p "$SCRATCH/config/notifier"
chmod 500 "$SCRATCH/config/notifier"
export LO_OSASCRIPT_LOG="$SCRATCH/osascript.log"
export LO_SCRATCH_HOME="$SCRATCH/home"
export LO_SCRATCH_CONFIG="$SCRATCH/config"
export LO_PROBE_PYTHON="$LO_PYTHON"
export LO_PROBE_SCRIPT="$SCRATCH/probe.py"
# The shim directory, exported so every python child below PREPENDS it. A child
# that inherits a PATH without it resolves `osascript` to /usr/bin/osascript and
# posts a real banner — which is not a hypothetical: the first run of this
# harness did exactly that from the control case, and the evidence is honesty
# about the gate rather than about the shim only because the shim was first on
# PATH in the case that mattered.
export LO_SCRATCH_BIN="$SCRATCH/bin"
: > "$LO_OSASCRIPT_LOG"

# The shim. It records the whole argv, which is what makes the before case
# readable: the line IS the notification the OS would have shown.
cat > "$SCRATCH/bin/osascript" <<'SHIM'
#!/bin/sh
printf '%s\n' "$*" >> "$LO_OSASCRIPT_LOG"
SHIM
chmod +x "$SCRATCH/bin/osascript"

# The backend call, exactly as the serving runtime makes it: a title and a body
# for a session parked on a gate. `detached_notify` spawns and does not wait, so
# the probe counts the log lines before and after and gives the child a moment.
cat > "$LO_PROBE_SCRIPT" <<'PY'
import os, shutil, time

from local_operator.tui.notify import detached_notify, notifications_enabled

log = os.environ["LO_OSASCRIPT_LOG"]
count = lambda: len([line for line in open(log).read().splitlines() if line.strip()])

# WHICH BINARY this run would reach, printed rather than assumed: a run that
# counts zero invocations while resolving the SYSTEM osascript has proved
# nothing and posted a real banner.
print(f"    osascript resolves to: {shutil.which('osascript')}")
print(f"    LOCAL_OPERATOR_NO_NOTIFICATIONS={os.environ.get('LOCAL_OPERATOR_NO_NOTIFICATIONS')!r}")
print(f"    notifications_enabled()={notifications_enabled()}")
before = count()
started = detached_notify("Scratch session", "Waiting for approval")
time.sleep(1.0)  # detached spawn: let the child run before the log is counted
print(f"    osascript invocations for this call: {count() - before}")
print(f"    detached_notify() returned: {started}")
PY

echo "=== 1. the same call with the switch ABSENT (the pre-fix environment) ==="
echo '$ env -u LOCAL_OPERATOR_NO_NOTIFICATIONS "$LO_PYTHON" "$LO_PROBE_SCRIPT"'
env -u LOCAL_OPERATOR_NO_NOTIFICATIONS \
	HOME="$LO_SCRATCH_HOME" \
	LOCAL_OPERATOR_CONFIG_DIR="$LO_SCRATCH_CONFIG" \
	PATH="$SCRATCH/bin:$PATH" \
	"$LO_PYTHON" "$LO_PROBE_SCRIPT"
echo "  osascript log:"
sed 's/^/    /' "$LO_OSASCRIPT_LOG"

# The after case, through the runner that `pnpm test:desktop` uses. The probe
# file lives in the scratch tree, not in the repo: the runner takes file paths as
# arguments, which is also how the runner's own test drives it.
cat > "$SCRATCH/probe.test.mjs" <<'PROBE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

/*
 * Two runs of the same backend call, and the second is the control: the runner
 * hands this process the suite's environment, and the same python is then run
 * again with the switch removed from it. If the first is silent and the second
 * banners, the silence came from the switch.
 */
const run = (env) =>
	spawnSync(process.env.LO_PROBE_PYTHON, [process.env.LO_PROBE_SCRIPT], {
		env: {
			...env,
			HOME: process.env.LO_SCRATCH_HOME,
			LOCAL_OPERATOR_CONFIG_DIR: process.env.LO_SCRATCH_CONFIG,
			// PREPENDED, in both cases. The switch is what these two runs compare,
			// and the interpreter's own PATH does not contain the shim: without
			// this, a case that is NOT gated resolves `osascript` to the system
			// binary and posts a real banner, so the run would both touch the
			// operator's Notification Center and count nothing.
			PATH: `${process.env.LO_SCRATCH_BIN}:${env.PATH}`,
		},
		encoding: "utf8",
	});

test("the suite's environment silences the backend's notification path", () => {
	const suite = run(process.env);
	console.log(suite.stdout.trimEnd());
	assert.equal(suite.status, 0, suite.stdout + suite.stderr);
	assert.match(
		suite.stdout,
		// The SHIM, named explicitly rather than by shape: the interpreter's own
		// PATH would answer /usr/bin/osascript, and a case asserting "zero
		// invocations" while resolving the system binary has proved nothing (and
		// has posted a banner doing it).
		new RegExp(`osascript resolves to: ${process.env.LO_SCRATCH_BIN}/osascript`),
	);
	assert.match(
		suite.stdout,
		/osascript invocations for this call: 0/,
		`the backend bannered under the suite's environment:\n${suite.stdout}`,
	);
});

test("and the same call banners once the switch is removed (the control)", () => {
	const { LOCAL_OPERATOR_NO_NOTIFICATIONS: _drop, ...without } = process.env;
	const bare = run(without);
	console.log(bare.stdout.trimEnd());
	assert.equal(bare.status, 0, bare.stdout + bare.stderr);
	assert.match(
		bare.stdout,
		/osascript invocations for this call: 1/,
		`the shim saw nothing, so this run proves nothing about the gate:\n${bare.stdout}`,
	);
});
PROBE

echo
echo "=== 2. the same call through the suite's own runner (the fix) ==="
echo '$ node scripts/run-desktop-tests.mjs "$SCRATCH/probe.test.mjs"'
cd "$REPO"
node ./scripts/run-desktop-tests.mjs "$SCRATCH/probe.test.mjs"

echo
echo "=== 3. the osascript log, whole: every invocation this run recorded ==="
echo "  line 1 is case 1's banner; case 2's control is line 2; nothing else may appear"
cat -n "$LO_OSASCRIPT_LOG"
