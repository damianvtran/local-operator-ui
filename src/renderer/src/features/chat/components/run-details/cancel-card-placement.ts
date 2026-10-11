/**
 * The placed confirm card's geometry and press classification, shared by the
 * pane's two per-item cancels (wakes and jobs).
 *
 * WHY THIS MODULE EXISTS. The wakes' confirmation established these numbers
 * against measured defects: the anchor is a FROZEN rect rather than a live
 * control (the row unmounts under the canonical re-read), one placement
 * calculation happens at open time (a card that jumped mid-question would read
 * as a second event), and the outside-press dismissal has to tell a press that
 * can keep its own keyboard from one that cannot (F15: cancelling a pointerdown
 * swallows the press's compatibility events, so a press aimed at the composer
 * must not have its caret stolen). The jobs cancel needs the same three facts
 * for the same reasons — one card, two callers — and a second copy of the
 * arithmetic is exactly the drift `cardPlacement`'s callers cannot afford: the
 * card must land at the same pixel offset from whichever control opened it.
 *
 * The placed-portal approach itself (rather than the shared Radix popover) is
 * argued in `wake-cancel-popover.tsx`'s header: a coordinate anchor fights
 * Popper's re-measure model, and the measured cost of that fight was a jsdom
 * case growing from ~0.2 s to minutes.
 */

/** One control's viewport rect, captured at press time. */
export type CancelCardAnchor = {
	left: number;
	top: number;
	bottom: number;
	right: number;
};

/** The card's own width; the panel primitive's own `w-72`. */
export const CARD_WIDTH = 288;
/** Gap between the pressed control and the card. */
export const CARD_GAP = 6;
/** The room a card needs below the control before it flips above it. */
export const CARD_MIN_ROOM = 168;

/**
 * Where the card goes, in viewport coordinates, from the frozen rect.
 *
 * One calculation, at render time, for the reason the placement module's
 * header states: the card keeps the place the press gave it. Right-aligned to
 * the control (the pane's rows put their controls at the column's right edge)
 * and clamped into the viewport so a narrow window cannot push it off-screen.
 */
export const cardPlacement = (
	anchor: CancelCardAnchor,
	viewport: { width: number; height: number },
): { left: number; top: number | undefined; bottom: number | undefined } => {
	const left = Math.min(
		Math.max(anchor.right - CARD_WIDTH, 8),
		Math.max(viewport.width - CARD_WIDTH - 8, 8),
	);
	const below = anchor.bottom + CARD_GAP;
	if (below + CARD_MIN_ROOM <= viewport.height)
		return { left, top: below, bottom: undefined };
	return {
		left,
		top: undefined,
		bottom: Math.max(viewport.height - anchor.top + CARD_GAP, 8),
	};
};

/** The focusable taxonomy a press default can land on, by element. */
export const PRESS_FOCUS_SELECTOR =
	"a[href], button, input, select, textarea, [contenteditable]:not([contenteditable='false']), [tabindex]";

/**
 * Whether a press on this target would land the keyboard somewhere itself —
 * the standard taxonomy, walked up from the press point. It decides only who
 * cancels what: a target that cannot take focus keeps the dismissal's own
 * cancel; a focusable one keeps its native default (F15).
 */
export const pressTargetTakesFocus = (target: EventTarget | null): boolean =>
	target instanceof Element && target.closest(PRESS_FOCUS_SELECTOR) !== null;
