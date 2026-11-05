/**
 * A command-palette pick's request that the Team Bridge composer take the caret
 * once it is on screen (UX round 1, U1 on #1673).
 *
 * WHY A REQUEST AND NOT A CALL. The palette's close-time restore
 * (`command-palette.tsx`'s `restoreFocus`) hands the caret to the registered
 * composer (`composer-field.ts`) when a pick moved the view - and for a chat
 * pick that composer is already mounted or focuses itself as it mounts. A
 * bridge pick from anywhere but Team Bridge is different on both counts: the
 * page is a lazy route whose composer mounts only after the status, list and
 * directory reads answer, well after the close has run, and the bridge
 * composer deliberately has no mount-time self-focus (an unprompted grab on
 * every rail click would take the caret out of the transcript). So the pick
 * leaves this request, and the composer honours it when it can.
 *
 * WHAT KEEPS IT FROM BEING A STEAL. The request is one-shot (the first focus
 * that lands clears it), short-lived (`TTL_MS`: a request nobody honoured in
 * time is the reader's past, not their present), and yields to a caret someone
 * else has claimed: if a text field holds focus when the composer comes up,
 * the reader has moved on and the request is dropped, the same rule
 * `composer-caret.ts` states for the chat composer ("a gesture-driven restore
 * may land, an unprompted focus grab may not").
 *
 * A leaf on purpose (no React, no store), so a test can drive it beside the
 * real page without the palette.
 */

/*
 * Long enough for a cold open from another route (lazy chunk, status, list and
 * directory reads on a slow hub), short enough that a request abandoned by a
 * failed load does not fire when the reader comes back much later.
 */
const TTL_MS = 10_000;

let requestedAt: number | null = null;

/** Called by the palette when the reader picks a Team Bridge row. */
export function requestTeamBridgeComposerFocus(now: number = Date.now()): void {
	requestedAt = now;
}

/** Whether a request is outstanding and still fresh. */
export function teamBridgeComposerFocusPending(
	now: number = Date.now(),
): boolean {
	if (requestedAt === null) return false;
	if (now - requestedAt > TTL_MS) {
		requestedAt = null;
		return false;
	}
	return true;
}

/** Drop the request: honoured, or overtaken by the reader. */
export function clearTeamBridgeComposerFocusRequest(): void {
	requestedAt = null;
}

/**
 * What the composer should do with an outstanding request, given who holds the
 * caret now:
 * - `take`: nobody (nothing, the body) or a control that is not a text entry
 *   (the rail's Search button the pick was made from);
 * - `wait`: an open dialog holds it - the palette itself while it closes, whose
 *   focus trap would pull a caret taken now straight back. The palette's own
 *   close-time restore hands over through the registry (`composer-field.ts`),
 *   and a later enable/mount of this composer asks again;
 * - `drop`: a text field outside any dialog - the reader is typing somewhere
 *   else, and that is never taken.
 */
export function composerFocusDisposition(
	active: Element | null,
): "take" | "wait" | "drop" {
	if (!active || active.tagName === "BODY") return "take";
	if (active.closest('[role="dialog"]')) return "wait";
	if (
		active.tagName === "INPUT" ||
		active.tagName === "TEXTAREA" ||
		(active as HTMLElement).isContentEditable
	)
		return "drop";
	return "take";
}
