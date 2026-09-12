import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { OlderHistoryState } from "./older-history-slot";
import {
	type AnchorSample,
	type PagingGeometry,
	type PagingState,
	SETTLE_MS,
	TAIL_EPS_PX,
	anchorDrift,
	decide,
	initialPagingState,
	isExhausted,
	noteFailed,
	noteInput,
	noteSettled,
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

/** How long after a reveal the anchor keeps being re-asserted. */
const ANCHOR_HOLD_MS = 1200;

/** How long a scrollbar drag's attribution window outlives its `pointerup`. */
const DRAG_TAIL_MS = 120;

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
	/** Reveal the next batch of already-fetched rows. Synchronous and free. */
	onWiden: () => void;
	/**
	 * Fetch the next durable page. Resolves `true` when a page was applied and
	 * `false` when the request failed, which is the signal the bounded-retry
	 * rule needs; it never rejects.
	 */
	onLoadOlder: () => Promise<boolean>;
	/** A page fetch is in flight, as the session hook sees it. */
	loadingOlder: boolean;
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
};

export function useScrollPaging({
	containerRef,
	sessionKey,
	hiddenRows,
	hasMore,
	onWiden,
	onLoadOlder,
	loadingOlder,
}: ScrollPagingOptions): ScrollPagingHandle {
	const state = useRef<PagingState>(initialPagingState());
	// The slot's rendered state is the only thing this hook publishes, so it is
	// the only thing that re-renders the transcript. Everything else lives in
	// refs: a demand arming or a settle timer firing must not repaint a list
	// that repaints per token already.
	const [failed, setFailed] = useState(false);

	// Latest values for the rAF pump, which must not be re-created per render.
	const live = useRef({ hiddenRows, hasMore, onWiden, onLoadOlder });
	live.current = { hiddenRows, hasMore, onWiden, onLoadOlder };

	const anchor = useRef<{ sample: AnchorSample | null; until: number }>({
		sample: null,
		until: 0,
	});
	// Writes this hook makes to `scrollTop`. The resulting `scroll` event is our
	// own motion and must never be attributed to the reader (clause A).
	const programmatic = useRef(0);
	const pump = useRef<number>(0);
	const settleTimer = useRef<number>(0);

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

	/** Re-assert the held anchor. Cheap, and a no-op on a stable extent. */
	const correctAnchor = useCallback(() => {
		const el = containerRef.current;
		const held = anchor.current.sample;
		if (!el || !held) return;
		if (performance.now() > anchor.current.until) {
			anchor.current.sample = null;
			return;
		}
		const drift = anchorDrift(held, sampleAnchor());
		if (drift === 0) return;
		programmatic.current += 1;
		el.scrollTop -= drift;
		// The sample's extent is refreshed, not the offset: the offset is the
		// invariant being defended, and re-reading it would let each correction
		// ratify whatever the previous one failed to fix.
		anchor.current.sample = { ...held, extent: el.scrollHeight };
	}, [containerRef, sampleAnchor]);

	/** Hold the reader's place across the next `ANCHOR_HOLD_MS` of settling. */
	const holdAnchor = useCallback(() => {
		anchor.current = {
			sample: sampleAnchor(),
			until: performance.now() + ANCHOR_HOLD_MS,
		};
	}, [sampleAnchor]);

	/**
	 * One decision, coalesced to an animation frame.
	 *
	 * Every path that can change the answer calls this; the rAF is what turns a
	 * fling's dozens of wheel events into one evaluation per painted frame.
	 */
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
			if (action === "none") {
				// An armed demand waiting only on the settle debounce needs someone to
				// ask again once the debounce expires: no further input is coming, by
				// definition of having settled.
				if (next.armed && !settleTimer.current) {
					settleTimer.current = window.setTimeout(() => {
						settleTimer.current = 0;
						schedule();
					}, SETTLE_MS);
				}
				return;
			}
			holdAnchor();
			if (action === "widen") {
				live.current.onWiden();
				// The reveal is a React commit away. One frame is enough to let it
				// land; the anchor hold covers the settling that follows.
				requestAnimationFrame(() => {
					state.current = noteSettled(state.current);
					schedule();
				});
				return;
			}
			void live.current.onLoadOlder().then((ok) => {
				setFailed(!ok);
				state.current = ok
					? noteSettled(state.current)
					: noteFailed(state.current);
				requestAnimationFrame(schedule);
			});
		});
	}, [holdAnchor, measure]);

	/** Fold one real gesture in, then re-decide. */
	const input = useCallback(
		(direction: "up" | "down", continuous: boolean, deliberate = false) => {
			const geo = measure();
			state.current = noteInput(state.current, {
				direction,
				continuous,
				deliberate,
				atHardTop: (geo?.distanceFromTopPx ?? Number.POSITIVE_INFINITY) <= 2,
				at: performance.now(),
			});
			if (deliberate) setFailed(false);
			schedule();
		},
		[measure, schedule],
	);

	const requestOlder = useCallback(() => {
		input("up", false, true);
	}, [input]);

	// Clause H. A different conversation inherits nothing: not the latch, not a
	// retained demand, not an anchor held against rows that no longer exist.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on session change only
	useEffect(() => {
		state.current = initialPagingState();
		anchor.current = { sample: null, until: 0 };
		setFailed(false);
		// A fresh conversation may already be shorter than its viewport with more
		// history behind it, which is clause L's case and has no gesture to start
		// it. `continuation` is the only demand kind `decide` will honour without
		// input, and it honours it only while the scroller cannot scroll.
		state.current = { ...state.current, continuation: true };
		schedule();
	}, [sessionKey]);

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
		const onPointerDown = (event: PointerEvent) => {
			// Inside the scrollbar gutter: past the content box on either edge.
			// `scrollbar-gutter: stable both-edges` puts one on each side, so both
			// are checked.
			const rect = el.getBoundingClientRect();
			const inGutter =
				event.clientX > rect.left + el.clientLeft + el.clientWidth ||
				event.clientX < rect.left + el.clientLeft;
			if (inGutter) dragUntil = Number.POSITIVE_INFINITY;
		};
		const onPointerUp = () => {
			if (dragUntil === Number.POSITIVE_INFINITY)
				dragUntil = performance.now() + DRAG_TAIL_MS;
		};
		const onScroll = () => {
			const fromTail = Math.abs(el.scrollTop);
			const moved = fromTail - lastFromTail;
			lastFromTail = fromTail;
			if (programmatic.current > 0) {
				// Our own correction. Consume the acknowledgement and attribute
				// nothing: clause A's second half.
				programmatic.current -= 1;
				return;
			}
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
			if (pump.current) cancelAnimationFrame(pump.current);
			if (settleTimer.current) clearTimeout(settleTimer.current);
		};
	}, [containerRef, input, schedule]);

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
	useEffect(() => {
		const el = containerRef.current;
		const content = el?.firstElementChild;
		if (!el || !content) return;
		const observer = new ResizeObserver(() => {
			correctAnchor();
			schedule();
		});
		observer.observe(content);
		observer.observe(el);
		return () => observer.disconnect();
	}, [containerRef, correctAnchor, schedule]);

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

	const exhaustedRetries = isExhausted(state.current);
	const slotState: OlderHistoryState = loadingOlder
		? "loading"
		: failed && (exhaustedRetries || hiddenRows === 0)
			? "failed"
			: hiddenRows > 0
				? "windowed"
				: hasMore
					? "idle"
					: "exhausted";

	return { slotState, requestOlder };
}
