import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
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
const NO_NAMESPACES = /carries no namespace catalogue/;
const NO_SOURCE_KEYS = /carries no keys at all/;
const TRUNCATED_SOURCE = /the source was truncated/;
const UNRECORDED_EMPTY = /no audited entry/;
const EMPTIED_AFTER_AUDIT = /emptied after it was audited/;
const NO_TARGET = /no language has status "supported"/;
const BAD_PAYOFF = /is not a payoff/;

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

/** Byte hash, the convention `i18n/ledger.json` records. */
function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The ledger entries a fixture's own bytes would produce, one per translated
 * (locale, namespace) file. Deriving them keeps the fixture honest to the real
 * tree, where an audited-empty namespace carries the hash of its empty file:
 * a test that wants an UNRECORDED or STALE entry overrides or edits it.
 */
function deriveLedger(cataloguesDir, locales) {
	const entries = [];
	for (const locale of Object.keys(locales)) {
		if (locale === "en") continue;
		for (const namespace of Object.keys(locales[locale] ?? {})) {
			const source = join(cataloguesDir, "en", `${namespace}.json`);
			const target = join(cataloguesDir, locale, `${namespace}.json`);
			if (!existsSync(source) || !existsSync(target)) continue;
			entries.push({
				locale,
				namespace,
				source_sha256: sha256File(source),
				target_sha256: sha256File(target),
			});
		}
	}
	return entries;
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
	ledger,
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
	const ledgerPath = join(root, "ledger.json");
	writeFileSync(
		ledgerPath,
		`${JSON.stringify(
			{
				schema: 1,
				note: "fixture",
				entries: ledger ?? deriveLedger(cataloguesDir, locales),
			},
			null,
			"\t",
		)}\n`,
	);
	return { cataloguesDir, manifestPath, allowancePath, ledgerPath };
}

test("an English source with no namespace fails instead of covering nothing", () => {
	const tree = build({ locales: { en: {}, fr: {} } });
	const result = checkCoverage(tree);
	assert.deepEqual(result.sourceProblems.length, 1);
	assert.match(result.sourceProblems[0], NO_NAMESPACES);
	assert.equal(main([], tree), 1);
});

test("an English source with no keys anywhere fails", () => {
	// The reviewer's `{}`-everywhere control: every namespace exists and every
	// object is empty, so every locale trivially covers every namespace.
	const tree = build({
		locales: { en: { "ui.demo": {} }, fr: { "ui.demo": {} } },
	});
	const result = checkCoverage(tree);
	assert.ok(
		result.sourceProblems.some((problem) => NO_SOURCE_KEYS.test(problem)),
	);
	assert.equal(main([], tree), 1);
});

test("an empty namespace recorded audited-empty in the ledger passes", () => {
	// `ui.agents` in the real tree: `{}` in all eight catalogues, no copy of its
	// own, audited-empty in i18n/ledger.json. The ledger record is what makes the
	// empty state legitimate rather than silent.
	const tree = build({
		locales: {
			en: { "ui.demo": { "ui.demo.hello": "Hello" }, "ui.placeholder": {} },
			fr: { "ui.demo": { "ui.demo.hello": "Bonjour" }, "ui.placeholder": {} },
		},
	});
	assert.equal(failureCount(checkCoverage(tree)), 0);
});

test("an empty namespace with no ledger record fails closed", () => {
	const tree = build();
	// Born empty: written after the ledger, so no audit ever recorded it.
	writeFileSync(join(tree.cataloguesDir, "en", "ui.new.json"), "{}\n");
	writeFileSync(join(tree.cataloguesDir, "fr", "ui.new.json"), "{}\n");
	const result = checkCoverage(tree);
	assert.ok(
		result.sourceProblems.some((problem) => UNRECORDED_EMPTY.test(problem)),
	);
	assert.equal(main([], tree), 1);
});

test("an English namespace emptied while a locale carries it fails", () => {
	const tree = build();
	writeFileSync(join(tree.cataloguesDir, "en", "ui.demo.json"), "{}\n");
	const result = checkCoverage(tree);
	assert.ok(
		result.sourceProblems.some((problem) => TRUNCATED_SOURCE.test(problem)),
	);
	assert.equal(main([], tree), 1);
});

test("an English namespace emptied after its audit fails even when the locale is emptied too", () => {
	const tree = build();
	writeFileSync(join(tree.cataloguesDir, "en", "ui.demo.json"), "{}\n");
	writeFileSync(join(tree.cataloguesDir, "fr", "ui.demo.json"), "{}\n");
	const result = checkCoverage(tree);
	assert.ok(
		result.sourceProblems.some((problem) => EMPTIED_AFTER_AUDIT.test(problem)),
	);
	assert.equal(main([], tree), 1);
});

test("a manifest with no supported target fails instead of gating nothing", () => {
	const tree = build({
		languages: [row("en", "source")],
		locales: { en: { "ui.demo": { "ui.demo.hello": "Hello" } } },
	});
	const result = checkCoverage(tree);
	assert.ok(result.problems.some((problem) => NO_TARGET.test(problem)));
	assert.equal(main([], tree), 1);
});

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

test("a payoff must be a real ISO date or a ticket reference", () => {
	const locales = {
		en: { "ui.demo": { "ui.demo.hello": "Hello" } },
		fr: {},
	};
	const allowanceFor = (payoff) => [
		{ locale: "fr", namespace: "ui.demo", missing: ["ui.demo.hello"], payoff },
	];
	// Shape-only checks are not enough: `2026-02-30` is the right shape and no
	// date, and prose reads as attributed while naming nothing anyone can chase.
	for (const payoff of [
		"eventually",
		"soon",
		"2026-02-30",
		"2026-13-01",
		"MIN",
		"min-1234",
		" 2026-12-31",
	]) {
		const tree = build({ locales, allowance: allowanceFor(payoff) });
		const result = checkCoverage(tree);
		assert.ok(
			result.allowanceProblems.some((problem) => BAD_PAYOFF.test(problem)),
			`${JSON.stringify(payoff)} should fail the payoff contract`,
		);
		assert.equal(main([], tree), 1);
	}
	for (const payoff of ["2026-12-31", "MIN-1234"]) {
		const tree = build({ locales, allowance: allowanceFor(payoff) });
		assert.equal(
			failureCount(checkCoverage(tree)),
			0,
			`${payoff} should satisfy the payoff contract`,
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
	const tree = build({
		languages: [row("en", "source"), row("fr"), row("de", "beta")],
	});
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
