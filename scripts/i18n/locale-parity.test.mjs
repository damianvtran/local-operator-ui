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
	[
		"ui.console.pane.label",
		// A shared UI term, not a copy of untranslated English: French uses
		// « Console » for this surface verbatim, and the English string IS that same
		// common noun. The translation is correct as identical — the exemption is
		// about the WORD, not about skipping work. Naming the key here is the claim;
		// the reason is what makes it reviewable.
		"shared UI term: the French word for this pane is the same common noun",
	],
	[
		"ui.console.capacity.summary_compact_bare",
		// `{live, number}/{limit, number}`: placeholders and a slash, no words. There
		// is nothing to translate, and a French value that differed would only be
		// invented punctuation. Identical is the correct translation here.
		"language-neutral counter: only placeholders and '/', no words to translate",
	],
	[
		"ui.settings.account.settings_page.radient_pass",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.account.settings_page.tokens",
		"French technical term kept English by the French style guide (token).",
	],
	[
		"ui.settings.configuration.settings_page.version",
		"French cognate: « version » has the same spelling.",
	],
	[
		"ui.settings.configuration.settings_page.description",
		"French cognate: « description » has the same spelling.",
	],
	[
		"ui.settings.integrations.add_integration_form.arguments",
		"French command-line term: « arguments » has the same spelling.",
	],
	[
		"ui.settings.integrations.add_integration_form.url",
		"Standard technical abbreviation, unchanged in French.",
	],
	[
		"ui.settings.integrations.add_integration_form.https_mcp_example_com_mcp",
		"Literal sample URL; context requires it to remain byte-identical.",
	],
	[
		"ui.settings.integrations.integration_model.claude_code",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.integrations.integration_model.vs_code",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.integrations.integration_model.codex_cli",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.integrations.integration_model.global",
		"French scope adjective: « global » has the same spelling.",
	],
	[
		"ui.settings.model.system_prompt.instructions",
		"French cognate: « instructions » has the same spelling.",
	],
	[
		"ui.settings.speech.speech_settings_model.radient_pass",
		"Product name, preserved verbatim by the programme glossary.",
	],
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
const englishNamespaces = new Set();
for (const file of messageFiles(SOURCE_LOCALE)) {
	englishNamespaces.add(file);
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

	test(`[${locale}] carries EVERY key of each namespace file it ships`, () => {
		/*
		 * COMPLETE, NOT A SUBSET (root acceptance, all-locale rollout). A locale file
		 * present in the tree IS a claim that this locale supports that namespace, and
		 * the runtime would silently fall back to English for any key it omits — a
		 * gap that reads as "translated" on screen. So a shipped locale file must
		 * carry the SAME key set as its English source: no missing key, no extra one.
		 *
		 * This is the check the earlier shape lacked: the per-key checks below can all
		 * pass while a locale drops ten keys, because each surviving value is fine on
		 * its own.
		 */
		const gaps = [];
		for (const file of messageFiles(locale)) {
			if (!englishNamespaces.has(file)) continue; // no English source: the keys test reports it
			const enKeys = Object.keys(readCatalogue(SOURCE_LOCALE, file)).sort();
			const localeKeys = Object.keys(readCatalogue(locale, file)).sort();
			const missing = enKeys.filter((key) => !localeKeys.includes(key));
			const extra = localeKeys.filter((key) => !enKeys.includes(key));
			if (missing.length) {
				gaps.push(
					`${file}: missing ${missing.length} (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""})`,
				);
			}
			if (extra.length) {
				gaps.push(
					`${file}: extra ${extra.length} (${extra.slice(0, 3).join(", ")}…)`,
				);
			}
		}
		assert.deepEqual(
			gaps,
			[],
			`${locale} must carry a complete key set for every namespace file it ships`,
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
