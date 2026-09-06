#!/usr/bin/env node
/**
 * Assert that the packed npm tarball actually starts.
 *
 * Why this exists: 0.15.0 shipped an npm package that could not start at all.
 * `npx local-operator-ui` died at require time with
 * `Invalid or incompatible cached data (cachedDataRejected)` on every machine
 * whose resolved Electron was not the exact build that produced our .jsc
 * bytecode (issue #88). CI had an "NPX Sanity Check" and it passed, because it
 * asserted the wrong thing:
 *
 *   npx ./local-operator-ui-*.tgz &
 *   NPX_PID=$!
 *   sleep 15
 *   if ps -p $NPX_PID  # <- the NODE WRAPPER's pid, not Electron's
 *
 * `bin/local-operator-ui.js` spawns Electron and only exits on the child's
 * `close` event, so a main process that crashes on line 3 still leaves that
 * wrapper alive and `ps` still finds it. The check could not fail for the bug
 * it existed to catch. It also ran on ubuntu-latest only, so the macOS ARM
 * bytecode/arch dimension was never exercised.
 *
 * This replaces liveness with a positive readiness assertion. The app prints
 * LOCAL_OPERATOR_UI_READY from app.whenReady() under
 * LOCAL_OPERATOR_UI_SMOKE_TEST=true and exits 0. We require that marker AND a
 * zero exit, and we additionally scan the combined output for the specific
 * bytecode rejection so a regression names itself instead of timing out.
 *
 * Usage: node scripts/npx-smoke-test.mjs <path-to-tarball>
 */

import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const READY_MARKER = "LOCAL_OPERATOR_UI_READY";
const BYTECODE_ERROR = "cachedDataRejected";

// npx must install Electron (~100MB) before it can run anything, so the budget
// covers a cold download on a CI runner, not just app startup.
const TIMEOUT_MS = Number(process.env.NPX_SMOKE_TIMEOUT_MS ?? 600_000);

const tarball = process.argv[2];
if (!tarball) {
	console.error("Usage: node scripts/npx-smoke-test.mjs <path-to-tarball>");
	process.exit(2);
}

const tarballPath = resolve(tarball);

// A throwaway cache and cwd keep this from resolving anything in the repo's own
// node_modules; the point is to exercise what a user gets, not what we have.
const scratch = mkdtempSync(join(tmpdir(), "npx-smoke-"));

// npx runs an ABSOLUTE path to an existing file as a command (exit 126,
// "Permission denied") instead of installing it as a package. Copy the tarball
// into the sandbox and reference it relatively so npx treats it as a spec.
const localTarball = `./${basename(tarballPath)}`;
copyFileSync(tarballPath, join(scratch, basename(tarballPath)));

console.log(`Running npx smoke test against ${tarballPath}`);

const child = spawn("npx", ["--yes", localTarball], {
	cwd: scratch,
	env: {
		...process.env,
		LOCAL_OPERATOR_UI_SMOKE_TEST: "true",
		npm_config_cache: join(scratch, "npm-cache"),
		// Electron refuses to boot without a display on Linux runners.
		...(process.platform === "linux" ? { DISPLAY: process.env.DISPLAY } : {}),
	},
	stdio: ["ignore", "pipe", "pipe"],
	// Own the whole tree. npx spawns the bin wrapper, which spawns Electron,
	// which spawns helpers; killing only the direct child is precisely the
	// mistake that made the old check vacuous, and it also leaks a crashed
	// Electron that holds the output pipes open forever.
	detached: true,
});

// Kill the process GROUP, not just the pid, and tolerate a group that has
// already gone away.
const killTree = (signal) => {
	try {
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			// Already dead; nothing to clean up.
		}
	}
};

let output = "";
let settled = false;

// Decide as soon as the outcome is knowable. A main process that dies on the
// bytecode loader raises a modal "App threw an error during load" dialog on
// macOS and then sits there, so waiting for exit means waiting for the full
// timeout to report a failure we can already name.
const finish = (ok, message) => {
	if (settled) return;
	settled = true;
	// Assigned below; finish() only ever runs from an async handler, by which
	// point the timer exists.
	clearTimeout(timer);
	console[ok ? "log" : "error"](`\n${message}`);
	killTree("SIGKILL");
	// Give the signal a moment to land before removing the tree's cwd.
	setTimeout(() => {
		rmSync(scratch, { recursive: true, force: true });
		process.exit(ok ? 0 : 1);
	}, 500);
};

const capture = (stream, sink) => {
	stream.on("data", (chunk) => {
		const text = chunk.toString();
		output += text;
		sink.write(text);

		// Report the known failure by name. A generic "did not start" sends the
		// next reader back through the whole diagnosis in issue #88.
		if (output.includes(BYTECODE_ERROR)) {
			finish(
				false,
				`FAIL: the app rejected its own precompiled bytecode (${BYTECODE_ERROR}).\nThe npm tarball must ship plain JS, not .jsc built against one Electron build.`,
			);
		} else if (output.includes(READY_MARKER)) {
			finish(true, `PASS: the app started and reported ${READY_MARKER}.`);
		}
	});
};
capture(child.stdout, process.stdout);
capture(child.stderr, process.stderr);

const timer = setTimeout(() => {
	finish(
		false,
		`FAIL: timed out after ${TIMEOUT_MS}ms without seeing ${READY_MARKER}.`,
	);
}, TIMEOUT_MS);

child.on("error", (err) => {
	finish(false, `FAIL: could not run npx: ${err.message}`);
});

// Exiting before either marker appeared is a failure regardless of the code:
// the app is supposed to announce readiness, and silence means it never got
// far enough to try.
child.on("close", (code, signal) => {
	finish(
		false,
		`FAIL: the app never reported ${READY_MARKER} (exit code ${code}, signal ${signal}).`,
	);
});
