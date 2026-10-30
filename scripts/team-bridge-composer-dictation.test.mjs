import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

/*
 * THIS FILE IS THE RUNNER-LEVEL WRAPPER for Team Bridge's composer dictation
 * cases.
 *
 * WHY THE CHILD GETS `--test-force-exit`. The cases mount the SHIPPED composer
 * against a scripted take, and the speech manager it registers with leaves a
 * renderer-level listener plus React Query's own handles alive after the route
 * is unmounted - so an unforced `node --test` runs every assertion green and
 * then holds the process for minutes before exiting. The cases file registers
 * all of its tests before any await, so force-exit cannot skip a late
 * registration. It is scoped to this child only: `run-desktop-tests.mjs` states
 * why the runner must never pass the flag globally.
 */
test("Team Bridge composer dictation suite", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--test",
			"--test-force-exit",
			new URL("./team-bridge-composer-dictation.cases.mjs", import.meta.url)
				.pathname,
		],
		{
			stdio: "inherit",
			env: Object.fromEntries(
				Object.entries(process.env).filter(
					([key]) => key !== "NODE_TEST_CONTEXT",
				),
			),
		},
	);
	assert.equal(
		result.status,
		0,
		`the composer dictation cases failed (status ${result.status})`,
	);
});
