import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The scroll-paging policy is pure TypeScript with no React or DOM imports, so
 * it bundles the same way the transcript reducer does and runs under
 * `node --test`.
 *
 * Why this exists. The behaviour under test is a state machine whose inputs are
 * a trackpad, a clock, and the geometry of a scroll container. Exercised only
 * through the real app it is testable exactly once per gesture, by a human, and
 * its most important clauses are the ones that are hardest to perform on
 * purpose: a fling that must yield ONE request rather than forty, a finger
 * resting at the top that must not walk the whole conversation into memory, a
 * reader turning around mid-gesture. Each of those is two lines here.
 *
 * Everything that needs the DOM stays in `use-scroll-paging.ts` and is proven
 * by the rendered evidence under `docs/evidence/transcript-scroll-paging/`.
 * This file proves the decisions; that directory proves the pixels.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/scroll-paging";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const paging = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	ANCHOR_EPSILON_PX,
	MAX_AUTO_ATTEMPTS,
	MAX_CHAIN_FETCH,
	SETTLE_MS,
	anchorDrift,
	decide,
	initialPagingState,
	isExhausted,
	noteFailed,
	noteInput,
	noteSettled,
	prefetchZonePx,
} = paging;

/** A scroller with history behind it, the reader near the top, nothing hidden locally. */
const geo = (over = {}) => ({
	distanceFromTopPx: 100,
	clientHeight: 800,
	hiddenRows: 0,
	hasMore: true,
	scrollable: true,
	followingTail: false,
	...over,
});

/** One upward wheel notch at time `at`. */
const wheelUp = (state, at, over = {}) =>
	noteInput(state, {
		direction: "up",
		continuous: true,
		deliberate: false,
		atHardTop: false,
		at,
		...over,
	});

/**
 * Run the pump the way the rAF loop does: decide once per frame, and count the
 * actions that came out. `inputs` is a list of `[time, folder]` pairs applied
 * before the frame at that time.
 */
const drive = (state, events, { frames, geometry = geo(), start = 0 }) => {
	const actions = [];
	let current = state;
	let cursor = 0;
	for (const now of frames) {
		while (cursor < events.length && events[cursor][0] <= now) {
			current = events[cursor][1](current, events[cursor][0]);
			cursor++;
		}
		const result = decide(current, geometry, now + start);
		current = result.state;
		if (result.action !== "none") actions.push({ at: now, action: result.action });
	}
	return { state: current, actions };
};

test("a fling of many wheel events yields exactly one fetch", () => {
	// 40 notches over 400ms at 10ms spacing: a real trackpad fling's event rate.
	// Frames run at 16ms through the gesture and past its end, so the settle
	// debounce gets its chance on the far side.
	const events = [];
	for (let i = 0; i < 40; i++) events.push([i * 10, (s, at) => wheelUp(s, at)]);
	const frames = [];
	for (let t = 0; t <= 800; t += 16) frames.push(t);

	const { actions } = drive(initialPagingState(), events, { frames });

	assert.equal(
		actions.length,
		1,
		`one fetch for one fling, got ${JSON.stringify(actions)}`,
	);
	assert.equal(actions[0].action, "fetch");
	// And it happened AFTER the gesture stopped, not during it: clause C.
	assert.ok(
		actions[0].at >= 390 + SETTLE_MS,
		`dispatched at ${actions[0].at}ms, which is mid-fling`,
	);
});

test("a demand is not spent while input is still arriving", () => {
	let state = wheelUp(initialPagingState(), 0);
	// One frame later, well inside the debounce.
	const mid = decide(state, geo(), 16);
	assert.equal(mid.action, "none");
	assert.ok(mid.state.armed, "the demand survives the frame that refused it");
	// Past the debounce with no further input.
	const after = decide(mid.state, geo(), SETTLE_MS + 1);
	assert.equal(after.action, "fetch");
});

test("a demand outside the prefetch zone is dropped rather than held", () => {
	// Held, it would be spent later by an unrelated resize or clamp — the stale
	// input the TUI's `_resume_in_zone = False` early out exists to prevent.
	const zone = prefetchZonePx(800);
	let state = wheelUp(initialPagingState(), 0);
	const out = decide(state, geo({ distanceFromTopPx: zone + 200 }), SETTLE_MS + 1);
	assert.equal(out.action, "none");
	assert.equal(out.state.armed, false, "stale demand dropped, not retained");
});

test("a wheel notch clamped at the top does not re-arm the latch", () => {
	// Spend one demand at the hard top, which latches.
	let state = wheelUp(initialPagingState(), 0, { atHardTop: true });
	let result = decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1);
	assert.equal(result.action, "fetch");
	assert.ok(result.state.clampLatched);
	state = noteSettled(result.state);

	// 200 further notches, all clamped: a finger resting on the trackpad at the
	// top, or a scrollbar thumb held against its rail. Each reveal is settled,
	// because a state machine left permanently `busy` would pass this assertion
	// for the wrong reason.
	//
	// Zero is NOT the expectation here. The reader is still pinned against the
	// top edge with history behind them, so the continuation legitimately keeps
	// offering pages - that is the clause that stops the reveal being a
	// one-page-per-gesture stutter. What the latch guarantees is that those
	// pages come from the BOUND and not from the 200 notches: the count is
	// `MAX_CHAIN_FETCH`, and it stays there however long the finger rests.
	let spent = 0;
	for (let i = 0; i < 200; i++) {
		state = wheelUp(state, 1000 + i * 10, { atHardTop: true });
		const frame = decide(state, geo({ distanceFromTopPx: 0 }), 1000 + i * 10 + 8);
		state = frame.state;
		if (frame.action !== "none") {
			spent++;
			state = noteSettled(state);
		}
	}
	assert.equal(
		spent,
		MAX_CHAIN_FETCH - 1,
		`a held gesture at the top is bounded by the chain, not by its event count (got ${spent})`,
	);

	// A deliberate act does re-arm it: clause D's other half and clause K's
	// keyboard path.
	state = noteInput(state, {
		direction: "up",
		continuous: false,
		deliberate: true,
		atHardTop: true,
		at: 4000,
	});
	assert.equal(decide(state, geo({ distanceFromTopPx: 0 }), 4001).action, "fetch");
});

test("leaving the top re-arms the latch, because arriving again is a new arrival", () => {
	let state = wheelUp(initialPagingState(), 0, { atHardTop: true });
	state = decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1).state;
	assert.ok(state.clampLatched);
	state = noteInput(state, {
		direction: "down",
		continuous: true,
		deliberate: false,
		atHardTop: true,
		at: 500,
	});
	assert.equal(state.clampLatched, false);
});

test("a downward gesture cancels the demand retained while busy", () => {
	// Arm, spend, and then ask again while the fetch is in flight.
	let state = wheelUp(initialPagingState(), 0);
	state = decide(state, geo(), SETTLE_MS + 1).state;
	assert.ok(state.busy);
	state = wheelUp(state, 200);
	assert.ok(state.retained, "a gesture during a fetch retains one demand");

	// Two more upward notches must not retain two.
	state = wheelUp(state, 210);
	state = wheelUp(state, 220);
	assert.equal(state.retained, true);

	// The reader turns around.
	state = noteInput(state, {
		direction: "down",
		continuous: true,
		deliberate: false,
		atHardTop: false,
		at: 300,
	});
	assert.equal(state.retained, false, "the debt is void once they turn around");

	state = noteSettled(state);
	assert.equal(state.armed, false, "nothing left to spend when the page lands");
	assert.equal(decide(state, geo(), 1000).action, "none");
});

test("a retained demand is honoured when the page lands", () => {
	let state = wheelUp(initialPagingState(), 0);
	state = decide(state, geo(), SETTLE_MS + 1).state;
	state = wheelUp(state, 200);
	state = noteSettled(state);
	assert.ok(state.armed, "the retained demand became the armed one");
	assert.equal(decide(state, geo(), 200 + SETTLE_MS + 1).action, "fetch");
});

test("the local window is widened before the network is reached", () => {
	// Clause J. With rows held back locally, a demand spends on `widen`; the
	// fetch only becomes available once the window holds everything it has.
	let state = wheelUp(initialPagingState(), 0);
	const widened = decide(state, geo({ hiddenRows: 120 }), SETTLE_MS + 1);
	assert.equal(widened.action, "widen");

	state = noteSettled(widened.state);
	const next = decide(state, geo({ hiddenRows: 60 }), SETTLE_MS + 2);
	assert.equal(next.action, "widen", "still local while rows remain hidden");

	state = noteSettled(next.state);
	const network = decide(state, geo({ hiddenRows: 0 }), SETTLE_MS + 3);
	assert.equal(network.action, "fetch");
});

test("a reveal that leaves the reader in the zone continues; one that does not, stops", () => {
	// The self-limiting property the chain depends on. A page of 100 rows puts
	// thousands of pixels above the reader, which takes them out of the prefetch
	// zone and ends the chain on the next frame. Only a reveal too SHORT to move
	// them keeps going — which is the case the reader would otherwise have to
	// answer with a second gesture.
	const zone = prefetchZonePx(800);
	let stops = noteSettled(
		decide(wheelUp(initialPagingState(), 0), geo(), SETTLE_MS + 1).state,
	);
	assert.equal(
		decide(stops, geo({ distanceFromTopPx: zone + 1 }), 1000).action,
		"none",
		"a page that moved the reader out of the zone ends the chain",
	);

	let continues = noteSettled(
		decide(wheelUp(initialPagingState(), 0), geo(), SETTLE_MS + 1).state,
	);
	assert.equal(
		decide(continues, geo({ distanceFromTopPx: 10 }), 1000).action,
		"fetch",
		"a page too short to move the reader is answered by another",
	);
});

test("a transcript too short to scroll chains a bounded number of pages", () => {
	// Clause L: no gesture is available, so `continuation` is the only demand,
	// and it stops at the bound rather than looping.
	let state = { ...initialPagingState(), continuation: true };
	const short = geo({ scrollable: false, distanceFromTopPx: 0 });
	let fetches = 0;
	for (let i = 0; i < 50; i++) {
		const frame = decide(state, short, i * 20);
		state = frame.state;
		if (frame.action === "fetch") {
			fetches++;
			state = noteSettled(state);
		}
	}
	assert.equal(fetches, MAX_CHAIN_FETCH, "the chain is bounded, not a loop");

	// And it stops as soon as the transcript is scrollable AND the reader is
	// clear of the prefetch zone, which in a real window is what the first page
	// achieves. The bound above is the backstop for the transcript where it does
	// not.
	let scrollable = { ...initialPagingState(), continuation: true };
	const first = decide(scrollable, short, 0);
	assert.equal(first.action, "fetch");
	scrollable = noteSettled(first.state);
	assert.equal(
		decide(
			scrollable,
			geo({ scrollable: true, distanceFromTopPx: prefetchZonePx(800) + 1 }),
			10,
		).action,
		"none",
		"a scrollable transcript with room above waits for a gesture",
	);
});

test("a reader following the tail is never paged under", () => {
	// Clause I. Even with an armed demand and history behind them.
	const state = wheelUp(initialPagingState(), 0);
	const result = decide(
		state,
		geo({ followingTail: true, distanceFromTopPx: 0 }),
		SETTLE_MS + 1,
	);
	assert.equal(result.action, "none");
	assert.equal(result.state.busy, false);
});

test("automatic retries are bounded; the affordance still works", () => {
	// Clause G. Fail the budget, then confirm the gesture path has given up and
	// the deliberate path has not.
	let state = initialPagingState();
	for (let i = 0; i < MAX_AUTO_ATTEMPTS; i++) {
		state = wheelUp(state, i * 1000);
		const frame = decide(state, geo(), i * 1000 + SETTLE_MS + 1);
		assert.equal(frame.action, "fetch");
		state = noteFailed(frame.state);
	}
	assert.ok(isExhausted(state));

	state = wheelUp(state, 9000);
	assert.equal(
		decide(state, geo(), 9000 + SETTLE_MS + 1).action,
		"none",
		"the automatic path stops rather than hammering a failing backend",
	);

	state = noteInput(state, {
		direction: "up",
		continuous: false,
		deliberate: true,
		atHardTop: false,
		at: 10_000,
	});
	assert.equal(isExhausted(state), false, "an explicit ask forgives the budget");
	assert.equal(decide(state, geo(), 10_001).action, "fetch");
});

test("a successful page clears the failure budget", () => {
	let state = initialPagingState();
	state = wheelUp(state, 0);
	state = noteFailed(decide(state, geo(), SETTLE_MS + 1).state);
	assert.equal(state.failures, 1);
	state = wheelUp(state, 2000);
	state = noteSettled(decide(state, geo(), 2000 + SETTLE_MS + 1).state);
	assert.equal(state.failures, 0);
});

test("nothing is spent when there is nothing left to reveal", () => {
	const state = wheelUp(initialPagingState(), 0);
	const result = decide(
		state,
		geo({ hasMore: false, hiddenRows: 0 }),
		SETTLE_MS + 1,
	);
	assert.equal(result.action, "none");
	assert.equal(result.state.armed, false, "the demand is dropped, not parked");
});

test("the prefetch zone scales with the viewport between its bounds", () => {
	assert.equal(prefetchZonePx(300), 320, "floored for a short panel");
	assert.equal(prefetchZonePx(1000), 500, "half a viewport in the normal case");
	assert.equal(prefetchZonePx(4000), 900, "capped on a tall display");
});

test("the anchor correction is a no-op while the extent is stable", () => {
	// The whole correctness argument for clause E's arithmetic: with the extent
	// unchanged, a moved anchor is the READER scrolling, and correcting it would
	// scroll the transcript out from under them.
	const before = { id: "r1", viewportOffset: 12, extent: 4000 };
	assert.equal(
		anchorDrift(before, { id: "r1", viewportOffset: 400, extent: 4000 }),
		0,
	);
	// Growth above the anchor pushes it down; that is the case to correct.
	assert.equal(
		anchorDrift(before, { id: "r1", viewportOffset: 212, extent: 4600 }),
		200,
	);
	// Sub-pixel noise is not a correction worth emitting a scroll event for.
	assert.equal(
		anchorDrift(before, {
			id: "r1",
			viewportOffset: 12 + ANCHOR_EPSILON_PX / 2,
			extent: 4600,
		}),
		0,
	);
	// A different row means the anchor unmounted; there is nothing to hold to.
	assert.equal(
		anchorDrift(before, { id: "r9", viewportOffset: 212, extent: 4600 }),
		0,
	);
	assert.equal(anchorDrift(null, { id: "r1", viewportOffset: 0, extent: 1 }), 0);
	assert.equal(anchorDrift(before, null), 0);
});

test("a session change discards latch, demand and chain budgets", () => {
	// Clause H, as the hook applies it: the reset is the initial state, and the
	// initial state must not be holding anything.
	let state = wheelUp(initialPagingState(), 0, { atHardTop: true });
	state = decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1).state;
	state = wheelUp(state, 200);
	assert.ok(state.clampLatched && state.retained && state.busy);

	const fresh = initialPagingState();
	assert.deepEqual(
		{
			armed: fresh.armed,
			retained: fresh.retained,
			busy: fresh.busy,
			clampLatched: fresh.clampLatched,
			failures: fresh.failures,
			chainFetch: fresh.chainFetch,
			chainWiden: fresh.chainWiden,
		},
		{
			armed: false,
			retained: false,
			busy: false,
			clampLatched: false,
			failures: 0,
			chainFetch: 0,
			chainWiden: 0,
		},
	);
	// And it can act immediately: a fresh state must not sit out the settle
	// debounce it never earned, which is the short-transcript chain's start.
	assert.equal(
		decide(
			{ ...fresh, continuation: true },
			geo({ scrollable: false }),
			0,
		).action,
		"fetch",
	);
});
