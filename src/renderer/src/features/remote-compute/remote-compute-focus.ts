/**
 * The sheet's two focus moments: the element it captures as its opener, and the
 * element it owes the caret on the way out.
 *
 * WHY THE BODY IS NOT AN OPENER (UX round 4, U9). The sheet remembers
 * `document.activeElement` on the frame it opens, and that is `document.body`
 * whenever nothing is focused. Since the hand-off (`menu-handoff.ts`) refuses the
 * menu's own restore, the row that held the caret unmounts with the menu content, so
 * the capture after a hand-off reads `body` - whose `focus()` does nothing yet still
 * satisfies "the caret is on the target", because `activeElement` IS body. The chip
 * fallback was therefore never reached, and every exit landed on `<body>` (18/18
 * measured). Capture and restore ask ONE predicate so the two cannot disagree.
 */

/** A node the caret can actually be sent to - which `document.body` is not. */
const focusable = (node: Element | null): node is HTMLElement =>
	!!node &&
	typeof (node as HTMLElement).focus === "function" &&
	node.isConnected &&
	node !== node.ownerDocument?.body;

/** The sheet's opener, from the caret at the instant it opened. */
export const sheetOpener = (active: Element | null): HTMLElement | null =>
	focusable(active) ? active : null;

/**
 * Put the caret back on the door: the opener, else the chip.
 *
 * The chip is not a nicety. It is the only element in the flow that outlives the menu
 * holding the opener, and it is where a keyboard user's next Tab belongs - so a
 * capture that came back empty goes there instead of leaving the caret nowhere. A
 * target that refuses the caret (disabled, hidden, or removed between the capture and
 * the close) falls through to it for the same reason.
 */
export const restoreSheetFocus = (
	opener: Element | null,
	root: ParentNode,
): void => {
	const chip = (): HTMLElement | null =>
		root.querySelector<HTMLElement>("[data-device-chip]");
	const target = focusable(opener) ? opener : chip();
	if (!target) return;
	target.focus();
	if (target.ownerDocument?.activeElement === target) return;
	const fallback = chip();
	if (fallback && fallback !== target) fallback.focus();
};
