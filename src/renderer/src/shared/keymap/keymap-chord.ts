/**
 * The chord grammar: one canonical stored form, the event match, and the display
 * a reader meets.
 *
 * ONE SPELLING, EVERYWHERE. A chord is stored, matched, compared and refused as
 * the canonical string: lower case, modifiers in the fixed order
 * `primary+alt+shift`, one key last — `primary+j`, `primary+shift+c`. Parsing is
 * deliberately the subset of the backend's desktop accelerator grammar
 * (`keymap.py`, `_normalize_accelerator`) that this surface can actually press,
 * so a future parity with `keymap.*` rows is a copy rather than a translation.
 *
 * `primary` IS THE APP MODIFIER — ⌘ on macOS, Ctrl elsewhere — and it is the
 * COLLAPSED spelling of both `meta` and `ctrl`. That collapse mirrors every
 * predicate this app already ships (`chat-sidebar-layout.ts`,
 * `new-chat-shortcut.ts`, `navigation-gesture.ts` and `palette-shortcut.ts` all
 * accept "meta or ctrl"), and it is why a chord cannot be Command-only on macOS
 * while Ctrl stays free: the same trade ⌘B has made since it shipped. It does
 * not affect the terminal carve-out — while a shell has focus, xterm consumes
 * what the shell needs before any listener runs, whichever physical key the
 * chord names.
 *
 * MATCHING IS STRING EQUALITY against a chord built from the event, with the
 * exact modifier set: ⌘J never matches ⌘⇧J. `buildChordMap` is built over the
 * EFFECTIVE bindings (override ?? default), first action in registry order
 * claiming a duplicated chord — which `sanitizeShortcutBindings` has already
 * made unambiguous for every stored blob, so the order is a belt to that brace.
 */

import {
	type MiniViewPlatform,
	formatQuickSendDisplay,
	formatQuickSendTokens,
} from "../../../../shared/mini-view";
import {
	type ActionId,
	KEYMAP_ACTIONS,
	RESERVED_CHORDS,
	type ShortcutBindings,
	actionById,
} from "./keymap-registry";

/**
 * The modifiers, in canonical order. `primary` is the app modifier; `alt` and
 * `shift` keep their platform names.
 */
const MODIFIER_TOKENS = ["primary", "alt", "shift"] as const;

type ModifierToken = (typeof MODIFIER_TOKENS)[number];

/**
 * Every modifier spelling that PARSES, mapped to its canonical token.
 *
 * `meta`/`ctrl`/`cmd`/`super` all collapse to `primary` (see the file header).
 * These aliases are a PARSE-side convenience — for hand-edited blobs and tests —
 * and are never stored: `normalizeChord` always emits the canonical spellings.
 */
const MODIFIER_ALIASES: Record<string, ModifierToken> = {
	primary: "primary",
	meta: "primary",
	cmd: "primary",
	command: "primary",
	super: "primary",
	ctrl: "primary",
	control: "primary",
	alt: "alt",
	option: "alt",
	shift: "shift",
};

/**
 * The named keys a chord may end in, beside single letters and digits.
 *
 * Deliberately the backend grammar's printable-and-navigational subset:
 * punctuation is unrepresentable (so `⌘+` cannot be captured), and `escape`,
 * `enter` and `tab` are absent because they end an edit rather than spell a
 * binding (`END_EDIT_KEYS`) — a rail chord that swallowed Enter or Tab would
 * take a key every focused control needs.
 */
const NAMED_KEY_TOKENS: ReadonlySet<string> = new Set([
	"space",
	"backspace",
	"delete",
	"insert",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
]);

/** Whether a token is a key (letter, digit, `space`, or a named key) rather than a modifier. */
export const isChordKeyToken = (token: string): boolean =>
	NAMED_KEY_TOKENS.has(token) || /^[a-z0-9]$/.test(token);

/**
 * The canonical chord for a raw string, or `null` when it cannot be one.
 *
 * Lowercases, maps modifier aliases, orders the modifiers, dedupes them and
 * validates the key — one function so the parser, the storage guard and the
 * tests cannot disagree about what a chord is. A string with NO modifier
 * (`"j"`) still parses: whether it is BINDABLE is `captureRefusal`'s question
 * ("a shortcut needs ⌘ or Ctrl"), not the grammar's.
 */
export function normalizeChord(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const tokens = raw
		.toLowerCase()
		.split("+")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return null;
	const key = tokens[tokens.length - 1];
	if (!isChordKeyToken(key)) return null;
	const modifiers = new Set<ModifierToken>();
	for (const token of tokens.slice(0, -1)) {
		const modifier = MODIFIER_ALIASES[token];
		if (modifier === undefined) return null;
		modifiers.add(modifier);
	}
	const ordered = MODIFIER_TOKENS.filter((token) => modifiers.has(token));
	return [...ordered, key].join("+");
}

/**
 * Whether a canonical chord can ever dispatch.
 *
 * The router only considers presses holding `metaKey || ctrlKey`, so its
 * canonical chords always carry `primary`; a stored chord without one would
 * display as a binding and never fire — which is why both the capture refusal
 * and the merge sanitizer drop it.
 */
export const chordHasPrimary = (chord: string): boolean =>
	chord.split("+").includes("primary");

/**
 * The chord an action dispatches on: the user's override, else the default.
 *
 * The override is trusted as canonical — both writers (`setShortcutBinding` and
 * `sanitizeShortcutBindings`) normalized it before storing — so reading it back
 * is a lookup, not a re-parse.
 */
export function effectiveChord(
	actionId: ActionId,
	bindings: ShortcutBindings | undefined,
): string | null {
	const override = bindings?.[actionId];
	if (typeof override === "string") return override;
	return actionById(actionId)?.defaultChord ?? null;
}

/**
 * The dispatch map: canonical chord → the action it runs.
 *
 * Built over every action's EFFECTIVE chord (defaults dispatch too, or the
 * console's shipped `primary+j` would do nothing until someone touched
 * settings), first action in registry order keeping a duplicated chord. Stored
 * duplicates cannot reach here — capture refuses them and the sanitizer drops
 * them — so the first-wins rule is a guarantee, not a hope.
 */
export function buildChordMap(
	bindings: ShortcutBindings | undefined,
): Map<string, ActionId> {
	const map = new Map<string, ActionId>();
	for (const action of KEYMAP_ACTIONS) {
		const chord = effectiveChord(action.id, bindings);
		if (chord !== null && !map.has(chord)) map.set(chord, action.id);
	}
	return map;
}

/**
 * Why a captured chord cannot be assigned, as the sentence shown under the
 * field — or `null` when it can. Ordered so the most specific job is named:
 *
 * 1. a chord the event could not even spell (`null` — an F-key, punctuation);
 * 2. a chord with no `primary` (it would fire while the user types);
 * 3. a reserved chord (the set's own sentence names the job);
 * 4. a chord another action already answers — under its effective binding, so
 *    a default counts as taken, not only a stored override.
 *
 * The action's OWN chord is not a conflict: re-pressing the chord a row already
 * shows is a no-op the row commits rather than a refusal.
 */
export function captureRefusal(
	chord: string | null,
	actionId: ActionId,
	bindings: ShortcutBindings | undefined,
): string | null {
	const normalized = chord === null ? null : normalizeChord(chord);
	if (normalized === null) return "That key cannot be bound.";
	if (!chordHasPrimary(normalized)) return "A shortcut needs ⌘ or Ctrl.";
	const reserved = RESERVED_CHORDS.get(normalized);
	if (reserved !== undefined) return reserved;
	for (const action of KEYMAP_ACTIONS) {
		if (action.id === actionId) continue;
		if (effectiveChord(action.id, bindings) === normalized) {
			return `Already assigned to ${action.label}.`;
		}
	}
	return null;
}

/**
 * What a persisted blob is allowed to say about shortcuts.
 *
 * `localStorage` is not a trusted input (a hand edit, a downgrade, a
 * half-written blob), so every override is re-validated here — and the drop
 * rules are exactly the capture rules: non-strings, unknown ids (never read: the
 * loop IS the registry), unparseable or primary-less chords, reserved chords,
 * and a chord an earlier action in registry order already claimed. A dropped
 * override falls back to the action's default, which itself claims its chord —
 * so two entries fighting over one chord resolve to the first action in the
 * registry, and dispatch stays unambiguous.
 */
export function sanitizeShortcutBindings(raw: unknown): ShortcutBindings {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
	const source = raw as Record<string, unknown>;
	const claimed = new Set<string>();
	const bindings: ShortcutBindings = {};
	for (const action of KEYMAP_ACTIONS) {
		const stored = source[action.id];
		const normalized =
			typeof stored === "string" ? normalizeChord(stored) : null;
		const override =
			normalized !== null &&
			chordHasPrimary(normalized) &&
			!RESERVED_CHORDS.has(normalized) &&
			!claimed.has(normalized)
				? normalized
				: null;
		if (override !== null) bindings[action.id] = override;
		const effective = override ?? action.defaultChord;
		if (effective !== null) claimed.add(effective);
	}
	return bindings;
}

/**
 * The display spelling of an action's effective chord, or `null` when it is
 * unbound — what a control PRINTS.
 *
 * One function so the surfaces that print a cap (the rail's items, the run
 * trigger) cannot spell the same action's chord differently, and so "bound"
 * means one thing everywhere: an override, else the default, else no parens.
 */
export function displayChord(
	actionId: ActionId,
	bindings: ShortcutBindings | undefined,
	platform: MiniViewPlatform,
): string | null {
	const chord = effectiveChord(actionId, bindings);
	return chord === null ? null : chordGlyph(chord, platform);
}

/*
 * --------------------------------------------------------------------------
 * Display: one token table, shared with the mini view's own spellings.
 * --------------------------------------------------------------------------
 */

/**
 * The chord as the key caps a person reads, one entry per cap.
 *
 * Implemented by importing `formatQuickSendTokens` rather than by a second copy
 * of the tables: the stored grammar of a `keymap.*` row and this registry's are
 * forked deliberately (parity is the follow-up), but the WORDS a person reads
 * for a chord must not fork — `⌘` is `⌘` on both surfaces (design rule D4, the
 * mini view's own).
 */
export function chordTokens(
	chord: string,
	platform: MiniViewPlatform,
): string[] {
	return formatQuickSendTokens(chord, platform);
}

/**
 * The chord as a sentence spelling: mac `⌘⇧C` with no separators, elsewhere
 * `Ctrl+Shift+C` — exactly the output `canvasToggleCap` printed, now derived
 * from the registry's canonical string instead of a hand-kept constant.
 */
export function chordGlyph(chord: string, platform: MiniViewPlatform): string {
	return formatQuickSendDisplay(chord, platform);
}

/**
 * The chord as the `KeyboardShortcut` component's `shortcut` prop: its caps
 * joined with "+", the `paletteDoorCaps` pattern (a mac sentence spelling
 * cannot be split back into caps without guessing).
 */
export function chordCaps(chord: string, platform: MiniViewPlatform): string {
	return chordTokens(chord, platform).join("+");
}
