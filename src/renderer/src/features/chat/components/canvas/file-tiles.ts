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
 *   chrome.
 * - **`missing` is a receipt, not a filter.** A file the agent wrote and the
 *   user later deleted stays in the list with a muted "Not found" under its
 *   name and a working Copy path; dropping it would recreate the original
 *   complaint from the other side.
 */

export type FileTile = {
	/** The document as stored, so the click handler keeps its identity. */
	document: CanvasDocument;
	/** The name line, read from the path rather than the title. */
	name: string;
	/** The directory line; only meaningful when `showParent` is true. */
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
		const parent =
			parentDirectory(document.path) ?? parentDirectory(document.title);
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
