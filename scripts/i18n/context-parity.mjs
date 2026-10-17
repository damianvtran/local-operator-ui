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
 *  1. a sibling `en/<ns>.context.json` exists — REQUIRED only when the catalogue
 *     has keys. An empty placeholder catalogue (ui.agents, ui.projects,
 *     ui.schedules today) carries nothing to translate, so it needs no sidecar
 *     and is not a gap; requiring one would be ceremony over an empty file;
 *  2. every key in the catalogue has an entry in the sidecar;
 *  3. no sidecar entry names a key the catalogue lacks (a rename that left the
 *     old id behind reads as context for a string nothing renders);
 *  4. no ALLOWANCE key names a key the catalogue lacks — a phantom that
 *     pre-allows a future key (see below).
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
 * AN ALLOWANCE KEY THAT NAMES NO CATALOGUE KEY IS A PHANTOM, and a failure. It
 * allows nothing today — so it looks harmless — but it PRE-ALLOWS a future key of
 * that name, which is the one way the allowance could grow instead of shrink.
 * `checkAllowance` therefore compares every allowance key against the catalogue's
 * key set (the first version compared it only against the sidecar, so a namespace
 * with no sidecar crashed instead of reporting the phantom). `--update` will not
 * remove a phantom: removing it is a human decision, because only a human knows
 * whether the name was a typo or a key that has not landed yet.
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
	const contextKeys = new Set(Object.keys(context));
	const catalogueKeys = new Set(Object.keys(catalogue));
	const uncovered = Object.keys(catalogue)
		.filter((key) => !contextKeys.has(key))
		.sort();
	const orphaned = Object.keys(context)
		.filter((key) => !catalogueKeys.has(key))
		.sort();
	// The sidecar's own keys travel with the gap so callers never re-read the
	// file: re-reading it was how a namespace with NO sidecar crashed the guard.
	return { uncovered, orphaned, hasSidecar, contextKeys, catalogueKeys };
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
	const phantoms = []; // ALLOWANCE key that names no catalogue key
	const stale = {}; // ns -> allowed keys now covered in the sidecar (--update drops them)

	const namespaces = catalogueNamespaces(cataloguesDir);
	// Every allowance namespace must have a catalogue: an entry for a namespace
	// with no catalogue is a phantom of its own kind.
	const absentNamespaces = Object.keys(allowed).filter(
		(ns) => !namespaces.includes(ns),
	);

	for (const ns of namespaces) {
		const gap = namespaceGap(ns, cataloguesDir);
		const allow = new Set(allowed[ns]?.keys ?? []);
		if (!gap.hasSidecar && gap.catalogueKeys.size > 0 && !allowed[ns]) {
			missingSidecar.push(
				`${ns} (${gap.catalogueKeys.size} key(s), no sidecar)`,
			);
		}
		for (const key of gap.uncovered) {
			if (!allow.has(key)) newGaps.push(key);
		}
		if (gap.orphaned.length > 0)
			orphans.push(`${ns}: ${gap.orphaned.join(", ")}`);
		// An allowance key that names no catalogue key is a PHANTOM: it allows
		// nothing today and silently PRE-ALLOWS a future key of that name, which is
		// how an allowance could be grown rather than shrunk. It is a failure, not a
		// silent no-op. (This is the hole the first version had: a phantom was only
		// ever checked against the sidecar, so a namespace with no sidecar crashed
		// instead of reporting it.)
		for (const key of allow) {
			if (!gap.catalogueKeys.has(key)) phantoms.push(`${ns}: ${key}`);
		}
		// STALE means now covered: the key is in the sidecar, so the allowance entry
		// has done its job and must be dropped. It is reported (never silent) and
		// --update removes it; it does not fail the check, matching the string-ceiling
		// baseline's "lower it, do not block on it".
		const nowCovered = [...allow]
			.filter((key) => gap.contextKeys.has(key))
			.sort();
		if (nowCovered.length > 0) stale[ns] = nowCovered;
	}
	for (const ns of absentNamespaces) {
		for (const key of allowed[ns].keys) phantoms.push(`${ns}: ${key}`);
	}
	return { newGaps, missingSidecar, orphans, phantoms, stale, allowance };
}

/** Remove now-covered keys from the allowance. Refuses to write when that is a no-op. */
export function applyUpdate({
	cataloguesDir = CATALOGUES,
	allowancePath = ALLOWANCE,
} = {}) {
	const { stale, allowance } = checkAllowance({
		cataloguesDir,
		allowancePath,
	});
	let removed = 0;
	for (const [ns, keys] of Object.entries(stale)) {
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

	const { newGaps, missingSidecar, orphans, phantoms, stale, allowance } =
		checkAllowance(options);
	const allowed = Object.values(allowance.namespaces ?? {}).reduce(
		(sum, entry) => sum + entry.keys.length,
		0,
	);
	const staleCount = Object.values(stale).reduce(
		(sum, keys) => sum + keys.length,
		0,
	);

	if (
		newGaps.length === 0 &&
		missingSidecar.length === 0 &&
		orphans.length === 0 &&
		phantoms.length === 0
	) {
		process.stdout.write(
			`context-parity: ok — every English key is covered, apart from ${allowed} allowed gap(s) in ` +
				`${Object.keys(allowance.namespaces ?? {}).length} namespace(s) (shrink-only; see i18n/context-allowance.json).\n`,
		);
		if (staleCount > 0) {
			process.stdout.write(
				`context-parity: note — ${staleCount} allowance key(s) are now covered; run \`--update\` to drop them:\n` +
					`${Object.entries(stale)
						.map(([ns, keys]) => `  ${ns}: ${keys.join(", ")}`)
						.join("\n")}\n`,
			);
		}
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
	if (phantoms.length > 0) {
		process.stderr.write(
			`context-parity: ${phantoms.length} allowance key(s) name no catalogue key — a phantom allows nothing and PRE-ALLOWS a future key of that name. Remove it (\`--update\` will not):\n` +
				`${phantoms.map((line) => `  ${line}`).join("\n")}\n`,
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
