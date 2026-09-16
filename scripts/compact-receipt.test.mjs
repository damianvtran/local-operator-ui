import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The two decisions a routed `/compact` makes, bundled from the real module the
 * dispatcher imports — the same way `scripts/slash-submit.test.mjs` bundles the
 * planner, so the thing under test is the thing that ships.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/compact-receipt";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	COMPACT_START_NOTICE,
	COMPACT_TAIL_READ_DELAYS_MS,
	isCompactStartNotice,
	refreshCompactionOutcome,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("only the start notice is swallowed, by its text", () => {
	/*
	 * Review round 1, R2 — the suppression was keyed on the notice's SHAPE
	 * (`notice` + `info`), which also swallowed the answers that must be shown:
	 * a refusal the runtime reports in that tone was dropped, and a command that
	 * appears to do nothing came back through the line written to prevent it.
	 * Round 2's NEW-3 found the fix unguarded, which this file is.
	 */
	assert.equal(COMPACT_START_NOTICE, "compacting context…");
	assert.equal(isCompactStartNotice("compacting context…"), true);
	assert.equal(isCompactStartNotice("  compacting context…  "), true);
	// The phone-facing sentence, which must NOT be swallowed.
	assert.equal(isCompactStartNotice("compacting context"), false);
	assert.equal(
		isCompactStartNotice("nothing to compact: the conversation is empty"),
		false,
	);
	assert.equal(isCompactStartNotice(""), false);
	assert.equal(isCompactStartNotice(undefined), false);
	assert.equal(isCompactStartNotice(null), false);
});

test("the receipt is matched by the predicate, not by the notice's shape", () => {
	/*
	 * The behavioural test above cannot see the dispatcher's own branch, so this
	 * reads it: reverting to the shape key re-introduces the defect while every
	 * behavioural test stays green (measured by the reviewer — 149 tests, 0 fail
	 * with the old line restored).
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
		"utf8",
	);
	assert.match(
		source,
		/isCompactStartNotice\(result\.text\)/,
		"the direct `/compact` branch must key on the start notice's text",
	);
	assert.doesNotMatch(
		source,
		/result\.style === "info"/,
		'a shape test (kind === "notice" && style === "info") swallows every info-toned answer, refusals included',
	);
});

test("the tail re-read is bounded at two reads and stops when the outcome lands", async () => {
	const waited = [];
	const wait = (ms) => {
		waited.push(ms);
		return Promise.resolve();
	};
	assert.deepEqual([...COMPACT_TAIL_READ_DELAYS_MS], [1500, 5000]);

	// The outcome is on screen after the first delay: one read, and no second.
	let reads = 0;
	await refreshCompactionOutcome(async () => {
		reads += 1;
		return true;
	}, wait);
	assert.equal(reads, 1);
	assert.deepEqual(waited, [1500]);

	// Nothing there the first time: exactly one more, and then it stops.
	reads = 0;
	waited.length = 0;
	await refreshCompactionOutcome(async () => {
		reads += 1;
		return false;
	}, wait);
	assert.equal(reads, 2, "two reads is the bound, not a polling loop");
	assert.deepEqual(waited, [1500, 5000]);

	// A rejected read is the schedule's own answer: the next delay is the retry.
	waited.length = 0;
	reads = 0;
	await refreshCompactionOutcome(async () => {
		reads += 1;
		if (reads === 1) throw new Error("backend unreachable");
		return true;
	}, wait);
	assert.equal(reads, 2);
	assert.deepEqual(waited, [1500, 5000]);
});
