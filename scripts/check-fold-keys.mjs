#!/usr/bin/env node
/**
 * Assert that every fold's merged JSON/config file kept both parents' key sets.
 *
 * WHY THIS EXISTS, against the record. The union rule for a fold is "no key may
 * be lost and no form may be re-imposed", and the fold resolutions on this
 * branch have now failed it twice in ways a list-union read could not see:
 * `test:desktop`'s LIST was unioned while its FORM was re-imposed (caught by QA
 * round 2, fixed at the fourteenth fold), and fold 1 onto `44249a6796` wrote
 * `package.json` from main's copy to lay the list union in - silently dropping
 * this branch's `check-themes` key, which main had LOST at `53c5cfec6b` (#714)
 * and this branch still carried. The fold reported a clean union; nothing read
 * the KEY SET, and `pnpm check-themes` - a gate this repository's PR template
 * and AGENTS.md both name - stopped resolving until agent review round 8 (R11).
 *
 * WHAT IT DOES. For a merge commit it reads every `.json` path the merge
 * touched (against BOTH parents - a path either parent changed) and compares
 * the object KEY SETS: nested objects at every depth, and arrays by the KEY SET
 * OF EACH ELEMENT - elements that carry a `path` are keyed by it (the identity
 * the resolver pairs entries by), the rest by the union of their elements' keys.
 * String/number arrays are values, not keys. A key present in a parent and
 * absent from the merge is reported:
 *
 *   LOST[branch]  a key of THIS branch's parent vanished - a fault, exit 1.
 *   LOST[main]    a key of the main-side parent vanished - printed for the
 *                 resolver to classify: `citationConvention` group (5)'s
 *                 deliberate drops and main's own accidents both look like
 *                 this, and each must be a stated decision (a repair commit,
 *                 or the group (5) reading), not a silence.
 *   dropped       a key of EITHER parent vanished because it is a RETIRED
 *                 field - one this change stopped storing (see
 *                 `RETIRED_TOP_LEVEL_FIELDS` in `scripts/evidence-fold.mjs`,
 *                 imported below so the two homes cannot drift). Printed, exit
 *                 0. Without this clause the first fold after the retirement
 *                 lands would exit 1 on `LOST[branch] srcTree` for doing the
 *                 right thing.
 *
 * WHERE THE RETIRED RULE APPLIES: the manifest only. A rig's own per-run record
 * (an evidence set's `click-result.json`) legitimately carries a key of the same
 * name, and a merge that lost one of THOSE would be a real loss - so the
 * decision is scoped to the one path the field was retired in.
 *
 * WHAT IT CANNOT CATCH: form. A list whose harness prefix or order was
 * re-imposed (`test:desktop` is the live example) is not a key-set change, so
 * a green run here is not the whole rule - read the lists too.
 *
 * Usage:
 *   node scripts/check-fold-keys.mjs               # every fold on this branch
 *   node scripts/check-fold-keys.mjs <merge-sha>   # one merge commit
 *
 * "Every fold on this branch" = the first-parent merges of HEAD that are not
 * reachable from `origin/main` (the branch's own syncs; main's own merges are
 * excluded by that test). Run it AFTER resolving a fold, BEFORE pushing it:
 * the merge commit has to exist for this to read it.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { isEntryPoint } from "./entry-point.mjs";
import { RETIRED_TOP_LEVEL_FIELDS } from "./evidence-fold.mjs";

/**
 * The one file whose retired top-level fields are an accepted, printed loss.
 *
 * Scoped by PATH rather than by key name on purpose: `srcTree`/`scriptsTree` are
 * live keys in the rig's own per-run records (`click-result.json`,
 * `band-occlusion`'s `*-geometry.json`), where losing one WOULD be a real loss, and this gate
 * reads every `.json` a merge touched.
 */
const RETIRED_FIELD_HOME = "docs/evidence/manifest.json";

/*
 * Same ceiling the whole-tree readers carry: `git show` of the manifest crossed
 * Node's 1 MiB spawnSync default long ago, and ENOBUFS is what that default
 * throws (see the conflict-marker guard's note).
 */
const MAX_BUFFER = 64 * 1024 * 1024;

const git = (...args) =>
	execFileSync("git", args, { encoding: "utf8", maxBuffer: MAX_BUFFER });

/** Exit-code test, not a throw: `--is-ancestor` answers 1 for "no". */
const isAncestor = (ancestor, of) =>
	spawnSync("git", ["merge-base", "--is-ancestor", ancestor, of]).status === 0;

/**
 * The object key set of a JSON document, as dotted paths.
 *
 * Arrays recurse through a `[]` segment so a key ANY element carries is found;
 * primitives contribute nothing (an array of strings is a value, not keys).
 * Returns null when the text does not parse - reported, never guessed about.
 *
 * AN ARRAY ELEMENT THAT CARRIES A `path` IS KEYED BY IT instead of by `[]`. The
 * union form cannot see a loss inside ONE element while another element still
 * carries the same key, which is the shape the resolver keys its own entries by
 * (`supplementary[].path`) and the shape tonight's real drop took: the #765
 * lane's fold (2026-10-03) lost `frames`, `surfaces` and `themes` from
 * `supplementary[158]` while the manifest's ~160 other entries still carried all
 * three, so a union-of-elements comparison said `clean`. Elements without a
 * `path` keep the old union, so this narrowing cannot invent a loss for an array
 * that has no identity of its own.
 *
 * A RENAMED element (`path` changed on one side) reads as a loss of the old path.
 * That is deliberate: it is reported for a human to classify, and a renamed
 * capture set is exactly the kind of thing this gate exists to make visible.
 */
export function keyPaths(text) {
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	const out = new Set();
	const walk = (node, prefix) => {
		if (Array.isArray(node)) {
			for (const element of node) {
				const identity =
					typeof element?.path === "string" && element.path.length > 0
						? `[${element.path}]`
						: "[]";
				walk(element, `${prefix}${identity}`);
			}
			return;
		}
		if (node === null || typeof node !== "object") return;
		for (const [key, value] of Object.entries(node)) {
			const path = prefix === "" ? key : `${prefix}.${key}`;
			out.add(path);
			walk(value, path);
		}
	};
	walk(data, "");
	return out;
}

/** The text of `rev:path`, or null when that revision has no such path. */
function blob(rev, path) {
	try {
		return execFileSync("git", ["show", `${rev}:${path}`], {
			encoding: "utf8",
			maxBuffer: MAX_BUFFER,
			/*
			 * stderr swallowed on purpose: asking a parent that lacks the file is
			 * a normal question here (the file can be main-side-only), and git
			 * answers it with a `fatal:` line that is not this run's verdict.
			 */
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}

/** The `.json` paths the merge changed against either parent, sorted. */
function jsonPathsTouched(merge, parents) {
	const paths = new Set();
	for (const parent of parents) {
		const names = git("diff", "--name-only", parent, merge).split("\n");
		for (const name of names) {
			if (name.endsWith(".json")) paths.add(name);
		}
	}
	return [...paths].sort();
}

/** Check one merge; returns { branchLosses: [...], mainLosses: [...], retired: [...], unparsed: [...] }. */
export function checkMerge(merge) {
	const [first, second] = git("rev-parse", `${merge}^1`, `${merge}^2`)
		.trim()
		.split("\n");
	const branchLosses = [];
	const mainLosses = [];
	const retired = [];
	const unparsed = [];
	for (const path of jsonPathsTouched(merge, [first, second])) {
		const merged = keyPaths(blob(merge, path) ?? "");
		if (merged === null) {
			unparsed.push(`${path} (merged copy)`);
			continue;
		}
		for (const [side, parent, losses] of [
			["branch", first, branchLosses],
			["main", second, mainLosses],
		]) {
			const text = blob(parent, path);
			if (text === null) continue; // the parent never had the file
			const parentKeys = keyPaths(text);
			if (parentKeys === null) {
				unparsed.push(`${path} (${side} parent)`);
				continue;
			}
			for (const key of parentKeys) {
				if (merged.has(key)) continue;
				if (path === RETIRED_FIELD_HOME && RETIRED_TOP_LEVEL_FIELDS.has(key)) {
					retired.push(`${path} :: ${key}`);
					continue;
				}
				losses.push(`${path} :: ${key}`);
			}
		}
	}
	return { merge, first, second, branchLosses, mainLosses, retired, unparsed };
}

/** The branch's own folds: first-parent merges of HEAD not on `origin/main`. */
export function branchFolds() {
	const merges = git("rev-list", "--first-parent", "--merges", "HEAD")
		.trim()
		.split("\n")
		.filter(Boolean);
	return merges.filter((merge) => !isAncestor(merge, "origin/main"));
}

function main(argv) {
	const args = argv.filter((a) => !a.startsWith("--"));
	if (args.length > 1) {
		process.stderr.write(
			"usage: node scripts/check-fold-keys.mjs [<merge-sha>]\n",
		);
		process.exitCode = 2;
		return;
	}
	let merges;
	if (args.length === 1) {
		merges = [args[0]];
	} else {
		if (
			spawnSync("git", ["rev-parse", "--verify", "origin/main"]).status !== 0
		) {
			process.stderr.write(
				"origin/main does not resolve; fetch it, or name one merge commit: node scripts/check-fold-keys.mjs <merge-sha>\n",
			);
			process.exitCode = 2;
			return;
		}
		merges = branchFolds().reverse(); // oldest first
	}
	let branchTotal = 0;
	for (const merge of merges) {
		const result = checkMerge(merge);
		const subject = git("log", "-1", "--format=%s", merge).trim();
		process.stdout.write(
			`fold ${merge.slice(0, 10)} :: ${subject.slice(0, 72)}\n`,
		);
		if (
			result.branchLosses.length === 0 &&
			result.mainLosses.length === 0 &&
			result.unparsed.length === 0
		) {
			process.stdout.write(
				result.retired.length === 0
					? "  clean - every key of both parents survives the merge\n"
					: "  clean - every key of both parents survives, apart from the retired field(s) below\n",
			);
		}
		for (const drop of result.retired) {
			process.stdout.write(`  dropped     ${drop} - retired by this change\n`);
		}
		for (const loss of result.branchLosses) {
			process.stdout.write(`  LOST[branch] ${loss}\n`);
		}
		for (const loss of result.mainLosses) {
			process.stdout.write(`  LOST[main]   ${loss}\n`);
		}
		for (const bad of result.unparsed) {
			process.stdout.write(`  UNPARSED    ${bad}\n`);
		}
		branchTotal += result.branchLosses.length;
	}
	if (merges.length > 1) {
		process.stdout.write(
			`checked ${merges.length} folds; branch-side losses: ${branchTotal}\n`,
		);
	}
	if (branchTotal > 0) {
		process.stdout.write(
			"each branch-side loss needs a decision: restore the key, or state the deliberate carry in the fold's record\n",
		);
		process.exitCode = 1;
	}
}

if (isEntryPoint(import.meta.url)) main(process.argv.slice(2));
