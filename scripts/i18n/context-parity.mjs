#!/usr/bin/env node
/**
 * CONTEXT PARITY — the guard that makes `.context.json` coverage machine-checked.
 *
 * WHY THIS EXISTS. The `.context.json` sidecar is the ONLY context a translator
 * ever sees (docs/I18N.md): the key, its value, and what the string is FOR. A key
 * with no context entry is translated blind — the translator gets a sentence and
 * nothing else — and the review convention that flags a boilerplate sidecar is
 * the only thing standing between that and an uninformed choice.
 *
 * THE GAP. Nothing checked it. `generate.mjs --check` only proves the generated
 * map matches a fresh generation of the CURRENT catalogues; `check-strings.mjs`
 * counts source literals; `locale-parity.test.mjs` compares locale-vs-en (both
 * sides of the SAME catalogue namespace, never the sidecar); and
 * `catalogue-union-parity.mjs` compares catalogue-vs-catalogue at a merge and, by
 * its own docblock, never looks at context at all. So a key added without context
 * rides green — exactly as `ui.mesh.approval.*` did (223 catalogue keys against
 * 215 context entries), found only when a human noticed.
 *
 * WHAT IT ASSERTS, per source-locale catalogue `en/<ns>.json`:
 *  1. a sibling `en/<ns>.context.json` exists;
 *  2. every key in the catalogue has an entry in the sidecar;
 *  3. no sidecar entry names a key the catalogue lacks (a rename that left the
 *     old id behind reads as context for a string nothing renders).
 * It does NOT judge the QUALITY of a context note — "is this boilerplate" is not
 * a machine question — but COVERAGE is.
 *
 * THE ALLOWANCE. A guard that is red on main the day it lands blocks every lane
 * and gets bypassed. So the KNOWN gaps live in `i18n/context-allowance.json`,
 * each with an owner and a reason, and they are SHRINK-ONLY — the same shape as
 * `i18n/baseline.json`: `--update` removes keys that are now covered and REFUSES
 * to add any, so the number can only fall and every coverage PR must tick it
 * down. A key not listed and not covered is a hard failure.
 *
 *   node scripts/i18n/context-parity.mjs            # check (exit 1 on a new gap)
 *   node scripts/i18n/context-parity.mjs --update   # remove now-covered keys (never add)
 *   node scripts/i18n/context-parity.mjs --list     # print the current allowance
 *
 * `scripts/i18n/context-parity.test.mjs` runs `checkAllowance`/`applyUpdate` over
 * a fixture and pins that a raise is refused and a new bare key fails.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CATALOGUES = join(REPO, "src", "i18n", "catalogues");
export const SOURCE_LOCALE = "en";
export const ALLOWANCE = join(REPO, "i18n", "context-allowance.json");

/** Source-locale catalogue files (`en/*.json`, sidecars excluded). */
export function catalogueNamespaces(cataloguesDir = CATALOGUES) {
	const dir = join(cataloguesDir, SOURCE_LOCALE);
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".context.json"))
		.map((name) => name.slice(0, -".json".length))
		.sort();
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

/** The coverage gap in one namespace: keys present in the catalogue but absent from its sidecar. */
export function namespaceGap(ns, cataloguesDir = CATALOGUES) {
	const catalogue = readJson(join(cataloguesDir, SOURCE_LOCALE, `${ns}.json`));
	let context = {};
	let hasSidecar = true;
	try {
		context = readJson(
			join(cataloguesDir, SOURCE_LOCALE, `${ns}.context.json`),
		);
	} catch {
		hasSidecar = false;
	}
	const uncovered = Object.keys(catalogue)
		.filter((key) => !(key in context))
		.sort();
	const orphaned = Object.keys(context)
		.filter((key) => !(key in catalogue))
		.sort();
	return { uncovered, orphaned, hasSidecar };
}

function loadAllowance(path = ALLOWANCE) {
	return readJson(path);
}

/**
 * Compare the tree against the allowance. Returns what must fail the guard, and
 * what the allowance could drop (covered keys) — the two halves `--update` and
 * the checker both need.
 */
export function checkAllowance({
	cataloguesDir = CATALOGUES,
	allowancePath = ALLOWANCE,
} = {}) {
	const allowance = loadAllowance(allowancePath);
	const allowed = allowance.namespaces ?? {};

	const newGaps = []; // uncovered, not allowed
	const missingSidecar = []; // no context file at all, not allowed
	const orphans = []; // context for a key the catalogue lacks
	const covered = {}; // ns -> allowed keys that are now covered (updatable away)

	for (const ns of catalogueNamespaces(cataloguesDir)) {
		const gap = namespaceGap(ns, cataloguesDir);
		const allow = new Set(allowed[ns]?.keys ?? []);
		if (!gap.hasSidecar && gap.uncovered.length > 0 && !allowed[ns]) {
			missingSidecar.push(`${ns} (${gap.uncovered.length} key(s), no sidecar)`);
		}
		for (const key of gap.uncovered) {
			if (!allow.has(key)) newGaps.push(key);
		}
		if (gap.orphaned.length > 0)
			orphans.push(`${ns}: ${gap.orphaned.join(", ")}`);
		// "Covered" means the key is now IN the sidecar, not merely absent from the
		// gap: an allowance key that names no catalogue key at all is an ORPHAN,
		// reported above, and must not be silently swept as if it were covered.
		const nowCovered = [...allow].filter(
			(key) =>
				!gap.uncovered.includes(key) &&
				key in
					readJson(join(cataloguesDir, SOURCE_LOCALE, `${ns}.context.json`)),
		);
		if (nowCovered.length > 0) covered[ns] = nowCovered.sort();
	}
	// An allowance entry for a namespace with no catalogue at all is stale too.
	for (const ns of Object.keys(allowed)) {
		if (!catalogueNamespaces(cataloguesDir).includes(ns))
			covered[ns] = allowed[ns].keys;
	}
	return { newGaps, missingSidecar, orphans, covered, allowance };
}

/** Remove now-covered keys from the allowance. Refuses to write when that is a no-op. */
export function applyUpdate({
	cataloguesDir = CATALOGUES,
	allowancePath = ALLOWANCE,
} = {}) {
	const { covered, allowance } = checkAllowance({
		cataloguesDir,
		allowancePath,
	});
	let removed = 0;
	for (const [ns, keys] of Object.entries(covered)) {
		if (allowance.namespaces[ns]) {
			const keep = allowance.namespaces[ns].keys.filter(
				(k) => !keys.includes(k),
			);
			removed += allowance.namespaces[ns].keys.length - keep.length;
			if (keep.length === 0) delete allowance.namespaces[ns];
			else allowance.namespaces[ns].keys = keep;
		}
	}
	if (removed === 0) {
		process.stdout.write(
			"context-parity: nothing to lower — every allowance key is still uncovered.\n",
		);
		return 0;
	}
	writeFileSync(allowancePath, `${JSON.stringify(allowance, null, "\t")}\n`);
	process.stdout.write(
		`context-parity: lowered the allowance by ${removed} key(s). It never raises; author context instead.\n`,
	);
	return 0;
}

export function main(argv, options = {}) {
	let mode = "check";
	for (const arg of argv) {
		if (arg === "--update") mode = "update";
		else if (arg === "--list") mode = "list";
		else if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"usage: node scripts/i18n/context-parity.mjs [--update | --list]\n",
			);
			return 0;
		} else {
			process.stderr.write(`context-parity.mjs: unknown argument ${arg}\n`);
			return 2;
		}
	}

	if (mode === "list") {
		const { allowance } = checkAllowance(options);
		for (const [ns, entry] of Object.entries(allowance.namespaces ?? {})) {
			process.stdout.write(
				`${ns}: ${entry.keys.length} allowed — ${entry.owner}\n`,
			);
		}
		return 0;
	}
	if (mode === "update") return applyUpdate(options);

	const { newGaps, missingSidecar, orphans, allowance } =
		checkAllowance(options);
	const allowed = Object.values(allowance.namespaces ?? {}).reduce(
		(sum, entry) => sum + entry.keys.length,
		0,
	);

	if (
		newGaps.length === 0 &&
		missingSidecar.length === 0 &&
		orphans.length === 0
	) {
		process.stdout.write(
			`context-parity: ok — every English key is covered, apart from ${allowed} allowed gap(s) in ` +
				`${Object.keys(allowance.namespaces ?? {}).length} namespace(s) (shrink-only; see i18n/context-allowance.json).\n`,
		);
		return 0;
	}
	for (const line of missingSidecar) {
		process.stderr.write(
			`context-parity: ${line} — no context sidecar and no allowance row\n`,
		);
	}
	if (newGaps.length > 0) {
		const list = newGaps.map((key) => `  ${key}`).join("\n");
		process.stderr.write(
			`context-parity: ${newGaps.length} English key(s) have no translator context and no allowance entry:\n${list}\n  Author the context in the namespace's .context.json (the sidecar is the only context a translator sees).\n`,
		);
	}
	for (const line of orphans) {
		process.stderr.write(
			`context-parity: context names no catalogue key — ${line}\n`,
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
