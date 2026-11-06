/**
 * The `press` key-chord grammar: pure, closed tables, no I/O.
 * Design: docs/design/ui-browser-tab.md 4 (`press`); wire contract is the one
 * recorded in damianvtran/local-operator#3248.
 *
 * A chord is `[Modifier+]*Base`:
 *  - modifiers: Shift | Control | Alt | Meta, any case, with `Ctrl` and `Cmd`
 *    accepted as aliases and canonicalised; each at most once;
 *  - base: ONE printable ASCII character (letter, digit, punctuation/symbol), or
 *    a named key from `NAMED_KEYS` below (exact spelling, so `tab` stays refused).
 *
 * WHY CLOSED TABLES AND NO CALLER-CONTROLLED CDP FIELDS: `key`/`code`/
 * `windowsVirtualKeyCode`/`modifiers`/`text` are all derived HERE from tables, never
 * copied from the request. A caller that could name a `text` could type arbitrary
 * strings through `press` and bypass `type`'s editable-target and read-back
 * checks; a caller that could name a `windowsVirtualKeyCode` could request
 * platform commands. A bare string longer than one character that is not a named
 * key is refused outright, so a credential or sentence pasted into `key` can never
 * be spelled out one key at a time by this path (that is what `type` and its
 * redaction are for).
 *
 * ONE CHORD PER CALL, no repeat count and no sequences: a loop belongs to the
 * caller, where each step can be checked against the page.
 *
 * THE MODIFIERS RIDE THE KEY EVENT (a single keyDown/keyUp pair whose `modifiers`
 * bitmask is set), exactly as the pre-existing `Shift+Tab` always did. No separate
 * modifier-key presses are synthesised, so a page sees `ctrlKey`/`metaKey`/... true
 * on the base key's event, which is what shortcut handlers read. A listener
 * for the bare `Control` keydown itself is not served.
 *
 * LETTER CASE FOLLOWS THE REAL KEYBOARD (see the comment in `parsePressChord`):
 * `Control+K` is dispatched with `key: "k"`, because that is what a physical
 * Ctrl+K keydown carries and what `e.key === "k"` shortcut handlers compare to.
 * The `code`/virtual-key table is the US layout's and says so.
 */

/** CDP `Input.dispatchKeyEvent` modifier bits. */
const MOD_ALT = 1;
const MOD_CONTROL = 2;
const MOD_META = 4;
const MOD_SHIFT = 8;

/** Canonical spelling -> bit, in the order the canonical string lists them. */
const MODIFIER_ORDER: ReadonlyArray<readonly [string, number]> = [
	["Control", MOD_CONTROL],
	["Alt", MOD_ALT],
	["Shift", MOD_SHIFT],
	["Meta", MOD_META],
];

/** Lower-cased spelling (including the two aliases) -> canonical name. */
const MODIFIER_NAMES: ReadonlyMap<string, string> = new Map([
	["shift", "Shift"],
	["control", "Control"],
	["ctrl", "Control"],
	["alt", "Alt"],
	["meta", "Meta"],
	["cmd", "Meta"],
]);

export interface KeyDescriptor {
	/** The DOM `KeyboardEvent.key`. */
	key: string;
	/** The DOM `KeyboardEvent.code`. */
	code: string;
	windowsVirtualKeyCode: number;
	/** The character a plain press types, or absent for a non-character key. */
	text?: string;
	/** What the same physical key types with no Shift held (CDP `unmodifiedText`).
	 * Differs from `text` only for an upper-case letter or a shifted symbol. */
	unmodifiedText?: string;
}

/** Named keys: canonical name -> descriptor. `Enter` carries `"\r"` and `Space` a
 * space so a plain press still activates a button / submits a form; both are
 * dropped by `parsePressChord` when Control/Meta/Alt is held, as for any character. */
const NAMED_KEYS: ReadonlyMap<string, KeyDescriptor> = new Map([
	[
		"Backspace",
		{ key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
	],
	["Tab", { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }],
	[
		"Enter",
		{
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			text: "\r",
			unmodifiedText: "\r",
		},
	],
	["Escape", { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }],
	[
		"Space",
		{
			key: " ",
			code: "Space",
			windowsVirtualKeyCode: 32,
			text: " ",
			unmodifiedText: " ",
		},
	],
	["PageUp", { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 }],
	[
		"PageDown",
		{ key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
	],
	["End", { key: "End", code: "End", windowsVirtualKeyCode: 35 }],
	["Home", { key: "Home", code: "Home", windowsVirtualKeyCode: 36 }],
	[
		"ArrowLeft",
		{ key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
	],
	["ArrowUp", { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 }],
	[
		"ArrowRight",
		{ key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
	],
	[
		"ArrowDown",
		{ key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
	],
	["Delete", { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 }],
	...Array.from({ length: 12 }, (_, index): [string, KeyDescriptor] => {
		const name = `F${index + 1}`;
		return [
			name,
			{ key: name, code: name, windowsVirtualKeyCode: 112 + index },
		];
	}),
]);

/** Punctuation and symbols: the character -> its US-layout `code` and virtual key.
 * The shifted symbols share the key of their unshifted partner. */
const PUNCTUATION: ReadonlyArray<readonly [string, string, number]> = [
	["-_", "Minus", 189],
	["=+", "Equal", 187],
	["[{", "BracketLeft", 219],
	["]}", "BracketRight", 221],
	["\\|", "Backslash", 220],
	[";:", "Semicolon", 186],
	["'\"", "Quote", 222],
	[",<", "Comma", 188],
	[".>", "Period", 190],
	["/?", "Slash", 191],
	["`~", "Backquote", 192],
];
const SHIFTED_DIGITS = ")!@#$%^&*(";

/** Every printable ASCII base character the grammar admits (space excluded:
 * `Space` is the named spelling, so a stray trimmed space cannot be a keypress). */
const PRINTABLE_KEYS: ReadonlyMap<string, KeyDescriptor> = (() => {
	const table = new Map<string, KeyDescriptor>();
	const add = (
		char: string,
		code: string,
		windowsVirtualKeyCode: number,
		unmodifiedText = char,
	) => {
		table.set(char, {
			key: char,
			code,
			windowsVirtualKeyCode,
			text: char,
			unmodifiedText,
		});
	};
	for (let index = 0; index < 26; index += 1) {
		const lower = String.fromCharCode(97 + index);
		const code = `Key${lower.toUpperCase()}`;
		add(lower, code, 65 + index);
		add(lower.toUpperCase(), code, 65 + index, lower);
	}
	for (let digit = 0; digit <= 9; digit += 1) {
		add(String(digit), `Digit${digit}`, 48 + digit);
		add(SHIFTED_DIGITS[digit], `Digit${digit}`, 48 + digit, String(digit));
	}
	for (const [chars, code, virtualKey] of PUNCTUATION) {
		for (const char of chars) add(char, code, virtualKey, chars[0]);
	}
	return table;
})();

const LETTER = /^[A-Za-z]$/;

/** Longest `key` string considered at all, so an enormous value is refused before
 * it is split. The longest legal chord is `Control+Alt+Shift+Meta+PageDown`. */
const MAX_CHORD_LENGTH = 40;

/** The most of a refused `key` a refusal repeats back. Short on purpose: the value
 * is whatever the caller sent, and a credential-sized string pasted into `key`
 * must not be copied whole into an error, its data and the host log. */
const MAX_ECHO = 24;

export function describeRefusedKey(key: unknown): string {
	const text = String(key);
	return text.length > MAX_ECHO ? `${text.slice(0, MAX_ECHO)}...` : text;
}

export interface ParsedChord {
	/** The canonical spelling: `Control+Alt+Shift+Meta` order, `Control`/`Meta`
	 * names, named key as in the table. Equal to the input for the original eight
	 * spellings, which is what keeps their results byte-identical. */
	canonical: string;
	key: string;
	code: string;
	windowsVirtualKeyCode: number;
	/** The CDP `modifiers` bitmask. */
	modifiers: number;
	/** Set only for a character-producing press with no Control/Meta/Alt held:
	 * with one of them held the browser does not produce a character, and `text`
	 * would make Chromium fire `keypress`/`input` for a shortcut. */
	text?: string;
	unmodifiedText?: string;
}

/**
 * Parse one chord, or `null` for anything outside the grammar (the caller raises
 * the typed `unsupported_key`). Never throws, never returns a partial chord.
 */
export function parsePressChord(input: unknown): ParsedChord | null {
	if (typeof input !== "string" || input.length === 0) return null;
	if (input.length > MAX_CHORD_LENGTH) return null;

	// `+` is both the separator and a legal base character (`Control++`, `+`).
	let base: string;
	let modifierPart: string;
	if (input === "+") {
		base = "+";
		modifierPart = "";
	} else if (input.endsWith("++")) {
		base = "+";
		modifierPart = input.slice(0, -2);
		if (modifierPart === "") return null;
	} else {
		const cut = input.lastIndexOf("+");
		base = cut === -1 ? input : input.slice(cut + 1);
		modifierPart = cut === -1 ? "" : input.slice(0, cut);
		if (cut !== -1 && modifierPart === "") return null;
	}

	let modifiers = 0;
	const seen = new Set<string>();
	if (modifierPart !== "") {
		for (const raw of modifierPart.split("+")) {
			const name = MODIFIER_NAMES.get(raw.toLowerCase());
			if (!name || seen.has(name)) return null;
			seen.add(name);
			modifiers |= MODIFIER_ORDER.find(([n]) => n === name)?.[1] ?? 0;
		}
	}

	// Letter case follows what the physical keyboard would report, because a
	// shortcut is written `Control+K` but a real Ctrl+K keydown carries
	// `key: "k"` and handlers compare against that: Shift held -> upper case,
	// a shortcut modifier held without Shift -> lower case, otherwise as given
	// (a bare `K` types K). Letters only: digits and symbols are sent as given,
	// since their shifted forms are layout-specific.
	const shortcut = (modifiers & (MOD_CONTROL | MOD_META | MOD_ALT)) !== 0;
	const looked =
		LETTER.test(base) && (modifiers & MOD_SHIFT) !== 0
			? base.toUpperCase()
			: LETTER.test(base) && shortcut
				? base.toLowerCase()
				: base;
	const descriptor = NAMED_KEYS.get(base) ?? PRINTABLE_KEYS.get(looked);
	if (!descriptor) return null;

	const canonicalModifiers = MODIFIER_ORDER.filter(([name]) =>
		seen.has(name),
	).map(([name]) => name);
	const characterless = shortcut;
	return {
		canonical: [...canonicalModifiers, base].join("+"),
		key: descriptor.key,
		code: descriptor.code,
		windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode,
		modifiers,
		...(descriptor.text !== undefined && !characterless
			? {
					text: descriptor.text,
					unmodifiedText: descriptor.unmodifiedText ?? descriptor.text,
				}
			: {}),
	};
}
