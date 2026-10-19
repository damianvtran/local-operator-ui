import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applyUpdate, checkCoverage, main } from "./check-coverage.mjs";

const UNKNOWN_LOCALE = /not in the manifest/;
const UNKNOWN_NAMESPACE = /no such namespace/;
const SOURCE_LOCALE_ROW = /not a gated target language/;
const DUPLICATE_PAIR = /duplicates/;
const MISSING_REASON = /needs a reason/;

/*
 * EXECUTABLE CONTRACT FOR THE COVERAGE GATE.
 *
 * The gate exists because a locale can be missing a whole namespace while the
 * runtime silently falls back to English, and no existing check reasons from
 * the manifest's list of promised languages. A guard that cannot be falsified
 * is worse than none, so these tests build a tiny catalogue tree and pin the
 * behaviours that make the promise real:
 *
 *  1. a complete tree passes;
 *  2. a missing namespace and a missing key both FAIL;
 *  3. a listed allowance pair passes, and a pair that has become complete FAILS
 *     (the allowance must shrink, never rot);
 *  4. `--update` removes now-complete pairs and cannot add one;
 *  5. a supported locale with no catalogue directory passes only when every
 *     populated English namespace is listed in the allowance (Urdu's state);
 *  6. an unlisted locale directory fails, so a new locale cannot escape the
 *     gate by simply existing;
 *  7. an allowance row naming an unknown locale, an unknown namespace, the
 *     source locale or a duplicate fails rather than allowing nothing quietly.
 *
 * The fixture is deliberately tiny and built per test, so these assertions
 * still mean the same thing when the real allowance reaches zero.
 */

function row(code, status = "supported", dir = "ltr") {
	return { code, native: code, english: code, dir, status };
}

function build({
	languages = [row("en", "source"), row("fr")],
	locales = {
		en: { "ui.demo": { hello: "Hello", bye: "Bye" } },
		fr: { "ui.demo": { hello: "Bonjour", bye: "Au revoir" } },
	},
	allowance = [],
	manifestOverride,
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "coverage-check-"));
	const cataloguesDir = join(root, "catalogues");
	for (const [locale, namespaces] of Object.entries(locales)) {
		mkdirSync(join(cataloguesDir, locale), { recursive: true });
		for (const [namespace, messages] of Object.entries(namespaces)) {
			writeFileSync(
				join(cataloguesDir, locale, `${namespace}.json`),
				`${JSON.stringify(messages, null, "\t")}\n`,
			);
		}
	}
	const manifestPath = join(root, "languages.json");
	writeFileSync(
		manifestPath,
		`${JSON.stringify(
			manifestOverride ?? {
				schema: 1,
				source: "en",
				note: "fixture",
				languages,
			},
			null,
			"\t",
		)}\n`,
	);
	const allowancePath = join(root, "coverage-allowance.json");
	writeFileSync(
		allowancePath,
		`${JSON.stringify(
			{
				schema: 1,
				note: "fixture",
				pairs: allowance.map((pair) => ({
					reason: "fixture gap",
					...pair,
				})),
			},
			null,
			"\t",
		)}\n`,
	);
	return { cataloguesDir, manifestPath, allowancePath };
}

function failures(result) {
	return (
		result.problems.length +
		result.allowanceProblems.length +
		result.extraNamespaces.length +
		result.unlistedLocales.length +
		result.newGaps.length +
		result.stale.length +
		result.phantoms.length
	);
}

test("a complete tree passes", () => {
	const tree = build();
	const result = checkCoverage(tree);
	assert.equal(failures(result), 0);
	assert.equal(result.newGaps.length, 0);
});

test("a missing namespace fails", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { hello: "Hello", bye: "Bye" } },
			fr: {},
		},
	});
	const result = checkCoverage(tree);
	assert.equal(result.newGaps.length, 1);
	assert.equal(result.newGaps[0].locale, "fr");
	assert.equal(result.newGaps[0].namespace, "ui.demo");
	assert.equal(result.newGaps[0].keys.length, 2);
});

test("a missing key inside an existing namespace fails", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { hello: "Hello", bye: "Bye" } },
			fr: { "ui.demo": { hello: "Bonjour" } },
		},
	});
	const result = checkCoverage(tree);
	assert.equal(result.newGaps.length, 1);
	assert.deepEqual(result.newGaps[0].keys, ["bye"]);
});

test("an allowance pair covers the gap it names", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { hello: "Hello", bye: "Bye" } },
			fr: {},
		},
		allowance: [{ locale: "fr", namespace: "ui.demo" }],
	});
	const result = checkCoverage(tree);
	assert.equal(failures(result), 0);
	assert.equal(result.stale.length, 0);
});

test("an allowance pair that is now complete fails, and --update drops it", () => {
	const tree = build({ allowance: [{ locale: "fr", namespace: "ui.demo" }] });
	const before = checkCoverage(tree);
	assert.equal(before.stale.length, 1);
	assert.equal(main([], tree), 1);

	assert.equal(applyUpdate(tree), 0);
	const after = checkCoverage(tree);
	assert.equal(failures(after), 0);
	assert.deepEqual(
		JSON.parse(readFileSync(tree.allowancePath, "utf8")).pairs,
		[],
	);
});

test("--update cannot add a pair for a new gap", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { hello: "Hello" } },
			fr: {},
		},
	});
	assert.equal(applyUpdate(tree), 0);
	const result = checkCoverage(tree);
	assert.equal(result.newGaps.length, 1);
	assert.equal(result.allowance.pairs.length, 0);
	assert.equal(main([], tree), 1);
});

test("a supported locale with no directory passes when its gaps are allowed", () => {
	const tree = build({
		languages: [row("en", "source"), row("fr"), row("ur", "supported", "rtl")],
		locales: {
			en: { "ui.demo": { hello: "Hello" } },
			fr: { "ui.demo": { hello: "Bonjour" } },
		},
		allowance: [{ locale: "ur", namespace: "ui.demo" }],
	});
	const result = checkCoverage(tree);
	assert.equal(failures(result), 0);
});

test("a supported locale with no directory fails an unlisted gap", () => {
	const tree = build({
		languages: [row("en", "source"), row("fr"), row("ur", "supported", "rtl")],
		locales: {
			en: { "ui.demo": { hello: "Hello" } },
			fr: { "ui.demo": { hello: "Bonjour" } },
		},
	});
	const result = checkCoverage(tree);
	assert.equal(result.newGaps.length, 1);
	assert.equal(result.newGaps[0].locale, "ur");
});

test("an unlisted locale directory fails", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { hello: "Hello" } },
			fr: { "ui.demo": { hello: "Bonjour" } },
			de: { "ui.demo": { hello: "Hallo" } },
		},
	});
	const result = checkCoverage(tree);
	assert.deepEqual(result.unlistedLocales, ["de"]);
	assert.equal(failures(result), 1);
});

test("an allowance row naming an unknown locale is a phantom", () => {
	const tree = build({
		allowance: [{ locale: "de", namespace: "ui.demo" }],
	});
	const result = checkCoverage(tree);
	assert.equal(result.phantoms.length, 1);
	assert.match(result.phantoms[0], UNKNOWN_LOCALE);
});

test("an allowance row naming an unknown namespace is a phantom", () => {
	const tree = build({
		allowance: [{ locale: "fr", namespace: "ui.ghost" }],
	});
	const result = checkCoverage(tree);
	assert.equal(result.phantoms.length, 1);
	assert.match(result.phantoms[0], UNKNOWN_NAMESPACE);
});

test("an allowance row naming the source locale is a phantom", () => {
	const tree = build({
		allowance: [{ locale: "en", namespace: "ui.demo" }],
	});
	const result = checkCoverage(tree);
	assert.equal(result.phantoms.length, 1);
	assert.match(result.phantoms[0], SOURCE_LOCALE_ROW);
});

test("a duplicate allowance row fails", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { hello: "Hello" } },
			fr: {},
		},
		allowance: [
			{ locale: "fr", namespace: "ui.demo" },
			{ locale: "fr", namespace: "ui.demo" },
		],
	});
	const result = checkCoverage(tree);
	assert.equal(result.allowanceProblems.length, 1);
	assert.match(result.allowanceProblems[0], DUPLICATE_PAIR);
});

test("an allowance row needs a non-empty reason", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { hello: "Hello" } },
			fr: {},
		},
		allowance: [{ locale: "fr", namespace: "ui.demo", reason: "  " }],
	});
	const result = checkCoverage(tree);
	assert.equal(result.allowanceProblems.length, 1);
	assert.match(result.allowanceProblems[0], MISSING_REASON);
});

test("an unknown status fails", () => {
	const tree = build({ languages: [row("en", "source"), row("fr", "beta")] });
	const result = checkCoverage(tree);
	assert.ok(result.problems.some((problem) => problem.includes("not one of")));
	assert.equal(failures(result), 1);
});

test("a language row with an unknown field fails", () => {
	const tree = build({
		languages: [row("en", "source"), { ...row("fr"), region: "FR" }],
	});
	const result = checkCoverage(tree);
	assert.ok(
		result.problems.some((problem) => problem.includes("unknown field")),
	);
});

test("a manifest without exactly one source fails", () => {
	const tree = build({
		languages: [row("en", "supported"), row("fr")],
	});
	const result = checkCoverage(tree);
	assert.ok(result.problems.some((problem) => problem.includes("exactly one")));
});
