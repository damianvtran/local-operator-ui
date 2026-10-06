/*
 * THE ACTIVITY HALF OF THE SCROLLBAR FADE. The paint lives in
 * `shared/components/common/global-scrollbar-styles.tsx` (one registered
 * `--lo-sb`, transitioned on the scroller, read by the thumb); this module is
 * the only thing in the app that decides WHEN a scrollbar is awake, and it
 * decides it by writing one attribute. Design: `docs/design/scrollbars-fade.md`.
 * The mechanism and the probes behind it: the architect memo that note cites.
 *
 * WHY AN ATTRIBUTE AND NOT A STYLE OR A REACT STATE. The transition runs on the
 * scroller element and reads its properties from the AFTER-change style, so the
 * two fade durations live on `[data-lo-scrollbar]` (out) and
 * `[data-lo-scrollbar="active"]` (in). An element that is ALREADY active
 * therefore gets no DOM write — only a later expiry — because a write per event
 * restarts the transition, and that restart is the flicker this change exists
 * to prevent. Nothing here re-renders React and no theme value passes through
 * it: a theme switch repaints the thumb through the CSS `var()` alone.
 *
 * WHAT IT MUST NEVER DO (perf lane constraint, v0.31.24 stutter audit). ALL its
 * document listeners are strictly OBSERVATIONAL: passive, capture-phase, and
 * they never read or write scroll state — no `scrollTop`, no `scroll-behavior`,
 * no `scrollTo`, no `preventDefault`. That is not boilerplate here: the
 * transcript is a reversed-axis region (`flex-col-reverse`, negative
 * `scrollTop`) carrying its own programmatic-write counter and drag-tail logic
 * in `use-scroll-paging`, and a listener that touched either would fight it.
 * The only value this module reads is `overflow` from computed style, and the
 * only thing it writes is `data-lo-scrollbar`.
 *
 * THE KEYBOARD CUE IS A REVEAL LIKE ANY OTHER (review round 1: M1 / Q1 / D1 /
 * U1). A reader who has TABBED onto a scroller has not scrolled it and has not
 * pointed at it, so neither of the original two doors fires for them. The
 * stylesheet's own `:focus-visible` animation could not cover that case either,
 * because it keyed on an attribute the OTHER two doors write — so it played for
 * the readers who had already been shown the bar and never for the one who had
 * not. `focusin` is the third door, and it drives the same attribute and the
 * same hold the wheel does. That is also why the stylesheet carries no
 * `animation` at all any more: an animation on the scroller takes
 * `animation-name` (and resets `animation-timeline`) away from anything else
 * animating that element — U2 measured the transcript's own scroll-linked top
 * fade popping for exactly that reason — while a custom property composes.
 *
 * COST DISCIPLINE. Every element's computed style is resolved at most ONCE for
 * a POSITIVE answer (the `WeakMap`s below, and see `isScroller` for why the
 * negatives are not kept); the ancestor walk happens once per distinct event
 * target, not once per event; the qualifying-event path is a map write plus a
 * timer arming that only happens when no timer is outstanding. A read that
 * scales with event count is the thing this file is written to avoid.
 */

/** How long a reveal is held after the last qualifying event. */
export const SCROLLBAR_HOLD_MS = 2200;
/**
 * The fade in — deliberately the shorter half of the pair. The contract's
 * duration ramp is 80/120/180/240 ms, and a reveal is a state change on an
 * element that is already on screen: the bar should be there when the eye
 * arrives, so this is the second step and the shorter side.
 */
export const SCROLLBAR_FADE_IN_MS = 120;
/** The fade out. Leaving is slower than arriving, so it reads as a fade. */
export const SCROLLBAR_FADE_OUT_MS = 180;
/**
 * What the thumb paints when the bar is at rest (issue #845).
 *
 * The fade runs between this and 1, so it is the fraction of `--color-control`
 * an idle thumb keeps. Idle used to be 0 - an invisible bar - and the amendment
 * is that rest is a FAINT state rather than the absence of one. The value is
 * measured rather than picked: over the fifty-nine palettes and every ground a
 * scroller can sit on, 0.45 gives 1.55:1 at worst (so the thumb reads) and
 * 2.24:1 at best (so it can never read as a full-strength control, and stays
 * under the 3:1 non-text floor everywhere). The full derivation, including the
 * two rejected neighbours, is beside the rule that spends it
 * (`shared/components/common/global-scrollbar-styles.tsx`).
 */
export const SCROLLBAR_RESTING_FLOOR = 0.45;
/** The app's own ease for a value that grows and settles (`styles/index.css`). */
export const SCROLLBAR_EASING = "cubic-bezier(0.4, 0, 0.6, 1)";
/** The attribute vocabulary: the element the reader is in, and the one at rest. */
export const SCROLLBAR_ATTRIBUTE = "data-lo-scrollbar";
export const SCROLLBAR_ACTIVE = "active";
export const SCROLLBAR_IDLE = "idle";
/**
 * The marker on the root of a subtree whose attribute mutations an undo stack
 * is watching (the canvas wysiwyg editor's root). It is what the exclusion
 * below is keyed on — see `insideEditableRegion` for why the `contenteditable`
 * test alone is not enough.
 */
export const UNDO_SCOPE_ATTRIBUTE = "data-undo-scope";

/** The timers this module needs, injectable so tests carry no real ones. */
export interface ScrollbarActivityClock {
	now(): number;
	setTimer(callback: () => void, delayMs: number): unknown;
	clearTimer(handle: unknown): void;
}

export interface InstallScrollbarActivityOptions {
	/** The document to listen on. Defaults to the ambient one. */
	doc?: Document;
	clock?: ScrollbarActivityClock;
	/**
	 * What makes an element a scroller. Defaults to the computed-`overflow`
	 * test; injected by tests, which have no styles to compute.
	 */
	isScroller?: (element: Element) => boolean;
	holdMs?: number;
}

const DEFAULT_CLOCK: ScrollbarActivityClock = {
	now: () => Date.now(),
	setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The computed `overflow` values that make an element a scroller. Hoisted to the
 * top level because this predicate runs inside a `pointerover` handler (the
 * repo's `useTopLevelRegex` rule: a regex built per call is a per-event cost).
 */
const SCROLLING_OVERFLOW = /^(auto|scroll)$/;

/**
 * Whether the browser would give this element a scrollbar: `overflow` is
 * `auto` or `scroll` on either axis.
 *
 * `scrollHeight > clientHeight` is deliberately NOT the test — that reads
 * layout, and this predicate resolves inside a `pointerover` handler that fires
 * for every element the pointer crosses. The computed value answers the same
 * question from style alone (memo § B: LayoutCount 0 with this module).
 */
const elementOverflows = (element: Element): boolean => {
	const style = getComputedStyle(element);
	return (
		SCROLLING_OVERFLOW.test(style.overflowX) ||
		SCROLLING_OVERFLOW.test(style.overflowY)
	);
};

/**
 * The exclusion, and WHY IT IS A WALK RATHER THAN ONE INHERITED PROPERTY. The
 * canvas editor's undo manager observes attribute mutations in its own subtree
 * and treats every attribute but `data-highlight` as a content change
 * (`shared/lib/undo-manager.ts`, `handleMutation`), so an attribute write
 * anywhere inside that subtree manufactures undo steps out of a scrollbar's
 * fade. The first version of this guard tested `isContentEditable` alone, which
 * is the wrong question twice over (review round 1, M2 / Q3 — reproduced as
 * history 1 -> 3 with the repo's own manager):
 *
 * - the manager's scope is the element it was CONNECTED to (`editorRef`, the
 *   `contentEditable={!reviewState}` root), not wherever editability happens to
 *   be inherited from, and in review state that root is not editable at all;
 * - the diff bodies injected into it carry `contenteditable="false"` and hold
 *   scroller `pre` elements, and an inherited test calls those "not editable",
 *   which is exactly backwards — `false` means "this part of the document is not
 *   yours to edit", not "this part is outside the document".
 *
 * So the test is structural, on the way up: the element is inside a watched
 * subtree when ANY node from it to the root is editable (`isContentEditable` —
 * the live-editing shape), carries an explicit `contenteditable` attribute of
 * any value (the `false` shape, and the root's own), or carries the
 * `data-undo-scope` marker the editor root puts there. The marker is what makes
 * this independent of React's rendering of `contentEditable={false}` and of the
 * review-state flip; the two attribute tests are what keep it working on the
 * subtree shapes that existed before it.
 *
 * The editor's own scroll container is an ANCESTOR of all of this (the
 * `overflow-y-auto` wrapper), so it is outside the scope and still fades
 * normally; a scroller nested inside the document body does not fade, which is
 * the accepted cost of never writing inside a document the user's undo stack is
 * watching (design note § 9.8).
 *
 * NO CACHE, DELIBERATELY. Unlike the scroller test this is a walk of attribute
 * reads with no style resolution behind it, and its answer is state-dependent
 * in the other direction (a subtree becomes watched when the editor mounts, and
 * the root's editability flips with the review button), so a memo here would be
 * a stale answer waiting to happen.
 */
const EDITABLE_ATTRIBUTE = "contenteditable";
const insideEditableRegion = (element: Element): boolean => {
	let node: Element | null = element;
	while (node !== null) {
		if ((node as HTMLElement).isContentEditable === true) return true;
		if (node.getAttribute(EDITABLE_ATTRIBUTE) !== null) return true;
		if (node.getAttribute(UNDO_SCOPE_ATTRIBUTE) !== null) return true;
		node = node.parentElement;
	}
	return false;
};

/**
 * The element an event target is, or null when it is not one. `nodeType === 1`
 * and not "has a numeric nodeType": a `scroll` that reaches a document-level
 * capture listener with the DOCUMENT as its target (nodeType 9, which happens
 * the moment anything lets the viewport itself scroll) would otherwise be
 * passed to `getComputedStyle`, which throws inside the listener (review round
 * 1, Min2 / Q4).
 */
const asElement = (target: EventTarget | null): Element | null =>
	target !== null && (target as Element).nodeType === 1
		? (target as Element)
		: null;

/**
 * `:focus-visible` — the browser's own answer to "did this focus arrive from
 * the keyboard". A click into a scroller does not make it focus-visible, so the
 * pointer-driven reader gets no blip from a click (measured: U2's control run).
 */
const FOCUS_VISIBLE = ":focus-visible";

/**
 * Install the scrollbar activity tracking. Returns the uninstall function, so a
 * test, a hot reload or a second document can take it back off.
 *
 * Call once per document: `main.tsx` beside `<GlobalScrollbarStyles />`. Each
 * listener is registered ONCE for the whole app and covers every container,
 * present and future (memo § F) — there is no per-container registration, no
 * `ResizeObserver` and no `requestAnimationFrame` anywhere in this module.
 */
export function installScrollbarActivity(
	options: InstallScrollbarActivityOptions = {},
): () => void {
	const doc = options.doc ?? document;
	const clock = options.clock ?? DEFAULT_CLOCK;
	const holdMs = options.holdMs ?? SCROLLBAR_HOLD_MS;

	/** element → the timestamp at which its reveal expires. */
	const expiries = new Map<Element, number>();
	/*
	 * Both caches are `WeakMap`s keyed by an element the app already holds, so
	 * they cost nothing to keep and can never retain a detached node. Both keep
	 * POSITIVE answers only — see `isScroller` and `scrollerFor` for why a cached
	 * negative is a defect rather than a saving.
	 */
	const scrollerAnswers = new WeakMap<Element, boolean>();
	const nearestScroller = new WeakMap<Element, Element | null>();
	let timer: unknown = null;

	/** `elementOverflows`, or the injected predicate, resolved once per element. */
	const isScroller = (element: Element): boolean => {
		const cached = scrollerAnswers.get(element);
		if (cached !== undefined) return cached;
		const answer = (options.isScroller ?? elementOverflows)(element);
		/*
		 * ONLY THE POSITIVES ARE KEPT, and that is a correctness rule rather than a
		 * cost one (review round 1, M3 / Q2, reproduced in the real renderer).
		 * `overflow` is state-dependent on live surfaces — the transcript flips
		 * between `overflow-hidden` and `overflow-auto`, a detail part flips with
		 * `max-h-64 overflow-y-auto` on expand — so a cached `false` outlives the
		 * state that produced it and the element can never reveal again, hover or
		 * scroll, for the rest of the session. A `true` cannot go stale that way:
		 * an element that is a scroller stays one, and the walk below stops on it.
		 */
		if (answer) scrollerAnswers.set(element, answer);
		return answer;
	};

	/**
	 * The nearest scroller at or above `start`, inclusive — the innermost one,
	 * which is the bar the reader is actually over (memo § B: walking to the
	 * outermost reveals the wrong bar, and an inherited value then leaks into the
	 * inner one that never asked for it).
	 *
	 * Resolved once per distinct target because `pointerover` fires for every
	 * element the pointer crosses: without the memo the same card would walk its
	 * ancestors on every hover.
	 *
	 * The walk STOPS at an undo-observed subtree rather than jumping over it. An
	 * inner scroller that is inside the editor must not reveal the editor's own
	 * container instead — the write is what must not happen, not merely the
	 * outermost choice of target.
	 */
	const scrollerFor = (target: EventTarget | null): Element | null => {
		const start = asElement(target);
		if (start === null) return null;
		const cached = nearestScroller.get(start);
		if (cached !== undefined) return cached;
		/*
		 * THE SCOPE TEST RUNS ONCE, ON THE START (review round 2, R2-1). The
		 * predicate is ancestry-inherited — a node deeper in the walk is inside a
		 * watched subtree only if the start was — so testing every node asked the
		 * same question O(depth) times per walk, and the walks that find nothing
		 * (most pointerover targets) paid O(depth²) attribute reads for an answer
		 * the first test already had. Same answer, one walk.
		 */
		if (insideEditableRegion(start)) return null;
		let found: Element | null = null;
		let node: Element | null = start;
		while (node !== null) {
			if (isScroller(node)) {
				found = node;
				break;
			}
			node = node.parentElement;
		}
		/*
		 * ONLY THE POSITIVES ARE KEPT, for the reason `isScroller` gives: a cached
		 * "nothing scroller-shaped above this element" is a statement about the tree
		 * at one moment, and the tree moves — a collapsed panel expands, a route
		 * renders, a `max-h-64 overflow-y-auto` detail part grows, and the walk's
		 * negative answer would then outlive it for every element the pointer
		 * crosses afterwards (review round 1, M3 / Q2: the same defect one level up).
		 */
		if (found !== null) nearestScroller.set(start, found);
		return found;
	};

	/**
	 * The one DOM write this module makes, and it is conditional by design: an
	 * element that is already `active` gets nothing but a later expiry, so a
	 * wheel at event rate cannot restart the transition.
	 *
	 * FIRST SIGHT writes `idle` before `active`. The transition rule keys on the
	 * attribute being present, and the memo's forced rule is that the rule must
	 * have matched once before `active` lands — a transition needs a stable start
	 * state.
	 */
	const reveal = (element: Element | null): void => {
		if (element === null || element.isConnected !== true) return;
		const state = element.getAttribute(SCROLLBAR_ATTRIBUTE);
		if (state !== SCROLLBAR_ACTIVE) {
			if (state === null) {
				element.setAttribute(SCROLLBAR_ATTRIBUTE, SCROLLBAR_IDLE);
			}
			element.setAttribute(SCROLLBAR_ATTRIBUTE, SCROLLBAR_ACTIVE);
		}
		expiries.set(element, clock.now() + holdMs);
		arm();
	};

	/**
	 * Expire what is due, drop what is gone, and re-arm for whatever is left.
	 *
	 * A disconnected element is dropped WITHOUT a DOM write: the node is out of
	 * the document, so a write would cost a mutation record for a bar nobody can
	 * see.
	 */
	function sweep(): void {
		timer = null;
		const now = clock.now();
		for (const [element, expiry] of [...expiries]) {
			if (element.isConnected !== true) {
				expiries.delete(element);
				continue;
			}
			if (expiry <= now) {
				expiries.delete(element);
				if (element.getAttribute(SCROLLBAR_ATTRIBUTE) === SCROLLBAR_ACTIVE) {
					element.setAttribute(SCROLLBAR_ATTRIBUTE, SCROLLBAR_IDLE);
				}
			}
		}
		arm();
	}

	/**
	 * ONE armed timeout for the whole app, and never re-armed per event.
	 *
	 * A qualifying event only moves a `Map` entry; the timer is armed here when
	 * none is outstanding and again from the sweep if entries remain. It goes
	 * dormant when the map empties, so an idle app holds no timer at all and a
	 * scroll at event rate costs a map write rather than a timer churn.
	 */
	function arm(): void {
		if (timer !== null || expiries.size === 0) return;
		let next = Number.POSITIVE_INFINITY;
		for (const expiry of expiries.values()) {
			if (expiry < next) next = expiry;
		}
		timer = clock.setTimer(sweep, Math.max(next - clock.now(), 0));
	}

	/** Any scroll: wheel, momentum, thumb drag, touch, keyboard, or a jump. */
	const onScroll = (event: Event): void => {
		const element = asElement(event.target);
		if (element === null) return;
		/*
		 * The scroller test runs first because it is the cached one; the scope walk
		 * behind it is a handful of attribute reads and only runs for elements that
		 * are actually scrollers, which is a small set even on a scroll.
		 */
		if (!isScroller(element)) return;
		if (insideEditableRegion(element)) return;
		reveal(element);
	};

	/** Any pointer entering a scroller — including the scroller's own 8px strip. */
	const onPointerOver = (event: Event): void => {
		reveal(scrollerFor(event.target));
	};

	/**
	 * A press inside a scroller re-arms the hold, so a drag that has not produced
	 * a `scroll` yet cannot let the bar disappear under the hand.
	 */
	const onPointerDown = (event: Event): void => {
		reveal(scrollerFor(event.target));
	};

	/**
	 * The keyboard door: focus arriving on (or inside) a scroller reveals it for
	 * the ordinary hold, cold or not.
	 *
	 * KEYBOARD ONLY, by the browser's own definition of it. `:focus-visible` is
	 * the platform's answer to "was this focus keyboard-driven", so a click that
	 * focuses a scroller does not blip it while a Tab does; a host that cannot
	 * answer the question at all fails OPEN (the cue matters more than a stray
	 * reveal), and that choice is spelled out rather than implied.
	 *
	 * Nothing is written when the focused element is not inside a scroller, and
	 * the scope guard is the same one the other doors use — the editor is
	 * keyboard-reachable, and tabbing into it must not manufacture undo steps
	 * either.
	 */
	const onFocusIn = (event: Event): void => {
		const start = asElement(event.target);
		if (start === null) return;
		if (insideEditableRegion(start)) return;
		const keyboardDriven =
			typeof (start as Element).matches !== "function" ||
			(start as Element).matches(FOCUS_VISIBLE);
		if (!keyboardDriven) return;
		reveal(scrollerFor(start));
	};

	/*
	 * `{capture: true, passive: true}`: capture because a scroll event does not
	 * bubble and no other handler should be able to keep this one from seeing it;
	 * passive because a listener that never calls `preventDefault` should say so
	 * and leave the compositor free to scroll without waiting on it.
	 */
	const listenerOptions: AddEventListenerOptions = {
		capture: true,
		passive: true,
	};
	doc.addEventListener("scroll", onScroll, listenerOptions);
	doc.addEventListener("pointerover", onPointerOver, listenerOptions);
	doc.addEventListener("pointerdown", onPointerDown, listenerOptions);
	doc.addEventListener("focusin", onFocusIn, listenerOptions);

	return () => {
		doc.removeEventListener("scroll", onScroll, listenerOptions);
		doc.removeEventListener("pointerover", onPointerOver, listenerOptions);
		doc.removeEventListener("pointerdown", onPointerDown, listenerOptions);
		doc.removeEventListener("focusin", onFocusIn, listenerOptions);
		if (timer !== null) {
			clock.clearTimer(timer);
			timer = null;
		}
		expiries.clear();
	};
}
