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
 * WHAT IT DELIBERATELY DOES NOT DO: re-sort. The catalogue owns the order
 * (`desktop-session-contract.ts`: "the backend owns status precedence ... and
 * order"), and a partition that preserved it inside each section is the TUI's
 * own rule (`chat-sections.ts` states it for `Pinned`). Bucketing is `filter`,
 * never `sort`.
 */

import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";

export type ChatListSection = "running" | "today" | "week" | "older";

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
 * `updated_at` is SECONDS: the wire's `mtime` is the backend's Python float
 * (`SessionCatalogueRow.mtime`), mapped straight into the row
 * (`canonical-sessions-store.ts`), and `scheduled-task-dialog.tsx` reads the same
 * field the same way. A missing or non-finite value is "no time", never zero -
 * zero is 1970 and would land every such row at the bottom with a date on it.
 */
export function rowTimeMs(row: CanonicalSessionRow): number | null {
	const seconds = row.updated_at;
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
	return seconds * 1000;
}

export function sectionOf(
	row: CanonicalSessionRow,
	now: number,
): ChatListSection {
	if (isRunningRow(row)) return "running";
	const at = rowTimeMs(row);
	if (at === null) return "older";
	const today = startOfDay(now);
	if (at >= today) return "today";
	if (at >= today - 6 * DAY_MS) return "week";
	return "older";
}

/** The rows of each section, in the catalogue's own order. */
export function sectionRows(
	rows: readonly CanonicalSessionRow[],
	now: number,
): Record<ChatListSection, CanonicalSessionRow[]> {
	const out: Record<ChatListSection, CanonicalSessionRow[]> = {
		running: [],
		today: [],
		week: [],
		older: [],
	};
	for (const row of rows) out[sectionOf(row, now)].push(row);
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
export function relativeTime(row: CanonicalSessionRow, now: number): string {
	const at = rowTimeMs(row);
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

/** The whole-sentence form, for the row's accessible name and its flyout. */
export function relativeTimeSentence(
	row: CanonicalSessionRow,
	now: number,
): string {
	const short = relativeTime(row, now);
	if (!short) return "";
	if (short === "now") return "just now";
	const unit: Record<string, string> = {
		m: "minute",
		h: "hour",
		d: "day",
		w: "week",
		y: "year",
	};
	const count = Number.parseInt(short, 10);
	const word = unit[short.slice(-1)];
	return `${count} ${word}${count === 1 ? "" : "s"} ago`;
}
