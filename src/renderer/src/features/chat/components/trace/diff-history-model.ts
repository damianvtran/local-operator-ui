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
 * - page `{state, start, total_rows, rows[], hunk_header, next_start,
 *   clipped_rows[]}`. A non-archived state answers 200 with no rows; an unknown
 *   session/child/call answers 404 `diff_not_found`; bad paging answers 422.
 *   Pages are bounded by BOTH 200 rows and a byte budget, so `next_start` is the
 *   only honest cursor — never `start + limit`. One row too large for the budget
 *   is clipped and its ABSOLUTE index listed in `clipped_rows`.
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
	totalRows: number;
	rows: string[];
	hunkHeader: string | null;
	nextStart: number | null;
	clippedRows: number[];
};

function nonNegativeInt(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

/**
 * Parse one page `result`. Returns `null` for a frame that does not honour the
 * contract — the caller shows the error state with Retry rather than painting
 * rows whose position it cannot trust.
 *
 * Cursor rules (review round 1, R1/Q2): pages are CONTIGUOUS slices, so an
 * archived page must start exactly where it was asked to (`requestedStart`),
 * its `next_start` must be exactly `start + rows.length` (a jump would skip
 * rows silently; a cursor at or behind `start` would loop Next forever), and a
 * page that says it is final (`next_start: null`) must end at `total_rows` —
 * otherwise rows past it would be unreachable. No arbitrary cap is added: the
 * only bounds are the wire's own row budget and safe integers.
 */
export function parseDiffPage(
	value: unknown,
	requestedStart?: number,
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
	let nextStart: number | null = null;
	if (raw.next_start !== null && raw.next_start !== undefined) {
		nextStart = nonNegativeInt(raw.next_start);
		if (nextStart === null || nextStart <= start || nextStart > totalRows) {
			return null;
		}
	}
	if (raw.state === "archived") {
		if (requestedStart !== undefined && start !== requestedStart) return null;
		if (nextStart !== null && nextStart !== start + rows.length) return null;
		if (
			nextStart === null &&
			rows.length > 0 &&
			start + rows.length !== totalRows
		) {
			return null;
		}
	}
	const hunkHeader =
		typeof raw.hunk_header === "string" ? raw.hunk_header : null;
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
		totalRows,
		rows,
		hunkHeader,
		nextStart,
		clippedRows: clipped,
	};
}

export type DiffPageLine = {
	/** The row's ABSOLUTE index in the artifact. */
	index: number;
	text: string;
	kind: DiffLineKind;
	clipped: boolean;
};

/**
 * Rows to paint for one page.
 *
 * The artifact keeps the nameless `---`/`+++` file-header pair as rows 0-1
 * (it is the redacted diff verbatim); the preview drops that pair POSITIONALLY
 * (`stripDiffHeader`), so the pager drops it at `start === 0` only — a `---`
 * row deeper in the diff is a removed line that starts with `--` and must stay.
 *
 * `hunkHeader` is the enclosing `@@` row the route copied from the redacted
 * artifact for a page that starts mid-hunk; it is shown pinned above the rows
 * so line context survives a page boundary, and is NOT counted as a row.
 */
export function diffPageLines(page: DiffPage): {
	lines: DiffPageLine[];
	hunkHeader: string | null;
} {
	// Same exact rule as `stripDiffHeader`: only the NAMELESS pair, both rows.
	const skip = page.start === 0 ? namelessHeaderRows(page.rows) : 0;
	const clipped = new Set(page.clippedRows);
	const lines = page.rows.slice(skip).map((raw, offset) => {
		const index = page.start + skip + offset;
		const text = raw.replace(TRAILING_WHITESPACE, "");
		return {
			index,
			text,
			kind: diffLineKind(text),
			clipped: clipped.has(index),
		};
	});
	const first = lines[0];
	const hunkHeader =
		page.hunkHeader && first && first.kind !== "hunk" ? page.hunkHeader : null;
	return { lines, hunkHeader };
}

/**
 * Where Last starts. Pages are byte-bounded, so `total - limit` may stop short
 * of the end; the hook follows `next_start` from here until the page reaches
 * the final row, and as a last resort asks for `total - 1` itself, which the
 * route always answers with the final row.
 */
export function lastPageStart(totalRows: number): number {
	return Math.max(0, totalRows - DESKTOP_DIFF_PAGE_MAX_ROWS);
}

/**
 * Where Prev's walk starts when the reader did not arrive by Next (Last, or a
 * jump): one full row budget back. A byte-clipped page from there may end
 * before the current `start`, so the pager follows `next_start` from it until
 * the page reaches `start - 1` — Prev never skips a row.
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
 * rows do not, so "Rows 1–N of T" subtracts it. Cursors stay in artifact
 * positions internally; only this display arithmetic shifts.
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
 * The tail of the page the reader is leaving: an `answer` that crosses
 * `before` is cut to end at row `before - 1`, with its cursor pointing at
 * `before` (review round 1, U2/Q3: Previous after Last used to repaint rows
 * the reader had just seen). Contiguity is preserved, so Next from the cut page
 * returns to exactly the page it came from.
 */
export function pageEndingBefore(answer: DiffPage, before: number): DiffPage {
	if (answer.start + answer.rows.length <= before) return answer;
	const keep = Math.max(0, before - answer.start);
	return {
		...answer,
		rows: answer.rows.slice(0, keep),
		nextStart: before,
		clippedRows: answer.clippedRows.filter((row) => row < before),
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
