#!/usr/bin/env node
/**
 * LANGUAGE COVERAGE — the gate that makes `i18n/languages.json` a promise.
 *
 * WHY THIS EXISTS. The manifest lists the languages the app commits to, and a
 * feature is not done until its copy exists in every shipped one. Without a
 * check that sentence is a convention: a locale can silently fall behind when a
 * namespace is added, because the runtime falls back to English per key and
 * nothing on screen looks broken. `locale-parity.test.mjs` compares locale to
 * English inside a namespace that exists on both sides; it cannot see a
 * namespace that was never created for a locale. `ledger-check.mjs` covers
 * audited pairs but derives its locale set from directories, so it reasons from
 * what is present rather than from what was promised. This check reasons from
 * the manifest: every language the app ships must carry every English key.
 *
 * WHAT IT ENFORCES:
 *
 *  1. the manifest is well formed — required fields, unique codes, known
 *     statuses and directions, exactly one `source` row for English;
 *  2. every locale directory under `src/i18n/catalogues/` is listed in the
 *     manifest (an unlisted locale would escape the gate);
 *  3. every `supported` language carries every key of every populated English
 *     namespace;
 *  4. the allowance is honest and SHRINK-ONLY: a listed pair that is now
 *     complete (or names an unknown locale/namespace or a duplicate) fails,
 *     and `--update` can only remove rows, never add them.
 *
 * THE ALLOWANCE. The repo is not complete the day this lands — the six
 * translated locales carry 55 to 57 of the 59 namespaces, and Urdu has no
 * catalogue at all — so the known gaps live in
 * `i18n/coverage-allowance.json`, one `(locale, namespace)` pair each with a
 * short reason. A gap not listed fails. This mirrors `context-parity.mjs`'s
 * allowance shape and its rule that a phantom entry is a failure, with one
 * deliberate difference: a now-covered pair FAILS rather than merely printing
 * a note. A pair that has stopped being a gap is an allowance that rotted, and
 * this gate makes shrinking the only permitted direction.
 *
 * THE MANIFEST IS SHARED WITH CORE. `i18n/languages.json` is byte-identical to
 * the core repository's copy, so an agent reading either sees one list. Core's
 * `tests/unit/i18n/test_language_manifest.py` is the same gate in Python; this
 * file is the UI's implementation of it.
 *
 * USAGE:
 *   node scripts/i18n/check-coverage.mjs            # check; exit 1 on any failure
 *   node scripts/i18n/check-coverage.mjs --update   # drop pairs that are now complete
 *   node scripts/i18n/check-coverage.mjs --list     # print the current allowance
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CATALOGUES = join(REPO, "src", "i18n", "catalogues");
export const MANIFEST = join(REPO, "i18n", "languages.json");
export const ALLOWANCE = join(REPO, "i18n", "coverage-allowance.json");
export const SOURCE_LOCALE = "en";

const STATUSES = new Set(["source", "supported"]);
const DIRECTIONS = new Set(["ltr", "rtl"]);
/** Target languages whose catalogue must be complete. `source` is the reference. */
const GATED_STATUSES = new Set(["supported"]);
const FIELDS = ["code", "native", "english", "dir", "status"];

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

/** English namespace names, sidecars excluded — the keys every locale owes. */
export function catalogueNamespaces(cataloguesDir = CATALOGUES) {
	const dir = join(cataloguesDir, SOURCE_LOCALE);
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".context.json"))
		.map((name) => name.slice(0, -".json".length))
		.sort();
}

/** Directory names under the catalogue root — a directory is bundled bytes. */
function catalogueLocales(cataloguesDir = CATALOGUES) {
	return readdirSync(cataloguesDir)
		.filter((name) => statSync(join(cataloguesDir, name)).isDirectory())
		.sort();
}

function localeNamespaces(locale, cataloguesDir = CATALOGUES) {
	try {
		return new Set(
			readdirSync(join(cataloguesDir, locale))
				.filter(
					(name) => name.endsWith(".json") && !name.endsWith(".context.json"),
				)
				.map((name) => name.slice(0, -".json".length)),
		);
	} catch {
		return new Set();
	}
}

/**
 * Shape validation for the manifest. Returns human-readable problems rather
 * than throwing, so the caller can report every one in a single run.
 */
export function manifestProblems(manifest) {
	const problems = [];
	if (manifest.schema !== 1) problems.push("`schema` must be 1");
	if (typeof manifest.note !== "string" || manifest.note.length === 0)
		problems.push("`note` must say what the manifest promises");
	if (!Array.isArray(manifest.languages) || manifest.languages.length === 0) {
		problems.push("`languages` must be a non-empty array");
		return problems;
	}
	const seen = new Set();
	for (const [index, row] of manifest.languages.entries()) {
		const where = `languages[${index}]`;
		if (row === null || typeof row !== "object" || Array.isArray(row)) {
			problems.push(`${where} must be an object`);
			continue;
		}
		for (const field of FIELDS) {
			if (typeof row[field] !== "string" || row[field].length === 0)
				problems.push(`${where}.${field} must be a non-empty string`);
		}
		const extra = Object.keys(row).filter((field) => !FIELDS.includes(field));
		if (extra.length > 0)
			problems.push(`${where} has unknown field(s): ${extra.join(", ")}`);
		if (typeof row.code === "string") {
			if (seen.has(row.code))
				problems.push(`${where}.code ${row.code} is duplicated`);
			seen.add(row.code);
		}
		if (typeof row.status === "string" && !STATUSES.has(row.status))
			problems.push(
				`${where}.status ${JSON.stringify(row.status)} is not one of ${[...STATUSES].join(", ")}`,
			);
		if (typeof row.dir === "string" && !DIRECTIONS.has(row.dir))
			problems.push(
				`${where}.dir ${JSON.stringify(row.dir)} is not one of ${[...DIRECTIONS].join(", ")}`,
			);
	}
	const sources = manifest.languages.filter((row) => row?.status === "source");
	if (sources.length !== 1)
		problems.push(
			`exactly one language must have status "source", found ${sources.length}`,
		);
	else if (sources[0]?.code !== SOURCE_LOCALE)
		problems.push(`the source language must be ${SOURCE_LOCALE}`);
	if (manifest.source !== undefined && manifest.source !== SOURCE_LOCALE)
		problems.push(`\`source\`, when present, must be ${SOURCE_LOCALE}`);
	return problems;
}

/** English keys absent from one locale's namespace file. */
export function missingKeys(locale, namespace, cataloguesDir = CATALOGUES) {
	const source = readJson(
		join(cataloguesDir, SOURCE_LOCALE, `${namespace}.json`),
	);
	let target = {};
	try {
		target = readJson(join(cataloguesDir, locale, `${namespace}.json`));
	} catch {
		// An absent file is every key missing, not an error: the pair is the
		// allowance unit, and the message below reports the count.
	}
	const targetKeys = new Set(Object.keys(target));
	return Object.keys(source).filter((key) => !targetKeys.has(key));
}

/**
 * Compare the tree against the manifest and allowance. Returns every failure
 * class separately so `--update` and the checker can act on distinct halves.
 */
export function checkCoverage({
	cataloguesDir = CATALOGUES,
	manifestPath = MANIFEST,
	allowancePath = ALLOWANCE,
} = {}) {
	const manifest = readJson(manifestPath);
	const allowance = readJson(allowancePath);
	const problems = manifestProblems(manifest);
	const languages = Array.isArray(manifest.languages) ? manifest.languages : [];

	const gated = languages.filter((row) => GATED_STATUSES.has(row?.status));
	const byCode = new Map(languages.map((row) => [row?.code, row]));
	const namespaces = catalogueNamespaces(cataloguesDir);
	const localesOnDisk = catalogueLocales(cataloguesDir);

	const unlistedLocales = localesOnDisk.filter((locale) => !byCode.has(locale));

	// pairs is a flat list: key is `${locale}\0${namespace}`.
	const allowed = new Map();
	const allowanceProblems = [];
	if (allowance.schema !== 1) allowanceProblems.push("`schema` must be 1");
	if (!Array.isArray(allowance.pairs)) {
		allowanceProblems.push("`pairs` must be an array");
	} else {
		for (const [index, pair] of allowance.pairs.entries()) {
			const where = `pairs[${index}]`;
			if (pair === null || typeof pair !== "object" || Array.isArray(pair)) {
				allowanceProblems.push(`${where} must be an object`);
				continue;
			}
			if (
				typeof pair.locale !== "string" ||
				typeof pair.namespace !== "string"
			) {
				allowanceProblems.push(
					`${where} needs string \`locale\` and \`namespace\``,
				);
				continue;
			}
			if (typeof pair.reason !== "string" || pair.reason.trim().length === 0)
				allowanceProblems.push(
					`${where} (${pair.locale}/${pair.namespace}) needs a reason`,
				);
			const key = `${pair.locale}\0${pair.namespace}`;
			if (allowed.has(key)) {
				allowanceProblems.push(
					`${where} duplicates ${pair.locale}/${pair.namespace}`,
				);
				continue;
			}
			allowed.set(key, pair);
		}
	}

	const missing = new Map(); // pair key -> { locale, namespace, keys }
	const extraNamespaces = [];
	for (const row of gated) {
		const present = localeNamespaces(row.code, cataloguesDir);
		for (const namespace of namespaces) {
			const keys = missingKeys(row.code, namespace, cataloguesDir);
			if (keys.length > 0)
				missing.set(`${row.code}\0${namespace}`, {
					locale: row.code,
					namespace,
					keys,
				});
		}
		// A namespace this locale carries that English does not is outside this
		// gate's question (missing copy), but it means the locale is ahead of the
		// source and should be resolved rather than silently kept.
		for (const namespace of present) {
			if (!namespaces.includes(namespace))
				extraNamespaces.push(
					`${row.code} carries ${namespace}, which has no English namespace`,
				);
		}
	}

	const newGaps = [...missing.values()].filter(
		(pair) => !allowed.has(`${pair.locale}\0${pair.namespace}`),
	);
	const stale = [];
	const phantoms = [];
	for (const pair of allowed.values()) {
		const key = `${pair.locale}\0${pair.namespace}`;
		if (!byCode.has(pair.locale)) {
			phantoms.push(
				`${pair.locale}/${pair.namespace} — locale is not in the manifest`,
			);
		} else if (!GATED_STATUSES.has(byCode.get(pair.locale)?.status)) {
			phantoms.push(
				`${pair.locale}/${pair.namespace} — ${pair.locale} is not a gated target language`,
			);
		} else if (!namespaces.includes(pair.namespace)) {
			phantoms.push(
				`${pair.locale}/${pair.namespace} — English has no such namespace`,
			);
		} else if (!missing.has(key)) {
			stale.push(pair);
		}
	}

	return {
		manifest,
		allowance,
		problems,
		allowanceProblems,
		extraNamespaces,
		unlistedLocales,
		newGaps,
		stale,
		phantoms,
		missing,
		gated,
		namespaces,
	};
}

/** Remove now-complete pairs. Only a filter runs over `pairs`; nothing is added. */
export function applyUpdate({
	cataloguesDir = CATALOGUES,
	manifestPath = MANIFEST,
	allowancePath = ALLOWANCE,
} = {}) {
	const { stale, allowance } = checkCoverage({
		cataloguesDir,
		manifestPath,
		allowancePath,
	});
	if (stale.length === 0) {
		process.stdout.write(
			"coverage-check: nothing to lower — every allowance pair is still missing at least one key.\n",
		);
		return 0;
	}
	const drop = new Set(
		stale.map((pair) => `${pair.locale}\0${pair.namespace}`),
	);
	allowance.pairs = allowance.pairs.filter(
		(pair) => !drop.has(`${pair.locale}\0${pair.namespace}`),
	);
	writeFileSync(allowancePath, `${JSON.stringify(allowance, null, "\t")}\n`);
	process.stdout.write(
		`coverage-check: lowered the allowance by ${stale.length} pair(s). It never raises; translate the gap instead.\n`,
	);
	return 0;
}

function formatPair(pair) {
	return `${pair.locale}/${pair.namespace} (${pair.keys.length} key(s) missing)`;
}

export function main(argv, options = {}) {
	let mode = "check";
	for (const arg of argv) {
		if (arg === "--update") mode = "update";
		else if (arg === "--list") mode = "list";
		else if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"usage: node scripts/i18n/check-coverage.mjs [--update | --list]\n",
			);
			return 0;
		} else {
			process.stderr.write(`check-coverage.mjs: unknown argument ${arg}\n`);
			return 2;
		}
	}

	if (mode === "list") {
		const { allowance } = checkCoverage(options);
		for (const pair of allowance.pairs ?? [])
			process.stdout.write(
				`${pair.locale}/${pair.namespace}: ${pair.reason}\n`,
			);
		return 0;
	}
	if (mode === "update") return applyUpdate(options);

	const result = checkCoverage(options);
	const totalGaps = result.missing.size;
	const gatedCount = result.gated.length;
	const failures =
		result.problems.length +
		result.allowanceProblems.length +
		result.extraNamespaces.length +
		result.unlistedLocales.length +
		result.newGaps.length +
		result.stale.length +
		result.phantoms.length;

	if (failures === 0) {
		process.stdout.write(
			`coverage-check: ok — ${gatedCount} gated language(s) over ${result.namespaces.length} namespace(s); ${totalGaps} known gap(s) remain allowed (shrink-only; see i18n/coverage-allowance.json).\n`,
		);
		return 0;
	}

	for (const problem of result.problems)
		process.stderr.write(`coverage-check: manifest — ${problem}\n`);
	for (const problem of result.allowanceProblems)
		process.stderr.write(`coverage-check: allowance — ${problem}\n`);
	for (const problem of result.extraNamespaces)
		process.stderr.write(
			`coverage-check: locale ahead of source — ${problem}\n`,
		);
	for (const locale of result.unlistedLocales)
		process.stderr.write(
			`coverage-check: ${locale} has a catalogue directory but no i18n/languages.json row — an unlisted locale escapes the gate.\n`,
		);
	if (result.newGaps.length > 0) {
		process.stderr.write(
			`coverage-check: ${result.newGaps.length} (locale, namespace) pair(s) are missing English keys and are not allowed:\n${result.newGaps.map((pair) => `  ${formatPair(pair)}`).join("\n")}\n  Translate the namespace for that locale. Do not add an allowance row for new copy.\n`,
		);
	}
	if (result.stale.length > 0) {
		process.stderr.write(
			`coverage-check: ${result.stale.length} allowance pair(s) are now complete — the allowance must shrink, never rot:\n${result.stale.map((pair) => `  ${pair.locale}/${pair.namespace}`).join("\n")}\n  Run \`--update\` to drop them.\n`,
		);
	}
	if (result.phantoms.length > 0) {
		process.stderr.write(
			`coverage-check: ${result.phantoms.length} allowance pair(s) name nothing this gate can allow:\n${result.phantoms.map((line) => `  ${line}`).join("\n")}\n  Remove them by hand; \`--update\` will not.\n`,
		);
	}
	return 1;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
	process.exit(main(process.argv.slice(2)));
}
