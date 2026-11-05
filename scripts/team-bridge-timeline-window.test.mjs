import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE WINDOWED TIMELINE'S ARITHMETIC, EXECUTED - pure offsets, no DOM.
 *
 * The strip's whole correctness rests on four functions: the estimate a row
 * gets before it is measured, the prefix-sum layout, the visible range for a
 * `scrollTop`, and the delta a prepend needs so the reader stays where they
 * were. If any of those is wrong the reader sees a jump, a blank strip or a
 * row that mounts when it should not - none of which a renderer test would
 * catch cheaply, and all of which are decidable here.
 *
 * The fixtures are the real `ThreadItem` shape from `team-bridge-model.ts`, so
 * the day/continuation/header split this exercises is the one `threadItems`
 * produces (and `team-bridge-model.test.mjs` covers the construction itself).
 */
const bundle = await build({
	stdin: {
		contents: `
 export * from "./src/renderer/src/features/team-bridge/team-bridge-window";
 `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const windowMath = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const day = (key) => ({
	type: "day",
	key,
	date: new Date(Date.UTC(2026, 9, 18)),
	relative: null,
});

const row = (id, continuation = false) => ({
	type: "message",
	message: { id },
	continuation,
});

/** The component's own stream: each item with the key the strip uses. */
const entries = (items) =>
	items.map((item) => ({ item, key: windowMath.windowEntryKey(item) }));

/* -------------------------------------------------------------- estimates */

test("estimateItemHeight: the three shapes get their own first guess", () => {
	assert.equal(windowMath.estimateItemHeight(day("day-1")), 40);
	assert.equal(windowMath.estimateItemHeight(row("m1", true)), 44);
	assert.equal(windowMath.estimateItemHeight(row("m1", false)), 96);
});

test("windowEntryKey: a day and a message never collide", () => {
	assert.notEqual(
		windowMath.windowEntryKey(day("same")),
		windowMath.windowEntryKey(row("same")),
	);
});

test("windowEntryKey: a message keys on the ROW identity when the caller has one", () => {
	/* The optimistic row keeps its key when the server row replaces it; keying
	   the strip on the message id would remount that row at the moment it
	   settles, which is the one thing `presentationOf` exists to prevent. */
	assert.equal(
		windowMath.windowEntryKey(row("server_id"), "local:abc"),
		"msg:local:abc",
	);
	assert.equal(windowMath.windowEntryKey(row("server_id")), "msg:server_id");
});

/* ----------------------------------------------------------------- layout */

test("windowLayout: unmounted rows use estimates and the total is their sum", () => {
	const items = [day("d1"), row("m1"), row("m2", true)];
	const layout = windowMath.windowLayout(entries(items), new Map());
	assert.deepEqual(layout.heights, [40, 96, 44]);
	assert.deepEqual(layout.offsets, [0, 40, 136]);
	assert.equal(layout.total, 180);
});

test("windowLayout: a measured row replaces its estimate and shifts what follows", () => {
	const items = [day("d1"), row("m1"), row("m2", true)];
	const measured = new Map([[windowMath.windowEntryKey(items[1]), 300]]);
	const layout = windowMath.windowLayout(entries(items), measured);
	assert.deepEqual(layout.heights, [40, 300, 44]);
	assert.deepEqual(layout.offsets, [0, 40, 340]);
	assert.equal(layout.total, 384);
});

/* ------------------------------------------------------------ visible range */

const tallLayout = (count) =>
	windowMath.windowLayout(
		entries(Array.from({ length: count }, (_, index) => row(`m${index}`))),
		new Map(),
	);

test("windowRange: the middle of a long list mounts the visible rows plus overscan", () => {
	const layout = tallLayout(100);
	/* 10 rows of 96px: the viewport starts at row 10 and shows ~5 rows of 600px. */
	const range = windowMath.windowRange(layout, 10 * 96, 600, 6);
	assert.equal(range.start, 10 - 6);
	/* Rows 10..16 intersect (96px each from 960 to 1536), plus 6 below. */
	assert.equal(range.end, 16 + 6 + 1);
	assert.ok(
		range.end - range.start < 100,
		"the strip is a slice, not the list",
	);
});

test("windowRange: at the top and at the bottom the range clamps to the list", () => {
	const layout = tallLayout(20);
	assert.deepEqual(windowMath.windowRange(layout, 0, 400, 6), {
		start: 0,
		end: 11,
	});
	/* 1520px in a 1_920px list: row 15 is the first one still on screen, and the
	   range runs to the last row. */
	const atBottom = windowMath.windowRange(layout, layout.total - 400, 400, 6);
	assert.deepEqual(atBottom, { start: 9, end: 20 });
});

test("windowRange: an empty list mounts nothing", () => {
	assert.deepEqual(
		windowMath.windowRange(windowMath.windowLayout([], new Map()), 0, 400, 6),
		{ start: 0, end: 0 },
	);
});

test("windowSpacers: the two spacers plus the mounted rows add up to the list", () => {
	const layout = tallLayout(50);
	const range = { start: 10, end: 20 };
	const spacers = windowMath.windowSpacers(layout, range);
	const mounted = layout.offsets[19] + layout.heights[19] - layout.offsets[10];
	assert.equal(
		spacers.before + mounted + spacers.after,
		layout.total,
		"a strip whose parts do not add up scrolls to the wrong place",
	);
});

test("windowSpacers: a full render has no spacers at all", () => {
	assert.deepEqual(
		windowMath.windowSpacers(tallLayout(3), { start: 0, end: 3 }),
		{ before: 0, after: 0 },
	);
});

/* ---------------------------------------------------------------- anchoring */

test("windowAnchor: the anchor is the top item and its offset in the strip", () => {
	const layout = tallLayout(40);
	const anchor = windowMath.windowAnchor(layout, 5 * 96 + 30);
	assert.equal(anchor.key, windowMath.windowEntryKey(row("m5")));
	assert.equal(anchor.offset, 5 * 96);
});

test("windowAnchorDelta: a prepend of two rows moves the scroll by exactly those rows", () => {
	const before = windowMath.windowLayout(
		entries(Array.from({ length: 20 }, (_, index) => row(`m${index + 10}`))),
		new Map(),
	);
	const scrollTop = 3 * 96;
	const anchor = windowMath.windowAnchor(before, scrollTop);
	const after = windowMath.windowLayout(
		entries([
			row("m8"),
			row("m9"),
			...Array.from({ length: 20 }, (_, index) => row(`m${index + 10}`)),
		]),
		new Map(),
	);
	const delta = windowMath.windowAnchorDelta(anchor, after);
	assert.equal(
		delta,
		2 * 96,
		"two prepended rows, two row heights of correction",
	);
});

test("windowAnchorDelta: a poll that appends at the bottom moves nothing", () => {
	const before = windowMath.windowLayout(
		entries(Array.from({ length: 10 }, (_, index) => row(`m${index}`))),
		new Map(),
	);
	const anchor = windowMath.windowAnchor(before, 0);
	const after = windowMath.windowLayout(
		entries(Array.from({ length: 12 }, (_, index) => row(`m${index}`))),
		new Map(),
	);
	assert.equal(windowMath.windowAnchorDelta(anchor, after), 0);
});

test("windowAnchorDelta: an anchor trimmed out of the window is null, not a guess", () => {
	const before = windowMath.windowLayout(
		entries([row("gone"), row("kept")]),
		new Map(),
	);
	const anchor = windowMath.windowAnchor(before, 0);
	const after = windowMath.windowLayout(entries([row("kept")]), new Map());
	assert.equal(windowMath.windowAnchorDelta(anchor, after), null);
});

test("windowAnchor: an empty strip has no anchor", () => {
	assert.equal(
		windowMath.windowAnchor(windowMath.windowLayout([], new Map()), 0),
		null,
	);
});

/* ---------------------------------------------------------------- proximity */

test("nearHistoryEdge: the top of the list asks for an older page", () => {
	assert.equal(
		windowMath.nearHistoryEdge({
			scrollTop: 0,
			viewportHeight: 700,
			firstVisible: 0,
			hasOlder: true,
			loading: false,
		}),
		true,
	);
});

test("nearHistoryEdge: one viewport from the top asks, and the middle does not", () => {
	const base = {
		viewportHeight: 700,
		hasOlder: true,
		loading: false,
	};
	assert.equal(
		windowMath.nearHistoryEdge({ ...base, scrollTop: 600, firstVisible: 40 }),
		true,
	);
	assert.equal(
		windowMath.nearHistoryEdge({
			...base,
			scrollTop: 40 * 96,
			firstVisible: 40,
		}),
		false,
	);
});

test("nearHistoryEdge: a short list asks by ROW even when far down in pixels", () => {
	assert.equal(
		windowMath.nearHistoryEdge({
			scrollTop: 9_000,
			viewportHeight: 200,
			firstVisible: 12,
			hasOlder: true,
			loading: false,
		}),
		true,
	);
});

test("nearHistoryEdge: no more history, or a page already in flight, asks nothing", () => {
	const base = { scrollTop: 0, viewportHeight: 700, firstVisible: 0 };
	assert.equal(
		windowMath.nearHistoryEdge({ ...base, hasOlder: false, loading: false }),
		false,
	);
	assert.equal(
		windowMath.nearHistoryEdge({ ...base, hasOlder: true, loading: true }),
		false,
	);
});
