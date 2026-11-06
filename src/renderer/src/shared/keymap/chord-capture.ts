/**
 * A key press → a chord, and the keys that end an edit rather than spell one.
 *
 * THE TWO RECORDERS, ONE SET OF RULES. This tree records chords in two places:
 * the backend registry's `keymap.*` rows (`setting-control.tsx`'s `HotkeyInput`,
 * whose stored grammar is the runtime's) and this registry's settings rows
 * (whose stored grammar is `keymap-chord.ts`'s canonical form). Their OUTPUT
 * grammars differ deliberately — backend parity is a recorded follow-up — but
 * the capture RULES must not: which keys are modifier-only, which end an edit,
 * how `event.key` is named, and how the pieces join. Those live here once, and
 * both recorders import them, so the day one gains a case the other cannot
 * silently lose it.
 *
 * WHY THE NAMES ARE A TABLE: `event.key` is the produced character on some
 * layouts and a named key elsewhere, and the runtime spells the two whose names
 * are not their `event.key` (` " "` is `space`, `ArrowDown` is `down`). A
 * shorter table that lower-cased instead would store `" "` and `"arrowdown"` —
 * values neither grammar can bind.
 */

import { physicalKey } from "../../../../shared/recording-shortcut";
import { normalizeChord } from "./keymap-chord";

/**
 * A modifier pressed on its own is not a binding, and neither is IME.
 *
 * `AltGraph` is refused with them: on the layouts that report it, AltGr is the
 * third-level shift, and a chord whose only "modifier" is AltGr is a character
 * the reader is typing, not a gesture they are recording.
 */
export const MODIFIER_ONLY_KEYS: ReadonlySet<string> = new Set([
	"Control",
	"Shift",
	"Alt",
	"Meta",
	"AltGraph",
]);

/**
 * The keys that NAVIGATE rather than spell: presses a recorder must leave to
 * the browser.
 *
 * Tab and Shift+Tab are how a keyboard user moves between the field, its Reset
 * and the next row. A recorder that refuses them both lies about the harm (`tab`
 * is not a bindable key in the canonical grammar, so the sentence reads as a
 * bindability verdict) and — worse — calls `preventDefault`, which leaves focus
 * stuck on the recording field: UX round 1's U1 measured the section's one clear
 * affordance, Reset, unreachable one stop away, with a full page walk as the
 * recovery route. Leaving the press to the browser moves focus as it does
 * anywhere else in the product, and the field's own `onBlur` ends the recording
 * exactly as Escape does. Kept beside the other capture rules so the two
 * recorders cannot re-learn this one differently.
 */
export const NAVIGATION_KEYS: ReadonlySet<string> = new Set(["Tab"]);

/**
 * The keys that END an edit rather than spelling a binding.
 *
 * Every key-capture UI in this product's category treats Escape as cancel (UX
 * round 1, U7: this field used to BIND it, so pressing the conventional way out
 * of a recorder rewrote the binding to `escape`, dirty, discoverable only by
 * noticing the field had changed), and Enter is a commit, not a keystroke
 * anybody means to bind while editing a row. WHICH KEYS end an edit is shared
 * here; what happens NEXT differs by recorder. The backend field blurs. The
 * registry's recorder KEEPS focus on the field and clears its recording cue
 * (UX round 1's U2): a blur dropped the caret to `<body>`, so the next Tab
 * restarted at the top of the page, and refocusing the field in the same breath
 * would merely re-arm the recording and make Escape a visible no-op.
 */
export const END_EDIT_KEYS: ReadonlySet<string> = new Set([
	"Escape",
	"Esc",
	"Enter",
]);

/**
 * The keystroke names the two grammars share, for the keys whose `event.key` is
 * not already the name.
 *
 * Kept SUPERSET on purpose: `escape`/`enter`/`tab` are named for the backend
 * grammar (which can store them) while the canonical grammar refuses them at
 * `normalizeChord` — so the shared table loses nothing for either recorder.
 */
export const CAPTURE_KEY_NAMES: Record<string, string> = {
	" ": "space",
	Spacebar: "space",
	Escape: "escape",
	Esc: "escape",
	Enter: "enter",
	Tab: "tab",
	Backspace: "backspace",
	Delete: "delete",
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
	Home: "home",
	End: "end",
	PageUp: "pageup",
	PageDown: "pagedown",
};

/** What a capture reads off a keyboard event; structural, so tests can build it. */
export type CaptureEventShape = {
	key: string;
	code?: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
};

/**
 * The modifier tokens an event holds, in the backend grammar's order
 * (`ctrl`, `alt`, `shift`, `meta`).
 *
 * This is the order `hotkeyFromEvent` has always emitted, kept byte-identical:
 * changing it would rewrite what every stored `keymap.*` row reads back as, for
 * a spelling cosmetic. The canonical grammar reorders at `normalizeChord`.
 */
export function captureModifierTokens(event: CaptureEventShape): string[] {
	const tokens: string[] = [];
	if (event.ctrlKey) tokens.push("ctrl");
	if (event.altKey) tokens.push("alt");
	if (event.shiftKey) tokens.push("shift");
	if (event.metaKey) tokens.push("meta");
	return tokens;
}

/**
 * `tokens` + `name`, joined the one way both recorders spell a press — and the
 * empty string when there is no name (a key neither grammar can say), which is
 * how the backend recorder has always refused one.
 */
export function composeCapturedChord(
	tokens: readonly string[],
	name: string,
): string {
	return name === "" ? "" : [...tokens, name].join("+");
}

/**
 * The registry chord a press spells, or `null` when it spells none.
 *
 * `null` covers the three refusals the recorder meets before it asks
 * `captureRefusal`: a modifier pressed alone, an IME composition in flight, and
 * a key the canonical grammar cannot name (an F-key, punctuation, `escape`
 * itself). The RETURN is canonical — `primary` for `meta` or `ctrl`, modifiers
 * ordered, the key named — so the caller stores what dispatch will match,
 * never a translation of it.
 */
export function chordFromEvent(
	event: CaptureEventShape & { isComposing?: boolean },
): string | null {
	if (MODIFIER_ONLY_KEYS.has(event.key) || event.isComposing === true) {
		return null;
	}
	const tokens: string[] = [];
	if (event.metaKey || event.ctrlKey) tokens.push("primary");
	if (event.altKey) tokens.push("alt");
	if (event.shiftKey) tokens.push("shift");
	const key = physicalKey({
		key: event.key,
		code: event.code,
		alt: event.altKey,
	});
	const name = CAPTURE_KEY_NAMES[key] ?? key.toLowerCase();
	return normalizeChord(composeCapturedChord(tokens, name));
}
