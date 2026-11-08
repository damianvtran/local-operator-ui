/**
 * Runtime bidi isolation for right-to-left catalogues.
 *
 * THE FAULT THIS REMOVES. In a `dir=rtl` paragraph (Urdu today) a Latin token
 * that begins with a neutral sigil paints with the sigil on the wrong side:
 * `/model` reads `model/`, `$name` reads `name$`, and a value-fed
 * `/move <path>` reads `<move <path/`; `⌘Z` reads `Z⌘`. The cause is the
 * Unicode bidi algorithm, not the text: a neutral (`/`, `$`, `<`, `⌘`) sitting
 * between RTL text (or the paragraph start) and a Latin letter resolves to the
 * embedding direction (rule N2), so the sigil lands on the RTL side. Measured
 * with `fribidi --rtl` by the ur translation audits
 * (`i18n/receipts/*-s3a-ur-*.json`, `*-s3b-ur-*.json`: UR-1, UR-1b, UR-2, B1-1,
 * B1-3, B1-4, B1-5).
 *
 * WHY IT IS FIXED HERE AND NOT IN THE CATALOGUE. The ur catalogue values are
 * gated against U+200E and U+2066-2069 (`scripts/i18n/ur-activation.test.mjs`)
 * so a translator never has to reason about invisible controls, and a sigil
 * that arrives inside a placeholder VALUE is not in the catalogue at all.
 * `translate()` is the one seam every message passes through, so the controls
 * are added there, only for a message that an RTL catalogue answered.
 *
 * TWO STEPS, BOTH ONLY FOR AN RTL-ANSWERED MESSAGE:
 *
 * 1. `isolateArguments` wraps each string argument that is a Latin-led,
 *    code-ish token (a path, a command, a key chord, a name) in FSI...PDI
 *    (U+2068/U+2069), so its internal order is its own and its neighbours
 *    cannot reorder it. FSI, not LRI: the first strong character picks the
 *    direction, which is LTR for every value this selects.
 * 2. `isolateSigils` wraps a LITERAL `/`, `$` or `@` that opens a Latin word in
 *    LRI...PDI (U+2066/U+2069) when the nearest strong character before it is
 *    RTL or there is none. LRI and not the LRM the audits first proposed: an
 *    LRM at the start of a string is a strong LTR character and would flip a
 *    `dir=auto` container to LTR for the whole sentence, while an isolate is
 *    skipped by the first-strong scan. The same LRI precedent is
 *    `shared/i18n/isolate-ltr.ts`.
 *
 * LTR LOCALES ARE UNTOUCHED. `translate()` calls neither function unless the
 * catalogue that answered is RTL, so every en/fr/es/zh-CN/ru/vi/hi string is
 * byte-identical to before (pinned by `scripts/i18n/bidi-isolation.test.mjs`,
 * which renders every key of every LTR catalogue through both paths).
 */

import { TYPE } from "@formatjs/icu-messageformat-parser";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";

const FSI = "\u2068";
const LRI = "\u2066";
const PDI = "\u2069";

/** Hebrew, Arabic, Syriac, Thaana, NKo, Arabic presentation forms, and the RTL supplementary blocks. */
const RTL_CHAR =
	/[\u0590-\u08FF\u200F\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/** Any explicit bidi control: a value that already carries one is the caller's own isolation. */
const BIDI_CONTROL = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

/**
 * A Latin letter, or one of the modifier-key glyphs a shortcut chord is spelled
 * with (`⌘ ⌃ ⌥ ⇧`). Digits alone are NOT enough: a bare number is neutral-safe
 * after RTL text and isolating every count would add controls that change
 * nothing.
 */
const LATIN_OR_KEYGLYPH = /[A-Za-z\u2318\u2303\u2325\u21E7]/;

/**
 * The argument names a message uses as a PLAIN `{name}` splice.
 *
 * Arguments that also drive `select`, `plural`, `number`, `date` or `time` are
 * excluded: `{hasCap, select, yes {...}}` matches the VALUE `"yes"`, and a value
 * wrapped in FSI would silently fall through to `other`. The walk descends into
 * select/plural options and tags because a plain `{cap}` inside a select branch
 * is the common case (`ui.chat.ask_queue.rail.open`).
 */
export function plainArgumentNames(
	ast: readonly MessageFormatElement[],
): Set<string> {
	const plain = new Set<string>();
	const structural = new Set<string>();
	const walk = (elements: readonly MessageFormatElement[]): void => {
		for (const element of elements) {
			switch (element.type) {
				case TYPE.argument:
					plain.add(element.value);
					break;
				case TYPE.number:
				case TYPE.date:
				case TYPE.time:
					structural.add(element.value);
					break;
				case TYPE.select:
				case TYPE.plural:
					structural.add(element.value);
					for (const option of Object.values(element.options)) {
						walk(option.value);
					}
					break;
				case TYPE.tag:
					walk(element.children);
					break;
				default:
					break;
			}
		}
	};
	walk(ast);
	for (const name of structural) plain.delete(name);
	return plain;
}

/** Whether a value is a Latin-led token that needs its own isolate in RTL copy. */
export function needsIsolation(value: string): boolean {
	return (
		value !== "" &&
		LATIN_OR_KEYGLYPH.test(value) &&
		!RTL_CHAR.test(value) &&
		!BIDI_CONTROL.test(value)
	);
}

/**
 * `params` with each qualifying plain-splice string wrapped in FSI...PDI.
 * Non-string values (counts, dates) and everything not named in `names` pass
 * through by identity, so the plural/select machinery sees what it always saw.
 */
export function isolateArguments(
	params: Record<string, unknown>,
	names: ReadonlySet<string>,
): Record<string, unknown> {
	if (names.size === 0) return params;
	let wrapped: Record<string, unknown> | undefined;
	for (const name of names) {
		const value = params[name];
		if (typeof value === "string" && needsIsolation(value)) {
			wrapped ??= { ...params };
			wrapped[name] = `${FSI}${value}${PDI}`;
		}
	}
	return wrapped ?? params;
}

/** A sigil that opens a Latin command/variable/mention token. */
const SIGIL = /[/$@]/;

/**
 * A Latin word as a command, variable name or PATH: `goal`, `btw`,
 * `export-all`, `a.b`, `/Users/eren/Documents/image.png`, `@scope/pkg`.
 *
 * `/` and `:` belong in the separator class because ONE token must become ONE
 * isolate. A separator left out of this class splits the token into several
 * adjacent LRI runs, and adjacent isolates in an RTL paragraph are ordered
 * right-to-left: `/Users`, `/eren`, `/Documents`, `/image.png` painted
 * `/image.png/Documents/eren/Users` (review round 1, M1, on
 * `ui.canvas.insert_image_dialog.users_eren_documents_image_png`). A URL is
 * unaffected - `https` is a strong LTR character before the first `/`, so the
 * `lastStrong !== "L"` gate already skips it.
 */
const LATIN_WORD = /^[A-Za-z][A-Za-z0-9_]*(?:[/.:-][A-Za-z0-9_]+)*/;

/** A decimal digit, weak in the bidi algorithm even inside the Arabic block. */
const DIGIT = /\p{Nd}/u;

/** Any letter: strong, and left-to-right once `RTL_CHAR` has been ruled out. */
const LETTER = /\p{L}/u;

const isOpener = (char: string): boolean =>
	char === LRI || char === FSI || char === "\u2067";

/** Index just past the PDI that closes the isolate opened at `start`. */
function isolateEnd(text: string, start: number): number {
	let depth = 0;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index] as string;
		if (isOpener(char)) depth += 1;
		else if (char === PDI) {
			depth -= 1;
			if (depth === 0) return index + 1;
		}
	}
	return text.length;
}

/**
 * Wrap each literal sigil-led Latin token that would paint reversed in LRI...PDI.
 *
 * A token qualifies when a `/`, `$` or `@` is followed by a Latin letter or by
 * an FSI/LRI-isolated value (`/{name}` after `isolateArguments`) AND the nearest
 * strong character before it, ignoring neutrals and ignoring the content of any
 * isolate (an isolate is one neutral to its surroundings), is RTL or absent. A
 * token after Latin text (`Enter /goal`) already resolves left-to-right and is
 * left alone, as are `https://host`, `a/b` and `TCP/IP`, so the output only
 * differs where the unmodified string was wrong.
 */
export function isolateSigils(text: string): string {
	let out = "";
	// null: no strong character yet, so the paragraph (RTL here) decides.
	let lastStrong: "L" | "R" | null = null;
	let index = 0;
	while (index < text.length) {
		const char = text[index] as string;
		if (isOpener(char)) {
			const end = isolateEnd(text, index);
			out += text.slice(index, end);
			index = end;
			continue;
		}
		if (SIGIL.test(char) && lastStrong !== "L") {
			const next = text[index + 1] ?? "";
			let end = -1;
			if (isOpener(next)) end = isolateEnd(text, index + 1);
			else {
				const word = LATIN_WORD.exec(text.slice(index + 1));
				if (word) end = index + 1 + word[0].length;
			}
			if (end !== -1) {
				out += `${LRI}${text.slice(index, end)}${PDI}`;
				index = end;
				continue;
			}
		}
		// Digits are weak even inside the Arabic block (U+0660-06F9): they never
		// decide which side a neutral falls on, so they are skipped like punctuation.
		if (DIGIT.test(char)) {
			/* weak */
		} else if (RTL_CHAR.test(char)) lastStrong = "R";
		else if (LETTER.test(char)) lastStrong = "L";
		out += char;
		index += 1;
	}
	return out;
}
