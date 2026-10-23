/**
 * S6a's pure geometry for the approvals card's native view.
 *
 * The card is not a shelf and not a pause: it is a child `WebContentsView`
 * painted over the live page, sized to the card and anchored to the content
 * rect's inline-end corner. Keeping the arithmetic here (rather than in the
 * controller) is what lets the evidence run assert the exact numbers without an
 * Electron process, and it is the same split `address-overlay-list.ts` uses for
 * the suggestion list.
 *
 * THE INLINE-END ANCHOR IS DELIBERATE. The app ships RTL catalogues (`ur`), so
 * "bottom-right" is a direction, not a coordinate: in RTL the same formula
 * anchors the card's inline end to the content rect's left edge.
 *
 * No shadow, minimum width or readability fallback lives here. The card paints
 * its own surface inside `PAD`; this module only answers where the native view
 * goes and whether it fits. A rect that does not fit returns `null` rather than
 * a clipped one: an overlapped native child has no scrollbar and no way to
 * reveal what it cut off.
 */

/** The visible card's width ceiling, in DIP. */
export const APPROVALS_CARD_MAX_WIDTH = 352;
/** The measured card height's ceiling, in DIP. */
export const APPROVALS_CARD_MAX_HEIGHT = 480;
/** The supplied natural height is clamped up to this, so a nearly empty card
 * still has a header and a footer rather than a one-line sliver. */
export const APPROVALS_CARD_MIN_HEIGHT = 96;
/** The visible ring between the card surface and the content rect edge. The
 * native view extends `PAD` past the card on every side so the card's shadow
 * can paint; that ring is inside the view and therefore swallows pointer input
 * (a measured fact in the evidence, not a hidden surprise). */
export const APPROVALS_CARD_INSET = 8;
export const APPROVALS_CARD_PAD = 8;

export interface ApprovalsCardRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ApprovalsCardBoundsInput {
	/** The presented page's content rect, in DIP. */
	contentRect: ApprovalsCardRect;
	/** The card document's measured height, in CSS/DIP px. */
	naturalHeight: number;
	/** Windows/Linux's opaque fallback: no transparent ring, square corners. */
	opaque?: boolean;
}

export interface ApprovalsCardBounds {
	/** The native child's rectangle. */
	view: ApprovalsCardRect;
	/** The visible card inside it; `view` minus `PAD` on every side. */
	card: ApprovalsCardRect;
	width: number;
	height: number;
	pad: number;
}

function integer(value: number): number {
	return Math.round(value);
}

/**
 * Compute the child's rectangle, or `null` when the card cannot fit.
 *
 * WIDTH: `min(352, contentW - 16)`. At 264 DIP this is 248; at <=256 the card is
 * full-bleed with an 8 DIP ring. It still opens below 200 wide because an
 * unanswerable approval is worse than a cramped one.
 *
 * HEIGHT: clamp the measured height to [96, min(480, contentH - 16)]. A card
 * whose ceiling falls below the 96 floor is refused: there is no honest way to
 * paint the whole surface.
 *
 * The view is translated so its trailing/bottom edge meets the content rect
 * exactly; the card surface is then `PAD` inside it. The intersection check is
 * the final guard: no clipped native views.
 */
export function approvalsCardBoundsFor(
	input: ApprovalsCardBoundsInput,
): ApprovalsCardBounds | null {
	const pad = input.opaque === true ? 0 : APPROVALS_CARD_PAD;
	const inset = input.opaque === true ? 0 : APPROVALS_CARD_INSET;
	const content = input.contentRect;
	if (
		!Number.isFinite(content.x) ||
		!Number.isFinite(content.y) ||
		!Number.isFinite(content.width) ||
		!Number.isFinite(content.height) ||
		content.width <= 0 ||
		content.height <= 0
	) {
		return null;
	}
	const width = Math.min(
		APPROVALS_CARD_MAX_WIDTH,
		Math.floor(content.width - 2 * pad),
	);
	if (width <= 0) return null;
	const ceiling = Math.min(
		APPROVALS_CARD_MAX_HEIGHT,
		Math.floor(content.height - 2 * pad),
	);
	if (ceiling < APPROVALS_CARD_MIN_HEIGHT) return null;
	const natural = Number.isFinite(input.naturalHeight)
		? input.naturalHeight
		: APPROVALS_CARD_MIN_HEIGHT;
	const height = Math.min(
		ceiling,
		Math.max(APPROVALS_CARD_MIN_HEIGHT, Math.floor(natural)),
	);
	const viewWidth = width + 2 * pad;
	const viewHeight = height + 2 * pad;
	const viewX = integer(content.x + content.width - inset - width - pad);
	const viewY = integer(content.y + content.height - inset - height - pad);
	const view = {
		x: viewX,
		y: viewY,
		width: viewWidth,
		height: viewHeight,
	};
	// The formula is already inside the content rect for every accepted width;
	// this is the guard that keeps a future formula change from clipping.
	if (
		view.x < content.x ||
		view.y < content.y ||
		view.x + view.width > content.x + content.width ||
		view.y + view.height > content.y + content.height
	) {
		return null;
	}
	return {
		view,
		card: {
			x: view.x + pad,
			y: view.y + pad,
			width,
			height,
		},
		width,
		height,
		pad,
	};
}
