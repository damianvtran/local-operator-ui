import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE JUMP'S TWO HALVES, DRIVEN: the ensure-loaded loop against fakes, and
 * the reveal → centre → highlight leg against a real jsdom DOM whose gated
 * layers open through real click handlers, exactly as the collapse tiers do
 * through React (a handler that mounts the next layer is what a Disclosure's
 * press does one commit later; here it is synchronous, and the walk's rAF
 * still supplies the frame).
 *
 * What this file exists to pin: the loop's budgets (pages AND mounted rows)
 * and its stop conditions; that the reveal opens ONLY a collapsed gate that
 * NAMES the target (a visible row is not expanded around); that the
 * `:not([data-turn-summary])` disambiguation finds the row rather than the bar
 * carrying its id; that the centre scroll is the region helper's arithmetic —
 * on a monkey-patched rect, because jsdom has no layout; and that the landing
 * flash is set and cleared on the module's own timer.
 *
 * The arithmetic's own terms are pinned separately, against stubs, in
 * `scroll-region-to-top.test.mjs` (the centre sibling's cases are at its
 * end); this file checks the integration, not each term.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/reveal-record"; export { isRecordPresent, isRecordReachable, jumpToFailedRow, prefersReducedMotion, revealRecord } from "./src/renderer/src/features/chat/canonical/failed-row-jump";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});

/*
 * A bootstrap DOM before the import: the bundle's module scope touches
 * `window` at call time rather than import time, but installing the globals
 * first is the harness the sibling suites all use and it costs nothing.
 */
const bootstrap = new JSDOM("<!doctype html><div></div>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
const text = bundle.outputFiles[0].text;
const {
	ensureReachable,
	jumpToEntry,
	paintJumpHighlight,
	isRecordPresent,
	isRecordReachable,
	jumpToFailedRow,
	JUMP_HIGHLIGHT_ATTR,
	JUMP_HIGHLIGHT_MS,
	JUMP_MAX_PAGES,
	JUMP_MAX_MOUNTED_ROWS,
} = await import(
	`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`
);

/** A DOM for one case: the region, the transcript root, and the shims used. */
function makeDom(body) {
	const dom = new JSDOM(
		`<!doctype html><div id="region"><div id="root">${body}</div></div>`,
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	const { window } = dom;
	window.matchMedia = (query) => ({
		matches: false,
		media: query,
		addListener() {},
		removeListener() {},
		addEventListener() {},
		removeEventListener() {},
	});
	globalThis.window = window;
	globalThis.document = window.document;
	return {
		window,
		region: window.document.getElementById("region"),
		root: window.document.getElementById("root"),
	};
}

/** Give an element the geometry the region helpers read, jsdom having none. */
const measure = (element, { top = 0, height = 0 } = {}) => {
	element.getBoundingClientRect = () => {
		const rect = {
			top,
			height,
			bottom: top + height,
			left: 0,
			right: 0,
			width: 0,
			x: 0,
			y: top,
			toJSON() {},
		};
		return rect;
	};
	element.getClientRects = () => [element.getBoundingClientRect()];
};

/** A scroll region parked at `scroll` with a visible height, as jsdom cannot. */
const regionAt = (region, { scroll, top, clientTop = 0, clientHeight }) => {
	Object.defineProperty(region, "scrollTop", { value: scroll, writable: true });
	Object.defineProperty(region, "clientTop", { value: clientTop });
	Object.defineProperty(region, "clientHeight", { value: clientHeight });
	measure(region, { top, height: clientHeight });
};

/*
 * THE LOOP. `ensureReachable` takes every moving part as a callback, so the
 * cases below drive it with state machines rather than DOM: what is pinned is
 * the ORDER of decisions (load before mount, mount before settle) and the
 * budgets, not the wiring (that is `canonical-transcript.tsx`'s, and QA
 * drives it in the app).
 */

test("the loop loads pages until the row is in the model, then mounts to it", async () => {
	const state = { reachable: false, rowAt: null, loaded: 0, mounts: [] };
	const result = await ensureReachable({
		isReachable: () => state.reachable,
		rowDistance: () => state.rowAt,
		mount: (distance) => {
			state.mounts.push(distance);
			state.reachable = true;
		},
		loadOlder: async () => {
			state.loaded += 1;
			if (state.loaded === 2) state.rowAt = 3;
			return true;
		},
	});
	assert.equal(result, true);
	assert.equal(state.loaded, 2, "two pages were needed, not more");
	assert.deepEqual(state.mounts, [3], "mounted by the row's own distance");
});

test("a page-leading target fetches its margin's page before mounting (QA Q-2)", async () => {
	/*
	 * The row arrives as the store's OLDEST row - the leading row of the page
	 * that fetched it - and mounting it there centres clamped at the content's
	 * top (QA Q-2: -254 px, the first ~8 rows of every fetched page). The
	 * margin callback reports the shortfall, the loop spends ONE more page of
	 * its existing budget, and the mount follows once the margin exists.
	 */
	const state = {
		reachable: false,
		rowAt: null,
		loaded: 0,
		margin: false,
		mounts: [],
	};
	const result = await ensureReachable({
		isReachable: () => state.reachable,
		rowDistance: () => state.rowAt,
		hasHeadroom: () => state.margin,
		mount: (distance) => {
			state.mounts.push(distance);
			state.reachable = true;
		},
		loadOlder: async () => {
			state.loaded += 1;
			// The fetching page lands the row as the store's leader: no margin.
			if (state.loaded === 1) state.rowAt = 40;
			// The margin's page lands the older rows above it.
			if (state.loaded === 2) state.margin = true;
			return true;
		},
	});
	assert.equal(result, true);
	assert.equal(
		state.loaded,
		2,
		"the margin is one page of history, not a poll",
	);
	assert.deepEqual(
		state.mounts,
		[40],
		"the mount stays the row's distance; the margin is rows, not window",
	);
});

test("a margin the store never grows spends the page budget once, then mounts (N1)", async () => {
	/*
	 * The spent-budget edge: the row is in the store, the margin callback keeps
	 * reporting short, and the loop spends its pages then falls through to the
	 * mount rather than looping forever. One mount, one refusal-free return.
	 */
	const state = { loaded: 0, mounts: [] };
	const result = await ensureReachable({
		isReachable: () => state.mounts.length > 0,
		rowDistance: () => 40,
		hasHeadroom: () => false,
		mount: (distance) => state.mounts.push(distance),
		loadOlder: async () => {
			state.loaded += 1;
			return true;
		},
	});
	assert.equal(result, true);
	assert.equal(
		state.loaded,
		JUMP_MAX_PAGES,
		"exactly the page budget, then the fall-through",
	);
	assert.deepEqual(state.mounts, [40], "one mount, not a spin");
});

test("a margin that cannot grow falls through to the clamped mount, never a refusal", async () => {
	/*
	 * The row IS in the store; a refused page means the history ends at it, so
	 * the landing is clamped at the content's top - which, at the start of
	 * history, is where the row is. Refusing the jump would be the -254 px
	 * finding turned into a dead end.
	 */
	const state = { rowAt: 40, loaded: 0, mounts: [] };
	const result = await ensureReachable({
		isReachable: () => state.mounts.length > 0,
		rowDistance: () => state.rowAt,
		hasHeadroom: () => false,
		mount: (distance) => state.mounts.push(distance),
		loadOlder: async () => {
			state.loaded += 1;
			return false;
		},
	});
	assert.equal(
		result,
		true,
		"a row the store holds must land (clamped), not refuse",
	);
	assert.deepEqual(state.mounts, [40]);
	assert.equal(state.loaded, 1, "one attempt, then the mount");
});

test("a row beyond the mount budget is refused without loading or mounting", async () => {
	const state = { loaded: 0, mounts: [] };
	const result = await ensureReachable({
		isReachable: () => false,
		rowDistance: () => JUMP_MAX_MOUNTED_ROWS + 50,
		mount: (distance) => {
			state.mounts.push(distance);
		},
		loadOlder: async () => {
			state.loaded += 1;
			return true;
		},
	});
	assert.equal(result, false);
	assert.equal(state.loaded, 0, "the model already knows; nothing to fetch");
	assert.deepEqual(
		state.mounts,
		[],
		"the window was not opened past the budget",
	);
});

test("the page budget bounds a row that never arrives", async () => {
	const state = { loaded: 0 };
	const result = await ensureReachable({
		isReachable: () => false,
		rowDistance: () => null,
		mount: () => {
			throw new Error("mount must not run without a row");
		},
		loadOlder: async () => {
			state.loaded += 1;
			return true;
		},
	});
	assert.equal(result, false);
	assert.equal(
		state.loaded,
		JUMP_MAX_PAGES,
		"exactly the budget, not one more",
	);
});

test("a page that fails to apply stops the loop", async () => {
	const state = { loaded: 0 };
	const result = await ensureReachable({
		isReachable: () => false,
		rowDistance: () => null,
		mount: () => {
			throw new Error("mount must not run without a row");
		},
		loadOlder: async () => {
			state.loaded += 1;
			return state.loaded < 2;
		},
	});
	assert.equal(result, false);
	assert.equal(state.loaded, 2, "the refusing page is the last one asked for");
});

/*
 * THE REVEAL + SCROLL + FLASH. One DOM per case; the bar/fold click handlers
 * mount the next layer, the same event→commit bargain the walk's rAFs are
 * written for.
 */

test("a row behind a collapsed bar: the bar opens, the row centres, the flash lands", async () => {
	const { root, region } = makeDom(`
		<div data-turn-summary data-run-ids="u9 c9" data-record-id="u9">
			<button aria-expanded="false">turn</button>
		</div>
	`);
	/*
	 * THE STUB'S GEOMETRY IS THE TRANSCRIPT'S OWN AXIS (design round 1, D1):
	 * this region is the `flex-col-reverse` scroller, where a legal `scrollTop`
	 * is NEGATIVE (0 at the newest row) - a positive stub value could not exist
	 * on the real box, and the pre-fix helper's `Math.max(0, ...)` clamp was
	 * exactly what this axis exposed. The row opens ABOVE the viewport: region
	 * scrolled to -600, row at -800 in the region's frame.
	 */
	regionAt(region, { scroll: -600, top: 100, clientTop: 1, clientHeight: 600 });
	const trigger = root.querySelector("button");
	let clicks = 0;
	trigger.addEventListener("click", () => {
		clicks += 1;
		// A Disclosure's press flips its OWN trigger, which is what keeps the
		// walk from re-opening the bar on its next pass; model that here.
		trigger.setAttribute("aria-expanded", "true");
		const row = document.createElement("div");
		row.setAttribute("data-record-id", "u9");
		// The row's geometry, known the moment it exists: 500px into the
		// content, 100px tall.
		measure(row, { top: -800, height: 100 });
		root.appendChild(row);
	});

	const timers = [];
	const realSetTimeout = window.setTimeout;
	window.setTimeout = (fn, ms) => {
		timers.push({ fn, ms });
		return timers.length;
	};
	try {
		const outcome = await jumpToEntry(root, region, "u9");
		assert.equal(outcome, "landed");
		assert.equal(clicks, 1, "the bar was opened exactly once");
		// -600 + (-800 - 100 - 1) - (600 - 100) / 2 = -1751, and it must be
		// ALLOWED to land there: clamping at zero is the no-op D1 measured.
		assert.equal(region.scrollTop, -1751, "the row's centre met the region's");
		const row = root.querySelector(
			'[data-record-id="u9"]:not([data-turn-summary])',
		);
		assert.ok(
			row?.hasAttribute(JUMP_HIGHLIGHT_ATTR),
			"the flash is on the row",
		);
		assert.equal(timers.length, 1);
		assert.equal(timers[0].ms, JUMP_HIGHLIGHT_MS);
		timers[0].fn();
		assert.ok(!row?.hasAttribute(JUMP_HIGHLIGHT_ATTR), "and gone on its timer");
	} finally {
		window.setTimeout = realSetTimeout;
	}
});

test("a row behind a bar AND a fold: both open, outermost first", async () => {
	const { root, region } = makeDom(`
		<div data-turn-summary data-run-ids="u9 c9" data-record-id="u9">
			<button aria-expanded="false">turn</button>
		</div>
	`);
	regionAt(region, { scroll: 0, top: 0, clientHeight: 400 });
	const order = [];
	const barTrigger = root.querySelector("button");
	barTrigger.addEventListener("click", () => {
		order.push("bar");
		barTrigger.setAttribute("aria-expanded", "true");
		const fold = document.createElement("div");
		fold.setAttribute("data-fold-ids", "c9");
		const foldTrigger = document.createElement("button");
		foldTrigger.setAttribute("aria-expanded", "false");
		foldTrigger.addEventListener("click", () => {
			order.push("fold");
			foldTrigger.setAttribute("aria-expanded", "true");
			const row = document.createElement("div");
			row.setAttribute("data-record-id", "c9");
			measure(row, { top: 10, height: 10 });
			root.appendChild(row);
		});
		fold.appendChild(foldTrigger);
		root.appendChild(fold);
	});

	const outcome = await jumpToEntry(root, region, "c9");
	assert.equal(outcome, "landed");
	assert.deepEqual(
		order,
		["bar", "fold"],
		"the outer layer opened before the inner",
	);
});

test("a visible row is not expanded around: no gate is touched", async () => {
	const { root, region } = makeDom(`
		<div data-turn-summary data-run-ids="u9 c9" data-record-id="u9">
			<button aria-expanded="true">turn</button>
		</div>
		<div data-record-id="c9"></div>
	`);
	regionAt(region, { scroll: 0, top: 0, clientHeight: 400 });
	let clicks = 0;
	const openTrigger = root.querySelector("button");
	openTrigger.addEventListener("click", () => {
		clicks += 1;
	});
	const outcome = await jumpToEntry(root, region, "c9");
	assert.equal(outcome, "landed");
	assert.equal(clicks, 0, "a completion's answer row must not expand its run");
});

test("an id nothing names resolves as missing, and nothing is flashed", async () => {
	const { root, region } = makeDom('<div data-record-id="u1"></div>');
	regionAt(region, { scroll: 0, top: 0, clientHeight: 400 });
	const outcome = await jumpToEntry(root, region, "nope");
	assert.equal(outcome, "missing");
	assert.equal(root.querySelector(`[${JUMP_HIGHLIGHT_ATTR}]`), null);
});

test("isRecordReachable: the row, its bar, its fold — and the bar's anchor id", () => {
	const { root } = makeDom(`
		<div data-record-id="u1"></div>
		<div data-turn-summary data-run-ids="u2 c2" data-record-id="u2">
			<button aria-expanded="false">turn</button>
		</div>
		<div data-fold-ids="c3"><button aria-expanded="false">fold</button></div>
	`);
	assert.equal(isRecordPresent(root, "u1"), true, "a visible row is present");
	assert.equal(isRecordReachable(root, "u1"), true);
	assert.equal(
		isRecordPresent(root, "u2"),
		false,
		"the bar's own anchor id is NOT the row (it is the bar's record-id)",
	);
	assert.equal(
		isRecordReachable(root, "u2"),
		true,
		"...but a collapsed bar that names it is reachable",
	);
	assert.equal(
		isRecordReachable(root, "c2"),
		true,
		"run-ids containment counts",
	);
	assert.equal(
		isRecordReachable(root, "c3"),
		true,
		"fold-ids containment counts",
	);
	assert.equal(isRecordReachable(root, "missing"), false);
});

test("jumpToFailedRow keeps its platform scroll, reduced-motion aware", async () => {
	const { window, root } = makeDom(`
		<div data-turn-summary data-run-ids="c9" data-record-id="c9">
			<button aria-expanded="false">turn</button>
		</div>
	`);
	const scrolled = [];
	window.Element.prototype.scrollIntoView = function scrollIntoView(options) {
		scrolled.push({ element: this, options });
	};
	root.querySelector("button").addEventListener("click", () => {
		const row = document.createElement("div");
		row.setAttribute("data-record-id", "c9");
		root.appendChild(row);
	});
	jumpToFailedRow(root, "c9");
	await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
	assert.equal(scrolled.length, 1, "the failed row was scrolled to once");
	assert.equal(scrolled[0].element.getAttribute("data-record-id"), "c9");
	assert.equal(scrolled[0].options.block, "center");
	assert.equal(scrolled[0].options.behavior, "smooth");

	// And the same walk under a reduced-motion preference scrolls instantly.
	scrolled.length = 0;
	const second = makeDom(`
		<div data-turn-summary data-run-ids="c9" data-record-id="c9">
			<button aria-expanded="false">turn</button>
		</div>
	`);
	/*
	 * The module reads the GLOBAL window, and `makeDom` swaps it for every
	 * case: the preference has to be installed on the DOM that is global when
	 * the jump runs (the second one), not on the first case's.
	 */
	second.window.matchMedia = (query) => ({
		matches: true,
		media: query,
		addListener() {},
		removeListener() {},
		addEventListener() {},
		removeEventListener() {},
	});
	second.window.Element.prototype.scrollIntoView = function scrollIntoView(
		options,
	) {
		scrolled.push({ element: this, options });
	};
	second.root.querySelector("button").addEventListener("click", () => {
		const row = document.createElement("div");
		row.setAttribute("data-record-id", "c9");
		second.root.appendChild(row);
	});
	jumpToFailedRow(second.root, "c9");
	await new Promise((resolve) =>
		second.window.requestAnimationFrame(() => resolve()),
	);
	assert.equal(scrolled[0].options.behavior, "auto");
});

test("paintJumpHighlight restarts on a repeat instead of clearing early", () => {
	const { window } = makeDom('<div data-record-id="u1"></div>');
	const row = window.document.createElement("div");
	paintJumpHighlight(row);
	assert.ok(row.hasAttribute(JUMP_HIGHLIGHT_ATTR));
	paintJumpHighlight(row);
	assert.ok(
		row.hasAttribute(JUMP_HIGHLIGHT_ATTR),
		"a second jump inside the first window keeps the flash lit",
	);
});
