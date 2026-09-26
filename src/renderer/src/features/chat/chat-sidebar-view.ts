/**
 * The sidebar's VIEW: which sections it draws, in what order, grouped and
 * ordered how, and how much of the list is loaded.
 *
 * WHY A MODULE, and it is the reason `chat-list-sections.ts` and
 * `sidebar-split.ts` beside it give: this repository's `node:test` suite cannot
 * render the sidebar (it reads the router, the canonical-sessions store and the
 * desktop capability hooks), so a decision written inline in the component is a
 * decision no test can reach. `scripts/chat-sidebar-view.test.mjs` drives THIS
 * file, and the three invariants the operator asked for are asserted there
 * rather than described in a comment:
 *
 *   1. the conversation being VIEWED is on screen even when it falls outside
 *      the loaded page (`pageRows`);
 *   2. a search looks at EVERY conversation, not at the loaded page, and
 *      reveals a match the page would not have reached (`pageRows` under
 *      `searching`);
 *   3. the active rows sit above the rest WITHOUT inverting recency below them
 *      (`pageOrder` - a stable partition, never a re-sort).
 *
 * WHAT THIS REPLACES, and why the operator asked for it (2026-09-25): the
 * column had one control surface, the boundary between its two regions, and no
 * way to see or change how the list itself was arranged. The reference is dsh's
 * sidebar - a header row of three icon-only buttons whose middle one opens a
 * popover of labelled groups - and the pagination is the operator's own
 * contract: 10 rows, then 25, then 50, then a further click each time.
 *
 * WHERE THE OPTIONS STOP. `groupBy` and `orderBy` change how rows are ARRANGED
 * on screen; neither re-orders the catalogue, which owns the order the backend
 * sends (`desktop-session-contract.ts`). A "manual" ordering - drag a row where
 * you want it - is deliberately absent: the wire carries no rank for a
 * conversation, so a manual order would be a client-side illusion that survives
 * neither a relaunch nor the terminal.
 */

import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { isRunningRow } from "./chat-list-sections";

/** Every section the sidebar can draw, in the order a fresh column draws them. */
export type SidebarSectionKey =
	| "pinned"
	| "running"
	| "today"
	| "week"
	| "older"
	| "agents"
	| "teams";

/**
 * The canonical order, and the reason it is a list rather than a union alone:
 * the popover's reorder control is a permutation of THIS, so a key added here
 * arrives in the popover without a second edit - and a key removed here cannot
 * leave a stale entry behind, because the parser below normalises against it.
 *
 * `pinned` is the one conditional member: it is drawn only when the backend
 * advertises `session_pins`, and its absence from a backend without the
 * capability is `chat-sections.ts`'s decision, not this file's.
 */
export const SIDEBAR_SECTIONS: readonly SidebarSectionKey[] = [
	"pinned",
	"running",
	"today",
	"week",
	"older",
	"agents",
	"teams",
];

/** The label each section prints. Sentence case; CSS sets the capitals. */
export const SIDEBAR_SECTION_LABEL: Record<SidebarSectionKey, string> = {
	pinned: "Pinned",
	running: "Running",
	today: "Today",
	week: "This week",
	older: "Older",
	agents: "Agents",
	teams: "Teams",
};

/**
 * The two sections that live in the AGENTS/TEAMS region rather than in the
 * chats list, and the split the popover's show/hide has to respect: switching
 * an entity section off is the disclosure it already owns (the `Agents` row's
 * chevron and its remembered `expanded` record), while switching a chat section
 * off is this file's `hidden` list. One decision, one spelling - a second
 * boolean for "is the agents section open" is how the two drift apart.
 */
export const ENTITY_SECTIONS: readonly SidebarSectionKey[] = [
	"agents",
	"teams",
];

export function isEntitySection(key: SidebarSectionKey): boolean {
	return key === "agents" || key === "teams";
}

/** How the chats list is arranged. */
/**
 * How many rows one collapsible section draws before its own `Show N more`.
 *
 * Eight rather than the chats list's ten, because a section here is a GROUP - an
 * agent's chats, the profiles list - and eight 30px rows is 240px of a 260px
 * column's height: the point of the cap is that two expanded groups plus the
 * chat list still fit in a window without the reader paging the column.
 */
export const SIDEBAR_SECTION_ROWS = 8;

export type SidebarGroupBy = "section" | "agent" | "flat";

/**
 * How the chats list is ordered.
 *
 * `active-first` is the operator's own word ("sorting active to the top"): a
 * conversation with a turn in flight, or one stopped on the reader, is lifted
 * above the rest. `recent` is the catalogue's order untouched, which is the
 * backend's recency - the option to have, for a reader who would rather the
 * list not move when a turn starts.
 *
 * NEITHER IS A RE-SORT OF WHAT FOLLOWS THE LIFT: see `pageOrder`.
 */
export type SidebarOrderBy = "active-first" | "recent";

/** The whole view preference, as it is persisted. */
export type SidebarView = {
	/** Sections the popover switched off. Draws no label and no rows. */
	hidden: SidebarSectionKey[];
	/** The user's order: a permutation of `SIDEBAR_SECTIONS`. */
	order: SidebarSectionKey[];
	groupBy: SidebarGroupBy;
	orderBy: SidebarOrderBy;
	/** How many times "Load more" has been pressed. 0 is the first page. */
	loads: number;
};

export const DEFAULT_SIDEBAR_VIEW: SidebarView = {
	hidden: [],
	order: [...SIDEBAR_SECTIONS],
	groupBy: "section",
	orderBy: "active-first",
	loads: 0,
};

/**
 * The page ladder: 10, then 25, then 50, then 50 more per press.
 *
 * The operator's contract, verbatim: "starts with 10, then 25, then 50, and
 * then user can click to load more". The increments past 50 are 50 rather than
 * a doubling, because the click is a user's decision to read the next slice and
 * a doubling would load a thousand rows on the fifth press - which is a
 * scrolling surface the column does not have and a read nobody asked for.
 */
export const CHAT_PAGE_START = 10;
export const CHAT_PAGE_STEPS = [25, 50] as const;
export const CHAT_PAGE_STEP = 50;

/**
 * The ceiling `loads` is clamped to on read (review round 3, R13).
 *
 * The ladder's arithmetic overflows long before a stored value stops being
 * finite: `pageLimit` computes `50 + (steps - 2) * 50`, so any `loads` past
 * ~3.6e306 returns Infinity and the foot's label takes `Infinity - Infinity` into
 * `Show NaN more chats`. Nothing in the app writes a value like that - this is
 * the tampered-storage edge of `parseSidebarView`, which already floors,
 * type-checks and degrades everything else it reads - so the clamp is the
 * read-side piece of the same rule: the largest read this list can ask for is the
 * 500-row page the store's own cap names, and no stored number may exceed it.
 */
export const CHAT_PAGE_MAX = 500;

/** How many rows a list that has been "load more"-ed `loads` times draws. */
export function pageLimit(loads: number): number {
	const steps = Math.max(0, Math.floor(loads));
	if (steps === 0) return CHAT_PAGE_START;
	if (steps <= CHAT_PAGE_STEPS.length) return CHAT_PAGE_STEPS[steps - 1];
	return (
		CHAT_PAGE_STEPS[CHAT_PAGE_STEPS.length - 1] +
		(steps - CHAT_PAGE_STEPS.length) * CHAT_PAGE_STEP
	);
}

/**
 * The label on the foot control, which names the size of the NEXT page.
 *
 * The step is bounded by what is actually left (`remaining`), so the control
 * cannot offer ten rows when four are unloaded - the operator's own reference
 * prints `Show 4 more sessions`, not the ladder's next rung.
 */
export function pageMoreLabel(loads: number, remaining: number): string {
	const step = pageLimit(loads + 1) - pageLimit(loads);
	const add = Math.max(0, Math.min(step, remaining));
	return add === 1 ? "Show 1 more chat" : `Show ${add} more chats`;
}

/**
 * The rows that count as ACTIVE for the lift.
 *
 * IT IS THE RUNNING SECTION'S OWN PREDICATE, imported rather than restated:
 * a second copy of the status codes here is how the section and the lift come
 * to disagree, and the failure that produces is a row lifted out of a section
 * it is not in - or, worse, a row filed under RUNNING that the page can push
 * below the fold the lift exists to keep it out of.
 */
export function isActiveRow(row: CanonicalSessionRow): boolean {
	return isRunningRow(row);
}

/**
 * The list in the order the PAGE is taken over it - invariant 3's whole
 * implementation, and it is a stable PARTITION rather than a sort.
 *
 * `Array.prototype.sort` is not used, and this is not a style preference: a
 * comparator added to lift active rows is also free to reorder the rows it did
 * not intend to touch (V8's sort is stable TODAY, and a comparator that
 * compares only one bit is exactly the sort of thing a later edit "improves"
 * into a two-key comparison, which is what would invert recency). Two filters
 * cannot: the relative order of everything that is not lifted is preserved
 * exactly, which is what "without inverting recency below it" asks for, and
 * `recent` is the identity function over the same array.
 */
export function pageOrder(
	rows: readonly CanonicalSessionRow[],
	orderBy: SidebarOrderBy,
): CanonicalSessionRow[] {
	if (orderBy === "recent") return [...rows];
	const active: CanonicalSessionRow[] = [];
	const rest: CanonicalSessionRow[] = [];
	for (const row of rows) (isActiveRow(row) ? active : rest).push(row);
	return [...active, ...rest];
}

export type PageResult = {
	/** The rows to draw, in order. */
	rows: CanonicalSessionRow[];
	/**
	 * Whether the viewed conversation was LIFTED into the page - drawn although
	 * it sits past the loaded page. The component draws it as its own row at the
	 * head of the list, above the sections, so the reader can see where they are
	 * without loading 400 rows to get there.
	 */
	lifted: boolean;
	/** Rows past the page, i.e. how many `Show more` would reveal. */
	remaining: number;
};

/**
 * The page - invariants 1 and 2.
 *
 * `searching` bypasses the limit entirely, and that is invariant 2 rather than a
 * convenience: the backend's search answers over an index of every conversation,
 * including ones this client has never loaded (`chat-search.ts`'s synthesised
 * hits), so a page applied to the ANSWER would hide the very row the search was
 * run to find. The limit is a browsing affordance; it is not a filter, and it
 * must not act as one.
 *
 * The lift is for the same reason from the other side: a reader who opens a
 * conversation from a notification, a link or the terminal has a viewed row the
 * catalogue put at position 300, and "you are here" is not something a page
 * size may take away.
 */
export function pageRows(
	ordered: readonly CanonicalSessionRow[],
	options: {
		limit: number;
		currentId?: string | null;
		searching?: boolean;
	},
): PageResult {
	const { limit, currentId, searching = false } = options;
	if (searching) {
		return { rows: [...ordered], lifted: false, remaining: 0 };
	}
	const head = ordered.slice(0, Math.max(0, limit));
	const remaining = Math.max(0, ordered.length - head.length);
	if (!currentId) return { rows: head, lifted: false, remaining };
	const index = ordered.findIndex((row) => row.session_id === currentId);
	if (index < 0 || index < head.length) {
		return { rows: head, lifted: false, remaining };
	}
	return { rows: [ordered[index], ...head], lifted: true, remaining };
}

/** One group of the agent-grouped list. */
export type SidebarRowGroup = {
	key: string;
	label: string;
	rows: CanonicalSessionRow[];
};

/**
 * The arranged list under a given `groupBy`.
 *
 * `section` returns null and leaves the arrangement to
 * `chat-list-sections.ts`'s own partition, which is where the RUNNING/TODAY/
 * WEEK/OLDER rules live and the only place they should: a second implementation
 * of "which section is this row in" is how the labels and the lift disagree.
 * `agent` groups by the row's binding - its team, else its agent - and
 * `flat` is one unlabelled group.
 *
 * UNGROUPED IS A REAL GROUP rather than a leftover, and it is drawn rather than
 * dropped: an untargeted chat, a chat whose agent was deleted, and a chat opened
 * from the terminal all land here, and a group-by that made them invisible would
 * be a filter wearing a layout's name.
 */
export function groupRows(
	rows: readonly CanonicalSessionRow[],
	groupBy: SidebarGroupBy,
): SidebarRowGroup[] | null {
	if (groupBy === "section") return null;
	if (groupBy === "flat") return [{ key: "all", label: "", rows: [...rows] }];
	const groups = new Map<string, SidebarRowGroup>();
	for (const row of rows) {
		const name = row.binding?.team || row.binding?.agent || "";
		const key = name || "ungrouped";
		const group = groups.get(key) ?? {
			key,
			label: name || "Ungrouped",
			rows: [],
		};
		group.rows.push(row);
		groups.set(key, group);
	}
	// Ungrouped last, however early it appeared: it is the residual, and a
	// residual drawn first pushes every named group below the fold's midpoint.
	const out = [...groups.values()];
	const residual = out.findIndex((group) => group.key === "ungrouped");
	if (residual > 0) out.push(...out.splice(residual, 1));
	return out;
}

/** Whether a section draws, under this view. */
export function isSectionShown(
	view: SidebarView,
	key: SidebarSectionKey,
): boolean {
	return !view.hidden.includes(key);
}

/** The sections to draw, in the view's own order, hidden ones removed. */
export function shownSections(view: SidebarView): SidebarSectionKey[] {
	return view.order.filter((key) => isSectionShown(view, key));
}

/**
 * Switching a section off, or back on.
 *
 * NO SECTION IS UNDROPPABLE, including `running`: the popover that switched one
 * off is the same control that switches it back, and a section that could not be
 * hidden would be a preference the popover lies about. The rejected alternative
 * is the one `hideRegion` above rejects for the same reason - a state the user
 * cannot leave - and the difference is that this state is reachable only from
 * the popover that undoes it, while a panel with both regions hidden has no
 * boundary left to hold the control that restores one.
 */
export function toggleSection(
	view: SidebarView,
	key: SidebarSectionKey,
): SidebarView {
	const hidden = view.hidden.includes(key)
		? view.hidden.filter((entry) => entry !== key)
		: [...view.hidden, key];
	return { ...view, hidden };
}

/**
 * Moving a section up or down one place - the popover's move pair, which is the
 * ONLY route to a reordered section list at this head: no drag-and-drop reorder
 * ships (`docs/design/sidebar-sections.md` records the decision), so this is not
 * an alternate to anything.
 *
 * AND IT WRITES A DIFFERENT AXIS THAN THE DIVIDER'S ARROW. That control swaps
 * which REGION draws first (`chat-sidebar.tsx`'s region order), while this one
 * writes `view.order` - which SECTION draws first. The two cannot disagree
 * because they never write the same field, not because they share one order, so
 * a future editor must not try to keep a single order in sync between them. (An
 * earlier revision of this comment claimed both; neither held - review round 3,
 * R14.)
 *
 * The move is over the SHOWN sections, and it stays that way when a hidden one
 * sits between: the reader is looking at what is drawn, so "up" has to mean the
 * section above the one they can see. The result is still a permutation of the
 * full list, because the splice swaps two entries of `view.order` and never
 * rebuilds it from the visible subset.
 */
export function moveSection(
	view: SidebarView,
	key: SidebarSectionKey,
	direction: -1 | 1,
): SidebarView {
	const shown = shownSections(view);
	const at = shown.indexOf(key);
	const target = shown[at + direction];
	if (at < 0 || target === undefined) return view;
	const from = view.order.indexOf(key);
	const to = view.order.indexOf(target);
	const order = [...view.order];
	order[from] = target;
	order[to] = key;
	return { ...view, order };
}

const GROUP_BY: readonly SidebarGroupBy[] = ["section", "agent", "flat"];
const ORDER_BY: readonly SidebarOrderBy[] = ["active-first", "recent"];

/**
 * A stored view, or the default.
 *
 * ONE UNION AND NO PARTIAL STATE, which is the same rule `parseSidebarRegions`
 * states and for the same reason: a sidebar that cannot read its own preference
 * must look like a sidebar nobody has configured. So an unknown `groupBy`
 * contributes the default rather than dropping the whole view, `order` is
 * NORMALISED against `SIDEBAR_SECTIONS` - unknown keys dropped, missing ones
 * appended in canonical order, duplicates removed - and a `hidden` entry that is
 * not a section is discarded. The alternative, trusting the blob, is a column
 * that draws six of seven sections and has no control that could name the
 * missing one.
 *
 * `loads` is clamped rather than rejected: it is a click counter, and a
 * tampered `1e9` would ask the list for a page larger than the catalogue it is
 * paging (the store already caps a list read at 500 rows, which is the honest
 * bound and is stated in the sidebar's own note when it is hit).
 */
export function parseSidebarView(value: unknown): SidebarView {
	if (typeof value !== "object" || value === null) return DEFAULT_SIDEBAR_VIEW;
	const raw = value as Partial<Record<keyof SidebarView, unknown>>;
	const known = new Set<string>(SIDEBAR_SECTIONS);
	const order: SidebarSectionKey[] = [];
	if (Array.isArray(raw.order)) {
		for (const entry of raw.order) {
			if (typeof entry !== "string") continue;
			if (!known.has(entry)) continue;
			if (order.includes(entry as SidebarSectionKey)) continue;
			order.push(entry as SidebarSectionKey);
		}
	}
	for (const key of SIDEBAR_SECTIONS) if (!order.includes(key)) order.push(key);
	const hidden: SidebarSectionKey[] = [];
	if (Array.isArray(raw.hidden)) {
		for (const entry of raw.hidden) {
			if (typeof entry !== "string") continue;
			if (!known.has(entry)) continue;
			if (hidden.includes(entry as SidebarSectionKey)) continue;
			hidden.push(entry as SidebarSectionKey);
		}
	}
	const groupBy = GROUP_BY.includes(raw.groupBy as SidebarGroupBy)
		? (raw.groupBy as SidebarGroupBy)
		: DEFAULT_SIDEBAR_VIEW.groupBy;
	const orderBy = ORDER_BY.includes(raw.orderBy as SidebarOrderBy)
		? (raw.orderBy as SidebarOrderBy)
		: DEFAULT_SIDEBAR_VIEW.orderBy;
	const loads =
		typeof raw.loads === "number" && Number.isFinite(raw.loads) && raw.loads > 0
			? Math.min(CHAT_PAGE_MAX, Math.floor(raw.loads))
			: 0;
	return { hidden, order, groupBy, orderBy, loads };
}
