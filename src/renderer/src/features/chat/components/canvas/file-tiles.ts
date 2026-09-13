import type { CanvasDocument } from "@features/chat/types/canvas";
import { getFileName } from "@features/chat/utils/get-file-name";

/**
 * The Files grid's view model, as a pure function.
 *
 * The grid's rules — order, the basename-collision line, which tiles report
 * themselves missing — used to live inside a 463-line component wrapped in a
 * `useMemo`, where the only way to ask "what does two `report.pdf`s in two
 * directories look like" was to render the whole panel. They are decisions
 * about a list, so they are a function of a list.
 *
 * The three rules, and the reasoning each one replaces:
 *
 * - **Order is append order (first mention), never re-sorted.** A stat answer
 *   arriving must not move a tile under the user's pointer; a grid that
 *   re-orders itself between two frames reads as a bug. Missing tiles stay in
 *   place for the same reason — the panel's job is to say what the agent
 *   touched, in the order it touched it.
 * - **Files that share a basename keep their own tile and gain a directory
 *   line.** The panel used to collapse them by basename (`filesByBaseName`),
 *   which silently merged `~/a/report.pdf` with `~/b/report.pdf` — one file
 *   standing in for two. Identity is the resolved path; a name clash is shown,
 *   not hidden. The second line appears ONLY when a clash exists, so eight
 *   tiles that happen to be called `notes.md` do not carry eight lines of
 *   chrome. The line is SHORTENED FROM THE LEFT (`displayParent`), because the
 *   part that tells two same-named files apart is the segment nearest the file.
 * - **`missing` is a receipt, not a filter.** A file the agent wrote and the
 *   user later deleted stays in the list with a muted receipt under its name and
 *   a working Copy path; dropping it would recreate the original complaint from
 *   the other side.
 */

export type FileTile = {
	/** The document as stored, so the click handler keeps its identity. */
	document: CanvasDocument;
	/** The name line, read from the path rather than the title. */
	name: string;
	/**
	 * The directory line as it is PAINTED; only meaningful when `showParent` is
	 * true. Shortened from the left — see `displayParent` — so the segment that
	 * disambiguates two same-named files survives the tile's width.
	 */
	parent: string | null;
	/** Two visible tiles share this basename, so the dir line is drawn. */
	showParent: boolean;
	/** The probe reported no file at this path (or the read failed). */
	missing: boolean;
};

/**
 * The directory a path sits in, with a `~`-relative path kept readable.
 *
 * The full directory, not the immediate parent's basename: two clashing
 * `report.pdf` under `~/work/reports` and `~/archive/reports` would still be
 * indistinguishable if only "reports" were shown, and the tile truncates the
 * line anyway. Returns `null` for anything that is not a filesystem path, so a
 * data URI or a bare name gets no second line.
 */
export function parentDirectory(path: string): string | null {
	if (path.startsWith("data:")) return null;
	const normalized = path.startsWith("file://")
		? path.slice("file://".length)
		: path;
	const separator = Math.max(
		normalized.lastIndexOf("/"),
		normalized.lastIndexOf("\\"),
	);
	if (separator <= 0) return null;
	return normalized.slice(0, separator);
}

/**
 * How many characters the directory line has room for.
 *
 * Measured off the committed frames rather than guessed: at the panel width the
 * evidence set is captured at, a tile's line is ~129 px of `text-mono-sm`, which
 * is ~22 characters. It is a character budget rather than a pixel measurement
 * because the tile's width follows the dock, and the one thing that must not
 * change with it is WHICH part of the path is kept.
 */
export const PARENT_BUDGET = 22;

/** A path separator, either platform's. Hoisted for `useTopLevelRegex`. */
const SEPARATOR = /[/\\]/;

/**
 * The shape of a home directory at the head of a path: `/Users/<name>`,
 * `/home/<name>`, `C:\Users\<name>`, or `/root`. The lookahead requires a
 * separator after it, so `/Users/dana` with nothing after it does NOT match -
 * dropping to `~` there would lose the name that distinguishes it from
 * `/Users/sam`. Hoisted for `useTopLevelRegex`.
 */
const HOME_PREFIX =
	/^(?:(?:\/Users|\/home|[A-Za-z]:\\Users)[/\\][^/\\]+|\/root)(?=[/\\])/;

/**
 * The home prefix, spelled the way the app itself spells it.
 *
 * `~`-abbreviating is not cosmetic here: `/Users/dana/work/reports` spends 12 of
 * a 22-character budget on the part every tile has in common, which is how two
 * colliding `summary.md` tiles came to read `/Users/dana/work/rep…` and
 * `/Users/dana/work/arch…` — the distinguishing segment cut off, and the line
 * unable to do the one thing it exists for. The shapes below are the platforms'
 * home layouts, not a list of user names: nothing here is specific to this
 * machine, and a path that does not match one is returned unchanged.
 *
 * There is no `homedir()` to ask: the renderer runs with `contextIsolation` and
 * no node, and the panel's whole content is paths the transcript wrote, which
 * may name another machine's home over a mounted share. So the rule is the
 * SHAPE of a home directory, applied at the front of the path only.
 */
function abbreviateHome(path: string): string {
	const match = HOME_PREFIX.exec(path);
	if (!match) return path;
	// Only a path that CONTINUES past the home directory is abbreviated: the
	// lookahead above is what makes the account-name form safe.
	return `~${path.slice(match[0].length)}`;
}

/**
 * The directory line, shortened so the segment that disambiguates survives.
 *
 * Why this exists rather than a CSS ellipsis. `truncate` cuts the END, so a
 * 129 px line spent on `/Users/dana/work/reports` and `/Users/dana/work/archive`
 * painted `/Users/dana/work/rep…` and `/Users/dana/work/arch…`: the 17 shared
 * characters survived and the three that told the files apart did not, and the
 * tile's tooltip showed the NAME, so nothing on the tile could recover it. The
 * line exists for a collision, so it has to resolve one (design round 1, D1).
 *
 * So: abbreviate the home prefix, and if it still does not fit, drop leading
 * segments and mark the cut with a leading `…`, which is where the information
 * was dropped. A path whose own final segment is longer than the budget is cut
 * from the left too, for the same reason — the tail of a long name is still more
 * informative than its head.
 */
export function displayParent(
	parent: string,
	budget: number = PARENT_BUDGET,
): string {
	const abbreviated = abbreviateHome(parent);
	if (abbreviated.length <= budget) return abbreviated;
	const segments = abbreviated.split(SEPARATOR).filter(Boolean);
	const kept: string[] = [];
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const next = [segments[index], ...kept];
		if (`…/${next.join("/")}`.length > budget) break;
		kept.unshift(segments[index]);
	}
	if (kept.length > 0) return `…/${kept.join("/")}`;
	return `…${abbreviated.slice(-(budget - 1))}`;
}

/**
 * Build the grid's tiles.
 *
 * `showParent` is computed from the whole visible set rather than per tile, so
 * the same list always produces the same grid: a document whose availability
 * changes from in-flight to missing keeps its line, and no tile's chrome
 * depends on the order the probe happens to answer in.
 */
export function buildFileTiles(documents: CanvasDocument[]): FileTile[] {
	const basenameCounts = new Map<string, number>();
	for (const document of documents) {
		const name = getFileName(document.path);
		basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
	}

	return documents.map((document) => {
		const name = getFileName(document.path);
		const directory =
			parentDirectory(document.path) ?? parentDirectory(document.title);
		const parent = directory === null ? null : displayParent(directory);
		return {
			document,
			name,
			parent,
			showParent: (basenameCounts.get(name) ?? 0) > 1 && parent !== null,
			// Absent `availability` means the probe has not answered yet, which is
			// not the same as "missing": the tile renders normally until a probe
			// says otherwise.
			missing: document.availability === "missing",
		};
	});
}
