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

test("a row behind a collapsed bar: the bar opens, the row anchors, the flash lands", async () => {
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
		/*
		 * THE ROW MOVES WITH THE SCROLL. The anchor settle (issue #680)
		 * re-measures over frames, so a static stub would be a page that never
		 * answers a re-apply and the loop would diverge frame by frame instead
		 * of settling. The real contract on this axis: a scroll of `S` places
		 * the row's top at `-1400 - S` (its -600-era position, plus the
		 * distance scrolled - more negative moves content DOWN), so the
		 * geometry is a function of `region.scrollTop`, not a constant.
		 */
		row.getBoundingClientRect = () => {
			const top = -1400 - region.scrollTop;
			return {
				top,
				height: 100,
				bottom: top + 100,
				left: 0,
				right: 0,
				width: 0,
				x: 0,
				y: top,
				toJSON() {},
			};
		};
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
		// The anchor: -600 + (-800 - 100 - 1) - 24 = -1525 puts the row's TOP at
		// the scrollport's top PLUS the top-fade depth (the fixed anchored
		// landing, issue #680 design round 1's D1: the inset is the mask's own
		// depth, so the row sits where the ramp is fully open), and the settle
		// re-measures against a page that moves with the scroll to confirm it.
		// The centring era's -1751 (the row's centre met the region's) is gone
		// by decision.
		assert.equal(
			region.scrollTop,
			-1525,
			"the row's top met the region's top plus the fade depth",
		);
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

/*
 * The settle's two bounds, driven directly: the frame budget, and the reader.
 * Both use a row that NEVER answers the re-measure (a static rect is a page
 * that does not move with the scroll), so the loop cannot converge - which is
 * exactly the shape that proves the bounds rather than the convergence the
 * case above already covers.
 */
test("a page that never answers the re-measure is left after the frame budget", async () => {
	const { root, region } = makeDom(`<div data-record-id="u9"></div>`);
	measure(region, { top: 100, height: 600 });
	Object.defineProperty(region, "clientTop", { value: 1 });
	Object.defineProperty(region, "clientHeight", { value: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	measure(row, { top: -800, height: 100 });
	let assigned = 0;
	let value = -600;
	Object.defineProperty(region, "scrollTop", {
		get: () => value,
		set: (next) => {
			assigned += 1;
			value = next;
		},
	});
	const outcome = await jumpToEntry(root, region, "u9");
	assert.equal(outcome, "landed", "the jump still resolves");
	// The first assignment plus one per frame of the budget (JUMP_SETTLE_FRAMES
	// + 2), and no more: a pathological layout costs frames, not a hang.
	assert.equal(assigned, 1 + 8, "the settle spent its budget and stopped");
});

test("a reader's gesture during the settle stops the re-apply", async () => {
	const { root, region, window } = makeDom(`<div data-record-id="u9"></div>`);
	measure(region, { top: 100, height: 600 });
	Object.defineProperty(region, "clientTop", { value: 1 });
	Object.defineProperty(region, "clientHeight", { value: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	measure(row, { top: -800, height: 100 });
	let assigned = 0;
	let value = -600;
	Object.defineProperty(region, "scrollTop", {
		get: () => value,
		set: (next) => {
			assigned += 1;
			value = next;
		},
	});
	const pending = jumpToEntry(root, region, "u9");
	// The anchor's first assignment and the gesture listeners arm in one task,
	// so waiting for the assignment guarantees the listener can see the wheel.
	for (let i = 0; i < 60 && assigned === 0; i += 1) {
		await new Promise((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
	}
	region.dispatchEvent(new window.Event("wheel"));
	const outcome = await pending;
	assert.equal(outcome, "landed", "the jump still resolves");
	// At most the initial apply plus one frame that was already in flight when
	// the wheel landed; the budget's 1 + 8 would mean the yield was ignored.
	assert.ok(
		assigned <= 2,
		`the loop stopped touching scrollTop (assigned ${assigned})`,
	);
});

test("a scroll key during the settle stops the re-apply (review round 2)", async () => {
	/*
	 * The keyboard arm of the yield set: the rail's own jump is a keyboard
	 * gesture (focus a tick, Enter), so the next press is a scroll key more
	 * often than not - and a settle that ignores it yanks the view out from
	 * under the reader exactly like an ignored wheel would.
	 */
	const { root, region, window } = makeDom(`<div data-record-id="u9"></div>`);
	measure(region, { top: 100, height: 600 });
	Object.defineProperty(region, "clientTop", { value: 1 });
	Object.defineProperty(region, "clientHeight", { value: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	measure(row, { top: -800, height: 100 });
	let assigned = 0;
	let value = -600;
	Object.defineProperty(region, "scrollTop", {
		get: () => value,
		set: (next) => {
			assigned += 1;
			value = next;
		},
	});
	const pending = jumpToEntry(root, region, "u9");
	for (let i = 0; i < 60 && assigned === 0; i += 1) {
		await new Promise((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
	}
	window.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
	);
	const outcome = await pending;
	assert.equal(outcome, "landed", "the jump still resolves");
	assert.ok(
		assigned <= 2,
		`the loop stopped touching scrollTop (assigned ${assigned})`,
	);
});

test("a newer settle supersedes an older one's loop (review round 2)", async () => {
	/*
	 * Two jumps in flight (a rapid tick-then-tick, or a rail jump ahead of a
	 * search hit): A's page never answers the re-measure, so its loop writes
	 * one scrollTop per frame, and B's page settles normally. Without the
	 * generation token A keeps spending its budget alongside B, visibly
	 * contending for the anchor; with it A stops on its next frame check.
	 */
	const { window, region, root } = makeDom(`<div data-record-id="u9"></div>`);
	measure(region, { top: 100, height: 600 });
	Object.defineProperty(region, "clientTop", { value: 1 });
	Object.defineProperty(region, "clientHeight", { value: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	measure(row, { top: -800, height: 100 });
	let assignedA = 0;
	let valueA = -600;
	Object.defineProperty(region, "scrollTop", {
		get: () => valueA,
		set: (next) => {
			assignedA += 1;
			valueA = next;
		},
	});
	const pendingA = jumpToEntry(root, region, "u9");
	for (let i = 0; i < 60 && assignedA === 0; i += 1) {
		await new Promise((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
	}
	/* Let A enter its loop (its first apply plus a couple of frames). */
	for (let i = 0; i < 3; i += 1) {
		await new Promise((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
	}
	const aBefore = assignedA;
	/* B: a second region whose page moves with the scroll, so it settles. */
	const regionB = window.document.createElement("div");
	const rootB = window.document.createElement("div");
	rootB.innerHTML = `<div data-record-id="u8"></div>`;
	regionB.appendChild(rootB);
	window.document.body.appendChild(regionB);
	measure(regionB, { top: 100, height: 600 });
	Object.defineProperty(regionB, "clientTop", { value: 1 });
	Object.defineProperty(regionB, "clientHeight", { value: 600 });
	Object.defineProperty(regionB, "scrollTop", { value: -600, writable: true });
	const rowB = rootB.querySelector('[data-record-id="u8"]');
	rowB.getBoundingClientRect = () => {
		const top = -1400 - regionB.scrollTop;
		return {
			top,
			height: 100,
			bottom: top + 100,
			left: 0,
			right: 0,
			width: 0,
			x: 0,
			y: top,
			toJSON() {},
		};
	};
	const pendingB = jumpToEntry(rootB, regionB, "u8");
	/* Enough frames for a loop that ignored the supersede to spend its budget. */
	for (let i = 0; i < 14; i += 1) {
		await new Promise((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
	}
	const [outA, outB] = await Promise.all([pendingA, pendingB]);
	assert.equal(outA, "landed", "the superseded jump still resolves");
	assert.equal(outB, "landed");
	assert.ok(
		assignedA <= aBefore + 1,
		`the superseded settle stopped touching its region (${aBefore} -> ${assignedA})`,
	);
});

test("a wash stripped mid-settle is re-asserted at the landing (QA round 2)", async () => {
	/*
	 * The fate the QA round measured: a late mount commit replaces the row and
	 * strips the wash before the reader sees it (cold far jumps >1s under load,
	 * 4/4). The settle resolve is the landing, so a target with no wash gets a
	 * fresh one there; this drives the strip explicitly.
	 */
	const { root, region, window } = makeDom(`<div data-record-id="u9"></div>`);
	regionAt(region, { scroll: -600, top: 100, clientTop: 1, clientHeight: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	measure(row, { top: -800, height: 100 });
	const timers = [];
	const realSetTimeout = window.setTimeout;
	window.setTimeout = (fn, ms) => {
		timers.push({ fn, ms });
		return timers.length;
	};
	try {
		const pending = jumpToEntry(root, region, "u9");
		// The wash paints at the reveal; wait for it, then strip it as the mount
		// commit would, while the settle is still running.
		for (let i = 0; i < 60 && !row.hasAttribute(JUMP_HIGHLIGHT_ATTR); i += 1) {
			await new Promise((resolve) =>
				window.requestAnimationFrame(() => resolve()),
			);
		}
		assert.ok(row.hasAttribute(JUMP_HIGHLIGHT_ATTR), "the wash painted first");
		row.removeAttribute(JUMP_HIGHLIGHT_ATTR);
		const outcome = await pending;
		assert.equal(outcome, "landed");
		assert.ok(
			row.hasAttribute(JUMP_HIGHLIGHT_ATTR),
			"the wash is back at the landing",
		);
		assert.equal(timers.length, 2, "a second paint re-armed the timer");
	} finally {
		window.setTimeout = realSetTimeout;
	}
});

test("the settle's resolve asks the rail for one fresh reading (QA round 5)", async () => {
	/*
	 * The settle's later re-applies can write the scrollTop they already hold,
	 * so no scroll event leaves the scroller after the last moving write and the
	 * rail's cue can stay on the pre-landing reading. One synthetic scroll at
	 * the resolve is the re-read; jsdom dispatches no scroll on scrollTop
	 * writes, so the count here is exactly the dispatch's own.
	 */
	const { root, region } = makeDom(`<div data-record-id="u9"></div>`);
	measure(region, { top: 100, height: 600 });
	Object.defineProperty(region, "clientTop", { value: 1 });
	Object.defineProperty(region, "clientHeight", { value: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	measure(row, { top: -800, height: 100 });
	Object.defineProperty(region, "scrollTop", { value: -600, writable: true });
	let scrolls = 0;
	region.addEventListener("scroll", () => {
		scrolls += 1;
	});
	const outcome = await jumpToEntry(root, region, "u9");
	assert.equal(outcome, "landed");
	assert.equal(scrolls, 1, "one scroll event left the region at the landing");
});

test("a reader's gesture superseding the settle gets no synthetic re-read (QA round 5)", async () => {
	const { root, region, window } = makeDom(`<div data-record-id="u9"></div>`);
	measure(region, { top: 100, height: 600 });
	Object.defineProperty(region, "clientTop", { value: 1 });
	Object.defineProperty(region, "clientHeight", { value: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	measure(row, { top: -800, height: 100 });
	let assigned = 0;
	let value = -600;
	Object.defineProperty(region, "scrollTop", {
		get: () => value,
		set: (next) => {
			assigned += 1;
			value = next;
		},
	});
	let scrolls = 0;
	region.addEventListener("scroll", () => {
		scrolls += 1;
	});
	const pending = jumpToEntry(root, region, "u9");
	for (let i = 0; i < 60 && assigned === 0; i += 1) {
		await new Promise((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
	}
	region.dispatchEvent(new window.Event("wheel"));
	const outcome = await pending;
	assert.equal(outcome, "landed");
	assert.equal(
		scrolls,
		0,
		"the reader's own events drive the cue; no synthetic one",
	);
});

test("a stale write after the settle is corrected by the landing guard (QA round 6)", async () => {
	/*
	 * The measured race (short oldest-end, 1/5): the settle resolves on the
	 * anchor, three frames later a pass computed against a stale content height
	 * overwrites it 109px short, and nothing corrects it. The guard watches the
	 * resolved anchor for its bounded window and re-applies against the
	 * CURRENT rects.
	 */
	const { root, region, window } = makeDom(`<div data-record-id="u9"></div>`);
	regionAt(region, { scroll: -600, top: 100, clientTop: 1, clientHeight: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	row.getBoundingClientRect = () => {
		const top = -1400 - region.scrollTop;
		return {
			top,
			height: 100,
			bottom: top + 100,
			left: 0,
			right: 0,
			width: 0,
			x: 0,
			y: top,
			toJSON() {},
		};
	};
	const outcome = await jumpToEntry(root, region, "u9");
	assert.equal(outcome, "landed");
	const anchored = region.scrollTop;
	assert.equal(anchored, -1525, "the settle resolved on the anchor");
	/* The stale writer, 109px short of the anchor (133 against 24). */
	region.scrollTop = anchored + 109;
	for (let i = 0; i < 12; i += 1) {
		await new Promise((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
	}
	assert.equal(region.scrollTop, -1525, "the guard restored the anchor");
});

test("a reader's gesture during the guard stops it (QA round 6)", async () => {
	const { root, region, window } = makeDom(`<div data-record-id="u9"></div>`);
	regionAt(region, { scroll: -600, top: 100, clientTop: 1, clientHeight: 600 });
	const row = root.querySelector('[data-record-id="u9"]');
	row.getBoundingClientRect = () => {
		const top = -1400 - region.scrollTop;
		return {
			top,
			height: 100,
			bottom: top + 100,
			left: 0,
			right: 0,
			width: 0,
			x: 0,
			y: top,
			toJSON() {},
		};
	};
	const outcome = await jumpToEntry(root, region, "u9");
	assert.equal(outcome, "landed");
	/* The reader takes over: the guard must not fight their steering. */
	region.dispatchEvent(new window.Event("wheel"));
	region.scrollTop = -1525 + 109;
	for (let i = 0; i < 12; i += 1) {
		await new Promise((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
	}
	assert.equal(
		region.scrollTop,
		-1525 + 109,
		"the guard left the reader's position alone",
	);
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
