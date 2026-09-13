import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The run panel's child pulse (`docs/run-sidebar.md` § 5.3, § 10.4).
 *
 * Why this file exists: the reader's cadence is driven ENTIRELY by this counter
 * changing, and nothing pinned it. The op it triggers (`subagents.transcript`)
 * had no test either — `grep -rn 'subagents.transcript' scripts/` was empty — so
 * the whole "a beat means a tail read" path rested on a fixture-backed story
 * frame that reads a page out of a seam. Two rules were unasserted: which wire
 * events count as a beat, and what a snapshot seeds.
 *
 * Bundled in memory, like the model test: `subagent-pulse.ts` is pure TypeScript
 * with no React and no DOM, so `node --test` can run the shipped module rather
 * than a copy of its reasoning.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/hooks/subagent-pulse";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { SUBAGENT_PULSE_EVENTS, bumpSubagentPulse, seedSubagentPulses } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

test("exactly the three subagent lifecycle events count as a beat", () => {
	assert.deepEqual(
		[...SUBAGENT_PULSE_EVENTS].sort(),
		["subagent_end", "subagent_progress", "subagent_start"],
	);
	// The boundaries are the ones the backend WRITES the child's file at
	// (`harness/comms.py:1121-1145`). A stream delta is deliberately not one:
	// the transcript is a file behind a whole-file-scan read, so a per-token
	// signal would buy a file scan per token.
	for (const notABeat of [
		"frontend.update",
		"assistant_message",
		"tool_call",
		"subagent_roster",
	]) {
		assert.equal(SUBAGENT_PULSE_EVENTS.has(notABeat), false, notABeat);
	}
});

test("a snapshot seeds one count per child, from the retained events only", () => {
	const pulses = seedSubagentPulses([
		{ type: "subagent_start", job_id: "job-a" },
		{ type: "subagent_progress", job_id: "job-a" },
		{ type: "subagent_progress", job_id: "job-b" },
		{ type: "subagent_end", job_id: "job-a" },
		// Not a subagent event: the ledger is a subagent event with an idempotent
		// shape, and counting it would refetch a page nothing wrote to.
		{ type: "subagent_roster", job_id: "job-a" },
		{ type: "frontend.update", job_id: "job-c" },
		// The taxonomy gives every subagent event a `job_id`
		// (`harness/types.py:1557-1602`); one without it would be filed under `""`
		// and could never match a row.
		{ type: "subagent_progress" },
		{ type: "subagent_progress", job_id: "" },
		{ type: "subagent_progress", job_id: 42 },
		null,
		"not an event",
	]);
	assert.deepEqual(pulses, { "job-a": 3, "job-b": 1 });
});

test("a snapshot that is not a list seeds nothing rather than throwing", () => {
	// `live_events` is read off an untyped snapshot: a backend that sends
	// `null`, an object, or a string must leave the reader quiet, not crash it.
	for (const notAList of [undefined, null, {}, "events", 7]) {
		assert.deepEqual(seedSubagentPulses(notAList), {}, String(notAList));
	}
});

test("a beat increments one child and leaves every other count alone", () => {
	const seeded = { "job-a": 3, "job-b": 1 };
	const bumped = bumpSubagentPulse(seeded, "job-a");
	assert.deepEqual(bumped, { "job-a": 4, "job-b": 1 });
	// A FRESH object rather than a mutation: this is React state, and mutating
	// the map in place would leave the reader's `useEffect` dependency equal to
	// its previous value, so the tail read would never be scheduled.
	assert.notEqual(bumped, seeded);
	assert.deepEqual(seeded, { "job-a": 3, "job-b": 1 });

	// A child the snapshot had not seen starts at 1, not at 0: the reader's rule
	// is "the count CHANGED", and `0` is what an unseeded map already holds.
	assert.deepEqual(bumpSubagentPulse(seeded, "job-c"), {
		"job-a": 3,
		"job-b": 1,
		"job-c": 1,
	});
});
