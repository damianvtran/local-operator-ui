import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The sidebar destination rail's pure model, against the SHIPPED module.
 *
 * The component, the drag layer and the stories all compose these functions,
 * so this is where the layout invariants are checked rather than in a rendered
 * frame: every one of them is a statement the renderer is allowed to rely on
 * (all nine ids, no duplicates, one fold, unavailable rows staying put). The
 * bundle is the same mechanism `library-model.test.mjs` uses - esbuild over the
 * real TypeScript, so a signature change breaks this suite instead of drifting
 * behind a hand-copied fixture.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/components/navigation/sidebar-destinations";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const {
	SIDEBAR_DESTINATION_IDS,
	DEFAULT_SIDEBAR_LAYOUT,
	isSidebarDestinationId,
	sanitizeSidebarLayout,
	layoutEquals,
	regionOf,
	renderedRegion,
	moveWithinRegion,
	moveToRegion,
	placeInRegion,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const ALL = new Set(SIDEBAR_DESTINATION_IDS);
const DEFAULT_VISIBLE = [
	"aida",
	"library",
	"projects",
	"agents",
	"schedules",
	"browser",
];
const DEFAULT_MORE = ["team-bridge", "agent-hub", "mesh"];

const layout = (visible, more) => ({ visible, more });

test("the id tuple is the nine defaults, in default order", () => {
	assert.deepEqual(SIDEBAR_DESTINATION_IDS, [
		...DEFAULT_VISIBLE,
		...DEFAULT_MORE,
	]);
});

test("default arrangement matches the design contract", () => {
	assert.deepEqual(
		DEFAULT_SIDEBAR_LAYOUT,
		layout(DEFAULT_VISIBLE, DEFAULT_MORE),
	);
});

test("sanitize returns the default for absent, empty and non-object input", () => {
	for (const input of [undefined, null, {}, { visible: null, more: "x" }, 42]) {
		const result = sanitizeSidebarLayout(input);
		assert.deepEqual(result, layout(DEFAULT_VISIBLE, DEFAULT_MORE));
	}
	// Fresh arrays on every call: the result goes into a query cache, and a
	// shared reference would let one caller's splice edit every future layout.
	const first = sanitizeSidebarLayout(undefined);
	const second = sanitizeSidebarLayout(undefined);
	assert.notEqual(first, second);
	assert.notEqual(first.visible, second.visible);
	assert.notEqual(first.more, second.more);
	first.visible.push("aida");
	assert.deepEqual(second.visible, DEFAULT_VISIBLE);
});

test("sanitize re-inserts a missing id at its default position", () => {
	const missingLibrary = sanitizeSidebarLayout({
		visible: ["aida", "projects", "agents", "schedules", "browser"],
		more: [...DEFAULT_MORE],
	});
	assert.deepEqual(missingLibrary, layout(DEFAULT_VISIBLE, DEFAULT_MORE));

	const missingMore = sanitizeSidebarLayout({
		visible: [...DEFAULT_VISIBLE],
		more: ["mesh"],
	});
	assert.deepEqual(missingMore, layout(DEFAULT_VISIBLE, DEFAULT_MORE));

	// A CUSTOM order survives; the gap is the only thing filled. Library lands
	// after its default predecessor (Aida), and the folded ids keep their fold.
	const custom = sanitizeSidebarLayout({
		visible: ["browser", "aida"],
		more: ["mesh"],
	});
	assert.deepEqual(
		custom,
		layout(
			["browser", "aida", "library", "projects", "agents", "schedules"],
			["team-bridge", "agent-hub", "mesh"],
		),
	);
});

test("sanitize puts a missing id back in its DEFAULT region", () => {
	// A layout whose visible region is empty names none of the six visible
	// destinations. They return to visible (where they default), not to More:
	// inheriting the fold from a corrupt document would let one missing id
	// rearrange the column for a different one.
	const result = sanitizeSidebarLayout({ visible: [], more: ["mesh"] });
	assert.deepEqual(result, layout(DEFAULT_VISIBLE, DEFAULT_MORE));
});

test("sanitize drops unknown ids and de-duplicates, first occurrence wins", () => {
	const result = sanitizeSidebarLayout({
		visible: ["aida", "aida", "bogus", "library", null, 42],
		more: ["library", "mesh", "mesh"],
	});
	assert.deepEqual(result, layout(DEFAULT_VISIBLE, DEFAULT_MORE));
	// `library` was in both regions; the visible one won and the more one was
	// dropped, rather than the id appearing twice.
	assert.equal(result.visible.filter((id) => id === "library").length, 1);
	assert.equal(result.more.filter((id) => id === "library").length, 0);
});

test("isSidebarDestinationId narrows only known ids", () => {
	assert.equal(isSidebarDestinationId("aida"), true);
	assert.equal(isSidebarDestinationId("team-bridge"), true);
	assert.equal(isSidebarDestinationId("Agent hub"), false);
	assert.equal(isSidebarDestinationId("bogus"), false);
	assert.equal(isSidebarDestinationId(null), false);
	assert.equal(isSidebarDestinationId(7), false);
});

test("regionOf reports the stored region", () => {
	const value = sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT);
	assert.equal(regionOf(value, "aida"), "visible");
	assert.equal(regionOf(value, "browser"), "visible");
	assert.equal(regionOf(value, "mesh"), "more");
});

test("renderedRegion filters unavailable ids without rewriting the layout", () => {
	const value = layout([...DEFAULT_VISIBLE], [...DEFAULT_MORE]);
	const available = new Set([
		"aida",
		"projects",
		"agents",
		"schedules",
		"browser",
		"agent-hub",
	]);
	assert.deepEqual(renderedRegion(value, "visible", available), [
		"aida",
		"projects",
		"agents",
		"schedules",
		"browser",
	]);
	assert.deepEqual(renderedRegion(value, "more", available), ["agent-hub"]);
	// The stored layout is untouched.
	assert.deepEqual(value.visible, DEFAULT_VISIBLE);
});

test("moveWithinRegion swaps rendered neighbours inside one region", () => {
	const value = sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT);
	const moved = moveWithinRegion(value, "agents", -1, ALL);
	assert.deepEqual(moved?.visible, [
		"aida",
		"library",
		"agents",
		"projects",
		"schedules",
		"browser",
	]);
	assert.deepEqual(moved?.more, DEFAULT_MORE);
	// The untouched region is a COPY, so a later edit to one result cannot reach
	// the starting layout (or, on the failed-read path, the shared default).
	assert.notEqual(moved.more, value.more);
	moved.more.push("aida");
	assert.deepEqual(value.more, DEFAULT_MORE);

	// The regions are independent: moving the first visible id up is a boundary.
	assert.equal(moveWithinRegion(value, "aida", -1, ALL), null);
	assert.equal(moveWithinRegion(value, "browser", 1, ALL), null);
	assert.equal(moveWithinRegion(value, "mesh", 1, ALL), null);
	assert.equal(moveWithinRegion(value, "team-bridge", -1, ALL), null);
});

test("moveWithinRegion skips an unavailable id and keeps its stored slot", () => {
	const value = layout(
		["aida", "library", "projects", "agents"],
		["team-bridge"],
	);
	const available = new Set(["aida", "projects", "agents", "team-bridge"]);
	// Rendered visible order is aida, projects, agents - so `agents` up crosses
	// `projects`, not `library`. The unavailable row keeps index 1.
	const moved = moveWithinRegion(value, "agents", -1, available);
	assert.deepEqual(moved?.visible, ["aida", "library", "agents", "projects"]);

	// Moving the unavailable id itself cannot happen; a menu would be disabled.
	assert.equal(moveWithinRegion(value, "library", 1, available), null);

	// Crossing a whole run of unavailable rows still swaps only the two
	// rendered neighbours.
	const run = layout(["aida", "library", "projects"], ["mesh"]);
	const movedRun = moveWithinRegion(
		run,
		"projects",
		-1,
		new Set(["aida", "projects"]),
	);
	assert.deepEqual(movedRun?.visible, ["projects", "library", "aida"]);
});

test("moveToRegion appends across the fold", () => {
	const value = sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT);
	const toMore = moveToRegion(value, "browser", "more");
	assert.deepEqual(toMore.visible, [
		"aida",
		"library",
		"projects",
		"agents",
		"schedules",
	]);
	assert.deepEqual(toMore.more, [
		"team-bridge",
		"agent-hub",
		"mesh",
		"browser",
	]);

	const toVisible = moveToRegion(value, "team-bridge", "visible");
	assert.deepEqual(toVisible.visible, [...DEFAULT_VISIBLE, "team-bridge"]);
	assert.deepEqual(toVisible.more, ["agent-hub", "mesh"]);
});

test("placeInRegion inserts before a rendered row across the boundary", () => {
	const value = sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT);
	const placed = placeInRegion(
		value,
		"team-bridge",
		"visible",
		"projects",
		ALL,
	);
	assert.deepEqual(placed?.visible, [
		"aida",
		"library",
		"team-bridge",
		"projects",
		"agents",
		"schedules",
		"browser",
	]);
	assert.deepEqual(placed?.more, ["agent-hub", "mesh"]);

	// Insertion goes before the anchor's STORED index, so an unavailable row
	// between the previous rendered row and the anchor keeps its slot.
	const gapped = layout(["aida", "library", "projects"], ["mesh"]);
	const placedGapped = placeInRegion(
		gapped,
		"mesh",
		"visible",
		"projects",
		new Set(["aida", "projects", "mesh"]),
	);
	assert.deepEqual(placedGapped?.visible, [
		"aida",
		"library",
		"mesh",
		"projects",
	]);
});

test("placeInRegion appends at the end when beforeId is null", () => {
	const value = sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT);
	const placed = placeInRegion(value, "aida", "more", null, ALL);
	assert.deepEqual(placed?.visible, [
		"library",
		"projects",
		"agents",
		"schedules",
		"browser",
	]);
	assert.deepEqual(placed?.more, ["team-bridge", "agent-hub", "mesh", "aida"]);

	// The same null target on the visible region puts it after Browser.
	const toVisible = placeInRegion(value, "mesh", "visible", null, ALL);
	assert.deepEqual(toVisible?.visible, [...DEFAULT_VISIBLE, "mesh"]);
});

test("placeInRegion refuses a point it cannot honour", () => {
	const value = sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT);
	// Not in the target region: refusing an unavailable id is the same class of
	// stale-rendered-list error, and both answer null.
	assert.equal(placeInRegion(value, "aida", "visible", "mesh", ALL), null);
	// The anchor is in the region but unavailable, so it was never drawn.
	assert.equal(
		placeInRegion(value, "aida", "visible", "library", new Set(["aida"])),
		null,
	);
	// Dropping a row before itself is a no-op, not an invalid point.
	const self = placeInRegion(value, "projects", "visible", "projects", ALL);
	assert.deepEqual(self, value);
	assert.equal(layoutEquals(self, value), true);
});

test("layoutEquals is order-sensitive and region-sensitive", () => {
	const base = sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT);
	assert.equal(
		layoutEquals(base, sanitizeSidebarLayout(DEFAULT_SIDEBAR_LAYOUT)),
		true,
	);
	assert.equal(
		layoutEquals(base, layout([...DEFAULT_VISIBLE].reverse(), DEFAULT_MORE)),
		false,
	);
	assert.equal(
		layoutEquals(
			base,
			layout(
				["aida", "library", "projects", "agents", "schedules"],
				["browser", ...DEFAULT_MORE],
			),
		),
		false,
	);
});
