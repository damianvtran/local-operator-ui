/**
 * The command palette's keyboard gesture, as a decision rather than a listener.
 *
 * Split out because the two halves fail differently. The decision — which
 * keystrokes toggle the palette, and which ones belong to a surface that got
 * there first — is pure, and `scripts/palette-search.test.mjs` pins it. The
 * listener is a `useEffect` in `use-command-palette-shortcut.ts`.
 *
 * ## Why the renderer owns this, and not the main process
 *
 * The palette used to be opened by a `before-input-event` hook in the main
 * process answering Cmd/Ctrl+P. That works wherever the WINDOW has focus, and
 * it cannot know what the renderer is doing — which is exactly the problem with
 * Cmd/Ctrl+K: two surfaces in the canvas already own that gesture (the code
 * editor opens its AI edit on it, the Markdown editor inserts a link, which is
 * what Cmd+K means in every editor a user has met). A main-process hook fires
 * before the renderer sees the key at all, so binding it there would silently
 * take the gesture away from both.
 *
 * Deciding in the renderer instead lets the ordering that already exists do the
 * work: React handlers run as the event bubbles to the root, our window
 * listener runs last, and `defaultPrevented` is the editor saying "mine". So
 * the palette opens everywhere else, and inside a canvas editor the shortcut
 * keeps meaning what the editor says it means.
 *
 * Cmd/Ctrl+P is deliberately left as it was — owned by the main process — for
 * the people who learned it from the app's own tour. Two gestures, two owners,
 * no keystroke claimed twice.
 */

/** What a keystroke asks the palette to do. */
export type PaletteShortcutIntent = "toggle" | null;

/** The subset of `KeyboardEvent` the decision reads. */
export type ShortcutEvent = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	defaultPrevented: boolean;
	repeat: boolean;
};

/**
 * Whether this keystroke is the palette's.
 *
 * `Cmd` and `Ctrl` are both accepted rather than one per platform: the app
 * ships on all three, `Cmd` is meaningless off macOS, and a renderer cannot do
 * anything about a user who presses the other one out of habit.
 *
 * `defaultPrevented` is the editor rule described at the top of this file — it
 * is checked rather than the focus target, because "did the surface I am typing
 * in claim this key" is a question the event answers exactly, and "is the focus
 * in something editable" is a guess that would break the palette for anyone
 * composing a message (the case every chat app expects the gesture to work in).
 *
 * `repeat` is refused so holding the chord does not strobe the dialog, and
 * `shift`/`alt` are refused so the gesture stays a two-key chord that nothing
 * else is likely to extend.
 */
export function paletteShortcutIntent(
	event: ShortcutEvent,
): PaletteShortcutIntent {
	if (!(event.metaKey || event.ctrlKey)) return null;
	if (event.altKey || event.shiftKey) return null;
	if (event.repeat) return null;
	if (event.defaultPrevented) return null;
	return event.key.toLowerCase() === "k" ? "toggle" : null;
}

/**
 * The gesture as the app writes it, for copy and for the sidebar's key caps.
 *
 * One function rather than a string per call site: the tour's prose and the
 * rail's caps have to agree with the handler above, and the only way to keep
 * two spellings of a shortcut honest is to spell it once.
 */
export function paletteShortcutLabel(isMac: boolean): string {
	return isMac ? "⌘K" : "Ctrl+K";
}

/** The same gesture as `KeyboardShortcut` prop text, which splits on `+`. */
export function paletteShortcutCaps(isMac: boolean): string {
	return isMac ? "⌘+K" : "Ctrl+K";
}
