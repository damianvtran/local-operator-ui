/**
 * Which key presses belong to which surface.
 *
 * Two bindings in this app overlap on one key: the canvas pane answers
 * `⌘/Ctrl+N` with "new file" while it is open, and the app answers `⌘/Ctrl+N`
 * with "new chat" from anywhere — the chord the sidebar's New chat row prints as
 * its cap. The canvas's binding is on the WINDOW, so before this module existed
 * one press from the sidebar would raise the pane's create-file dialog AND stage
 * a chat behind it.
 *
 * The rule that resolves it is the one `run-panel.tsx` already applies to its own
 * document-level ladder: a surface answers the presses that came FROM it, and the
 * page answers the rest. BOTH halves of the overlap consult this module, so the
 * pair cannot drift — the canvas skips a press that is not its own, and the
 * app-level binding skips one that is. A marker checked in two places by hand is
 * how a future edit to one of them silently reinstates the collision.
 *
 * WHY THE CANVAS MARKER IS AN ATTRIBUTE ON THE PANE, not a `closest()` on a class
 * or a tag: the canvas is a `<section>` inside a dock that also holds the resize
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
 * a DOM: the only thing it needs from an element is `closest`. A target that has
 * no `closest` — a `window`, a `document`, or the `null` a synthetic event can
 * carry — belongs to nobody, which is what lets a press from `<body>` (where
 * focus lands when it is lost) fall through to the page.
 */
export const pressBelongsToCanvas = (target: EventTarget | null): boolean =>
	elementClosest(target, CANVAS_SHORTCUT_SCOPE);

/**
 * The overlay roles that own a press before the page does.
 *
 * Roles rather than a class or a data attribute, because these are the
 * elements' own declarations, and they are declared ONCE here for the same reason
 * the canvas marker is: the canvas's Escape branch asks the same question (`is
 * this press inside a dialog, menu or listbox, which owns its own keys?`) and a
 * second hand-written copy of the list is a fifth role waiting to drift.
 */
export const PRESS_OWNER_SELECTOR =
	'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Whether a press landed on a surface that owns its own keyboard handling.
 *
 * WHAT IT CATCHES, precisely: the focused-overlay case. A Radix `Dialog`,
 * `AlertDialog`, `Menu` or `Select` moves focus onto its content when it opens,
 * so the press's own target IS the overlay and this answers true.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH: this app's two `role="listbox"` COMPOSER
 * popovers — the slash-command menu and the picker host's list — which keep focus
 * on the textarea by design (`aria-activedescendant`) while they are open. A
 * press there has the composer for a target, this answers false, and the
 * app-level `⌘N` therefore stages a new chat and takes the popover with it. That
 * is a deliberate trade rather than an oversight: the alternative is a
 * `document.querySelector` for open overlays on every press, which would make an
 * unrelated surface's state decide this one's answer, and the popovers it would
 * protect are transient — they close on the navigation anyway, and the composed
 * text they were completing is in the composer, not in the popover.
 */
export const pressLandsOnOverlay = (target: EventTarget | null): boolean =>
	elementClosest(target, PRESS_OWNER_SELECTOR);

/** `target.closest(selector) !== null`, for a target that may not be an element. */
function elementClosest(target: EventTarget | null, selector: string): boolean {
	const element = target as { closest?: (selector: string) => unknown } | null;
	return typeof element?.closest === "function"
		? element.closest(selector) !== null
		: false;
}

/**
 * What the canvas pane makes of a press, if anything.
 *
 * The pane's two document chords, as a decision rather than as markup inside a
 * listener, for the reason `ask-answer.ts` gives for its own predicate: a rule
 * written inline in a React component with no DOM cannot be reached by a test,
 * and the regression direction this change creates — the pane's `⌘N` no longer
 * scoping, or no longer firing at all — is exactly the one that has no other
 * behavioural evidence (neither committed harness can open a canvas).
 *
 * `⌘O` takes no scope test, deliberately: nothing else in the app claims it, so
 * a test there would only take a working shortcut away from a user whose focus
 * happens to be in the sidebar. `⌘N` takes one because the app does claim it.
 * `Shift`/`Alt` are not excluded, because this pane never excluded them — its
 * chords are whatever it accepted before this module existed.
 */
export type CanvasShortcutAction = "open-file" | "new-file";

export const canvasShortcutAction = (event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	target: EventTarget | null;
}): CanvasShortcutAction | null => {
	if (!(event.metaKey || event.ctrlKey)) return null;
	const key = event.key.toLowerCase();
	if (key === "o") return "open-file";
	if (key === "n") return pressBelongsToCanvas(event.target) ? "new-file" : null;
	return null;
};
