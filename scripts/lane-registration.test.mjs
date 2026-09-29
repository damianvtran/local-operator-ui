import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/*
 * Every lane in `scripts/` must RUN somewhere.
 *
 * WHY THIS EXISTS: the projects-sheet lane shipped without an entry in
 * `test:desktop`, so CI never executed it — the gap review round 1's R1-1
 * caught, and a gap a test should have caught instead. Most lanes are named
 * literally in `package.json`'s scripts; the release/mac/appimage ones are
 * named in `.github/workflows/ci.yml` instead, so the invariant is "named by
 * a script value or by a workflow file", checked over the raw text of both
 * (every entry is a literal path — no globs — which is what makes a text
 * search the honest check).
 *
 * The lane list itself is the thing that drifts: a new file lands, the diff
 * looks like one new test file, and nothing fails until somebody asks why the
 * suite count did not move.
 */

/** A lane file: the top-level `scripts/*.test.mjs` shape every runner names. */
const LANE_FILE = /\.test\.mjs$/;

test("every scripts/*.test.mjs lane is named by a package.json script or a workflow", () => {
	const packageJson = readFileSync(join("package.json"), "utf8");
	const workflowsDir = join(".github", "workflows");
	const workflows = readdirSync(workflowsDir)
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
		.map((name) => readFileSync(join(workflowsDir, name), "utf8"))
		.join("\n");
	const missing = readdirSync("scripts")
		.filter((name) => LANE_FILE.test(name))
		.filter((name) => !packageJson.includes(name) && !workflows.includes(name));
	assert.deepEqual(
		missing,
		[],
		`scripts/*.test.mjs not named by any package.json script or workflow: ${missing.join(", ")}`,
	);
});
