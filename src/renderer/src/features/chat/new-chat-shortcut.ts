/**
 * The New chat shortcut: `⌘N` on macOS, `Ctrl+N` elsewhere.
 *
 * WHY THE RULE IS A MODULE AND NOT A HANDLER. `ask-answer.ts` gives the reason
 * for its own predicate and it holds here: nothing in a test can reach a
 * decision written inside a React component with no DOM, and this repository's
 * desktop suite is `node:test` over `scripts/*.test.mjs` with no DOM harness. So
 * both halves of the shortcut — which press is its, and what the sidebar prints
 * for it — are pure functions, asserted in `scripts/new-chat-shortcut.test.mjs`
 * against the very objects the handler and the row build.
 *
 * WHAT IT IS BOUND TO. The app shell (`app.tsx`) registers it on the document,
 * which is what makes the cap beside New chat a promise about the whole app
 * rather than about that one row: the sidebar is one way to start a chat and
 * this is the other, reachable from every route. The press is a CHORD rather
 * than a bare letter because the composer is a live text field, the same
 * constraint the run panel's ladder states.
 *
 * WHAT IT DELIBERATELY YIELDS TO. Two surfaces can already own this press, and
 * both are recognised here rather than left to listener order:
 *
 *   - the canvas pane, which binds `⌘N` to "new file" while it is open. Its own
 *     rule is `keyboard-scopes.ts`, shared with this file so the two cannot
 *     drift apart;
 *   - a modal surface — a dialog, an alert dialog, a menu, a listbox — whose own
 *     key handling belongs to it. WHAT THAT CATCHES and what it deliberately
 *     does not is stated on `pressLandsOnOverlay`, which is the same predicate
 *     the canvas's Escape branch asks.
 */
import {
	pressBelongsToCanvas,
	pressLandsOnOverlay,
} from "./keyboard-scopes";

/**
 * The key the chord is built on.
 *
 * Compared lowercased, because `event.key` is the character the layout produced
 * rather than the physical key: `Shift+N` arrives as `"N"` and is refused
 * separately below, and a press carrying `⌘` arrives as `"n"` on every layout
 * this app ships for.
 */
const NEW_CHAT_KEY = "n";

/**
 * The press this shortcut answers.
 *
 * `Pick<KeyboardEvent, …>` rather than a hand-written shape, so the handler
 * cannot pass something the browser would not: the object in the app is a real
 * `KeyboardEvent` and the object in the test is a literal, and one type checks
 * both.
 */
export type NewChatShortcutEvent = Pick<
	KeyboardEvent,
	| "key"
	| "metaKey"
	| "ctrlKey"
	| "shiftKey"
	| "altKey"
	| "repeat"
	| "defaultPrevented"
	| "isComposing"
	| "target"
>;

/**
 * Whether this press starts a new chat.
 *
 * Every bail below is a way for the same key to mean something else, and each
 * one is a property of the EVENT rather than of any component's state, so the
 * answer does not depend on which of them happens to be mounted:
 *
 *   - `defaultPrevented` — an inner layer claimed it first. Radix's dismissable
 *     layers `preventDefault` from a capture-phase listener before they act,
 *     and a surface that has already answered the press must not also navigate.
 *   - `repeat` — a HELD key. Without this, holding `⌘N` stages one draft per
 *     repeat: each press takes a fresh `crypto.randomUUID()` key in
 *     `stageDraft`, so the store and its persisted `drafts` row accumulate a
 *     draft per repeat until the key is released. The row's own click cannot do
 *     that, so the shortcut must not either.
 *   - `shiftKey`/`altKey` — `⌘⇧N` and `⌥⌘N` are other apps' chords (a new
 *     window, a new folder) and are not claimed here; a chord this app does not
 *     implement stays available rather than firing the neighbouring one.
 *   - `isComposing` — the press is part of an IME composition in the composer
 *     (a Japanese, Chinese or Korean candidate window is up). The chord is
 *     unambiguous there, but its EFFECT is not: staging a draft navigates and
 *     unmounts the field the composition lives in, discarding the half-composed
 *     text the user is in the middle of accepting. Every other handler in this
 *     tree that answers a chord from a live text field makes the same bail.
 *   - the canvas scope and the overlay roles, both from `keyboard-scopes.ts`.
 */
export const shouldStartNewChat = (event: NewChatShortcutEvent): boolean => {
	if (event.defaultPrevented) return false;
	if (event.repeat) return false;
	if (event.isComposing) return false;
	if (event.shiftKey || event.altKey) return false;
	if (event.key.toLowerCase() !== NEW_CHAT_KEY) return false;
	/*
	 * `⌘` on macOS and `Ctrl` on Windows/Linux, both accepted on both: this is
	 * the app's own spelling of a modifier chord everywhere else it binds one
	 * (`canvas/index.tsx`, `spreadsheet-preview.tsx`, the undo manager), and a
	 * `Ctrl+N` on macOS costs nothing — the platform has no meaning for it here.
	 */
	if (!(event.metaKey || event.ctrlKey)) return false;
	if (pressBelongsToCanvas(event.target)) return false;
	return !pressLandsOnOverlay(event.target);
};

/**
 * The cap the sidebar prints, in the platform's own spelling.
 *
 * Takes the platform rather than reading `navigator` itself so the two
 * spellings are assertable, and so the row keeps the app's existing source for
 * it (`chat-header.tsx` and the undo manager both read `navigator.platform` this
 * way — the capability hook's answer is async, and a row that painted `⌘N`
 * before an awaited platform arrived would flash the wrong cap on Windows).
 */
export const newChatShortcutCap = (platform: string): string =>
	platform.toUpperCase().includes("MAC") ? "⌘+N" : "Ctrl+N";
