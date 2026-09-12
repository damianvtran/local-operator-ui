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
 * (`local_operator/tui/app.py`: `_transcript_scrolled`, `_check_resume_page`;
 * `local_operator/tui/widgets/transcript.py`: the latch contract documented on
 * `_on_user_scroll`), so a reader who learned how history loads in the terminal
 * meets the same behaviour here. Where this file diverges it says so and why —
 * the two surfaces have different input vocabularies (a wheel is not a Textual
 * key binding) and different units (pixels, not terminal rows).
 *
 * The five rules, in the order they bite:
 *
 * 1. DEMAND IS INPUT, NEVER LAYOUT. Only a real upward gesture arms a demand.
 *    A resize, a streaming token lengthening the transcript, an image settling
 *    into its intrinsic height, or this module's own anchor correction all move
 *    the scroll offset, and none of them is a reader asking for more history.
 *    The caller is responsible for only reporting real input to `noteInput`;
 *    this module never infers demand from geometry alone.
 * 2. AT MOST ONE DEMAND, AND AT MOST ONE RETAINED. A fling is dozens of wheel
 *    events; it is one request for older messages. While a page is in flight a
 *    further gesture retains exactly one follow-up demand, and a downward
 *    gesture cancels it — the reader turned around, so the debt is void.
 * 3. SPEND ONLY WHEN THE MOTION HAS SETTLED. A demand is spent after
 *    `SETTLE_MS` of input silence, or at the hard top where the content has
 *    stopped moving because it cannot move further. Dispatching mid-fling is
 *    what makes paging feel like a stutter: rows mount while the viewport is
 *    travelling and every correction lands a frame late.
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
		// the next arrival at the top a new arrival.
		return {
			...state,
			armed: false,
			deliberate: false,
			retained: false,
			continuation: false,
			clampLatched: false,
			turnedAround: state.busy,
			chainFetch: 0,
			chainWiden: 0,
			lastInputAt: input.at,
		};
	}
	// A fresh upward gesture is a fresh budget: the chain counters exist to bound
	// what happens WITHOUT input, so input clears them.
	const base: PagingState = {
		...state,
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
			...(state.busy ? { retained: true } : { armed: true }),
		};
	}
	if (input.atHardTop && input.continuous && state.clampLatched) {
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
		return { ...state, lastInputAt: input.at };
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
		chainWiden: action === "widen" ? state.chainWiden + 1 : state.chainWiden,
		chainFetch: action === "fetch" ? state.chainFetch + 1 : state.chainFetch,
	},
});

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
	// did not ask. The `scrollable` term matters: an unscrollable transcript
	// reports offset 0, which is both "at the tail" and "at the top", and the
	// short-conversation chain below is the rule that owns that case.
	if (geo.followingTail) return { action: "none", state };

	const inZone = geo.distanceFromTopPx <= prefetchZonePx(geo.clientHeight);
	const settled =
		now - state.lastInputAt >= SETTLE_MS ||
		geo.distanceFromTopPx <= HARD_TOP_PX;

	if (state.armed) {
		if (state.deliberate) return spend(state, growth, geo);
		if (growth === "fetch" && state.failures >= MAX_AUTO_ATTEMPTS) {
			// Bounded retry, rule G. The affordance stays operable; this only
			// refuses the automatic path.
			return { action: "none", state: { ...state, armed: false } };
		}
		if (!inZone) {
			// The gesture landed without needing a page. Leaving it armed would let
			// an unrelated later resize or clamp spend stale input — the same
			// reasoning as the terminal UI's `_resume_in_zone = False` early out.
			return { action: "none", state: { ...state, armed: false } };
		}
		// Rule 3. Still armed: the caller re-pumps when the debounce expires.
		if (!settled) return { action: "none", state };
		return spend(state, growth, geo);
	}

	if (state.continuation) {
		// A reveal answers a demand only if it actually moved the top of the
		// content away from the reader. A page of 100 one-line notices can be
		// shorter than the viewport, and stopping there would leave them still
		// pressed against the edge with nothing having visibly happened — so they
		// would scroll again, and the "one gesture, one page" accounting would be
		// honoured in letter while the reader made four gestures.
		//
		// So a settled reveal may continue while the reader is STILL in the
		// prefetch zone, which is the desktop spelling of the terminal UI's
		// `_fill_resume_until_scrollable(target=scroll_y + viewport)`: fill until
		// about a viewport of content sits above the held reading position, then
		// stop. It is self-limiting in the normal case — one widen of 60 rows or
		// one page of 100 puts thousands of pixels above the reader and takes
		// them out of the zone on the next frame — and the chain counters are the
		// backstop for the case where it does not.
		//
		// The second clause is rule L on its own: a transcript that cannot scroll
		// reports distance 0 and offers no gesture to ask with, so the chain is
		// the only way its history is ever reachable.
		if (growth === "widen") {
			if (inZone && state.chainWiden < MAX_CHAIN_WIDEN)
				return spend(state, growth, geo);
		} else if (
			(inZone || !geo.scrollable) &&
			state.chainFetch < MAX_CHAIN_FETCH &&
			state.failures < MAX_AUTO_ATTEMPTS
		) {
			// Deliberately NOT gated on the clamp latch, and this is the one place
			// where saying so matters. Measured in the running app: one fling
			// revealed the 40 locally-held rows and left the reader pinned against
			// the content's top edge with 160 durable rows still behind it. A latch
			// test here refused the page, so the slot sat saying "Load earlier
			// messages" to a reader who had just asked for exactly that by
			// scrolling - the click-to-load defect this change exists to remove,
			// reintroduced one reveal later.
			//
			// The division of labour: the latch bounds a GESTURE that keeps
			// reporting itself without the reader acting (rule 4), and `noteInput`
			// enforces it at the source by refusing to arm on a clamped notch. A
			// continuation has no input behind it at all - it is the reveal saying
			// "that did not move you", and it is bounded by `chainFetch` and
			// `chainWiden`, which only a fresh gesture resets. Counters bound a
			// chain; the latch bounds a gesture.
			return spend(state, growth, geo);
		}
		return { action: "none", state: { ...state, continuation: false } };
	}

	return { action: "none", state };
};

/**
 * A reveal landed. Service a retained demand if one is owed, otherwise offer a
 * continuation that `decide` will accept only if its own bounds still hold.
 */
export const noteSettled = (state: PagingState): PagingState => ({
	...state,
	busy: false,
	failures: 0,
	armed: state.retained,
	deliberate: state.retained ? state.deliberate : false,
	retained: false,
	turnedAround: false,
	continuation: !state.retained && !state.turnedAround,
});

/**
 * A durable page failed. The rows already painted are still correct, so nothing
 * is discarded; the demand is simply dropped and the failure counted. Nothing
 * re-arms on its own — the next demand has to come from input.
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
 * Returns the signed displacement in scroller pixels. Apply it as
 * `scrollTop -= drift`: a larger `scrollTop` moves content up in both a normal
 * and a `column-reverse` scroller (in the reverse case `scrollTop` runs from 0
 * at the bottom to a negative bound at the top, but its sign convention against
 * the viewport is unchanged), so one expression serves both.
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
	if (before.extent === after.extent) return 0;
	const drift = after.viewportOffset - before.viewportOffset;
	return Math.abs(drift) < ANCHOR_EPSILON_PX ? 0 : drift;
};
