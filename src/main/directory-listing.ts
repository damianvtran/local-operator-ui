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
 *    none. The divergence is stated in the pull request's own "Not addressed"
 *    section — where a reviewer reads it — rather than left as a pointer in a
 *    comment that nothing links to (review round 1, N2): the behaviour is fine,
 *    because a gitignored path still expands server-side.)
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
 *
 * 4. **The app's one path rule** (`resolveUserPath`), which every local-file
 *    handler resolves through and which therefore belongs here rather than in
 *    `src/main/index.ts`: `index.ts` boots Electron on import, so a rule living
 *    there cannot be executed by a test, and this one is load-bearing for BOTH
 *    the picker's listing and the chip's probe (`probe-files`) — the two calls a
 *    picker makes per keystroke. It takes `home` as an argument for that same
 *    reason: the caller supplies `app.getPath("home")`, and the rule stays pure.
 */

import { realpathSync, statSync } from "node:fs";
import { opendir } from "node:fs/promises";
import { join, sep } from "node:path";
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
 * The app's one path rule: `~`, a `~/…` prefix, and a relative path against a
 * working directory. Used by EVERY local-file handler (`read-file`,
 * `read-file-bytes`, `probe-files`, `list-directory`), which is what keeps the
 * picker's listing and the chip's probe from disagreeing about which file a
 * token names.
 *
 * THE CWD RESOLVES THROUGH THIS SAME RULE, and that is a fix rather than a
 * refactor. It used to expand only a `cwd` that matched `~/…`, so the literal
 * `"~"` a brand-new chat's draft carries fell through and was joined
 * `/`. A relative listing then became `scandir '~'` — ENOENT, zero rows — and a
 * relative probe became `~/README.md` — `exists: false`, no chip. The feature's
 * only entry point failed on the first attempt of every user who had not yet
 * chosen a directory.
 */
export function resolveUserPath(
	filePath: string,
	cwd: string | undefined,
	home: string,
): string {
	if (filePath === "~") return home;
	if (filePath.startsWith("~/")) return join(home, filePath.slice(2));
	if (cwd && !filePath.startsWith("/")) {
		const base =
			cwd === "~" || cwd.startsWith("~/")
				? resolveUserPath(cwd, undefined, home)
				: cwd;
		return join(base, filePath);
	}
	return filePath;
}

/**
 * Ceiling on the candidate list one listing builds, before the alphabet is
 * applied to it.
 *
 * The harness's own `SCAN_CANDIDATE_LIMIT` (`references.py`), copied with the
 * reason it gives: the picker windows to 8 rows, so the ROWS were never the
 * cost — this stops a pathological directory from making the SCAN the cost on a
 * keystroke path.
 *
 * The bound is on the WORK, not on the answer. `readdirSync` plus a
 * `localeCompare` sort of everything measured **236ms** on a 200,000-entry
 * directory (about fourteen dropped frames of the whole app window, on a
 * 60ms-debounced keystroke path) to answer with 200 rows. Neither half of that
 * scales here: the scan is ASYNC (see `listDirectory`), so the read happens off
 * the main thread and the event loop that serves every other IPC keeps running;
 * the sort sees at most twice this many names, never the directory; and the
 * per-row `stat` runs at most this many times however large the directory is.
 *
 * Measured on the same 200,000-entry directory, before and after (one process,
 * one directory, a 16ms heartbeat running throughout): the synchronous unbounded
 * shape blocked the event loop for **295ms**; this one's longest block is
 * **18.9ms** — about one frame instead of eighteen — for the same 200 rows in the
 * same order and a wall time within noise of the old one. The finding was about
 * the BLOCK, and that is the number that moved.
 */
export const DIRECTORY_SCAN_LIMIT = 2000;

/** One candidate: the dirent's two answers, with a link's kind left unresolved. */
type Candidate = { name: string; directory: boolean; link: boolean };

/**
 * Keep the alphabetically-smallest `DIRECTORY_SCAN_LIMIT` names, in place.
 *
 * Plain `<` rather than `localeCompare` because this runs on the scanning path
 * and only has to be a CONSISTENT order, not the display order: the retained set
 * is re-sorted with the collator once, after the scan, at a size this cap makes
 * fixed. Choosing here is what keeps the answer the same rows a
 * sort-then-truncate returned.
 */
function retainSmallest(candidates: Candidate[]): Candidate[] {
	candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return candidates.slice(0, DIRECTORY_SCAN_LIMIT);
}

/**
 * One directory's listable entries, sorted by name. Never throws.
 *
 * SORTED BY NAME, like the harness, so the renderer's own ranking starts from a
 * deterministic order and its alphabetical tiebreak cannot depend on `readdir`
 * order. `dir` must already have been through the path rule (`resolveUserPath`),
 * so there is one resolver in this process.
 *
 * ASYNC, AND THAT IS THE POINT RATHER THAN A STYLE (review round 1, M2). This
 * answers a 60ms-debounced keystroke from the renderer, on the process that serves
 * EVERY other IPC in the app, so a synchronous read of a pathological directory
 * blocks the whole window: measured at **236ms** for a 200,000-entry directory,
 * about fourteen dropped frames. `fs.readdirSync` was the shape that did it.
 * `opendir`'s async iteration reads in batches and yields between them, so the
 * blocking window is one batch rather than one directory, and the candidate cap
 * below bounds the CPU that follows.
 *
 * A symlink is asked about with `statSync` rather than answered from the dirent,
 * because `stat` follows the link and the harness's `DirEntry.is_dir()` does too
 * — a symlinked directory is a directory row on both surfaces. The stat runs
 * only for a link AND only for a row that survived the candidate cap, so a
 * directory of 200,000 symlinks costs the cap's worth of stats, not 200,000.
 *
 * `truncated` is true whenever anything was withheld, from either bound: the
 * scan cap or `DIRECTORY_ENTRY_LIMIT`.
 */
export async function listDirectory(dir: string): Promise<DirectoryListing> {
	try {
		let candidates: Candidate[] = [];
		let overflow = false;
		const stream = await opendir(dir);
		/*
		 * No `finally { close() }`: `fs.Dir`'s async iterator closes the handle
		 * itself when the loop ends, and closing an already-closed handle throws
		 * (`Directory handle was closed`), which the `catch` below would then report
		 * as an unreadable folder. An abrupt exit — a break, or a throw out of the
		 * loop — calls the iterator's own `return()`, which closes it the same way.
		 */
		for await (const entry of stream) {
			if (excluded(entry.name)) continue;
			candidates.push({
				name: entry.name,
				directory: entry.isDirectory(),
				link: entry.isSymbolicLink(),
			});
			if (candidates.length >= DIRECTORY_SCAN_LIMIT * 2) {
				overflow = true;
				candidates = retainSmallest(candidates);
			}
		}
		candidates.sort((a, b) => a.name.localeCompare(b.name));
		const kept = candidates.slice(0, DIRECTORY_ENTRY_LIMIT);
		const entries: DirectoryEntry[] = kept.map((candidate) => ({
			name: candidate.name,
			directory: candidate.link
				? (statSync(join(dir, candidate.name), {
						throwIfNoEntry: false,
					})?.isDirectory() ?? false)
				: candidate.directory,
		}));
		return {
			dir,
			entries,
			// Either bound withheld something. `overflow` is the scan cap — which
			// means the kept set is the smallest ALPHABETICAL slice of a directory
			// nobody finished reading — and the second term is the answer's own
			// 200-row limit.
			truncated: overflow || candidates.length > DIRECTORY_ENTRY_LIMIT,
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
