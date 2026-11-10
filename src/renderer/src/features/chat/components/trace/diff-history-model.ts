/**
 * The FULL historical diff of a write/edit call, beyond its inline preview.
 *
 * Why this exists: the core stores at most 200 rendered rows of a diff inline
 * (`details.diff`, `_diff_details` in tools/builtin.py) and counts the rest in
 * `details.diff_truncated_rows`. Since the full-diff archive, a call whose
 * preview omitted rows also carries `details.diff_full`, a small descriptor
 * naming an immutable, ALREADY-REDACTED artifact of the whole diff as it was
 * when the call ran. The UI reads that artifact one bounded page at a time over
 * the desktop plane (`sessions.diff` / `subagents.diff`), so neither the
 * transcript payload nor the DOM ever holds the whole thing.
 *
 * Every wire shape the renderer depends on is parsed HERE and nowhere else, so
 * a contract rename is a one-file change and a malformed frame degrades to an
 * honest state instead of a crash. The contract (core, frozen for this PR):
 *
 * - descriptor `details.diff_full`, present only when the preview omitted rows:
 *   `{v: 1, state: "archived", rows: N, digest}` or
 *   `{v: 1, state: "oversized" | "withheld" | "unavailable"}`. ABSENT on a
 *   truncated preview means the call predates the archive: `not_recorded`.
 *   The digest is the core's own reference; the client never sends it — the
 *   routes resolve the artifact from session + call id.
 * - page `{state, start, offset, total_rows, rows[], hunk_header, next_start,
 *   next_offset, clipped_rows[]}`. A non-archived state answers 200 with no rows; an unknown
 *   session/child/call answers 404 `diff_not_found`; bad paging answers 422.
 *   Pages are bounded by BOTH 200 rows and a byte budget, so the route's own
 *   cursor is the only honest one — never `start + limit`. v1 extension: the
 *   cursor is the PAIR (`next_start`, `next_offset`), echoed as (`start`,
 *   `offset`). A row too large for the budget is CONTINUED on the next page,
 *   never clipped, so every accepted character is reachable; `clipped_rows`
 *   stays on the wire for compatibility and is `[]` from the current core.
 *
 * Colours are not decided here: rows reuse `diffLineKind`, the same classifier
 * (and so the same green/red/muted inks) the inline preview uses.
 */

import { t } from "@shared/i18n";
import { DESKTOP_DIFF_PAGE_MAX_ROWS } from "../../../../../../shared/desktop-contract";
import { type DiffLineKind, diffLineKind } from "./tool-row-model";

export { DESKTOP_DIFF_PAGE_MAX_ROWS };

/** Trailing whitespace, dropped per row as the preview's `rstrip()` does. */
const TRAILING_WHITESPACE = /\s+$/u;

/** What `details.diff_full` says about the full diff, normalised. */
export type DiffFullDescriptor =
	| { state: "archived"; rows: number }
	| { state: "oversized" | "withheld" | "unavailable" };

const DESCRIPTOR_UNAVAILABLE_STATES = new Set([
	"oversized",
	"withheld",
	"unavailable",
]);

/**
 * Parse `details.diff_full`. `null` means "no descriptor": either the preview
 * was complete (nothing to page) or the call predates the archive — the caller
 * already knows which from `diffTruncatedRows`.
 *
 * Strict on purpose: an unknown version or state is treated as `unavailable`
 * rather than guessed at, because a guessed `archived` would offer a control
 * whose every press 404s. The digest is NOT retained: nothing in the renderer
 * may send it, so nothing holds it.
 */
export function parseDiffFull(value: unknown): DiffFullDescriptor | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (raw.v !== 1) return { state: "unavailable" };
	if (raw.state === "archived") {
		const rows = raw.rows;
		if (typeof rows === "number" && Number.isSafeInteger(rows) && rows >= 0) {
			return { state: "archived", rows };
		}
		return { state: "unavailable" };
	}
	if (
		typeof raw.state === "string" &&
		DESCRIPTOR_UNAVAILABLE_STATES.has(raw.state)
	) {
		return { state: raw.state as "oversized" | "withheld" | "unavailable" };
	}
	return { state: "unavailable" };
}

/**
 * The record's descriptor across frames, with the counters' "absent vs
 * stated" rule (`preferDiffTruncatedRows`): a frame without `details` (the
 * live-event budget strips them) keeps what the row had; a frame WITH details
 * is the producer's statement, and a missing key there states "none".
 */
export function preferDiffFull(
	details: unknown,
	previous: DiffFullDescriptor | null,
): DiffFullDescriptor | null {
	if (!details || typeof details !== "object") return previous;
	return parseDiffFull((details as Record<string, unknown>).diff_full);
}

export type DiffPageState =
	| "archived"
	| "oversized"
	| "withheld"
	| "unavailable"
	| "evicted"
	| "not_recorded"
	| "inline";

const PAGE_STATES: ReadonlySet<string> = new Set<DiffPageState>([
	"archived",
	"oversized",
	"withheld",
	"unavailable",
	"evicted",
	"not_recorded",
	"inline",
]);

export type DiffPage = {
	state: DiffPageState;
	start: number;
	/**
	 * Server-issued position inside row `start`'s body where this page begins
	 * (0 = the row's start). Opaque: the core counts Unicode code points, so the
	 * renderer only echoes it and never slices text by it.
	 */
	offset: number;
	totalRows: number;
	/**
	 * Row FRAGMENTS, each carrying its row's own leading diff marker so the
	 * classifier still paints it green/red. The first is a continuation when
	 * `offset > 0`; the last is partial when `nextOffset > 0`.
	 */
	rows: string[];
	hunkHeader: string | null;
	/** Resume PAIR; both `null` only at the true end of the artifact. */
	nextStart: number | null;
	nextOffset: number | null;
	clippedRows: number[];
};

/** A page position: row index plus the server's offset inside that row. */
export type DiffCursor = { start: number; offset: number };

/** Lexicographic order of two cursors (row first, then offset). */
export function compareCursor(a: DiffCursor, b: DiffCursor): number {
	return a.start !== b.start ? a.start - b.start : a.offset - b.offset;
}

/** Where the page after `page` begins, or `null` at the end. */
export function nextCursor(page: DiffPage): DiffCursor | null {
	return page.nextStart === null || page.nextOffset === null
		? null
		: { start: page.nextStart, offset: page.nextOffset };
}

function nonNegativeInt(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

/**
 * Parse one page `result`. Returns `null` for a frame that does not honour the
 * contract — the caller shows the error state with Retry rather than painting
 * text whose position it cannot trust.
 *
 * Cursor rules: pages are CONTIGUOUS slices of the accepted text, addressed
 * by the pair (`start`, `offset`) — a row longer than the byte budget is
 * continued on the next page instead of clipped (round 2: clipping dropped
 * the accepted tail, which the operator's "see all of them" rules out).
 *
 * - an archived page echoes the requested pair exactly;
 * - a completed last row resumes at (`start + rows.length`, 0);
 * - a partial last row resumes at (`start + rows.length - 1`, `next_offset > 0`),
 *   and a page that is a single fragment of one row must move its offset
 *   FORWARD — otherwise Next would loop on the same text;
 * - `next_start`/`next_offset` are both `null` only when the page ends at
 *   `total_rows` — otherwise rows past it would be unreachable.
 *
 * No arbitrary cap is added: the only bounds are the wire's row budget and
 * safe integers.
 */
export function parseDiffPage(
	value: unknown,
	requested?: DiffCursor,
): DiffPage | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.state !== "string" || !PAGE_STATES.has(raw.state)) return null;
	const start = nonNegativeInt(raw.start);
	const totalRows = nonNegativeInt(raw.total_rows);
	if (start === null || totalRows === null) return null;
	if (
		!Array.isArray(raw.rows) ||
		!raw.rows.every((row) => typeof row === "string")
	) {
		return null;
	}
	const rows = raw.rows as string[];
	if (rows.length > DESKTOP_DIFF_PAGE_MAX_ROWS) return null;
	if (start + rows.length > totalRows && rows.length > 0) return null;
	// `offset`/`next_offset` are absent on a non-archived answer; there they
	// mean "nothing to resume" and default to 0 / null.
	const offset = raw.offset === undefined ? 0 : nonNegativeInt(raw.offset);
	if (offset === null) return null;
	const nextStartRaw = raw.next_start ?? null;
	const nextOffsetRaw =
		raw.next_offset === undefined && nextStartRaw !== null
			? 0
			: (raw.next_offset ?? null);
	let nextStart: number | null = null;
	let nextOffset: number | null = null;
	if (nextStartRaw !== null || nextOffsetRaw !== null) {
		nextStart = nonNegativeInt(nextStartRaw);
		nextOffset = nonNegativeInt(nextOffsetRaw);
		// Half a cursor is no cursor.
		if (nextStart === null || nextOffset === null) return null;
		if (nextStart > totalRows) return null;
	}
	if (raw.state === "archived") {
		if (requested) {
			if (start !== requested.start || offset !== requested.offset) return null;
		}
		if (offset > 0 && rows.length === 0) return null;
		if (nextStart === null) {
			if (start + rows.length !== totalRows) return null;
		} else if (nextOffset === 0) {
			if (rows.length === 0 || nextStart !== start + rows.length) return null;
		} else {
			if (rows.length === 0 || nextStart !== start + rows.length - 1) {
				return null;
			}
			if (rows.length === 1 && (nextOffset as number) <= offset) return null;
		}
	} else if (nextStart !== null) {
		return null;
	}
	const hunkHeader =
		typeof raw.hunk_header === "string" ? raw.hunk_header : null;
	// Kept for wire compatibility; an accepted archive continues long rows
	// instead of clipping them, so this is `[]` from the current core.
	const clipped = Array.isArray(raw.clipped_rows)
		? raw.clipped_rows.filter(
				(row): row is number =>
					nonNegativeInt(row) !== null &&
					(row as number) >= start &&
					(row as number) < start + rows.length,
			)
		: [];
	return {
		state: raw.state as DiffPageState,
		start,
		offset,
		totalRows,
		rows,
		hunkHeader,
		nextStart,
		nextOffset,
		clippedRows: clipped,
	};
}

export type DiffPageLine = {
	/** The row's ABSOLUTE index in the artifact. */
	index: number;
	text: string;
	kind: DiffLineKind;
	clipped: boolean;
	/** This fragment resumes a row the previous page began. */
	continued: boolean;
	/** This row goes on past the end of the page. */
	continues: boolean;
};

/**
 * Rows to paint for one page.
 *
 * The artifact keeps the nameless `---`/`+++` file-header pair as rows 0-1
 * (it is the redacted diff verbatim); the preview drops that pair POSITIONALLY
 * (`stripDiffHeader`), so the pager drops it at the very start (row 0, offset
 * 0) only — a `---` row deeper in the diff is a removed line and must stay.
 *
 * A fragment keeps its row's marker, so `diffLineKind` colours a continued
 * `+` row green on every page it spans. Trailing whitespace is dropped only at
 * a row's REAL end: inside a split row it is accepted text that continues.
 *
 * `hunkHeader` is the enclosing `@@` row the route copied from the redacted
 * artifact for a page that starts mid-hunk; it is shown pinned above the rows
 * so line context survives a page boundary, and is NOT counted as a row.
 */
export function diffPageLines(page: DiffPage): {
	lines: DiffPageLine[];
	hunkHeader: string | null;
} {
	const skip =
		page.start === 0 && page.offset === 0 ? namelessHeaderRows(page.rows) : 0;
	const clipped = new Set(page.clippedRows);
	const lastOffset = page.rows.length - 1;
	const lines = page.rows.slice(skip).map((raw, at) => {
		const offset = at + skip;
		const index = page.start + offset;
		const continues = offset === lastOffset && (page.nextOffset ?? 0) > 0;
		const text = continues ? raw : raw.replace(TRAILING_WHITESPACE, "");
		return {
			index,
			text,
			kind: diffLineKind(text),
			clipped: clipped.has(index),
			continued: offset === 0 && page.offset > 0,
			continues,
		};
	});
	const first = lines[0];
	const hunkHeader =
		page.hunkHeader && first && first.kind !== "hunk" ? page.hunkHeader : null;
	return { lines, hunkHeader };
}

/**
 * Where Last starts. Pages are byte-bounded, so `total - limit` may stop short
 * of the end; the hook follows the route's cursor from here until the page
 * reaches the true end, and as a last resort asks for (`total - 1`, 0) and
 * follows THAT row's continuations, so a huge final row shows its real end.
 */
export function lastPageStart(totalRows: number): number {
	return Math.max(0, totalRows - DESKTOP_DIFF_PAGE_MAX_ROWS);
}

/**
 * Where Prev's walk starts when the reader has no Next history (after Last,
 * or at the first page of a backwards walk): one full row budget back. A
 * byte-bounded page from there may end before the current position, so the
 * pager follows the cursor from it until it covers the position, then cuts
 * the covering page (`pageEndingBefore`) — Prev never skips text.
 */
export function previousPageStart(start: number): number {
	return Math.max(0, start - DESKTOP_DIFF_PAGE_MAX_ROWS);
}

/**
 * How many leading artifact rows are the nameless `---`/`+++` pair the pager
 * hides (2) or none (0). Decided from rows 0-1 only — the same positional rule
 * as `diffPageLines`/`stripDiffHeader`.
 */
export function namelessHeaderRows(rows: readonly string[]): 0 | 2 {
	return rows[0]?.replace(TRAILING_WHITESPACE, "") === "---" &&
		rows[1]?.replace(TRAILING_WHITESPACE, "") === "+++"
		? 2
		: 0;
}

/**
 * Inclusive 1-based range and total the reader can SEE (review round 1,
 * R3/U4/Q3): the artifact counts the hidden nameless header pair, the painted
 * rows do not, so "Rows 1–N of T" subtracts it. Counts are LOGICAL rows: a
 * row split across pages is the same row on each, never a new one.
 */
export function pageRange(
	page: DiffPage,
	headerRows: number,
): { first: number; last: number; total: number } {
	const first = Math.max(page.start, headerRows) - headerRows + 1;
	const last = page.start + page.rows.length - headerRows;
	return { first, last, total: Math.max(0, page.totalRows - headerRows) };
}

/**
 * The part of `answer` that lies before `before`: Prev after a jump must end
 * exactly where the reader's page begins (round 1, U2/Q3: it used to repaint
 * rows the reader had just seen).
 *
 * The cut is ROW-aligned on purpose. A cursor inside a row is a code-point
 * offset only the core can apply, so the renderer never slices a fragment by
 * it: when `before` is mid-row, the cut page ends before that row and its
 * cursor resumes at (row, 0). Nothing is skipped; at most the head of that one
 * row is shown again on Next.
 */
export function pageEndingBefore(
	answer: DiffPage,
	before: DiffCursor,
): DiffPage {
	const next = nextCursor(answer);
	if (next && compareCursor(next, before) <= 0) return answer;
	// A page that starts inside the very row we must end before has nothing
	// row-aligned to keep; the caller then shows it as-is (it IS the page
	// before, fragment-wise) rather than an empty page.
	const keep = before.start - answer.start;
	if (keep <= 0) return answer;
	return {
		...answer,
		rows: answer.rows.slice(0, keep),
		nextStart: before.start,
		nextOffset: 0,
		clippedRows: answer.clippedRows.filter((row) => row < before.start),
	};
}

// --- copy ------------------------------------------------------------------

export function diffFullViewLabel(rows: number): string {
	return t("ui.chat.canonical.tool_row.diff.full.view", { count: rows });
}
export function diffFullBackLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.back");
}
export function diffFullRangeLabel(
	first: number,
	last: number,
	total: number,
): string {
	return t("ui.chat.canonical.tool_row.diff.full.range", {
		first,
		last,
		total,
	});
}
export function diffFullNavLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.nav");
}
export function diffFullFirstLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.first");
}
export function diffFullPrevLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.prev");
}
export function diffFullNextLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.next");
}
export function diffFullLastLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.last");
}
export function diffFullLoadingLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.loading");
}
export function diffFullErrorLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.error");
}
export function diffFullRetryLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.retry");
}
export function diffFullEmptyLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.empty");
}
export function diffFullClippedLabel(count: number): string {
	return t("ui.chat.canonical.tool_row.diff.full.clipped", { count });
}
export function diffFullClippedRowLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.clipped_row");
}
/** Marks a fragment that resumes a row begun on the previous page. */
export function diffFullContinuedLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.continued");
}
/** Marks a row whose text goes on past the end of this page. */
export function diffFullContinuesLabel(): string {
	return t("ui.chat.canonical.tool_row.diff.full.continues");
}

/**
 * The one sentence for every state in which there are no rows to page:
 * descriptor states (`oversized`/`withheld`/`unavailable`), page-only states
 * (`evicted`, `not_recorded`, `inline`) and the route's 404 (`not_found`).
 */
export type DiffFullNotice = Exclude<DiffPageState, "archived"> | "not_found";

export function diffFullNoticeLabel(notice: DiffFullNotice): string {
	switch (notice) {
		case "oversized":
			return t("ui.chat.canonical.tool_row.diff.full.oversized");
		case "withheld":
			return t("ui.chat.canonical.tool_row.diff.full.withheld");
		case "unavailable":
			return t("ui.chat.canonical.tool_row.diff.full.unavailable");
		case "evicted":
			return t("ui.chat.canonical.tool_row.diff.full.evicted");
		case "not_recorded":
			return t("ui.chat.canonical.tool_row.diff.full.not_recorded");
		case "inline":
			return t("ui.chat.canonical.tool_row.diff.full.inline");
		case "not_found":
			return t("ui.chat.canonical.tool_row.diff.full.not_found");
	}
}
