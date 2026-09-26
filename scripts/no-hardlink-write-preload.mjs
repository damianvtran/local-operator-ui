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

import { installHardlinkWriteGuard } from "./no-hardlink-write.mjs";

/** Set to `1` to run the suite without the guard; the line below is the record. */
const STAND_DOWN_ENV = "LOCAL_OPERATOR_UI_NO_HARDLINK_GUARD";

if (process.env[STAND_DOWN_ENV] === "1") {
	console.error(
		`no-hardlink-write: STANDING DOWN (${STAND_DOWN_ENV}=1) — a write through a shared inode will not be refused`,
	);
} else {
	const hits = [];
	const installed = installHardlinkWriteGuard({
		record: (hit) => hits.push(hit),
	});
	process.on("exit", () => {
		const exemptions = hits.filter((hit) => hit.exemptInTempGround);
		if (exemptions.length > 0) {
			// Reported, never silently excused: this is the line that says the
			// guard saw a linked write and let it past because it stayed inside
			// the run's own temp ground.
			console.error(
				`no-hardlink-write: ${exemptions.length} linked write(s) allowed inside the temp ground, e.g. ${exemptions[0].op} on ${exemptions[0].real} (nlink ${exemptions[0].nlink})`,
			);
		}
	});
	console.error(
		installed.length > 0
			? `no-hardlink-write: guarding ${installed.length} fs entry points — a write through a shared inode will be refused`
			: "no-hardlink-write: guard already installed in this process (no entry points wrapped again)",
	);
}
