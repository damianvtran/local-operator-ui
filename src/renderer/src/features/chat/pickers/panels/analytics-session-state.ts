import type { DesktopUsageAggregate } from "../../../../../../shared/desktop-contract";
import {
	type AnalyticsMetric,
	CACHE_HIT_LABEL,
	type SessionRow,
	cacheReadFraction,
	metricValue,
	sessionDepth,
	totalTokens,
} from "./analytics-model";
import { formatCount, formatMicroUsd } from "./formatters";

/**
 * The by-session table's pure layer: paging, sorting, search, filtering.
 *
 * Why this exists as its own module rather than in the panel. The table's
 * ordering used to be one function (`sessionRows`) that ranked every session
 * and sliced twelve out of it, which was fine while the table WAS a summary.
 * Making every session reachable turns that function into six decisions that
 * each have to be got right independently — what a row is, which rows survive
 * the narrowing, what order the survivors are in, which twenty of them are on
 * screen, and what the three places that state a count say about it — and none
 * of them can be checked without a browser if they live in a component.
 *
 * Every function here is pure and DOM-free, which is what lets
 * `scripts/analytics-session-table.test.mjs` bundle this file and pin the rules
 * under `node --test`. That matters more here than usual: four of the rules
 * below are invisible in any frame (the tie-break, the unknown-value rule, the
 * fractional denominator, the clamp) and one of them (the memo keys in the
 * section) fails silently by being slower rather than wrong.
 *
 * The order of operations is fixed and load-bearing (§5 of the design):
 * **index → filter → search → sort → slice → enrich**. Sorting after narrowing
 * keeps the comparator off rows that are leaving, and enriching after the slice
 * keeps the depth walk's cost a function of the page rather than of the ledger.
 */

/**
 * Rows per page.
 *
 * A reading decision, not a cost one: the render cost is flat between 12 and 50
 * rows, and 20 rows at the measured 32.2px pitch is 679px — the viewport this
 * section gets when it is scrolled into view in the shipped window. Twelve
 * (the cap this replaces) reads as the summary the operator complained about,
 * and fifty scrolls inside a page, which is the thing paging exists to stop.
 */
export const SESSION_PAGE_SIZE = 20;

export type SessionSortKey = "session" | "calls" | "tokens" | "cost" | "cache";
export type SortDirection = "asc" | "desc";

/**
 * The five sort keys, in column order.
 *
 * An array rather than five literals repeated per function, because the table's
 * `onSort` hands back a `string` (the primitive knows nothing about this
 * model's keys) and the conversion has to have exactly one definition: a key
 * that some other module spells differently is a column that silently stops
 * sorting.
 */
export const SESSION_SORT_KEYS: readonly SessionSortKey[] = [
	"session",
	"calls",
	"tokens",
	"cost",
	"cache",
];

/** The primitive's own sort intent, as a key this model recognises. */
export const asSessionSortKey = (key: string): SessionSortKey | null =>
	(SESSION_SORT_KEYS as readonly string[]).includes(key)
		? (key as SessionSortKey)
		: null;

/** The column heading a sort key is announced by. */
const SORT_LABEL: Record<SessionSortKey, string> = {
	session: "Session",
	calls: "Calls",
	tokens: "Tokens",
	cost: "Cost",
	cache: CACHE_HIT_LABEL,
};

export type SessionTableState = {
	/** The search field's value, verbatim (this module trims and case-folds). */
	query: string;
	/** `null` = follow the panel's metric: tokens for "tokens", cost for "spend". */
	sort: { key: SessionSortKey; direction: SortDirection } | null;
	/** The one filter (§6.2). */
	filters: { topLevelOnly: boolean };
	/** 0-based. The RENDERED page is clamped; this value is deliberately not. */
	page: number;
};

export type SessionTableAction =
	| { type: "search"; query: string }
	| { type: "filter"; topLevelOnly: boolean }
	| { type: "sort"; key: SessionSortKey }
	| { type: "page"; page: number }
	/**
	 * The window moved under the reader (metric, window or scope changed).
	 * Only the page resets: the sort, the filter and the query are the reader's
	 * own choices and are about to be re-applied to a new answer.
	 */
	| { type: "reset" };

export const INITIAL_SESSION_TABLE_STATE: SessionTableState = {
	query: "",
	sort: null,
	filters: { topLevelOnly: false },
	page: 0,
};

/**
 * The reducer.
 *
 * The page resets live HERE rather than in an effect in the section, and that
 * is a correctness decision rather than a tidiness one: an effect that watched
 * the window and called `setPage(0)` runs after the commit, so the new ranking
 * would paint at the old page for one frame — a visible flash of "page 3 of a
 * set that no longer has a page 3" — and would cost a second rank pass for the
 * frame nobody sees.
 *
 * Two actions return the state OBJECT unchanged when nothing moved (a reset
 * from page 0, a search that sets the query it already holds). React bails out
 * of a re-render on an identical reference, and both of those arrive on paths
 * that are otherwise cheap to re-run — a metric toggle with the sort following
 * it, and a keystroke that only changed case.
 */
export function sessionTableReducer(
	state: SessionTableState,
	action: SessionTableAction,
): SessionTableState {
	switch (action.type) {
		case "search":
			return action.query === state.query
				? state
				: { ...state, query: action.query, page: 0 };
		case "filter":
			return action.topLevelOnly === state.filters.topLevelOnly
				? state
				: { ...state, filters: { topLevelOnly: action.topLevelOnly }, page: 0 };
		case "sort":
			return {
				...state,
				sort: nextSort(state.sort, action.key),
				page: 0,
			};
		case "page":
			return action.page === state.page
				? state
				: { ...state, page: action.page };
		case "reset":
			return state.page === 0 ? state : { ...state, page: 0 };
	}
}

/**
 * What pressing a column heading does.
 *
 * Activating the active column flips the direction; activating any other column
 * takes `firstDirection` — the model's policy, not the primitive's, because a
 * primitive that guessed would have to know which columns are numbers.
 */
function nextSort(
	current: SessionTableState["sort"],
	key: SessionSortKey,
): SessionTableState["sort"] {
	if (current?.key !== key) return { key, direction: firstDirection(key) };
	return {
		key,
		direction: current.direction === "asc" ? "desc" : "asc",
	};
}

/**
 * A column's direction on first activation.
 *
 * The question behind Calls, Tokens, Cost and Cache hit rate is "which is
 * biggest", so those open descending. The Session column opens ascending,
 * because the question there is "where is this one" and a label list is read
 * from its start.
 */
export const firstDirection = (key: SessionSortKey): SortDirection =>
	key === "session" ? "asc" : "desc";

/** The key the rows are actually ordered by, given the panel's metric. */
export const effectiveSortKey = (
	state: SessionTableState,
	metric: AnalyticsMetric,
): SessionSortKey =>
	state.sort?.key ?? (metric === "spend" ? "cost" : "tokens");

/**
 * The direction those rows are actually in.
 *
 * `sort: null` means "the panel ranks this table", and the panel's own ranking
 * is largest-first in both metrics.
 */
export const effectiveSortDirection = (
	state: SessionTableState,
): SortDirection => state.sort?.direction ?? "desc";

/**
 * One session, as the narrowing and sorting passes see it.
 *
 * Every field here is copied ONCE per payload, so the passes below never touch
 * the wire shape and never re-run a formatter per comparison. `costKnown` and
 * `cacheRatio` are kept separate from their formatted strings for the reason
 * §6.1 gives: `$1,000.00` sorts before `$9.00`, and a `—` is not a zero.
 */
export type SessionIndexRow = {
	id: string;
	/** The session's name, or its id when the ledger has none. */
	label: string;
	unnamed: boolean;
	/** Whether the session has a parent edge, i.e. whether it is a subagent. */
	hasParent: boolean;
	calls: number;
	tokens: number;
	costMicro: number;
	/**
	 * The wire's `cost_known_calls`: how many of the row's calls have a published
	 * price.
	 *
	 * The COUNT rather than a boolean, because the Cost column's trailing `+`
	 * (`formatMicroUsd`'s mark for a partial sum) is derived from it: a row with
	 * some priced and some unpriced calls prints `$1.20+`, and a boolean would
	 * print its fully-priced spelling instead. Zero is the unknown case.
	 */
	costKnownCalls: number;
	/** The row's own rate, or `null` when its calls reported no context total. */
	cacheRatio: number | null;
	/** The selected metric's number, which is what the rows are ranked by. */
	value: number;
};

export type SessionIndex = {
	rows: SessionIndexRow[];
	/**
	 * The window's metric total over EVERY row.
	 *
	 * Deliberately not "the total of what is on screen": it is the denominator
	 * of every row's share bar, and §5.1 makes that a fixed fact about the
	 * window. A bar divided by the narrowed set would change length as the user
	 * types, would read 100% in a one-row result, and would contradict the
	 * sentence the bar's own `srLabel` reads out ("… of tokens in this window").
	 */
	total: number;
};

/**
 * Step 1: the payload becomes rows, once per payload.
 *
 * The window total is computed here rather than per render for the same reason
 * the labels are: it is a property of the payload, and a total recomputed from
 * a narrowed set is the defect §5.1 describes.
 */
export function sessionIndex(
	bySession: Record<string, DesktopUsageAggregate> | undefined,
	names: Record<string, string> | undefined,
	parents: Record<string, string> | undefined,
	metric: AnalyticsMetric,
): SessionIndex {
	const entries = Object.entries(bySession ?? {});
	const rows: SessionIndexRow[] = [];
	let total = 0;
	for (const [id, aggregate] of entries) {
		const value = metricValue(aggregate, metric);
		total += value;
		const name = names?.[id];
		rows.push({
			id,
			label: name ?? id,
			unnamed: !name,
			/*
			 * An ABSENT parents map is not an empty one — but both mean "no
			 * session here has a parent we know about", which is what the filter
			 * asks. An older backend renders flat ids and says nothing (§1.9),
			 * so `Top-level only` there leaves every row standing rather than
			 * presenting an empty table for a fact nobody stated.
			 */
			hasParent: Boolean(parents?.[id]),
			calls: aggregate.calls,
			tokens: totalTokens(aggregate),
			costMicro: aggregate.cost_micro,
			costKnownCalls: aggregate.cost_known_calls,
			cacheRatio: cacheReadFraction(aggregate),
			value,
		});
	}
	return { rows, total };
}

export type SessionFilter = { topLevelOnly: boolean };

/**
 * Steps 2 and 3: filter, then search.
 *
 * One pass, one predicate per row, no formatting. The two are folded into one
 * function because they are the same kind of decision (a row stays or goes) and
 * they are always applied together; keeping them apart would mean two arrays
 * and a second walk over up to 7,065 rows per keystroke for nothing.
 *
 * Search semantics, with the two limits stated rather than implied (§6.3):
 * case-folded SUBSTRING over the label and the id (`"panel vie"` matches
 * `Panel views`, `"views panel"` does not), with `toLocaleLowerCase()` as the
 * only folding — no accent or collation normalisation. A query that is empty or
 * whitespace-only narrows nothing and says nothing.
 *
 * The id is in the match set because it is the only handle an unnamed session
 * has: without it, the rows an older backend renders (`UnnamedSessions`) would
 * be unfindable by the one string they display.
 */
export function narrowSessionIndex(
	index: SessionIndex,
	query: string,
	filters: SessionFilter,
): SessionIndexRow[] {
	const needle = query.trim().toLocaleLowerCase();
	const rows = filters.topLevelOnly
		? index.rows.filter((row) => !row.hasParent)
		: index.rows;
	if (needle === "") return rows;
	return rows.filter(
		(row) =>
			row.label.toLocaleLowerCase().includes(needle) ||
			row.id.toLocaleLowerCase().includes(needle),
	);
}

/**
 * Whether a row's value for a column is UNKNOWN rather than a number.
 *
 * Two columns can be unknown — an unpriced Cost (no call reported a published
 * price) and an unmeasurable Cache hit rate (no call reported a context total)
 * — and both mean the same thing to a reader: this row is not part of the
 * comparison. §6.1 states the rule once for both: unknown sorts LAST in both
 * directions, because a `—` cluster at the top of a descending sort reads as
 * the claim "these cost the most".
 */
const isUnknown = (row: SessionIndexRow, key: SessionSortKey): boolean =>
	key === "cost"
		? row.costKnownCalls === 0
		: key === "cache"
			? row.cacheRatio === null
			: false;

/** The primary comparison, ascending, on numbers rather than on cell strings. */
function compareAscending(
	a: SessionIndexRow,
	b: SessionIndexRow,
	key: SessionSortKey,
): number {
	switch (key) {
		case "session":
			/*
			 * `localeCompare`, which is the one expensive comparator in this
			 * tree (12.5 ms over 7,065 rows against 2.1 ms for a numeric
			 * column) and is kept anyway: a label list ordered by UTF-16 code
			 * unit puts every capitalised name before every lowercase one, and
			 * ICU's default collation is case-insensitive with a tertiary case
			 * difference, which is the order a reader expects of names.
			 */
			return a.label.localeCompare(b.label);
		case "calls":
			return a.calls - b.calls;
		case "tokens":
			return a.tokens - b.tokens;
		case "cost":
			/* `cost_micro`, never the formatted string (§6.1). */
			return a.costMicro - b.costMicro;
		case "cache":
			/* Unknowns are partitioned out before this runs. */
			return (a.cacheRatio ?? 0) - (b.cacheRatio ?? 0);
	}
}

/**
 * Step 4: the order.
 *
 * Two rules that are invisible in a screenshot and pinned by the node suite:
 *
 * - **The tie-break is `id` ascending, ALWAYS** — including under a descending
 *   primary sort, which is why the direction factor is applied to the primary
 *   comparison and never to the tie-break. A 4,550-row ledger contains many
 *   ties (a long tail of equal-cost rows, rows at exactly zero tokens), and an
 *   unstable order would move rows across a page boundary between two identical
 *   clicks — "the row I was reading is now on the next page".
 * - **Unknowns are partitioned OUT of the direction.** They are compared by
 *   rank first and only then by value, so flipping the direction re-orders the
 *   known rows and leaves the unknown ones at the end.
 */
export function sortSessionIndex(
	rows: SessionIndexRow[],
	key: SessionSortKey,
	direction: SortDirection,
): SessionIndexRow[] {
	const factor = direction === "desc" ? -1 : 1;
	return [...rows].sort((a, b) => {
		const rankA = isUnknown(a, key) ? 1 : 0;
		const rankB = isUnknown(b, key) ? 1 : 0;
		if (rankA !== rankB) return rankA - rankB;
		const primary = factor * compareAscending(a, b, key);
		return primary !== 0 ? primary : a.id.localeCompare(b.id);
	});
}

export type SessionPageSlice = {
	/** The rows on the rendered page, in order. At most `SESSION_PAGE_SIZE`. */
	rows: SessionIndexRow[];
	/** The page actually rendered: `page` clamped into range. */
	page: number;
	/** Pages in the narrowed set. At least 1, so the clamp always has a floor. */
	pageCount: number;
	/** 1-based index of the first rendered row; 0 when there are no rows. */
	from: number;
	/** 1-based index of the last rendered row; 0 when there are no rows. */
	to: number;
	/** Rows in the narrowed set, which is what `from`/`to` count within. */
	total: number;
};

/**
 * Step 5: the slice, and the clamp.
 *
 * The clamp is a DERIVATION, not a reset (§4.3). A refetch or a narrowing can
 * leave the stored page beyond the end of the set, and the rendered page is
 * `min(page, pageCount - 1)` — the stored value is not rewritten, because the
 * states that would rewrite it (an effect) run after the commit and paint the
 * out-of-range page for one frame first.
 *
 * `pageCount` is floored at 1 so the clamp can never produce a negative page:
 * an empty set (the empty states §6.4 renders instead of a table) still has a
 * well-formed page to clamp to.
 */
export function sessionPage(
	ordered: SessionIndexRow[],
	page: number,
): SessionPageSlice {
	const total = ordered.length;
	const pageCount = Math.max(1, Math.ceil(total / SESSION_PAGE_SIZE));
	const clamped = Math.min(Math.max(page, 0), pageCount - 1);
	const start = clamped * SESSION_PAGE_SIZE;
	return {
		rows: ordered.slice(start, start + SESSION_PAGE_SIZE),
		page: clamped,
		pageCount,
		from: total === 0 ? 0 : start + 1,
		to: Math.min(total, start + SESSION_PAGE_SIZE),
		total,
	};
}

/**
 * Step 6: the page becomes rows a table can render.
 *
 * The depth walk and the cost string happen HERE, on at most twenty rows, which
 * is what keeps every interaction's cost a function of the page rather than of
 * the ledger — the walk measured 0.7 ms across 7,065 rows, so this is a
 * constant-factor win rather than a fix, and it is the reason the ordering must
 * survive the slice intact.
 *
 * `fraction` divides by the INDEX total, i.e. the whole window (§5.1). It is
 * the one number in this module that must not move when the set is narrowed,
 * and the node suite asserts it is byte-identical across a query, a filter and
 * a page turn.
 */
export function enrichSessionRows(
	rows: SessionIndexRow[],
	context: {
		total: number;
		names?: Record<string, string>;
		parents?: Record<string, string>;
	},
): SessionRow[] {
	return rows.map((row) => ({
		id: row.id,
		label: row.label,
		unnamed: row.unnamed,
		depth: sessionDepth(row.id, context.names, context.parents),
		calls: row.calls,
		tokens: row.tokens,
		/*
		 * The same three arguments the table has always been given
		 * (`analytics-model.ts`'s old `sessionRows`), so the Cost cell's string
		 * is unchanged by the move: `—` when nothing was priced, `$1.20+` when
		 * only some of the row's calls were, and a complete figure otherwise.
		 */
		cost: formatMicroUsd(row.costMicro, row.costKnownCalls, row.calls),
		fraction: context.total > 0 ? row.value / context.total : 0,
		cacheHit: row.cacheRatio,
	}));
}

/** Whether anything is narrowing the table, which is what the strip reports. */
export const isNarrowed = (state: SessionTableState): boolean =>
	state.query.trim() !== "" || state.filters.topLevelOnly;

/** `session` / `sessions`, by the count the sentence counts. */
const noun = (count: number): string => (count === 1 ? "session" : "sessions");

/**
 * The visible line that says what the table is showing, or `null` when nothing
 * is narrowing it.
 *
 * A VISIBLE line rather than only a live region, for the reason
 * `CacheHitLegend` gives for itself: the fact has to survive a frame, a
 * screenshot, a screen reader and a keyboard. It is rendered only while a query
 * or the filter is active, because "4,550 of 4,550 sessions" is a sentence that
 * says nothing.
 *
 * The verb agrees with the TOTAL rather than with the match count ("1 of 1
 * session matches"), because the noun is introduced by the total the match is
 * stated against.
 */
export function sessionMatchLine(input: {
	matched: number;
	total: number;
	query: string;
	topLevelOnly: boolean;
}): string | null {
	const query = input.query.trim();
	if (query === "" && !input.topLevelOnly) return null;
	const counted = `${formatCount(input.matched)} of ${formatCount(input.total)} ${noun(input.total)}`;
	const searched =
		query === ""
			? counted
			: `${counted} ${input.total === 1 ? "matches" : "match"} "${query}"`;
	return input.topLevelOnly ? `${searched} · top-level only` : searched;
}

/**
 * What the live region says, about the change the reader just made.
 *
 * `change` names WHICH sentence to say and nothing more; every fact in it is
 * read from the state at render time. That is deliberate, and it is what makes
 * the clamp announceable: if the answer shrinks under a reader who is on page
 * 5, the sentence they already have updates to the page they are actually
 * looking at instead of restating an action from a minute ago — and the sort's
 * direction is read from the state the reducer produced rather than guessed
 * here, so the flip rule has exactly one definition.
 *
 * The text is one short factual sentence, never the whole status line: the
 * visible match line and the pager's counts carry the same facts in a readable
 * form, and a live region that repeated them is noise on top of the screen the
 * reader is already on. `null` is the state before any interaction, which
 * announces nothing rather than the panel's opening state.
 */
export type SessionTableChange = "sort" | "search" | "filter" | "page";

export type SessionAnnouncementContext = {
	/** The query field's value at render time; the sentence quotes it trimmed. */
	query: string;
	/** Rows the current narrowing leaves. */
	matched: number;
	/** The CLAMPED page actually rendered, 0-based. */
	page: number;
	/** Pages in the narrowed set. */
	pageCount: number;
	/** The order actually on screen, after the reducer and the metric. */
	sortKey: SessionSortKey;
	sortDirection: SortDirection;
	topLevelOnly: boolean;
};

export function sessionAnnouncement(
	change: SessionTableChange | null,
	context: SessionAnnouncementContext,
): string {
	switch (change) {
		case "sort":
			return `Sorted by ${SORT_LABEL[context.sortKey]}, ${sortWord(context.sortKey, context.sortDirection)}.`;
		case "search": {
			const query = context.query.trim();
			/* Clearing the field is its own sentence: `No sessions match ""` is
			   what the general branch would say about an empty query. */
			if (query === "") return "Search cleared.";
			if (context.matched === 0) return `No sessions match "${query}".`;
			return `${formatCount(context.matched)} ${noun(context.matched)} ${context.matched === 1 ? "matches" : "match"} "${query}".`;
		}
		case "filter":
			return context.topLevelOnly
				? `Top-level only: ${context.matched === 0 ? "no sessions" : `${formatCount(context.matched)} ${noun(context.matched)}`}.`
				: `Top-level only off: ${formatCount(context.matched)} ${noun(context.matched)}.`;
		case "page":
			/* 1-based, because it is read, not computed with. */
			return `Page ${context.page + 1} of ${context.pageCount}.`;
		case null:
			return "";
	}
}

/** "highest/lowest first" for a value column, "A to Z"/"Z to A" for a label. */
function sortWord(key: SessionSortKey, direction: SortDirection): string {
	if (key === "session") return direction === "asc" ? "A to Z" : "Z to A";
	return direction === "desc" ? "highest first" : "lowest first";
}

/**
 * The sentence a narrowed-to-nothing table says, and the line under it.
 *
 * Returned as `null` when there is nothing to explain, which is the case the
 * caller must get right: a non-empty result renders the table, and a window
 * with NO sessions at all is not this function's state — that is the panel's
 * own "no per-session rows" empty, which was there before this change and is
 * unchanged by it.
 *
 * Three states, in the order they are checked:
 *
 * 1. **The filter excluded everything** — every session in the window is a
 *    subagent. Unreachable on the operator's ledger (404 of 4,550 rows are
 *    roots) and reachable on a machine whose whole window is delegated work,
 *    which is why the copy exists.
 * 2. **The search matched nothing** — and the detail names the POOL the search
 *    ran over, not the window: "Clear the search to see them" has to be true of
 *    what clearing the search actually reveals, and with the filter on that
 *    pool is smaller than the window.
 * 3. Nothing is empty.
 */
export function sessionEmptyText(input: {
	/** Every session in the window. */
	total: number;
	/** Rows left after the filter, before the search. */
	filtered: number;
	/** Rows left after the filter and the search. */
	matched: number;
	query: string;
	topLevelOnly: boolean;
}): { text: string; detail: string } | null {
	if (input.total === 0 || input.matched > 0) return null;
	if (input.topLevelOnly && input.filtered === 0)
		return {
			text: "No top-level sessions in this window.",
			detail:
				input.total === 1
					? "The one session in this window has a parent."
					: `All ${formatCount(input.total)} sessions in this window have a parent.`,
		};
	return {
		text: `No sessions match "${input.query.trim()}".`,
		detail: `${formatCount(input.filtered)} ${noun(input.filtered)} ${
			input.topLevelOnly ? "match the filter" : "in this window"
		}. Clear the search to see ${input.filtered === 1 ? "it" : "them"}.`,
	};
}
