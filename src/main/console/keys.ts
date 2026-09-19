/**
 * The named-key encoder: what `console_keys` turns into bytes.
 *
 * Design: docs/design/ui-console-tab.md 10.5 ("main owns a named-key encoder"),
 * and the invariant that keeps one encoder from becoming two — the pane's
 * `@xterm/xterm` DOM handler encodes a real keystroke, and this table must agree
 * with it byte for byte.
 *
 * WHY MAIN OWNS ONE AT ALL. Human typing needs no encoder: the mirror's own DOM
 * handler produces the bytes for a keystroke. An agent's `console_keys` does,
 * because `@xterm/headless`'s `input(data)` does NOT encode — its typing says it
 * fires `onData` with exactly what it was given — so "send Up" would otherwise
 * mean "send the ASCII letters U, p" to whatever is running in the surface.
 *
 * THE REFERENCE IS XTERM ITSELF, not a guess: every sequence below is the one
 * `@xterm/xterm`'s own key handler emits for that key (its
 * `evaluateKeyboardEvent`/`Keyboard` tables), so the two encoders agree by
 * construction rather than by coincidence. The mode-sensitive entries are the
 * ones the emulator's own mode flags expose — DECCKM for the cursor keys and
 * home/end (application mode sends `ESC O x`, normal mode `ESC [ x`) and DECKPWM
 * for the keypad, which this encoder does not offer a key for. DECBKM
 * (backspace-sends-BS) is deliberately NOT honoured: `@xterm/headless`'s
 * published `modes` does not expose it, so reading it would mean reaching into a
 * private field, and xterm's own default (`0x7f`) is the byte the mirror's
 * encoder emits for the same keystroke — the one answer that keeps the two in
 * agreement.
 *
 * A NAMED KEY IS A NAME, NOT A KEYSTROKE: `console_keys` cannot express an
 * arbitrary modifier combination, only the vocabulary below. An unknown name is a
 * typed `unknown_key` refusal that lists what is accepted (§15), so a caller that
 * guessed `page-down` is told `pagedown` rather than silently sending nothing.
 */

/** The bytes one named key sends, given the surface's live modes. */
export interface KeyEncoderModes {
	applicationCursorKeys: boolean;
	applicationKeypad: boolean;
}

/** The names `console_keys` accepts, in one place so the refusal can list them
 * and a test can assert the set rather than a sample of it. */
export const NAMED_KEYS = [
	"enter",
	"return",
	"tab",
	"shift+tab",
	"backspace",
	"escape",
	"space",
	"up",
	"down",
	"left",
	"right",
	"home",
	"end",
	"pageup",
	"pagedown",
	"insert",
	"delete",
	"f1",
	"f2",
	"f3",
	"f4",
	"f5",
	"f6",
	"f7",
	"f8",
	"f9",
	"f10",
	"f11",
	"f12",
	"ctrl+a",
	"ctrl+b",
	"ctrl+c",
	"ctrl+d",
	"ctrl+e",
	"ctrl+f",
	"ctrl+g",
	"ctrl+h",
	"ctrl+i",
	"ctrl+j",
	"ctrl+k",
	"ctrl+l",
	"ctrl+m",
	"ctrl+n",
	"ctrl+o",
	"ctrl+p",
	"ctrl+q",
	"ctrl+r",
	"ctrl+s",
	"ctrl+t",
	"ctrl+u",
	"ctrl+v",
	"ctrl+w",
	"ctrl+x",
	"ctrl+y",
	"ctrl+z",
	"ctrl+space",
	"ctrl+[",
	"ctrl+\\",
	"ctrl+]",
	"ctrl+^",
	"ctrl+_",
] as const;

export type NamedKey = (typeof NAMED_KEYS)[number];

/** The mode-independent half of the table. A `Map` rather than an object literal
 * so a name like `constructor` cannot resolve through the prototype chain. */
const FIXED: Map<string, string> = new Map([
	["enter", "\r"],
	["return", "\r"],
	["tab", "\t"],
	["shift+tab", "\x1b[Z"],
	["backspace", "\x7f"],
	["escape", "\x1b"],
	["space", " "],
	["pageup", "\x1b[5~"],
	["pagedown", "\x1b[6~"],
	["insert", "\x1b[2~"],
	["delete", "\x1b[3~"],
	// F1-F4 are SS3 (their own code, no bracket); F5 onward are CSI with a number.
	["f1", "\x1bOP"],
	["f2", "\x1bOQ"],
	["f3", "\x1bOR"],
	["f4", "\x1bOS"],
	["f5", "\x1b[15~"],
	["f6", "\x1b[17~"],
	["f7", "\x1b[18~"],
	["f8", "\x1b[19~"],
	["f9", "\x1b[20~"],
	["f10", "\x1b[21~"],
	["f11", "\x1b[23~"],
	["f12", "\x1b[24~"],
]);

/** Control bytes for `ctrl+<letter>`, and the three punctuation controls xterm
 * maps (`ctrl+[` is ESC, `ctrl+\` is FS, `ctrl+]` is GS, `ctrl+^` is RS, `ctrl+_`
 * is US, `ctrl+space` is NUL). */
const CONTROL: Map<string, number> = new Map([
	["ctrl+space", 0x00],
	["ctrl+[", 0x1b],
	["ctrl+\\", 0x1c],
	["ctrl+]", 0x1d],
	["ctrl+^", 0x1e],
	["ctrl+_", 0x1f],
]);

for (const letter of "abcdefghijklmnopqrstuvwxyz") {
	CONTROL.set(`ctrl+${letter}`, letter.charCodeAt(0) - 0x60);
}

/** The cursor keys and home/end, which DECCKM switches between two encodings. */
const CURSOR: Map<string, { normal: string; application: string }> = new Map([
	["up", { normal: "\x1b[A", application: "\x1bOA" }],
	["down", { normal: "\x1b[B", application: "\x1bOB" }],
	["right", { normal: "\x1b[C", application: "\x1bOC" }],
	["left", { normal: "\x1b[D", application: "\x1bOD" }],
	["home", { normal: "\x1b[H", application: "\x1bOH" }],
	["end", { normal: "\x1b[F", application: "\x1bOF" }],
]);

/** Whether a string is one of the accepted key names. */
export function isNamedKey(name: string): boolean {
	return FIXED.has(name) || CONTROL.has(name) || CURSOR.has(name);
}

/** One encoder for the whole module: the table's strings are ASCII by
 * construction, so a per-call encoder would only allocate. */
const ENCODER = new TextEncoder();

const encodeText = (text: string): Uint8Array => ENCODER.encode(text);

/**
 * Encode one named key, or null when the name is not in the vocabulary.
 *
 * Null rather than a throw: the caller turns it into the typed `unknown_key`
 * refusal, which carries the accepted set and is the only way a caller learns the
 * vocabulary without a second source of truth for it.
 */
export function encodeNamedKey(
	name: string,
	modes: KeyEncoderModes,
): Uint8Array | null {
	const fixed = FIXED.get(name);
	if (fixed !== undefined) return encodeText(fixed);
	const control = CONTROL.get(name);
	if (control !== undefined) return Uint8Array.from([control]);
	const cursor = CURSOR.get(name);
	if (cursor !== undefined) {
		return encodeText(
			modes.applicationCursorKeys ? cursor.application : cursor.normal,
		);
	}
	// Reached only for a name outside the vocabulary. `DECKPWM` is carried on the
	// modes object and deliberately unread: the vocabulary has no keypad key, and
	// honouring a mode for a key that cannot be sent would be a branch no caller
	// can exercise.
	return null;
}
