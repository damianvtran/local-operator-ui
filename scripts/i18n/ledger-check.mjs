#!/usr/bin/env node
/**
 * The translation-ledger gate: fail closed on an unshipped, stale or unaudited
 * locale.
 *
 * WHY THIS EXISTS. A catalogue file in the tree reads as "translated" — the
 * runtime will render it and fall back to English per key for anything missing —
 * so nothing on screen distinguishes a locale that is complete and audited from
 * one that is half-done or translated by an agent nobody checked. This gate is
 * the difference: it re-derives the hashes recorded in `i18n/ledger.json` from
 * the files themselves, so a ledger entry cannot certify a file it no longer
 * describes.
 *
 * WHAT IT ENFORCES, per entry (a ledger entry IS the claim that a locale ships a
 * namespace):
 *
 *  - the locale directory and the namespace file exist;
 *  - the file's key set EQUALS its English source's (a locale may not drop a key
 *    and let the fallback hide it — the same completeness rule the parity guard
 *    states in the test suite);
 *  - `source_sha256` still matches the ENGLISH file and `target_sha256` still
 *    matches the translated file (staleness is a failure, not a warning: a
 *    translated-then-edited file is no longer the thing that was audited);
 *  - `status` is `audited`, there is at least one auditor, and at least one
 *    auditor is a DIFFERENT agent from the translator (independence by agent,
 *    which is what the process requires — not by model).
 *
 * AND it closes the other direction: every locale directory present in the tree
 * must have a ledger entry for every namespace file it ships. A file that is
 * shipped without an entry is an unaudited locale, which is exactly the state
 * this gate exists to refuse.
 *
 * USAGE:
 *   node scripts/i18n/ledger-check.mjs            # check; exit 1 on any failure
 *   node scripts/i18n/ledger-check.mjs --help
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Locale whose messages are the source every other locale is measured against. */
const SOURCE_LOCALE = "en";

/** The ledger file's own name, under `i18n/` (OUTSIDE the catalogue tree, so the
 * generator never ingests it as a message namespace). */
export const LEDGER_RELATIVE = join("i18n", "ledger.json");

function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function namespaceFiles(dir) {
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".context.json"))
		.sort();
}

/**
 * Run every ledger check against a tree.
 *
 * Exported (rather than only a CLI) so `ledger-check.test.mjs` can drive it with
 * synthetic fixtures — the negative controls are the point: a gate that cannot
 * fail on a dropped key, a missing namespace or a stale hash is not a gate.
 *
 * @returns {{ failures: string[], checked: number }}
 */
export function checkLedger({ repo = REPO } = {}) {
	const failures = [];
	const cataloguesDir = join(repo, "src", "i18n", "catalogues");
	const ledgerPath = join(repo, LEDGER_RELATIVE);

	if (!existsSync(ledgerPath)) {
		return { failures: [`no ledger at ${LEDGER_RELATIVE}`], checked: 0 };
	}
	let ledger;
	try {
		ledger = readJson(ledgerPath);
	} catch (error) {
		return {
			failures: [`ledger is not valid JSON: ${error.message}`],
			checked: 0,
		};
	}
	const entries = Array.isArray(ledger.entries) ? ledger.entries : null;
	if (!entries) {
		return { failures: ["ledger has no `entries` array"], checked: 0 };
	}

	const claimed = new Set();
	for (const entry of entries) {
		const { locale, namespace } = entry ?? {};
		if (typeof locale !== "string" || typeof namespace !== "string") {
			failures.push("an entry is missing its `locale` or `namespace`");
			continue;
		}
		const where = `${locale}/${namespace}`;
		claimed.add(where);
		if (locale === SOURCE_LOCALE) {
			failures.push(`${where}: the source locale does not need a ledger entry`);
			continue;
		}
		const file = join(cataloguesDir, locale, `${namespace}.json`);
		const sourceFile = join(cataloguesDir, SOURCE_LOCALE, `${namespace}.json`);
		if (!existsSync(file)) {
			failures.push(
				`${where}: the ledger claims it, but the file does not exist`,
			);
			continue;
		}
		if (!existsSync(sourceFile)) {
			failures.push(`${where}: no English source for that namespace`);
			continue;
		}

		/* Completeness: same key set as English, both directions. */
		try {
			const sourceKeys = Object.keys(readJson(sourceFile)).sort();
			const localeKeys = Object.keys(readJson(file)).sort();
			const missing = sourceKeys.filter((key) => !localeKeys.includes(key));
			const extra = localeKeys.filter((key) => !sourceKeys.includes(key));
			if (missing.length) {
				failures.push(
					`${where}: missing ${missing.length} key(s) — ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`,
				);
			}
			if (extra.length) {
				failures.push(
					`${where}: ${extra.length} key(s) not in the English source — ${extra.slice(0, 3).join(", ")}…`,
				);
			}
		} catch (error) {
			failures.push(
				`${where}: a catalogue is not valid JSON (${error.message})`,
			);
			continue;
		}

		/* Freshness: the recorded hashes must still describe the files. */
		const sourceHash = sha256File(sourceFile);
		const targetHash = sha256File(file);
		if (entry.source_sha256 !== sourceHash) {
			failures.push(
				`${where}: stale source_sha256 (ledger ${String(entry.source_sha256).slice(0, 12)}…, file ${sourceHash.slice(0, 12)}…) — the English source moved since translation`,
			);
		}
		if (entry.target_sha256 !== targetHash) {
			failures.push(
				`${where}: stale target_sha256 (ledger ${String(entry.target_sha256).slice(0, 12)}…, file ${targetHash.slice(0, 12)}…) — the translated file changed since it was audited`,
			);
		}

		/* Audit state and independence. */
		if (entry.status !== "audited") {
			failures.push(
				`${where}: status is ${JSON.stringify(entry.status)}, not "audited" — an unaudited locale must not ship`,
			);
		}
		const auditors = Array.isArray(entry.auditors) ? entry.auditors : [];
		if (auditors.length === 0) {
			failures.push(`${where}: no auditor recorded`);
		} else {
			const translatorAgent = entry.translator?.agent;
			const independent = auditors.some(
				(auditor) => auditor?.agent && auditor.agent !== translatorAgent,
			);
			if (!independent) {
				failures.push(
					`${where}: every auditor is the translator's own agent — the audit must be independent`,
				);
			}
		}
	}

	/* The other direction: no shipped file without a claim. */
	if (existsSync(cataloguesDir)) {
		for (const locale of readdirSync(cataloguesDir, { withFileTypes: true })) {
			if (!locale.isDirectory() || locale.name === SOURCE_LOCALE) continue;
			const dir = join(cataloguesDir, locale.name);
			for (const file of namespaceFiles(dir)) {
				const namespace = file.slice(0, -".json".length);
				if (!claimed.has(`${locale.name}/${namespace}`)) {
					failures.push(
						`${locale.name}/${namespace}: shipped without a ledger entry — an unaudited locale must not ship`,
					);
				}
			}
		}
	}

	return { failures, checked: entries.length };
}

export function main(argv) {
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(
			"usage: node scripts/i18n/ledger-check.mjs\n\n" +
				"Checks i18n/ledger.json against the catalogues: completeness, hash freshness,\n" +
				"audit state and auditor independence. Exit 1 on any failure.\n",
		);
		return 0;
	}
	const { failures, checked } = checkLedger();
	for (const failure of failures)
		process.stderr.write(`ledger-check: ${failure}\n`);
	if (failures.length) {
		process.stderr.write(
			`ledger-check: FAILED — ${failures.length} finding(s) across ${checked} ledger entr(ies)\n`,
		);
		return 1;
	}
	process.stdout.write(
		`ledger-check: ok — ${checked} entr(ies) complete, fresh and independently audited\n`,
	);
	return 0;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exit(main(process.argv.slice(2)));
}
