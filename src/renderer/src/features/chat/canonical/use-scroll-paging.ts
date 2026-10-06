import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { LoadOlderOutcome } from "./load-older";
import type { OlderHistoryState } from "./older-history-slot";
import {
	type AnchorSample,
	HARD_TOP_PX,
	type PagingGeometry,
	type PagingState,
	SETTLE_MS,
	TAIL_EPS_PX,
	anchorDrift,
	anchorDriftForCurrentInput,
	decide,
	initialPagingState,
	noteAborted,
	noteFailed,
	noteInput,
	noteSettled,
	spendWindows,
} from "./scroll-paging";

/**
 * The DOM half of scroll-driven history paging: read real input, ask
 * `scroll-paging.ts` whether it may be spent, and hold the reader's place while
 * the answer lands.
 *
 * Everything that decides is in the pure module. What lives here is the part
 * that cannot be decided in the abstract — which browser events are a reader
 * and which are the layout, how a `column-reverse` scroller reports its
 * distance to the top, and when a mutation has finished settling. Keeping the
 * split at that line is what makes the policy testable: the state machine has a
 * node:test suite, and this file has no branches of its own worth arguing
 * about.
 *
 * ## Why events and not the `scroll` event
 *
 * A `scroll` event is the SYMPTOM of motion and says nothing about its cause.
 * The transcript's offset moves when a token streams in, when an image resolves
 * its intrinsic height, when the window is resized, when a markdown block
 * reflows, and when this very hook corrects the anchor. Arming a demand from
 * `scroll` would mean a transcript could page itself backwards through an
 * entire conversation while the reader sat still and watched one turn stream —
 * which is precisely the class of bug the terminal UI's `_transcript_scrolled`
 * docstring exists to rule out ("never infer demand from layout motion").
 *
 * So demand comes from the input devices themselves: `wheel` (mouse and
 * trackpad, including the momentum phase, which keeps emitting events),
 * `keydown` for the scrolling keys, and `touchmove`. The one reader gesture
 * with no input event of its own is a scrollbar DRAG, so that case is bridged
 * explicitly: a `pointerdown` landing in the scrollbar gutter opens a window in
 * which `scroll` events are attributed to the reader, and it closes on
 * `pointerup`. Outside that window a `scroll` event is only ever an
 * observation.
 *
 * ## Why the anchor is held rather than restored
 *
 * Mounting rows above the viewport moves the reader's content down the virtual
 * canvas as each new row authors its height — over several layout passes, not
 * one. A single correction scheduled after the mount therefore lands after the
 * frames that needed it, and the reader watches the transcript lurch and snap
 * back. The terminal UI measured exactly this and documents it on
 * `insert_blocks`; the fix there and here is the same shape. The anchor row's
 * identity and viewport offset are captured BEFORE the reveal and re-asserted
 * on every extent change until the content stops moving, so the correction
 * lands in the same frame as the growth that caused it.
 *
 * In this scroller the browser does most of that work already —
 * `column-reverse` plus `overflow-anchor: auto` pins content to the bottom
 * origin, and the measured drift on the ordinary prepend path is 0. The hold is
 * the guard for the paths where it is not: a row whose height changes after
 * mount (an image, a code block deciding it needs a scrollbar), and the first
 * growth that makes an unscrollable scroller scrollable, where the browser
 * re-clamps the offset itself.
 */

/**
 * How long after a reveal the anchor keeps being re-asserted.
 *
 * Long enough to outlast the slowest settle a reveal can cause: a page of 100
 * rows whose markdown, code blocks and images each author their height on a
 * later layout pass. Measured on the 260-row fixture, a durable page's extent
 * finished growing within ~400ms; 1200ms is three times that, and the hold is
 * self-cancelling (`anchorDrift` returns 0 on a stable extent) so overshooting
 * costs a comparison per frame rather than a correction.
 *
 * The hold does not distinguish WHOSE growth it corrects, and during the window
 * that has one consequence worth naming. Growth BELOW the held row moves
 * nothing above it, so the correction computes zero and the reader sees their
 * own expansion open normally. Growth ABOVE the held row is what the hold
 * exists to absorb — including a reader who, inside the same 1200ms, expands a
 * tool row's diff body (`max-h-[740px]`) on a row above the anchor: the
 * correction holds the anchor still and so scrolls their expansion back out of
 * view. That is the feature applied to an unexpected actor rather than a defect
 * — holding reading position while content grows above IS what the reader asked
 * for by scrolling up — and it is bounded by the window and by the body's own
 * cap. Distinguishing reader-initiated growth from a landing page would mean
 * attributing every extent change to a cause, which is the inference clause A
 * deliberately refuses to make.
 *
 * Exported for `scripts/transcript-paging-hook.test.mjs`, whose expiry hand-over
 * case (round 1, R1-1) has to wait past the window - the suite then waits on the
 * same constant the hold is bounded by rather than a copy.
 */
export const ANCHOR_HOLD_MS = 1200;

/** How long a scrollbar drag's attribution window outlives its `pointerup`. */
const DRAG_TAIL_MS = 120;

/**
 * Frames a widen waits for React to commit before it settles anyway.
 *
 * Eight frames is ~130ms at 60Hz — an order of magnitude more than the one or
 * two frames a `setState` needs, and short enough that a stall cannot leave the
 * pump wedged. Exceeding it settles on a possibly-stale `hiddenRows`, which
 * costs at most one redundant decision: the next real gesture re-measures from
 * the DOM, so the error does not accumulate.
 */
const COMMIT_WAIT_FRAMES = 8;

export type ScrollPagingOptions = {
	/** The scroll container (`column-reverse`). */
	containerRef: RefObject<HTMLDivElement>;
	/**
	 * Identity of the conversation on screen. Any change discards the latch, the
	 * retained demand, the anchor and the chain budgets — clause H: a session
	 * switch is not a scroll gesture and must inherit nothing from one.
	 */
	sessionKey: string | null;
	/** Rows the render window is holding back. */
	hiddenRows: number;
	/** Durable pages remain on the backend. */
	hasMore: boolean;
	/**
	 * Whether the conversation's history has been READ — `use-canonical-session`'s
	 * `hydrated`, the proof that the transcript can speak about this
	 * conversation at all.
	 *
	 * WHAT IT GATES (remote-load-hydration): the `exhausted` arm, i.e. the "Start
	 * of conversation" statement. `hasMore: false` on its own is the cursor's
	 * opinion, and it is wrong exactly when the read that produced it could not
	 * see the conversation — a stored remote session's cold open gets an empty
	 * page from a facade with no owner, which the session hook refuses to count
	 * as proof. Rendering that as the conversation's end is the defect this input
	 * exists to remove: unproven hydration gets the loading paint while a read is
	 * out and the retry-able "not loaded" arm otherwise, never the end copy. A
	 * genuinely hydrated end still states itself.
	 *
	 * REQUIRED rather than defaulted, unlike `olderFailed`: a silent default here
	 * would decide the one claim this fact exists to police. The callers with no
	 * hydration concept pass their own answer (the transcript passes the session
	 * view's `hydrated`; direct mounts state theirs).
	 */
	hydrationProven: boolean;
	/** Reveal the next batch of already-fetched rows. Synchronous and free. */
	onWiden: () => void;
	/**
	 * Fetch the next durable page. Resolves `true` when a page was applied and
	 * `false` when the request failed, which is the signal the bounded-retry
	 * rule needs; it never rejects.
	 */
	onLoadOlder: () => Promise<boolean>;
	/**
	 * The outcome-aware form of `onLoadOlder`. When present it is what the pump
	 * calls, and it can tell a FAILURE from a lost race: `failed` counts toward
	 * the automatic budget, `stale` and `nothing-to-load` do not (`noteAborted`),
	 * and `applied` settles. Optional so a caller that only has the boolean (the
	 * child reader's preview, the stories) keeps working; the boolean form maps
	 * `false` to a failure exactly as it always did.
	 */
	onLoadOlderOutcome?: () => Promise<LoadOlderOutcome>;
	/**
	 * The last "load earlier" ask failed and nothing has been applied since, as
	 * the SESSION HOOK reports it (`CanonicalSessionView.olderFailed`). The failed
	 * row has one owner, and this is not it: the pump used to keep its own copy,
	 * which only saw its own asks and mistook a lost race for a failure. Optional
	 * and false by default so the stories that build these props keep type-checking.
	 */
	olderFailed?: boolean;
	/** A page fetch is in flight, as the session hook sees it. */
	loadingOlder: boolean;
	/**
	 * Rows currently mounted. Drives the pre-paint anchor correction: it changes
	 * exactly when a reveal lands, which is when the reader would otherwise see
	 * the content jump.
	 */
	rowCount: number;
	/**
	 * Rows the reader can actually SEE right now — the count `widenTarget`
	 * searches against (`turn-collapse-model.ts: paintedRows`), sampled through
	 * the transcript's own collapse inputs rather than re-derived here.
	 *
	 * It is the ONE currency a settle is judged in, and it is read through BOTH
	 * doors: a local widen reveals rows the transcript already had, so the
	 * anchor-drift proxy can never say whether a widen showed the reader
	 * anything, while this count can.
	 *
	 * OPTIONAL on purpose. A caller with no collapse model to derive it from (a
	 * surface that reveals rows without collapsing any) simply leaves it out, and
	 * the settle falls back to the proxy — which is the same "not measured"
	 * signal `noteSettled`'s `paintedDelta: null` already means, not a second
	 * mode. Omitting it is how such a caller says it has nothing better to offer
	 * than the proxy, not a silent way to opt out of the invariant.
	 *
	 * NO CALLER OMITS IT TODAY (agent review round 1, M2): this hook's only
	 * caller is `canonical-transcript.tsx`, and the child reader renders that same
	 * `CanonicalTranscript`, so every production settle arrives with a painted
	 * count and the proxy is a fallback with no production path. It stays optional
	 * for the surface described above, not because one exists.
	 */
	paintedRows?: () => number;
	/**
	 * Changes when the observed content node appears or is replaced, so the
	 * ResizeObserver re-attaches deterministically rather than incidentally.
	 */
	contentKey: string | number;
};

export type ScrollPagingHandle = {
	/** What the top slot should render. */
	slotState: OlderHistoryState;
	/**
	 * The affordance's activation: an explicit ask. It re-arms the clamp latch,
	 * forgives the failure budget, and bypasses both the prefetch zone and the
	 * settle debounce, because a reader who clicked is not making a prediction
	 * about where they are.
	 */
	requestOlder: () => void;
	/**
	 * Whether the automatic COMPLETION WALK may ask for a page right now
	 * (loader-continuity 1b, design spec section 7 clause b): the reader is
	 * following the tail AND has given the pointer no reason to be answered —
	 * no input for `SETTLE_MS` — AND the pane is actually following that tail
	 * (`followingTail` in this module's own terms).
	 *
	 * WHY IT LIVES HERE. The walk is the one ask with no gesture behind it, so
	 * it has to be authorised by the reader's POSITION rather than by their
	 * demand, and the position is this module's: `followingTail` and the input
	 * clock are derived from one number (`scrollTop`) and one ref
	 * (`state.lastInputAt`), and a second copy of that derivation in the
	 * transcript is exactly the "two authorities" this change removes. Read at
	 * the MOMENT OF THE ASK rather than from a render-time snapshot: a
	 * `followingTail` captured one commit ago would authorise a page the reader
	 * has since scrolled away from.
	 *
	 * A tail-following reader is `scrollable` by construction, so the walk
	 * cannot fire on the unscrollable pane the reveal chain (clause L) owns:
	 * that pane has `scrollTop === 0`, which IS the tail, and the two would
	 * otherwise both be asking.
	 */
	mayAutoWalk: () => boolean;
	/**
	 * Whether the reader is at the tail RIGHT NOW, without the input clock.
	 *
	 * `mayAutoWalk` answers two questions at once — "has the reader been quiet for
	 * `SETTLE_MS`" AND "are they at the tail" — and its callers sometimes need to
	 * tell them apart. The completion walk's settle wake does (agent review round 2,
	 * R2-1): it exists for the case where THE CLOCK is the only missing clause, and
	 * a walk that is off the tail must wait for a real transition rather than re-arm
	 * a timer forever against a clause nothing will change. Reading the tail half
	 * alone is what makes "the clock is the only thing left" decidable.
	 */
	followingTail: () => boolean;
	/**
	 * Acknowledge a write to the scroller's offset that THIS HOOK did not make,
	 * so the `scroll` event it fires is read as our own motion rather than as
	 * reader input (clause A).
	 *
	 * WHY A CALLER NEEDS THIS AT ALL. `onScroll` cannot tell a writer from a
	 * reader: it reads the offset this module's own corrections (and now its
	 * callers) leave behind, and treats every other `scroll` as the reader's or
	 * the browser's. A write from outside (the transcript's press-anchor
	 * correction, U1 of #708) carries a `scroll` event that the handler takes the
	 * reader path for — and a BAR PRESS has
	 * `onPointerDown` on this scroller, so `dragUntil` is open and the handler
	 * does more than re-read the hold: it calls `input(moved > 0 ? "up" : "down",
	 * ...)`, recording a correction as the reader dragging older-ward and arming
	 * a paging demand no gesture asked for (review round 2, MINOR-3).
	 *
	 * WHAT IS ACKNOWLEDGED IS THE OFFSET, NOT A COUNT (agent review round 3, R3-1),
	 * so two of our writes coalescing into one frame cannot leave a claim behind
	 * for the reader's next scroll to be swallowed by. A write clamped at either
	 * end of the scroller's range (or one that lands on the number already there)
	 * moves nothing and emits no `scroll` event, so it is not claimed at all.
	 * Callers pass the offset around the assignment, so neither rule can be
	 * forgotten at a call site: the caller writes
	 *
	 * ```ts
	 * const before = region.scrollTop;
	 * region.scrollTop += delta;
	 * acknowledgeOwnWrite(before, region.scrollTop);
	 * ```
	 */
	acknowledgeOwnWrite: (before: number, after: number) => void;
};

/**
 * The rows a reveal PAINTED, for the settle — or `null` when the caller has no
 * painted-row accessor to difference, which is `noteSettled`'s own "not measured"
 * signal and puts the settle back on the anchor-displacement proxy.
 *
 * Both doors call this with the sample they took at dispatch, so the page's and
 * the widen's settle cannot be judged in different currencies. Clamped at zero
 * for the same reason `anchorDrift`'s positive part is: a reveal that lost rows
 * must not read as growth.
 */
const paintDelta = (
	sample: number | null,
	read: (() => number) | undefined,
): number | null =>
	sample === null || !read ? null : Math.max(0, read() - sample);

export function useScrollPaging({
	containerRef,
	sessionKey,
	hiddenRows,
	hasMore,
	hydrationProven,
	onWiden,
	onLoadOlder,
	onLoadOlderOutcome,
	olderFailed = false,
	loadingOlder,
	contentKey,
	rowCount,
	paintedRows,
}: ScrollPagingOptions): ScrollPagingHandle {
	const state = useRef<PagingState>(initialPagingState());
	// Bumped by the session-change reset below; see the guard on the ask's outcome.
	const sessionEpoch = useRef(0);
	// The slot's rendered state is the only thing this hook publishes, so it is
	// the only thing that re-renders the transcript. Everything else lives in
	// refs: a demand arming or a settle timer firing must not repaint a list
	// that repaints per token already.
	// No `failed` state of its own: see `olderFailed`. The pump's own `failures`
	// counter (rule G, the automatic retry budget) stays in the policy state.
	/*
	 * Whether the pump is between dispatching a reveal and the reader being able
	 * to see it — the same fact the policy holds in `busy` and `pageWidenOwed`,
	 * mirrored into React state because one surface READS it: the top slot.
	 *
	 * Why the slot needs it (design round 1 D1-3, UX round 1 U1-2). Measured on
	 * the real surface, one flick painted the row four times in 1.34s:
	 *
	 *   "40 earlier messages above - scroll up to load" -> "Load earlier messages"
	 *   -> "Loading earlier messages" -> "100 earlier messages above - scroll up
	 *   to load" -> "40 earlier messages above - scroll up to load"
	 *
	 * (The windowed sentence carries no count any more — design round 1, D1 of the
	 * loader-continuity remediation — so the two counting strings below are what
	 * the row then read, not what it reads now.)
	 *
	 * The two sentences in the middle of that are the pre-fix instruction this
	 * whole change exists to remove, painted at a reader who is pinned at the hard
	 * top mid-push and can act on neither: they say "scroll up to load" while the
	 * app is loading exactly that, and the same sentence reappears 105ms later
	 * with a different count. Holding the loading paint for as long as a reveal is
	 * in flight OR owed leaves one statement per act and hands the reader the
	 * count only once it is the count they can see.
	 *
	 * It is a mirror, not a second state machine: it is written in exactly one
	 * place (the pump, from the decisions the policy just returned) and every
	 * value it takes is derived from `busy`/`pageWidenOwed`.
	 */
	const [revealInFlight, setRevealInFlight] = useState(false);
	/*
	 * Whether a reveal the reader COULD SEE has landed SINCE the last failure,
	 * which supersedes a standing `olderFailed` row (agent review round 1, M3).
	 *
	 * THE PROBLEM IT CLOSES. `olderFailed` is set by any failed ask and cleared
	 * only by an applied one (`use-canonical-session.ts`), and `slotState` lets it
	 * outrank `windowed`/`idle` unconditionally (design §1.5 D4/D9). So one
	 * transient blip left "Could not load earlier messages - Try again" painted
	 * for the rest of the session, even while later LOCAL widens were revealing
	 * rows the reader could already see: the row described a past blip rather
	 * than the present, and stopped telling the reader that scrolling still works.
	 *
	 * WHY IT LIVES HERE AND NOT UPSTREAM. A local widen never reaches the
	 * session's loader, so the session cannot know one succeeded; this hook is the
	 * only place that observes the settle. It does not re-derive "the reader saw
	 * it": it reads the policy's own verdict off the settled state
	 * (`chainInvisible === 0`), so there is still ONE counting path. The row's
	 * state is the slot's to compose, and this is one more input to that
	 * composition - `olderFailed` keeps its single writer upstream.
	 *
	 * IT IS NOT A FORGIVENESS. The backend may still be down: this only stops the
	 * row from over-claiming while rows are on screen. When the local window runs
	 * out the pump asks again, that ask fails, `noteFailed` fires and the flag is
	 * cleared - so the failed row returns with the failure that is actually
	 * current.
	 *
	 * THE DESIGN ROUND SHOULD JUDGE whether a visible local reveal ought to clear
	 * the failed row at all, or whether the row should instead keep a softer form
	 * of the failure while local rows are still available; the behaviour is
	 * defensible (the row states what is true now) but it is a UX call, not a
	 * mechanical one.
	 */
	const [failureSuperseded, setFailureSuperseded] = useState(false);

	// Latest values for the rAF pump, which must not be re-created per render.
	const live = useRef({
		hiddenRows,
		hasMore,
		onWiden,
		onLoadOlder,
		onLoadOlderOutcome,
		paintedRows,
	});
	live.current = {
		hiddenRows,
		hasMore,
		onWiden,
		onLoadOlder,
		onLoadOlderOutcome,
		paintedRows,
	};

	const anchor = useRef<{
		sample: AnchorSample | null;
		until: number;
		inputRevision: number;
	}>({ sample: null, until: 0, inputRevision: 0 });
	/*
	 * The offset our own write of `scrollTop` produced, or null. The `scroll`
	 * event that write fires is our own motion and must never be attributed to
	 * the reader (clause A).
	 *
	 * AN OFFSET, NOT A COUNT (agent review round 3, R3-1). A count is consumed one
	 * event at a time, so two of our writes coalescing into ONE frame - the hook's
	 * own `correctAnchor` and the transcript's press-anchor write land in the same
	 * layout phase - left a residue that swallowed the reader's NEXT genuine
	 * scroll: MINOR-3 mirrored, and a swallowed scroll is the failure this lane
	 * exists to remove. The offset cannot leave that residue: the pair's second
	 * write simply overwrites the first, and the one event the browser emits for
	 * the pair matches it.
	 *
	 * Consumed on the FIRST scroll event to arrive, whether or not the offsets
	 * match. Our write happens in the layout phase and the browser queues its
	 * event before any reader input can be processed, so that event IS ours; if
	 * the offsets disagree (a browser clamp we did not predict) the event is
	 * treated as the reader's motion rather than silently absorbed, which is the
	 * honest reading and leaves nothing pending.
	 */
	const ownWritePosition = useRef<number | null>(null);
	/*
	 * The same acknowledgement, offered to a caller that writes the offset itself
	 * (the transcript's press-anchor correction). `before` is read for the clamp
	 * rule: a write the browser leaves at its old value emits no event at all, so
	 * claiming it would leave the claim pending for the reader's next scroll.
	 */
	const acknowledgeOwnWrite = useCallback((before: number, after: number) => {
		if (after !== before) ownWritePosition.current = after;
	}, []);
	/*
	 * The reader's own motion, as the SCROLLER reported it at the last input.
	 *
	 * Measured from the offsets rather than from `deltaY`, because a wheel delta
	 * is device-scaled and a trackpad's is a lie: the same gesture reports
	 * different numbers on different hardware and neither number says how far the
	 * content actually moved. `at: 0` means "no input yet", which is what makes
	 * the first input carry no travel — there is no previous sample to difference
	 * it against, and inventing one (the reader's distance from the tail, say)
	 * would report a flick's worth of travel for a reader who has only just put
	 * their fingers on the pad.
	 */
	const travel = useRef({
		fromTail: 0,
		at: 0,
		extent: 0,
		clamped: false,
		revision: 0,
	});
	const pump = useRef<number>(0);
	const settleTimer = useRef<number>(0);
	/**
	 * Reader-scroll settle, after which the standing hold re-reads the
	 * reader's place (`refreshReaderHold`). Debounced because a sample taken
	 * mid-gesture is a position the reader is still leaving.
	 */
	const scrollSettle = useRef<number>(0);

	/** The scroller's geometry, in the terms the policy is written in. */
	const measure = useCallback((): PagingGeometry | null => {
		const el = containerRef.current;
		if (!el) return null;
		const { scrollTop, scrollHeight, clientHeight } = el;
		// `column-reverse`: the origin is the BOTTOM, so `scrollTop` runs from 0
		// at the newest row to a negative bound at the oldest. Distance to the top
		// of the content is what is left of the overflow after the reader's own
		// displacement.
		const fromTail = Math.abs(scrollTop);
		return {
			distanceFromTopPx: Math.max(0, scrollHeight - clientHeight - fromTail),
			clientHeight,
			hiddenRows: live.current.hiddenRows,
			hasMore: live.current.hasMore,
			scrollable: scrollHeight - clientHeight > 1,
			followingTail: fromTail <= TAIL_EPS_PX,
		};
	}, [containerRef]);

	/**
	 * The row occupying the top of the viewport, by backend id, with its offset.
	 *
	 * Identity rather than index because the whole point of the measurement is
	 * to survive rows being inserted above it, which renumbers every index. The
	 * rows already carry `data-record-id`, so nothing new is minted for this.
	 */
	const sampleAnchor = useCallback((): AnchorSample | null => {
		const el = containerRef.current;
		if (!el) return null;
		const top = el.getBoundingClientRect().top;
		for (const row of el.querySelectorAll<HTMLElement>("[data-record-id]")) {
			const rect = row.getBoundingClientRect();
			// The first row whose BOTTOM is still below the viewport top: the row
			// the reader is actually looking at, including one scrolled halfway off.
			if (rect.bottom > top) {
				const id = row.dataset.recordId;
				if (!id) continue;
				return {
					id,
					viewportOffset: rect.top - top,
					extent: el.scrollHeight,
				};
			}
		}
		return null;
	}, [containerRef]);

	/**
	 * Measure the SPECIFIC row being held, by id.
	 *
	 * Distinct from `sampleAnchor`, which answers "what is at the top now" and is
	 * only right for CHOOSING an anchor. Re-sampling it to CORRECT one is the bug
	 * that made the widen path drag the reader: mounting rows above the viewport
	 * changes which row is topmost, so the re-sample returned a different id,
	 * `anchorDrift` saw a mismatch, and returned 0 — the correction stood down at
	 * exactly the moment it was needed. Measured before this fix: a local widen
	 * displaced the held row by 6609px in one frame while a durable page (which
	 * mounts nothing new above the window) moved it 24px.
	 */
	const measureHeld = useCallback(
		(id: string): AnchorSample | null => {
			const el = containerRef.current;
			if (!el) return null;
			const row = el.querySelector<HTMLElement>(
				`[data-record-id="${CSS.escape(id)}"]`,
			);
			if (!row) return null;
			return {
				id,
				viewportOffset:
					row.getBoundingClientRect().top - el.getBoundingClientRect().top,
				extent: el.scrollHeight,
			};
		},
		[containerRef],
	);

	/*
	 * The standing reader-hold (fold rounds, 2026-09-27).
	 *
	 * The reveal's hold (`holdAnchor`) was bounded to `ANCHOR_HOLD_MS` because its
	 * only client was a growth this module had just dispatched; outside that
	 * window every offset change was assumed to be the reader's and none of it
	 * ours to undo. The operator's report names the case that assumption missed:
	 * the reader holds a reading position, a fold's body collapses somewhere else
	 * in the conversation, and the extent change drags their view - "even in that
	 * case where they collapse, it shouldn't result in the conversation
	 * shifting". So the place they left the scroll at is held until THEY move it:
	 * the sample is taken once their own gesture has settled (a wheel notch
	 * mid-gesture is them still moving, not a place), it carries no time bound
	 * (the invariant is a position, not a window), and it is dropped the moment
	 * they return to the tail (there, following the tail governs, and a hold would
	 * fight the pinning the transcript wants).
	 *
	 * The correction itself is unchanged and deliberate: `correctAnchor` writes
	 * `scrollTop` in the same frame as the layout change (the `useLayoutEffect`
	 * below runs on every commit; the observer above catches changes with no
	 * commit), so the reader never sees the lurch this exists to remove. The
	 * drift computation refuses to act at all when the extent did not change -
	 * a stable extent means the READER moved, and correcting that would scroll
	 * the transcript out from under them (see `anchorDrift`).
	 */
	const refreshReaderHold = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		/*
		 * A reveal's hold is FINITE and has priority while it lives: it was sampled
		 * BEFORE the growth this module dispatched, and re-sampling mid-settling
		 * would adopt a position that is still drifting. It hands over at its own
		 * expiry - `correctAnchor`'s expiry arm re-reads the reader's place then,
		 * and a settled non-input motion re-reads it here.
		 *
		 * The window test is what makes "while it lives" true (review round 1,
		 * R1-1): a FINITE hold past its expiry is not a hold, and returning for it
		 * anyway made both of those re-reads dead - the expired sample stayed the
		 * invariant, and the next correction reverted the motion it had missed
		 * instead of adopting it as the reader's new place.
		 */
		if (
			anchor.current.sample !== null &&
			Number.isFinite(anchor.current.until) &&
			performance.now() <= anchor.current.until
		)
			return;
		if (Math.abs(el.scrollTop) <= TAIL_EPS_PX) {
			anchor.current = { sample: null, until: 0, inputRevision: 0 };
			return;
		}
		const sample = sampleAnchor();
		if (!sample) return;
		anchor.current = {
			sample,
			until: Number.POSITIVE_INFINITY,
			inputRevision: travel.current.revision,
		};
	}, [containerRef, sampleAnchor]);

	/** Re-assert the held anchor. Cheap, and a no-op on a stable extent. */
	const correctAnchor = useCallback(() => {
		const el = containerRef.current;
		const held = anchor.current.sample;
		if (!el || !held) return;
		/*
		 * THE TAIL GATE. At the tail the reader is following, not holding: the
		 * newest content must stay pinned, and a correction fired out there would
		 * drag it while it is being written. The sample is dropped here too, so a
		 * reader who scrolls back down re-enters the following state rather than
		 * staying held at a position they left.
		 */
		if (Math.abs(el.scrollTop) <= TAIL_EPS_PX) {
			anchor.current = { sample: null, until: 0, inputRevision: 0 };
			return;
		}
		const drift = anchorDriftForCurrentInput(
			held,
			measureHeld(held.id),
			anchor.current.inputRevision,
			travel.current.revision,
		);
		if (drift === null) {
			anchor.current.sample = null;
			return;
		}
		const expired = performance.now() > anchor.current.until;
		if (drift !== 0) {
			/*
			 * `+=`, and the sign is not the obvious one - it is inverted by
			 * `column-reverse`.
			 *
			 * In a normal scroller, content that moved DOWN by `drift` is put back by
			 * scrolling down, `scrollTop += drift`; the instinct is to write `-=` here
			 * on the theory that the axis is reversed. Measured on the real scroller,
			 * that instinct is wrong twice over and cancels out to the wrong answer:
			 * making `scrollTop` MORE negative moves content DOWN (offset grows). So
			 * a positive drift - the held row pushed down by rows mounting above it -
			 * is undone by moving `scrollTop` toward zero, which is `+=`.
			 *
			 * Written as `-=`, every correction doubled the error it was meant to
			 * remove: measured, a local widen displaced the held row by 6609px in a
			 * single frame while the correction ran on every one of them. The
			 * observation that settled it is in the evidence README (`scrollTop -100`
			 * => offset +100) so the next reader does not have to re-derive it.
			 */
			el.scrollTop += drift;
			// Acknowledge the offset the write produced, not a count (R3-1).
			ownWritePosition.current = el.scrollTop;
		}
		if (expired) {
			/*
			 * The reveal's window has passed but the reader is still away from the
			 * tail: their place becomes the standing sample rather than the hold
			 * simply dying. It is taken AFTER the correction above, so a layout
			 * change landing on this same frame is still absorbed before the
			 * standing sample re-reads the position.
			 */
			refreshReaderHold();
			return;
		}
		if (drift === 0) return;
		// The sample's extent is refreshed, not the offset: the offset is the
		// invariant being defended, and re-reading it would let each correction
		// ratify whatever the previous one failed to fix.
		anchor.current.sample = { ...held, extent: el.scrollHeight };
	}, [containerRef, measureHeld, refreshReaderHold]);

	/** Hold the reader's place across the next `ANCHOR_HOLD_MS` of settling. */
	const holdAnchor = useCallback(() => {
		anchor.current = {
			sample: sampleAnchor(),
			until: performance.now() + ANCHOR_HOLD_MS,
			inputRevision: travel.current.revision,
		};
	}, [sampleAnchor]);

	/**
	 * Fold a settle into the policy, and let a reveal the reader COULD SEE
	 * supersede a standing failure row (agent review round 1, M3).
	 *
	 * `chainInvisible === 0` after a settle is the POLICY's own reading that the
	 * reveal was visible (`noteSettled` resets the counter only for a visible
	 * reveal, and a settle that increments it can never land on 0). Reading that
	 * rather than re-testing the paint here is what keeps a single counting path:
	 * this file never decides "did the reader see it", it only reads the answer
	 * `scroll-paging.ts` already gave. See `failureSuperseded`.
	 */
	const settle = useCallback((settled: PagingState): PagingState => {
		if (settled.chainInvisible === 0) setFailureSuperseded(true);
		return settled;
	}, []);

	/**
	 * One decision, coalesced to an animation frame.
	 *
	 * Every path that can change the answer calls this; the rAF is what turns a
	 * fling's dozens of wheel events into one evaluation per painted frame.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the pre-dispatch extent is read through the ref at the moment of the ask; a dependency on `containerRef.current` would re-create the pump on every render, which is the indirection the ref exists to provide.
	const schedule = useCallback(() => {
		if (pump.current) return;
		pump.current = requestAnimationFrame(() => {
			pump.current = 0;
			const geo = measure();
			if (!geo) return;
			const { action, state: next } = decide(
				state.current,
				geo,
				performance.now(),
			);
			state.current = next;
			/*
			 * The slot's paint follows the policy's own view of what is on its way:
			 * a reveal just dispatched, one in flight, one owed, or a demand that is
			 * armed AND inside the zone the policy spends from — the same
			 * computation `decide` makes, taken from `spendWindows` instead of being
			 * re-derived here.
			 *
			 * The window test is not decoration. Without it EVERY armed demand paints
			 * "Loading earlier messages", spinner and `aria-live` announcement
			 * included, including one `decide` has already refused: a reader following
			 * the tail arms a demand that the `followingTail` guard then returns on,
			 * and it stays armed — measured against this module,
			 * `{"action":"none","armed":true,"busy":false}`, re-decided every 120ms —
			 * until a downward input or a session change, so the row claimed a load
			 * that was not happening. With it, the paint stops at the same edge the
			 * policy does.
			 *
			 * It NARROWS rather than closes the gap between a widen landing and the
			 * fetch that frees it, and the earlier claim that it closed that gap was
			 * wrong. The button still paints in that gap — 27, 181, 184, 310 and
			 * 1657ms across the fling-shaped acts, from the `slotTransitions` in the
			 * committed measurements — because the reader is outside the zone when
			 * the widen lands, which is exactly when the policy has nothing in flight.
			 * What makes it acceptable is where it happens rather than how long it
			 * lasts: the slot is at least 350px above the viewport in every one of
			 * those windows, so no reader sees the churn. Both halves are in the set's
			 * README.
			 */
			const windows = spendWindows(geo);
			setRevealInFlight(
				action !== "none" ||
					next.busy ||
					next.pageWidenOwed ||
					(next.armed && windows.inZone),
			);
			if (action === "none") {
				// An armed demand waiting only on the settle debounce needs someone to
				// ask again once the debounce expires: no further input is coming, by
				// definition of having settled. So does a rule-6 debt whose landing
				// decide fell inside the debounce (round-1 review F1): the widen that
				// shows the just-fetched rows is owed to the reader NOW, and without
				// this it waited for the next arbitrary event — input, a resize, a
				// content change — while the slot sat on "Loading earlier messages".
				if ((next.armed || next.pageWidenOwed) && !settleTimer.current) {
					settleTimer.current = window.setTimeout(() => {
						settleTimer.current = 0;
						schedule();
					}, SETTLE_MS);
				}
				return;
			}
			holdAnchor();
			if (action === "widen") {
				const before = live.current.hiddenRows;
				/*
				 * The rows the reader is LOOKING at, before the widen commits — the
				 * baseline the settle below differences against (see its
				 * `paintedDelta`).
				 */
				const paintedBefore = live.current.paintedRows?.() ?? null;
				live.current.onWiden();
				// Settle on the OBSERVED reveal, not on a frame count.
				//
				// `onWiden` is a `setState`, so the rows it reveals exist after a
				// React commit - and one `requestAnimationFrame` is not a commit.
				// Settling after a fixed frame handed the next decision the same
				// `hiddenRows` it had just acted on, so the continuation spent
				// another widen on rows already revealed, three times, and retired
				// `chainWiden` before the window had finished opening. Measured in
				// the running app: 100 rows mounted, 160 durable rows still behind
				// them, and zero `sessions.history` requests - the reader sat at the
				// top of a conversation the app had decided was fully revealed.
				//
				// Polling the value the decision actually reads is the fix that does
				// not depend on knowing how many frames React needs. The cap is a
				// guard against a widen that legitimately reveals nothing (the
				// window already held every row), which must still settle.
				// The epoch guard R1-4 put on the ask's outcome, carried onto the rAF
				// continuation the outcome schedules (loader-continuity round 2, R2-1). The
				// session-change reset has already replaced the policy state by the time
				// this frame runs, so settling here would clear the NEW conversation's
				// failure budget and set `pageWidenOwed` on rows that are not its own -
				// a widen nobody asked for. Captured at dispatch, compared at the write,
				// dropped on mismatch; nothing needs handing on, because the reset armed
				// its own continuation.
				const widenedFor = sessionEpoch.current;
				let waited = 0;
				const awaitCommit = () => {
					if (sessionEpoch.current !== widenedFor) return;
					if (
						live.current.hiddenRows !== before ||
						waited >= COMMIT_WAIT_FRAMES
					) {
						/*
						 * THE WIDEN'S OWN PAINT, in the reader's currency. A local widen
						 * reveals rows the transcript already had, so this delta is the
						 * ONLY measure of whether the reader saw anything: the anchor-drift
						 * proxy cannot see a reveal that painted no row (nothing crossed
						 * the viewport top), and scoring such a widen VISIBLE is exactly
						 * what reset `chainInvisible` and refused the continuation — the
						 * wedge. Clamped at zero for the same reason `anchorDrift`'s
						 * positive part is: a reveal that lost rows must not read as
						 * growth.
						 */
						state.current = settle(
							noteSettled(state.current, {
								network: false,
								hiddenRowsAfter: live.current.hiddenRows,
								paintedDelta: paintDelta(
									paintedBefore,
									live.current.paintedRows,
								),
							}),
						);
						schedule();
						return;
					}
					waited += 1;
					requestAnimationFrame(awaitCommit);
				};
				requestAnimationFrame(awaitCommit);
				return;
			}
			/*
			 * What the page DID, not whether it was applied. The boolean form is kept
			 * for callers that have no better answer and maps to the two outcomes it
			 * can express; the outcome form is what the session hook offers, and it is
			 * what lets a lost race (`stale`, `nothing-to-load`) release the pump
			 * WITHOUT counting a failure or painting the failed row.
			 */
			/*
			 * THE REVEAL'S OWN GROWTH, MEASURED WHERE THE READER IS (loader-continuity
			 * 1b; agent review round 1, R1-3). The policy's "did the reader see it"
			 * question is about pixels ON SCREEN, and the quantity that answers it is
			 * the displacement of the row the reader was looking at — the same
			 * `sampleAnchor`/`measureHeld`/`anchorDrift` instrument the anchor hold
			 * already uses, so there is one measurement rather than two.
			 *
			 * WHY NOT THE SCROLLER'S `scrollHeight` (the first cut did, and it was
			 * wrong in the live case this feature exists for): the extent grows for
			 * ANY reason, including a turn streaming BELOW a tail-following reader,
			 * and that growth would be credited to the reveal — an invisible reveal
			 * would read as visible, the chain would end, and the act's round trip
			 * would stay spent. A row's viewport offset moves only when content is
			 * added ABOVE it, so the drift's positive part is exactly the reveal's own
			 * growth; content below the anchor contributes zero.
			 *
			 * `null` when there is no anchor to measure (a session switch mid flight,
			 * an empty transcript) — the policy treats a missing measurement as visible
			 * rather than inventing an invisible reveal.
			 */
			const paintedBefore = live.current.paintedRows?.() ?? null;
			const anchorBefore = sampleAnchor();
			const ask: () => Promise<LoadOlderOutcome> = async () => {
				/*
				 * A REJECTED LOADER IS A FAILURE, NOT A STRAND.
				 *
				 * `busy` is cleared by `noteSettled`/`noteFailed`/`noteAborted` and by
				 * nothing else, and `decide` returns `none` while it is set — so an
				 * ask whose promise REJECTS used to leave the policy busy for ever:
				 * no settle, no failure row, no timer (the `armed || pageWidenOwed`
				 * branch is what schedules one), and `revealInFlight` frozen at
				 * `true`, i.e. the slot painting "Loading earlier messages" for the
				 * rest of the conversation's life with no way back. Today's loaders
				 * catch internally, so it was latent rather than live; it costs one
				 * `try` to close, and closing it here covers the boolean
				 * `onLoadOlder` form as well as the outcome form.
				 */
				try {
					return live.current.onLoadOlderOutcome
						? await live.current.onLoadOlderOutcome()
						: (await live.current.onLoadOlder())
							? { kind: "applied", newRecords: 0, exhausted: false }
							: { kind: "failed", reason: "request" };
				} catch (error) {
					/*
					 * A rejected loader is classified exactly like a `false` — the pump must
					 * not be stranded — but not SILENTLY (agent review round 1, N2): without
					 * this line a genuine backend fault is indistinguishable from a benign
					 * decline. `console.warn` carrying the rejection is the channel this
					 * module's neighbours use (`use-thread-search.ts`, `use-checkpoints.ts`);
					 * it is a developer-facing breadcrumb, because the reader is already told
					 * what happened by the failure row.
					 */
					console.warn("older history load was rejected:", error);
					return { kind: "failed", reason: "request" };
				}
			};
			// The conversation this ask was made for. The session-change effect has
			// already replaced the policy state (and armed a fresh `continuation`), so
			// an outcome that resolves for the PREVIOUS conversation describes nothing
			// this state holds: folding a late `stale` in would `noteAborted` the new
			// conversation and clear the one auto-continuation a short, unscrollable
			// pane has (loader-continuity round 1, R1-4).
			//
			// A generation rather than the key itself: A -> B -> A returns to an equal
			// key with a policy state that was reset twice in between.
			const askedFor = sessionEpoch.current;
			void ask().then((outcome) => {
				if (sessionEpoch.current !== askedFor) return;
				if (outcome.kind === "failed") {
					state.current = noteFailed(state.current);
					/*
					 * A failure is the present fact again, so a reveal that had
					 * superseded an earlier one no longer speaks for this state: the
					 * failed row must be able to return when the local rows run out
					 * and the ask that replaces them fails (agent review round 1,
					 * M3).
					 */
					setFailureSuperseded(false);
					requestAnimationFrame(schedule);
					return;
				}
				if (outcome.kind !== "applied") {
					state.current = noteAborted(state.current);
					requestAnimationFrame(schedule);
					return;
				}
				/*
				 * Settle on the OBSERVED landing, exactly as the widen path does, and for
				 * the same reason: `loadOlder` resolves as soon as it has SCHEDULED the
				 * view update that carries the page's rows
				 * (`use-canonical-session.ts`), so a settle read in this microtask sees
				 * the pre-landing `hiddenRows` — and that zero is precisely the state
				 * rule 6 is about. Measured on the real surface: a durable page landed
				 * with `rows 200 -> 200` and `hiddenRows 0 -> 60`, i.e. the reader's
				 * arrival was answered and nothing on screen changed. Polling the value
				 * the decision reads is the fix that does not depend on knowing how
				 * many frames React needs, and the cap is the same guard the widen path
				 * uses: a page that legitimately mounts nothing must still settle.
				 */
				// The same guard as the widen path's `awaitCommit` above, and the same
				// hazard at the other end of the ask (loader-continuity round 2, R2-1):
				// this is the continuation that carries `hiddenRowsAfter`, which is what a
				// stale landing would hand the new conversation as rule 6's debt.
				const landedFor = sessionEpoch.current;
				let waited = 0;
				const awaitLanding = () => {
					if (sessionEpoch.current !== landedFor) return;
					const after = live.current.hiddenRows;
					if (after > 0 || waited >= COMMIT_WAIT_FRAMES) {
						/*
						 * The reveal's growth, read at the settle rather than at a
						 * fixed frame: the rows a page mounts author their height over
						 * several layout passes, so a measurement taken on the frame
						 * the promise resolves would read the pre-landing extent and
						 * call every page invisible. This is the same "settle on the
						 * OBSERVED landing" rule the debt above uses, applied to the
						 * reader's own currency.
						 */
						const el = containerRef.current;
						const anchorAfter =
							anchorBefore === null ? null : measureHeld(anchorBefore.id);
						state.current = settle(
							noteSettled(state.current, {
								hiddenRowsAfter: after,
								/*
								 * The rows the page PAINTED, in the reader's own currency and
								 * through the same accessor the widen door samples — the page
								 * door's half of the one measurement the settle is judged in.
								 * Measured here, at the observed landing, for the reason the
								 * extent is: a page's rows author their height (and the collapse
								 * re-partitions) over several layout passes, so a reading taken
								 * when the promise resolves would call every page invisible.
								 * Clamped at zero like the widen door's.
								 */
								paintedDelta: paintDelta(
									paintedBefore,
									live.current.paintedRows,
								),
								/*
								 * The drift's positive part: how far the held row was pushed DOWN, which
								 * is how much content landed above it. A negative drift (the reader's own
								 * motion, or a browser re-clamp) reads as no growth rather than as
								 * negative growth — the invisible test is `growthPx < floor`, and a
								 * negative number must not buy a chain.
								 */
								growthPx:
									anchorBefore === null
										? null
										: Math.max(0, anchorDrift(anchorBefore, anchorAfter)),
								clientHeight: el?.clientHeight ?? 0,
								newRecords: outcome.newRecords,
							}),
						);
						schedule();
						return;
					}
					waited += 1;
					requestAnimationFrame(awaitLanding);
				};
				requestAnimationFrame(awaitLanding);
			});
		});
	}, [holdAnchor, measure, sampleAnchor, measureHeld, settle]);

	/** Fold one real gesture in, then re-decide. */
	const input = useCallback(
		(direction: "up" | "down", continuous: boolean, deliberate = false) => {
			const el = containerRef.current;
			const at = performance.now();
			const geo = measure();
			const atHardTop =
				(geo?.distanceFromTopPx ?? Number.POSITIVE_INFINITY) <= HARD_TOP_PX;
			/*
			 * What the reader's own input actually did, in the one term the policy
			 * still reasons about (rule 4's travel record): a distance travelled
			 * since the previous input, in px.
			 *
			 * It is read from the scroller's OFFSETS at input time, which is the
			 * only measurement that is the same on every input device — and read
			 * HERE, at the input event, rather than from a `scroll` listener, so a
			 * landing, a streamed token or the anchor correction can never look like
			 * the reader moving (clause A).
			 */
			const held = travel.current;
			const first = held.at === 0;
			const fromTail = el ? Math.abs(el.scrollTop) : held.fromTail;
			const extent = el ? el.scrollHeight : held.extent;
			/*
			 * Clamp-follow. Growth observed while the reader is ALREADY against the
			 * top edge is the browser re-pinning them to the grown extent, not the
			 * reader moving: mounting rows above a pinned reader moves `scrollTop`
			 * by exactly the growth (measured on the real scroller: `scrollHeight`
			 * +24px with `scrollTop` -24px and no input at all). Left in the
			 * measurement, those 24px would read as travel — and travel is what
			 * releases the clamp latch, so a finger resting on the top edge could
			 * walk the whole conversation into memory through that door.
			 */
			const clampFollow =
				held.clamped && extent > held.extent ? extent - held.extent : 0;
			const moved = first ? 0 : fromTail - held.fromTail - clampFollow;
			travel.current = {
				fromTail,
				at,
				extent,
				clamped: atHardTop,
				revision: held.revision,
			};
			state.current = noteInput(state.current, {
				direction,
				continuous,
				deliberate,
				atHardTop,
				at,
				// `moved` is the NET the reader's own offsets produced; a downward
				// notch is answered on `noteInput`'s own branch, where travel toward
				// the top would mean nothing.
				travelledPx: Math.max(0, moved),
			});
			travel.current = {
				...travel.current,
				revision: travel.current.revision + 1,
			};
			if (deliberate) {
				/*
				 * Re-armed on the just-bumped revision, so `correctAnchor` can hold the
				 * retry's landing on the frame it lands rather than a frame late — the
				 * other half of the deliberate-ask exception above.
				 */
				holdAnchor();
			}
			if (!deliberate) {
				/*
				 * EXCEPT ON A DELIBERATE ASK. The slot's "Try again" and `Home` exist to
				 * show the reader the rows the failed ask did not, so the retry is the
				 * one input that keeps their place ACROSS the reveal: the hold is
				 * re-read below, on the input's own revision, instead of being left null
				 * until the settle `SETTLE_MS` later — which is the window in which a
				 * landing paints uncorrected, the measured one-frame lurch on the retry
				 * path (design §4).
				 */
				anchor.current.sample = null;
				anchor.current.until = 0;
			}
			/*
			 * The reader is moving, so the standing hold drops for the duration of
			 * the gesture and re-reads their place once the scrolling stops. It is
			 * scheduled HERE as well as on `scroll` because an input at a range edge
			 * moves nothing - there is no scroll event to come - and the hold must
			 * still re-arm for the place they are actually at.
			 */
			if (scrollSettle.current) window.clearTimeout(scrollSettle.current);
			scrollSettle.current = window.setTimeout(refreshReaderHold, SETTLE_MS);
			schedule();
		},
		[containerRef, holdAnchor, measure, refreshReaderHold, schedule],
	);

	const requestOlder = useCallback(() => {
		input("up", false, true);
	}, [input]);

	// Clause H. A different conversation inherits nothing: not the latch, not a
	// retained demand, not an anchor held against rows that no longer exist.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on session change only
	useEffect(() => {
		state.current = initialPagingState();
		sessionEpoch.current += 1;
		anchor.current = {
			sample: null,
			until: 0,
			inputRevision: travel.current.revision,
		};
		/*
		 * The DOM half's measurement state belongs to the conversation too
		 * (review round 1, R1-6). Left alone, the first input of a NEW conversation
		 * is differenced against the PREVIOUS conversation's offsets, so the travel
		 * handed to the policy describes a layout change rather than the reader's own
		 * motion — the one thing clause A requires it to be. `at: 0` is what "no
		 * previous sample" means here, so the first notch of a fresh conversation
		 * carries no travel, exactly as the first notch of the first-ever
		 * conversation does.
		 */
		travel.current = {
			fromTail: 0,
			at: 0,
			extent: 0,
			clamped: false,
			revision: travel.current.revision + 1,
		};
		setRevealInFlight(false);
		// A failure from the previous conversation says nothing about this one, and
		// neither does a reveal that superseded it: this is the same reset the
		// session's own `olderFailed` gets. See `failureSuperseded`.
		setFailureSuperseded(false);
		// A fresh conversation may already be shorter than its viewport with more
		// history behind it, which is clause L's case and has no gesture to start
		// it. `continuation` is the only demand kind `decide` will honour without
		// input, and it honours it only while the scroller cannot scroll.
		state.current = { ...state.current, continuation: true };
		schedule();
	}, [sessionKey]);

	/*
	 * A failure is the present fact again, so a reveal that superseded an earlier
	 * one stops speaking for it (agent review round 1, M3). The pump's own ask has
	 * its own reset at the failure it observes; this covers the writers the hook
	 * never sees — `olderFailed`'s single writer is the session hook, and the align
	 * fetch, the jump walk and the mentioned-files scan all land there too.
	 *
	 * The RISING edge is what matters, and it is not the whole story: a repeat
	 * failure from one of those other writers while `olderFailed` is already true
	 * carries no edge, so a widen that intervened keeps the row on `windowed`
	 * until the pump's own next ask fails. That is the state the reader is
	 * actually in — rows ARE being revealed — and the row returns to `failed` the
	 * moment the local rows run out and the ask behind them fails, which is the
	 * honest statement of the backend being down.
	 */
	useEffect(() => {
		if (olderFailed) setFailureSuperseded(false);
	}, [olderFailed]);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		// A scrollbar drag emits no input event of its own, so `scroll` is
		// attributed to the reader only inside this window. See the header.
		let dragUntil = 0;
		let lastFromTail = Math.abs(el.scrollTop);

		const onWheel = (event: WheelEvent) => {
			if (event.deltaY === 0) return;
			// `deltaY < 0` is a push toward older content in a `column-reverse`
			// scroller exactly as it is in a normal one: the wheel's sign is about
			// the viewport's direction of travel, not the container's axis origin.
			input(event.deltaY < 0 ? "up" : "down", true);
		};
		const onTouch = () => {
			const fromTail = Math.abs(el.scrollTop);
			// A touch drag reports no delta of its own; the offset it produced is
			// the only statement of direction available.
			if (fromTail !== lastFromTail) {
				input(fromTail > lastFromTail ? "up" : "down", true);
				lastFromTail = fromTail;
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			switch (event.key) {
				case "Home":
					// The one keystroke that means "start of conversation". Deliberate,
					// so it re-arms the latch: the terminal UI gives `ctrl+home` the
					// same standing for the same reason.
					input("up", false, true);
					break;
				case "ArrowUp":
				case "PageUp":
					input("up", false);
					break;
				case "ArrowDown":
				case "PageDown":
				case "End":
					input("down", false);
					break;
				default:
					break;
			}
		};
		const onPointerDown = () => {
			/*
			 * Any pointer press on the scroller opens the attribution window, not
			 * just one landing in the scrollbar gutter.
			 *
			 * The gutter test this replaces computed the scrollbar's band from
			 * `clientLeft`/`clientWidth`, which is correct arithmetic for a
			 * classic scrollbar and wrong wherever the platform draws an OVERLAY
			 * one: macOS overlay scrollbars take no layout width, so
			 * `clientWidth` spans the full box, the band is empty, and the test
			 * could never be true. Measured: a real press-drag-release on the
			 * scrollbar reached the hard top and issued 0 requests, while a wheel
			 * from the same position issued a page — the reader's most explicit
			 * "take me back" gesture was the one input the policy ignored.
			 *
			 * Widening it to the whole element costs nothing and is more honest:
			 * a press followed by scrolling is a reader dragging something (the
			 * scrollbar, or a text selection that auto-scrolls), and neither is
			 * layout motion. Presses that scroll nothing open a window that
			 * expires unused, because `onScroll` still requires the offset to
			 * have actually changed.
			 */
			dragUntil = Number.POSITIVE_INFINITY;
		};
		const onPointerUp = () => {
			if (dragUntil === Number.POSITIVE_INFINITY)
				dragUntil = performance.now() + DRAG_TAIL_MS;
		};
		const onScroll = () => {
			const fromTail = Math.abs(el.scrollTop);
			const moved = fromTail - lastFromTail;
			lastFromTail = fromTail;
			if (ownWritePosition.current !== null) {
				const ours = Math.abs(el.scrollTop - ownWritePosition.current) <= 1;
				ownWritePosition.current = null;
				/*
				 * Our own correction: attribute nothing (clause A's second half).
				 * The claim was taken from our own write, so it is spent either
				 * way - a stale claim is exactly what R3-1 removed.
				 */
				if (ours) return;
			}
			/*
			 * Anything else that moved the viewport - the reader's own drag, the
			 * browser's anchoring, a re-clamp - re-reads the standing hold once the
			 * motion settles. See `refreshReaderHold` for the rules it applies.
			 */
			if (scrollSettle.current) window.clearTimeout(scrollSettle.current);
			scrollSettle.current = window.setTimeout(refreshReaderHold, SETTLE_MS);
			if (moved !== 0 && performance.now() <= dragUntil) {
				input(moved > 0 ? "up" : "down", true);
				return;
			}
			// An observation. It can still complete a decision an earlier gesture
			// armed (the offset it was waiting on has now changed), but it can never
			// arm one.
			schedule();
		};

		el.addEventListener("wheel", onWheel, { passive: true });
		el.addEventListener("touchmove", onTouch, { passive: true });
		el.addEventListener("keydown", onKeyDown);
		el.addEventListener("scroll", onScroll, { passive: true });
		el.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointerup", onPointerUp);
		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("touchmove", onTouch);
			el.removeEventListener("keydown", onKeyDown);
			el.removeEventListener("scroll", onScroll);
			el.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointerup", onPointerUp);
			// Reset the handles, do not merely cancel them. `schedule` uses
			// `pump.current` as a "already queued this frame" latch, so a handle
			// left non-zero after its frame was cancelled makes every later
			// `schedule()` return early and the hook goes permanently deaf. This
			// effect re-runs whenever its deps change, which happens on the first
			// commit after mount - so the wedge was not a rare race, it was the
			// steady state: measured in the running app, wheel events reached the
			// listener (6 of 6) and the pump never evaluated a single decision.
			if (pump.current) cancelAnimationFrame(pump.current);
			pump.current = 0;
			if (settleTimer.current) clearTimeout(settleTimer.current);
			settleTimer.current = 0;
			if (scrollSettle.current) clearTimeout(scrollSettle.current);
			scrollSettle.current = 0;
		};
	}, [containerRef, input, refreshReaderHold, schedule]);

	/*
	 * The anchor hold, driven by the extent itself rather than by the events
	 * that happened to change it.
	 *
	 * A `ResizeObserver` on the content wrapper fires on the same frame as each
	 * authored height, which is the frame the correction has to land in. Keying
	 * on the measurement rather than on an enumerated list of causes is what
	 * makes this hold for growth nobody thought of — a late image, a code block
	 * that reflows, a font that arrives — and it is the same argument the
	 * terminal transcript's `_on_extent_changed` hook makes for itself.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `contentKey` is not read in the body; it is here because the effect must RE-RUN when the observed content node appears, which the analyser cannot infer from a querySelector
	useEffect(() => {
		const el = containerRef.current;
		// By its own marker, never by position. `firstElementChild` was the
		// content wrapper only in a production build: in development the
		// transcript renders a `sr-only` performance readout ahead of it, so the
		// observer watched a zero-height span that never changes size and the
		// anchor was never re-asserted. A structural assumption that holds in one
		// build mode and not the other is not an assumption worth keeping.
		const content = el?.querySelector<HTMLElement>(
			"[data-lo-transcript-content]",
		);
		// A transcript that mounts EMPTY has no content node yet, and this effect's
		// other deps do not change when the first row arrives — so the attachment
		// was incidental rather than guaranteed. `contentKey` changes when the
		// transcript stops being empty, which is exactly when the node appears.
		if (!el || !content) return;
		const observer = new ResizeObserver(() => {
			correctAnchor();
			schedule();
		});
		observer.observe(content);
		observer.observe(el);
		return () => observer.disconnect();
	}, [containerRef, correctAnchor, schedule, contentKey]);

	// Geometry the policy reads can change without any event at all — a durable
	// page landing turns `hiddenRows` positive, exhausting the backend turns
	// `hasMore` false — so a change in either is a reason to re-decide.
	//
	// The rule sees these as "more dependencies than necessary" because
	// `schedule` reads them through the `live` ref rather than from the closure.
	// That indirection is the point: the rAF pump must not be re-created per
	// render, so its inputs travel by ref and the re-decide has to be triggered
	// by the values themselves.
	// biome-ignore lint/correctness/useExhaustiveDependencies: values are read through a ref by design
	useEffect(() => {
		schedule();
	}, [schedule, hiddenRows, hasMore]);

	/*
	 * Correct the anchor BEFORE the browser paints the rows that moved it.
	 *
	 * The ResizeObserver above is the general safety net - it catches growth
	 * nobody enumerated, like a late image - but it is delivered AFTER layout,
	 * so the frame that mounted the new rows is painted uncorrected and the
	 * reader sees exactly one lurch before it snaps back. Measured: a 6338px
	 * single-frame displacement with a net drift of 0.00px, which is the
	 * signature of a correction arriving one frame late rather than not at all.
	 * A net-zero jump is still a jump; it is the frame-to-frame number that
	 * describes what the eye sees.
	 *
	 * `useLayoutEffect` runs after the DOM is updated and before paint, so the
	 * correction lands in the same frame as the layout change that caused it -
	 * and it runs on EVERY COMMIT, not on `rowCount` alone (fold rounds,
	 * 2026-09-27). The widening is itself a measured finding: `rowCount` changes
	 * when rows ARRIVE, but a fold's body unmounting changes the transcript's
	 * height WITHOUT changing it, and the collapse's 228px displaced every
	 * settled row in the frame no correction ran (the operator's report: "even
	 * in that case where they collapse, it shouldn't result in the conversation
	 * shifting"). The drift computation is what keeps the every-commit run free:
	 * a commit that moved nothing computes zero and writes nothing.
	 */
	useLayoutEffect(() => {
		// `rowCount` stays read for the reason it exists in this signature: it is
		// the caller's row-arrival signal, now one of the commits this runs on
		// rather than the only trigger.
		void rowCount;
		correctAnchor();
	});

	/*
	 * One statement per act, and the loading paint outranks the two sentences that
	 * ask for a gesture. `loadingOlder` is the session hook's own in-flight flag
	 * and `revealInFlight` the policy's, so the row stays on "Loading earlier
	 * messages" from the moment a reveal is dispatched until the page's rows are
	 * actually on screen — including the window in which a landed page's rows are
	 * still held back and the count would otherwise be painted at a reader who
	 * cannot see it yet. See the note on `revealInFlight`.
	 *
	 * A FAILURE OUTRANKS THE TWO SENTENCES THAT ASK FOR A GESTURE (design §1.5
	 * D4/D9). The row used to paint `failed` only once the automatic retry budget
	 * was spent AND nothing was held back, so a reader whose asks were all failing
	 * while rows were still windowed read "Earlier history above — scroll up to
	 * load": it asked them to do the one thing that could not work. `olderFailed`
	 * is the session's single owner of that fact and now decides on its own —
	 * UNLESS a reveal the reader could see has landed since the failure
	 * (`failureSuperseded`, agent review round 1, M3), because then the row's
	 * advice is true again and a past blip must not keep claiming the reader has
	 * no way forward.
	 *
	 * AND THE END CLAIM IS GATED ON PROOF (remote-load-hydration). "Start of
	 * conversation" is a statement about the CONVERSATION, and `hasMore: false`
	 * alone cannot carry it: a read that never saw the conversation reports the
	 * same false `has_more` as a conversation with nothing behind it (the stored
	 * remote session's cold open — an empty page from a facade with no owner).
	 * `hydrationProven` is the transcript's own proof that a page has been read
	 * for this session, so the exhausted arm requires it and an unproven
	 * transcript gets the retry-able "not loaded" arm instead — never the end
	 * copy, and never a dead end.
	 */
	const slotState: OlderHistoryState =
		loadingOlder || revealInFlight
			? "loading"
			: olderFailed && !failureSuperseded
				? "failed"
				: hiddenRows > 0
					? "windowed"
					: hasMore
						? "idle"
						: hydrationProven
							? "exhausted"
							: "unproven";

	/*
	 * The completion walk's authorisation, in the module's own terms. See the
	 * handle's docstring for why it reads the live geometry and the policy's own
	 * clock instead of taking a snapshot: `state.current` is the same object
	 * `decide` reduces, so "the reader has been quiet for `SETTLE_MS`" here
	 * means exactly what it means to a spend.
	 */
	const mayAutoWalk = useCallback((): boolean => {
		if (performance.now() - state.current.lastInputAt < SETTLE_MS) return false;
		return measure()?.followingTail === true;
	}, [measure]);
	/** The tail half alone, for callers that already hold the clock (see the type). */
	const followingTail = useCallback(
		(): boolean => measure()?.followingTail === true,
		[measure],
	);

	return {
		slotState,
		requestOlder,
		mayAutoWalk,
		followingTail,
		acknowledgeOwnWrite,
	};
}
