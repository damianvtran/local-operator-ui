/**
 * Whether the module asking is the process's ENTRY POINT, compared by PHYSICAL
 * path. One implementation, because the failure it prevents is silent in every
 * script that gets it wrong.
 *
 * WHY NOT `import.meta.url === pathToFileURL(process.argv[1]).href`. The two sides
 * are written by different parties and only one of them is resolved. Node loads a
 * main module through its real path, so `import.meta.url` is physical, while
 * `process.argv[1]` is whatever the caller typed. Through a symlinked directory
 * they disagree — and the disagreement is SILENT: the file loads, the script's
 * `main()` never runs, nothing is printed and the process exits 0. macOS makes
 * that the ordinary case rather than an exotic one, because `/tmp` is a symlink to
 * `private/tmp`, so `node /tmp/<checkout>/scripts/<script>.mjs` did nothing at all.
 *
 * WHY THAT IS WORSE HERE THAN A CRASH. Every consumer in this repository reads a
 * script's stdout as an answer and its exit status as "it ran". An empty result
 * that exits 0 is therefore indistinguishable from "there is nothing to release",
 * "the guard passed" and "the derivation derived nothing" — the "green pipeline
 * that did nothing" failure these scripts exist to remove. `release-push-guard.mjs`
 * carried this defect first and it was fixed there alone; the eight scripts beside
 * it in the same workflow steps (`derive-release.mjs` was the very next command in
 * that `run:` block) kept it. Both of those files are gone with the automatic
 * release path, and the table in `scripts/entry-point.test.mjs` is what kept the
 * defect from coming back one script at a time while they were here: entry-point
 * detection lives in this module, once, and every release script resolves its own
 * path through it.
 *
 * WHAT THIS DOES NOT FIX. Resolving the entry point is the half that can be fixed
 * in the script. The other half is the consumer treating an empty or malformed
 * result as an answer, which lives in the workflow's shell:
 * `signed-update-candidate.yml` asserts the shape of what it parses before it acts
 * on it, and the gates whose consumer reads nothing but an exit status are run
 * through `scripts/require-report.sh`, which refuses to read a silent success as a
 * pass. `scripts/entry-point.test.mjs` drives both halves.
 *
 * WHY THE COMPARISON IS BY FILE IDENTITY. The question is "is this the same FILE",
 * so it is not asked as a question about names. `realpathSync` closes the two
 * spellings that produce the silent no-op here — a symlinked DIRECTORY (`/tmp` on
 * macOS, the ordinary case) and a symlinked NAME (an alias beside the tree) — and
 * both are pinned by tests. What it cannot answer is a name that resolves to a
 * different path while being the same file: a hard link. Two paths that `stat` to
 * the same device and inode are the same file, and the resolved-path comparison is
 * kept as the fallback for a path that cannot be stat'ed at all, so the set of
 * spellings recognised can only grow.
 *
 * Measured for the hard-link spelling, the one where the two answers could differ:
 * a hard link of `check-runtime-deps.mjs` spelled through `/tmp` printed nothing and
 * exited 0 before this change, and on this change it fails loudly — the link cannot
 * resolve the sibling `entry-point.mjs` it now imports. Louder is the direction the
 * rest of this file is about, and a link INSIDE `scripts/` still runs normally.
 */
import { realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A path as it physically is, or as it was spelled when it cannot be resolved: a
 * path that does not exist is not this module anyway, and throwing here would
 * replace a readable verdict with a stack trace. */
export const physical = (path) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

/** Whether two spellings name the same file: same device, same inode. Falls back
 * to resolved paths when either side cannot be stat'ed — a path that does not
 * exist is not this module anyway, and throwing here would replace a readable
 * verdict with a stack trace. */
function sameFile(left, right) {
	try {
		const a = statSync(left);
		const b = statSync(right);
		return a.dev === b.dev && a.ino === b.ino;
	} catch {
		return physical(left) === physical(right);
	}
}

/**
 * Whether the module at `moduleUrl` is the process's entry point.
 *
 * Both sides are reduced to the same FILE before they are compared, so the answer
 * is the same whatever spelling the caller used: through a symlinked directory
 * (`/tmp` on macOS), through a symlinked basename, or through a hard link. Under
 * `--preserve-symlinks-main`, where `import.meta.url` itself keeps the caller's
 * spelling, both sides still meet at the same file.
 *
 * `process.argv[1]` is absent under `node -e`, `--eval` and an import from a
 * REPL, where no module is the entry point.
 */
export function isEntryPoint(moduleUrl) {
	return (
		Boolean(process.argv[1]) &&
		sameFile(fileURLToPath(moduleUrl), process.argv[1])
	);
}
