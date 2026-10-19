import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

/*
 * THIS FILE IS THE RUNNER-LEVEL WRAPPER for the Library page integration cases.
 *
 * WHY THE CHILD GETS `--test-force-exit`. The page suite mounts the SHIPPED
 * React page against a stubbed desktop bridge. Its link-refusal case leaves a
 * React Query mutation promise unsettled after every assertion has passed (the
 * store outlives the unmounted route), so an unforced `node --test` reports
 * "Promise resolution is still pending" and holds the process open. The cases
 * file registers all of its tests before any await, so force-exit cannot skip a
 * late registration here. It is deliberately scoped to this child: the runner
 * must NOT pass `--test-force-exit` globally, because a file that registers a
 * test after a top-level await would then report a false green (the runner's
 * lane-bound test caught exactly that).
 */
test("Library page integration suite", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--test",
			"--test-force-exit",
			`--import=${new URL("./no-hardlink-write-preload.mjs", import.meta.url).href}`,
			new URL("./library-page.cases.mjs", import.meta.url).pathname,
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
		`the Library page integration cases failed (status ${result.status})`,
	);
});
