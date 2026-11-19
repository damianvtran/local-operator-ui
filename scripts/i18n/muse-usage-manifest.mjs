#!/usr/bin/env node
/**
 * The Muse provenance vocabulary is a CROSS-REPO contract, so it gets a
 * generated manifest instead of a hand-copied constant list.
 *
 * `local_operator/providers/usage.py` defines `META_MUSE_*_NOTE` and the
 * desktop route forwards only those four strings as `UsageReport.notes`. The
 * renderer's `muse-usage-notes.ts` mirrors them because the two runtimes share
 * no module system; a silent drift would make the app stop recognising the
 * backend's own payloads, which is exactly the failure this manifest makes
 * visible.
 *
 * WHAT RUNS WHERE. The committed fixture is the portable half: CI has no
 * backend checkout, so the desktop test compares the TypeScript mirror to
 * `scripts/i18n/fixtures/muse-usage-notes.json`. On a machine where
 * `~/local-operator` sits beside this checkout, the same test also parses the
 * Python source and fails the moment a constant changes without this file
 * being regenerated. `--check` is that comparison as a command; `--write`
 * regenerates the fixture from the sibling checkout.
 *
 * Usage:
 *   node scripts/i18n/muse-usage-manifest.mjs --check
 *   node scripts/i18n/muse-usage-manifest.mjs --write
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The four names the Python module publishes, in its own spelling. */
export const MUSE_NOTE_NAMES = [
	"META_MUSE_ALLOWANCE_NOTE",
	"META_MUSE_PASSIVE_NOTE",
	"META_MUSE_STALE_NOTE",
	"META_MUSE_NO_OBSERVATION_NOTE",
];

export const MANIFEST_PATH = join(
	ROOT,
	"scripts/i18n/fixtures/muse-usage-notes.json",
);

/** `local_operator/providers/usage.py`, or null when no checkout is beside us. */
export function backendUsagePath() {
	const candidates = [
		process.env.LOCAL_OPERATOR_REPO
			? join(
					process.env.LOCAL_OPERATOR_REPO,
					"local_operator/providers/usage.py",
				)
			: null,
		join(
			process.env.HOME ?? "",
			"local-operator/local_operator/providers/usage.py",
		),
		join(ROOT, "..", "local-operator/local_operator/providers/usage.py"),
	].filter((path) => path !== null);
	return candidates.find((path) => existsSync(path)) ?? null;
}

/**
 * Read the four constants out of `usage.py`.
 *
 * Deliberately narrow: the module publishes simple (optionally parenthesised)
 * string assignments, and a shape this cannot read must throw rather than
 * return a partial map — a silent miss would turn the cross-repo check green.
 */
const ASSIGNMENT_FOR = new Map(
	MUSE_NOTE_NAMES.map((name) => [
		name,
		new RegExp(
			`^${name}\\s*=\\s*(?:\\(\\s*)?((?:"(?:[^"\\\\]|\\\\.)*"\\s*)+)(?:\\))?`,
			"m",
		),
	]),
);

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g;

export function parseMuseNotes(source) {
	const notes = {};
	for (const name of MUSE_NOTE_NAMES) {
		const assignment = ASSIGNMENT_FOR.get(name).exec(source);
		if (!assignment) {
			throw new Error(`usage.py no longer assigns ${name} as a string`);
		}
		STRING_LITERAL.lastIndex = 0;
		const literals = assignment[1].match(STRING_LITERAL) ?? [];
		notes[name] = literals.map((literal) => JSON.parse(literal)).join("");
	}
	return notes;
}

export function manifestFor(source) {
	return {
		source: "local_operator/providers/usage.py",
		constants: parseMuseNotes(source),
	};
}

export function readManifest() {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function main(argv) {
	const backend = backendUsagePath();
	if (argv.includes("--write")) {
		if (!backend) {
			process.stderr.write(
				"muse-usage-manifest: no local-operator checkout beside this repo; cannot write\n",
			);
			return 1;
		}
		writeFileSync(
			MANIFEST_PATH,
			`${JSON.stringify(manifestFor(readFileSync(backend, "utf8")), null, "\t")}\n`,
		);
		process.stdout.write(`muse-usage-manifest: wrote ${MANIFEST_PATH}\n`);
		return 0;
	}
	if (argv.includes("--check")) {
		if (!backend) {
			process.stdout.write(
				"muse-usage-manifest: no local-operator checkout beside this repo; skipped\n",
			);
			return 0;
		}
		const expected = manifestFor(readFileSync(backend, "utf8"));
		const actual = readManifest();
		if (JSON.stringify(expected) !== JSON.stringify(actual)) {
			process.stderr.write(
				"muse-usage-manifest: stale — regenerate with --write\n",
			);
			return 1;
		}
		process.stdout.write("muse-usage-manifest: ok\n");
		return 0;
	}
	process.stderr.write(
		"usage: node scripts/i18n/muse-usage-manifest.mjs --check|--write\n",
	);
	return 2;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exit(main(process.argv.slice(2)));
}
