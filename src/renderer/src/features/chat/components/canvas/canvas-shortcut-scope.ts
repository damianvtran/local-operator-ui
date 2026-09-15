/**
 * Which key presses belong to the canvas pane.
 *
 * The canvas answers document chords of its own on the WINDOW while it is
 * mounted: `⌘/Ctrl+O` opens a file, and `⌘/Ctrl+N` stages a new one. The app
 * also answers `⌘/Ctrl+N` globally — the sidebar's own New chat row wears it as
 * its cap — so the two bindings overlap on one key, and two things happening on
 * one press is exactly the outcome the canvas's own Escape branch beside them
 * refuses ("a `role="dialog"` that dismissed itself while the canvas also
 * switched views would be two things happening on one key").
 *
 * The rule that resolves it is the one `run-panel.tsx` already applies to its
 * own document-level ladder: a surface answers the presses that came FROM it,
 * and the page answers the rest. BOTH sides consult this module, so the pair
 * cannot drift — the canvas skips a press that is not its own, and the app-level
 * binding skips one that is. A marker checked in two places by hand is how a
 * future edit to one of them silently reinstates the collision.
 *
 * WHY THE MARKER IS AN ATTRIBUTE ON THE PANE, not a `closest()` on a class or a
 * tag: the canvas is a `<section>` inside a dock that also holds the resize
 * divider, and a press on that divider is the user sizing the pane, not a
 * document action. A marker on the canvas's own root puts the boundary exactly
 * where the pane begins, and leaves the divider's presses to the page.
 */
export const CANVAS_SHORTCUT_SCOPE_ATTR = "data-canvas-shortcuts";

const CANVAS_SHORTCUT_SCOPE = `[${CANVAS_SHORTCUT_SCOPE_ATTR}]`;

/**
 * Whether a press came from inside the canvas pane.
 *
 * It takes the event's `target` and nothing else, so it can be asserted without
 * a DOM: the only thing it needs from an element is `closest`. A target that
 * has no `closest` — a `window`, a `document`, or the `null` a synthetic event
 * can carry — belongs to nobody, which is what lets a press from `<body>` (where
 * focus lands when it is lost) fall through to the page.
 */
export const pressBelongsToCanvas = (target: EventTarget | null): boolean => {
	const element = target as { closest?: (selector: string) => unknown } | null;
	return typeof element?.closest === "function"
		? element.closest(CANVAS_SHORTCUT_SCOPE) !== null
		: false;
};
