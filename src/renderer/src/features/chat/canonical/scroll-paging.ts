/**
 * When the transcript is allowed to reveal older conversation, and by how much
 * the scroller must be corrected so the reader does not see it happen.
 *
 * This module is deliberately pure: no React, no DOM, no timers. The hard part
 * of scroll-driven paging is not the fetch, it is the policy — which motion
 * counts as a request for more history, how many requests a fling is allowed to
 * become, and when a gesture that is merely resting against the top edge stops
 * being a request at all. That policy is a state machine, and a state machine
 * that can only be exercised by flinging a real trackpad is a state machine
 * nobody can prove. `scripts/transcript-paging.test.mjs` drives every clause
 * below in memory.
 *
 * The semantics mirror the terminal UI's bounded-resume paging
 * (in the sibling `local-operator` repository — `local_operator/tui/app.py`:
 * `_transcript_scrolled`, `_check_resume_page`; `local_operator/tui/widgets/
 * transcript.py`: the latch contract documented on `_on_user_scroll`), so a
 * reader who learned how history loads in the terminal
 * meets the same behaviour here. Where this file diverges it says so and why —
 * the two surfaces have different input vocabularies (a wheel is not a Textual
 * key binding) and different units (pixels, not terminal rows).
 *
 * The six rules, in the order they bite:
 *
 * 1. DEMAND IS INPUT, NEVER LAYOUT. Only a real upward gesture arms a demand.
 *    A resize, a streaming token lengthening the transcript, an image settling
 *    into its intrinsic height, or this module's own anchor correction all move
 *    the scroll offset, and none of them is a reader asking for more history.
 *    The caller is responsible for only reporting real input to `noteInput`;
 *    this module never infers demand from geometry alone.
 * 2. AT MOST ONE DEMAND, AT MOST ONE RETAINED, AND ONE FETCH PER ACT. A fling
 *    is dozens of wheel events; it is one request for older messages. While a
 *    page is in flight a further gesture retains exactly one follow-up demand,
 *    and a downward gesture cancels it — the reader turned around, so the debt
 *    is void. An ACT spends at most one round trip, however many walls the
 *    reader's momentum crosses — in EITHER direction: a reversal inside one
 *    act (a downward notch, then up again, both inside `GESTURE_GAP_MS`) voids
 *    the retained demand and the latch, but it does NOT refill the budget, so
 *    a jiggle is still one act and one round trip (round-3 review F1/Q2). The
 *    operator's report is what an unbounded
 *    chain looks like ("it keeps loading in chunks and goes into a loop until
 *    it loads all the way back to the start"), and the terminal UI's contract
 *    is the same one — `_check_resume_page` spends one page, and the next
 *    request needs a fresh act. The act's network budget is `actFetchSpent`;
 *    the next fetch after it needs `GESTURE_GAP_MS` of quiet and a new push,
 *    or the deliberate affordance. A FAILED fetch does not spend the budget —
 *    rule G's bounded retry owns that case, so the reader's live gesture
 *    asking again is honoured (round-1 review F2). Local widens are not
 *    budgeted, because they show the reader rows already in hand rather than
 *    crossing the network.
 * 3. SPEND WHEN THE MOTION HAS SETTLED, OR AT THE HARD TOP. A demand is spent
 *    after `SETTLE_MS` of input silence, or at the hard top where the content
 *    has stopped moving because it cannot move further. There is deliberately
 *    no third trigger: a reveal dispatched while the viewport TRAVELS lands
 *    under a moving reader, and every freshly mounted wall in front of that
 *    reader bought the next spend — the chain the operator reported as "it
 *    keeps me at the same percentage of scroll which then keeps me at the
 *    top". The discriminating readings are the committed frames: reveals
 *    dispatched on approach fall to 3→1, 3→1, 7→0, 6→1, and the anchor hold's
 *    own frame delta (`maxAnchorFrameDeltaPx`) is 0 on both arms. (The
 *    distance-from-top figure is NOT quoted for this — it spans the reader's
 *    own wheel motion and the fixed arm reproduces it; round-3 review F3.) The terminal UI behaves the same way and it is
 *    the feel this surface is asked to match: its `_check_resume_page` defers
 *    while the scroller is animating and spends at a stop or against the edge.
 * 4. THE LATCH DOES NOT RE-ARM UNDER A CLAMPED GESTURE. A held scrollbar or a
 *    trackpad resting at the top emits input indefinitely while the content is
 *    already as far up as it goes. That is one act, not a thousand, so after a
 *    demand has been spent at the hard top only a DELIBERATE act re-arms it —
 *    clicking the affordance, or a keystroke that means "start of
 *    conversation". This is the clause that stops a resting finger from
 *    walking the whole conversation into memory.
 * 5. LOCAL GROWTH BEFORE NETWORK GROWTH. Rows already fetched but not mounted
 *    (the render window) are free to reveal; a durable page is a round trip.
 *    Revealing both for one gesture would show the reader two reveals stacked,
 *    so the window is widened first and the network is only reached once the
 *    window holds everything it has.
 * 6. A LANDED DURABLE PAGE OWES THE WIDEN THAT MAKES IT VISIBLE. A page can
 *    land with its rows still held back by the render window — measured: rows
 *    200 -> 200 with `hiddenRows` 0 -> 60 — which is a reveal the reader cannot
 *    see while the slot tells them to scroll up for it. Exactly one widen is
 *    authorised per landed page, and only while that page's rows are actually
 *    held back, so the chain bound rule 5's history needed is untouched: the
 *    one widen a page needs to be seen at all is not a chain.
 */

/**
 * Input silence, in milliseconds, before an armed demand may be spent.
 *
 * 120ms is about two frames past the end of a trackpad gesture's momentum
 * reporting and well inside the ~200ms at which a delay reads as a response
 * rather than as lag. Lower and a fling's own gaps split it into several
 * demands; higher and a reader who stops at the top waits on us visibly.
 */
export const SETTLE_MS = 120;

/**
 * Quiet period after which further input counts as a NEW gesture.
 *
 * Bounds an ACT rather than a position: the clamp latch (rule 4) refuses to
 * re-arm while one gesture keeps reporting itself against the top edge, and
 * this is what tells it that gesture is over. 400ms clears a trackpad's
 * momentum tail — which keeps emitting for a few hundred ms after the fingers
 * lift, and would otherwise split one flick into several acts — while staying
 * far below the pause between two deliberate flicks.
 */
export const GESTURE_GAP_MS = 400;

/**
 * The prefetch zone: how close to the top of the content a demand may be spent,
 * as a fraction of the viewport with a floor and a ceiling.
 *
 * The terminal UI uses `RESUME_PAGE_TRIGGER_ROWS = 4` — four rows short of the
 * top, so the reader never hits a hard stop and concludes the conversation
 * starts there. Rows here have no fixed height (one is a line of prose, the
 * next is a fifty-line tool output), so the equivalent is expressed against the
 * one length that is always meaningful: the viewport. Half a viewport is the
 * distance a reader covers in roughly one deliberate scroll, which is the
 * budget the page has to arrive in.
 *
 * The floor keeps the zone usable in a short window (a narrow side panel), and
 * the ceiling stops a tall display from arming a demand while the reader is
 * still most of a screen away from needing it.
 */
export const ZONE_FRACTION = 0.5;
export const ZONE_MIN_PX = 320;
export const ZONE_MAX_PX = 900;

/**
 * Movement of the reader's OWN notches since the latch was set, above which the
 * gesture is travelling rather than resting.
 *
 * 64px sits above the 24px clamp-follow the browser performs when a landing
 * grows the extent under a pinned reader (measured: `scrollHeight` +24px with
 * `scrollTop` -24px and no input at all) and below the 80px a real travelling
 * notch moves at the wall. What it guards is rule 4's memory bound: a resting
 * finger's notches move the content by ZERO (measured: 62 consecutive clamped
 * notches, `scrollTop` constant), so they can never clear the latch.
 */
export const TRAVEL_MIN_PX = 64;

/**
 * Distance from the top edge within which the content counts as clamped.
 *
 * Not zero: fractional device pixels and the sub-pixel arithmetic of a
 * `column-reverse` scroller mean the hard top is reached at 0.5px as often as
 * at exactly 0.
 */
export const HARD_TOP_PX = 2;

/** Distance from the newest row within which the reader is following the tail. */
export const TAIL_EPS_PX = 24;

/**
 * Consecutive durable-page failures after which only a deliberate act retries.
 *
 * Bounded rather than absent because the common failure is transient (the
 * backend is restarting, the socket is reattaching) and asking the reader to
 * click through a blip is worse than trying again. Bounded rather than
 * unbounded because a persistent failure plus an automatic retry is a loop that
 * hammers a backend nobody is watching. The terminal UI caps its own
 * invalidation retries the same way (`_OLDER_PAGE_MAX_RETRIES`) and then states
 * the fault instead of live-locking.
 */
export const MAX_AUTO_ATTEMPTS = 3;

/**
 * Durable pages a transcript that cannot scroll may chain without a gesture.
 *
 * A conversation shorter than the viewport has no scrollbar, so there is no
 * upward gesture available to ask with, and a reader would be left looking at a
 * "Load earlier messages" button as the only way to see a conversation that
 * already fits on screen. Four pages of 100 rows is far past the point where the
 * scroller becomes scrollable in any real window, so the bound is a stop against
 * a pathological transcript (thousands of empty records), not a normal limit.
 */
export const MAX_CHAIN_FETCH = 4;

/**
 * Local-window widenings one reveal may chain.
 *
 * Free in the sense that matters here — no round trip — but not free to mount,
 * so it is still bounded. Twelve steps of `WINDOW_STEP` rows covers any
 * viewport; the bound exists so a bug in the geometry cannot spin.
 */
export const MAX_CHAIN_WIDEN = 12;

/**
 * Anchor drift below which no correction is applied.
 *
 * Sub-pixel drift is measurement noise from `getBoundingClientRect`, and
 * writing `scrollTop` to chase it would emit a scroll event per frame for a
 * displacement no reader can see.
 */
export const ANCHOR_EPSILON_PX = 0.5;

/** What a spent demand asks the view to do. */
export type PagingAction = "none" | "widen" | "fetch";

export type PagingState = {
	/** A demand is armed and waiting to be spent. */
	armed: boolean;
	/**
	 * The armed (or retained) demand came from an explicit ask rather than from
	 * a gesture, so it bypasses the zone and the settle debounce: a reader who
	 * clicked "Load earlier messages" is not making a prediction about where
	 * they are, they are stating what they want.
	 */
	deliberate: boolean;
	/** One follow-up demand held while a reveal is in flight. */
	retained: boolean;
	/** A reveal is in flight; nothing else may be spent. */
	busy: boolean;
	/**
	 * The previous reveal settled and may legitimately be followed by another
	 * without fresh input — the local window still has rows in the zone, or the
	 * scroller is still not scrollable. Bounded by the chain counters.
	 */
	continuation: boolean;
	/** A demand has been spent at the hard top; see rule 4. */
	clampLatched: boolean;
	/**
	 * The act that is live right now has already spent its round trip.
	 *
	 * Rule 2's budget, and the one thing that bounds a document-order chain:
	 * a fling's momentum can cross wall after wall as each reveal mounts the
	 * next one, and every crossing looks like a fresh arrival. It is not — the
	 * act is one gesture, and the operator's report (a scroll-up that loads
	 * every remaining page in a loop) is what spending per crossing produces.
	 * Set by a `fetch` spend; cleared by a notch that OPENS A NEW ACT — the
	 * notch's own direction does not matter — and by a deliberate one; widens
	 * are deliberately not
	 * budgeted, because showing rows the reader already has is not a request.
	 */
	actFetchSpent: boolean;
	/**
	 * The reader's own notches have moved since the CURRENT latch was set.
	 *
	 * Movement, not position — and a record rather than a decision: the swallow
	 * branch of `noteInput` uses it to release the latch exactly once per ACT, so
	 * the arrival a travelling reader makes at the wall is a fresh arrival rather
	 * than a swallowed one, while a finger resting on the top edge (whose notches
	 * move the content by nothing) can never earn the release at all. Cleared when
	 * a notch opens a new act and when the reader turns around — one release per
	 * act is the same unit every other bound in this file is expressed in, and it
	 * is what a held gesture's 200 notches are measured against.
	 */
	travelledSinceLatch: boolean;
	/**
	 * A durable page landed with rows still held back, and owes exactly one
	 * widen so the reader can see what they just fetched. See rule 6.
	 */
	pageWidenOwed: boolean;
	/**
	 * The reader turned around while a reveal was in flight.
	 *
	 * Distinct from simply clearing `retained`, because the reveal still has to
	 * land and landing is what normally offers a continuation. Without this, a
	 * downward gesture would cancel the demand it can see and the settle would
	 * immediately mint another one: the cancellation would hold for one page and
	 * then quietly stop holding.
	 */
	turnedAround: boolean;
	/** When the last real input arrived, for the settle debounce. */
	lastInputAt: number;
	/** Consecutive durable-page failures. */
	failures: number;
	chainFetch: number;
	chainWiden: number;
};

export type PagingInput = {
	direction: "up" | "down";
	/**
	 * A free-running gesture (wheel, trackpad, scrollbar drag, touch drag) as
	 * opposed to a discrete act (a keystroke, an affordance activation). Only
	 * the continuous kind is subject to the clamp latch, because only the
	 * continuous kind repeats without the reader doing anything further.
	 */
	continuous: boolean;
	/** An explicit ask: the affordance, or a start-of-conversation keystroke. */
	deliberate: boolean;
	/** Whether the content was already against its top edge when this arrived. */
	atHardTop: boolean;
	/**
	 * How far the reader's own notches moved the content since the previous
	 * input, in px, with the browser's clamp-follow already subtracted by the
	 * DOM half: a landing that grows the extent under a pinned reader moves
	 * `scrollTop` by the growth, and that is the layout moving, not the reader.
	 */
	travelledPx: number;
	at: number;
};

export type PagingGeometry = {
	/** Pixels between the viewport's top edge and the top of the content. */
	distanceFromTopPx: number;
	clientHeight: number;
	/** Rows the render window is holding back. */
	hiddenRows: number;
	/** Durable pages remain on the backend. */
	hasMore: boolean;
	scrollable: boolean;
	/** The reader is at, and following, the newest row. */
	followingTail: boolean;
};

export const initialPagingState = (): PagingState => ({
	armed: false,
	deliberate: false,
	retained: false,
	busy: false,
	continuation: false,
	clampLatched: false,
	actFetchSpent: false,
	travelledSinceLatch: false,
	pageWidenOwed: false,
	turnedAround: false,
	// Not `Date.now()`: a state created at mount would otherwise hold the settle
	// debounce closed for its first 120ms, which is exactly the window the
	// short-transcript chain (rule 5's `!scrollable` path) needs to start in.
	lastInputAt: Number.NEGATIVE_INFINITY,
	failures: 0,
	chainFetch: 0,
	chainWiden: 0,
});

/** The prefetch zone for a viewport of this height. See `ZONE_FRACTION`. */
export const prefetchZonePx = (clientHeight: number): number =>
	Math.min(
		ZONE_MAX_PX,
		Math.max(ZONE_MIN_PX, Math.round(clientHeight * ZONE_FRACTION)),
	);

/**
 * Fold one real input event into the demand state.
 *
 * Everything that distinguishes a gesture from a click is decided here rather
 * than at the DOM edge, so the DOM listeners stay a translation layer with no
 * policy in them.
 */
export const noteInput = (
	state: PagingState,
	input: PagingInput,
): PagingState => {
	if (input.direction === "down") {
		// Rule 2: the reader turned around. Everything pending is void — including
		// the clamp latch, because leaving the top is precisely the act that makes
		// the next arrival at the top a new arrival. `actFetchSpent` is NOT among
		// the voided fields: one act spends one round trip in either direction,
		// so a reversal only voids the retained demand. The budget refills when a
		// new act opens (`GESTURE_GAP_MS` of quiet and a fresh push) or on a
		// deliberate ask. Clearing it here let a down/up jiggle inside one act
		// spend twice (round-3 review F1 / QA Q2).
		return {
			...state,
			armed: false,
			deliberate: false,
			retained: false,
			// The notch that OPENS an act refills the budget whatever its
			// direction, and this branch returns before the shared act-open test
			// below can run — so it is mirrored here. A paused reader whose first
			// notch is downward is in a new act, and the push that follows must be
			// answered; only a reversal INSIDE one act keeps the act spent
			// (round-3 review F1, its own follow-up).
			actFetchSpent:
				input.at - state.lastInputAt >= GESTURE_GAP_MS
					? false
					: state.actFetchSpent,
			continuation: false,
			clampLatched: false,
			// The travel the release below is earned by belongs to the latch, and
			// the reader has just left the wall: there is nothing left to release.
			travelledSinceLatch: false,
			// The reader turned around. A page that landed with rows held back is
			// still holding them back, but a reader scrolling AWAY from it is not
			// waiting to see it, and spending a widen on their behalf would grow
			// the content under the direction they are travelling.
			pageWidenOwed: false,
			turnedAround: state.busy,
			chainFetch: 0,
			chainWiden: 0,
			lastInputAt: input.at,
		};
	}
	/*
	 * Where an ACT ends, and why that is a separate question from settling.
	 *
	 * `GESTURE_GAP_MS` is the quiet period that separates two acts. It is longer
	 * than `SETTLE_MS` on purpose: settling decides when a demand may be SPENT
	 * (the motion has stopped), while this decides when a new demand may be
	 * ARMED (the reader has let go and pushed again). A trackpad's momentum
	 * phase emits for a few hundred ms after the fingers lift, so anything
	 * shorter would split one flick into several acts.
	 *
	 * Without this the latch was a position bound rather than a gesture bound:
	 * once it had been set at the hard top it refused every later notch from the
	 * same position forever, so a reader parked at the top of a partially-loaded
	 * conversation could flick as often as they liked and never get another page
	 * (measured: four separate gestures, 0 pages, the slot stuck on "Load
	 * earlier messages"). Under round 1's design the continuation chain hid this
	 * by mounting everything up front; with one reveal per act the latch had to
	 * learn where an act ends.
	 */
	const gestureEnded = input.at - state.lastInputAt >= GESTURE_GAP_MS;
	// A fresh upward gesture is a fresh budget: the chain counters exist to bound
	// what happens WITHOUT input, so input clears them. A notch that OPENS A NEW
	// ACT clears the act's network budget with them (rule 2): "one fetch per
	// act" is a fact about the act, so it cannot outlive the act it bounds.
	const base: PagingState = {
		...state,
		actFetchSpent: gestureEnded ? false : state.actFetchSpent,
		// The travel record belongs to the latch's own act; a notch that opens a
		// new act starts a new question, and the release it guards is one per
		// latch rather than one per reader.
		travelledSinceLatch: gestureEnded ? false : state.travelledSinceLatch,
		continuation: false,
		turnedAround: false,
		chainFetch: 0,
		chainWiden: 0,
		lastInputAt: input.at,
	};
	if (input.deliberate) {
		// Rule 4's escape hatch, and rule G's: an explicit ask re-arms the latch
		// and forgives the failure count, because the reader has now seen the
		// failure and chosen to try anyway.
		return {
			...base,
			clampLatched: false,
			failures: 0,
			deliberate: true,
			// An explicit ask is its own act: whatever the previous gesture spent
			// says nothing about the click the reader just made.
			actFetchSpent: false,
			...(state.busy ? { retained: true } : { armed: true }),
		};
	}
	// A gesture ENDS when input stops; the next notch after that is a new act.
	// See the note on `gestureEnded` above.
	if (
		input.atHardTop &&
		input.continuous &&
		state.clampLatched &&
		!gestureEnded
	) {
		// Rule 4. The gesture is still running but the content is not; this is the
		// same act that already spent its demand.
		//
		// Only the input clock moves - NOT the chain budgets, which is the whole
		// difference between a bound and a formality. `base` resets them on the
		// theory that a fresh gesture deserves a fresh budget, and a clamped notch
		// is precisely the input that is not fresh: 200 of them against the top
		// edge would hand out 200 new budgets of four pages each, and the counters
		// that bound the continuation (now the only thing bounding it, since the
		// chain no longer consults the latch) would never reach their limit.
		// The test that caught this drives 200 clamped notches and asserts zero
		// pages.
		//
		// `armed` travels through this branch UNTOUCHED, by the spread rather
		// than by intent - and that is load-bearing. A reader who leaves the wall,
		// re-arms on the way, and arrives back at it has their arrival notch
		// swallowed here (it is clamped and in-act), yet the demand it is beside
		// survives and `decide` spends it on the same frame. Written as
		// `{ ...base, lastInputAt }` this branch would drop that demand and the
		// reader would be refused the reveal their travel earned. It has its own
		// case now rather than being a property of a spread a refactor can delete.
		//
		// The one way OUT of this branch is A4's travel record: a notch that
		// PROVABLY moved the reader (>= TRAVEL_MIN_PX of their own motion, with the
		// browser's clamp-follow already subtracted) is a reader arriving at the
		// wall, not a finger resting on it, so the latch is released once and this
		// arrival becomes a fresh one. `travelledSinceLatch` bounds that to a
		// single release per latch: a resting finger's notches move the content by
		// zero, so they can never take this exit at all.
		if (input.travelledPx >= TRAVEL_MIN_PX && !state.travelledSinceLatch) {
			return {
				...base,
				armed: true,
				clampLatched: false,
				travelledSinceLatch: true,
			};
		}
		return {
			...state,
			lastInputAt: input.at,
		};
	}
	if (state.busy) return { ...base, retained: true };
	return { ...base, armed: true };
};

const spend = (
	state: PagingState,
	action: Exclude<PagingAction, "none">,
	geo: PagingGeometry,
): { action: PagingAction; state: PagingState } => ({
	action,
	state: {
		...state,
		armed: false,
		deliberate: false,
		busy: true,
		continuation: false,
		// Latch only when an INPUT demand was spent against the top edge. Two
		// conditions, each load-bearing:
		//
		// - `state.armed` — the latch is about input repeating without the reader
		//   doing anything further, so a continuation (which has no input behind
		//   it and is bounded by its own counters) must not set it. Rule L's
		//   unscrollable transcript sits at distance 0 by construction; latching
		//   there would end the chain after one page.
		// - at the top edge — a demand spent from inside the prefetch zone leaves
		//   the latch open, because the reader still has room to keep scrolling
		//   and every further notch is real movement rather than the same one
		//   reported again.
		clampLatched:
			state.clampLatched ||
			(state.armed && geo.distanceFromTopPx <= HARD_TOP_PX),
		// Note the asymmetry this creates, and why it is the point of A1/A2
		// rather than an oversight: a demand spent from inside the prefetch zone
		// (the reader settled there; the spend waited for that, rule 3) is not at
		// `distanceFromTopPx <= HARD_TOP_PX` and sets no latch, because the reader
		// still has room to keep scrolling. Their arrival at the wall is then a
		// fresh, unlatched demand, which buys the local widen that makes the page
		// they are waiting for visible -- one reveal for the page, one for the
		// widen, and progress on screen instead of a dead stop. The latch keeps
		// meaning exactly what rule 4 says it means: input repeating against an
		// edge that cannot move.
		//
		// A4's travel record is NOT reset here. `spend` opens a new latch, but the
		// release the record guards is bounded per ACT rather than per latch — see
		// `travelledSinceLatch` — and an act that has already been released once
		// must not be released again by the next arrival inside it.
		//
		// A WIDEN is the only spend that settles the rule-6 debt, because a widen is
		// the only action that puts the page's held-back rows on screen: a widen
		// therefore clears `pageWidenOwed` whether it was the debt itself or an
		// ordinary armed widen. A `fetch` cannot reach here with the flag set —
		// `decide` only offers `fetch` when `hiddenRows === 0`, and the flag is set
		// only when rows are held back — so this expression's effect on a fetch is
		// unreachable rather than meaningful, which is what the comment here used to
		// get the wrong way round (review round 1, R1-8).
		pageWidenOwed: state.pageWidenOwed && action !== "widen",
		// Rule 2's act budget, latched by a ROUND TRIP. A widen is the reader's own
		// rows being shown to them and spends nothing from the budget.
		actFetchSpent: action === "fetch" ? true : state.actFetchSpent,
		chainWiden: action === "widen" ? state.chainWiden + 1 : state.chainWiden,
		chainFetch: action === "fetch" ? state.chainFetch + 1 : state.chainFetch,
	},
});

/**
 * The window a demand is spent from, right now.
 *
 * Exported because the DOM half has to answer the same question for the top
 * row's paint and cannot answer it by re-deriving it. `use-scroll-paging`
 * mirrored `state.armed` into the slot unconditionally, so any armed demand
 * painted "Loading earlier messages" at a reader following the tail — a demand
 * `decide` refuses there (the `followingTail` guard returns before the armed
 * branch) and keeps refusing until they travel closer. That is a false
 * statement, and a false `aria-live` announcement, in the one surface this
 * change exists to stop lying in (review round 2, R2-3a).
 *
 * A demand inside the zone is one the policy is about to spend: at the
 * reader's settle if they stop inside it, or at the wall if the motion carries
 * them there first (the wall is inside the zone by construction). Outside it
 * the demand is a request waiting for the reader to come back, and the row must
 * say so rather than claim a load.
 */
export function spendWindows(
	geo: PagingGeometry,
	zonePx = prefetchZonePx(geo.clientHeight),
): { inZone: boolean } {
	return { inZone: geo.distanceFromTopPx <= zonePx };
}

/**
 * Decide whether to spend a demand now, and on what.
 *
 * Called from a rAF-coalesced pump, so it must be cheap and must be safe to
 * call on frames where nothing should happen — which is most of them. It
 * returns the next state rather than mutating, so the caller can keep the whole
 * policy in one ref and the test can keep it in a local.
 */
export const decide = (
	state: PagingState,
	geo: PagingGeometry,
	now: number,
): { action: PagingAction; state: PagingState } => {
	if (state.busy) return { action: "none", state };

	// Rule 5: local window first, network second. `hiddenRows` is what the render
	// window is holding back; only when it holds nothing is a page the next
	// growth available.
	const growth: PagingAction =
		geo.hiddenRows > 0 ? "widen" : geo.hasMore ? "fetch" : "none";
	if (growth === "none") {
		// Nothing left to reveal. Disarm rather than hold a demand that a later
		// page arriving from elsewhere (a live turn, a session reload) would let
		// fire without the reader having asked for anything.
		return {
			action: "none",
			state:
				state.armed || state.continuation
					? { ...state, armed: false, deliberate: false, continuation: false }
					: state,
		};
	}

	// A reader pinned to the newest row is reading the present. Growing the past
	// under them is at best invisible and at worst drags them; either way they
	// did not ask.
	//
	// `scrollable` is load-bearing, and leaving it out made clause L dead code.
	// Both terms are computed from ONE number: `followingTail` is
	// `|scrollTop| <= TAIL_EPS` and `scrollable` is `scrollHeight - clientHeight
	// > 1`. An unscrollable transcript has `scrollTop === 0` by construction, so
	// `!scrollable` STRICTLY IMPLIES `followingTail` — a bare tail guard returned
	// here every time and the short-content branch below could never be reached.
	// A reader looking at a conversation that does not fill its viewport is not
	// "following the tail" in any sense they would recognise: they can see the
	// whole thing at once, including its first row.
	if (geo.followingTail && geo.scrollable) return { action: "none", state };

	const zonePx = prefetchZonePx(geo.clientHeight);
	/*
	 * Rule 3's trigger, and the reason the spend waits for stillness.
	 *
	 * There used to be a third window here — a LEAD projected forward from the
	 * reader's measured speed, so a fast approach was spent while still moving.
	 * It was removed in response to the operator's report, and the report is
	 * what the removal rests on: a reveal dispatched mid-motion mounts rows
	 * under a moving viewport, the anchor hold is deliberately invalidated by
	 * every reader notch (#461), and the corrected frame arrives after the one
	 * the eye saw — while every freshly mounted wall in
	 * front of the reader bought the next spend, which is the operator's loop
	 * ("it keeps me at the same percentage of scroll which then keeps me at the
	 * top which then keeps loading in chunks"). The committed readings that
	 * discriminate are the on-approach dispatch counts (3→1, 3→1, 7→0, 6→1)
	 * and the anchor hold's own 0px frame delta on both arms;
	 * `maxDistanceFrameDeltaPx` is NOT quoted for this — it spans the reader's
	 * own wheel motion and the fixed arm reproduces it (round-3 review F3).
	 *
	 * So the two terms below are the whole trigger set, and both are stops rather
	 * than predictions: the settle debounce, and the hard top, where the content
	 * cannot move even though the finger still can. The terminal UI — the surface
	 * the operator asked this one to match — does the same thing literally: its
	 * `_check_resume_page` returns while `animator.is_being_animated` and spends
	 * at the stop.
	 */
	// ONE computation of the window, shared with the DOM half's paint (see
	// `spendWindows`): a second copy over there is how the slot came to claim a
	// load the policy had already refused.
	const { inZone } = spendWindows(geo, zonePx);
	const settled =
		now - state.lastInputAt >= SETTLE_MS ||
		geo.distanceFromTopPx <= HARD_TOP_PX;

	/*
	 * Rule 6's debt is paid FIRST, ahead of every prediction about where the
	 * reader is, because it is not a prediction: the rows exist, the slot has told
	 * the reader they are there, and the only open question is whether they can see
	 * them.
	 *
	 * Asked anywhere later it does not get asked at all, and that is measured
	 * rather than argued. A page that lands while the reader is still pushing
	 * leaves `armed` set (their retained demand), and the landing itself moves them
	 * clear of the windows — measured on the real surface, `distanceFromTopPx`
	 * 0 -> 1905px on the frame the page arrived, because the rows that make the
	 * page visible are the rows the window is holding back. The armed branch below
	 * then disarms ("the gesture landed without needing a page") and returns, so
	 * the debt was thrown away on the same frame it was owed: the reader sat at
	 * `hiddenRows: 100` with 62 further notches producing nothing, which is the
	 * stuck-then-jiggle report in its original form.
	 *
	 * The bound is the chain bound rule 5 has always used: one widen, counted
	 * against `chainWiden`. `armed` and `retained` are cleared with it, because
	 * this widen IS the answer to whatever the reader asked — rule 2's one reveal
	 * per act, delivered late rather than never.
	 */
	if (
		state.pageWidenOwed &&
		growth === "widen" &&
		state.chainWiden < MAX_CHAIN_WIDEN
	) {
		// The debt waits for the reader to stop, like every other reveal (rule 3):
		// it is a fact about rows they cannot see yet, not a licence to mount
		// under motion. The debt itself survives the wait — `pageWidenOwed` is
		// cleared only by the spend, a turn-around, or a session change — and the
		// pump re-runs this on the settle that follows.
		if (!settled) return { action: "none", state };
		return spend(
			{
				...state,
				pageWidenOwed: false,
				continuation: false,
				armed: false,
				retained: false,
				deliberate: false,
			},
			growth,
			geo,
		);
	}

	if (state.armed) {
		if (state.deliberate) return spend(state, growth, geo);
		if (growth === "fetch" && state.failures >= MAX_AUTO_ATTEMPTS) {
			// Bounded retry, rule G. The affordance stays operable; this only
			// refuses the automatic path.
			return { action: "none", state: { ...state, armed: false } };
		}
		// Rule 3: the spend waits for the motion to settle, or for the edge. The
		// demand survives the wait — the pump re-decides when the debounce
		// expires (the rAF loop already schedules that timer for an armed
		// demand), so a reader who stops inside the zone is answered then.
		if (!settled) return { action: "none", state };
		if (!inZone) {
			// The gesture landed without needing a page. Leaving it armed would let
			// an unrelated later resize or clamp spend stale input — the same
			// reasoning as the terminal UI's `_resume_in_zone = False` early out.
			//
			// This disarm runs at the SETTLE now rather than mid-flight: a moving
			// demand is kept until the reader stops, because where they stop is
			// the fact the spend is about. (Mid-flight it used to be dropped the
			// moment the reader was outside the windows — which threw away the
			// very demand a travelling arrival needed; see the motion gate below.)
			return { action: "none", state: { ...state, armed: false } };
		}
		if (growth === "fetch" && state.actFetchSpent) {
			// Rule 2's act budget: this gesture has already bought its round trip
			// (the widens that showed it are not budgeted). The demand is dropped
			// rather than held — a held one would be spent again by the next quiet
			// frame, which is a new act's job. A reader who wants the next chunk
			// gives one: the measured pause between two deliberate flicks is far
			// above `GESTURE_GAP_MS`, and the affordance needs nothing at all.
			return { action: "none", state: { ...state, armed: false } };
		}
		return spend(state, growth, geo);
	}

	if (state.continuation) {
		/*
		 * ONE GESTURE, ONE REVEAL — and the chain exists only where no gesture is
		 * possible.
		 *
		 * Round 1 let a settled reveal continue whenever the reader was still in
		 * the prefetch zone, reasoning that a reveal too short to move them should
		 * not cost a second gesture. Measured in the running app, that reasoning
		 * was wrong in the direction that matters. One fling on a 260-row
		 * conversation ran the whole chain: rows 60 -> 100 -> 160 -> 200 -> 260,
		 * `scrollHeight` 6482 -> 27853, two durable pages and four window steps
		 * out of ONE act, ending with the reader 141 rows from where they started
		 * and 59 rows of already-mounted conversation stranded above them. Each
		 * reveal re-pinned them near the top edge, which put them back in the zone
		 * and authorised the next one. The zone test cannot terminate a chain
		 * whose own effect is to satisfy it.
		 *
		 * The premise was also false at this scale: a single `WINDOW_STEP` widen
		 * measured 6294px of new extent against a 489px viewport — twelve
		 * viewports, not "too short to notice". A reveal that small is a case the
		 * reader answers with another flick; a chain that large is one they cannot
		 * undo.
		 *
		 * So a scrollable transcript gets exactly one reveal per act, which is the
		 * terminal UI's own contract (one page per `_check_resume_page`), and the
		 * continuation survives for the single case that has no act available:
		 * a transcript that cannot scroll (clause L). There the reader has no
		 * gesture to give — there is no scrollbar and no overflow — so the chain
		 * is the only route to their history, and it stops the moment the content
		 * becomes scrollable and hands control back to them.
		 */
		/*
		 * Rule 6 is the one door this refusal leaves open, and it is narrow on
		 * purpose. A durable page that landed with its rows still held back is a
		 * reveal the reader has been told about (the slot says "N earlier messages
		 * above - scroll up to load") and cannot see: measured, a page landed at
		 * `rows 200 -> 200, hiddenRows 0 -> 60` and then 62 further clamped notches
		 * produced nothing at all, because the widen that would show those rows
		 * needed an armed demand and the latch refuses to arm one from a clamped
		 * notch. Exactly ONE widen is authorised per landed page, and only while
		 * that page's rows are actually held back (`growth === "widen"`): a page
		 * with nothing hidden owes nothing, so the round-1 chain cannot re-enter
		 * through this door and the chain's own counters below still bound
		 * everything else.
		 */
		if (geo.scrollable && !(state.pageWidenOwed && growth === "widen")) {
			return {
				action: "none",
				state: { ...state, continuation: false, pageWidenOwed: false },
			};
		}
		const bound =
			growth === "widen"
				? state.chainWiden < MAX_CHAIN_WIDEN
				: state.chainFetch < MAX_CHAIN_FETCH &&
					state.failures < MAX_AUTO_ATTEMPTS;
		if (bound) {
			return spend(
				{ ...state, pageWidenOwed: false, continuation: false },
				growth,
				geo,
			);
		}
		return {
			action: "none",
			state: { ...state, continuation: false, pageWidenOwed: false },
		};
	}

	return { action: "none", state };
};

/**
 * A reveal landed. Service a retained demand if one is owed, otherwise offer a
 * continuation that `decide` will accept only if its own bounds still hold.
 */
export const noteSettled = (
	state: PagingState,
	{
		/**
		 * Whether the reveal that settled reached the NETWORK. A widen is purely
		 * local, so it is no evidence that a failing backend has recovered —
		 * clearing the budget on one let a reader with a dead backend buy three
		 * fresh fetch attempts per local widen.
		 */
		network = true,
		/**
		 * Rows the render window was still holding back when the reveal was
		 * OBSERVED on screen, read by the DOM half.
		 *
		 * Rule 6's whole input, and the reason it is passed rather than inferred: a
		 * page can land successfully and mount nothing (the window already held the
		 * rows in front of it), which is invisible on screen and must not read as a
		 * reveal. Only a DURABLE page can owe the widen, and only when the number is
		 * positive; a widen that settles with the same field set owes nothing, so
		 * the two growth paths cannot ping each other.
		 */
		hiddenRowsAfter = 0,
	}: { network?: boolean; hiddenRowsAfter?: number } = {},
): PagingState => ({
	...state,
	busy: false,
	failures: network ? 0 : state.failures,
	armed: state.retained,
	deliberate: state.retained ? state.deliberate : false,
	retained: false,
	turnedAround: false,
	pageWidenOwed: network && hiddenRowsAfter > 0,
	/*
	 * Rule 6 needs the CONTINUATION, not just the flag, and this is the half the
	 * first cut got wrong — measured on the real surface, not reasoned: a page
	 * that lands while the reader is still pushing retains a demand
	 * (`state.retained`), and the line below used to refuse the continuation for
	 * exactly that reason. So the page landed with rows held back, the reader sat
	 * pinned at the hard top with those rows one widen away, the slot told them to
	 * scroll up for content a widen would show, and the widen never came until
	 * their NEXT act re-armed a demand — which is the stuck-then-jiggle report.
	 *
	 * A landed page that owes a widen therefore earns the continuation whatever
	 * the reader was doing while it was in flight. The bound is unchanged where it
	 * matters: `continuation` is spent by that one widen, the door in `decide`
	 * closes with it, and a page with nothing hidden (`hiddenRowsAfter === 0`)
	 * still gets the old rule — so the 200-clamped-notches bound and the round-1
	 * chain it was written against both stand.
	 */
	continuation:
		(network && hiddenRowsAfter > 0) ||
		(!state.retained && !state.turnedAround),
});

/**
 * A durable page failed. The rows already painted are still correct, so nothing
 * is discarded; the demand is simply dropped and the failure counted. Nothing
 * re-arms on its own — the next demand has to come from input.
 *
 * THE ACT'S FETCH BUDGET IS CLEARED, not kept (round-1 review F2): the budget
 * bounds the operator's chain of SUCCESSFUL pages, and a failure is rule G's
 * case instead — the reader's own continued ask is the retry, and
 * `MAX_AUTO_ATTEMPTS` is what stops a loop. Keeping the budget spent here made
 * a failure terminal for the act, so a reader still pushing at the wall after a
 * blip had nothing coming until they paused, re-pushed or clicked; the terminal
 * UI draws the line the same way (a genuine fault gets an honest notice and the
 * next ask, not a spent act).
 */
export const noteFailed = (state: PagingState): PagingState => ({
	...state,
	busy: false,
	failures: state.failures + 1,
	armed: false,
	deliberate: false,
	retained: false,
	turnedAround: false,
	continuation: false,
	actFetchSpent: false,
	// Nothing landed, so nothing is owed. A rule-6 widen here would spend the
	// reader's trust on rows the failure did not produce.
	pageWidenOwed: false,
});

/** Whether the automatic path has given up and only an explicit ask remains. */
export const isExhausted = (state: PagingState): boolean =>
	state.failures >= MAX_AUTO_ATTEMPTS;

// ------------------------------------------------------- anchor arithmetic

/**
 * Where one identified row sat, and how tall the content was when it sat there.
 *
 * `viewportOffset` is the row's top edge relative to the scroller's own top
 * edge — the number clause E is about, and the only one that survives the
 * scroller's coordinate system changing under it.
 */
export type AnchorSample = {
	id: string;
	viewportOffset: number;
	extent: number;
};

/**
 * Do not apply a reveal's sample after newer reader input has taken ownership
 * of the viewport. Layout-only growth stays eligible while that sample remains
 * current; the DOM caller expires it when a new input revision arrives.
 */
export const anchorDriftForCurrentInput = (
	before: AnchorSample | null,
	after: AnchorSample | null,
	heldInputRevision: number,
	currentInputRevision: number,
): number | null =>
	heldInputRevision === currentInputRevision
		? anchorDrift(before, after)
		: null;

/**
 * How far the anchor row moved because content was revealed above it.
 *
 * Zero unless the content actually grew. That guard is the whole correctness
 * argument, not an optimisation: with a stable extent, any change in the
 * anchor's viewport offset is the READER scrolling, and "correcting" that would
 * be this module scrolling the transcript back out from under them. The
 * transcript's `column-reverse` origin already holds the anchor for a
 * well-behaved prepend — the measured drift on that path is 0 — so this exists
 * as the guard for the paths where it does not: a row whose measured height
 * changes after mount, and a browser that re-clamps the offset when the
 * scrollable extent crosses the viewport for the first time.
 *
 * Returns the signed displacement in scroller pixels. The DOM caller applies it
 * as `scrollTop += drift`: this transcript uses `column-reverse`, so `scrollTop`
 * is negative and making it less negative moves the held row up by the measured
 * displacement. Keep the sign at the call site paired with the real-DOM geometry
 * check; the normal-scroller intuition would choose the wrong direction here.
 */
export const anchorDrift = (
	before: AnchorSample | null,
	after: AnchorSample | null,
): number => {
	if (!before || !after) return 0;
	// A different row means the one we were holding unmounted. There is nothing
	// to hold to, and picking the new topmost row would silently redefine the
	// invariant mid-measurement.
	if (before.id !== after.id) return 0;
	/*
	 * A stable extent means the reader moved, not the content — and correcting
	 * THAT would scroll the transcript out from under them. This is the one
	 * guard that keeps the correction from fighting its own reader, so it stays.
	 *
	 * It is also why the caller must only hold an anchor across a reveal it
	 * initiated (`holdAnchor` is called on the action, and the hold expires):
	 * outside that window every offset change is the reader's and none of it is
	 * ours to undo.
	 */
	if (before.extent === after.extent) return 0;
	const drift = after.viewportOffset - before.viewportOffset;
	return Math.abs(drift) < ANCHOR_EPSILON_PX ? 0 : drift;
};
