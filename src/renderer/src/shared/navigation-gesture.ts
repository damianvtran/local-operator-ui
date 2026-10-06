/**
 * The app's navigation gestures, as decisions rather than listeners (issue #675).
 *
 * The window had no back/forward at all outside the driven browser's toolbar:
 * the mouse's back/forward buttons (DOM buttons 3 and 4) and the conventional
 * chords (Cmd/Ctrl+[ and Cmd/Ctrl+]) were bound nowhere, so the only way back
 * was the nav rail. The listeners live in `use-navigation-gestures.ts`; the
 * rules live here because they are pure, and `scripts/navigation-gesture.test.mjs`
 * pins them.
 *
 * ## Why the renderer owns these, and not the main process
 *
 * The same reason `palette-shortcut.ts` gives for Cmd/Ctrl+K, and it is already
 * load-bearing: a surface in this app HAS claimed Cmd/Ctrl+[ ahead of us. The
 * run-details panel steps back out of an open child reader on that chord
 * (`run-panel.tsx`, `back()` + `stopPropagation`), and a CodeMirror buffer may
 * bind Mod-[ itself. A main-process `before-input-event` hook fires before the
 * renderer sees the key at all, so binding these chords there would silently
 * take the gesture away from both. Answering in the renderer lets the ordering
 * that already exists do the work: React handlers run as the event bubbles to
 * the root, this module's listener runs last, and `defaultPrevented` is the
 * surface saying "mine".
 *
 * The one place the main process DOES answer these chords is the driven browser
 * view's own webContents (`navigation-chord.ts`), where the gesture means the
 * pane's history and the app's renderer never sees the event at all. ONE owner
 * per gesture, per surface: the window listener acts only on events that landed
 * in the app's DOM, and the view hook only on events that landed in a driven
 * page. A keystroke or click reaches exactly one of them.
 */

/** Which way a navigation gesture asks the router to move. */
export type NavigationDirection = "back" | "forward";

/** The subset of `KeyboardEvent` the chord decision reads. */
export type NavigationChordEvent = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	defaultPrevented: boolean;
	repeat: boolean;
};

/** The subset of `MouseEvent` the button decision reads. */
export type NavigationMouseEvent = {
	/**
	 * DOM button number: 3 is "back", 4 is "forward" (UI Events; the numbers
	 * Chromium delivers for the side buttons on a mouse).
	 */
	button: number;
	defaultPrevented: boolean;
};

/**
 * Whether this keystroke asks for a route move.
 *
 * `Cmd` and `Ctrl` are both accepted rather than one per platform: the app
 * ships on all three, `Cmd` is meaningless off macOS, and a renderer cannot do
 * anything about a user who presses the other one out of habit — the same rule
 * the palette's chord states.
 *
 * `defaultPrevented` is the editor rule described at the top of this file, and
 * it is checked rather than the focus target for the same reason
 * `palette-shortcut.ts` gives: "did the surface I am in claim this key" is a
 * question the event answers exactly.
 *
 * `repeat` is refused so holding the chord does not walk the history stack,
 * and `shift`/`alt` are refused so the gesture stays the two-key chord the
 * platform conventions name — Cmd+{ is not Cmd+[ anywhere.
 */
export function navigationChordDirection(
	event: NavigationChordEvent,
): NavigationDirection | null {
	if (!(event.metaKey || event.ctrlKey)) return null;
	if (event.altKey || event.shiftKey) return null;
	if (event.repeat) return null;
	if (event.defaultPrevented) return null;
	// `key` rather than `code`: the gesture is the bracket the user sees, the
	// same reading the run-panel's own binding uses.
	if (event.key === "[") return "back";
	if (event.key === "]") return "forward";
	return null;
}

/**
 * Whether this mouse press asks for a route move.
 *
 * Buttons 3 and 4 are the spec's "back" and "forward" values. `preventDefault`
 * is respected on the UP edge for the same ordering reason the chord states:
 * a surface that claims the press (a canvas, a drag) is saying "mine", and
 * this listener runs after it. Everything else — including the middle button
 * on a `mouseup` — is refused, so ordinary clicks pass through untouched.
 */
export function navigationMouseDirection(
	event: NavigationMouseEvent,
): NavigationDirection | null {
	if (event.defaultPrevented) return null;
	if (event.button === 3) return "back";
	if (event.button === 4) return "forward";
	return null;
}

/**
 * The navigation chords as the app writes them (issue #675's round-1 review,
 * U5).
 *
 * The product caps every other chord on the control that owns it
 * (`sidebarToggleCap`'s "⌘B", `paletteDoorLabel`'s "⌘P"), and this pair
 * had no caption anywhere — no tooltip, no keycap, no `aria-keyshortcuts`. The
 * browser's back/forward buttons are the nearest affordances the gesture has,
 * so they carry it: one string for the tooltip and `aria-keyshortcuts`, the
 * same split the sidebar toggle uses (`label` names the action, the chord is
 * the machine-readable shortcut). `Ctrl+[` off macOS: the bracket chord is
 * written with the plus the way the app spells every multi-key chord whose
 * second key is not a glyph name.
 */
export function navigationShortcutLabel(
	direction: NavigationDirection,
	isMac: boolean,
): string {
	const bracket = direction === "back" ? "[" : "]";
	return isMac ? `⌘${bracket}` : `Ctrl+${bracket}`;
}
