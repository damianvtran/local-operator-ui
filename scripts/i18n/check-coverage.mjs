#!/usr/bin/env node
/**
 * LANGUAGE COVERAGE — the gate that makes `i18n/languages.json` a promise.
 *
 * WHY THIS EXISTS. The manifest lists the languages the app commits to, and a
 * feature is not done until its copy exists in every shipped one. Without a
 * check that sentence is a convention: a locale can silently fall behind when a
 * key is added, because the runtime falls back to English per key and nothing
 * on screen looks broken. `locale-parity.test.mjs` compares locale to English
 * inside a namespace that exists on both sides; it cannot see a key that was
 * never added to a locale. `ledger-check.mjs` covers audited pairs but derives
 * its locale set from directories, so it reasons from what is present rather
 * than from what was promised. This check reasons from the manifest: every
 * language the app ships must carry every English key.
 *
 * WHAT IT ENFORCES:
 *
 *  1. the manifest is well formed — exact fields, unique codes, known statuses
 *     and directions, exactly one `source` row for English, and at least one
 *     `supported` target. A manifest with nothing to compare against is not a
 *     clean gate, it is a disabled one, so it fails rather than printing an
 *     "ok" over zero target languages;
 *  2. every locale directory under `src/i18n/catalogues/` is listed in the
 *     manifest (an unlisted locale would escape the gate);
 *  3. the English source carries at least one namespace, and at least one key;
 *     an English namespace with no keys is a broken source, not full coverage
 *     (every locale trivially "covers" it), unless the audited
 *     `i18n/ledger.json` records that exact empty source — the record the
 *     ledger check already reviews. A namespace that is empty in every locale
 *     without that record fails, so a newly added or newly emptied empty
 *     namespace cannot ride in;
 *  4. every `supported` language carries every key of every populated English
 *     namespace, compared KEY BY KEY;
 *  5. the allowance is exact and attributed: each `(locale, namespace)` entry
 *     lists the sorted, duplicate-free key IDs that locale is missing, plus a
 *     reason, an owner and a payoff. The payoff is checked against the contract
 *     `AGENTS.md` states — a real `YYYY-MM-DD` date or a tracker key such as
 *     `MIN-1234` — because a payoff nobody can look up ("eventually") is
 *     indistinguishable from no payoff at all. An empty list, a duplicate pair
 *     or key, an unsorted list, a key outside the namespace, a missing or
 *     unparseable attribution or a key the namespace does not contain fails;
 *  6. the allowance is SHRINK-ONLY in both directions: a missing key not listed
 *     fails (including a new key added to an already-incomplete namespace),
 *     and a listed key that is no longer missing fails until `--update` drops
 *     it. `--update` can only remove keys, never add them;
 *  7. the allowance cannot GROW relative to a base ref: when
 *     `--allowance-base <ref>` (or the CI pull-request base, or `origin/main`)
 *     is available, every `(locale, namespace, key)` the head adds over the
 *     base is named. A base without the file is the introduction case and is
 *     skipped; an explicit ref that cannot be resolved fails.
 *
 * WHY KEY-LEVEL. A pair-level allowance is the same blind spot this gate exists
 * to close: once a namespace is allowed, a new untranslated key inside it
 * passes silently, which is precisely the "all future copy is translated"
 * requirement failing open. The entry therefore records the exact key set.
 *
 * THE MANIFEST IS SHARED WITH CORE. `i18n/languages.json` is byte-identical to
 * the core repository's copy, so an agent reading either sees one list. Core's
 * `tests/unit/i18n/test_language_manifest.py` is the same gate in Python; this
 * file is the UI's implementation of it, and the allowance schema mirrors the
 * core one (`missing`, `owner`, `payoff`).
 *
 * USAGE:
 *   node scripts/i18n/check-coverage.mjs            # check; exit 1 on any failure
 *   node scripts/i18n/check-coverage.mjs --update   # drop keys that are no longer missing
 *   node scripts/i18n/check-coverage.mjs --list     # print the current allowance
 *   node scripts/i18n/check-coverage.mjs --allowance-base <ref>
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CATALOGUES = join(REPO, "src", "i18n", "catalogues");
export const MANIFEST = join(REPO, "i18n", "languages.json");
export const ALLOWANCE = join(REPO, "i18n", "coverage-allowance.json");
/**
 * The audited translation ledger. Read here only to answer ONE question: is an
 * English-empty namespace a recorded, reviewed placeholder, or a namespace that
 * lost its keys after it was audited? See `sourceProblems` in `checkCoverage`.
 */
export const LEDGER = join(REPO, "i18n", "ledger.json");
export const SOURCE_LOCALE = "en";

const STATUSES = new Set(["source", "supported"]);
const DIRECTIONS = new Set(["ltr", "rtl"]);
/** Target languages whose catalogue must be complete. `source` is the reference. */
const GATED_STATUSES = new Set(["supported"]);
const FIELDS = ["code", "native", "english", "dir", "status"];
/**
 * The payoff contract, enforced rather than documented.
 *
 * `AGENTS.md` and the allowance's own note say the payoff is a ticket or an ISO
 * date; checking only "non-empty string" accepts "eventually", which reads as
 * attributed while carrying no plan. The date is parsed as a REAL calendar
 * date, so `2026-02-30` cannot pass a shape-only test.
 *
 * The ticket form is an uppercase tracker key (`MIN-1234`): the repositories in
 * this workspace use `<PREFIX>-<number>` identifiers, and accepting arbitrary
 * prose would reopen the hole this closes.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKET_RE = /^[A-Z][A-Z0-9]*-\d+$/;

/** Mirrors the core checker's allowance fields exactly. */
const ALLOWANCE_FIELDS = [
	"locale",
	"namespace",
	"reason",
	"owner",
	"payoff",
	"missing",
];

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

/** Byte hash, the same convention `scripts/i18n/ledger-check.mjs` verifies. */
function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Whether a value satisfies the payoff contract (see `ISO_DATE_RE`). */
export function isPayoff(value) {
	if (typeof value !== "string") return false;
	if (ISO_DATE_RE.test(value)) {
		const parsed = new Date(`${value}T00:00:00Z`);
		// A real calendar date, not just its shape: `2026-02-30` parses to 2 March
		// and `2026-13-01` does not parse at all.
		return (
			!Number.isNaN(parsed.valueOf()) &&
			parsed.toISOString().slice(0, "YYYY-MM-DD".length) === value
		);
	}
	return TICKET_RE.test(value);
}

/** English namespace names, sidecars excluded — the keys every locale owes. */
export function catalogueNamespaces(cataloguesDir = CATALOGUES) {
	const dir = join(cataloguesDir, SOURCE_LOCALE);
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".context.json"))
		.map((name) => name.slice(0, -".json".length))
		.sort();
}

/** Directory names under the catalogue root — every bundled locale must be listed. */
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
	// A source with no target compares English to nothing and reports "ok — 0
	// gated language(s)". Refusing that is what keeps the gate a gate; it does
	// not freeze WHICH languages are supported.
	const targets = manifest.languages.filter((row) =>
		GATED_STATUSES.has(row?.status),
	);
	if (targets.length === 0)
		problems.push(
			`no language has status "supported": a gate with no target language has nothing to compare and cannot report success`,
		);
	if (manifest.source !== undefined && manifest.source !== SOURCE_LOCALE)
		problems.push(`\`source\`, when present, must be ${SOURCE_LOCALE}`);
	return problems;
}

/** English keys absent from one locale's namespace file, sorted. */
export function missingKeys(locale, namespace, cataloguesDir = CATALOGUES) {
	const source = readJson(
		join(cataloguesDir, SOURCE_LOCALE, `${namespace}.json`),
	);
	const targetPath = join(cataloguesDir, locale, `${namespace}.json`);
	// An absent file is every key missing, but a PRESENT file that does not parse
	// must throw: silently treating corruption as a coverage gap would let an
	// allowed pair hide a broken catalogue.
	const target = existsSync(targetPath) ? readJson(targetPath) : {};
	const targetKeys = new Set(Object.keys(target));
	return Object.keys(source)
		.filter((key) => !targetKeys.has(key))
		.sort();
}

function pairKey(locale, namespace) {
	return `${locale}\0${namespace}`;
}

/**
 * The allowance as `(locale, namespace) -> Set(missing key IDs)`, plus every
 * shape problem found while reading it.
 *
 * The key list is the whole point of an entry: a pair-level allowance would
 * silently admit a new English key added to an already-incomplete namespace.
 * Entries are sorted, duplicate-free and namespace scoped so the file stays
 * reviewable and a key cannot be smuggled into the wrong pair.
 */
export function validateAllowance(allowance) {
	const problems = [];
	const allowed = new Map();
	if (
		allowance === null ||
		typeof allowance !== "object" ||
		Array.isArray(allowance)
	) {
		return { allowed, problems: ["allowance must be an object"] };
	}
	if (allowance.schema !== 1) problems.push("`schema` must be 1");
	if (!Array.isArray(allowance.pairs)) {
		problems.push("`pairs` must be an array");
		return { allowed, problems };
	}
	for (const [index, entry] of allowance.pairs.entries()) {
		const where = `pairs[${index}]`;
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			problems.push(`${where} must be an object`);
			continue;
		}
		const missingFields = ALLOWANCE_FIELDS.filter((field) => !(field in entry));
		const extraFields = Object.keys(entry).filter(
			(field) => !ALLOWANCE_FIELDS.includes(field),
		);
		if (missingFields.length > 0)
			problems.push(
				`${where} is missing field(s): ${missingFields.join(", ")}`,
			);
		if (extraFields.length > 0)
			problems.push(`${where} has unknown field(s): ${extraFields.join(", ")}`);
		for (const field of ["locale", "namespace", "reason", "owner"]) {
			if (typeof entry[field] !== "string" || entry[field].trim().length === 0)
				problems.push(`${where}.${field} must be a non-empty string`);
		}
		if (!isPayoff(entry.payoff))
			problems.push(
				`${where}.payoff ${JSON.stringify(entry.payoff) ?? "undefined"} is not a payoff: use an ISO date (YYYY-MM-DD) or a ticket reference such as MIN-1234`,
			);
		const locale = entry.locale;
		const namespace = entry.namespace;
		if (typeof locale !== "string" || typeof namespace !== "string") continue;
		const key = pairKey(locale, namespace);
		if (allowed.has(key)) {
			problems.push(`${where} duplicates ${locale}/${namespace}`);
			continue;
		}
		const missing = entry.missing;
		let keysValid = true;
		if (!Array.isArray(missing)) {
			problems.push(`${where}.missing must be an array`);
			keysValid = false;
		} else {
			if (missing.length === 0) {
				problems.push(
					`${where} (${locale}/${namespace}) has no missing keys; remove the complete entry`,
				);
				keysValid = false;
			}
			for (const missingKey of missing) {
				if (typeof missingKey !== "string" || missingKey.length === 0) {
					problems.push(`${where}.missing has a non-string or empty key`);
					keysValid = false;
				}
			}
			if (keysValid) {
				if (new Set(missing).size !== missing.length) {
					problems.push(`${where}.missing has duplicate keys`);
					keysValid = false;
				}
				const sorted = [...missing].sort();
				if (sorted.some((missingKey, at) => missingKey !== missing[at])) {
					problems.push(`${where}.missing is not sorted`);
					keysValid = false;
				}
				const outside = missing.filter(
					(missingKey) => !missingKey.startsWith(`${namespace}.`),
				);
				if (outside.length > 0)
					problems.push(
						`${where}.missing lists key(s) outside ${namespace}: ${outside.join(", ")}`,
					);
			}
		}
		if (keysValid)
			allowed.set(key, { locale, namespace, missing: new Set(missing) });
	}
	return { allowed, problems };
}

/**
 * Compare the tree against the manifest and allowance. Returns every failure
 * class separately so `--update` and the checker can act on distinct halves.
 * Allowance GROWTH is checked in `main`, because it needs git and a base ref.
 */
export function checkCoverage({
	cataloguesDir = CATALOGUES,
	manifestPath = MANIFEST,
	allowancePath = ALLOWANCE,
	ledgerPath = LEDGER,
} = {}) {
	const manifest = readJson(manifestPath);
	const allowance = readJson(allowancePath);
	const problems = manifestProblems(manifest);
	const languages = Array.isArray(manifest.languages) ? manifest.languages : [];

	const gated = languages.filter((row) => GATED_STATUSES.has(row?.status));
	const byCode = new Map(languages.map((row) => [row?.code, row]));
	const namespaces = catalogueNamespaces(cataloguesDir);
	const localesOnDisk = catalogueLocales(cataloguesDir);

	/*
	 * An English source with nothing in it is a BROKEN source, not full coverage:
	 * `missingKeys` returns [] for a namespace with no source keys, so every
	 * locale trivially covers it and the gate prints "ok". Each shape fails:
	 *
	 *  - no namespace files at all (nothing to compare);
	 *  - no English keys anywhere (a green verdict over nothing);
	 *  - an English namespace emptied while a locale still carries its keys (the
	 *    source was truncated, so no remaining key can be reported missing).
	 *
	 * ONE namespace is legitimately empty in every locale today: `ui.agents` is
	 * `{}` in all eight catalogues, carries no copy of its own (its children are
	 * separate namespaces - `ui.agents.dialogs`, `.models`, `.settings`, ...)
	 * and was recorded audited-empty in `i18n/ledger.json` by the commit that
	 * introduced the i18n mechanism. THE LEDGER IS THE EXEMPTION, not a list in
	 * this file: a namespace born empty has no ledger entry and fails, and a
	 * namespace emptied after translation carries a stale `source_sha256` and
	 * fails, so there is no second place to keep in step with the tree.
	 */
	const sourceProblems = [];
	if (namespaces.length === 0)
		sourceProblems.push(
			"the English source carries no namespace catalogue, so there is nothing to compare and a clean verdict would be vacuous",
		);
	const ledger = existsSync(ledgerPath)
		? readJson(ledgerPath)
		: { entries: [] };
	const ledgerEntries = Array.isArray(ledger.entries) ? ledger.entries : [];
	const sourceKeyCount = (namespace) =>
		Object.keys(
			readJson(join(cataloguesDir, SOURCE_LOCALE, `${namespace}.json`)),
		).length;
	let totalSourceKeys = 0;
	for (const namespace of namespaces) {
		const keyCount = sourceKeyCount(namespace);
		totalSourceKeys += keyCount;
		if (keyCount > 0) continue;
		// A locale that has no file for this namespace carries none of its keys;
		// only the ones that do can prove the source was truncated.
		const carriers = localesOnDisk.filter((locale) => {
			const path = join(cataloguesDir, locale, `${namespace}.json`);
			return existsSync(path) && Object.keys(readJson(path)).length > 0;
		});
		if (carriers.length > 0) {
			sourceProblems.push(
				`English namespace ${namespace} carries no keys while ${carriers.join(", ")} still do: the source was truncated, not translated`,
			);
			continue;
		}
		const recorded = ledgerEntries.filter(
			(entry) => entry?.namespace === namespace,
		);
		if (recorded.length === 0) {
			sourceProblems.push(
				`English namespace ${namespace} carries no keys in any locale and i18n/ledger.json has no audited entry for it; an empty namespace must be recorded as an audited empty source, never added silently`,
			);
			continue;
		}
		const sourceHash = sha256File(
			join(cataloguesDir, SOURCE_LOCALE, `${namespace}.json`),
		);
		const stale = recorded.filter(
			(entry) => entry.source_sha256 !== sourceHash,
		);
		if (stale.length > 0)
			sourceProblems.push(
				`English namespace ${namespace} carries no keys and i18n/ledger.json records another source for ${stale.map((entry) => entry.locale).join(", ")}: it was emptied after it was audited`,
			);
	}
	if (namespaces.length > 0 && totalSourceKeys === 0)
		sourceProblems.push(
			"the English source carries no keys at all, so every locale trivially covers every namespace and a clean verdict would be vacuous",
		);

	const unlistedLocales = localesOnDisk.filter((locale) => !byCode.has(locale));

	const { allowed, problems: allowanceProblems } = validateAllowance(allowance);

	// Every actual gap, key by key.
	const missing = new Map(); // pair key -> { locale, namespace, keys }
	const extraNamespaces = [];
	for (const row of gated) {
		const present = localeNamespaces(row.code, cataloguesDir);
		for (const namespace of namespaces) {
			const keys = missingKeys(row.code, namespace, cataloguesDir);
			if (keys.length > 0)
				missing.set(pairKey(row.code, namespace), {
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

	// Keys missing that the allowance does not list. This is the discriminating
	// case: a new key inside an already-incomplete namespace lands here.
	const newKeys = [];
	for (const pair of missing.values()) {
		const allowedKeys =
			allowed.get(pairKey(pair.locale, pair.namespace))?.missing ?? new Set();
		for (const key of pair.keys) {
			if (!allowedKeys.has(key))
				newKeys.push({
					locale: pair.locale,
					namespace: pair.namespace,
					key,
				});
		}
	}

	// Listed keys that are no longer missing: the allowance must shrink.
	const staleKeys = [];
	const phantoms = [];
	for (const entry of allowed.values()) {
		const key = pairKey(entry.locale, entry.namespace);
		if (!byCode.has(entry.locale)) {
			phantoms.push(
				`${entry.locale}/${entry.namespace} — locale is not in the manifest`,
			);
			continue;
		}
		if (!GATED_STATUSES.has(byCode.get(entry.locale)?.status)) {
			phantoms.push(
				`${entry.locale}/${entry.namespace} — ${entry.locale} is not a gated target language`,
			);
			continue;
		}
		if (!namespaces.includes(entry.namespace)) {
			phantoms.push(
				`${entry.locale}/${entry.namespace} — English has no such namespace`,
			);
			continue;
		}
		const actual = new Set(missing.get(key)?.keys ?? []);
		for (const missingKey of entry.missing) {
			if (!actual.has(missingKey))
				staleKeys.push({
					locale: entry.locale,
					namespace: entry.namespace,
					key: missingKey,
				});
		}
	}

	return {
		manifest,
		allowance,
		problems,
		sourceProblems,
		allowanceProblems,
		extraNamespaces,
		unlistedLocales,
		newKeys,
		staleKeys,
		phantoms,
		missing,
		gated,
		namespaces,
	};
}

/** How many independent failure classes the check reported. */
export function failureCount(result) {
	return (
		result.problems.length +
		result.sourceProblems.length +
		result.allowanceProblems.length +
		result.extraNamespaces.length +
		result.unlistedLocales.length +
		result.newKeys.length +
		result.staleKeys.length +
		result.phantoms.length
	);
}

/** Every `(locale, namespace, key)` an allowance records as missing. */
export function allowanceIds(allowance) {
	const ids = new Set();
	for (const entry of allowance?.pairs ?? []) {
		if (
			typeof entry?.locale !== "string" ||
			typeof entry?.namespace !== "string" ||
			!Array.isArray(entry?.missing)
		)
			continue;
		for (const key of entry.missing)
			ids.add(`${entry.locale}\0${entry.namespace}\0${key}`);
	}
	return ids;
}

/**
 * Keys HEAD records as missing that the base allowance did not.
 *
 * This is the automated half of the shrink-only rule: it cannot stop someone
 * editing the file, but an added entry becomes a red check that names the debt,
 * so growth is a deliberate reviewed act rather than a silent escape.
 */
export function allowanceGrowth(base, head) {
	const before = allowanceIds(base);
	return [...allowanceIds(head)]
		.filter((id) => !before.has(id))
		.sort()
		.map((id) => {
			const [locale, namespace, key] = id.split("\0");
			return { locale, namespace, key };
		});
}

function git(args) {
	return spawnSync("git", args, { cwd: REPO, encoding: "utf8" });
}

/** The pull-request base GitHub exposes to a workflow, when this is a PR run. */
function ciBase() {
	if (process.env.GITHUB_EVENT_NAME !== "pull_request") return null;
	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath) return null;
	try {
		const event = JSON.parse(readFileSync(eventPath, "utf8"));
		const base = event?.pull_request?.base;
		return { sha: base?.sha, ref: base?.ref };
	} catch {
		return null;
	}
}

/**
 * Resolve the ref to compare the allowance against. An explicit ref or the CI
 * PR base is required: failing to resolve one must fail the gate, not silently
 * skip the comparison. A local checkout without `origin/main` is the one case
 * that skips.
 */
export function resolveAllowanceBase(base) {
	const explicit = typeof base === "string" && base.length > 0;
	const ci = explicit ? null : ciBase();
	const ref = (explicit ? base : null) ?? ci?.sha ?? "origin/main";
	const required = explicit || Boolean(ci?.sha);
	if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0)
		return { ref, required };
	// actions/checkout fetches one commit by default; fetch the base if needed.
	if (git(["fetch", "--no-tags", "--depth=1", "origin", ref]).status === 0)
		return { ref: "FETCH_HEAD", required };
	if (ci?.ref) {
		if (git(["fetch", "--no-tags", "--depth=1", "origin", ci.ref]).status === 0)
			return { ref: "FETCH_HEAD", required };
	}
	return { ref: null, required };
}

/** Growth failures relative to the base, as printable lines. Empty when clean. */
export function checkAllowanceGrowth(base) {
	const { ref, required } = resolveAllowanceBase(base);
	if (ref === null) {
		return required ? ["cannot resolve the base ref to compare against"] : [];
	}
	const shown = git(["show", `${ref}:i18n/coverage-allowance.json`]);
	if (shown.status !== 0) return []; // base without the file: introduction case
	try {
		const before = JSON.parse(shown.stdout);
		const head = readJson(ALLOWANCE);
		return allowanceGrowth(before, head).map(
			(added) => `added ${added.locale}/${added.namespace}: ${added.key}`,
		);
	} catch (error) {
		return [`cannot compare allowances: ${error.message}`];
	}
}

/**
 * Remove keys that are no longer missing. Refuses to add; a pair whose list
 * empties is removed, because an empty entry is invalid by construction.
 */
export function applyUpdate({
	cataloguesDir = CATALOGUES,
	manifestPath = MANIFEST,
	allowancePath = ALLOWANCE,
} = {}) {
	const result = checkCoverage({
		cataloguesDir,
		manifestPath,
		allowancePath,
	});
	const staleByPair = new Map();
	for (const stale of result.staleKeys) {
		const key = pairKey(stale.locale, stale.namespace);
		if (!staleByPair.has(key)) staleByPair.set(key, new Set());
		staleByPair.get(key).add(stale.key);
	}
	const allowance = result.allowance;
	let removedKeys = 0;
	let removedPairs = 0;
	allowance.pairs = (allowance.pairs ?? []).filter((entry) => {
		const key = pairKey(entry?.locale, entry?.namespace);
		const stale = staleByPair.get(key);
		if (!stale || !Array.isArray(entry.missing)) return true;
		const keep = entry.missing.filter((missingKey) => !stale.has(missingKey));
		removedKeys += entry.missing.length - keep.length;
		if (keep.length === 0) {
			removedPairs += 1;
			return false;
		}
		entry.missing = keep;
		return true;
	});
	if (removedKeys === 0) {
		process.stdout.write(
			"coverage-check: nothing to lower — every allowance key is still missing.\n",
		);
		return 0;
	}
	writeFileSync(allowancePath, `${JSON.stringify(allowance, null, "\t")}\n`);
	process.stdout.write(
		`coverage-check: lowered the allowance by ${removedKeys} key(s)${removedPairs > 0 ? ` and removed ${removedPairs} empty pair(s)` : ""}. It never raises; translate the gap instead.\n`,
	);
	return 0;
}

function formatFindings(findings) {
	const grouped = new Map();
	for (const finding of findings) {
		const key = `${finding.locale}/${finding.namespace}`;
		if (!grouped.has(key)) grouped.set(key, []);
		grouped.get(key).push(finding.key);
	}
	return [...grouped.entries()]
		.map(([pair, keys]) => `  ${pair}: ${keys.join(", ")}`)
		.join("\n");
}

export function main(argv, options = {}) {
	let mode = "check";
	let allowanceBase;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--update") mode = "update";
		else if (arg === "--list") mode = "list";
		else if (arg === "--allowance-base") {
			allowanceBase = argv[index + 1];
			index += 1;
			if (!allowanceBase) {
				process.stderr.write(
					"coverage-check.mjs: --allowance-base needs a ref\n",
				);
				return 2;
			}
		} else if (arg.startsWith("--allowance-base=")) {
			allowanceBase = arg.slice("--allowance-base=".length);
		} else if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"usage: node scripts/i18n/check-coverage.mjs [--update | --list] [--allowance-base <ref>]\n",
			);
			return 0;
		} else {
			process.stderr.write(`check-coverage.mjs: unknown argument ${arg}\n`);
			return 2;
		}
	}

	if (mode === "list") {
		const { allowance } = checkCoverage(options);
		for (const pair of allowance.pairs ?? []) {
			process.stdout.write(
				`${pair.locale}/${pair.namespace}: ${pair.missing.length} missing — ${pair.owner}; payoff ${pair.payoff}\n`,
			);
		}
		return 0;
	}
	if (mode === "update") return applyUpdate(options);

	const result = checkCoverage(options);
	const growth = checkAllowanceGrowth(allowanceBase);
	const totalGaps = [...result.missing.values()].reduce(
		(sum, pair) => sum + pair.keys.length,
		0,
	);
	const failures = failureCount(result) + growth.length;

	if (failures === 0) {
		process.stdout.write(
			`coverage-check: ok — ${result.gated.length} gated language(s) over ${result.namespaces.length} namespace(s); ${totalGaps} allowed key(s) remain across ${result.allowance.pairs?.length ?? 0} pair(s) (shrink-only; see i18n/coverage-allowance.json).\n`,
		);
		return 0;
	}

	for (const problem of result.problems)
		process.stderr.write(`coverage-check: manifest — ${problem}\n`);
	for (const problem of result.sourceProblems)
		process.stderr.write(`coverage-check: source — ${problem}\n`);
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
	if (result.newKeys.length > 0) {
		process.stderr.write(
			`coverage-check: ${result.newKeys.length} missing key(s) are not allowed (a new key in an already-incomplete namespace counts):\n${formatFindings(result.newKeys)}\n  Translate them. Do not add allowance keys for new copy.\n`,
		);
	}
	if (result.staleKeys.length > 0) {
		process.stderr.write(
			`coverage-check: ${result.staleKeys.length} allowed key(s) are no longer missing — the allowance must shrink, never rot:\n${formatFindings(result.staleKeys)}\n  Run \`--update\` to drop them.\n`,
		);
	}
	if (result.phantoms.length > 0) {
		process.stderr.write(
			`coverage-check: ${result.phantoms.length} allowance pair(s) name nothing this gate can allow:\n${result.phantoms.map((line) => `  ${line}`).join("\n")}\n  Remove them by hand; \`--update\` will not.\n`,
		);
	}
	if (growth.length > 0) {
		process.stderr.write(
			`coverage-check: allowance grew relative to the base — growth must be a reviewed decision naming an owner and payoff:\n${growth.map((line) => `  ${line}`).join("\n")}\n`,
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
