/**
 * The chat sidebar's split: which regions are on screen, how tall the chats
 * list is, which edge the boundary sits on, and whether it may be dragged.
 *
 * WHY THIS FILE EXISTS, in the words `sidebar-catalogue-gate.test.mjs` beside it
 * already uses: the decision is a handful of numbers and booleans wide, and a
 * JSX condition is a decision no test can reach - `pnpm test:desktop` bundles
 * shipped TypeScript in memory rather than rendering the component. So the
 * sidebar's decisions live in `src/renderer/src/features/chat/sidebar-split.ts`
 * and the separator's axis arithmetic in
 * `src/renderer/src/shared/components/common/resizable-divider-geometry.ts`,
 * BOTH the shipped modules, bundled here in memory, and both of them driven
 * directly.
 *
 * WHAT THIS FILE CANNOT PIN, and where each is covered instead: the pointer
 * lifecycle (the CDP drag scene, `docs/design/sidebar-sections.md` § 7.3), the
 * bubbling order of the panel's own arrow walk against the separator's keys
 * (the QA matrix, § 9 A7 - a unit test cannot reach a bubbling order), and what
 * the resolved layout LOOKS like (the committed frames, § 7.1). The two are
 * meant to be read together: this file says the decision is right, the frames
 * say it looks right.
 *
 * The cases below are the design document's § 8 matrix, in its order.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const splitBundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/features/chat/sidebar-split";',
		resolveDir: ROOT,
	},
	/*
	 * The path aliases, resolved the way the app's own build resolves them.
	 * Nothing is substituted beyond where a module LIVES: the separator's axis
	 * arithmetic is bundled from the shipped module rather than re-implemented
	 * here, which is the whole point of the two sharing one file.
	 */
	alias: {
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared": `${ROOT}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	autoRegionCap,
	clampRegion,
	dragTarget,
	growSign,
	hideRegion,
	keyboardTarget,
	parseSidebarListHeight,
	parseSidebarOrder,
	parseSidebarRegions,
	resolveSidebarSplit,
	SIDEBAR_AUTO_MAX_FRACTION,
	SIDEBAR_MIN_REGION_PX,
	SIDEBAR_SPLIT_OFFERED_PX,
} = await import(
	`data:text/javascript;base64,${Buffer.from(splitBundle.outputFiles[0].text).toString("base64")}`
);

/**
 * The inputs, with a healthy default for each: a split that is offered, both
 * regions stored visible, no query, and a panel tall enough that every bound
 * below is the interesting one rather than a clamp.
 */
const inputs = (over = {}) => ({
	regions: "both",
	listHeight: null,
	order: "entities-first",
	showList: true,
	query: false,
	capacity: 800,
	drawnListHeight: 200,
	panelContentHeight: 900,
	...over,
});

const visibility = (regions) => {
	const out = resolveSidebarSplit(inputs({ regions }));
	return { entityVisible: out.entityVisible, listVisible: out.listVisible };
};

/* 1. Region resolution ---------------------------------------------------- */

test("each stored region state resolves to the pair of visibilities it names", () => {
	assert.deepEqual(visibility("both"), {
		entityVisible: true,
		listVisible: true,
	});
	assert.deepEqual(visibility("entities"), {
		entityVisible: true,
		listVisible: false,
	});
	assert.deepEqual(visibility("chats"), {
		entityVisible: false,
		listVisible: true,
	});
});

test("the region union is exhausted by its three values", () => {
	// The switch that does not exist: every other value is asserted to land on
	// the one that shows everything, so a fourth state cannot arrive unnoticed.
	for (const value of [
		undefined,
		null,
		"neither",
		"entities-first",
		"",
		7,
		{},
		[],
		true,
	]) {
		assert.equal(
			parseSidebarRegions(value),
			"both",
			`${JSON.stringify(value)} is not one of the three`,
		);
	}
	for (const value of ["both", "entities", "chats"]) {
		assert.equal(parseSidebarRegions(value), value);
	}
});

/* 2. The invariant -------------------------------------------------------- */

test("no reachable input yields neither region visible", () => {
	// Every press there is, from every state there is: "hide this one" is the
	// singleton that hides it, so the empty column is unrepresentable rather
	// than guarded against.
	for (const start of ["both", "entities", "chats"]) {
		for (const region of ["entities", "chats"]) {
			const next = hideRegion(start, region);
			assert.ok(
				["both", "entities", "chats"].includes(next),
				`hiding ${region} from ${start} produced ${next}`,
			);
			const out = resolveSidebarSplit(inputs({ regions: next }));
			assert.ok(
				out.entityVisible || out.listVisible,
				`hiding ${region} from ${start} left the column empty`,
			);
		}
	}
});

test("hiding the visible region while the other is hidden shows the other", () => {
	// S8's stated consequence: the press is never refused, it does the only
	// sensible thing left.
	assert.equal(hideRegion("entities", "entities"), "chats");
	assert.equal(hideRegion("chats", "chats"), "entities");
	// And a press on a region that is already hidden leaves what is on screen
	// where it is, rather than emptying the column.
	assert.equal(hideRegion("chats", "entities"), "chats");
	assert.equal(hideRegion("entities", "chats"), "entities");
});

/* 3. Query override ------------------------------------------------------- */

test("a query renders both regions and writes nothing", () => {
	for (const stored of ["both", "entities", "chats"]) {
		const out = resolveSidebarSplit(
			inputs({ regions: stored, query: true, listHeight: 300 }),
		);
		assert.equal(out.entityVisible, true, `${stored}: entities must render`);
		assert.equal(out.listVisible, true, `${stored}: the list must render`);
		assert.equal(out.regions, stored, "the stored value is echoed unchanged");
		assert.equal(out.listHeight, 300, "a stored height is echoed unchanged");
		assert.equal(out.restore, null, "no restore row while a query is up");
		/*
		 * The BOUNDARY is the half that would pass while being broken: a regression
		 * returning `divider: null` through a query would still draw both regions
		 * and still satisfy every assertion above, and the user would have no way to
		 * resize either one for the duration of the search - the component draws the
		 * boundary off exactly this field (review round 1, m-4).
		 */
		assert.notEqual(
			out.divider,
			null,
			`${stored}: the boundary survives a query`,
		);
		assert.equal(out.divider.resizable, true, `${stored}: and it is draggable`);
		assert.equal(
			out.divider.value,
			300,
			`${stored}: and it reports the height the user chose`,
		);
	}
});

/* 4. The catalogue gate --------------------------------------------------- */

test("a closed catalogue gate gains no boundary", () => {
	for (const stored of ["both", "entities", "chats"]) {
		const out = resolveSidebarSplit(
			inputs({ regions: stored, showList: false }),
		);
		assert.equal(
			out.divider,
			null,
			`${stored}: the gate must not add a divider`,
		);
		assert.equal(out.entityVisible, true);
		assert.equal(out.listVisible, true);
		assert.equal(out.restore, null);
	}
});

/* 5. Auto ---------------------------------------------------------------- */

test("auto stays auto, and the divider reports the height it was given", () => {
	const out = resolveSidebarSplit(
		inputs({ listHeight: null, drawnListHeight: 263 }),
	);
	assert.equal(out.listHeight, null, "null is passed through, not replaced");
	assert.equal(
		out.divider.value,
		263,
		"the measured height, not an invented one",
	);
	// A tampered stored value is no height at all, which is the auto rule.
	const tampered = resolveSidebarSplit(
		inputs({ listHeight: "369px", drawnListHeight: 263 }),
	);
	assert.equal(tampered.listHeight, null);
	assert.equal(tampered.divider.value, 263);
});

/* 6. Clamp arithmetic ----------------------------------------------------- */

test("the divider's range is the panel's", () => {
	const out = resolveSidebarSplit(inputs({ capacity: 800, listHeight: 500 }));
	assert.equal(out.divider.min, SIDEBAR_MIN_REGION_PX);
	assert.equal(out.divider.max, 800 - SIDEBAR_MIN_REGION_PX);
	assert.equal(out.divider.resizable, true);
	assert.equal(out.divider.value, 500);
});

test("a stored value is clamped for the render and echoed unchanged", () => {
	const above = resolveSidebarSplit(inputs({ capacity: 300, listHeight: 900 }));
	assert.equal(above.divider.value, 300 - SIDEBAR_MIN_REGION_PX);
	assert.equal(above.listMax, 300 - SIDEBAR_MIN_REGION_PX);
	assert.equal(
		above.listHeight,
		900,
		"the stored value survives the render clamp",
	);

	const below = resolveSidebarSplit(inputs({ capacity: 300, listHeight: 20 }));
	assert.equal(below.divider.value, SIDEBAR_MIN_REGION_PX);
	assert.equal(below.listHeight, 20);
});

test("below two floors the range collapses onto what is drawn, and a write is refused", () => {
	const out = resolveSidebarSplit(
		inputs({ capacity: SIDEBAR_SPLIT_OFFERED_PX - 1, listHeight: 120 }),
	);
	assert.equal(out.divider.resizable, false);
	assert.equal(out.divider.min, out.divider.value);
	assert.equal(out.divider.max, out.divider.value);
	// The collapse is not a lie about a range: the separator announces the one
	// value it is drawn at.
	assert.equal(out.divider.min, out.divider.max);
});

test("below two floors in AUTO, the announced value is what is drawn", () => {
	/*
	 * The stored case above announces the clamped stored height, which IS what
	 * the render applies. AUTO is not the same question: there the render applies
	 * `autoRegionCap`, which at capacity 100 is 28, while the clamp of the drawn
	 * height to the floor is 72 - so announcing the clamp promises 44px the
	 * layout does not have. Probed at 100/140/143 before the fix (review round 1,
	 * m-3).
	 */
	for (const [capacity, expected] of [
		[100, 28],
		[140, 68],
		[143, 71],
	]) {
		const out = resolveSidebarSplit(
			inputs({
				capacity,
				listHeight: null,
				drawnListHeight: expected,
				panelContentHeight: 900,
			}),
		);
		assert.equal(
			out.divider.resizable,
			false,
			`capacity ${capacity} is below the offer`,
		);
		assert.equal(
			out.divider.value,
			expected,
			`capacity ${capacity} announces the drawn height`,
		);
		assert.equal(out.divider.min, expected);
		assert.equal(out.divider.max, expected);
	}
	/*
	 * And a stored height still announces the clamp, because that is the number
	 * the render applies to a `shrink-0` region with the same cap - the store's
	 * value survives untouched either way.
	 */
	const stored = resolveSidebarSplit(
		inputs({ capacity: 143, listHeight: 900, panelContentHeight: 900 }),
	);
	assert.equal(stored.divider.value, SIDEBAR_MIN_REGION_PX);
	assert.equal(stored.listHeight, 900);
});

test("one region hidden means no boundary, and a restore row for the other", () => {
	const entities = resolveSidebarSplit(inputs({ regions: "entities" }));
	assert.equal(entities.listVisible, false);
	assert.equal(entities.divider, null);
	assert.equal(entities.restore, "chats");

	const chats = resolveSidebarSplit(inputs({ regions: "chats" }));
	assert.equal(chats.entityVisible, false);
	assert.equal(chats.divider, null);
	assert.equal(chats.restore, "entities");
});

/* 7. Tamper --------------------------------------------------------------- */

test("a tampered blob is discarded, never coerced", () => {
	// The two that look coercible are the point: a hand-edited blob holding
	// "369" or "369px" must not become a height the user never chose.
	for (const value of [
		"369px",
		"369",
		Number.NaN,
		Number.POSITIVE_INFINITY,
		-1,
		0,
		1e9,
		{},
		[],
		true,
		undefined,
	]) {
		assert.equal(
			parseSidebarListHeight(value),
			null,
			`${String(value)} must be no height at all`,
		);
	}
	assert.equal(
		parseSidebarListHeight(null),
		null,
		"auto is a first-class state",
	);
	assert.equal(parseSidebarListHeight(372), 372);
	assert.equal(parseSidebarListHeight(300.5), 300.5);
});

test("a tampered order falls back to the one that renders the panel as it was", () => {
	for (const value of [
		undefined,
		null,
		"chats-first-up",
		"ENTITIES-FIRST",
		1,
		{},
	]) {
		assert.equal(parseSidebarOrder(value), "entities-first");
	}
	assert.equal(parseSidebarOrder("chats-first"), "chats-first");
});

/* 8. Small window --------------------------------------------------------- */

test("one stored height resolves differently at three capacities", () => {
	const stored = 500;
	const tall = resolveSidebarSplit(
		inputs({ capacity: 800, listHeight: stored }),
	);
	const short = resolveSidebarSplit(
		inputs({ capacity: 400, listHeight: stored }),
	);
	const tiny = resolveSidebarSplit(
		inputs({ capacity: SIDEBAR_SPLIT_OFFERED_PX - 1, listHeight: stored }),
	);
	// Three different render requirements from ONE stored number, which is the
	// case a single-capacity test passes by accident.
	assert.equal(tall.divider.value, 500);
	assert.equal(short.divider.value, 400 - SIDEBAR_MIN_REGION_PX);
	assert.equal(tiny.divider.resizable, false);
	assert.equal(short.listHeight, stored, "the preference is not rewritten");
	assert.equal(tiny.listHeight, stored);
});

test("the auto cap is the shipped fraction of the panel, bounded by the split's floor", () => {
	const panel = 900;
	assert.equal(autoRegionCap(panel, 800), SIDEBAR_AUTO_MAX_FRACTION * panel);
	// The floor term wins only when the panel cannot host both floors, and it
	// never goes negative - a negative max-height is a dropped declaration, so
	// the guard is what stops the region rendering uncapped in that window.
	assert.equal(autoRegionCap(panel, 400), 400 - SIDEBAR_MIN_REGION_PX);
	assert.equal(autoRegionCap(panel, 100), 28);
	assert.equal(autoRegionCap(panel, 72), 0);
	assert.equal(autoRegionCap(0, 800), 0);
});

test("an unmeasured panel leaves the shipped class in charge rather than collapsing", () => {
	// The frame before the layout effect runs. A cap of 0 here would draw the
	// region at zero height and then jump, which is the reflow the measurement
	// is a layout effect to avoid; `null` says "no inline cap".
	const out = resolveSidebarSplit(
		inputs({ capacity: 0, panelContentHeight: 0 }),
	);
	assert.equal(out.listMax, null);
	const measured = resolveSidebarSplit(
		inputs({ capacity: 800, panelContentHeight: 900 }),
	);
	assert.equal(typeof measured.listMax, "number");
});

test("a region alone in the column fills it rather than being capped", () => {
	// Found by LOOKING at the `chats-only` frame rather than by a test: the auto
	// cap and the region's `flex-1` disagreed and the cap won, so the list drew
	// at 45% of the panel with a third of the column empty under it. A solo
	// region carries no inline cap and no forced height, and a stored height
	// waits for the split to come back rather than shrinking it.
	const auto = resolveSidebarSplit(inputs({ regions: "chats" }));
	assert.equal(auto.listVisible, true);
	assert.equal(auto.entityVisible, false);
	assert.equal(auto.listMax, null);
	assert.equal(auto.listFixed, false);

	const stored = resolveSidebarSplit(
		inputs({ regions: "chats", listHeight: 500 }),
	);
	assert.equal(stored.listMax, null, "a solo region is not sized by the store");
	assert.equal(stored.listFixed, false);
	assert.equal(stored.listHeight, 500, "and the preference is still echoed");
	// The split, by contrast, IS sized - the case the two coexist in.
	const both = resolveSidebarSplit(inputs({ listHeight: 500 }));
	assert.equal(both.listMax, 500);
	assert.equal(both.listFixed, true);
});

/* 9. Grow sign ------------------------------------------------------------ */

test("the sign, and the drag arithmetic, for all four sides", () => {
	assert.equal(growSign("right"), 1);
	assert.equal(growSign("bottom"), 1);
	assert.equal(growSign("left"), -1);
	assert.equal(growSign("top"), -1);

	// The same 40px of pointer travel, on each edge of each axis: the size grows
	// when the handle moves away from the panel's anchored edge.
	assert.equal(dragTarget(100, 40, "right", 0, 1000), 140);
	assert.equal(dragTarget(100, 40, "bottom", 0, 1000), 140);
	assert.equal(dragTarget(100, 40, "left", 0, 1000), 60);
	assert.equal(dragTarget(100, 40, "top", 0, 1000), 60);

	// And the same call is what clamps, at both ends, on both axes.
	assert.equal(dragTarget(100, 5000, "right", 72, 300), 300);
	assert.equal(dragTarget(100, -5000, "right", 72, 300), 72);
	assert.equal(dragTarget(100, 5000, "top", 72, 300), 72);
	assert.equal(dragTarget(100, -5000, "bottom", 72, 300), 72);
	assert.equal(clampRegion(500, 72, 300), 300);
});

test("the boundary sits on the list region's top edge, and follows the order", () => {
	assert.equal(
		resolveSidebarSplit(inputs({ order: "entities-first" })).side,
		"top",
	);
	assert.equal(
		resolveSidebarSplit(inputs({ order: "chats-first" })).side,
		"bottom",
	);
});

/* 10. Key map ------------------------------------------------------------- */

test("the key map, asserted against the clamped write rather than a constant", () => {
	const min = SIDEBAR_MIN_REGION_PX;
	const max = 300;
	const write = (key, { shiftKey = false, value = 200, side = "top" } = {}) =>
		keyboardTarget(key, { shiftKey, value, min, max, side });

	// Horizontal: the sized region is BELOW the boundary, so the arrow that
	// moves the boundary up makes the region taller.
	assert.equal(write("ArrowUp"), 216);
	assert.equal(write("ArrowDown"), 184);
	assert.equal(write("ArrowUp", { shiftKey: true }), 264);
	assert.equal(write("ArrowDown", { shiftKey: true }), 136);
	// Home is the axis's start: the handle at the top is the region at its
	// tallest, and End is the mirror.
	assert.equal(write("Home"), max);
	assert.equal(write("End"), min);
	assert.equal(
		write("Enter"),
		null,
		"Enter is the caller's default, not a size",
	);
	// The axis is MATCHED, which is what leaves the panel's own arrow walk its
	// keys: a horizontal handle does not own Left/Right.
	assert.equal(write("ArrowLeft"), undefined);
	assert.equal(write("ArrowRight"), undefined);
	assert.equal(write("Tab"), undefined);

	// The vertical handle is the shipped map, unchanged, on a right-anchored
	// sidebar: Right widens, Left narrows, Home is the minimum.
	const vertical = (key, { shiftKey = false, value = 200 } = {}) =>
		keyboardTarget(key, { shiftKey, value, min, max, side: "right" });
	assert.equal(vertical("ArrowRight"), 216);
	assert.equal(vertical("ArrowLeft"), 184);
	assert.equal(vertical("ArrowRight", { shiftKey: true }), 264);
	assert.equal(vertical("Home"), min);
	assert.equal(vertical("End"), max);
	assert.equal(vertical("Enter"), null);
	assert.equal(
		vertical("ArrowUp"),
		undefined,
		"a vertical handle keeps Up/Down",
	);
	assert.equal(vertical("ArrowDown"), undefined);

	// The write is the CLAMPED one, not the raw step: a press at the bound
	// stays at the bound rather than stepping past it.
	assert.equal(write("ArrowUp", { value: max }), max);
	assert.equal(vertical("ArrowRight", { value: max }), max);
	assert.equal(write("ArrowDown", { value: min }), min);
	assert.equal(vertical("ArrowLeft", { value: min }), min);

	// A left-anchored panel is the mirror of the right-anchored one, which is
	// the half a direction error would ship inverted.
	const left = (key, { value = 200 } = {}) =>
		keyboardTarget(key, { shiftKey: false, value, min, max, side: "left" });
	assert.equal(left("ArrowRight"), 184);
	assert.equal(left("ArrowLeft"), 216);
	assert.equal(left("Home"), max);
	assert.equal(left("End"), min);
});
