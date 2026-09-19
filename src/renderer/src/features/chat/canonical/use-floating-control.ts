/**
 * Where a floating control sits, and every event that moves it.
 *
 * Extracted from `quote-toolkit.tsx` when the transcript gained a second floating
 * control (the link toolbar), because this half of the affordance is a set of
 * disciplines that were each arrived at the hard way and a second copy is a
 * second place for them to rot:
 *
 * - `placeQuoteControl` is a PURE function of boxes, and its input may not
 *   contain the control's own output (round 1: code review M1, UX U9, QA Q27 -
 *   the control walked 40px down the pane per re-measuring event because the
 *   placement range had been clipped over its own box). This hook calls it and
 *   nothing else, so both callers inherit that, and both pass the WHOLE anchor's
 *   own boxes — the highlight's, with every mounted control's box already removed
 *   (`highlightLines`), or the link's.
 * - THE EVENTS ARE COALESCED INTO ONE MEASURE PER FRAME (code review round 1,
 *   m4): every handler here reads layout (`getClientRects`, three
 *   `getBoundingClientRect` calls and the control's own offset size) on the one
 *   surface whose own header calls it out as the one that "repaints per token",
 *   and a trackpad delivers scroll events faster than a frame. Coalescing costs
 *   nothing visually because `placement` is ROW-relative - a plain scroll moves
 *   the row and the control together, so the only frames that need a new number
 *   are the flip and the clamps, where a frame of latency is what React's state
 *   update already costs.
 * - A REFLOW INSIDE THE VIEWPORT FIRES NO EVENT (code review round 1, m1). A row
 *   above the anchor that gains height - an attached image finishing its load, a
 *   streaming answer's markdown settling - moves the anchor with no scroll event
 *   at all, and the control would keep an offset that no longer describes
 *   anything. `ResizeObserver` on the content wrapper and on the scroller is the
 *   general answer, and it is the one `use-scroll-paging.ts` already uses for the
 *   same class of growth.
 * - `useLayoutEffect` because the position is measured from the control's own box:
 *   it runs after the DOM mutation and before paint, so the reader never sees a
 *   frame of the control standing at the row's origin before it is placed.
 *
 * `visible` is the caller's gate: a control that should not be on screen is not
 * measured at all, which is also what keeps an absent control from asking for a
 * box it does not have.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	type Box,
	type QuotePlacement,
	placeQuoteControl,
} from "./quote-anchor";

/**
 * The scroller the control is clamped inside: the transcript's own scroll box,
 * which already carries this marker for the harnesses and for the paging policy.
 * Read with `closest()` rather than threaded down through the rows, because it is
 * the element's own answer and a second prop would be a second place to keep it
 * correct.
 */
const SCROLLER_SELECTOR = "[data-lo-canonical-transcript]";

/**
 * The transcript's content wrapper: the node that GROWS when a row above the
 * anchor gains height, which is the reflow no event reports. Same marker
 * `use-scroll-paging.ts` watches for the same reason.
 */
const CONTENT_SELECTOR = "[data-lo-transcript-content]";

/** A viewport box, from any element or range rect. No scroll offset is applied. */
const boxOf = (rect: {
	top: number;
	left: number;
	right: number;
	bottom: number;
}): Box => ({
	top: rect.top,
	left: rect.left,
	right: rect.right,
	bottom: rect.bottom,
});

const viewportBox = (): Box => ({
	top: 0,
	left: 0,
	right: window.innerWidth,
	bottom: window.innerHeight,
});

export type FloatingControl = {
	/**
	 * Attach to the floating control's own element.
	 *
	 * `RefObject<HTMLDivElement>` and not the nullable spelling: this repository is
	 * on React 18, where `RefObject<T>` is already `{ readonly current: T | null }`
	 * and `useRef<T>(null)` returns exactly that - a `RefObject<T | null>` here
	 * would be the React 19 shape and would not be assignable to a `ref` prop.
	 */
	controlRef: React.RefObject<HTMLDivElement>;
	/**
	 * Where to put it, in the TURN's coordinates, or `null` when it should not be
	 * painted - before its first measurement, and while its anchor's own first
	 * line is off screen.
	 */
	placement: QuotePlacement | null;
};

export function useFloatingControl(input: {
	/** The element a selection has to be inside, and the control's own frame. */
	turnRef: { readonly current: HTMLElement | null };
	/** False when the control is not on screen; nothing is measured then. */
	visible: boolean;
	/**
	 * The anchor's own line boxes, read at MEASURE time.
	 *
	 * A function rather than an array because the answer changes without a render
	 * - a scroll, a reflow, a second drag - and a value captured during render
	 * would place the control from where things were several frames ago. It is
	 * held in a ref so that a fresh function on every render cannot restart the
	 * effect below.
	 */
	lines: () => readonly Box[] | null;
	/**
	 * WHAT THE CONTROL IS ABOUT, for a control that stays mounted while its
	 * subject changes.
	 *
	 * The link toolbar is rendered at a stable JSX position inside its row
	 * (`canonical-transcript.tsx`), so moving the pointer from one link to another
	 * inside ONE turn RE-RENDERS it rather than re-mounting it - and none of the
	 * events this hook listens for (scroll, selectionchange, resize, the two
	 * `ResizeObserver`s) fires when that happens. Round 1 (design D1, confirmed at
	 * the code level by the code review) measured the result: the strip's contents
	 * and accessible name followed the new link while its RECT stayed where the
	 * first link's had been, so it floated over a target it was not about.
	 *
	 * A key in the layout effect's dependency list is the fix rather than a
	 * re-measure bolted onto `pointerover`: the effect that owns "measure once, then
	 * follow the events" is the one that has to know its subject changed, and any
	 * other placement would be a second, weaker copy of that rule. The caller
	 * passes the subject ELEMENT (its identity, not an href - two links can share
	 * one, and a row re-renders per delta).
	 */
	measureKey?: unknown;
	/**
	 * Prefer below the anchor when the anchor is not on its row's first line; see
	 * `QuoteAnchorInput.belowWhenOffFirstLine`. The quote control leaves it off.
	 */
	belowWhenOffFirstLine?: boolean;
}): FloatingControl {
	const { turnRef, visible, lines, measureKey, belowWhenOffFirstLine } = input;
	const controlRef = useRef<HTMLDivElement>(null);
	const [placement, setPlacement] = useState<QuotePlacement | null>(null);

	/*
	 * The latest reader, written during render rather than in an effect: every
	 * read of it happens in an event handler or a layout effect that runs AFTER
	 * the commit which wrote it, so the value can never be read a commit early,
	 * and keeping it out of the dependency array is what stops a new closure per
	 * render from tearing down and rebuilding the listeners below.
	 */
	const readLines = useRef(lines);
	readLines.current = lines;

	const measure = useCallback(() => {
		const turn = turnRef.current;
		const control = controlRef.current;
		if (!turn || !control) {
			setPlacement(null);
			return;
		}
		const anchor = readLines.current();
		if (!anchor || anchor.length === 0) {
			setPlacement(null);
			return;
		}
		const placed = placeQuoteControl({
			lines: anchor,
			container: boxOf(
				(turn.closest(SCROLLER_SELECTOR) ?? turn).getBoundingClientRect(),
			),
			viewport: viewportBox(),
			// Measured from the control itself rather than assumed from its
			// classes: the shell's height is pinned by the contrast gate but its
			// width comes from the buttons inside it, and a hard-coded pair here
			// is a second definition of the control's own size.
			size: { width: control.offsetWidth, height: control.offsetHeight },
			/*
			 * The ROW box, read here rather than passed in: it is the same box the
			 * returned offset is already computed against, so the mid-row rule and the
			 * offset cannot be measured against two different rows.
			 */
			row: boxOf(turn.getBoundingClientRect()),
			belowWhenOffFirstLine,
		});
		const row = turn.getBoundingClientRect();
		const next = placed
			? {
					top: placed.top - row.top,
					left: placed.left - row.left,
					placement: placed.placement,
				}
			: null;
		setPlacement((previous) =>
			previous === next ||
			(previous &&
				next &&
				previous.top === next.top &&
				previous.left === next.left &&
				previous.placement === next.placement)
				? previous
				: next,
		);
	}, [turnRef, belowWhenOffFirstLine]);

	/*
	 * `useLayoutEffect` because the position is measured from the control's own
	 * box: it runs after the DOM mutation and before paint, so the reader never
	 * sees a frame of the control standing at the row's origin before it is
	 * placed.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `measureKey` is the trigger, not a value the body reads - the effect re-measures when the control's SUBJECT changes under a stable mount, which is the whole point of the key (`canonical-transcript.tsx` renders this control at one JSX position per row, so a second link is a re-render, never a re-mount).
	useLayoutEffect(() => {
		if (!visible) {
			setPlacement(null);
			return;
		}
		measure();
		let frame = 0;
		const schedule = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				measure();
			});
		};
		document.addEventListener("scroll", schedule, true);
		document.addEventListener("selectionchange", schedule);
		window.addEventListener("resize", schedule);
		const scroller = turnRef.current?.closest(SCROLLER_SELECTOR);
		const content = scroller?.querySelector(CONTENT_SELECTOR);
		const observer = new ResizeObserver(schedule);
		if (scroller) observer.observe(scroller);
		if (content) observer.observe(content);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			document.removeEventListener("scroll", schedule, true);
			document.removeEventListener("selectionchange", schedule);
			window.removeEventListener("resize", schedule);
			observer.disconnect();
		};
	}, [visible, measure, turnRef, measureKey]);

	return { controlRef, placement };
}
