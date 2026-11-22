import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The jump-to-latest chip's producer, in memory.
 *
 * The register answers one question - "did something NEW arrive at the tail
 * while this reader was away?" - and it has three failure modes that are
 * invisible in a green rendered frame: treating a page of older history as
 * news, dropping an arrival because the newest row grew rather than changed
 * identity, and clearing itself a frame after every record (the flash that came
 * from using the record count as a conversation key). Each of those is two
 * lines here and a scroll-and-wait in front of a screen otherwise.
 *
 * The module is pure TypeScript with no React and no DOM, so it bundles the
 * same way `scroll-paging.ts` does (`transcript-paging.test.mjs`). The paging
 * policy is bundled beside it because the chip's threshold must BE the policy's
 * epsilon, not a number that happens to match today.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/new-activity";',
			'export * from "./src/renderer/src/features/chat/canonical/scroll-paging";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	EMPTY_FINGERPRINT,
	TAIL_EPS_PX,
	advanceNewActivity,
	activityFingerprint,
	chipVisibleAt,
	followsTail,
	initialActivityState,
	recordExtent,
	tailArrival,
} = module;

const record = (overrides) => ({
	kind: "assistant",
	id: "row",
	ts: 0,
	text: "",
	streaming: false,
	stopReason: null,
	error: false,
	...overrides,
});

test("a record appended at the tail is activity while the reader is away", () => {
	const before = activityFingerprint([record({ id: "a" })]);
	const after = activityFingerprint([record({ id: "a" }), record({ id: "b" })]);
	const state = advanceNewActivity(initialActivityState(before), after, false);
	assert.equal(tailArrival(before, after), "appended");
	assert.equal(state.pending, true);
	assert.deepEqual(state.fingerprint, after);
});

test("a page of older history is not activity", () => {
	/*
	 * The whole reason the fingerprint carries the newest id: an older page
	 * PREPENDS, so the count answers "more rows" whether the growth is news at
	 * the bottom or history at the top.
	 */
	const before = activityFingerprint([record({ id: "b" })]);
	const after = activityFingerprint([
		record({ id: "older-1" }),
		record({ id: "older-2" }),
		record({ id: "b" }),
	]);
	const state = advanceNewActivity(initialActivityState(before), after, false);
	assert.equal(tailArrival(before, after), "older-page");
	assert.equal(state.pending, false);
	// The register still learns the loaded extent, so the next append is scored
	// against the page the reader now holds.
	assert.deepEqual(state.fingerprint, after);
});

test("a streaming tail that lengthens is activity", () => {
	const before = activityFingerprint([record({ id: "b", text: "Hel" })]);
	const after = activityFingerprint([record({ id: "b", text: "Hello" })]);
	const state = advanceNewActivity(initialActivityState(before), after, false);
	assert.equal(tailArrival(before, after), "grew");
	assert.equal(state.pending, true);
});

test("a following reader never accumulates - and clears an earlier arrival", () => {
	const quiet = activityFingerprint([record({ id: "a" })]);
	const busy = activityFingerprint([record({ id: "a", text: "streaming" })]);
	const pending = advanceNewActivity(initialActivityState(quiet), busy, false);
	assert.equal(pending.pending, true);

	// The reader scrolls back to the tail with no new content: the register is
	// cleared by the following reading alone, without waiting for an arrival.
	const settled = advanceNewActivity(pending, busy, true);
	assert.equal(settled.pending, false);

	// And activity that lands under a following reader is not news.
	const watching = advanceNewActivity(initialActivityState(quiet), busy, true);
	assert.equal(watching.pending, false);
});

test("the first page to land in an empty pane is the transcript, not news", () => {
	const first = activityFingerprint([record({ id: "a" }), record({ id: "b" })]);
	const state = advanceNewActivity(
		initialActivityState(EMPTY_FINGERPRINT),
		first,
		false,
	);
	assert.equal(tailArrival(EMPTY_FINGERPRINT, first), "baseline");
	assert.equal(state.pending, false);
});

test("a conversation switch is a baseline, not an arrival", () => {
	const old = activityFingerprint([record({ id: "old-1" })]);
	const next = activityFingerprint([
		record({ id: "new-1" }),
		record({ id: "new-2" }),
	]);
	// The hook resets through `initialActivityState`; a reducer that had to infer
	// it from the array alone would have to guess between a switch and a replace.
	const state = advanceNewActivity(initialActivityState(next), next, false);
	assert.equal(state.pending, false);
	// A wholesale replacement reads as a reset, never as an arrival.
	assert.equal(tailArrival(next, old), "reset");
});

test("an unchanged tail returns the same register object", () => {
	const fingerprint = activityFingerprint([record({ id: "a" })]);
	const state = initialActivityState(fingerprint);
	// Identity, not deep equality: the scroll path calls this on every event, and
	// a new object each time would re-render the chip's host for nothing.
	assert.equal(advanceNewActivity(state, fingerprint, false), state);
});

test("the extent reads each kind's growing body", () => {
	assert.equal(recordExtent(record({ text: "hello" })), 5);
	assert.equal(
		recordExtent({
			kind: "peer",
			id: "p",
			ts: 0,
			body: "hi there",
			sender: {},
		}),
		8,
	);
	assert.equal(
		recordExtent({
			kind: "tool",
			id: "t",
			ts: 0,
			toolCallId: "c",
			toolName: "bash",
			intent: null,
			args: null,
			phase: "composing",
			argumentBytes: 40,
			output: "done",
		}),
		44,
	);
	// A kind whose body never streams contributes only by appending.
	assert.equal(
		recordExtent({ kind: "compaction", id: "c", ts: 0, before: 4, after: 1 }),
		0,
	);
});

test("the chip is hidden exactly while the reader follows the tail", () => {
	/*
	 * The invariant the brief names: chip hidden <=> following. It is checked by
	 * sweep rather than by one sample because the old defect lived in a BAND
	 * (24-50px) where the chip's own threshold and the paging policy's disagreed.
	 */
	const scrollHeight = 2000;
	const clientHeight = 800;
	for (let scrollTop = 0; scrollTop <= 300; scrollTop += 1) {
		assert.equal(
			chipVisibleAt(-scrollTop, scrollHeight, clientHeight),
			!followsTail(-scrollTop),
			`scrollTop -${scrollTop}`,
		);
	}
	// A transcript that cannot scroll has nowhere to jump to, whatever its offset.
	assert.equal(chipVisibleAt(-300, 700, 800), false);
	// One epsilon, and it is the paging policy's own.
	assert.equal(followsTail(TAIL_EPS_PX), true);
	assert.equal(followsTail(TAIL_EPS_PX + 1), false);
});
