/**
 * The canvas pane's printed chord, and the predicate the header answers with.
 *
 * WHY A MODULE (UX round 2, U14). The canvas control printed `⌘+Shift+C` in its
 * own accessible name and NOTHING bound the chord: four recorded presses
 * (`{key:"c", meta:true, shift:true}`) left `isCanvasOpen` false, while `⌘B` on
 * the same dispatch path toggled the sidebar correctly. A cap is a promise the
 * control makes on the app's behalf, so the cap and the press are one string and
 * one predicate here - the shape `isSidebarTogglePress` / `sidebarToggleCap`
 * established for `⌘B` - and a suite presses both spellings against it.
 */

/**
 * Whether this is the canvas toggle press: `⌘⇧C` on macOS, `Ctrl+Shift+C`
 * elsewhere.
 *
 * SHIFT IS REQUIRED, and that is the load-bearing half: `⌘C` is Copy and belongs
 * to whatever the reader has selected - claiming the unshifted chord would take
 * the platform's own gesture away silently, which is the rule
 * `isSidebarTogglePress` states for `⌘⇧B` in the other direction. Alt is
 * refused for the same reason (a chord that is not ours stays available), and
 * `toLowerCase` covers the layouts that report the produced character (`"C"`)
 * rather than the base key.
 */
export function isCanvasTogglePress(event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}): boolean {
	if (!event.shiftKey || event.altKey) return false;
	if (!(event.metaKey || event.ctrlKey)) return false;
	return event.key.toLowerCase() === "c";
}

/**
 * The caption the control prints for that chord, shared with the handler so the
 * two cannot drift.
 */
export const canvasToggleCap = (isMac: boolean): string =>
	isMac ? "⌘⇧C" : "Ctrl+Shift+C";
