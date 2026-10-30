/**
 * The transient wash a jump paints on the thing it landed on.
 *
 * ## Why this is shared rather than owned by chat
 *
 * It started as the checkpoint rail's landing flash (`reveal-record.ts`), which
 * is where the animation's reasoning was written: the attribute
 * `styles/index.css` animates, removed again by a timer, restarted rather than
 * cleared when a second jump lands on the same element. Settings search needs
 * the same cue for the same reason — a jump that moves 3000px down a long page
 * without saying where it landed is a scroll, not an answer — and a second copy
 * of the timer bookkeeping would be a second copy of the restart rule, which is
 * the part that is easy to get subtly wrong.
 *
 * So the mechanism lives here, once, and `reveal-record.ts` re-exports it so
 * every existing caller and test keeps the import it always had. This module
 * owns no CSS: the `[data-jump-highlight]` rules are global
 * (`styles/index.css`), which is what lets a chat row and a settings row flash
 * identically without a second stylesheet entry.
 */

/** The attribute the landing highlight paints on the revealed row. */
export const JUMP_HIGHLIGHT_ATTR = "data-jump-highlight";

/** How long the landing highlight stays (§D7: ~1.4 s, removed by timer). */
export const JUMP_HIGHLIGHT_MS = 1400;

/**
 * Timers already running per element, so a second jump to the same row
 * restarts the flash instead of letting the first jump's timer clear it early.
 */
const highlightTimers = new WeakMap<HTMLElement, number>();

/**
 * Flash the landed row: the attribute `styles/index.css` animates, removed
 * again after `JUMP_HIGHLIGHT_MS`.
 *
 * Reduced motion does not cancel the highlight — the stylesheet holds the wash
 * still for the same window instead (only the animation is gated on
 * `prefers-reduced-motion: no-preference`; the `[data-jump-highlight]` ground
 * sits outside it), because the flash is information before it is motion:
 * without it a reduced-motion reader arrives somewhere with no cue at all.
 */
export function paintJumpHighlight(target: HTMLElement): void {
	const running = highlightTimers.get(target);
	if (running !== undefined) window.clearTimeout(running);
	const alreadyLit = target.hasAttribute(JUMP_HIGHLIGHT_ATTR);
	target.removeAttribute(JUMP_HIGHLIGHT_ATTR);
	// One forced reflow, and only on a repeat: removing and re-adding the
	// attribute inside one task is invisible to the style engine otherwise, and
	// the animation would not restart.
	if (alreadyLit) void target.offsetHeight;
	target.setAttribute(JUMP_HIGHLIGHT_ATTR, "");
	highlightTimers.set(
		target,
		window.setTimeout(() => {
			highlightTimers.delete(target);
			target.removeAttribute(JUMP_HIGHLIGHT_ATTR);
		}, JUMP_HIGHLIGHT_MS),
	);
}
