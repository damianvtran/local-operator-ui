/**
 * The one chat list's sections and its relative times, as decisions rather than
 * JSX conditions.
 *
 * WHY A MODULE. The same reason `chat-sections.ts` and `sidebar-split.ts` beside
 * it give: the sidebar cannot be rendered by this repository's `node:test` suite
 * (it reads the router, the session store and the capability hooks), so a rule
 * written inline in the component is a rule no test can reach.
 * `scripts/chat-list-sections.test.mjs` drives THIS module.
 *
 * WHAT IT REPLACES (design round 1, D1). The list was two partitions the backend
 * drew - `Active chats` and `Previous chats` - under an `All chats` toggle that
 * flattened them, so a reader had four list concepts, no time anywhere, and a
 * running chat drawn as the LAST row of `Active chats`. §C1 of the chat redesign
 * specifies one list, sectioned by what a reader asks of it: what is working
 * right now, then how recently each conversation moved.
 *
 *   RUNNING    a turn is live or waiting on the reader. Never collapsed, no time
 *              (a running row's time is "now", which says nothing).
 *   TODAY      last moved on this local calendar day.
 *   THIS WEEK  within the last seven days, and not today.
 *   OLDER      everything else, including a row with no time at all.
 *
 * THE TIME BASIS (2026-09-28, the operator's report). The sections and the row
 * labels read ONE clock, and which clock is the reader's choice: `active` (the
 * default) is the transcript's activity time - the wire's `mtime`, this row's
 * `updated_at` - and `created` is the conversation's birth, the wire's
 * `created_at`. The basis is the whole of what changes through that one read
 * (`rowTimeMs`): the bin, the label AND - since 2026-10-08 - the order, so a
 * section can no longer draw a row whose label contradicts the place it sits in.
 * The operator's report - "even if I've asked an older session something today,
 * once it completes I can't see it within the today bin" - is why the basis is
 * configurable at all; the promptness half of the fix lives in the sidebar's
 * refresh, not here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: order the rows it is given. This module
 * BUCKETS (`filter`, never `sort`) - the order the reader sees is decided before
 * this call by the ONE arrangement (`chat-sidebar-view.ts`'s `pageOrder`), which
 * reads the same clock this file's `rowTimeMs` door hands to the bins and the
 * labels. THE OLD CONTRACT SAID THE OPPOSITE - "WHAT IT DELIBERATELY DOES NOT
 * DO: re-sort", on the premise that the catalogue's arrival order WAS recency -
 * and the premise was false: the backend ranks `(tier, wake band, -created_at,
 * id)` (`session/catalog.py`), so rows arrive in CREATION order while every bin
 * and label here read the ACTIVITY clock. The operator's screenshots are that
 * pair disagreeing (`15h` drawn under `6d` inside This week), and his
 * 2026-10-08 instruction is the reversal: within every section and group the
 * rows follow the order the chosen basis implies, and the whole of that change
 * is that the arrangement may sort - this file's bucketing stays a filter.
 */

import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";

export type ChatListSection = "running" | "today" | "week" | "older";

/**
 * Which clock the sections and the row labels read.
 *
 * `active` is the transcript's activity clock (`updated_at`, the wire's
 * `mtime`); `created` is the conversation's birth (`created_at`, the backend's
 * `session_created_at`). Both are epoch SECONDS on the wire and are converted
 * in one place (`rowTimeMs`).
 */
export type SidebarBasis = "active" | "created";

/** The bases, in the order the popover draws them. */
export const SIDEBAR_BASES: readonly SidebarBasis[] = ["active", "created"];

/** The sections in the order they are drawn. */
export const CHAT_LIST_SECTIONS: readonly ChatListSection[] = [
	"running",
	"today",
	"week",
	"older",
];

/** The label each section prints (the component sets them in small caps). */
export const CHAT_LIST_SECTION_LABEL: Record<ChatListSection, string> = {
	running: "Running",
	today: "Today",
	week: "This week",
	older: "Older",
};

/**
 * The status codes that put a row under RUNNING.
 *
 * `busy` and `delegating` are a live turn. `approval` and `answer` are a turn
 * that has STOPPED ON THE READER - it is the one thing in the list they must act
 * on, so it belongs at the top rather than wherever its last write sorted it.
 * `wedged` is a turn that claims to be live and has gone quiet: the row carries
 * its own remedy, and hiding it under TODAY would bury the one conversation the
 * reader is waiting on.
 *
 * NOT `active`: the catalogue's `active` flag is its own partition, and in the
 * AFTER frames it held ten rows with completion ticks - "active" there means
 * "recently in play", not "running".
 */
const RUNNING_CODES = new Set([
	"busy",
	"delegating",
	"approval",
	"answer",
	"wedged",
]);

export function isRunningRow(row: CanonicalSessionRow): boolean {
	return RUNNING_CODES.has(row.status?.code ?? "");
}

/**
 * The status codes that STOP ON THE READER: a turn that cannot proceed until
 * they answer (`approval`) or a question waiting for them (`answer`).
 *
 * They are the RUNNING section's first band in the arrangement
 * (`chat-sidebar-view.ts`'s `pageOrder` lifts them above the other running
 * rows), which is the design intent the section's own header states - "it is
 * the one thing in the list they must act on, so it belongs at the top". The
 * set lives HERE, beside `RUNNING_CODES`, because `runningOrderMs` and the lift
 * must agree about which rows wait on the reader for the same reason
 * `isRunningRow` is imported by the lift rather than restated: two copies are
 * how a row comes to be lifted against one rule and keyed by another.
 */
export const STOPPED_ON_READER_CODES: ReadonlySet<string> = new Set([
	"approval",
	"answer",
]);

export function isStoppedOnReader(row: CanonicalSessionRow): boolean {
	return STOPPED_ON_READER_CODES.has(row.status?.code ?? "");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Local midnight for `now`. Calendar days rather than a rolling 24h, because
 * "today" is the word on screen and a conversation from 11pm yesterday is not
 * from today at 9am, whatever the arithmetic says.
 */
const startOfDay = (now: number): number => {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};

/**
 * The instant the chosen basis reads, in MILLISECONDS, or null for "no time".
 *
 * ONE DOOR FOR BOTH CLOCKS, because the sections, the label and (through them)
 * the popover's counts must never disagree about a row's time: `sectionOf` and
 * `relativeTime` both come through here.
 *
 * `updated_at` is SECONDS: the wire's `mtime` is the backend's Python float
 * (`SessionCatalogueRow.mtime`), mapped straight into the row
 * (`canonical-sessions-store.ts`), and `scheduled-task-dialog.tsx` reads the
 * same field the same way. `created_at` is SECONDS on the same rule. A missing
 * or non-finite value is "no time", never zero - zero is 1970 and would land
 * every such row at the bottom with a date on it.
 *
 * `created_at <= 0` is the backend's own "unknown" (`session_created_at`
 * answers `0.0` when the directory cannot be read), so on the Created basis
 * zero is refused rather than printed as 1970. `updated_at` IS HELD TO THE SAME
 * RULE (2026-10-08), and the older finiteness-only comment here was false about
 * the wire: core #2044 makes `mtime = 0.0` a real, published state - the "no
 * claim" a peer row carries when nothing readable arrived - and a desktop row
 * that read it accepted `0.0` as an instant, printed `56y` beside an untouched
 * conversation and filed it among the oldest. "No clock" is a state this door
 * refuses on BOTH bases now, so the row sorts last and prints no label instead
 * of inventing 1970.
 */
export function rowTimeMs(
	row: CanonicalSessionRow,
	basis: SidebarBasis,
): number | null {
	const seconds = basis === "created" ? row.created_at : row.updated_at;
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
	if (seconds <= 0) return null;
	return seconds * 1000;
}

/**
 * The row field a RUNNING row's order reads: the time of the last USER message,
 * in epoch SECONDS - the wire's `last_user_at`.
 *
 * ONE CONSTANT, because this field is the seam between two repositories and
 * will be renamed or re-homed exactly once: core does NOT publish it yet (the
 * mesh lane owns the remote-row stamps, and a core change is a separate lane),
 * so `runningOrderMs` below falls back to `created_at` and the arrangement is
 * a creation order for running rows today. The declared property on
 * `CanonicalSessionRow` is the other half of the spelling; the read below is
 * typed through it, and the declaration's own comment names this constant.
 */
export const LAST_USER_AT_FIELD = "last_user_at";

/**
 * The instant a RUNNING row's order reads, in MILLISECONDS, or null for none.
 *
 * WHY RUNNING ROWS ARE NOT KEYED BY ACTIVITY (the operator's clarification,
 * 2026-10-08): "across surfaces we should keep the sort of running sessions
 * stable ... otherwise they'll keep resorting every time a new message is sent
 * which we don't want ... in the running sections, it makes sense to sort based
 * on the time of the last user message, so if I send a more recent message to a
 * session that session will pop to the top ... but any responses or non-user
 * messages will not reorder those by activity." So a response landing in a
 * running chat must NOT move it; sending a message MAY; and until the wire
 * carries the user-message clock, a running row is keyed by its birth, which
 * does not move at all.
 *
 * THE READ IS TYPED THROUGH THE DECLARATION, which is the half of the link a
 * rename breaks: `CanonicalSessionRow` carries an index signature, so a read of
 * an UNDECLARED key is `unknown` - the annotation below stops compiling if the
 * store's declaration and `LAST_USER_AT_FIELD` stop naming the same field, and
 * the same refusal `rowTimeMs` applies to a zero is applied here (`last_user_at
 * <= 0` is "no claim", never 1970).
 */
export function runningOrderMs(row: CanonicalSessionRow): number | null {
	const lastUser: number | null | undefined = row[LAST_USER_AT_FIELD];
	const seconds =
		typeof lastUser === "number" && Number.isFinite(lastUser) && lastUser > 0
			? lastUser
			: row.created_at;
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
	if (seconds <= 0) return null;
	return seconds * 1000;
}

export function sectionOf(
	row: CanonicalSessionRow,
	now: number,
	basis: SidebarBasis,
): ChatListSection {
	if (isRunningRow(row)) return "running";
	const at = rowTimeMs(row, basis);
	if (at === null) return "older";
	const today = startOfDay(now);
	if (at >= today) return "today";
	if (at >= today - 6 * DAY_MS) return "week";
	return "older";
}

/**
 * The rows of each section, in the order they are GIVEN.
 *
 * The partition is a `filter`: the order the reader sees was decided before
 * this call by the ONE arrangement (`pageOrder`), which reads the same basis
 * this function bins by - so the bin, the label and the order are three
 * readings of one clock, and a section cannot draw a row its label
 * contradicts.
 */
export function sectionRows(
	rows: readonly CanonicalSessionRow[],
	now: number,
	basis: SidebarBasis,
): Record<ChatListSection, CanonicalSessionRow[]> {
	const out: Record<ChatListSection, CanonicalSessionRow[]> = {
		running: [],
		today: [],
		week: [],
		older: [],
	};
	for (const row of rows) out[sectionOf(row, now, basis)].push(row);
	return out;
}

/**
 * A row's relative time, in the column's own terse register: `now`, `4m`, `2h`,
 * `3d`, `5w`, and past a year `1y`.
 *
 * Terse because the column is 12px mono at the trailing edge of a 30px row that
 * already carries a title, and every character it takes is one the title loses
 * (the references - Codex, Conductor, Cursor 3 - print `2h`, not `2 hours ago`).
 * A future time (a clock skewed ahead of the backend's) reads `now` rather than a
 * negative number. No time at all prints nothing.
 */
export function relativeTime(
	row: CanonicalSessionRow,
	now: number,
	basis: SidebarBasis,
): string {
	const at = rowTimeMs(row, basis);
	if (at === null) return "";
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	const weeks = Math.floor(days / 7);
	if (days < 365) return `${weeks}w`;
	return `${Math.floor(days / 365)}y`;
}

/**
 * The whole-sentence form, for the row's accessible name and its flyout, NAMING
 * THE BASIS the number came from.
 *
 * WHY THE BASIS IS ANNOUNCED (design direction, 2026-09-28): a switched basis
 * changes what `3w` MEANS - three weeks since it last moved, or three weeks
 * since it was created - and the terse visible label cannot say which. The
 * sentence is the channel that can, so a reader is never guessing what the
 * number beside the title measures: ", last active 3 weeks ago" against
 * ", created 3 weeks ago". Sentence case, and never the word "bin".
 */
export function relativeTimeSentence(
	row: CanonicalSessionRow,
	now: number,
	basis: SidebarBasis,
): string {
	const short = relativeTime(row, now, basis);
	if (!short) return "";
	const prefix = basis === "created" ? "created" : "last active";
	if (short === "now") return `${prefix} just now`;
	const unit: Record<string, string> = {
		m: "minute",
		h: "hour",
		d: "day",
		w: "week",
		y: "year",
	};
	const count = Number.parseInt(short, 10);
	const word = unit[short.slice(-1)];
	return `${prefix} ${count} ${word}${count === 1 ? "" : "s"} ago`;
}
