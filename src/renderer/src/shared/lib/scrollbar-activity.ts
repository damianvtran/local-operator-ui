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
 * WHAT IT MUST NEVER DO (perf lane constraint, v0.31.24 stutter audit). Both
 * document listeners are strictly OBSERVATIONAL: passive, capture-phase, and
 * they never read or write scroll state — no `scrollTop`, no `scroll-behavior`,
 * no `scrollTo`, no `preventDefault`. That is not boilerplate here: the
 * transcript is a reversed-axis region (`flex-col-reverse`, negative
 * `scrollTop`) carrying its own programmatic-write counter and drag-tail logic
 * in `use-scroll-paging`, and a listener that touched either would fight it.
 * The only value this module reads is `overflow` from computed style, and the
 * only thing it writes is `data-lo-scrollbar`.
 *
 * COST DISCIPLINE. Every element's computed style is resolved at most ONCE (the
 * `WeakMap`s below); the ancestor walk happens once per distinct event target,
 * not once per event; the qualifying-event path is a map write plus a timer
 * arming that only happens when no timer is outstanding. A read that scales
 * with event count is the thing this file is written to avoid.
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
/** The app's own ease for a value that grows and settles (`styles/index.css`). */
export const SCROLLBAR_EASING = "cubic-bezier(0.4, 0, 0.6, 1)";
/** The attribute vocabulary: the element the reader is in, and the one at rest. */
export const SCROLLBAR_ATTRIBUTE = "data-lo-scrollbar";
export const SCROLLBAR_ACTIVE = "active";
export const SCROLLBAR_IDLE = "idle";

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
 * The contenteditable exclusion, and WHY IT IS AN EXCLUSION RATHER THAN AN
 * ALLOWANCE. The canvas wysiwyg editor's undo manager observes attribute
 * mutations in its own subtree and treats every attribute but `data-highlight`
 * as a content change (`shared/lib/undo-manager.ts`, `handleMutation`), so an
 * attribute write inside a contenteditable region would manufacture undo steps
 * out of a scrollbar's fade.
 *
 * `isContentEditable` is inherited DOWN the tree, which is exactly the shape
 * this needs: the editor's own scroll container is an ANCESTOR of the editable
 * element (`wysiwyg-markdown-editor.tsx`, the `overflow-y-auto` wrapper), so it
 * resolves `false` here and still fades normally, while the editable element
 * and everything inside it is skipped. A scroller nested inside the document
 * body does not fade; that is the accepted cost of never writing inside a
 * document the user's undo stack is watching (design note § 9.4).
 */
const insideEditableRegion = (element: Element): boolean =>
	(element as HTMLElement).isContentEditable === true;

/** The element a `scroll` handler's target is, or null when it is not one. */
const asElement = (target: EventTarget | null): Element | null =>
	target !== null && typeof (target as Element).nodeType === "number"
		? (target as Element)
		: null;

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
	 * they cost nothing to keep and can never retain a detached node.
	 */
	const scrollerAnswers = new WeakMap<Element, boolean>();
	const nearestScroller = new WeakMap<Element, Element | null>();
	let timer: unknown = null;

	/** `elementOverflows`, or the injected predicate, resolved once per element. */
	const isScroller = (element: Element): boolean => {
		const cached = scrollerAnswers.get(element);
		if (cached !== undefined) return cached;
		const answer = (options.isScroller ?? elementOverflows)(element);
		scrollerAnswers.set(element, answer);
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
	 */
	const scrollerFor = (target: EventTarget | null): Element | null => {
		const start = asElement(target);
		if (start === null) return null;
		if (nearestScroller.has(start)) {
			return nearestScroller.get(start) ?? null;
		}
		let found: Element | null = null;
		let node: Element | null = start;
		while (node !== null) {
			if (insideEditableRegion(node)) break;
			if (isScroller(node)) {
				found = node;
				break;
			}
			node = node.parentElement;
		}
		nearestScroller.set(start, found);
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
		if (insideEditableRegion(element)) return;
		if (!isScroller(element)) return;
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

	return () => {
		doc.removeEventListener("scroll", onScroll, listenerOptions);
		doc.removeEventListener("pointerover", onPointerOver, listenerOptions);
		doc.removeEventListener("pointerdown", onPointerDown, listenerOptions);
		if (timer !== null) {
			clock.clearTimer(timer);
			timer = null;
		}
		expiries.clear();
	};
}
