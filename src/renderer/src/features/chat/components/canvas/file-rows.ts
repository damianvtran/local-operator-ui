import type {
	CanvasDocument,
	CanvasDocumentType,
} from "@features/chat/types/canvas";
import { stripFileUrl } from "@features/chat/utils/canvas-document";
import { getFileName } from "@features/chat/utils/get-file-name";
import { formatByteSize } from "@features/chat/utils/message-budget";
/*
 * The `ui/` barrel is deliberately not used here, and this is the only reason:
 * `fold` is the app's one case- and accent-insensitive normaliser, the barrel
 * re-exports it beside about forty React components, and this module is a PURE
 * view model that a node test bundles whole (`scripts/mentioned-files.test.mjs`).
 * Importing the barrel would drag the primitive layer into that bundle to get
 * one string function; the direct import is the same shipped code.
 */
import { fold } from "@shared/components/ui/searchable-select";

/**
 * The Files list's view model, as pure functions.
 *
 * The rules — order, the basename-collision line, which rows report themselves
 * missing — used to live inside the panel component wrapped in a `useMemo`,
 * where the only way to ask "what do two `report.pdf`s in two directories look
 * like" was to render the whole panel. They are decisions about a list, so they
 * are a function of a list. The search and the kind filter joined them for the
 * same reason: a rule that only exists inside a component is a rule nothing can
 * fail.
 *
 * The three rules the grid established, each replacing a defect, all survive
 * verbatim in list form:
 *
 * - **Order is append order (first mention), never re-sorted.** A stat answer
 *   arriving must not move a row under the user's pointer; a list that
 *   re-orders itself between two frames reads as a bug. Missing rows stay in
 *   place for the same reason — the panel's job is to say what the agent
 *   touched, in the order it touched it. The search and the filter are FILTERS,
 *   not sorts: they narrow the same order rather than producing a new one.
 * - **Files that share a basename keep their own row and gain a directory
 *   line.** The panel used to collapse them by basename (`filesByBaseName`),
 *   which silently merged `~/a/report.pdf` with `~/b/report.pdf` — one file
 *   standing in for two. Identity is the resolved path; a name clash is shown,
 *   not hidden. The line appears ONLY when a clash exists: eight rows that
 *   happen to be called `notes.md` must not carry eight lines of chrome, and
 *   the rendered frames of the alternative (a directory on every row at the
 *   dock's 400px end) truncated two of seven names to make room. The line is
 *   SHORTENED FROM THE LEFT (`displayParent`), because the part that tells two
 *   same-named files apart is the segment nearest the file.
 * - **`missing` is a receipt, not a filter.** A file the agent wrote and the
 *   user later deleted stays in the list with a muted receipt and a working
 *   Copy path; dropping it would recreate the original complaint from the other
 *   side. It is never hidden by default, and clicking it still re-probes once
 *   and explains rather than opening nothing.
 */

/**
 * The directory a path sits in, with a `~`-relative path kept readable.
 *
 * The full directory, not the immediate parent's basename: two clashing
 * `report.pdf` under `~/work/reports` and `~/archive/reports` would still be
 * indistinguishable if only "reports" were shown, and the line truncates the
 * path anyway. Returns `null` for anything that is not a filesystem path, so a
 * data URI or a bare name gets no directory at all.
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
 * How many characters the directory line has room for: 22.
 *
 * Measured off the committed frames rather than guessed. It was carried over
 * from the tile for the row and RE-MEASURED there rather than inherited: the
 * row's line is the same `text-mono-sm`, and at the narrow end of the dock
 * (~370px of row, with the collision's row also carrying a name and the actions
 * slot) the directory has ~129px, which is ~22 characters of that step. It is a
 * character budget rather than a pixel measurement because the row's width
 * follows the dock, and the one thing that must not change with it is WHICH part
 * of the path is kept.
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

/** The query's token separator. Hoisted for `useTopLevelRegex`. */
const TOKEN_SEPARATOR = /\s+/;

/**
 * The home prefix, spelled the way the app itself spells it.
 *
 * `~`-abbreviating is not cosmetic here: `/Users/dana/work/reports` spends 12 of
 * a 22-character budget on the part every row has in common, which is how two
 * colliding `summary.md` rows came to read `/Users/dana/work/rep…` and
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
 * characters survived and the three that told the files apart did not, and
 * nothing else on the row could recover it. The line exists for a collision, so
 * it has to resolve one (design round 1, D1).
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
 * The filter's groups, derived from the document type rather than from
 * extensions or twelve individual types.
 *
 * Nine groups rather than twelve types because a menu of twelve is a taxonomy
 * and a menu of nine is a filter; and derived from `CanvasDocumentType` because
 * the extension lists in `utils/file-kind.ts` already disagreed with the
 * classifier once (a HEIC row painted an image while its type said the app did
 * not know the format), so no call site gets to re-decide what "code" means.
 */
export const FILE_KIND_GROUPS = [
	{ id: "images", label: "Images" },
	{ id: "video", label: "Video" },
	{ id: "audio", label: "Audio" },
	{ id: "documents", label: "Documents" },
	{ id: "spreadsheets", label: "Spreadsheets" },
	{ id: "presentations", label: "Presentations" },
	{ id: "code", label: "Code" },
	{ id: "archives", label: "Archives" },
	{ id: "other", label: "Other" },
] as const;

export type FileKindGroup = (typeof FILE_KIND_GROUPS)[number]["id"];

/** The group a document's type belongs to. Absent type is `other`. */
export function kindGroupOf(type?: CanvasDocumentType): FileKindGroup {
	switch (type) {
		case "image":
			return "images";
		case "video":
			return "video";
		case "audio":
			return "audio";
		// Word documents sit with the reading formats, not with the code: the
		// reader's question is "is this something I read", not "what wrote it".
		case "pdf":
		case "markdown":
		case "text":
		case "document":
			return "documents";
		case "spreadsheet":
			return "spreadsheets";
		case "presentation":
			return "presentations";
		case "code":
		case "html":
			return "code";
		case "archive":
			return "archives";
		default:
			return "other";
	}
}

export type FileRow = {
	/** The document as stored, so the click handler keeps its identity. */
	document: CanvasDocument;
	/** The name line, read from the path rather than the title. */
	name: string;
	/**
	 * The directory line as it is PAINTED; only meaningful when `showParent` is
	 * true. Shortened from the left — see `displayParent` — so the segment that
	 * disambiguates two same-named files survives the row's width.
	 */
	parent: string | null;
	/** Two visible rows share this basename, so the dir line is drawn. */
	showParent: boolean;
	/** The probe reported no file at this path (or the read failed). */
	missing: boolean;
	/** Which filter group this row answers to. */
	kind: FileKindGroup;
	/**
	 * The leading visual: a real thumbnail for these kinds, a type glyph for
	 * everything else. A clip of the frame is the one thing a name cannot carry,
	 * so the media kinds keep it.
	 */
	media: "image" | "video" | null;
	/**
	 * The size label the probe's answer yields, or `null` when it did not answer.
	 *
	 * `null` is not zero: not every mention carries `sizeBytes`, and an em dash
	 * or a `0 B` for an unmeasured file would be a claim the app cannot support.
	 * The row shows nothing in that case.
	 */
	size: string | null;
	/**
	 * Everything a query is matched against, folded ONCE per row.
	 *
	 * Folded here rather than in the filter because it is a property of the row,
	 * not of the query — a 341-row list folds once per list change instead of
	 * once per keystroke.
	 */
	search: string;
};

export type FileRowsQuery = {
	/** Raw text from the field. Trimmed, whitespace-collapsed, and folded here. */
	query: string;
	/** Selected kind groups. Empty means no kind filtering. */
	kinds: readonly FileKindGroup[];
};

/**
 * The row's size slot, or `null` when there is no answer to show.
 *
 * Reuses the app's human-readable size spelling (whole KB below 1 MB, one
 * decimal above it) rather than adding a third byte formatter beside it: those
 * two existing spellings belong to a dictation counter and a memory reading, and
 * this one is already described as "the units a person reads off a Finder
 * window".
 */
export function sizeLabel(bytes?: number): string | null {
	if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
	return formatByteSize(bytes);
}

/**
 * The count statement over the list: one number, or two the moment anything
 * narrows it.
 *
 * `3 of 12 files` is the whole anti-silence mechanism. The first number is what
 * the reader is looking at, the second is the panel's own completeness claim, so
 * a query that hides a file cannot also hide that the file exists. Both numbers
 * are stated while a query or a filter is ACTIVE, even when nothing is in fact
 * hidden (`12 of 12 files`): the statement is about the control being on, which
 * is what tells the reader the list is being filtered at all.
 *
 * The singular rule is on the TOTAL, because the total is the claim about the
 * conversation: `1 of 1 file`.
 */
export function countLabel(
	visible: number,
	total: number,
	narrowed: boolean,
): string {
	const files = total === 1 ? "file" : "files";
	return narrowed ? `${visible} of ${total} ${files}` : `${total} ${files}`;
}

/**
 * The text a row is searchable by: its name, and its path in both spellings.
 *
 * The PATH half is what makes the search worth having — a query of `reports`
 * has to find `~/work/reports/march-invoice-review.md` even though the row
 * paints only the name — and it is matched against the REAL path plus the
 * `~`-abbreviated one, never against a `…/` shortening the user did not type.
 *
 * A `data:` document contributes no path: its "path" is its bytes, and folding
 * a whole base64 payload into a haystack would cost more than the panel is
 * worth. Its name (or the `Pasted file` fallback) is what it can be found by.
 */
function searchTextFor(name: string, path: string, title: string): string {
	if (path.startsWith("data:")) return fold(`${name}\n${title}`);
	const stripped = stripFileUrl(path);
	return fold(`${name}\n${stripped}\n${abbreviateHome(stripped)}`);
}

/**
 * Build the list's rows.
 *
 * `showParent` is computed from the whole visible set rather than per row, so
 * the same list always produces the same lines: a document whose availability
 * changes from in-flight to missing keeps its line, and no row's chrome depends
 * on the order the probe happens to answer in.
 */
export function buildFileRows(documents: CanvasDocument[]): FileRow[] {
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
		/*
		 * A MISSING file gets no leading visual, whatever its type.
		 *
		 * `media` was derived from the type alone, so a `missing` image or video row
		 * built a live `<img>`/`<video>` over a dead source inside its `bg-sunken`
		 * box - an empty square where every other missing row shows the type glyph,
		 * and a broken-frame icon in the app. The receipt for a file that is gone is
		 * the glyph plus the sentence in the meta slot; asking the bridge for a
		 * thumbnail of a path that no longer resolves is a request that can only
		 * fail, on every render of every row in the list.
		 */
		const missing = document.availability === "missing";
		return {
			document,
			name,
			parent,
			showParent: (basenameCounts.get(name) ?? 0) > 1 && parent !== null,
			// Absent `availability` means the probe has not answered yet, which is
			// not the same as "missing": the row renders normally until a probe
			// says otherwise.
			missing,
			kind: kindGroupOf(document.type),
			media:
				!missing && (document.type === "image" || document.type === "video")
					? document.type
					: null,
			size: sizeLabel(document.sizeBytes),
			search: searchTextFor(name, document.path, document.title || name),
		};
	});
}

/**
 * The rows a query and a filter admit, in the order they were given.
 *
 * The rule is an AND across every whitespace-separated token of the query, each
 * token matched as a substring of the row's own search text (name and path
 * alike). Two behaviours are deliberate:
 *
 * - **A filter, never a sort.** The result keeps append order and the caller
 *   never re-sorts it, so narrowing a 341-row list cannot move a row the reader
 *   had already found.
 * - **An empty query with no groups selected returns EVERY row.** There is no
 *   minimum query length and no default filter that hides files: a list that
 *   silently drops rows is the failure the panel's own scan head exists to
 *   announce, and the count line states both numbers whenever either control is
 *   narrowing anything.
 */
export function filterAndSearchRows(
	rows: FileRow[],
	{ query, kinds }: FileRowsQuery,
): FileRow[] {
	const tokens = fold(query).split(TOKEN_SEPARATOR).filter(Boolean);
	const wanted = kinds.length > 0 ? new Set(kinds) : null;
	return rows.filter((row) => {
		if (wanted && !wanted.has(row.kind)) return false;
		if (tokens.length === 0) return true;
		return tokens.every((token) => row.search.includes(token));
	});
}
