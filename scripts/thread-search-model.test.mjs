import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SEARCH MODEL'S PURE HALF — the chord, the state ladder, the cursor
 * arithmetic and the snippet segmentation.
 *
 * Bundled directly rather than through the overlay, for the reason
 * `checkpoint-model.test.mjs` gives for its own module: these rules are what
 * the component and the hook both resolve against, and a story can only show
 * that SOME of them held on the fixture it happened to use. Nothing here needs
 * a DOM, so nothing here mounts one.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/thread-search-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** One key press, with the fields a case is not about held to "no". */
const press = (over = {}) => ({
	key: "f",
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...over,
});

test("the chord is exactly Meta/Ctrl+F, and no neighbouring chord is claimed", () => {
	assert.equal(model.isThreadSearchPress(press({ metaKey: true })), true);
	assert.equal(model.isThreadSearchPress(press({ ctrlKey: true })), true);
	// Layouts that report the produced character rather than the base key.
	assert.equal(
		model.isThreadSearchPress(press({ key: "F", metaKey: true })),
		true,
	);
	// Shift and alt make ⌘⇧F / ⌥⌘F somebody else's chord, and a bare F is text.
	assert.equal(
		model.isThreadSearchPress(press({ metaKey: true, shiftKey: true })),
		false,
	);
	assert.equal(
		model.isThreadSearchPress(press({ metaKey: true, altKey: true })),
		false,
	);
	assert.equal(
		model.isThreadSearchPress(press({ ctrlKey: true, shiftKey: true })),
		false,
	);
	assert.equal(model.isThreadSearchPress(press()), false);
	assert.equal(
		model.isThreadSearchPress(press({ key: "g", metaKey: true })),
		false,
	);
	assert.equal(model.threadSearchCap(true), "⌘F");
	assert.equal(model.threadSearchCap(false), "Ctrl+F");
});

test("an answer's state maps to the panel's ladder, and an unknown one reads as an error", () => {
	for (const state of ["ready", "building", "unsupported", "error"]) {
		assert.equal(model.threadSearchAnswerState(state), state);
	}
	// A state this client does not know is not "ready" (render a payload the
	// app cannot vouch for) and not "unsupported" (a fact about where bytes
	// live); the honest reading is that the answer could not be understood.
	assert.equal(model.threadSearchAnswerState("teleported"), "error");
});

test("the cursor wraps at both ends and goes nowhere on an empty list", () => {
	assert.equal(
		model.threadSearchCursorMove(-1, 1, 3),
		0,
		"first step forward selects the best hit",
	);
	assert.equal(model.threadSearchCursorMove(0, 1, 3), 1);
	assert.equal(
		model.threadSearchCursorMove(2, 1, 3),
		0,
		"forward wraps to the top",
	);
	assert.equal(
		model.threadSearchCursorMove(0, -1, 3),
		2,
		"back wraps to the last",
	);
	assert.equal(
		model.threadSearchCursorMove(-1, -1, 3),
		2,
		"back from nothing lands on the last",
	);
	assert.equal(
		model.threadSearchCursorMove(0, 1, 0),
		-1,
		"an empty list has no cursor",
	);
	assert.equal(
		model.threadSearchCursorMove(9, 1, 3),
		0,
		"a cursor a smaller answer invalidated re-enters the list",
	);
});

test("the active hit is the cursor's row, or null outside the list", () => {
	const hits = [
		{ id: "a", role: "user", ts: 1, snippet: "a", ranges: [], tier: "exact" },
		{ id: "b", role: "agent", ts: 2, snippet: "b", ranges: [], tier: "soft" },
	];
	assert.equal(model.threadSearchActiveHit(hits, 0).id, "a");
	assert.equal(model.threadSearchActiveHit(hits, 1).id, "b");
	assert.equal(model.threadSearchActiveHit(hits, -1), null);
	assert.equal(model.threadSearchActiveHit(hits, 2), null);
});

test("ranges split the snippet into marked and unmarked runs", () => {
	assert.deepEqual(model.splitThreadSearchRanges("hello world", [[0, 5]]), [
		{ text: "hello", matched: true },
		{ text: " world", matched: false },
	]);
	assert.deepEqual(model.splitThreadSearchRanges("hello world", [[6, 11]]), [
		{ text: "hello ", matched: false },
		{ text: "world", matched: true },
	]);
	assert.deepEqual(
		model.splitThreadSearchRanges("a b c", [
			[0, 1],
			[4, 5],
		]),
		[
			{ text: "a", matched: true },
			{ text: " b ", matched: false },
			{ text: "c", matched: true },
		],
	);
});

test("a soft hit's empty ranges are one unmarked run, and malformed ranges cannot throw or paint backwards", () => {
	assert.deepEqual(model.splitThreadSearchRanges("soft text", []), [
		{ text: "soft text", matched: false },
	]);
	// A zero-length range is not a match.
	assert.deepEqual(model.splitThreadSearchRanges("abc", [[1, 1]]), [
		{ text: "abc", matched: false },
	]);
	// Out-of-bounds entries clamp to the snippet.
	assert.deepEqual(model.splitThreadSearchRanges("abc", [[-5, 99]]), [
		{ text: "abc", matched: true },
	]);
	// Out-of-order (overlapping) ranges move FORWARD from the cursor rather
	// than throwing or overlapping the marks: the data disagreed with the
	// "non-overlapping, oldest first" contract, and the recovery that cannot
	// paint a doubled mark is to refuse the second range's already-covered part.
	assert.deepEqual(
		model.splitThreadSearchRanges("abcd", [
			[2, 4],
			[0, 2],
		]),
		[
			{ text: "ab", matched: false },
			{ text: "cd", matched: true },
		],
	);
	assert.deepEqual(model.splitThreadSearchRanges("", [[0, 0]]), []);
});

test("counts pluralise and split by tier, the cut rides the same line, and only building earns a follow-up", () => {
	const exact = (n) => Array.from({ length: n }, () => ({ tier: "exact" }));
	const soft = (n) => Array.from({ length: n }, () => ({ tier: "soft" }));
	assert.equal(model.threadSearchCountLabel(exact(1)), "1 match");
	assert.equal(model.threadSearchCountLabel(exact(7)), "7 matches");
	assert.equal(model.threadSearchCountLabel(soft(1)), "1 related match");
	assert.equal(model.threadSearchCountLabel(soft(2)), "2 related matches");
	/*
	 * The split case is UX U3's: a bare total hid that one row was exact and
	 * ninety-nine were the soft tier's.
	 */
	assert.equal(
		model.threadSearchCountLabel([...exact(1), ...soft(99)]),
		"1 exact · 99 related",
	);
	/*
	 * And the truncation is a SUFFIX on that line, not a second sentence: the
	 * design finding was "100 matches Showing the first 100 matches."
	 */
	assert.equal(model.threadSearchTruncatedLabel(100), "(first 100 shown)");
	assert.equal(model.threadSearchTruncatedLabel(1), "(the first match shown)");
	assert.equal(model.threadSearchWantsFollowUp({ state: "building" }), true);
	for (const state of ["ready", "unsupported", "error"]) {
		assert.equal(model.threadSearchWantsFollowUp({ state }), false);
	}
});

test("the wire's roles and tiers read as the list's own words", () => {
	assert.equal(model.THREAD_SEARCH_ROLE_LABELS.user, "You");
	assert.equal(model.THREAD_SEARCH_ROLE_LABELS.agent, "Agent");
	assert.equal(model.THREAD_SEARCH_TIER_HINT, "related match");
	assert.equal(model.THREAD_SEARCH_PLACEHOLDER, "Search this conversation");
});

test("the stale list and the far seek each say their own piece", () => {
	/*
	 * UX U1: the in-flight list is the previous search's, and the line says so
	 * rather than restating a total that no longer answers the box.
	 */
	assert.match(model.THREAD_SEARCH_STALE_COPY, /previous search/);
	/*
	 * UX U2: the refusal names the step that changes the answer — the
	 * transcript's own scroll-up for older pages — not only the wall.
	 */
	assert.match(model.THREAD_SEARCH_JUMP_MISS_COPY, /scroll up/);
	/* UX U4: the far seek reports itself while it runs. */
	assert.match(model.THREAD_SEARCH_JUMPING_COPY, /Going to that message/);
});
