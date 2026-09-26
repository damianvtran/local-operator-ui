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
	GESTURE_GAP_MS,
	HARD_TOP_PX,
	MAX_AUTO_ATTEMPTS,
	MAX_CHAIN_FETCH,
	SETTLE_MS,
	TRAVEL_MIN_PX,
	anchorDrift,
	anchorDriftForCurrentInput,
	decide,
	initialPagingState,
	isExhausted,
	noteFailed,
	noteInput,
	noteSettled,
	prefetchZonePx,
	spendWindows,
} = paging;

/*
 * A scroller with history behind it, the reader near the top, nothing hidden
 * locally.
 *
 * The derivation at the end is not a convenience, it is the fixture's whole
 * correctness argument. `followingTail` and `scrollable` are BOTH computed by
 * the DOM layer from one number (`scrollTop`): an unscrollable transcript has
 * `scrollTop === 0`, so `!scrollable` strictly implies `followingTail`. A
 * fixture that lets a caller override one without the other can express a
 * geometry `measure()` can never emit — and it did: the clause L test passed
 * against `{scrollable:false, followingTail:false}` while the real app returned
 * "none" on the tail guard and never chained at all. A test that certifies an
 * impossible state is worse than no test, so the impossible state is made
 * unrepresentable here.
 */
const geo = (over = {}) => {
	const base = {
		distanceFromTopPx: 100,
		clientHeight: 800,
		hiddenRows: 0,
		hasMore: true,
		scrollable: true,
		followingTail: false,
		...over,
	};
	if (!base.scrollable) {
		// Unscrollable implies at the tail AND at the top, both by construction.
		base.followingTail = true;
		base.distanceFromTopPx = 0;
	}
	return base;
};

/**
 * One upward wheel notch at time `at`.
 *
 * `travelledPx` is what the DOM half measures from the scroller's own offsets
 * and hands the policy (see `use-scroll-paging.ts`). It defaults to 0 here, so
 * a case that is not about travel keeps exactly the meaning it had: a notch
 * that reported no travel of its own.
 */
const wheelUp = (state, at, over = {}) =>
	noteInput(state, {
		direction: "up",
		continuous: true,
		deliberate: false,
		atHardTop: false,
		at,
		travelledPx: 0,
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
		/*
		 * `geometry` may be a FUNCTION of the frame time, and the cases about the
		 * lead need it to be: the lead exists because a reader is MOVING, so a
		 * fixed distance would describe a reader who never gets anywhere and a
		 * spend inside the window would mean nothing.
		 */
		const shape = typeof geometry === "function" ? geometry(now) : geometry;
		const result = decide(current, shape, now + start);
		current = result.state;
		if (result.action !== "none")
			actions.push({
				at: now,
				action: result.action,
				distanceFromTopPx: shape.distanceFromTopPx,
			});
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
	const state = wheelUp(initialPagingState(), 0);
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
	const state = wheelUp(initialPagingState(), 0);
	const out = decide(
		state,
		geo({ distanceFromTopPx: zone + 200 }),
		SETTLE_MS + 1,
	);
	assert.equal(out.action, "none");
	assert.equal(out.state.armed, false, "stale demand dropped, not retained");
});

test("a wheel notch clamped at the top does not re-arm the latch", () => {
	// Spend one demand at the hard top, which latches.
	let state = wheelUp(initialPagingState(), 0, { atHardTop: true });
	const result = decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1);
	assert.equal(result.action, "fetch");
	assert.ok(result.state.clampLatched);
	state = noteSettled(result.state);

	// 200 further notches, all clamped: a finger resting on the trackpad at the
	// top, or a scrollbar thumb held against its rail. Each reveal is settled,
	// because a state machine left permanently `busy` would pass this assertion
	// for the wrong reason.
	//
	// Zero, now that a scrollable transcript gets one reveal per act: the latch
	// refuses to re-arm from the clamped notches, and the continuation stands
	// down as soon as it sees a scroller the reader could have used. A held
	// gesture is one act however long it is held.
	// Continuous: 10ms apart, well inside GESTURE_GAP_MS, so this is ONE act
	// that happens to last two seconds. It has already been answered.
	let spent = 0;
	let t = SETTLE_MS + 2;
	for (let i = 0; i < 200; i++) {
		t += 10;
		state = wheelUp(state, t, { atHardTop: true });
		const frame = decide(state, geo({ distanceFromTopPx: 0 }), t + 8);
		state = frame.state;
		if (frame.action !== "none") {
			spent++;
			state = noteSettled(state);
		}
	}
	assert.equal(
		spent,
		0,
		`a held gesture at the top is one act, not 200 (got ${spent})`,
	);

	// But the reader letting go and pushing again IS a new act, and must be
	// answered — otherwise the latch bounds a POSITION rather than a gesture and
	// a reader parked at the top can never load another page. Measured before
	// this distinction existed: four separate flicks, zero pages, the slot stuck
	// reading "Load earlier messages".
	t += GESTURE_GAP_MS + 1;
	state = wheelUp(state, t, { atHardTop: true });
	const fresh = decide(state, geo({ distanceFromTopPx: 0 }), t + SETTLE_MS + 1);
	assert.equal(
		fresh.action,
		"fetch",
		"a new gesture after a quiet gap is answered",
	);

	// A deliberate act does re-arm it: clause D's other half and clause K's
	// keyboard path.
	state = noteInput(state, {
		direction: "up",
		continuous: false,
		deliberate: true,
		atHardTop: true,
		travelledPx: 0,
		at: 4000,
	});
	assert.equal(
		decide(state, geo({ distanceFromTopPx: 0 }), 4001).action,
		"fetch",
	);
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
		travelledPx: 0,
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
		travelledPx: 0,
		at: 300,
	});
	assert.equal(state.retained, false, "the debt is void once they turn around");

	state = noteSettled(state);
	assert.equal(state.armed, false, "nothing left to spend when the page lands");
	assert.equal(decide(state, geo(), 1000).action, "none");
});

test("a retained demand is honoured when the page lands — as its widen", () => {
	// Rule 2's follow-up, under rule 2's act budget. The reader pushed again
	// while the first page was in flight, so the landing owes them the reveal
	// that makes it visible; what it cannot do is buy a second round trip,
	// because this whole sequence is one act. Measured on the real surface,
	// that second round trip is exactly what the operator's chain ran on.
	let state = wheelUp(initialPagingState(), 0);
	state = decide(state, geo(), SETTLE_MS + 1).state;
	state = wheelUp(state, 200);
	state = noteSettled(state, { hiddenRowsAfter: 60 });
	assert.ok(state.armed, "the retained demand became the armed one");
	const widened = decide(state, geo({ hiddenRows: 60 }), 200 + SETTLE_MS + 1);
	assert.equal(
		widened.action,
		"widen",
		"the follow-up buys the widen that shows the page it asked for",
	);

	// With the widen spent, the same act's next quiet frame offers nothing more
	// from the network: the next fetch needs a fresh act.
	state = noteSettled(widened.state, { network: false });
	state = wheelUp(state, 400);
	assert.equal(
		decide(state, geo(), 400 + SETTLE_MS + 1).action,
		"none",
		"one fetch per act: the same gesture cannot buy another",
	);

	// A fresh act is a fresh budget: the measured pause between two deliberate
	// flicks clears it.
	state = wheelUp(state, 400 + GESTURE_GAP_MS + 1);
	assert.equal(
		decide(state, geo(), 400 + GESTURE_GAP_MS + 1 + SETTLE_MS + 1).action,
		"fetch",
	);
});

test("the local window is widened before the network is reached", () => {
	// Clause J. With rows held back locally, a demand spends on `widen`; the
	// fetch only becomes available once the window holds everything it has.
	// Each reveal takes its own gesture now, which is the point of the change:
	// one act, one reveal.
	let state = wheelUp(initialPagingState(), 0);
	const widened = decide(state, geo({ hiddenRows: 120 }), SETTLE_MS + 1);
	assert.equal(widened.action, "widen");

	state = noteSettled(widened.state, { network: false });
	state = wheelUp(state, 1000);
	const next = decide(state, geo({ hiddenRows: 60 }), 1000 + SETTLE_MS + 1);
	assert.equal(next.action, "widen", "still local while rows remain hidden");

	state = noteSettled(next.state, { network: false });
	state = wheelUp(state, 2000);
	const network = decide(state, geo({ hiddenRows: 0 }), 2000 + SETTLE_MS + 1);
	assert.equal(network.action, "fetch");
});

test("one gesture yields one reveal, however near the top it leaves the reader", () => {
	// The replacement for round 1's "continue while still in the zone" rule,
	// and the reason it had to go. Measured in the running app, that rule turned
	// ONE fling into rows 60 -> 100 -> 160 -> 200 -> 260 and scrollHeight
	// 6482 -> 27853: every reveal re-pinned the reader near the top edge, which
	// put them back in the zone and authorised the next one. The zone test
	// cannot terminate a chain whose own effect is to satisfy it.
	let state = wheelUp(initialPagingState(), 0);
	const first = decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1);
	assert.equal(first.action, "fetch");

	// The reveal lands and leaves them still hard against the top, with history
	// behind them. No further gesture: nothing more may be spent.
	state = noteSettled(first.state);
	assert.equal(
		decide(state, geo({ distanceFromTopPx: 0 }), 1000).action,
		"none",
		"a settled reveal on a scrollable transcript does not chain",
	);

	// Their next flick is answered immediately.
	state = wheelUp(state, 2000);
	assert.equal(
		decide(state, geo({ distanceFromTopPx: 0 }), 2000 + SETTLE_MS + 1).action,
		"fetch",
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

test("an unscrollable transcript is not treated as following the tail", () => {
	// B1/Q2, as a test that could not have passed before the fix. The two terms
	// are not independent: the DOM computes both from `scrollTop`, so an
	// unscrollable transcript reports BOTH `followingTail` and `!scrollable`.
	// A bare tail guard therefore returned before the branch that owns exactly
	// this case, and a conversation shorter than its viewport never loaded its
	// history at all — with the click-only button removed, its history was
	// unreachable by any means.
	//
	// `geo()` derives the pair now, so this test cannot be written against a
	// geometry the app can never produce.
	const short = geo({ scrollable: false });
	assert.equal(short.followingTail, true, "the fixture derives the pair");
	assert.equal(short.distanceFromTopPx, 0);

	const state = { ...initialPagingState(), continuation: true };
	const result = decide(state, short, 0);
	assert.equal(
		result.action,
		"fetch",
		"a transcript the reader cannot scroll must still reach its history",
	);
});

test("the chain stops as soon as the reader has a gesture available", () => {
	// The complement of the rule above: the chain exists ONLY where no act is
	// possible. The moment the content becomes scrollable, control returns to
	// the reader rather than the app continuing to mount on their behalf.
	let state = { ...initialPagingState(), continuation: true };
	const first = decide(state, geo({ scrollable: false }), 0);
	assert.equal(first.action, "fetch");
	state = noteSettled(first.state);
	assert.equal(
		decide(state, geo({ scrollable: true, distanceFromTopPx: 0 }), 100).action,
		"none",
		"a scrollable transcript waits for the reader",
	);
});

test("a local widen does not forgive the network failure budget", () => {
	// MINOR 4. `failures` is a fact about the backend; revealing rows already in
	// memory is no evidence the backend recovered. Clearing it on a widen let a
	// reader with a dead backend buy MAX_AUTO_ATTEMPTS fresh tries per widen.
	let state = initialPagingState();
	state = wheelUp(state, 0);
	state = noteFailed(decide(state, geo(), SETTLE_MS + 1).state);
	assert.equal(state.failures, 1);

	state = wheelUp(state, 1000);
	const widened = decide(state, geo({ hiddenRows: 60 }), 1000 + SETTLE_MS + 1);
	assert.equal(widened.action, "widen");
	state = noteSettled(widened.state, { network: false });
	assert.equal(
		state.failures,
		1,
		"a local reveal says nothing about the network",
	);

	// A real page landing is evidence, and does clear it.
	state = wheelUp(state, 2000);
	const fetched = decide(state, geo(), 2000 + SETTLE_MS + 1);
	assert.equal(fetched.action, "fetch");
	assert.equal(noteSettled(fetched.state).failures, 0);
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
		travelledPx: 0,
		at: 10_000,
	});
	assert.equal(
		isExhausted(state),
		false,
		"an explicit ask forgives the budget",
	);
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

test("a failed fetch does not spend the act's budget", () => {
	/*
	 * Round-1 review F2, in the reviewer's own sequence. The act budget bounds
	 * the operator's chain of SUCCESSFUL pages; a failure is rule G's case
	 * instead, where the reader's own continued ask is the retry and
	 * `MAX_AUTO_ATTEMPTS` is what stops a loop. The terminal UI draws the line
	 * the same way: a genuine fault gets an honest notice and the next ask, not
	 * a spent act.
	 */
	let state = initialPagingState();
	state = wheelUp(state, 0);
	const first = decide(state, geo({ distanceFromTopPx: 0 }), 5);
	assert.equal(
		first.action,
		"fetch",
		"the push at the wall buys its round trip",
	);
	state = noteFailed(first.state);

	// Same act: the notch is well inside GESTURE_GAP_MS of the last input, so
	// no new act has begun and the budget is still this act's.
	state = wheelUp(state, 150);
	assert.equal(
		decide(state, geo({ distanceFromTopPx: 0 }), 150 + SETTLE_MS + 1).action,
		"fetch",
		"the reader's continued push retries the failed fetch",
	);
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
	assert.equal(
		anchorDrift(null, { id: "r1", viewportOffset: 0, extent: 1 }),
		0,
	);
	assert.equal(anchorDrift(before, null), 0);
});

test("reader input skips stale anchor correction while layout-only growth is corrected", () => {
	const held = { id: "reader-row", viewportOffset: 59, extent: 10_808 };
	const staleAfter = { ...held, viewportOffset: -1_483, extent: 17_532 };
	const grownAfter = { ...held, viewportOffset: 83, extent: 17_532 };

	// A correction based on a pre-input sample would undo the reader's scroll.
	// The production decision returns no write once newer input owns the view.
	assert.equal(anchorDriftForCurrentInput(held, staleAfter, 12, 13), null);

	// With no new input, revealed content above the anchor remains correctable.
	assert.equal(anchorDriftForCurrentInput(held, grownAfter, 12, 12), 24);
	assert.equal(
		anchorDriftForCurrentInput(
			held,
			{ ...grownAfter, viewportOffset: held.viewportOffset + 0.25 },
			12,
			12,
		),
		0,
	);
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
		decide({ ...fresh, continuation: true }, geo({ scrollable: false }), 0)
			.action,
		"fetch",
	);
});

/*
 * ---------------------------------------------------------------------------
 * Rule 3's trigger (a stop, never a prediction), rule 2's act budget, the
 * latch's travel record (rule 4) and the widen a landed page owes (rule 6).
 *
 * Round 2 wrote these cases around a third trigger — a LEAD window projected
 * from the reader's measured speed — and the operator's report removed it: a
 * reveal dispatched while the viewport travels mounts under a moving reader
 * (measured this round: a 6966px single-frame displacement before the anchor
 * hold restored it) and the chain of mid-motion spends that follows is the
 * reported loop. The cases that pinned the lead are rewritten here around the
 * two stops that remain. `no reveal is dispatched while the viewport is
 * travelling` and `a fling that crosses two walls spends exactly one fetch`
 * are the two new cases that FAIL against the module this change replaces —
 * run this file against `origin/main`'s `scroll-paging.ts` to watch them.
 *
 * The measurements they come from:
 *
 *   - 25px/ms at the top of a finger burst (400px in 16ms), 2.4px/ms on a
 *     momentum tail at the wall (80px in 33ms);
 *   - a local widen visible 96ms after the spend, a durable page 85ms;
 *   - a 489px viewport, so `zonePx` is 320;
 *   - two continuous acts of 800px and 1200px that issued ZERO requests,
 *     because they never settled inside the zone and never reached the wall —
 *     now the rule rather than an accident;
 *   - a page landing at `rows 200 -> 200, hiddenRows 0 -> 60` followed by 62
 *     clamped notches with nothing revealed at all;
 *   - one fling act on the 620-row fixture that spent TWO round trips
 *     (`fling-crossing-two-walls` in the harness's own readings).
 * ---------------------------------------------------------------------------
 */

test("a fast train is spent at the wall, never mid-motion", () => {
	// The operator's flick, at the fastest travel measured in this surface's
	// evidence runs: 25px/ms (400px in 16ms). This is the case the lead existed
	// for and the case it is removed for: the spend must not land while the
	// viewport is travelling — a mount then is a lurch the eye sees (see
	// `decide`'s trigger comment) and every wall it mounts buys the next spend.
	// The demand waits, and the stop it can be spent at here is the wall, where
	// the content cannot move under the momentum.
	const clientHeight = 489;
	const velocity = 25;
	const events = [];
	for (let i = 0; i < 40; i++) {
		// The velocity is kept for the replaced module's benefit (see the case
		// above): its lead spends this train mid-motion, which is what the
		// assertion below discriminates against.
		events.push([
			i * 10,
			(s, at) => wheelUp(s, at, { travelVelocityPxPerMs: velocity }),
		]);
	}
	const frames = [];
	for (let t = 0; t <= 500; t += 16) frames.push(t);

	const { actions } = drive(initialPagingState(), events, {
		frames,
		geometry: (now) =>
			geo({
				clientHeight,
				distanceFromTopPx: Math.max(0, 2000 - velocity * now),
			}),
	});

	assert.equal(
		actions.length,
		1,
		`one page for one train, got ${JSON.stringify(actions)}`,
	);
	assert.equal(actions[0].action, "fetch");
	// Spent AT the wall: the frame it was spent in had the reader against the
	// edge, not mid-flight. Against the replaced module this assertion reads the
	// lead's own spend, tens of milliseconds in and still moving — the
	// discriminating half of the case.
	assert.ok(
		actions[0].distanceFromTopPx <= HARD_TOP_PX,
		`spent at ${actions[0].distanceFromTopPx}px from the top, which is mid-motion rather than a stop`,
	);
});

test("a fast train that never settles and never reaches the wall spends nothing", () => {
	// The negative control for rule 3's trigger, and the inverse of the case the
	// lead used to win: 12px/ms of travel that neither settles inside the zone
	// nor reaches the wall within the capture. There is no stop in this fixture,
	// so there is no spend — the demand waits for one, as the terminal UI's
	// animator deferral does. A lead that spent here was projecting an arrival
	// the reader never made; the replaced module spends once, mid-motion, and
	// this case is written to catch that.
	const clientHeight = 489;
	const velocity = 12;
	const events = [];
	for (let i = 0; i < 6; i++) {
		events.push([
			i * 12,
			(s, at) => wheelUp(s, at, { travelVelocityPxPerMs: velocity }),
		]);
	}
	const frames = [];
	for (let t = 0; t <= 300; t += 16) frames.push(t);

	const { actions } = drive(initialPagingState(), events, {
		frames,
		geometry: (now) =>
			geo({
				clientHeight,
				distanceFromTopPx: Math.max(0, 4000 - velocity * now),
			}),
	});

	assert.equal(
		actions.length,
		0,
		`mid-motion is not a stop, got ${JSON.stringify(actions)}`,
	);
});

test("a reader who stops outside the zone spends nothing", () => {
	// The disarm is preserved — now evaluated at the settle rather than
	// mid-flight, because where the reader STOPS is the fact the spend is
	// about. A slow approach that stops 537px from the top is outside the 320px
	// zone, and the demand is dropped then rather than held for a later resize
	// or clamp to spend.
	const slow = wheelUp(initialPagingState(), 0);

	// Mid-motion the demand is still armed: it is waiting for the stop.
	const moving = decide(slow, geo({ distanceFromTopPx: 537 }), 16);
	assert.equal(moving.action, "none");
	assert.equal(moving.state.armed, true, "the wait is not a drop");

	// At the settle, still outside the zone: dropped, not held.
	const dropped = decide(slow, geo({ distanceFromTopPx: 537 }), SETTLE_MS + 1);
	assert.equal(dropped.action, "none");
	assert.equal(
		dropped.state.armed,
		false,
		"a settled demand outside the zone is dropped, not held",
	);
});

test("no reveal is dispatched while the viewport is travelling", () => {
	// THE OPERATOR'S REPORT, at the level this file can pin it. A demand armed
	// by an upward notch, then a fast approach INSIDE the zone with the input
	// still arriving: the spend must not happen. Written to FAIL against the
	// module this change replaces — its lead spends this demand at frame 16,
	// inside the zone and still moving, which is the mount that lands under a
	// moving viewport (measured: a 6966px single-frame displacement before the
	// anchor hold restored it).
	const clientHeight = 489;
	// `travelVelocityPxPerMs` is kept in the notch even though the current
	// policy no longer reads it: this case has to discriminate against the
	// module this change replaces, whose lead spends a MOVING demand inside the
	// zone, and that module reads the field the real DOM half still measures.
	const state = wheelUp(initialPagingState(), 0, {
		travelVelocityPxPerMs: 24,
	});
	const moving = geo({ clientHeight, distanceFromTopPx: 250, hiddenRows: 0 });
	const mid = decide(state, moving, 16);
	assert.equal(mid.action, "none", "a moving reader is not spent");
	assert.equal(mid.state.armed, true, "the demand waits for the stop");

	// The stop inside the zone: spent, and only then.
	const settled = decide(state, moving, SETTLE_MS + 1);
	assert.equal(settled.action, "fetch", "the stop is a spend");

	// A stop OUTSIDE the zone is still nothing, at the same instant.
	const away = decide(
		state,
		geo({ clientHeight, distanceFromTopPx: 600, hiddenRows: 0 }),
		SETTLE_MS + 1,
	);
	assert.equal(away.action, "none");
	assert.equal(away.state.armed, false);
});

test("a settled spend inside the zone does not set the latch, and the arrival then buys a widen", () => {
	// A2, and the pairing that unwinds the freeze: the page is asked for at the
	// reader's settle INSIDE the zone (not against the wall, so nothing latches),
	// and their arrival at the wall is therefore a FRESH demand — which spends
	// the local widen that makes the page they are waiting for visible. One
	// reveal for the page, one for the widen, instead of a dead stop with a free
	// reveal sitting there.
	const clientHeight = 489;
	let state = wheelUp(initialPagingState(), 0);
	const early = decide(
		state,
		geo({ clientHeight, distanceFromTopPx: 100 }),
		SETTLE_MS + 1,
	);
	assert.equal(early.action, "fetch");
	assert.equal(
		early.state.clampLatched,
		false,
		"a demand spent away from the wall is not repeating against an edge",
	);

	// The page lands with its rows still held back: this is rule 6's input.
	state = noteSettled(early.state, { hiddenRowsAfter: 60 });
	assert.equal(state.pageWidenOwed, true);

	// The reader travels the rest of the way and arrives clamped, with no
	// travel of their own left to claim.
	state = wheelUp(state, 200, { atHardTop: true, travelledPx: 0 });
	assert.equal(state.clampLatched, false, "their arrival is a fresh arrival");
	assert.ok(state.armed, "and it carries a demand");
	const arrival = decide(
		state,
		geo({ clientHeight, distanceFromTopPx: 0, hiddenRows: 60 }),
		200 + SETTLE_MS + 1,
	);
	assert.equal(arrival.action, "widen");
});

test("a fling that crosses two walls spends exactly one fetch", () => {
	// THE OPERATOR'S CASE, and the reason rule 2 has an act budget. Momentum
	// carries the reader from 2000px to the wall and, as each reveal mounts the
	// next wall in front of them, across it: every crossing used to look like a
	// fresh arrival and buy the next page, which is the reported loop ("it keeps
	// loading in chunks and goes into a loop until it loads all the way back to
	// the start"). One act, one round trip. Written to FAIL against the module
	// this change replaces: there the mid-motion lead spends at frame 16 AND the
	// arrival at the second, mounted wall spends again — two requests for one
	// act, which is what the harness measured on the real surface.
	const velocity = 12;
	let current = initialPagingState();
	const spent = [];
	let nextNotch = 0;
	for (let now = 0; now <= 3000; now += 16) {
		while (nextNotch < 150 && nextNotch * 10 <= now) {
			current = wheelUp(current, nextNotch * 10, {
				// Kept for the replaced module's benefit (see above): both of
				// its spend paths — the lead and the wall arrival after a mount
				// — are what this case counts.
				travelVelocityPxPerMs: velocity,
				travelledPx: velocity * 10,
			});
			nextNotch++;
		}
		const frame = decide(
			current,
			geo({
				clientHeight: 489,
				distanceFromTopPx: Math.max(0, 2000 - velocity * now),
			}),
			now,
		);
		current = frame.state;
		if (frame.action === "none") continue;
		spent.push({ at: now, action: frame.action });
		// A landing lands whole: rows the window holds back are owed their widen.
		current = noteSettled(current, {
			hiddenRowsAfter: frame.action === "fetch" ? 100 : 0,
		});
	}
	const fetches = spent.filter((entry) => entry.action === "fetch");
	assert.equal(
		fetches.length,
		1,
		`one round trip for one act, got ${JSON.stringify(spent)}`,
	);
});

test("a landed durable page buys exactly one widen", () => {
	// Rule 6. Measured in the field: the page landed with rows held back, the
	// reader stayed pinned at the wall, and nothing else ever happened — because
	// the widen that would show those rows needed an armed demand and the latch
	// refuses to arm one from a clamped notch.
	let state = wheelUp(initialPagingState(), 0);
	const spent = decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1);
	assert.equal(spent.action, "fetch");
	state = noteSettled(spent.state, { hiddenRowsAfter: 60 });
	assert.equal(state.pageWidenOwed, true, "the page owes the widen");

	// No input at all: the reader is pinned at the wall, which is the exact
	// state that produced 62 refused notches.
	const widen = decide(
		state,
		geo({ distanceFromTopPx: 0, hiddenRows: 60 }),
		5000,
	);
	assert.equal(widen.action, "widen");

	// Exactly one. The widen settles as a local reveal, owes nothing itself, and
	// the continuation does not re-enter for a second one.
	state = noteSettled(widen.state, { network: false });
	assert.equal(state.pageWidenOwed, false);
	assert.equal(
		decide(state, geo({ distanceFromTopPx: 0, hiddenRows: 40 }), 6000).action,
		"none",
		"one landed page authorises one widen, not a chain",
	);
});

test("a page that lands while the reader is still pushing still owes its widen", () => {
	// The case the first cut of rule 6 got wrong, and it was found by driving the
	// real app rather than by reasoning about this file. `noteSettled` refused the
	// continuation when a demand had been RETAINED during the fetch — which is
	// exactly what a reader still pushing at the wall produces — so a page that
	// landed with rows held back left the reader pinned with those rows one widen
	// away and nothing coming until their next act. Measured: the reader sat at
	// the hard top for 869ms with the slot reading "100 earlier messages above".
	let state = wheelUp(initialPagingState(), 0);
	const spent = decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1);
	assert.equal(spent.action, "fetch");
	// Still pushing while the page is in flight: one demand is retained.
	state = wheelUp(spent.state, 100);
	state = wheelUp(state, 200);
	assert.equal(state.retained, true, "the reader asked again mid-flight");
	state = noteSettled(state, { hiddenRowsAfter: 100 });
	assert.equal(state.pageWidenOwed, true);
	assert.equal(
		state.continuation,
		true,
		"the page the reader is waiting to see earns the continuation",
	);

	// And no further input is needed for it: the pump's next frame spends it.
	const widen = decide(
		state,
		geo({ distanceFromTopPx: 0, hiddenRows: 100 }),
		5000,
	);
	assert.equal(widen.action, "widen");

	// The retained demand survives for their next act; the widen does not chain
	// into a second one.
	state = noteSettled(widen.state, { network: false });
	assert.equal(
		decide(state, geo({ distanceFromTopPx: 0, hiddenRows: 60 }), 6000).action,
		"none",
		"one owed widen, not a chain",
	);
});

test("a landing that moves the reader clear of every window still pays its widen", () => {
	// The ordering case, and the one the first cut got wrong on the real surface:
	// a landed page that owes a widen hands the reader a debt, and the debt must be
	// paid on the frame it can be rather than after a prediction about where they
	// are. Measured: the landing itself moved the reader from `distanceFromTopPx`
	// 0 to 1905px (the rows that make the page visible are the rows the window
	// holds back), and the armed branch below then disarmed — so the debt was
	// thrown away on the same frame it was owed and the reader sat at
	// `hiddenRows: 100` while 62 further notches produced nothing.
	// The page is asked for at the reader's settle inside the zone (a stop, not
	// a prediction) and lands with its rows held back, which is the pairing A1
	// and A3 create together. Spending away from the wall sets no latch, so the
	// state below is the reader's own.
	let state = wheelUp(initialPagingState(), 0);
	state = noteSettled(
		decide(state, geo({ distanceFromTopPx: 100 }), SETTLE_MS + 1).state,
		{ hiddenRowsAfter: 100 },
	);
	assert.equal(state.pageWidenOwed, true);
	assert.equal(state.clampLatched, false);
	// A demand retained while the page was in flight, and a reader who is now
	// nowhere near either window.
	state = { ...state, armed: true, retained: true, lastInputAt: 4000 };
	const widen = decide(
		state,
		geo({ distanceFromTopPx: 1905, hiddenRows: 100 }),
		4300,
	);
	assert.equal(
		widen.action,
		"widen",
		"the owed widen is not a prediction about where the reader is",
	);
	assert.equal(
		widen.state.pageWidenOwed,
		false,
		"and the debt is settled once",
	);
	assert.equal(
		widen.state.clampLatched,
		false,
		"the app answering its own page does not latch the reader's gesture",
	);
});

test("a landed durable page with nothing hidden buys no widen", () => {
	// The other half of rule 6, and the reason it cannot reopen the round-1
	// chain: a page whose rows were all mounted already owes nothing, so the
	// door `growth === \"widen\"` opens is closed on the path that would loop.
	let state = wheelUp(initialPagingState(), 0);
	state = noteSettled(
		decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1).state,
		{ hiddenRowsAfter: 0 },
	);
	assert.equal(state.pageWidenOwed, false);
	assert.equal(
		decide(state, geo({ distanceFromTopPx: 0 }), 5000).action,
		"none",
		"a page with nothing hidden owes nothing",
	);
});

test("a rule-6 widen does not forgive the failure budget either", () => {
	// The widen rule 6 authorises is LOCAL growth, so it is no more evidence
	// about the backend than any other widen: the budget is cleared only by a
	// page that actually landed.
	let state = initialPagingState();
	state = wheelUp(state, 0);
	state = noteFailed(decide(state, geo(), SETTLE_MS + 1).state);
	assert.equal(state.failures, 1);

	state = wheelUp(state, 1000);
	const spent = decide(state, geo({ hiddenRows: 0 }), 1000 + SETTLE_MS + 1);
	assert.equal(spent.action, "fetch");
	state = noteFailed(spent.state);
	assert.equal(state.failures, 2);

	state = wheelUp(state, 2000);
	const widened = decide(state, geo({ hiddenRows: 60 }), 2000 + SETTLE_MS + 1);
	assert.equal(widened.action, "widen");
	state = noteSettled(widened.state, {
		network: false,
		hiddenRowsAfter: 60,
	});
	assert.equal(
		state.failures,
		2,
		"a local reveal says nothing about the network",
	);
	assert.equal(
		state.pageWidenOwed,
		false,
		"and a widen is not a page, so it owes no widen",
	);
});

test("a travel release is honoured as a demand, and the act's fetch is not re-spent", () => {
	// A4, under rule 2's budget. The latch was set by the act's own spend; the
	// reader then travels back to the wall, and that travel is a real arrival —
	// the release arms a demand — but the act has spent its round trip, so the
	// demand is refused rather than chained, and the release is recorded so the
	// same act cannot take it twice. A fresh act clears both and is answered.
	//
	// Every input below is inside one act except the last: the gaps stay well
	// under GESTURE_GAP_MS, because the whole point is what happens WITHIN an
	// act.
	let state = wheelUp(initialPagingState(), 0, { atHardTop: true });
	state = noteSettled(
		decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1).state,
	);
	assert.ok(state.clampLatched);
	assert.equal(state.actFetchSpent, true, "the act's one fetch is spent");

	// The travelling arrival: 500px of the reader's own motion, with the
	// browser's clamp-follow already subtracted by the DOM half.
	state = wheelUp(state, 200, { atHardTop: true, travelledPx: 500 });
	assert.equal(state.clampLatched, false, "the arrival released the latch");
	assert.equal(state.travelledSinceLatch, true, "and the release is recorded");
	assert.ok(state.armed, "the arrival carries a demand");

	// The budget refuses it: one act, one round trip.
	const refused = decide(
		state,
		geo({ distanceFromTopPx: 0 }),
		200 + SETTLE_MS + 1,
	);
	assert.equal(refused.action, "none");
	assert.equal(refused.state.armed, false);
	state = refused.state;

	// Same act, more travelling notches: an arrival can be earned again, but it
	// cannot be spent again — the record and the budget both hold, and a reader
	// who keeps pushing in one gesture gets one chunk rather than a chain.
	const spent = [];
	let t = 300;
	for (let i = 0; i < 20; i++) {
		t += 100;
		state = wheelUp(state, t, { atHardTop: true, travelledPx: 500 });
		const frame = decide(
			state,
			geo({ distanceFromTopPx: 0 }),
			t + SETTLE_MS + 1,
		);
		state = frame.state;
		if (frame.action !== "none") {
			spent.push(frame.action);
			state = noteSettled(state);
		}
	}
	assert.deepEqual(
		spent,
		[],
		`one act, one fetch, however much travel it contains (got ${spent})`,
	);

	// A fresh act: quiet past GESTURE_GAP_MS, then a push. The budget clears,
	// and the arrival is answered — and its own spend latches.
	state = wheelUp(state, t + GESTURE_GAP_MS + 1, { atHardTop: true });
	const arrival = decide(
		state,
		geo({ distanceFromTopPx: 0 }),
		t + GESTURE_GAP_MS + 1 + SETTLE_MS + 1,
	);
	assert.equal(arrival.action, "fetch");
	assert.ok(arrival.state.clampLatched, "and the arrival's own spend latches");
});

// NEGATIVE GUARD: passes against the replaced module as well. It protects
// behaviour the fix depends on (a bound, an upper limit, an accident that is now
// a contract), not behaviour the fix introduces, so it is evidence about the
// blast radius rather than about the change.
test("travel below TRAVEL_MIN_PX does not re-arm", () => {
	// 24px is the clamp-follow the browser performs when a landing grows the
	// extent under a pinned reader, and it is deliberately below the threshold:
	// a landing is not the reader moving, so it must not release the latch.
	let state = wheelUp(initialPagingState(), 0, { atHardTop: true });
	state = noteSettled(
		decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1).state,
	);
	assert.ok(state.clampLatched);

	let spent = 0;
	let t = SETTLE_MS + 2;
	for (let i = 0; i < 30; i++) {
		t += 10;
		state = wheelUp(state, t, {
			atHardTop: true,
			travelledPx: TRAVEL_MIN_PX - 40,
		});
		const frame = decide(state, geo({ distanceFromTopPx: 0 }), t + 8);
		state = frame.state;
		if (frame.action !== "none") {
			spent++;
			state = noteSettled(state);
		}
	}
	assert.equal(spent, 0, `sub-threshold movement is not travel (got ${spent})`);
});

// NEGATIVE GUARD: passes against the replaced module as well. It protects
// behaviour the fix depends on (a bound, an upper limit, an accident that is now
// a contract), not behaviour the fix introduces, so it is evidence about the
// blast radius rather than about the change.
test("extent growth under a clamped reader is not travel", () => {
	// The case that protects rule 4's memory bound, and the shape it has to
	// survive: a page lands under a reader pinned at the wall (measured:
	// scrollHeight +24px with scrollTop -24px and NO input), the browser moves
	// the offset to keep them pinned, and what the DOM half hands the policy is
	// the NET of that — zero, because the clamp-follow is subtracted there. The
	// policy must therefore spend nothing. The subtraction itself is a
	// MEASUREMENT, not a decision, so it is proven on the real scroller by the
	// harness's `page-lands-with-rows-hidden` scenario rather than here.
	let state = wheelUp(initialPagingState(), 0, { atHardTop: true });
	state = noteSettled(
		decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1).state,
	);
	let spent = 0;
	let t = SETTLE_MS + 2;
	for (let i = 0; i < 200; i++) {
		t += 10;
		state = wheelUp(state, t, { atHardTop: true, travelledPx: 0 });
		const frame = decide(state, geo({ distanceFromTopPx: 0 }), t + 8);
		state = frame.state;
		if (frame.action !== "none") {
			spent++;
			state = noteSettled(state);
		}
	}
	assert.equal(
		spent,
		0,
		`a held gesture at the top is one act, not 200 (got ${spent})`,
	);
});

// NEGATIVE GUARD: passes against the replaced module as well. It protects
// behaviour the fix depends on (a bound, an upper limit, an accident that is now
// a contract), not behaviour the fix introduces, so it is evidence about the
// blast radius rather than about the change.
test("a demand armed off the wall survives the clamped notches it is swallowed beside", () => {
	// The load-bearing behaviour that was ACCIDENTAL until this change: a notch
	// that arrives while the reader is OFF the hard top arms a demand, and the
	// swallow branch preserves it — so the arrival at the next wall spends it.
	// Measured twice inside one act on the real surface (widens at t=10019 and
	// t=12747). Written as `{ ...base, lastInputAt }` the swallow would eat that
	// demand and the reader would have to jitter the wheel to get it back, which
	// is the workaround this whole change exists to remove.
	//
	// What the arrival can buy is bounded by rule 2: this act already spent its
	// fetch, so the preserved demand is refused here and answered by the next
	// act — the demand outliving the swallow, not the budget it runs into.
	let state = wheelUp(initialPagingState(), 0, { atHardTop: true });
	state = noteSettled(
		decide(state, geo({ distanceFromTopPx: 0 }), SETTLE_MS + 1).state,
	);
	assert.ok(state.clampLatched);

	// Off the wall, with no travel claimed: leaving the top is its own
	// authorisation, and a notch that moved the reader needs none.
	state = wheelUp(state, 200, { travelledPx: 0 });
	assert.ok(state.armed, "a notch away from the wall arms a demand");

	// Back at the wall inside the same act: swallowed, and the demand survives.
	state = wheelUp(state, 240, { atHardTop: true, travelledPx: 0 });
	assert.ok(state.armed, "the demand survives the swallow");
	assert.equal(
		decide(state, geo({ distanceFromTopPx: 0 }), 240 + SETTLE_MS + 1).action,
		"none",
		"and the act's spent fetch is not spent twice",
	);

	// The next act is answered.
	state = wheelUp(state, 240 + GESTURE_GAP_MS + 1, { atHardTop: true });
	assert.equal(
		decide(
			state,
			geo({ distanceFromTopPx: 0 }),
			240 + GESTURE_GAP_MS + 1 + SETTLE_MS + 1,
		).action,
		"fetch",
	);
});

test("a slow approach inside the zone is spent once it settles there", () => {
	// THE OPERATOR'S REPORT, on the reader who is NOT flinging. The version this
	// replaces asserted the opposite — a moving reader inside the zone was spent
	// at their input cadence — and that mid-motion spend is what put a mount
	// under a travelling viewport. The window itself is unchanged: a demand is
	// spendable exactly inside the same zone, and one pixel outside it is dropped
	// at the settle rather than held. The trigger moved from "their cadence" to
	// "their stop", which is the terminal UI's contract (`_check_resume_page`
	// defers while animating).
	const clientHeight = 489;
	const slow = 0.3; // px/ms: a deliberate scroll, ~300px/s
	let state = initialPagingState();
	for (let i = 0; i < 5; i++) {
		state = wheelUp(state, 1000 + i * 10, {
			// Kept for the replaced module's benefit: its lead spends this
			// reader's demand at their input cadence, mid-motion, which is what
			// the first assertion discriminates against.
			travelVelocityPxPerMs: slow,
			travelledPx: slow * 10,
		});
	}
	const inside = geo({ clientHeight, distanceFromTopPx: 300, hiddenRows: 40 });

	// 40ms after the last notch: well inside SETTLE_MS (120), so this frame is
	// the trigger question and nothing else. The demand waits.
	const midMotion = decide(state, inside, 1080);
	assert.equal(
		midMotion.action,
		"none",
		"a moving reader is not spent at their input cadence",
	);
	assert.equal(
		midMotion.state.armed,
		true,
		"the demand waits for the stop rather than being dropped",
	);

	// Their stop, inside the zone: spent.
	assert.equal(
		decide(state, inside, 1040 + SETTLE_MS + 1).action,
		"widen",
		"the stop inside the zone is a spend",
	);

	// One pixel outside the zone at the same stop: dropped, not held for a later
	// frame to spend.
	const outside = decide(
		state,
		geo({ clientHeight, distanceFromTopPx: prefetchZonePx(clientHeight) + 1 }),
		1040 + SETTLE_MS + 1,
	);
	assert.equal(outside.action, "none");
	assert.equal(
		outside.state.armed,
		false,
		"stale demand dropped, not retained",
	);
});

/*
 * THE PAINT IS NOT THE DEMAND. `use-scroll-paging.ts` paints the slot's
 * "Loading earlier messages" from `spendWindows`, so a demand `decide` has
 * REFUSED must not satisfy it: a reader following the tail arms a demand on
 * their first upward notch, the `followingTail` guard returns before the armed
 * branch, and the demand stays armed — retained for when they come back — while
 * nothing is requested and nothing is in flight. Before the gate, that state
 * painted a spinner and announced "Loading earlier messages" through the slot's
 * `aria-live` region (review round 2, R2-3a).
 *
 * The case asserts both halves, because either alone is not the claim: the
 * refusal (`action: "none"`, `armed: true`) and the window answer the paint is
 * computed from (outside the zone at 6000px, inside it at 300px). It also
 * asserts the composite expression the DOM half uses, so a later edit to that
 * expression has to face this case rather than a comment — which is what round 3
 * asked for (R3-5), the gate having shipped with no case of its own.
 */
test("a demand the tail refuses stays armed and outside its spend window", () => {
	const at = GESTURE_GAP_MS;
	const state = wheelUp(initialPagingState(), at, { travelledPx: 30 });
	// Inside SETTLE_MS, so only the window can authorise a spend: this is the
	// frame the pump sees between one notch and the next.
	const now = at + 40;
	const tail = geo({
		distanceFromTopPx: 6000,
		followingTail: true,
		hiddenRows: 0,
		hasMore: true,
	});

	const decided = decide(state, tail, now);
	assert.equal(decided.action, "none", "the tail guard refuses to spend");
	assert.equal(
		decided.state.armed,
		true,
		"and retains the demand rather than dropping it",
	);

	const windows = spendWindows(tail);
	assert.equal(
		windows.inZone,
		false,
		"6000px from the top is outside the zone",
	);
	assert.equal(
		decided.action !== "none" ||
			decided.state.busy ||
			decided.state.pageWidenOwed ||
			(decided.state.armed && windows.inZone),
		false,
		"so the paint expression use-scroll-paging.ts computes stays off",
	);

	// Not simply always-off: the same armed demand, the same instant, inside the
	// zone, is in the window — which is why the paint has to be gated on the
	// window rather than on `armed` or on the window alone.
	const inside = spendWindows(geo({ distanceFromTopPx: 300 }));
	assert.equal(
		inside.inZone,
		true,
		"inside the zone the same demand is spendable",
	);
});
