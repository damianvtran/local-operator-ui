import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE DEEP-CLICK JUMP, held against the loader: a tick (or any record) that is
 * NOT in the store when the reader presses it must be FETCHED and landed, and a
 * refusal must mean the budgets really ran out - never that the walk gave up on
 * a reachable row.
 *
 * WHERE THIS COMES FROM, AND WHAT IT DOES NOT OWN. The collapse lane's
 * diagnosis (credited) seeded the fixture this file's numbers are shaped from:
 * eight long turns, 444-604 rows each, ~3,952 rows total, conversation
 * `be1a9fef00a1` - the same shape their `condense-rig` seeds, where the deep
 * clicks below are ~4,096 rows in the journal. Their fix is MODEL-side
 * (end-loaded fold eligibility, keyed on the closing answer; PR #651,
 * `feat/transcript-collapse-unloaded-head`), so the raw-rows/open-condensation
 * case is theirs and NOT pinned here. What this file pins is the JUMP side,
 * which rides `transcript-loader.ts` and its adapter in `reveal-record.ts`:
 * press a deep row, load through the pages between, land.
 *
 * WHY IT IS A HOLDING TEST. The behaviour it pins shipped across two lanes
 * (the shared loader; the rail rework's adapter), and the failure it guards is
 * the one the operator hit before either existed - "Could not reach that turn.
 * It is further back than the loaded history." for a turn that was merely
 * unfetched. If a later change widens the walk's stop conditions or narrows
 * its budgets, the deep-landing case below stops passing; the refusal case
 * keeps the honest arm pinned so the guard cannot be satisfied by refusing
 * everything.
 *
 * `window` is not in node; the modules only touch it inside functions, so the
 * fake is installed before any walk runs and never at import time.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/transcript-loader";\nexport * from "./src/renderer/src/features/chat/canonical/reveal-record";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
});
const { createBackwardLoader, ensureReachable } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

globalThis.window = {
	requestAnimationFrame: (callback) => {
		setTimeout(callback, 0);
		return 0;
	},
};

/**
 * The fixture's shape, in the loader's own units: `pages` pages of `perPage`
 * rows behind the tail, a target `distance` from it, and a render window that
 * starts at the tail's width and widens only through `mount`.
 */
const deepPager = ({
	perPage = 100,
	pages = 8,
	distance,
	headroom = true,
} = {}) => {
	const state = { held: 0, window: 0, loads: 0, mounts: [] };
	return {
		state,
		pager: {
			reachable: () => state.held >= distance && distance <= state.window,
			rowDistance: () => (state.held >= distance ? distance : null),
			mount: (width) => {
				state.mounts.push(width);
				state.window = width;
			},
			loadOlder: async () => {
				state.loads += 1;
				if (state.held >= perPage * pages) return false;
				state.held += perPage;
				return true;
			},
			...(headroom === false
				? { hasHeadroom: () => state.held > distance }
				: {}),
		},
	};
};

test("a deep click lands: seven pages back, fetched through and mounted", async () => {
	/* ~7 pages deep, the depth the fixture's turn-7 completion sits at. */
	const { state, pager } = deepPager({ distance: 700 });
	const landed = await ensureReachable({
		isReachable: pager.reachable,
		rowDistance: pager.rowDistance,
		mount: pager.mount,
		loadOlder: pager.loadOlder,
	});
	assert.equal(landed, true, "a reachable deep row must land, not refuse");
	assert.equal(state.loads, 7, "one page per step of distance");
	assert.deepEqual(state.mounts, [700], "the mount covers exactly the row");
});

test("a PAGE-LEADING deep click still lands (QA Q-2's clamp, at depth)", async () => {
	/*
	 * The leading row of every fetched page has nothing above it, so a
	 * centred landing would clamp at the content's top; the walk fetches the
	 * margin's page instead (the `hasHeadroom` arm).
	 */
	const { state, pager } = deepPager({ distance: 700, headroom: false });
	const landed = await ensureReachable({
		isReachable: pager.reachable,
		rowDistance: pager.rowDistance,
		mount: pager.mount,
		loadOlder: pager.loadOlder,
		hasHeadroom: pager.hasHeadroom,
	});
	assert.equal(landed, true);
	assert.equal(state.loads, 8, "the row's page plus the margin's page");
});

test("the refusal arm stays honest: beyond the row budget is a false", async () => {
	/*
	 * The deep fixture's OLDEST tick is beyond the near path's budget from a
	 * fresh read - that refusal is a shipped sentence, and this keeps the
	 * guard from being satisfied by refusing deep clicks generally.
	 */
	const { pager } = deepPager({ distance: 2400 });
	const landed = await ensureReachable({
		isReachable: pager.reachable,
		rowDistance: pager.rowDistance,
		mount: pager.mount,
		loadOlder: pager.loadOlder,
	});
	assert.equal(landed, false, "past the mount budget the walk refuses");
});

test("history that ends before the row ends the walk without spinning", async () => {
	const { state, pager } = deepPager({ pages: 2, distance: 700 });
	const landed = await ensureReachable({
		isReachable: pager.reachable,
		rowDistance: pager.rowDistance,
		mount: pager.mount,
		loadOlder: pager.loadOlder,
	});
	assert.equal(landed, false);
	assert.equal(
		state.loads,
		3,
		"two applied pages, then the false that stops it",
	);
});

test("concurrent deep clicks share the page fetch", async () => {
	const { state, pager } = deepPager({ distance: 700 });
	const walk = createBackwardLoader({
		reachable: pager.reachable,
		rowDistance: pager.rowDistance,
		mount: pager.mount,
		loadOlder: pager.loadOlder,
	});
	const [a, b] = await Promise.all([walk.loadOne(), walk.loadOne()]);
	assert.equal(a, true);
	assert.equal(b, true);
	assert.equal(state.loads, 1, "the second walk awaited the first's page");
});
