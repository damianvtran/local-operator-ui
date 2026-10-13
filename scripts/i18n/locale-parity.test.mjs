import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TYPE, parse } from "@formatjs/icu-messageformat-parser";

/*
 * FRENCH PARITY GUARD — the checks that make a shipped locale honest.
 *
 * Applied to every locale the repository actually ships (`catalogues/<locale>/`),
 * this asserts the three properties a translated catalogue must hold, and — just
 * as important — that it is REAL:
 *
 *  1. NO UNKNOWN KEYS. Every key in a locale file must exist in `en`. A key that
 *     is not in `en` is dead weight (nothing can look it up) and a sign of a
 *     rename that left the old id behind.
 *  2. PLACEHOLDER INTEGRITY. Every ICU argument (`{name}`, `{count}`, a plural,
 *     a select, a date) present in the English message must be present in the
 *     translation with the SAME name. A dropped `{count}` renders "files" with no
 *     number; a renamed one throws at format time. This parses BOTH sides with the
 *     real ICU parser rather than matching braces by hand.
 *  3. NOT AN ENGLISH STUB. A locale file whose values are byte-identical to `en`
 *     for a key is not a translation. Some values are legitimately identical
 *     (a proper noun, a token) — those are listed in `IDENTICAL_OK` with a reason,
 *     so an accidental English copy is caught while an intentional one passes.
 *
 * WHY A GUARD AND NOT A REVIEW NOTE: the operator's bug was a locale that LOOKED
 * shipped (the picker offered it, the store reported it) with nothing behind it.
 * These assertions are what stop an empty or English-only file from counting as a
 * translation, and they run per shipped locale so a second locale cannot skip them.
 */

const REPO = join(import.meta.dirname, "..", "..");
const CATALOGUES = join(REPO, "src", "i18n", "catalogues");
const SOURCE_LOCALE = "en";

/*
 * Values that are legitimately identical to English in a translation, with the
 * reason. Keep this EMPTY unless a string truly must not change: a proper noun or
 * a UI token. An entry here is a claim that gets reviewed, not a silencer.
 */
const IDENTICAL_OK = new Map([
	// (none yet — a locale that copies English should fail until a real
	// translation lands or an entry here names why it must stay identical.)
]);

function localeDirs() {
	return readdirSync(CATALOGUES, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name)
		.sort();
}

function messageFiles(locale) {
	const dir = join(CATALOGUES, locale);
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".context.json"))
		.sort();
}

function readCatalogue(locale, file) {
	return JSON.parse(readFileSync(join(CATALOGUES, locale, file), "utf8"));
}

/** Every ICU argument name in a message, plural/select options walked. */
function argumentNames(message) {
	const names = new Set();
	/*
	 * Only ARGUMENT-BEARING node types count, and they are NUMERIC constants
	 * (`TYPE.argument === 1`), not the strings the type names suggest — the first
	 * version compared `node.type` against "argument" and therefore matched
	 * nothing, so a placeholder check passed a fixture missing a real argument.
	 * A `literal` node (TYPE.literal) also carries a `.value` (its text), which is
	 * the other half of why value-presence alone is the wrong test.
	 */
	const ARGUMENT_TYPES = new Set([
		TYPE.argument,
		TYPE.number,
		TYPE.plural,
		TYPE.select,
		TYPE.date,
		TYPE.time,
	]);
	const walk = (nodes) => {
		for (const node of nodes) {
			if (ARGUMENT_TYPES.has(node.type) && typeof node.value === "string") {
				names.add(node.value);
			}
			if (node.options) {
				for (const option of Object.values(node.options)) {
					if (Array.isArray(option?.value)) walk(option.value);
				}
			}
		}
	};
	walk(parse(message));
	return names;
}

const english = new Map();
for (const file of messageFiles(SOURCE_LOCALE)) {
	for (const [key, message] of Object.entries(
		readCatalogue(SOURCE_LOCALE, file),
	)) {
		english.set(key, message);
	}
}

test("the English source is non-empty (the guard would pass vacuously otherwise)", () => {
	assert.ok(english.size > 0, "no English messages found to compare against");
});

for (const locale of localeDirs().filter((name) => name !== SOURCE_LOCALE)) {
	/*
	 * NON-EMPTY FIRST (review round 1, R3). The three checks below are per-key and
	 * per-value, so an EMPTY locale file — or an empty locale directory — violates
	 * none of them and passed all four tests vacuously. A shipped locale is a claim
	 * that there are messages behind it; this is the assertion that makes the rest
	 * non-vacuous.
	 */
	test(`[${locale}] ships at least one message (not an empty claim)`, () => {
		let messages = 0;
		for (const file of messageFiles(locale)) {
			messages += Object.keys(readCatalogue(locale, file)).length;
		}
		assert.ok(
			messages > 0,
			`${locale} has no messages at all — an empty locale directory is not a shipped translation`,
		);
	});

	/*
	 * ONE KEY, ONE FILE (review round 1, R4). Two namespace files in the same
	 * locale defining the same key silently shadow in the generated spread (the
	 * later file wins), and the per-key checks above see only well-formed values.
	 * The generator rejects this too; the guard states it independently so a
	 * hand-added second file cannot slip through the runtime.
	 */
	test(`[${locale}] defines each key in at most one namespace file`, () => {
		const owner = new Map();
		const duplicates = [];
		for (const file of messageFiles(locale)) {
			for (const key of Object.keys(readCatalogue(locale, file))) {
				const previous = owner.get(key);
				if (previous) duplicates.push(`${key}: ${previous} and ${file}`);
				else owner.set(key, file);
			}
		}
		assert.deepEqual(
			duplicates,
			[],
			`keys defined in more than one file in ${locale}`,
		);
	});

	test(`[${locale}] names only keys the English source defines`, () => {
		const unknown = [];
		for (const file of messageFiles(locale)) {
			for (const key of Object.keys(readCatalogue(locale, file))) {
				if (!english.has(key)) unknown.push(`${file}: ${key}`);
			}
		}
		assert.deepEqual(unknown, [], `unknown keys in ${locale}`);
	});

	test(`[${locale}] preserves every ICU placeholder from the English source`, () => {
		const problems = [];
		for (const file of messageFiles(locale)) {
			const data = readCatalogue(locale, file);
			for (const [key, message] of Object.entries(data)) {
				const source = english.get(key);
				if (source === undefined) continue; // reported by the keys test
				if (typeof message !== "string") {
					problems.push(`${file}: ${key} is not a string`);
					continue;
				}
				let translatedArgs;
				let sourceArgs;
				try {
					translatedArgs = argumentNames(message);
					sourceArgs = argumentNames(source);
				} catch (error) {
					problems.push(`${file}: ${key} is not valid ICU (${error.message})`);
					continue;
				}
				const missing = [...sourceArgs].filter((n) => !translatedArgs.has(n));
				const extra = [...translatedArgs].filter((n) => !sourceArgs.has(n));
				if (missing.length)
					problems.push(
						`${file}: ${key} missing placeholder(s) ${missing.join(", ")}`,
					);
				if (extra.length)
					problems.push(
						`${file}: ${key} has unknown placeholder(s) ${extra.join(", ")}`,
					);
			}
		}
		assert.deepEqual(problems, [], `placeholder problems in ${locale}`);
	});

	test(`[${locale}] is not an English stub (no value identical to the source)`, () => {
		const stubs = [];
		for (const file of messageFiles(locale)) {
			const data = readCatalogue(locale, file);
			for (const [key, message] of Object.entries(data)) {
				const source = english.get(key);
				if (source === undefined || typeof message !== "string") continue;
				if (message === source && !IDENTICAL_OK.has(key)) {
					stubs.push(`${file}: ${key}`);
				}
			}
		}
		assert.deepEqual(stubs, [], `values identical to English in ${locale}`);
	});
}
