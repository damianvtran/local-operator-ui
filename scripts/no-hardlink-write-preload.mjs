#!/usr/bin/env node
/**
 * Installs the shared-inode write guard into a test process, before any test
 * file is imported.
 *
 * WHY A PRELOAD RATHER THAN AN IMPORT IN EVERY TEST FILE. The guard has to be in
 * place before the test module's `import { writeFileSync } from "node:fs"` is
 * evaluated, because that statement is what snapshots the binding — see
 * `no-hardlink-write.mjs` for the mechanism. `run-desktop-tests.mjs` spawns the
 * suite, so it passes this file to the child as `--import` and every file the
 * suite runs is covered by construction: a new test file cannot forget to arm a
 * guard it never had to import, and `scripts/no-hardlink-write.test.mjs`
 * enumerates the runner's wiring so the flag cannot be dropped either.
 *
 *   node --import ./scripts/no-hardlink-write-preload.mjs --test scripts/*.test.mjs
 *
 * The escape hatch exists because a guard that refuses a write is exactly the
 * thing a developer debugging a hardlink fixture needs out of the way, and an
 * undocumented one would be discovered by deleting this file. It reports itself
 * when it stands down, so an unguarded run says so on its own output rather
 * than looking like a clean one.
 */

import { installHardlinkWriteGuard, recordHit } from "./no-hardlink-write.mjs";

/**
 * Write a diagnostic line, prefixed so it cannot be mistaken for suite output.
 *
 * WHY THIS IS `console.error` AND NOT A WRITE TO DESCRIPTOR 2, since "make the
 * stand-down land on stderr" looks like the obvious improvement: under node's
 * test runner it is not achievable from here, and the measurements are worth
 * keeping so nobody tries again.
 *
 *   - standalone (`node --import … file.mjs`): stderr 1, stdout 0.
 *   - through `run-desktop-tests.mjs`: stdout 1, stderr 0 — the runner folds the
 *     child's stderr into its own TAP report as `# ` diagnostics.
 *
 * So the routes were tried, all measured under `node --test`:
 * `process.stderr.write`, `writeSync(2, …)`, `writeSync(openSync("/dev/stderr"))`
 * and `writeFileSync("/dev/stderr", …)` EACH produced stdout 0 / stderr 0 — the
 * runner consumes the descriptor outright, and a write made during a test is
 * dropped rather than moved. `console.error` is the only spelling that survives
 * at all, because it runs at preload time before the runner takes the stream.
 *
 * The consequence is stated rather than papered over: a consumer reading only
 * stderr will not see these lines, and one reading stdout sees them as `# `
 * diagnostics. The stand-down is therefore also loud enough to find in a TAP log
 * by grep, which is how CI reads it (`fail=$(grep -E '^# fail ' …)`).
 */
function note(message) {
	console.error(message);
}

/** Set to `1` to run the suite without the guard; the line below is the record. */
const STAND_DOWN_ENV = "LOCAL_OPERATOR_UI_NO_HARDLINK_GUARD";

if (process.env[STAND_DOWN_ENV] === "1") {
	note(
		`no-hardlink-write: STANDING DOWN (${STAND_DOWN_ENV}=1) — UNGUARDED RUN: a write through a shared inode will not be refused`,
	);
} else {
	const hits = [];
	const installed = installHardlinkWriteGuard({
		record: (hit) => {
			hits.push(hit);
			/*
			 * The in-memory list is for this file's own exemption summary; the JSONL
			 * ledger is the audit trail `no-hardlink-write.mjs` documents, written from
			 * here as well so that supplying a `record` does not quietly disable it.
			 */
			recordHit(hit);
		},
	});
	process.on("exit", () => {
		const exemptions = hits.filter((hit) => hit.exemptInTempGround);
		if (exemptions.length > 0) {
			// Reported, never silently excused: this is the line that says the
			// guard saw a linked write and let it past because it stayed inside
			// the run's own temp ground.
			note(
				`no-hardlink-write: ${exemptions.length} linked write(s) allowed on an inode this process declared inside the temp ground, e.g. ${exemptions[0].op} on ${exemptions[0].target} (nlink ${exemptions[0].nlink})`,
			);
		}
	});
	note(
		installed.length > 0
			? `no-hardlink-write: guarding ${installed.length} fs entry points — a write through a shared inode will be refused`
			: "no-hardlink-write: guard already installed in this process (no entry points wrapped again)",
	);
}
