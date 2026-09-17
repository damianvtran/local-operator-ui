/**
 * The one directory-listing primitive this app has, plus the two path facts the
 * composer's `@` picker needs from the main process.
 *
 * WHY A MODULE OF ITS OWN. `src/main/index.ts` boots the app on import, so
 * nothing that lives there can be bundled and exercised by a test.
 * `scripts/desktop-contract.test.mjs` bundles files under `src/main/` in memory
 * instead, which is the pattern `picker-directory.ts` states for the same
 * reason; `scripts/directory-listing.test.mjs` pins the two functions below.
 *
 * THREE THINGS, ONE RULE EACH:
 *
 * 1. **A directory's listable entries.** The renderer cannot read a directory
 *    (`nodeIntegration: false`, `contextIsolation: true`), and `probe-files`
 *    answers existence and identity but not membership — so a picker has no way
 *    to offer a row without this. The exclusions are the visible half of the
 *    answer: dotfiles and the build/vendor directories a listing would drown in.
 *    They mirror the harness's own `@` picker listing vocabulary
 *    (`local_operator/references.py:scan_directory`, which skips
 *    `builtin.py:_GREP_PRUNE_DIRS` and every name starting with a dot), because a
 *    picker that offers `node_modules` is a picker nobody can use; and the mirror
 *    is stated rather than assumed, because a name missing from this set costs
 *    ROWS in a menu and cannot make the composer expand a path the approval gate
 *    would refuse. That is what makes duplicating it here a listing decision
 *    rather than a second spelling of a security control. (The harness's
 *    `.gitignore` handling is deliberately NOT mirrored: that machinery belongs
 *    to the walker, and half an implementation of it here would be worse than
 *    none — the difference is disclosed on the pull request.)
 *
 * 2. **Whether a resolved path lies outside the workspace.** The chip's
 *    needs-approval fill is this one fact, and it is the harness's own definition
 *    (`builtin.py:_resolve_workspace_path`): both sides are FULLY RESOLVED —
 *    symlinks included — and the target must be the root itself or under it. It
 *    has to be computed here rather than in the renderer for the reason the path
 *    rule lives here at all: the renderer never guesses a home directory, and a
 *    prefix test over `~/x` against `/Users/you/x` is how the chip would come to
 *    disagree with the gate about one file.
 *
 * 3. **A resolved spelling, for that test.** `realpath`, because a symlink inside
 *    the workspace that points outside it is the case the harness resolves FIRST
 *    and then judges — so judging the link's own spelling would paint a plain
 *    chip over a path that raises a card.
 */

import { readdirSync, realpathSync, statSync } from "node:fs";
import { sep } from "node:path";
import {
	DIRECTORY_ENTRY_LIMIT,
	type DirectoryEntry,
	type DirectoryListing,
} from "../shared/desktop-contract";

/**
 * Names never offered as rows, whatever they contain.
 *
 * The harness's `_GREP_PRUNE_DIRS` verbatim. Skipped by NAME rather than by kind,
 * so a file called `build` is skipped too — the set is about what a listing is
 * for, and it is applied the same way there.
 */
export const PRUNE_NAMES: readonly string[] = [
	"__pycache__",
	"node_modules",
	"dist",
	"build",
	".git",
	".venv",
];

/**
 * Whether a name is excluded from a listing.
 *
 * A dotfile is excluded because the harness's listing excludes it and because
 * `ls` does; `PRUNE_NAMES` is matched case-SENSITIVELY, unlike the harness's
 * deny-list, because these are spellings a build tool fixes rather than names a
 * filesystem may fold.
 */
function excluded(name: string): boolean {
	if (name.startsWith(".")) return true;
	return PRUNE_NAMES.includes(name);
}

/**
 * One directory's listable entries, sorted by name. Never throws.
 *
 * SORTED BY NAME, like the harness, so the renderer's own ranking starts from a
 * deterministic order and its alphabetical tiebreak cannot depend on `readdir`
 * order. `dir` must already have been through the path rule; this function does
 * no path arithmetic of its own, so there is one resolver in this process.
 *
 * A symlink is asked about with `statSync` rather than answered from the dirent,
 * because `stat` follows the link and the harness's `DirEntry.is_dir()` does too
 * — a symlinked directory is a directory row on both surfaces. The stat runs only
 * for a link, so every other entry still costs one `readdir` and nothing else.
 */
export function listDirectory(dir: string): DirectoryListing {
	try {
		const entries: DirectoryEntry[] = [];
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (excluded(entry.name)) continue;
			const directory = entry.isSymbolicLink()
				? (statSync(`${dir}${sep}${entry.name}`, {
						throwIfNoEntry: false,
					})?.isDirectory() ?? false)
				: entry.isDirectory();
			entries.push({ name: entry.name, directory });
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		return {
			dir,
			entries: entries.slice(0, DIRECTORY_ENTRY_LIMIT),
			truncated: entries.length > DIRECTORY_ENTRY_LIMIT,
		};
	} catch (error) {
		return {
			dir,
			entries: [],
			truncated: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** A path's fully resolved spelling, or `null` when it will not resolve. */
export function realPathOrNull(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

/**
 * The harness's own containment verdict, over two already-resolved paths.
 *
 * `undefined` — not `false` — when the workspace root is unknown, so a caller
 * that cannot ask the question paints nothing rather than claiming either
 * verdict. `true` is the fail-closed answer for a target that will not resolve,
 * matching `_resolve_workspace_path`: a path that cannot be shown to be inside
 * the workspace is treated as outside, which is also what the approval gate does
 * with one.
 */
export function outsideWorkspace(
	realTarget: string | null,
	realRoot: string | null,
): boolean | undefined {
	if (realRoot === null) return undefined;
	if (realTarget === null) return true;
	return realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`);
}
