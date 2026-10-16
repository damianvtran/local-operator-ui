#!/usr/bin/env node
/**
 * Merge-time parity evidence for a hand-unioned English catalogue.
 *
 * WHY THIS EXISTS, and why it is a merge-time tool rather than a CI gate
 * ---------------------------------------------------------------------
 * Two extraction PRs can each create the SAME new shared catalogue (for
 * example `src/i18n/catalogues/en/ui.common.actions.json`) carrying DISJOINT
 * keys. There is no merge driver for those files and `.gitattributes` does
 * not map them, so the second PR to merge must hand-union the two copies —
 * and resolving the conflict with `--ours` or `--theirs` SILENTLY DROPS the
 * other side's keys.
 *
 * No existing gate catches a dropped English key after such a union:
 * `generate.mjs --check` only proves the generated map matches a fresh
 * generation of the CURRENT catalogues — it never compares against the other
 * side; `check-strings.mjs` counts source literals; locale parity compares
 * locale-vs-en. A lost key therefore rides a green CI.
 *
 * A plain always-on CI gate would be the WRONG shape for this check: an
 * extraction legitimately REMOVES keys (dead keys, redesigned surfaces), so
 * "no key removed vs merge-base" would false-positive on ordinary PRs. This
 * tool is therefore run BY HAND, once, at the moment a hand-union lands, and
 * its output is pasted onto the PR as evidence (see `docs/I18N.md`). It is
 * deliberately NOT wired into `check-i18n` or any required CI job.
 *
 * WHAT IT ASSERTS, per `--file`, reading all three blobs from Git objects
 * (`git show <sha>:<path>`; nothing is checked out):
 *
 *   1. every key on the BASE copy is present in the merged head;
 *   2. every key on the PR's PRE-MERGE copy is present in the merged head;
 *   3. any key present on either side carries a value in the merged head
 *      that is identical to that side's value.
 *
 * A catalogue absent at a given ref counts as an empty key set on that side
 * (a genuinely new file has no base copy to lose keys from); an unresolvable
 * ref or unparseable blob is a usage error (exit 2), never a silent pass.
 * A key the two sides themselves disagree on can satisfy (3) for at most one
 * side, so it is reported — that is a real conflict for the merger to
 * resolve and explain on the PR, not something to silence.
 *
 * USAGE:
 *   node scripts/i18n/catalogue-union-parity.mjs \
 *     --pr 1234 --head <merged-head-sha> --old-head <pre-merge-head-sha> \
 *     [--base <base-sha>] \
 *     --file src/i18n/catalogues/en/ui.common.actions.json \
 *     [--file src/i18n/catalogues/en/ui.common.actions.context.json] \
 *     [--json] [--repo <root>]
 *
 * `--base` defaults to `origin/main`. More than one `--file` is supported
 * because one union can span a catalogue and its `.context.json` sibling.
 * Exit 0 = no key lost and no value changed; 1 = parity failure; 2 = the
 * check itself could not run.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

/**
 * Read one catalogue blob at a ref without touching the worktree — the whole
 * point is comparing versions that may no longer exist on disk. A path that
 * simply does not exist at that ref is an empty catalogue (see the header:
 * a new file has nothing to lose on that side); any other git failure means
 * the comparison cannot be made, so it throws rather than passing vacuously.
 */
export function readCatalogueAt(ref, path, { repo } = {}) {
	/* Verify the ref itself first: `git show <bad-ref>:<path>` can report the
	 * PATH as missing for an unresolvable ref too, and treating that as an
	 * empty catalogue would turn a typo'd SHA into a vacuous pass/fail
	 * against nothing rather than the usage error it is. */
	try {
		execFileSync(
			"git",
			["rev-parse", "--verify", "--quiet", `${ref}^{object}`],
			{
				cwd: repo,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch {
		throw new Error(`cannot resolve ref ${ref}`);
	}
	let raw;
	try {
		raw = execFileSync("git", ["show", `${ref}:${path}`], {
			cwd: repo,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const stderr = String(error.stderr ?? "");
		if (
			stderr.includes(`path '${path}' does not exist in`) ||
			stderr.includes(`path '${path}' exists on disk, but not in`)
		) {
			return {};
		}
		throw new Error(
			`cannot read ${path} at ${ref}: ${stderr.trim() || error.message}`,
		);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`${path} at ${ref} is not valid JSON: ${error.message}`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${path} at ${ref} is not a JSON object of keys`);
	}
	return parsed;
}

/**
 * Compare the three copies of ONE catalogue. Pure over already-read objects
 * so the shape of a failure (which side lost what) is unit-testable without
 * git; `checkUnionParity` below is the git-reading wrapper.
 */
export function compareCatalogues({ baseCat, prCat, mergedCat }) {
	const missingFromBase = Object.keys(baseCat)
		.filter((key) => !(key in mergedCat))
		.sort();
	const missingFromPr = Object.keys(prCat)
		.filter((key) => !(key in mergedCat))
		.sort();
	const differing = new Map();
	for (const [side, cat] of [
		["base", baseCat],
		["pr", prCat],
	]) {
		for (const key of Object.keys(cat)) {
			if (key in mergedCat && !isDeepStrictEqual(cat[key], mergedCat[key])) {
				const sides = differing.get(key) ?? [];
				sides.push(side);
				differing.set(key, sides);
			}
		}
	}
	const valueDifferences = [...differing.entries()]
		.map(([key, differsFrom]) => ({ key, differsFrom }))
		.sort((a, b) => a.key.localeCompare(b.key));
	return {
		baseCount: Object.keys(baseCat).length,
		prCount: Object.keys(prCat).length,
		mergedCount: Object.keys(mergedCat).length,
		unionCount: new Set([...Object.keys(baseCat), ...Object.keys(prCat)]).size,
		missingFromBase,
		missingFromPr,
		valueDifferences,
		ok:
			!missingFromBase.length &&
			!missingFromPr.length &&
			!valueDifferences.length,
	};
}

/** Run the parity check for every requested file. Throws on unreadable input. */
export function checkUnionParity({ repo, head, oldHead, base, files }) {
	const results = files.map((file) => ({
		file,
		...compareCatalogues({
			baseCat: readCatalogueAt(base, file, { repo }),
			prCat: readCatalogueAt(oldHead, file, { repo }),
			mergedCat: readCatalogueAt(head, file, { repo }),
		}),
	}));
	return {
		head,
		oldHead,
		base,
		files: results,
		ok: results.every((r) => r.ok),
	};
}

function formatText(pr, result) {
	const lines = [
		`PR #${pr}  catalogue union parity`,
		`  base   : ${result.base}`,
		`  PR pre-merge : ${result.oldHead}`,
		`  merged head  : ${result.head}`,
	];
	for (const r of result.files) {
		lines.push(
			`file ${r.file}`,
			`  base   keys : ${r.baseCount}`,
			`  PR     keys : ${r.prCount}`,
			`  merged keys : ${r.mergedCount}`,
			`  union  keys : ${r.unionCount} (expected, base ∪ PR)`,
			`  missing from base : ${JSON.stringify(r.missingFromBase)}`,
			`  missing from PR   : ${JSON.stringify(r.missingFromPr)}`,
			`  value differences : ${JSON.stringify(r.valueDifferences)}`,
		);
	}
	lines.push(
		result.ok
			? "RESULT: PASS - no English key lost or changed"
			: "RESULT: FAIL - English key lost or changed",
	);
	return `${lines.join("\n")}\n`;
}

const USAGE =
	"usage: node scripts/i18n/catalogue-union-parity.mjs --pr <n> --head <merged-sha> \\\n" +
	"  --old-head <pre-merge-sha> [--base <sha>] --file <catalogue.json> [--file <more.json>] \\\n" +
	"  [--json] [--repo <root>]\n\n" +
	"Merge-time evidence that a hand-unioned catalogue lost no key from either side.\n" +
	"Not a CI gate; see docs/I18N.md. Exit 0 pass, 1 parity failure, 2 usage error.\n";

export function main(argv) {
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(USAGE);
		return 0;
	}
	let values;
	try {
		({ values } = parseArgs({
			args: argv,
			options: {
				pr: { type: "string" },
				head: { type: "string" },
				"old-head": { type: "string" },
				base: { type: "string", default: "origin/main" },
				file: { type: "string", multiple: true },
				repo: { type: "string" },
				json: { type: "boolean", default: false },
			},
		}));
	} catch (error) {
		process.stderr.write(`catalogue-union-parity: ${error.message}\n${USAGE}`);
		return 2;
	}
	const files = values.file ?? [];
	if (!values.pr || !values.head || !values["old-head"] || !files.length) {
		process.stderr.write(
			`catalogue-union-parity: --pr, --head, --old-head and at least one --file are required\n${USAGE}`,
		);
		return 2;
	}
	let result;
	try {
		result = checkUnionParity({
			repo: values.repo ? resolve(values.repo) : undefined,
			head: values.head,
			oldHead: values["old-head"],
			base: values.base,
			files,
		});
	} catch (error) {
		process.stderr.write(`catalogue-union-parity: ${error.message}\n`);
		return 2;
	}
	if (values.json) {
		process.stdout.write(
			`${JSON.stringify({ pr: values.pr, ...result }, null, 2)}\n`,
		);
	} else {
		process.stdout.write(formatText(values.pr, result));
	}
	return result.ok ? 0 : 1;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exit(main(process.argv.slice(2)));
}
