/**
 * @file settings-search-jump.ts
 * @description
 * Landing on a rendered settings row: find it, wait (briefly) for it to be
 * there, put it in the middle of the viewport, focus its control, and flash the
 * wash the chat checkpoint rail already uses.
 *
 * ## Why a bounded settle instead of one `scrollIntoView`
 *
 * A settings row can exist but not be laid out — inside a section that is
 * `[hidden]`, a group that has not opened, or a list still painting. `focus()`
 * and `scrollIntoView()` are silent no-ops on such an element, which is exactly
 * the class of defect the Backend section's own reveal loop documents at length
 * (`backend-settings-section.tsx`'s `FOCUS_ATTEMPTS`). Rather than learn that
 * lesson twice, this module waits a BOUNDED number of frames for the row to be
 * reachable and then says `"missing"` — never "landed" on an element nobody
 * moved to.
 *
 * ## Why the wash is here and not in the component
 *
 * Arriving 3000px down a long page with no cue is indistinguishable from a
 * scroll the reader did themselves. The attribute is the same
 * `data-jump-highlight` the transcript's jumps paint (`@shared/lib/
 * jump-highlight`), so the two surfaces cannot drift into two spells of the
 * same idea, and no new CSS is introduced.
 */

import { paintJumpHighlight } from "@shared/lib/jump-highlight";

/**
 * How many frames a jump waits for its row to be reachable.
 *
 * Twelve is the transcript rail's own budget, and it is chosen the same way:
 * long enough to cover a React commit plus a layout pass, short enough that a
 * missing row reports itself in about 200ms rather than looking hung.
 */
export const SEARCH_JUMP_SETTLE_FRAMES = 12;

export type SearchJumpOutcome = "landed" | "missing";

/** What a browser considers focusable, as the jump uses the word. */
const FOCUSABLE =
	"input, textarea, select, button, [role='switch'], [role='tab'], [role='combobox'], [tabindex]";

/** The row element for a `data-search-row` id, if it is in the document. */
export function findSearchRow(
	root: ParentNode,
	rowId: string,
): HTMLElement | null {
	// `CSS.escape` because ids carry dots and colons (`model.providers`), which
	// an attribute selector would otherwise read as syntax.
	return root.querySelector<HTMLElement>(
		`[data-search-row="${CSS.escape(rowId)}"]`,
	);
}

/**
 * What a jump should focus inside a row.
 *
 * `[data-search-control]` before the row itself: a row whose body is a grid of
 * tiles (the theme picker) wants the reader on the tile they chose, and a row
 * whose control is a segmented pair wants the pair. The row is the fallback
 * because a row with no interactive control is still a destination — and a
 * focusable row needs `tabIndex = -1` first, which the jump does, so the row
 * never joins the tab order.
 */
export function searchControlOf(row: HTMLElement): HTMLElement {
	const marked = row.querySelector<HTMLElement>("[data-search-control]");
	if (!marked) return row;
	/*
	 * The contract says the attribute sits on the element that should TAKE
	 * focus, and an annotator occasionally needs it on a small wrapper instead
	 * (a segmented pair, a tile's frame). A non-focusable marked element
	 * therefore hands focus to the first focusable thing inside it rather than
	 * receiving a no-op `focus()`.
	 */
	return marked.matches(FOCUSABLE) ? marked : (marked.querySelector(FOCUSABLE) ?? marked);
}

/** Whether `element` is laid out — no ancestor carries `hidden`. */
function isReachable(element: HTMLElement): boolean {
	return element.isConnected && element.closest("[hidden]") === null;
}

/**
 * Jump to a rendered row.
 *
 * The promise resolves `"landed"` only when the row was focusable, scrolled and
 * flashed; `"missing"` otherwise. It never throws: a failed jump is a sentence
 * the panel speaks, not an error (`searchSettings` returning nothing is the
 * same contract).
 */
export function jumpToSearchRow(
	root: ParentNode,
	rowId: string,
	options: {
		frames?: number;
		/** Overridden by the test to count paints; the app never passes it. */
		paint?: (element: HTMLElement) => void;
	} = {},
): Promise<SearchJumpOutcome> {
	const frames = options.frames ?? SEARCH_JUMP_SETTLE_FRAMES;
	const paint = options.paint ?? paintJumpHighlight;
	return new Promise((resolve) => {
		let frame = 0;
		let attempts = 0;
		const step = () => {
			const row = findSearchRow(root, rowId);
			if (row && isReachable(row)) {
				const target = searchControlOf(row);
				if (target === row) row.tabIndex = -1;
				target.scrollIntoView({ block: "center" });
				target.focus();
				paint(row);
				resolve("landed");
				return;
			}
			attempts += 1;
			if (attempts >= frames) {
				resolve("missing");
				return;
			}
			frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		// A test host without `requestAnimationFrame` would otherwise never settle;
		// jsdom owns one only when it is visual, and the app always has one.
		void frame;
	});
}

/**
 * Jump to a section root: a section-only result's landing.
 *
 * The section root carries `data-search-section`; it is focused with
 * `tabIndex = -1` so the reader lands at the heading rather than on whichever
 * control happens to be first, and the wash says which group they arrived at.
 */
export function jumpToSearchSection(
	root: ParentNode,
	sectionId: string,
	options: { paint?: (element: HTMLElement) => void } = {},
): SearchJumpOutcome {
	const element = root.querySelector<HTMLElement>(
		`[data-search-section="${CSS.escape(sectionId)}"]`,
	);
	if (!element || !isReachable(element)) return "missing";
	element.scrollIntoView({ block: "start" });
	if (element.tabIndex < 0) element.focus();
	(options.paint ?? paintJumpHighlight)(element);
	return "landed";
}
