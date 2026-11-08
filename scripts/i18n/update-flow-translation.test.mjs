/**
 * THE UPDATE FLOW'S 49 KEYS ARE REALLY TRANSLATED IN EVERY SHIPPED LOCALE.
 *
 * WHY THIS FILE EXISTS. `scripts/update-flow-keying.test.mjs` proves the update
 * flow's producers resolve through `t()`, but it can only use a marker locale: it
 * cannot tell a translation from the runtime's per-key English fallback. The
 * parity gates (`check-coverage`, `locale-parity`) prove each locale carries the
 * KEYS; they do not prove a value was translated rather than copied, and a
 * translator (or a merge) that pasted the English sentence back would pass them
 * while a French window read an English update reason - the exact failure this
 * slice exists to remove. This file closes that gap at the bundled-catalogue seam
 * the app actually ships.
 *
 * WHAT IS ASSERTED, for every `supported` locale in `i18n/languages.json` (the
 * shipped manifest, NOT a hand list here, so a locale added later is covered
 * without editing this file) and every key of the three update-flow namespaces
 * (`ui.updates.service`, `ui.updates.status`, `ui.installer.setup_cause`; the key
 * set is read from the English catalogues on disk, and its size is pinned so a
 * silently dropped namespace cannot weaken the test):
 *  1. the generated `bundledCatalogues[locale]` (what `t()` reads) holds the key
 *     as a non-empty string;
 *  2. that string differs from the English one, unless the key is listed in
 *     `IDENTICAL_BY_DESIGN` with the reason the value is the same in that locale.
 *
 * `IDENTICAL_BY_DESIGN` is deliberately empty today: the audited translations
 * differ from English for all 49 keys in all seven locales. An entry would be
 * for a value that is only tokens (a bare `{version}`) or a loanword that is
 * spelled the same; each needs a reason, and a stale entry (a key that is not an
 * update-flow key, or whose value in that locale now differs) fails so the list
 * cannot grow into a blanket exemption.
 *
 * A THIRD CHECK, STRUCTURAL: no non-ASCII whitespace or zero-width/bidi format
 * character may sit inside an ICU `{...}` ARGUMENT HEADER (`{needed, number,
 * ::group-off}`, `{count, plural, one {`...). The prose between headers MAY carry
 * them - French needs U+202F before `;:!?` - but ICU's pattern whitespace is the
 * ASCII set only, so one of them inside a header silently changes meaning: wave 2
 * of PR #1760 caught `{needed, number,<U+202F>::group-off}` in fr, where the
 * skeleton was no longer recognised and numbers rendered grouped
 * ("1 500" instead of "1500"). `parse()` does NOT flag that (the stray run is
 * accepted as an unknown style string), so the guard scans the pattern itself.
 *
 * NOT PROVEN HERE: that a translation is good. That is the independent audit's
 * job (receipts in `i18n/receipts/`, rows in `i18n/ledger.json`, narrative in
 * `docs/i18n/update-flow-provenance.md`); this is only the mechanical
 * "it is not English" floor.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "@formatjs/icu-messageformat-parser";
import { build } from "esbuild";

const ROOT = process.cwd();
const NAMESPACES = [
	"ui.updates.service",
	"ui.updates.status",
	"ui.installer.setup_cause",
];
const EXPECTED_KEY_COUNT = 49;

/**
 * `"<locale>/<key>": "<why the translated value legitimately equals English>"`.
 * Empty on purpose; see the header.
 * @type {Record<string, string>}
 */
const IDENTICAL_BY_DESIGN = {};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const manifest = readJson(join(ROOT, "i18n", "languages.json"));
const shipped = manifest.languages
	.filter((row) => row.status === "supported")
	.map((row) => row.code);

const englishKeys = NAMESPACES.flatMap((namespace) =>
	Object.keys(
		readJson(
			join(ROOT, "src", "i18n", "catalogues", "en", `${namespace}.json`),
		),
	),
);

const bundle = await build({
	stdin: {
		contents: `export { bundledCatalogues, bundledEnglish } from "./src/i18n/keys.gen";`,
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".json": "json" },
});
const { bundledCatalogues, bundledEnglish } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("the manifest names the seven shipped locales and the slice has 49 keys", () => {
	assert.ok(shipped.length >= 7, `shipped locales: ${shipped.join(", ")}`);
	assert.equal(new Set(englishKeys).size, englishKeys.length);
	assert.equal(englishKeys.length, EXPECTED_KEY_COUNT);
});

for (const locale of shipped) {
	test(`${locale}: every update-flow key is a translation, not English`, () => {
		const catalogue = bundledCatalogues[locale];
		assert.ok(catalogue, `${locale} has no bundled catalogue`);
		const untranslated = [];
		for (const key of englishKeys) {
			const value = catalogue[key];
			assert.equal(typeof value, "string", `${locale}/${key} is not a string`);
			assert.ok(value.trim().length > 0, `${locale}/${key} is empty`);
			assert.equal(typeof bundledEnglish[key], "string", `en/${key} missing`);
			if (
				value === bundledEnglish[key] &&
				!IDENTICAL_BY_DESIGN[`${locale}/${key}`]
			)
				untranslated.push(key);
		}
		assert.deepEqual(
			untranslated,
			[],
			`${locale} paints English for: ${untranslated.join(", ")}`,
		);
	});
}

test("IDENTICAL_BY_DESIGN holds only live, reasoned entries", () => {
	for (const [id, reason] of Object.entries(IDENTICAL_BY_DESIGN)) {
		const [locale, ...rest] = id.split("/");
		const key = rest.join("/");
		assert.ok(shipped.includes(locale), `${id}: ${locale} is not shipped`);
		assert.ok(englishKeys.includes(key), `${id}: not an update-flow key`);
		assert.ok(reason.trim().length > 0, `${id}: needs a reason`);
		assert.equal(
			bundledCatalogues[locale][key],
			bundledEnglish[key],
			`${id}: now differs from English - delete the exemption`,
		);
	}
});

/*
 * ---- structural guard: no exotic whitespace inside an ICU argument header ----
 */

/**
 * Whitespace look-alikes and invisible format characters. ICU (and the skeleton
 * parser behind `::group-off`) only treats ASCII space/tab/newline as pattern
 * whitespace, so any of these inside a header is part of the token that follows
 * it. Covers NBSP, the U+2000 block through ZWSP/ZWNJ/ZWJ/LRM/RLM, line and
 * paragraph separators, NNBSP, MMSP, word joiner, ideographic space, BOM, and the
 * Ogham / Mongolian-vowel-separator spaces.
 */
const HEADER_FORBIDDEN =
	/[\u00A0\u1680\u180E\u2000-\u200F\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/u;

/**
 * Brace-aware scan: returns the argument headers of one ICU pattern.
 *
 * A header is the run of characters inside an argument frame, from its `{` up to
 * the next `{` (a plural/select branch opening) or its closing `}`. Branch bodies
 * are message frames (prose) and are skipped, but nested arguments inside them are
 * scanned as headers in turn. Quoting follows ICU: `''` is a literal apostrophe,
 * and an apostrophe directly before `{` or `}` opens a quoted literal that runs to
 * the next apostrophe, so quoted braces do not move the frames.
 *
 * @param {string} pattern
 * @returns {{header: string, offset: number}[]}
 */
function argumentHeaders(pattern) {
	const headers = [];
	/** @type {("message" | "argument")[]} */
	const frames = ["message"];
	let current = null;
	const flush = () => {
		if (current) headers.push(current);
		current = null;
	};
	for (let i = 0; i < pattern.length; i += 1) {
		const ch = pattern[i];
		const top = frames[frames.length - 1];
		if (top === "message" && ch === "'") {
			if (pattern[i + 1] === "'") {
				i += 1;
			} else if (pattern[i + 1] === "{" || pattern[i + 1] === "}") {
				const close = pattern.indexOf("'", i + 1);
				i = close === -1 ? pattern.length : close;
			}
			continue;
		}
		if (ch === "{") {
			flush();
			// A brace in a message frame opens an argument; in an argument frame it
			// opens a plural/select branch body.
			frames.push(top === "message" ? "argument" : "message");
			if (top === "message") current = { header: "", offset: i };
			continue;
		}
		if (ch === "}") {
			flush();
			if (frames.length > 1) frames.pop();
			// Returning to an argument frame (after a branch body) resumes its header.
			if (frames[frames.length - 1] === "argument")
				current = { header: "", offset: i + 1 };
			continue;
		}
		if (top === "argument" && current) current.header += ch;
	}
	flush();
	return headers;
}

/** The forbidden characters found inside argument headers, as code points. */
function exoticHeaderCharacters(pattern) {
	const found = [];
	for (const { header } of argumentHeaders(pattern)) {
		for (const ch of header)
			if (HEADER_FORBIDDEN.test(ch))
				found.push(
					`U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
				);
	}
	return found;
}

test("the header scanner sees real headers (it cannot pass by finding none)", () => {
	// The French disk-space message is the one that carried the defect; its two
	// number arguments with a skeleton must show up as headers in every locale.
	for (const locale of shipped) {
		const value =
			bundledCatalogues[locale]["ui.updates.service.disk_space.message"];
		const headers = argumentHeaders(value).map((h) => h.header.trim());
		assert.ok(
			headers.filter((h) => /::group-off/.test(h)).length >= 2,
			`${locale}: expected 2 ::group-off headers, scanner saw ${JSON.stringify(headers)}`,
		);
	}
	// Plural headers and the nested argument inside a branch body are scanned too.
	const headers = argumentHeaders(
		"{n, plural, one {# fois {name}} other {# fois}}",
	).map((h) => h.header);
	assert.ok(headers.some((h) => h.startsWith("n, plural,")));
	assert.ok(headers.includes("name"));
	// A quoted brace does not open a frame.
	assert.deepEqual(
		argumentHeaders("l'{'a'}' {x}").map((h) => h.header),
		["x"],
	);
});

test("negative control: the fr disk-space defect is caught in memory", () => {
	const real = bundledCatalogues.fr["ui.updates.service.disk_space.message"];
	assert.match(real, /\{needed, number, ::group-off\}/);
	assert.deepEqual(exoticHeaderCharacters(real), []);
	// Reintroduce the defect: U+202F where ICU expects the ASCII space.
	const broken = real.replace(
		"{needed, number, ::group-off}",
		"{needed, number,\u202F::group-off}",
	);
	assert.notEqual(broken, real);
	assert.deepEqual(exoticHeaderCharacters(broken), ["U+202F"]);
	// And the premise: the parser alone would have accepted the broken pattern.
	assert.doesNotThrow(() => parse(broken));
	// Exotic whitespace in PROSE stays legal (French needs U+202F before ; : ! ?).
	assert.deepEqual(exoticHeaderCharacters("Fermez\u202F: {x} \u00A0fin"), []);
	// Every forbidden class is caught inside a header.
	for (const ch of ["\u00A0", "\u2000", "\u200B", "\u200E", "\u202F", "\u3000"])
		assert.equal(
			exoticHeaderCharacters(`{n,${ch}number}`).length,
			1,
			`U+${ch.codePointAt(0).toString(16)}`,
		);
});

for (const locale of ["en", ...shipped]) {
	test(`${locale}: no non-ASCII whitespace inside any ICU argument header`, () => {
		const catalogue =
			locale === "en" ? bundledEnglish : bundledCatalogues[locale];
		const offenders = [];
		for (const key of englishKeys) {
			const value = catalogue[key];
			// Real ICU must still parse; the scan below is on top of that, not instead.
			assert.doesNotThrow(
				() => parse(value),
				`${locale}/${key} is not valid ICU`,
			);
			const found = exoticHeaderCharacters(value);
			if (found.length) offenders.push(`${key}: ${found.join(", ")}`);
		}
		assert.deepEqual(offenders, [], `${locale}: ${offenders.join("; ")}`);
	});
}
