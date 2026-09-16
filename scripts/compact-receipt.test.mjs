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
	tailCarriesOutcome,
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

test("the read's stop predicate is scoped to THIS pass", () => {
	/*
	 * Review round 3, R3-2 / Q8. Unscoped, the predicate reported success on any
	 * session whose last hundred entries contain an earlier pass's row, so the
	 * first read stopped the schedule and the second delay — the backstop — never
	 * ran. QA measured the refusal landing at ~1.47 s against a 1500 ms first
	 * read: the retry path this read exists for had a 30 ms margin and no second
	 * chance.
	 */
	const NOW = 1_700_000_000_000;
	const durable = (tsSeconds) => ({ ts: tsSeconds, type: "compaction" });
	const refusal = (tsSeconds) => ({
		ts: tsSeconds,
		type: "message",
		payload: { custom_type: "compaction_refused" },
	});
	// An EARLIER pass on the tail page — the case that used to look like success.
	assert.equal(tailCarriesOutcome([durable(NOW / 1000 - 600)], NOW), false);
	assert.equal(tailCarriesOutcome([refusal(NOW / 1000 - 600)], NOW), false);
	// This pass's own outcome: the durable row, or the refusal that corrects the
	// optimistic receipt. Both are at or after the receipt that scheduled the read.
	assert.equal(tailCarriesOutcome([durable(NOW / 1000 + 2)], NOW), true);
	assert.equal(tailCarriesOutcome([refusal(NOW / 1000 + 1.47)], NOW), true);
	// Seconds on the wire, milliseconds in the comparison.
	assert.equal(tailCarriesOutcome([durable(NOW / 1000)], NOW), true);
	// Nothing relevant on the page.
	assert.equal(tailCarriesOutcome([], NOW), false);
	assert.equal(
		tailCarriesOutcome([{ ts: NOW / 1000 + 5, type: "message" }], NOW),
		false,
	);
});

test("a repeat session still gets the backstop read", async () => {
	/*
	 * The end-to-end shape of R3-2, with the real predicate: a session the user has
	 * compacted BEFORE, then a pass that declines. The first read finds only the
	 * older pass's row and must NOT stop the schedule.
	 */
	const NOW = 1_700_000_000_000;
	const olderPass = [{ ts: NOW / 1000 - 600, type: "compaction" }];
	const waits = [];
	const reads = [];
	await refreshCompactionOutcome(
		async () => {
			reads.push(1);
			// Read one: the tail page holds the OLD row only. Read two: this pass's row.
			return tailCarriesOutcome(
				reads.length === 1
					? olderPass
					: [{ ts: NOW / 1000 + 2, type: "compaction" }],
				NOW,
			);
		},
		(ms) => {
			waits.push(ms);
			return Promise.resolve();
		},
	);
	assert.equal(reads.length, 2, "the 5 s backstop must actually run");
	assert.deepEqual(waits, [1500, 5000]);
});

test("the read is wired to the scoped predicate, the paging guard and the view epoch", () => {
	/*
	 * The read lives in a React hook, so the predicate above is driven directly and
	 * the wiring — which is where the round-3 findings were — is read from the two
	 * files that own it. Neutering the predicate (returning a constant) or dropping
	 * either guard re-fails this test, which is what the reviewer's mutation run
	 * showed nothing did.
	 */
	const hook = readFileSync(
		"src/renderer/src/shared/hooks/use-canonical-session.ts",
		"utf8",
	);
	assert.match(hook, /tailCarriesOutcome\(page\.entries, since\)/);
	assert.match(hook, /keepPaging: true/);
	assert.match(hook, /transcript\.viewEpoch !== epoch/);
	/*
	 * MINOR-1 (review round 8): the instant that reaches the reducer is the PASS'S
	 * OWN receipt instant, and dropping it left the whole suite green — the same
	 * class as Q14, a wiring fact no test could falsify. Two facts, asserted
	 * together: the hook hands `since` down to the page merge, and the dispatch's
	 * `since` is the receipt's own `Date.now()` (the assertion below on
	 * `refreshTail(since, epoch)` is what makes them the same value). The reducer
	 * side of the pair — a page row before that instant is refused — is driven
	 * behaviourally in `scripts/transcript-reducer.test.mjs`; and the option pair is
	 * REQUIRED by the reducer's own type, so an omission there cannot compile.
	 */
	assert.match(hook, /outcomeSince: since/);
	const dispatch = readFileSync(
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
		"utf8",
	);
	assert.match(dispatch, /const since = Date\.now\(\)/);
	assert.match(dispatch, /canonical\.transcript\.viewEpoch/);
	assert.match(dispatch, /canonical\.refreshTail\(since, epoch\)/);
});
