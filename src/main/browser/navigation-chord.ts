/**
 * The driven pane's navigation chords, as a decision rather than a listener
 * (issue #675).
 *
 * While a driven page holds focus the app's renderer never sees the keystroke —
 * the view's own webContents does — so main answers these two chords itself and
 * moves the PANE's history, which is what a back/forward gesture means while a
 * browser surface is focused (the same thing its toolbar buttons do through
 * `host.historyActive`).
 *
 * WHY NOT RENDERER-OWNED, for the half that is: the renderer half exists so a
 * surface that has already claimed the gesture keeps it (see
 * `@shared/navigation-gesture`). Inside a DRIVEN page there is no such surface
 * to protect and no way to ask: a driven page is arbitrary web content, and the
 * pane is a browser, where back/forward on these chords is the platform
 * convention the user brought with them. The hook fires before the page sees
 * the key and preventDefaults it, so the pane's answer is the single owner.
 *
 * The shape mirrors `palette-shortcut.ts` and the renderer half of this same
 * feature (`@shared/navigation-gesture`): `Cmd`/`Ctrl` both accepted, `shift`/
 * `alt` refused so the chord stays exactly the two keys the conventions name,
 * and auto-repeat refused so holding it does not walk the stack.
 */

/** Which way a pane navigation chord asks the driven view's history to move. */
export type PaneNavigationDirection = "back" | "forward";

/**
 * The subset of Electron's `Input` the decision reads (the same names
 * `before-input-event` hands over; kept structural so a test can drive it).
 */
export type PaneNavigationInput = {
	type: string;
	key: string;
	isAutoRepeat: boolean;
	shift: boolean;
	control: boolean;
	alt: boolean;
	meta: boolean;
};

export function paneNavigationDirection(
	input: PaneNavigationInput,
): PaneNavigationDirection | null {
	// `before-input-event` fires on both edges; the press is the decision.
	if (input.type !== "keyDown") return null;
	if (!(input.meta || input.control)) return null;
	if (input.alt || input.shift) return null;
	if (input.isAutoRepeat) return null;
	// `key` rather than `code`, matching the renderer half and the run-panel's
	// own binding: the gesture is the bracket the user sees.
	if (input.key === "[") return "back";
	if (input.key === "]") return "forward";
	return null;
}
