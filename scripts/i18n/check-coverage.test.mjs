import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	allowanceGrowth,
	applyUpdate,
	checkCoverage,
	failureCount,
	main,
} from "./check-coverage.mjs";

const UNKNOWN_LOCALE = /not in the manifest/;
const UNKNOWN_NAMESPACE = /no such namespace/;
const SOURCE_LOCALE_ROW = /not a gated target language/;
const DUPLICATE_PAIR = /duplicates/;
const INVALID_JSON = /JSON/;
const NO_MISSING_KEYS = /no missing keys/;
const UNSORTED_KEYS = /not sorted/;
const DUPLICATE_KEYS = /duplicate keys/;
const OUTSIDE_NAMESPACE = /outside ui\.demo/;

/*
 * EXECUTABLE CONTRACT FOR THE COVERAGE GATE.
 *
 * The gate exists because a locale can be missing a whole namespace or a single
 * key while the runtime silently falls back to English, and no existing check
 * reasons from the manifest's list of promised languages. A guard that cannot
 * be falsified is worse than none, so these tests build a tiny catalogue tree
 * and pin the behaviours that make the promise real:
 *
 *  1. a complete tree passes;
 *  2. a missing namespace and a missing key both FAIL — including a new key
 *     added inside an already-incomplete namespace, which is the case a
 *     pair-level allowance would let through;
 *  3. a listed key that has become present FAILS (the allowance must shrink,
 *     never rot);
 *  4. `--update` removes now-present keys and empty pairs, and cannot add;
 *  5. every entry must be attributed (reason, owner, payoff) and its key list
 *     sorted, duplicate-free, non-empty and scoped to its namespace;
 *  6. a supported locale with no catalogue directory passes only when every
 *     populated English key is listed (Urdu's state);
 *  7. an unlisted locale directory fails, so a new locale cannot escape the
 *     gate by simply existing;
 *  8. growth over a base allowance is reported key by key.
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
		en: { "ui.demo": { "ui.demo.hello": "Hello", "ui.demo.bye": "Bye" } },
		fr: {
			"ui.demo": { "ui.demo.hello": "Bonjour", "ui.demo.bye": "Au revoir" },
		},
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
				pairs: allowance.map((entry) => ({
					reason: "fixture gap",
					owner: "fixture-owner",
					payoff: "2026-12-31",
					...entry,
				})),
			},
			null,
			"\t",
		)}\n`,
	);
	return { cataloguesDir, manifestPath, allowancePath };
}

test("a complete tree passes", () => {
	const tree = build();
	const result = checkCoverage(tree);
	assert.equal(failureCount(result), 0);
	assert.equal(result.newKeys.length, 0);
});

test("a missing namespace fails on every missing key", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello", "ui.demo.bye": "Bye" } },
			fr: {},
		},
	});
	const result = checkCoverage(tree);
	assert.equal(result.newKeys.length, 2);
	assert.deepEqual(
		result.newKeys.map((finding) => finding.key),
		["ui.demo.bye", "ui.demo.hello"],
	);
	assert.equal(result.newKeys[0].locale, "fr");
});

test("a missing key inside an existing namespace fails", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello", "ui.demo.bye": "Bye" } },
			fr: { "ui.demo": { "ui.demo.hello": "Bonjour" } },
		},
	});
	const result = checkCoverage(tree);
	assert.equal(result.newKeys.length, 1);
	assert.deepEqual(result.newKeys[0].key, "ui.demo.bye");
});

test("a new key inside an already-allowlisted namespace fails", () => {
	const tree = build({
		locales: {
			en: {
				"ui.demo": {
					"ui.demo.hello": "Hello",
					"ui.demo.bye": "Bye",
					"ui.demo.later": "Later",
				},
			},
			fr: { "ui.demo": { "ui.demo.hello": "Bonjour" } },
		},
		allowance: [
			{ locale: "fr", namespace: "ui.demo", missing: ["ui.demo.bye"] },
		],
	});
	const result = checkCoverage(tree);
	assert.equal(result.newKeys.length, 1);
	assert.equal(result.newKeys[0].key, "ui.demo.later");
	assert.equal(result.newKeys[0].locale, "fr");
});

test("an exact allowance covers the gap it names", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello", "ui.demo.bye": "Bye" } },
			fr: {},
		},
		allowance: [
			{
				locale: "fr",
				namespace: "ui.demo",
				missing: ["ui.demo.bye", "ui.demo.hello"],
			},
		],
	});
	const result = checkCoverage(tree);
	assert.equal(failureCount(result), 0);
	assert.equal(result.staleKeys.length, 0);
});

test("a listed key that is no longer missing fails, and --update drops it", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello", "ui.demo.bye": "Bye" } },
			fr: { "ui.demo": { "ui.demo.bye": "Au revoir" } },
		},
		allowance: [
			{
				locale: "fr",
				namespace: "ui.demo",
				missing: ["ui.demo.bye", "ui.demo.hello"],
			},
		],
	});
	const before = checkCoverage(tree);
	assert.equal(before.staleKeys.length, 1);
	assert.equal(before.staleKeys[0].key, "ui.demo.bye");
	assert.equal(main([], tree), 1);

	assert.equal(applyUpdate(tree), 0);
	const after = checkCoverage(tree);
	assert.equal(failureCount(after), 0);
	const saved = JSON.parse(readFileSync(tree.allowancePath, "utf8"));
	assert.deepEqual(saved.pairs[0].missing, ["ui.demo.hello"]);
});

test("--update removes an entry whose keys are all present", () => {
	const tree = build({
		allowance: [
			{ locale: "fr", namespace: "ui.demo", missing: ["ui.demo.hello"] },
		],
	});
	assert.equal(applyUpdate(tree), 0);
	const saved = JSON.parse(readFileSync(tree.allowancePath, "utf8"));
	assert.deepEqual(saved.pairs, []);
});

test("--update cannot add a key for a new gap", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello" } },
			fr: {},
		},
	});
	assert.equal(applyUpdate(tree), 0);
	const result = checkCoverage(tree);
	assert.equal(result.newKeys.length, 1);
	assert.equal(result.allowance.pairs.length, 0);
	assert.equal(main([], tree), 1);
});

test("a supported locale with no directory passes when its keys are allowed", () => {
	const tree = build({
		languages: [row("en", "source"), row("fr"), row("ur", "supported", "rtl")],
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello" } },
			fr: { "ui.demo": { "ui.demo.hello": "Bonjour" } },
		},
		allowance: [
			{ locale: "ur", namespace: "ui.demo", missing: ["ui.demo.hello"] },
		],
	});
	const result = checkCoverage(tree);
	assert.equal(failureCount(result), 0);
});

test("a supported locale with no directory fails an unlisted key", () => {
	const tree = build({
		languages: [row("en", "source"), row("fr"), row("ur", "supported", "rtl")],
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello" } },
			fr: { "ui.demo": { "ui.demo.hello": "Bonjour" } },
		},
	});
	const result = checkCoverage(tree);
	assert.equal(result.newKeys.length, 1);
	assert.equal(result.newKeys[0].locale, "ur");
});

test("an unlisted locale directory fails", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello" } },
			fr: { "ui.demo": { "ui.demo.hello": "Bonjour" } },
			de: { "ui.demo": { hello: "Hallo" } },
		},
	});
	const result = checkCoverage(tree);
	assert.deepEqual(result.unlistedLocales, ["de"]);
	assert.equal(failureCount(result), 1);
});

test("an allowance row naming an unknown locale is a phantom", () => {
	const tree = build({
		allowance: [
			{ locale: "de", namespace: "ui.demo", missing: ["ui.demo.hello"] },
		],
	});
	const result = checkCoverage(tree);
	assert.equal(result.phantoms.length, 1);
	assert.match(result.phantoms[0], UNKNOWN_LOCALE);
});

test("an allowance row naming an unknown namespace is a phantom", () => {
	const tree = build({
		allowance: [
			{ locale: "fr", namespace: "ui.ghost", missing: ["ui.ghost.x"] },
		],
	});
	const result = checkCoverage(tree);
	assert.equal(result.phantoms.length, 1);
	assert.match(result.phantoms[0], UNKNOWN_NAMESPACE);
});

test("an allowance row naming the source locale is a phantom", () => {
	const tree = build({
		allowance: [
			{ locale: "en", namespace: "ui.demo", missing: ["ui.demo.hello"] },
		],
	});
	const result = checkCoverage(tree);
	assert.equal(result.phantoms.length, 1);
	assert.match(result.phantoms[0], SOURCE_LOCALE_ROW);
});

test("a duplicate allowance pair fails", () => {
	const tree = build({
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello" } },
			fr: {},
		},
		allowance: [
			{ locale: "fr", namespace: "ui.demo", missing: ["ui.demo.hello"] },
			{ locale: "fr", namespace: "ui.demo", missing: ["ui.demo.hello"] },
		],
	});
	const result = checkCoverage(tree);
	assert.equal(result.allowanceProblems.length, 1);
	assert.match(result.allowanceProblems[0], DUPLICATE_PAIR);
});

test("an allowance row needs a reason, an owner and a payoff", () => {
	for (const field of ["reason", "owner", "payoff"]) {
		const tree = build({
			locales: {
				en: { "ui.demo": { "ui.demo.hello": "Hello" } },
				fr: {},
			},
			allowance: [
				{ locale: "fr", namespace: "ui.demo", missing: ["ui.demo.hello"] },
			],
		});
		const saved = JSON.parse(readFileSync(tree.allowancePath, "utf8"));
		saved.pairs[0][field] = "  ";
		writeFileSync(tree.allowancePath, `${JSON.stringify(saved, null, "\t")}\n`);
		const result = checkCoverage(tree);
		assert.ok(
			result.allowanceProblems.some((problem) =>
				problem.includes(`.${field} must be a non-empty string`),
			),
			`${field} should be required`,
		);
	}
});

test("an empty, unsorted, duplicate or out-of-namespace key list fails", () => {
	const cases = [
		{ missing: [], expected: NO_MISSING_KEYS },
		{ missing: ["ui.demo.hello", "ui.demo.bye"], expected: UNSORTED_KEYS },
		{ missing: ["ui.demo.bye", "ui.demo.bye"], expected: DUPLICATE_KEYS },
		{ missing: ["ui.other.key"], expected: OUTSIDE_NAMESPACE },
	];
	for (const { missing, expected } of cases) {
		const tree = build({
			locales: {
				en: { "ui.demo": { "ui.demo.hello": "Hello", "ui.demo.bye": "Bye" } },
				fr: {},
			},
			allowance: [{ locale: "fr", namespace: "ui.demo", missing }],
		});
		const result = checkCoverage(tree);
		assert.ok(
			result.allowanceProblems.some((problem) => expected.test(problem)),
			`${JSON.stringify(missing)} should fail with ${expected}`,
		);
	}
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

test("a corrupt target catalogue fails loudly instead of reading as a gap", () => {
	const tree = build();
	writeFileSync(join(tree.cataloguesDir, "fr", "ui.demo.json"), "{");
	assert.throws(() => checkCoverage(tree), INVALID_JSON);
});

test("an unknown status fails", () => {
	const tree = build({ languages: [row("en", "source"), row("fr", "beta")] });
	const result = checkCoverage(tree);
	assert.ok(result.problems.some((problem) => problem.includes("not one of")));
	assert.equal(failureCount(result), 1);
});

test("a manifest without exactly one source fails", () => {
	const tree = build({
		languages: [row("en", "supported"), row("fr")],
	});
	const result = checkCoverage(tree);
	assert.ok(result.problems.some((problem) => problem.includes("exactly one")));
});

test("allowance growth names every added pair and key", () => {
	const base = {
		schema: 1,
		pairs: [{ locale: "fr", namespace: "ui.demo", missing: ["ui.demo.bye"] }],
	};
	const head = {
		schema: 1,
		pairs: [
			{
				locale: "fr",
				namespace: "ui.demo",
				missing: ["ui.demo.bye", "ui.demo.hello"],
			},
			{ locale: "ur", namespace: "ui.demo", missing: ["ui.demo.bye"] },
		],
	};
	assert.deepEqual(allowanceGrowth(base, head), [
		{ locale: "fr", namespace: "ui.demo", key: "ui.demo.hello" },
		{ locale: "ur", namespace: "ui.demo", key: "ui.demo.bye" },
	]);
});

test("allowance shrinkage is not growth", () => {
	const base = {
		schema: 1,
		pairs: [
			{
				locale: "fr",
				namespace: "ui.demo",
				missing: ["ui.demo.bye", "ui.demo.hello"],
			},
		],
	};
	const head = {
		schema: 1,
		pairs: [{ locale: "fr", namespace: "ui.demo", missing: ["ui.demo.hello"] }],
	};
	assert.deepEqual(allowanceGrowth(base, head), []);
});
